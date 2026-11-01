#!/usr/bin/env python3
"""Scheduler sanity simulation for SCOPE.md section 4.4 (Phase 0, "Scheduler sanity").

Question: with FSRS-6 default parameters and the inferred-rating map of section 4.4, do review
intervals and daily load look reasonable for a beginner learning callouts?

Method: a simulated learner whose *true* memory is deliberately NOT the model FSRS assumes (true
recall is exponential, stability growth is a different rule, multiple choice has a guess floor), so
the scheduler is not graded against its own assumptions. FSRS-6 is implemented from the published
formulas and default parameters (py-fsrs / ts-fsrs). Pure stdlib; no downloads.

Usage:  python fsrs_sim.py            run every scenario and write fsrs_sim_results.txt
        python fsrs_sim.py quick      one seed, short horizon (smoke test)
"""
import math
import random
import statistics
import sys
from collections import deque
from pathlib import Path

# ---------------------------------------------------------------- FSRS-6
W = [0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796,
     1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542]
DECAY = -W[20]
FACTOR = 0.9 ** (1 / DECAY) - 1


def clamp_d(d):
    return min(10.0, max(1.0, d))


def retr(elapsed, s):
    return (1 + FACTOR * elapsed / s) ** DECAY


def interval(s, dr):
    return s / FACTOR * (dr ** (1 / DECAY) - 1)


def s0(g):
    return max(W[g - 1], 0.001)


def d0(g, clamp=True):
    d = W[4] - math.exp(W[5] * (g - 1)) + 1
    return clamp_d(d) if clamp else d


def next_d(d, g):
    delta = -W[6] * (g - 3)
    d2 = d + (10 - d) * delta / 9
    return clamp_d(W[7] * d0(4, False) + (1 - W[7]) * d2)


def s_recall(d, s, r, g):
    hard = W[15] if g == 2 else 1
    easy = W[16] if g == 4 else 1
    return s * (1 + math.exp(W[8]) * (11 - d) * s ** -W[9] * (math.exp((1 - r) * W[10]) - 1) * hard * easy)


def s_forget(d, s, r):
    long_term = W[11] * d ** -W[12] * ((s + 1) ** W[13] - 1) * math.exp((1 - r) * W[14])
    short_term = s / math.exp(W[17] * W[18])
    return min(long_term, short_term)


def s_short(s, g):
    s2 = s * math.exp(W[17] * (g - 3 + W[18])) * s ** -W[19]
    return max(s2, s) if g >= 3 else s2


# ---------------------------------------------------------------- learner model
# F = "fluent" latency threshold in seconds (section 4.4 starting guesses); guess = chance of a lucky
# correct answer when recall fails; tf = relative starting strength of the true memory in this mode.
MODES = {
    "name_mc":    dict(stage=1, F=2.0, guess=0.30, tf=2.0),
    "which_view": dict(stage=1, F=2.5, guess=0.25, tf=1.6),
    "read_map":   dict(stage=1, F=2.5, guess=0.25, tf=1.6),
    "pin":        dict(stage=2, F=6.0, guess=0.05, tf=1.0),
    "name_typed": dict(stage=3, F=4.0, guess=0.00, tf=0.6),
    "where_am_i": dict(stage=4, F=6.0, guess=0.04, tf=0.7),
    "speed":      dict(stage=5, F=1.5, guess=0.15, tf=0.8),
}
STAGES = {k: [m for m, v in MODES.items() if v["stage"] == k] for k in range(1, 6)}
BASE_TRUE_S = 1.2        # days to 90 % recall for an average callout in an average mode, just after intro
OVERHEAD_S = 3.0         # reveal + Space, per card
INTRO_S = 8.0            # intro card, per new callout
UNLOCK_S = {1: 2, 2: 5, 3: 10, 4: 21}   # unlock D: stability (days) the stage must reach before the next opens
DAY_BUDGETS = ([300, 600, 900], [0.3, 0.5, 0.2])


class Item:
    __slots__ = ("c", "mode", "S", "D", "last", "due", "state", "reps", "lapses", "streak", "cdays",
                 "last_ok_day", "st", "tt", "reasks", "first_session")

    def __init__(self, c, mode):
        self.c, self.mode = c, mode
        self.S = self.D = 0.0
        self.last = -1
        self.due = 0
        self.state = "new"
        self.reps = self.lapses = self.streak = self.cdays = 0
        self.last_ok_day = -1
        self.st = BASE_TRUE_S
        self.tt = 0.0
        self.reasks = 0
        self.first_session = None


class Config:
    def __init__(self, **kw):
        self.dr = 0.90
        self.max_interval = 365
        self.rating_rule = "p75"          # "p75" = section 4.4 as written, "abs" = fixed 1.6 x F
        self.thr_scale = 1.0              # scales F (and the absolute slow threshold)
        self.first_cap = None             # None, 3 (Good) or 2 (Hard): cap on an item's first scored rating
        self.unlock = "A"                 # A = 2 correct in a row; B = 2 correct on different days; C = S >= 3 d
        self.new_batches = 1              # intro batches of 4 callouts per session
        self.review_cap = 120
        self.p_active = 0.85
        self.hint_rate = 0.06             # chance a first-time card uses a hint (rated Hard)
        self.easy_frac = 1.0              # Easy needs latency below easy_frac x F
        self.new_throttle = None          # no new callouts or new modes while more than this many reviews are due
        self.__dict__.update(kw)


class Sim:
    def __init__(self, cfg, seed, schedule, days, miss=()):
        self.cfg, self.rng = cfg, random.Random(seed)
        self.schedule = schedule          # {day: n_callouts_to_add} (a new map every N days)
        self.days, self.miss = days, set(miss)
        self.items, self.callouts, self.unintro = [], [], deque()
        self.lat = {m: deque(maxlen=200) for m in MODES}
        self.thr = {m: 1.6 * MODES[m]["F"] * cfg.thr_scale for m in MODES}
        self.since_refresh = {m: 0 for m in MODES}
        # metrics
        self.daily = []                   # per day: dict
        self.answers = []                 # (day, mode, rating, correct, recalled, spaced, pred_r)
        self.intervals = []               # (reps, interval_days) after a Good
        self.snap = {}                    # day -> list of stage-1 stabilities per callout
        self.play = {}                    # day -> items being scheduled

    # ----- content
    def add_callouts(self, n, day):
        for _ in range(n):
            cid = len(self.callouts)
            h = self.rng.lognormvariate(0, 0.4)
            co = dict(id=cid, h=h, stage=0, items={}, born=day, unlock={})
            self.callouts.append(co)
            self.unintro.append(cid)

    def make_stage(self, co, k, day):
        new = []
        for m in STAGES[k]:
            it = Item(co["id"], m)
            prev = co["items"].get(k - 1)
            if prev:
                mean_st = statistics.mean(p.st for p in prev)
                mean_tf = statistics.mean(MODES[p.mode]["tf"] for p in prev)
                it.st = 0.6 * mean_st * MODES[m]["tf"] / mean_tf
                # a mode never seen before starts at about 75 % recall when first asked
                it.tt = day + 0.5 - 2.73 * it.st
            else:
                it.st = BASE_TRUE_S * MODES[m]["tf"] / co["h"]
                it.tt = day + 0.5
            co["items"].setdefault(k, []).append(it)
            self.items.append(it)
            new.append(it)
        co["stage"] = k
        co["unlock"][k] = day - co["born"]
        return new

    # ----- one answer
    def ask(self, it, day, tsec):
        cfg, rng, M = self.cfg, self.rng, MODES[it.mode]
        F = M["F"] * cfg.thr_scale
        now = day + 0.5 + tsec / 86400
        dt = max(0.0, now - it.tt)
        r_true = 0.9 ** (dt / it.st)
        recalled = rng.random() < r_true
        guessed = (not recalled) and rng.random() < M["guess"]
        correct = recalled or guessed
        med = M["F"] * (0.7 + 2.4 * (1 - r_true)) if recalled else (M["F"] * 1.6 if guessed else M["F"] * 2.2)
        lat = med * math.exp(rng.gauss(0, 0.35))
        if not correct:
            rating = 1
        elif it.reps == 0 and rng.random() < cfg.hint_rate:
            rating = 2
        else:
            slow = self.thr[it.mode] if cfg.rating_rule == "p75" else 1.6 * F
            rating = 2 if lat > slow else (4 if lat < F * cfg.easy_frac else 3)
            if it.reps == 0 and cfg.first_cap:
                rating = min(rating, cfg.first_cap)
        if correct:
            self.lat[it.mode].append(lat)
            self.since_refresh[it.mode] += 1
            if cfg.rating_rule == "p75" and self.since_refresh[it.mode] >= 25 and len(self.lat[it.mode]) >= 25:
                self.thr[it.mode] = statistics.quantiles(self.lat[it.mode], n=4)[2]
                self.since_refresh[it.mode] = 0
        # true memory update
        if recalled:
            if dt > 0.5:
                it.st = min(365.0, it.st * (1.5 + 4 * (1 - r_true) ** 0.8) * math.exp(rng.gauss(0, 0.2)))
            else:
                it.st *= 1.12
        elif not correct:
            it.st = max(0.25, it.st * 0.4)
        it.tt = now
        spaced = it.state == "review" and day - it.last >= 1
        pred = retr(day - it.last, it.S) if it.state == "review" else None
        self.answers.append((day, it.mode, rating, correct, recalled, spaced, pred, it.reps == 0))
        return rating, correct, lat

    # ----- scheduler
    def fsrs(self, it, rating, day, correct):
        cfg = self.cfg
        if it.state == "new":
            it.S, it.D = s0(rating), d0(rating)
        else:
            elapsed = day - it.last
            if elapsed < 1:
                it.S = max(0.001, s_short(it.S, rating))
                it.D = next_d(it.D, rating)
            else:
                r = retr(elapsed, it.S)
                nd = next_d(it.D, rating)
                it.S = max(0.001, s_forget(it.D, it.S, r) if rating == 1 else s_recall(it.D, it.S, r, rating))
                it.D = nd
        if rating == 1:
            it.lapses += 1 if it.state == "review" else 0
        it.reps += 1
        it.last = day
        it.state = "review"
        if rating == 1:
            if it.reasks < 2:
                it.due = day              # re-asked later in this session
            else:
                it.due = day + 1
        else:
            iv = min(cfg.max_interval, max(1, round(interval(it.S, cfg.dr))))
            it.due = day + iv
            if rating == 3:
                self.intervals.append((it.reps, iv))
        # streaks for stage unlocks
        if correct:
            it.streak += 1
            if it.last_ok_day != day:
                it.cdays += 1
            it.last_ok_day = day
        else:
            it.streak = 0
            it.cdays = 0
            it.last_ok_day = -1

    def unlocked(self, co, k):
        its = co["items"][k]
        if any(i.state == "new" for i in its):
            return False
        u = self.cfg.unlock
        if u == "A":
            return all(i.streak >= 2 for i in its)
        if u == "B":
            return all(i.cdays >= 2 for i in its)
        if u == "D":
            return all(i.S >= UNLOCK_S[k] for i in its)
        return all(i.S >= 3 for i in its)

    # ----- one day
    def run_session(self, day, budget):
        cfg, rng = self.cfg, self.rng
        n_exp = budget / 6.0
        new_cap = int(0.3 * n_exp)
        due = [i for i in self.items if i.state != "new" and i.due <= day]
        backlog = len(due)
        due.sort(key=lambda i: retr(day - i.last, i.S) if i.last >= 0 else 0)
        due = due[: cfg.review_cap]
        throttled = cfg.new_throttle is not None and backlog > cfg.new_throttle
        new_items, intro = [], 0
        if not throttled:
            for co in self.callouts:           # later stages that unlocked since the last session
                for k in range(2, 6):
                    its = co["items"].get(k)
                    if its:
                        for it in its:
                            if it.state == "new" and len(new_items) < new_cap:
                                new_items.append(it)
            for _ in range(cfg.new_batches):
                if not self.unintro:
                    break
                for _ in range(4):
                    if self.unintro:
                        co = self.callouts[self.unintro.popleft()]
                        new_items += self.make_stage(co, 1, day)
                        intro += 1
        q = deque(new_items + due)
        t = intro * INTRO_S
        n_ans = n_new = n_rev = 0
        while q and t < budget:
            it = q.popleft()
            first = it.state == "new"
            rating, correct, lat = self.ask(it, day, t)
            t += lat + OVERHEAD_S
            if first:
                n_new += 1
            else:
                n_rev += 1
            n_ans += 1
            if rating == 1 and it.reasks < 2:
                it.reasks += 1
                self.fsrs(it, rating, day, correct)
                q.insert(min(len(q), 4), it)
                continue
            self.fsrs(it, rating, day, correct)
            it.reasks = 0
            co = self.callouts[it.c]
            k = co["stage"]
            if k < 5 and self.unlocked(co, k):
                self.make_stage(co, k + 1, day)
        for it in q:
            it.reasks = 0
        return dict(day=day, answers=n_ans, new=n_new, rev=n_rev, intro=intro, secs=t, backlog=backlog,
                    throttled=throttled and bool(self.unintro))

    def run(self):
        cfg = self.cfg
        for day in range(1, self.days + 1):
            if day in self.schedule:
                self.add_callouts(self.schedule[day], day)
            rec = dict(day=day, answers=0, new=0, rev=0, intro=0, secs=0.0,
                       backlog=sum(1 for i in self.items if i.state != "new" and i.due <= day))
            if day not in self.miss and self.rng.random() < cfg.p_active:
                budget = self.rng.choices(DAY_BUDGETS[0], DAY_BUDGETS[1])[0]
                rec = self.run_session(day, budget)
                rec["active"] = True
            else:
                rec["active"] = False
            self.daily.append(rec)
            if day in (30, 60, 90, 120, 180, 240):
                self.play[day] = sum(1 for i in self.items if i.state != "new")
            if day in (14, 30, 60, 90, 120):
                self.snap[day] = [statistics.median(i.S for i in co["items"][1]) if co["items"].get(1) and
                                  all(i.state != "new" for i in co["items"][1]) else None
                                  for co in self.callouts]
        return self


# ---------------------------------------------------------------- reporting
def pct(xs, p):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(p * len(xs)))] if xs else 0


def summarise(sim, lo, hi):
    """Steady-state numbers over days lo..hi."""
    d = [x for x in sim.daily if lo <= x["day"] <= hi and x["active"]]
    ans = [a for a in sim.answers if lo <= a[0] <= hi]
    spaced = [a for a in ans if a[5]]
    ok = [a for a in ans if a[3]]
    ratings = [a[2] for a in ans if not a[7]]
    r = dict(
        cards=statistics.mean(x["answers"] for x in d) if d else 0,
        cards_p95=pct([x["answers"] for x in d], 0.95),
        mins=statistics.mean(x["secs"] for x in d) / 60 if d else 0,
        mins_p95=pct([x["secs"] for x in d], 0.95) / 60,
        backlog=statistics.mean(x["backlog"] for x in sim.daily if lo <= x["day"] <= hi),
        true_recall=statistics.mean(1 if a[4] else 0 for a in spaced) if spaced else 0,
        correct=statistics.mean(1 if a[3] else 0 for a in spaced) if spaced else 0,
        pred=statistics.mean(a[6] for a in spaced) if spaced else 0,
        again=ratings.count(1) / len(ratings) if ratings else 0,
        hard=ratings.count(2) / len(ratings) if ratings else 0,
        good=ratings.count(3) / len(ratings) if ratings else 0,
        easy=ratings.count(4) / len(ratings) if ratings else 0,
        n_spaced=len(spaced),
    )
    return r


def mean_over(seeds, make, lo, hi):
    out = []
    for s in seeds:
        sim = make(s).run()
        out.append(summarise(sim, lo, hi))
    keys = out[0].keys()
    return {k: statistics.mean(o[k] for o in out) for k in keys}


def fmt(r):
    return (f"{r['cards']:5.0f} {r['cards_p95']:5.0f} {r['mins']:5.1f} {r['mins_p95']:5.1f} {r['backlog']:5.0f}"
            f"  {r['true_recall'] * 100:5.1f} {r['correct'] * 100:5.1f} {r['pred'] * 100:5.1f}"
            f"  {r['again'] * 100:4.0f} {r['hard'] * 100:4.0f} {r['good'] * 100:4.0f} {r['easy'] * 100:4.0f}")


HEAD = ("  cards p95 mins p95min backlog  recall correct predR  again hard good easy\n"
        "  (per active day, spaced reviews: true recall, answered correct, FSRS predicted; rating mix excludes first asks)")

MIRAGE = {1: 45}                  # 12 Core + 33 Standard
SEVEN = {1 + 14 * i: 45 for i in range(7)}   # a new map every 14 days


def main():
    quick = len(sys.argv) > 1 and sys.argv[1] == "quick"
    seeds = [1] if quick else list(range(1, 13))
    days1, days7 = (60, 90) if quick else (120, 240)
    out = []

    def p(*a):
        line = " ".join(str(x) for x in a)
        print(line)
        out.append(line)

    p("FSRS-6 scheduler sanity simulation (SCOPE section 4.4)")
    p(f"seeds: {len(seeds)}; one learner = 85 % of days active, 5/10/15-minute sessions (30/50/20 %),")
    p("4 new callouts per session, 45 callouts per map, desired retention 0.90 unless stated.\n")

    # ---- 1. baseline, Mirage only
    base = Config()
    p("== 1. Baseline (section 4.4 as written), Mirage only ==")
    sims = [Sim(base, s, MIRAGE, days1).run() for s in seeds]
    p(HEAD)
    for lo, hi in ((1, 14), (15, 30), (31, 60), (61, days1)):
        if lo > days1:
            continue
        p(f"days {lo:3d}-{hi:3d}", fmt({k: statistics.mean(summarise(s, lo, hi)[k] for s in sims)
                                      for k in summarise(sims[0], lo, hi)}))
    iv = [x for s in sims for x in s.intervals]
    by = {}
    for reps, v in iv:
        by.setdefault(min(reps, 8), []).append(v)
    p("\n  interval after a Good rating, by review number (median / p90 days):")
    p("  " + "  ".join(f"#{k}: {statistics.median(v):.0f}/{pct(v, 0.9):.0f}" for k, v in sorted(by.items())))
    p("\n  days from introduction until each stage opens (median; callouts that reach it / 45):")
    for k, name in ((2, "pin it"), (3, "typed name"), (4, "where am I"), (5, "speed call")):
        v = [co["unlock"][k] for s in sims for co in s.callouts if k in co["unlock"]]
        p(f"  stage {k} ({name}): {statistics.median(v) if v else float('nan'):.0f} days, "
          f"{len(v) / len(sims):.0f} of 45 reach it by day {days1}")
    intro_day = []
    for s in sims:
        got = [x for x in s.daily if x["intro"]]
        c, last = 0, None
        for x in got:
            c += x["intro"]
            if c >= 45:
                last = x["day"]
                break
        intro_day.append(last)
    p(f"  day the last of 45 callouts was introduced: {statistics.median([d for d in intro_day if d]):.0f} (median)")
    p("\n  stage-1 stability, how the map would look (share of the 45 callouts by memory strength):")
    p("  day   untouched  <3d(learning)  3-14d(familiar)  14-45d(known)  >=45d(automatic)")
    for day in (14, 30, 60, 90, 120):
        if day > days1:
            continue
        tot = [0, 0, 0, 0, 0]
        for s in sims:
            for v in s.snap[day]:
                if v is None:
                    tot[0] += 1
                elif v < 3:
                    tot[1] += 1
                elif v < 14:
                    tot[2] += 1
                elif v < 45:
                    tot[3] += 1
                else:
                    tot[4] += 1
        n = sum(tot)
        p(f"  {day:3d}   " + "  ".join(f"{t / n * 100:11.0f}%" for t in tot))

    # ---- 2. variants
    p("\n== 2. What changes the load or the retention (Mirage only, days 31-%d) ==" % days1)
    p(HEAD)
    variants = [
        ("baseline", {}),
        ("absolute slow threshold (no p75 rule)", dict(rating_rule="abs")),
        ("thresholds x0.5 (learner mostly slow)", dict(thr_scale=0.5, rating_rule="abs")),
        ("thresholds x2 (learner mostly fast)", dict(thr_scale=2.0, rating_rule="abs")),
        ("Easy only below 0.6 x fluent threshold", dict(easy_frac=0.6, rating_rule="abs")),
        ("first answer capped at Good", dict(first_cap=3)),
        ("first answer capped at Hard", dict(first_cap=2)),
        ("unlock B: 2 correct on different days (= A here)", dict(unlock="B")),
        ("unlock C: stability >= 3 days", dict(unlock="C")),
        ("unlock D: stability 2/5/10/21 days per stage", dict(unlock="D")),
        ("desired retention 0.85", dict(dr=0.85)),
        ("desired retention 0.95", dict(dr=0.95)),
        ("8 new callouts per session", dict(new_batches=2)),
        ("no cap on reviews per day", dict(review_cap=10 ** 6)),
    ]
    for name, kw in variants:
        r = mean_over(seeds, lambda s, kw=kw: Sim(Config(**kw), s, MIRAGE, days1), 31, days1)
        p(f"{name:42s}", fmt(r))

    # ---- 3. seven maps
    p("\n== 3. Seven maps, a new map every 14 days (45 callouts each), %d days ==" % days7)
    p(HEAD)
    sims7 = [Sim(base, s, SEVEN, days7).run() for s in seeds]
    for lo in range(15, days7, 30 if not quick else 30):
        hi = min(days7, lo + 29)
        p(f"days {lo:3d}-{hi:3d}", fmt({k: statistics.mean(summarise(s, lo, hi)[k] for s in sims7)
                                      for k in summarise(sims7[0], lo, hi)}))
    p("  last 60 days, by setting (introduced = callouts introduced by the end, of 315):")
    p(f"  {'':44s}" + HEAD.split(chr(10))[0] + "  introduced")
    settings = [
        ("as written (cap 120, no throttle)", {}),
        ("as written, no cap on reviews per day", dict(review_cap=10 ** 6)),
        ("desired retention 0.85", dict(dr=0.85)),
        ("throttle: no new while > 60 due", dict(new_throttle=60)),
        ("throttle: no new while > 30 due", dict(new_throttle=30)),
        ("throttle 30 + Easy below 0.6 F + first cap Good", dict(new_throttle=30, easy_frac=0.6, rating_rule="abs",
                                                                  first_cap=3)),
        ("recommended: throttle 60, ratings fixed", dict(new_throttle=60, easy_frac=0.6, rating_rule="abs",
                                                          first_cap=3)),
        ("  + unlock D", dict(new_throttle=60, easy_frac=0.6, rating_rule="abs", first_cap=3, unlock="D")),
        ("  + retention 0.95", dict(new_throttle=60, easy_frac=0.6, rating_rule="abs", first_cap=3, dr=0.95)),
        ("  + retention 0.85", dict(new_throttle=60, easy_frac=0.6, rating_rule="abs", first_cap=3, dr=0.85)),
    ]
    for name, kw in settings:
        rs, intro_n = [], []
        for sd in seeds:
            sim = Sim(Config(**kw), sd, SEVEN, days7).run()
            rs.append(summarise(sim, days7 - 59, days7))
            intro_n.append(len(sim.callouts) - len(sim.unintro))
        r = {k: statistics.mean(x[k] for x in rs) for k in rs[0]}
        p(f"  {name:44s}", fmt(r), f"  {statistics.mean(intro_n):6.0f}")
    p("  items being scheduled (mean) at day: " + ", ".join(
        f"{d}: {statistics.mean(s.play[d] for s in sims7):.0f}" for d in (30, 60, 90, 120, 180, 240) if d <= days7))

    # ---- 4. missed weeks
    p("\n  recommended settings, stage opening (Mirage only), unlock A vs D:")
    for u in ("A", "D"):
        rec = dict(new_throttle=60, easy_frac=0.6, rating_rule="abs", first_cap=3, unlock=u)
        ss = [Sim(Config(**rec), sd, MIRAGE, days1).run() for sd in seeds]
        row = []
        for k in (2, 3, 4, 5):
            v = [co["unlock"][k] for x in ss for co in x.callouts if k in co["unlock"]]
            row.append(f"stage {k}: {statistics.median(v) if v else float('nan'):.0f} d ({len(v) / len(ss):.0f}/45)")
        r = {k: statistics.mean(summarise(x, 31, days1)[k] for x in ss) for k in summarise(ss[0], 31, days1)}
        p(f"  unlock {u}: " + ", ".join(row) + f";  days 31-{days1}: {r['cards']:.0f} cards, recall {r['true_recall'] * 100:.0f}%")

    p("\n== 4. A missed week, then a missed three weeks (Mirage only, after day 40) ==")
    p("  gap   backlog on return   days to clear   recall on first day back   cards that day")
    for gap in (7, 21):
        miss = range(41, 41 + gap)
        backs, clears, recs, cards = [], [], [], []
        for s in seeds:
            sim = Sim(base, s, MIRAGE, 41 + gap + 40, miss=miss).run()
            ret = 41 + gap
            row = next((x for x in sim.daily if x["day"] >= ret and x["active"]), None)
            if not row:
                continue
            backs.append(row["backlog"])
            cards.append(row["answers"])
            first = [a for a in sim.answers if a[0] == row["day"] and a[5]]
            if first:
                recs.append(statistics.mean(1 if a[4] else 0 for a in first))
            pre = statistics.mean(x["backlog"] for x in sim.daily if 30 <= x["day"] <= 40)
            cl = next((x["day"] - row["day"] for x in sim.daily if x["day"] > row["day"] and
                       x["backlog"] <= max(pre * 1.3, 10)), None)
            clears.append(cl if cl is not None else 40)
        p(f"  {gap:2d} d  {statistics.mean(backs):12.0f}   {statistics.mean(clears):13.1f}"
          f"   {statistics.mean(recs) * 100:20.0f}%   {statistics.mean(cards):10.0f}")

    text = "\n".join(out) + "\n"
    if not quick:
        Path(__file__).with_name("fsrs_sim_results.txt").write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()

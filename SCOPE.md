# Callouts — Project Scope

*Working title (confirmed): Callouts. Status: scoping draft v0.2, with Dan's answers to §12 folded in, 2026-10-28. Owner: Dan.*

A web app that teaches you every callout on every CS2 map, using real in-game screenshots and custom-drawn overhead maps, built around active recall and spaced repetition so the names stick in the fewest possible minutes.

---

## Decisions locked

Dan's answers (2026-10-28), which shape everything below:

- **Personal, local-first.** No hosting, accounts or sharing.
- **Maps:** Premier and FACEIT pools only, chosen from a map picker on the Home screen.
- **Detail:** every callout covered at a high level of detail. The smallest spots and niche callouts sit in **Hard mode**.
- **Naming:** community callouts and the game's own place names, both shown.
- **Dark theme only.**
- **Look:** direction C, "terminal": one monospace face, six colours, flat and lowercase (§6.2, §6.8).
- **Starting point:** a beginner who knows few callouts, so the learning path starts from zero.
- **No scrolling:** every screen fits in one viewport (§5.3).

---

## Contents

1. [The problem and the one idea that shapes everything](#1-the-problem-and-the-one-idea-that-shapes-everything)
2. [Goals, non-goals, success measures](#2-goals-non-goals-success-measures)
3. [Content scope](#3-content-scope)
4. [Learning design](#4-learning-design)
5. [Product and UX](#5-product-and-ux)
6. [Visual design direction](#6-visual-design-direction)
7. [Technical architecture](#7-technical-architecture)
8. [Content pipeline and authoring tools](#8-content-pipeline-and-authoring-tools)
9. [Legal and IP](#9-legal-and-ip)
10. [Roadmap](#10-roadmap)
11. [Risks](#11-risks)
12. [Decisions and open questions](#12-decisions-and-open-questions)
13. [Research notes and sources](#13-research-notes-and-sources)

---

## 1. The problem and the one idea that shapes everything

Existing callout material is almost all **top-down maps with labels**: a blog post, a radar image, a list. That is the wrong shape for the skill you need in a match. In a round you never see the top-down map. You see a **first-person view** and must name where you, or the enemy, are, in under a second, then say it into comms.

So the real skill is a three-way mapping:

```
   first-person view  <——>  name  <——>  position on the radar
        (what you see)    (what you say)    (where it is)
```

Reading a labelled map trains only the right-hand link, and only as recognition. A good learning product trains all three links, in both directions, as **recall** rather than re-reading. That drives the whole design:

- Screenshots are the primary stimulus, not decoration. The map is the answer surface and the progress surface.
- Every quiz type exercises a specific link. Together they cover the full triangle (§4.2).
- The hardest and most valuable exercise, "I'm looking at this, where am I standing and which way am I facing?", is a first-class mode.

### Gap in existing tools

A quick survey (§13) found Sporcle map quizzes (typed-name, untimed, one map each), csdb.gg's Callout Hunt (radar-pin rounds, with pages for at least Mirage, Dust II and Train), an open-source CS:GO-era quiz on GitHub, interactive reference maps (metabot.gg), and many lineup/utility apps. I found **no CS2 callout trainer** that combines real first-person screenshots, spaced repetition, and a position-and-heading mode. That is the opening. (Unverified: I did not search app stores exhaustively.)

---

## 2. Goals, non-goals, success measures

### Goals

1. **Fast learning from zero.** Someone who knows almost no callouts can name a map's Core callouts after two or three short sessions, and its full Standard set within about ten days of 10-minute sessions.
2. **Lasting retention.** Scheduling is driven by a real memory model (FSRS), not a fixed ladder.
3. **Zero friction.** One click from opening the app to the first question. No sign-up, no setup, no manual card grading.
4. **Trustworthy content.** Callout names match what players actually say and what the game itself calls places. Every map carries the game version it was captured against.
5. **Looks and feels hand-made.** A distinct visual identity, not a template (§6).
6. **Complete within the pools.** Every Premier and FACEIT map, delivered one at a time with each finished before the next.
7. **One screen, no scrolling.** Every screen fits the window (§5.3).

### Non-goals (v1)

- Grenade lineups, smokes, setups, strats, economy. Callouts only. (The data model leaves room for later features that hang off callouts.)
- Accounts, cloud sync, social features, leaderboards, multiplayer. Local-first.
- Workshop and community maps, and any map outside the Premier and FACEIT pools (Office, Italy, Agency and similar).
- Live game integration (GSI, overlays, reading the player's position in game). Possible later; out of scope now.
- Native mobile or desktop apps. A PWA covers the use cases.
- Monetisation of any kind (this also protects the IP position, §9).
- Languages other than English.
- Public hosting or sharing. This is a personal tool (§9).
- A light theme. Dark only.

### Success measures (personal, measurable)

| Measure | Target |
|---|---|
| Time from app open to first question | ≤ 2 interactions, ≤ 3 s |
| Time-to-first-value for a brand-new learner | First callout learned in < 60 s |
| Beginner path | A complete beginner names a map's Core callouts after ≤ 3 short sessions |
| Fit | No screen scrolls at any supported viewport (§5.3) |
| Recall accuracy on a card 7+ days after last review (mastered cards) | ≥ 85 % |
| Median answer time on "Known" callouts | < 2.5 s (multiple choice), < 4 s (typed) |
| Coverage | 100 % of Core and Standard callouts (Tiers 1–2) have ≥ 3 screenshots and a region on the map; Hard callouts (Tier 3) have ≥ 2 |
| Subjective | Dan can follow and use callouts in a live match on a map he had never practised |

Metrics are derived locally from the review log. No analytics, no tracking.

---

## 3. Content scope

### 3.1 Maps

**In scope: the Premier and FACEIT map pools, and nothing else.** Dan's decision (§12). Office, Italy, Agency and the other Casual, Wingman and Deathmatch-only maps are out, as are Workshop maps. The Home screen has a **map picker** showing every supported map at once. Maps that are not built yet appear dimmed with a "coming" label, so the picker is final from the first release and fills in as maps are completed.

| Group | Maps | Source of truth | Phase |
|---|---|---|---|
| A. Premier (Valve Active Duty) | Ancient, Anubis, Cache, Dust II, Inferno, Mirage, Nuke | Secondary sources dated June–October 2026; confirm against Valve's release notes | 1–2 |
| B. Extras (FACEIT candidates) | Overpass, Vertigo, Train | Not verified: Dan dropped the FACEIT pool check (2026-10-28). All three stay on the list, built last; the list is data, so removing one is a one-line change | 3 |
| Out of scope | Office, Italy, Agency and other Casual/Wingman/Deathmatch maps; Workshop maps | n/a | n/a |

**What the research found about the pools** (all secondary sources; treat as provisional):

- *Premier / Valve.* Sources dated June–October 2026 agree the Active Duty pool is Ancient, Anubis, Cache, Dust II, Inferno, Mirage, Nuke, with Overpass removed and Cache added (Premier Season 5), and Anubis having replaced Train in January 2026. The dates conflict (Cache's return is reported as 28 April and 8 July 2026, probably two events: the return to matchmaking, then entry to Active Duty). Disputes over which other maps were dropped from other modes in July don't matter here.
- *FACEIT.* Reports say FACEIT added Cache as an eighth, optional, Elo-counted map from Season 8 (22 April 2026), then ran a Season 9 community vote that Vertigo won (roughly 97,000 votes, ahead of Train at about 65,000 and Overpass at about 50,000). Vertigo joined as an optional, Elo-enabled map on 5 August 2026. **I could not find an authoritative full list of FACEIT's current pool.** FACEIT's support pages blocked my fetch, and the news items only name the additions. The working assumption is the seven Premier maps plus Vertigo, with Overpass probably still present and Train unconfirmed. The map list is data, not code, so correcting it is a one-line change per map.

**Cache needs extra care.** It is a Source 2 rebuild (Valve reportedly bought the rights from its original creator) that has changed since release, and a patch on 3 August is reported to have altered it. Its callouts are less settled than a map like Mirage. It gets a second verification pass and a visible "map revised" flag.

**Build order (internal).** Mirage goes first as the vertical slice, unless Dan prefers another: its callouts are the most settled across the community, so problems found early are pipeline and design problems, not "which name is right" problems. The picker does not force this order on the learner; build order only decides which maps are unlocked first. Cache comes once the process is proven, and the extras (Overpass, Vertigo, Train) come last.

### 3.2 What a callout is (data model)

One record per callout per map. Positions are stored in **world units** (resolution independent); the display projection is applied at render time.

```jsonc
{
  "id": "mirage.palace",
  "map": "de_mirage",
  "name": "Palace",
  "aliases": ["Pal", "Palace Balcony"],        // accepted as typed answers
  "zone": "a-site",                             // grouping for chunking + UI
  "tier": 1,                                    // 1 core, 2 standard, 3 hard-mode only
  "level": "default",                           // for multi-floor maps (default | lower)
  "region": [[x, y], ...],                      // polygon in world units
  "anchor": [x, y],                             // label point + "click target" fallback
  "parent": null,                               // standard callout this small spot sits inside (Hard-mode spots)
  "gameplaceName": "Palace",                    // Valve nav place name if it exists, else null
  "blurb": "Raised area overlooking A site from the T side, reached via the stairs.",   // ≤ 120 chars, enforced so it fits one screen (§5.3)
  "neighbours": ["mirage.ramp", "mirage.tetris"],  // adjacency, drives distractors + reveal hints
  "shots": [
    {
      "file": "mirage/palace-1.avif",
      "pos": [x, y, z], "yaw": 0, "pitch": 0,   // exact camera, enables "Where am I?"
      "stance": "stand",
      "kind": "approach",                       // approach | alternate | inside | overview
      "captured": "2026-10-30",
      "build": "<game build id>"
    }
  ],
  "status": "verified"                          // draft | verified | stale
}
```

Fields the schema (`app/src/core/schema.ts`) adds or fixes, beyond the example above: `order` (optional integer, the callout's place along the route inside its zone, from spawn toward the site; intro cards follow it), `radarSize` and `status` (`draft` | `verified`) on the map, and optional `altitudeMin` / `altitudeMax` on a level (a level covers `altitudeMin <= z < altitudeMax`, as in Valve's overview files). Unknown fields are rejected, so a typo in the data cannot pass silently. Alias `perspective` hints (§3.3 rule 5) are not in the schema yet.

Per-map record:

```jsonc
{
  "id": "de_mirage",
  "displayName": "Mirage",
  "pool": "active-duty",
  "projection": { "posX": -3230, "posY": 1713, "scale": 5.0 },   // real Mirage values from the game files (checked in Phase 0)
  "levels": [{ "id": "default" }],                               // Nuke/Vertigo add a lower level + altitude cutoffs
  "gameBuild": "<build id>",
  "revision": 1,
  "zones": [{ "id": "a-site", "name": "A Site" }, ...]
}
```

### 3.3 Naming policy

Callout names are the most contested part of the content. The rule:

1. **Canonical name = what the community says in comms**, which for settled maps is consistent. Cross-check each name against at least three independent sources (pro/community guides, HLTV-adjacent coverage, Valve's own place names).
2. **Valve's in-game place names are recorded** in `gameplaceName` (§7.4). They differ from community names in places. Where they differ, the app always shows both ("You'll hear *Short*; the game's text calls it *ShortStairs*"). The in-game names appear in text radio messages and in demo data, so they matter. As a sizing hint, csdb.gg lists 52 callouts for Mirage, 23 of which it labels official and 29 community names, so expect the community layer to be the larger one. In a quick Phase 0 check, 30 of the 114 distinct location labels in Valve's own retake files (26 %) exactly match a Valve place name, so the two layers do differ.
3. **Aliases** cover accepted alternate names and abbreviations.
4. **Tiering.** Tier 1 (Core): the skeleton every player needs first, roughly 10–15 per map: spawns, sites, main lanes. Tier 2 (Standard): everything else a player is expected to call, covered in high detail. Tier 3 (Hard): the smallest spots and niche callouts, shown only in Hard mode (§4.12). New learners see Tier 1 first.
5. **Side-specific names** (a spot called one thing from CT side, another from T side) are modelled as aliases with a `perspective` hint, never as two callouts, unless they truly mean different areas.
6. Dan has final say per map after an in-game review pass. The list is a living data file with a changelog.

### 3.4 Volume estimate

Estimates, to be settled during curation: roughly 35–50 Core and Standard callouts per map, plus 15–30 Hard-mode spots, so about 250–350 standard callouts and 100–200 Hard spots across the seven Premier maps. At 3–4 screenshots per standard callout and 2–3 per Hard spot, **about 1,100–1,800 screenshots** for Phases 1–3, plus the custom map renderings. At roughly 70 KB each that is on the order of 100 MB on disk, which is fine for a local app. The FACEIT-only maps add roughly a further 30 %. Larger sites and confusable areas get more shots.

### 3.5 Screenshot spec

Real screenshots from the game, captured by a repeatable process (§8), not by hand wherever possible.

- **Frame:** 16:9, captured at 1920×1080, exported to 1280×720 AVIF with WebP fallback. Budget ≈ 60–90 KB per image.
- **Clean:** no HUD, no viewmodel, no crosshair, no bots, no players, no dropped items, no smoke/molotov remnants. Neutral, consistent lighting (same time-of-day/preset per map).
- **Camera:** standing eye height by default (64 units above the player origin, consistent with Valve's position files in §8.4), crouched where that is the realistic view. FOV matches a normal 16:9 player view.
- **Kinds per callout (min 3 for Core and Standard, min 2 for Hard):**
  - *Approach*: the view a player usually has when coming at it or looking at it. Callout dominates the centre. At least one landmark visible.
  - *Inside*: standing in the callout, looking along its main axis.
  - *Alternate approach*: the view from the other common direction (for example CT side versus T side), so the callout is recognised from both ends.
  - *Overview* (sites and big areas): wider, shows how pieces fit.
  - *Hard-mode spots* (a box, a corner, a ledge) use a close-up plus a wider shot showing where the spot sits inside its parent callout.
- **Unambiguity test:** show the shot to someone who knows the map. Can they name the callout in 3 s? If two callouts look the same in the shot, recapture.
- **Metadata always stored:** exact world position, yaw, pitch, stance, game build, capture date. This enables the position-and-heading quiz and automatic staleness detection after map updates.

### 3.6 Custom map art spec

"Custom maps of the map" means drawn overhead maps that are clearer and more consistent than Valve's radar, with callouts as first-class objects.

- **Base layer:** a stylised vector (SVG) of the walkable area, derived from the radar and the decoded nav mesh rather than hand-traced from scratch: radar luminance → mask → vectorise → clean → style. The same visual language on every map (§6.4). **Proven in the design spike (§6.8):** the nav triangles render directly as a clean silhouette, with no radar tracing needed.
- **Region layer:** one polygon per callout, tinted by state (hover, selected, mastery, correct/incorrect).
- **Label layer:** hand-placed labels with leader lines, set in the condensed typeface, with a halo for legibility. Labels can be toggled by zone, tier, or hidden entirely (quiz mode).
- **Levels:** multi-floor maps (Nuke; Vertigo-type maps) get a level switcher. Level membership is data (`levels`, altitude cutoffs from the overview file), not special-cased in code.
- **Alignment:** the SVG viewBox equals the radar's pixel space, so world → pixel is one formula (§7.5) and all overlays line up with the base.
- **Orientation:** fixed, same as the in-game radar, so the learner builds the same mental picture they use in a match. No auto-rotation in v1.
- **Fallback:** if auto-vectorising gives poor output on a map, use Valve's radar image, restyled with CSS filters and masks, as the base for that map and revisit later. Content never blocks on art.

---

## 4. Learning design

This is the core of the product. Everything here is chosen for speed and retention, with the evidence base noted.

### 4.1 Principles

| Principle | What it means here |
|---|---|
| **Retrieval practice** | The app asks; it rarely tells. Study screens exist but are short-lived; most time is spent answering. |
| **Spaced repetition** | Items return just before you'd forget them. FSRS scheduling per item (§4.4). |
| **Dual coding** | Every callout is a picture (screenshot) + a position (map) + a word (name). All three shown together at reveal. |
| **Interleaving** | Mixed zones in a session rather than blocked by zone, once a few callouts are known. Improves discrimination between lookalikes. |
| **Chunking by route** | New callouts are introduced in small geographic clusters, ordered along real routes (T spawn → mid → A), so the learner builds a mental graph, not an unordered list. |
| **Desirable difficulty** | Recognition (multiple choice) → locate (click the map) → free recall (typed) → speed. Difficulty rises as items become stable. |
| **Immediate corrective feedback** | A reveal after every answer showing the truth, what you chose, and where they sit relative to each other. |
| **Error-focused study** | Confusions are tracked and trained directly (§4.6). |
| **Short sessions** | Default 5 minutes / 20 cards. Stopping early is fine and loses nothing. |
| **No manual grading** | Rating is inferred from correctness, speed and hints. Fewer decisions, less friction (§4.4). |

### 4.2 Modes (card types)

Each mode exercises one link of the triangle in §1. Each (callout × mode) pair is its own schedulable item, because remembering a name from a picture is a different skill from placing a name on a map.

| # | Mode | Prompt → Response | Link trained | Notes |
|---|---|---|---|---|
| 1 | **Name it** | Screenshot → name | view → name | Starts as multiple choice (4 options), graduates to typed with fuzzy matching. |
| 2 | **Pin it** | Name → click the map | name → position | Hit-test against region polygon. Neighbouring region = "close", not wrong. |
| 3 | **Read the map** | Highlighted region → name | position → name | Pure radar literacy. |
| 4 | **Which view?** | Name → pick the matching screenshot of 4 | name → view | Distractors come from adjacent and confusable callouts. |
| 5 | **Where am I?** | Screenshot → click position on map (and drag to set heading) | view → position | Hardest mode. GeoGuessr-style reveal: line from guess to truth, camera cone drawn on the map. Unlocks when the callout is Learning-level in modes 1–2. |
| 6 | **Speed call** | Screenshot flashes 1.5–3 s → name | automaticity | Mimics comms pressure. Late-stage only. |
| 7 | **Route walk** (later) | A route is animated on the map; name each area as the dot passes | sequence + adjacency | Phase 3 candidate. |

Stretch ideas, **not in scope** until the core is proven: demo-clip challenge (feed in your own demo), voice answers, "call the push" scenarios.

### 4.3 Session flow

1. **Start** (one click, from the home screen's primary button). The app builds the session. The learner can narrow scope (one map, one zone) but does not have to.
2. **Intro cards** for new callouts, in a batch of up to 4 (default, so a beginner is not flooded), same zone or route segment. Each intro shows: the main screenshot, the name, the position on the map with the camera cone, one line of "what it is" (`blurb`), and its neighbours. Then the learner is immediately quizzed on those, within the same session. (Testing straight after first exposure beats a second look, which is the point of retrieval practice.)
3. **Review cards**: due items first, ordered by lowest predicted recall probability. New-item cap: at most 30 % of any session.
4. **Reveal** after each answer: ≤ 1.5 s to read, `Space` to continue. Shows truth on the map, name, and a one-line spatial hint ("Up the stairs from Connector"). If wrong, the chosen name's location is also shown so the confusion is visible.
5. **Summary**: cards done, accuracy, slowest three, new confusions found, the map's mastery overlay before/after. No confetti. One button: "Another round" or "Done".

Session length options: 5 min / 10 min / 20 cards / until I stop. Quitting mid-session saves everything done so far.

### 4.4 Scheduling

- **Algorithm:** FSRS via the MIT-licensed `ts-fsrs` library (current releases implement FSRS v6). It models stability and retrievability per item, and its maintainers report it beating SM-2-style fixed ladders in their own benchmarks (not independently checked here), with an optimiser available for fitting parameters to Dan's own review history later.
- **Item granularity:** one FSRS card per (callout, mode). Modes 1–6 share a callout's progress through *stage unlock rules*, not a shared memory state.
- **Stage unlocks** (per callout): Intro → Recognise (mode 1 MC, 4, 3) → Locate (mode 2) → Recall (mode 1 typed) → Place yourself (mode 5) → Speed (mode 6). A stage unlocks when every item in the previous stage has reached a stability of 2, 5, 10 and 21 days (stages 1 to 4). "Two correct answers in a row" is not enough: in the simulation (below) it opened all five stages within 18 to 26 days of a callout's introduction, which is far too early for Speed call.
- **Rating is inferred, not entered.** Mapped to FSRS ratings:

| Outcome | FSRS rating |
|---|---|
| Wrong | Again |
| Correct with a hint, or slower than 1.6 × the mode's fluent time | Hard |
| Correct, normal speed | Good |
| Correct, faster than 0.6 × the mode's fluent time (never on an item's first answer, which is capped at Good) | Easy |

  The "fluent time" is per mode and tuned during Phase 1 with real data (starting guesses: ≈ 2 s multiple choice, ≈ 4 s typed, ≈ 6 s map placement). It is a fixed number, not a percentile of the learner's own times: a percentile rule hands out Hard to a fixed share of correct answers for ever (see the simulation).
- **Review log is the source of truth.** Every answer is stored as an immutable event (item, mode, time, chosen answer, latency, hint used, rating). Scheduler state is derived from it, so parameters can be re-optimised and the scheduler can be changed without losing history.
- **New-item throttle (the load control that works):** no new callouts and no newly unlocked modes while more than 60 reviews are due at the start of a session. Reviews that are due always come first, and the most at-risk items come first among them. A cap on reviews per day (120) stays as a safety net, but in the simulation it never bound: the session's time did.
- **Retention target:** 0.90 by default, adjustable from 0.85 to 0.95 in Settings (§5.8).
- **Built in Phase 1 (`app/src/core/`), with the choices the code made:**
  - *Model pinned to FSRS-6.* `ts-fsrs` 6.0.0 changed its default to FSRS-7 (and its API: `DefaultScheduler`, `dueAt`, `scheduleStatus`). The simulation and every figure above are FSRS-6, so the wrapper asks for FSRS-6 by name, and a test fails if the model is anything else. Moving to FSRS-7 means re-running the simulation first.
  - *No minute-long learning steps, no fuzz.* Each item is asked once per session, so a "10 minutes" due time would only be an annoyance, and fuzz would stop a log from replaying to the same state. A first Good answer comes back in 3 days, then 14, 57 and 196 when answered on the due day.
  - *Items.* `name-mc`, `read-map`, `which-view`, `pin`, `name-typed`, `where-am-i` (and `speed` in Phase 2). Stage 1 is the first three; each later stage is one mode. An item that has been replayed from the log carries a fixed card id, so replays are identical.
  - *Unlocking.* A stage opens when every item of the stage before it has a stability of 2, 5, 10 and 21 days. FSRS-6 gives a first Good answer a stability of 2.3 days, so Locate opens as soon as all three Recognise items have been answered correctly once at normal speed; a Hard first answer (1.3 days) does not. Unlocks are recomputed from current stability, so a lapse cools a callout down.
  - *Mastery (§4.5)*: Seen = intro shown; Learning = answering, Recognise not yet stable; Familiar = Recognise stable 2 days; Known = Locate stable 5 days; Automatic = Recall (typed) stable 10 days and the median of the last typed latencies at or under the 4 s fluent time. Speed enters through the rating and through that last test.
  - *The session builder* (`session.ts`) is a pure function of the log, the callouts, the settings, the time and a seeded random source. Intro cards come first (up to 4, one zone at a time, Core before Standard before Hard, a Hard spot only after its parent), then an immediate Name it multiple-choice question for each (three options when `gentleStart`), then due reviews, lowest recall probability first, with newly unlocked modes spread through them. Intro cards do not count toward the card limit; the 30 % new-item share is of the quiz cards, with at least one when the session is not throttled. Only the Name it question is asked right after an intro: the callout's other two Recognise items arrive from the next session on, as new items, so they do not give each other away. Cards of one callout are kept at least three places apart where the list allows.
  - *The throttle counts every due item* across all maps, even when the session is for one map, and ignores nothing the learner could be asked. The daily cap (120) counts answers, not sessions.
  - *When nothing is due and nothing new is allowed, the session is empty* ("nothing due"). Practising items early is not built; revisit if that feels wrong in use.
  - *Typed answers* ignore case, accents, punctuation and spaces ("top mid", "top-mid" and "topmid" are one answer). One typo is forgiven from four characters up; two is wrong; a typo equally near two callouts is wrong, not a guess. Multiple-choice options favour neighbours and confused pairs, prefer callouts the learner has met, and never pair a Hard spot with the callout it sits in.

#### Simulation result (Phase 0, 2026-10-28)

`content-tools/spike/fsrs_sim.py` (pure Python, no downloads; output in `fsrs_sim_results.txt`) runs FSRS-6 with its default parameters against a synthetic learner. The learner's true memory is deliberately not the model FSRS assumes: recall is exponential, stability grows by a different rule, and multiple choice has a guess floor, so the scheduler is not graded on its own assumptions. Twelve seeds, 85 % of days active, 5, 10 or 15-minute sessions, 4 new callouts per session, 45 callouts per map. **The learner is synthetic: read the numbers as direction, not as predictions.** Real calibration comes from Dan's own review log and the FSRS optimiser.

*It works, as long as new material is throttled.* Mirage alone (45 callouts) with the rules as first written:

| Days | Cards per active day | Minutes | Note |
|---|---|---|---|
| 1–14 | 23 | 2.8 | all 45 callouts introduced by about day 14 |
| 15–30 | 44 (p95 68) | 5.9 | the learning peak |
| 31–60 | 22 | 2.6 | |
| 61–120 | 10 | 1.2 | |

Intervals after a Good rating run about 2, 11 and 43 days over the first three reviews. A missed week leaves about 114 reviews due; the first day back sees 74 % recall (67 % after three weeks) and the backlog is cleared in 2–5 days.

*Seven maps, a new map every 14 days, 240 days* (last 60 days shown):

| Rules | Cards / day | Reviews due | True recall | Callouts introduced |
|---|---|---|---|---|
| As first written | 63 | 1,641 | 44 % | 315 of 315 |
| New-item throttle at 60 due | 71 (8.9 min) | 85 | 83 % | 311 |
| Throttle plus the rating fixes below | 71 (8.7 min) | 81 | 87 % | 307 |
| Same, plus stability-gated unlocks | 70 (8.6 min) | 83 | 88 % | 314 |

Without a throttle the learner adds material faster than they can review it, the backlog snowballs and recall collapses, even though each session is a sensible length. With the throttle, all seven maps are learned in about eight months at roughly nine minutes on an active day.

*The rating bands as first written were badly shaped.* "Easy if faster than the fluent time" and "Hard if slower than the 75th percentile" left almost no room for Good: Easy 47 %, Hard 21 %, Good 20 %, and FSRS predicted 90 % recall while the true figure was 83 %. Easy is the rating that grows intervals fastest, and the first Easy answer schedules the next review 8 days out. The fixes are in the table above: Easy only when clearly fast (below 0.6 × fluent), Hard when clearly slow (above 1.6 ×, a fixed number), and the first answer to a new item capped at Good (it is asked seconds after the intro card, so it proves little). Together they give Good 67 % and true recall of 87–88 % at the same load. Shifting every threshold by ×0.5 or ×2 (a learner much slower or faster than assumed) moved recall to 93 % or 72 %, so the fluent times must be recalibrated from real latencies after the first weeks, and the review log stores raw latency so ratings can be re-derived.

*Other results.* Retention target: 0.85 gave 74 % recall (worse, and more reviews, because over-long intervals cause lapses), 0.90 gave 83 %, 0.95 gave 92 % for about the same daily load in a one-map setup. In the seven-map setup 0.95 costs about 4 % more cards and slows introduction (259 of 315 callouts by day 240 instead of 307). Introducing 8 new callouts per session instead of 4 changed nothing measurable. Stage unlocks gated by stability open Speed call about 40 days after a callout is introduced, instead of 18.

### 4.5 Mastery model and the map-as-progress-bar

Each callout shows one of six states, derived from FSRS stability and speed (not from raw counts):

`New → Seen → Learning → Familiar → Known → Automatic`

The **map is the progress display**: regions tint by state, so you see your territory firm up. Dead zones are obvious. A "weakest first" button starts a session aimed at the coldest region. This replaces streak counters and points as the main motivator, because it shows real knowledge and it is the thing the app is actually for.

Per-map and overall percentages are shown, but the region tinting is primary.

### 4.6 Confusion handling

- Record every (target, chosen) wrong pair.
- **Distractor selection** for multiple choice: favour spatial neighbours and previously confused pairs, so options are plausible and the choice is informative.
- When a pair is confused ≥ 2 times, create a **contrast card**: both screenshots side by side, with the single differentiator called out ("Palace has the window, Ramp has the crates").
- The progress view lists the top confusion pairs per map.

### 4.7 Typed answers

- Case-insensitive, punctuation-insensitive, alias-aware.
- Fuzzy matching (Damerau–Levenshtein, tolerance scaled by length) so typos don't punish recall of the right word. A fuzzy-accept shows the correct spelling without penalty; a missed-by-two-edits answer is wrong.
- Autocomplete is **off** at the typed stage (it turns recall into recognition) and available on the intermediate stage as a bridge.
- A "show first letter" hint is one tap, and downgrades the rating (§4.4).

### 4.8 Study / reference mode

For people who want to look before they quiz, and for later look-up:

- Map explorer: hover or tap a region to see name, aliases, blurb, game place name, and its screenshot carousel.
- Zone tour: step through a zone in route order.
- Compact list view, paged per zone, with filters for tier and state (§5.3).
- Study views never count toward scheduling. Only answering does.

### 4.9 Feedback and copy

Terse and spatial, written like someone calling a round, not like a mascot. Wrong answers explain relationships, not just the truth.

- Instead of "Oops! Try again!": **"That's Connector. Palace is up the stairs."**
- Instead of "Great job! 🎉": **"Palace."** and the time, then move on.

### 4.10 Accessibility of the learning flow

Every map-click exercise has a non-spatial alternative (multiple choice); every colour-coded state also has a shape or pattern (§6.2); all exercises are fully keyboard-operable (§5.4).

### 4.11 Starting from zero (the beginner path)

Dan is new to the game and knows few callouts, so the default path assumes **no prior knowledge**, not even which end of the map is T side.

- **One-screen primer** on first run (skippable, reopenable from Settings): what a callout is, T and CT spawns, A and B sites, how to read the radar, and that the radar is fixed (north up) like the in-game one.
- **Core first.** Each map has a "Start here" set of Core callouts (Tier 1, roughly 10–15): spawns, sites and the main lanes. They are taught in route order, from a spawn toward a site, so the learner builds a mental graph rather than memorising a list. Standard callouts unlock around them.
- **Gentler defaults:** 4 new callouts per session; three options instead of four on a callout's first multiple-choice questions; hints cost nothing on a brand-new item; reveals are never timed; nothing shows a countdown until the Speed stage.
- **Recurring terms are taught once.** Words that recur across maps (Mid, Long, Short, Ramp, Connector, Heaven and similar) get a short "also used on: …" note the first time they appear, so the second map goes faster than the first.
- **Relational explanations.** Every reveal says where the thing is relative to something already known ("Up the stairs from Ramp"), because for a beginner the neighbours are the memory hooks.
- **Progress is framed in small wins:** "Core 7 of 12" per map comes before "Standard", and Hard mode is suggested (never forced) once most of a map's Standard callouts are Known.

### 4.12 Hard mode

Standard mode already covers every callout a player is expected to call, at a high level of detail. **Hard mode adds the smallest spots and niche callouts**: individual boxes, corners, ledges, pixel-level positions, and names used mostly at high level.

- **Per-map toggle** on the Map screen (plus a default in Settings). Off: Tier 3 content is absent from sessions, the map and the stats. On: it joins them. Progress on Tier 3 items is kept while the toggle is off.
- **Nested regions.** A Hard spot normally sits inside a Standard callout (`parent`, §3.2). On the map the smallest region under the pointer wins, and the mastery overlay shows nested spots as inlays. Because spots can be tiny, the map zooms (§5.4) and small targets get a tap-to-zoom assist.
- **Release by map.** Tier 3 content can ship as `draft` and stay hidden from Hard mode until verified, so Hard coverage grows map by map without blocking anything (§7.7).
- **Same learning machinery.** Same modes, same scheduler. Whether Hard mode also tightens the rules (stricter map-click tolerance, shorter flash times) is an open question (§12c); the default is content only.

---

## 5. Product and UX

### 5.1 Screens

| Screen | Purpose | Key content |
|---|---|---|
| **Home** | Pick a map, or resume in one click | The **map picker**: every supported map visible at once as a grid of cards, each with mastery bar and due count, unbuilt maps dimmed; primary "Start session" button; "Continue" |
| **Map** | One map's overview | Map with mastery overlay; zone tabs; the selected zone's callouts as a compact paged list; Hard mode toggle; "Study" and "Quiz this map"; "Weakest first" |
| **Study** | Look first, quiz later | Map ↔ zone-paged callout list ↔ one large screenshot with a thumbnail strip, all linked |
| **Session** | The core loop | Card, answer surface, progress, reveal. Chrome-free, focus layout |
| **Summary** | Close the loop | Accuracy, slowest, new confusions, before/after overlay |
| **Progress** | The long view | One-screen small multiples: mastery per map, top confusion pairs, speed trend, and a compact review heat-grid |
| **Settings** | Preferences, data | Tabbed so it never scrolls: session, Hard mode default, naming, keyboard map, **export / import / reset** |
| **Editor** *(dev-only)* | Author callout data | See §8.3. Not shipped in production builds |

### 5.2 Information architecture and routing

Flat and shallow. Three levels at most: `Home → Map → Study/Session`. URLs reflect state (`/m/mirage`, `/m/mirage/study`, `/session`) so reloads and back/forward behave.

### 5.3 The one-viewport rule (no scrolling)

Dan's requirement: **nothing scrolls**. Every screen fits entirely in the window, on desktop and on a phone.

1. **Fixed-viewport shell.** The app shell is sized to the viewport (`100dvh`) with a grid layout. The page does not scroll, and neither do panels, lists, menus or dialogs inside it: no vertical or horizontal scrollbars in the main UI. The dev-only Editor (§8.3) is exempt.
2. **Pan and zoom is not scrolling.** The map is a viewport onto a larger drawing. It always starts fit-to-frame, and moving or zooming it is the expected interaction.
3. **Long things are chunked, not scrolled.** The tools:
   - tabs and segmented controls (zones are tabs, so a map's roughly 50 callouts are never one long list);
   - paging with previous/next and a position indicator (2 / 3);
   - the map itself as the index: select regions on it instead of choosing from a list;
   - a type-to-find field showing at most five results;
   - grids that adapt their column count to the available space;
   - screenshots shown as one large frame plus a thumbnail strip that fits, never a vertical gallery.
4. **Content is bounded by validation.** Callout names ≤ 28 characters, blurbs ≤ 120, at most 4 neighbours and 5 aliases displayed. The data validator (§7.7) rejects anything longer, so no card can overflow. Type uses a clamped scale and screenshots use `object-fit: contain` inside a flexible frame with a reserved aspect ratio.
5. **Home shows the whole picker at once.** All supported maps (seven now, up to nine later) appear as an adaptive grid. No carousel and no "load more".
6. **Session screens are single frames.** Prompt, answer area and progress share one screen. Multiple choice is a vertical list of four rows (the first idea was a 2 × 2 grid; rows hold a 28-character name on one line and echo the terminal look). Typed answers show at most five suggestions in a popover that opens downward, or upward over the screenshot when the soft keyboard leaves only about 340 px (tested at 360 × 340). The reveal replaces the prompt in place; it never pushes the page down.
7. **Small screens.** Designed from 360 × 640 portrait upward. Map and controls stack; secondary panels are bottom sheets with a fixed height that page their content instead of scrolling inside. Landscape phones (wider than 4:3, up to about 520 px tall) use the desktop layout, compressed, and are now part of the gate at 640 × 360 and 844 × 390. The phone layout is chosen by aspect ratio (4:3 or narrower, up to 820 px wide), not by width alone.
8. **The one exception: accessibility fallback.** If the window is below the supported minimum (1024 × 600 on desktop, 360 × 640 on phones), or the user has raised text size beyond about 200 %, the shell switches to a scrolling layout rather than clip or hide content. Hiding content to keep the rule would be worse than scrolling, and zoom users need reflow.
9. **Automated gate.** Playwright visits every screen and state (reveal, summary, Hard mode, the map with the longest names, Nuke with its level switcher) at a viewport matrix (1920 × 1080, 1366 × 768, 1280 × 720, 1024 × 600, 768 × 1024, 390 × 844, 360 × 640) and fails if any element overflows or the document is taller than the window (§7.7). Until Playwright is set up, `design/fit_check.py` does this for the comps (§6.8).
10. **Design consequence.** Every screen is designed first at the two tightest sizes, 1280 × 720 and 360 × 640, with real content (§6.6). "Dense but calm" (§6.2) is a requirement here, not a style.

### 5.4 Interaction principles

- **Keyboard-first**, mouse and touch equal. In sessions: `1–4` choose, `Enter` submit typed answer, `Space` continue, `H` hint, `S` skip, `Esc` leave session. Map: scroll/pinch to zoom, drag to pan, `+/-`, arrow keys to move focus between regions. *Built so far (2026-11-02):* in the typed field the letters belong to the answer, so hint and skip are `Alt+H` and `Alt+S` there; `Enter` also continues from a reveal, and a reveal ignores the continue key for its first 0.3 s so a double press cannot skip it unread; `Esc` ends the session at once (everything answered is already saved); pin and Where am I? regions are focusable buttons named after their callout (`Tab`, then `Enter`), which is the keyboard route; the map zooms with the wheel, the `+` and `-` buttons and keys, and pans by dragging. Pinch, arrow-key movement between regions and the minimap are not built.
- **The map is a component with one job**, used in every screen (study, pin-it, where-am-I, mastery view), always the same visual language and interaction model.
- **Answer immediately on input.** No "Confirm" button for multiple choice and map-click.
- **No modal interruptions.** No tutorials, no nag screens. First run is: pick a map (or accept the suggestion) → first intro card.
- **Never lose work.** Autosave every answer.
- **Touch:** targets ≥ 44 px on phones. One measured exception: on the Map screen the tabs, list rows and secondary buttons are 40–44 px tall, because 44 everywhere would take about 20 px from a map that is already about 224 px tall (all are far above the WCAG 2.2 AA floor of 24 px). Map regions below 44 px get a tap-to-zoom assist, not a tiny target.

### 5.5 First-run experience

1. Landing on Home shows the map picker with a recommended "start here" marker. No sign-up, no explanation wall.
2. A skippable one-screen primer (§4.11): what a callout is, T and CT spawns, A and B sites, how to read the radar.
3. The first session is a short guided one (4 Core callouts along the route from a spawn to a site), so the loop is understood by doing it.

### 5.6 Responsive and performance

- Desktop-first (that is where CS2 players are), fully usable on a phone: waiting in queue is a prime study moment. Both obey the one-viewport rule (§5.3).
- Budgets: initial JS ≤ 150 KB gzip, first interactive ≤ 1.5 s on a mid-range phone over 4G for Home; next screenshot **preloaded** so the next card appears instantly; map pack for a map lazily cached on first open.
- Installable PWA with **offline** after first map pack download. Service worker caches per-map packs (≤ 10 MB each target).

### 5.7 Accessibility

WCAG 2.2 AA target. Visible focus states; colour is never the only signal; respects `prefers-reduced-motion`; one dark theme, checked to AA contrast; screenshots carry descriptive alt text (generated from `blurb`); the map has an accessible list alternative; text scales without breaking layouts. An accessibility review is a Phase 2 exit criterion. **A Phase 0 pass on the comps is done** (`design/A11Y.md`, rerun with `design/a11y_check.py`): every text pair is at least 4.5:1 and every outline at least 3:1, targets and text sizes are measured, markup roles and live regions are in place, and the document lists the keyboard and ARIA patterns the build must follow.

### 5.8 Settings worth having

Session length, new callouts per session, **Hard mode** (per map), naming convention (both by default; community-only or game-names-only available), sound on/off (off by default), reduced motion override, data export/import, reset progress for a map. No theme setting: dark only. Settings are split into tabs so the screen never scrolls (§5.3).

---

## 6. Visual design direction

The brief: **it should not look vibe-coded.** That is a concrete, checkable standard, not a mood.

### 6.1 What "vibe-coded" looks like (the banned list)

- Purple/blue gradients, gradient text, glow-and-glass cards, blurred blobs.
- Everything is a rounded-2xl card with a soft shadow, cards nested in cards.
- A hero with three feature tiles; centred everything; huge empty padding; anything that needs scrolling to be understood.
- Inter/system sans everywhere; default component-library look (unstyled shadcn, Material, Chakra).
- Emoji as icons; stock icon-set spam on every label; confetti and streak fire.
- Lorem-ipsum-grade copy: "Welcome back 👋", "Unlock your potential".
- Fake stats and placeholder charts.

### 6.2 The direction: *terminal*

Dan chose direction C ("terminal") over A ("survey sheet") and B ("broadcast overlay") after seeing all three built on the same reveal screen (§6.8, `design/MOODBOARD.md`). The identity comes from tools people use all day for one job and keep quiet: a typing test, a puzzle board, a terminal.

- **One face, six colours.** One monospace face for everything. Six core colours: `bg`, `surface`, `sub`, `text`, `main`, `error`.
- **Structure from space, not frames.** Flat surfaces and spacing do the grouping. Hairlines appear only where a divider is needed. No card shadows and no outlines around media.
- **Hierarchy from size, weight and one accent.** The answer is large and set in the accent, and everything around it is small and muted. That is how the screenshot and the map stay the heroes in a system with no decoration.
- **Lowercase and literal.** Labels are lowercase and plain. Key hints are written inline in brackets (`[space] continue`), the selected row carries a `>` marker, and the wordmark is `callouts_`. This punctuation is decorative and has empty alt text, so screen readers skip it.
- **Colour has jobs.** The accent (chartreuse) marks primary action, "correct" and mastery. The error colour marks a wrong answer and always appears with an icon or strike-through. CT blue and T amber are defined for sides only and are not used by the comps yet. Mastery states use a sequential ramp, with hatching and dots as a second channel for the two lowest states.
- **One theme: dark.** Near-black with a slight warmth, never pure black, and text never pure white. Dark-only is a deliberate saving: every colour is tuned once against the map art.

### 6.3 Typography (settled in the design spike: IBM Plex Mono only)

- **One family: IBM Plex Mono** at 400, 500 and 600, with Cascadia Mono and Consolas as fallbacks. It covers names, numerals, captions, key hints and prose.
- **Scale:** 11 / 12 / 13 / 16 px for interface text, 26 px for section headings, 44 px for a map title, and a clamped 30–46 px for the answer. On phones the smallest text is 11 px in cards and 10 px in the map legend.
- **Mono prose** is fine because blurbs are capped at 120 characters (§5.3). Revisit if longer text appears.
- **Self-hosting:** one open-licence family means one set of font files to download instead of three. The comps load it from Google Fonts for now; self-hosting for the offline PWA needs Dan's OK.

### 6.4 Map art style

One cartographic language across all maps: flat, high-contrast walkable silhouette; a single outline around the outside; regions as flat tint fields; labels in lowercase mono with a dark halo so they stay legible over any fill; level and height shown with hatching, not gradients; consistent north/orientation with the game's radar. Think topographic sheet or transit diagram, not a game-asset render. Screenshots are shown flat with no frame, under a one-line mono caption giving camera position and facing.

### 6.5 Motion, sound, feedback

- Motion is functional and rare. State changes (hover, press) shift colour only, in 90 ms, with no movement. The one longer motion is the reveal: the screen swaps at once, then the guess-to-truth line draws and the truth region fades in over 400 ms, ease-out. Cards swap instantly (the next screenshot is preloaded, so nothing flashes); there is no slide. No bounce, no parallax. `prefers-reduced-motion` sets every duration to 0 and stops the caret blink.
- Sound optional, off by default. If on: short, dry, mechanical ticks. **No Valve audio.**
- Haptics on mobile for correct/incorrect (subtle).
- Mastery changes are shown on the map, not with toasts.

### 6.6 Design process (so it actually ends up human-made)

1. **Gather references before opening a code editor.** Build a moodboard from the list in §6.7. Pick three directions, kill two, with reasons written down.
2. **Design three hi-fi static screens first** (Home with the map picker, Session reveal, Map with mastery overlay) in the dark theme at the two tightest viewports (1280 × 720 and 360 × 640), before any component code. The look, and the no-scroll rule (§5.3), are settled on these.
3. **Tokens first:** colour, type scale, spacing, borders, motion in CSS custom properties. **Hand-written CSS** with a small set of primitives. No utility-class framework, no component library. The map and answer surfaces are custom anyway.
4. **Real content in every mock.** Real callout names, real screenshots, real numbers.
5. **Critique pass per phase** against the banned list in §6.1 and an accessibility check.

### 6.7 Where to look (human-made references)

**UI that already solves similar problems:**

| Reference | What to steal (the idea, not the pixels) |
|---|---|
| **Seterra** (map quizzes) | Click-the-region flow, immediate state feedback, error counting. Weakness to avoid: dated chrome and ads. |
| **GeoGuessr** | The guess-reveal moment: line to the truth, distance. Basis of "Where am I?". |
| **Lichess** (puzzles and analysis) | The board is the hero; quiet chrome; instant feedback; no nonsense. |
| **Monkeytype** | Keyboard-first; theming as a feature; dense, typographic, fast; instant restart. |
| **Anki / Mochi** | What spaced repetition needs, and where it gets ugly or heavy (what to simplify). |
| **Duolingo** | Session structure and progress bar. **Avoid** the gamification gloss. |
| **CS2's own UI** | Radar, scoreboard, spectator overlay, map-selection cards, loading screens. The native visual language of the subject. |
| **CS demo viewers and 2D replayers** (Leetify, CS Demo Manager) | How the community renders radars and player cones. |

**Print and cartography (human-made, long-tested):**

- US National Park Service *Unigrid* system (Massimo Vignelli): modular grid, strict typography, maps as first-class content.
- Swiss federal topographic maps (swisstopo): clarity at density, label haloes, hatching.
- Harry Beck's London Underground diagram: abstraction that serves wayfinding. Informs simplified region shapes.
- Military field-manual map-reading diagrams: how to annotate bearings and positions.

**Game and product UI collections:** [Game UI Database](https://www.gameuidatabase.com/about.php) (large searchable library of game interface screenshots, filterable by HUD, map, menu, colour); [Interface In Game](https://interfaceingame.com) (games' interfaces by genre and element).

**Finding human-made UI and snippets (general knowledge, not verified in this research):** Mobbin and Refero (real shipped product flows), Godly, Siteinspire, Land-book and Awwwards (curated site design), Savee and Are.na (moodboards), CodePen/Codrops (interaction experiments; useful for single interactions, not whole layouts), Dribbble/Behance (visual ideas only; they are unconstrained by real data, so check against §6.1).

Rule for using any of these: write down the *principle* taken ("dense label placement with halo, from swisstopo"), not "make it like X".

### 6.8 Phase 0 design spike result (2026-10-28, extended 2026-11-01)

Process and reasoning are in `design/MOODBOARD.md`; the accessibility pass is in `design/A11Y.md`. Everything is in `design/`: the styles (`tokens.css`, `base.css`, `screens.css`, `screens2.css`), the generators (`build.py`, `build2.py`), the comps, the three-way comparison (`directions.html`), the runners `fit_check.py` and `a11y_check.py`, renders in `design/renders/`, and direction A's styles and renders in `design/archive-a/`. The comps are Home (map picker), Session (the reveal), Map, the question (multiple choice, and typed with suggestions), Pin it (asking and revealed), the Hard-mode Map, and a component states sheet. Six of them also have a `-stress` twin with every name at the 28-character limit and every blurb at 120.

- **Direction: C, "terminal", chosen and confirmed by Dan.** I looked at Lichess, Monkeytype, Seterra and CS2's own HUD, and built the same reveal screen in three directions (A survey sheet, B broadcast overlay, C terminal). My own comparison favoured A, because C risked leaving the screenshot and map small and everything at one visual weight. Dan preferred C. Those two risks were designed against: the screenshot is about 750 px wide at 1280×720 (about 840 px on the question screen), and hierarchy comes from size, weight and the one accent. B was dropped because its name plate covers the screenshot and it duplicates the game's own UI. A is archived.
- **Tokens.** Six core colours: `bg #1c1d1f`, `surface #242629`, `sub #9a9da1`, `text #d1d0c5`, `main #c8e04a`, `error #e0705f`, plus state tokens (hover, pressed, correct and wrong rows, two durations). Muted text changed twice: `#6c6e72` was only 3.3:1 (comparison sheet), then `#93969a` measured 4.49:1 on the hover surface used by the suggestion list, so it is now `#9a9da1` (6.2:1 on the page, 4.9:1 on the hover surface). Control outlines use `#6f7378` (3.5:1).
- **Real content throughout:** Valve's own thumbnails, our captured screenshot, and map art generated from the decoded nav mesh. Callout names, blurbs, regions, Hard spots and mastery states are placeholders for layout work; regions are a nearest-anchor split of the real walkable surface.
- **Map art works.** One SVG path per region gives seamless fills, an outline stroked once behind the fills gives the outer wall, region boundaries come from edges shared between regions, and labels carry a dark halo. Stroking a region path also draws its internal triangle edges, so the selected outline is an SVG filter, with a dark band on both sides of the lime line (a plain lime ring failed 3:1 against a Known region). Hard spots are inlays: a disc snapped to a nav polygon of the parent region, clipped to that region and outlined, dashed while the spot is New (a stand-in for the polygon union the Editor will paint). Clip-path ids must be unique per SVG; two views sharing ids silently broke the clipping.
- **States and motion are designed** (`states.html`): hover, pressed, focus, disabled and selected for buttons, answer options, tabs, rows, fields, switches and map regions. Hover and pressed shift colour only; focus is a 2 px lime ring (dashed on map regions); correct and wrong rows carry a mark, a left bar and, for wrong, a strike-through, never colour alone. The reveal motion is in §6.5.
- **The question, the typed question, Pin it and the Hard map** follow the same grid rules. Pin it has no confirm step (SCOPE §5.4); the reveal draws the guess-to-truth line and says how many regions away the guess was (computed from the region adjacency graph). The Hard map shows the middle zone zoomed on desktop and the selected spot zoomed on a phone, with zoom buttons (and a minimap on desktop), and its list pages never split a callout from its Hard spots.
- **The one-viewport rule holds on the comps, with a stricter gate.** 15 pages across the seven viewports of §5.3 plus two landscape phones (640×360, 844×390), and 360×340 for the typed question (a phone with the keyboard open): **132 of 132 checks pass**, with nothing overflowing the viewport and no element spilling out of its own box. The spill check was added after the first gate passed a Map list that overlapped the buttons below it, because nothing had left the viewport. Bugs the gate and renders caught: single-column grids that grew to fit `nowrap` text (fixed with `minmax(0, 1fr)` columns), a suggestion popover anchored to a stretched wrapper, the top bar too wide on narrow phones, 28-character answers overflowing a narrow column (the answer now scales to fit and wraps below 13 px), and the landscape Map list overlapping its buttons. Tool notes: headless Edge cannot go below about 492 px wide, so each comp is rendered in an `<iframe>` of the exact size; four Edge instances run in parallel (about 90 s for the whole matrix), with one retry for the occasional empty result.
- **Long content fits.** At 28-character names and 120-character blurbs: list rows ellipsize, the answer scales to its column, phones show two neighbour chips, and phones label only the selected map region (labels of 28 characters collide otherwise; the app will need real label collision handling).
- **Accessibility pass done on the comps** (`design/A11Y.md`): 0 contrast failures, 0 structure issues; all phone targets are at least 44 px except the Map screen's 40–44 px (§5.4).
- **Not yet designed:** the Study, Summary, Progress and Settings screens, the first-run primer (a Phase 1–2 build, using these components) and, built in Phase 1 without a comp so the session loop works end to end, the intro card (the reveal layout with no answer to judge), the Read the map, Which view? and Where am I? screens (the Name it and Pin it layouts rearranged) and the end-of-session summary (a plain stand-in for the Summary screen), the Editor (dev-only), the scrolling fallback for windows below the supported minimum, and real hit-testing and label collision on the map.
- **Status:** done. The font loads from Google Fonts for the spike; the build bundles it instead (ADR 0001).

---

## 7. Technical architecture

### 7.1 Shape of the system

**Static, local-first single-page app.** No backend in v1. Content is shipped as versioned data + media; user progress lives in the browser; it can be hosted on any static host or just run from `npm run preview`.

```
 ┌────────────────────────────── build time (dev machine) ──────────────────────────────┐
 │  CS2 install ──► extract (Source 2 Viewer CLI)  radar + overview + nav + map data     │
 │                ──► capture (console script)     screenshots                           │
 │                ──► process (sharp, potrace)     AVIF/WebP, SVG base maps              │
 │  curation  ──► Callout Editor ──► data/*.json (validated by schema in CI)             │
 └──────────────────────────────────────────────────────┬────────────────────────────────┘
                                                         ▼
 ┌─────────────────────────────── runtime (browser) ─────────────────────────────────────┐
 │  Static data + map packs ──► app (UI, map component, quiz engine, scheduler)          │
 │  IndexedDB: review log (events) ──► derived FSRS state, mastery, confusions           │
 │  Service worker: offline + per-map pack caching                                       │
 └───────────────────────────────────────────────────────────────────────────────────────┘
```

### 7.2 Stack (decided: ADR 0001, `docs/adr/0001-stack.md`)

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript (strict) | Data-heavy app; schemas and scheduler benefit from types |
| UI framework | **Svelte 5 + Vite** (SPA, static output) | Scoped hand-written CSS is a first-class citizen (supports §6.6); small runtime; good for an interaction-heavy map |
| Styling | Plain CSS + custom properties (design tokens). No Tailwind, no component library | Avoids the template look by construction |
| Map rendering | Inline **SVG** (regions, labels, camera cones) over an SVG/raster base; custom pointer-event pan/zoom | ≤ ~60 regions per level; DOM hit-testing, accessibility, and CSS state styling for free |
| Scheduler | `ts-fsrs` (MIT) | Proven open implementation of FSRS; optimiser for later |
| Storage | IndexedDB (via `idb`), `navigator.storage.persist()` requested | Reliable local persistence; export/import JSON for backup |
| Validation | `zod` schemas for all data, run in CI | Data bugs are the main quality risk |
| Offline | Service worker (Workbox or hand-rolled), per-map cache packs | Offline study; predictable cache sizes |
| Image processing | `sharp` (AVIF/WebP) in the build; extraction, nav decode and capture stay in Python (`content-tools/`) | Scriptable asset pipeline. potrace is not needed: map art comes from the nav mesh (§6.8) |
| Tests | Vitest (logic), Playwright (flows + visual regression on map rendering) | See §7.7 |
| Package manager / runtime | pnpm, current Node LTS | **Installed 2026-11-01 with Dan's go-ahead:** Node 26.13.0 (LTS) from winget, pnpm 12.16.1 from npm. Versions of every package are in `app/package.json` and `app/pnpm-lock.yaml` |
| Fonts | `@fontsource/ibm-plex-mono` (bundled woff2, SIL OFL) | Self-hosted for the offline app; replaces the Google Fonts link used by the comps |

**Decided in Phase 0 (2026-10-28): Svelte 5 + Vite + TypeScript, no SvelteKit.** The ADR records the options (React, Preact + htm, plain modules) and the three rules that limit the risk: framework-free core logic under `app/src/core/`, runes only, and porting the `design/` comps rather than restyling them. Revisit only for the reasons listed in the ADR.

### 7.3 Repository layout (proposed)

```
/app            Svelte app (routes, components, map, quiz engine, scheduler glue)
/data           maps/*.json, callouts/*.json, schemas, CHANGELOG-content.md
/content-tools  extract, capture, process, validate (spike code is Python; see the §10 spike log)
/editor         dev-only callout editor
/assets         generated media. GITIGNORED (see §9), built from the user's own CS2 install
/design         moodboard, tokens, static comps, decision log
/docs           SCOPE.md, ADRs
```

### 7.4 Where callout data comes from (and what to verify first)

Evidence from research, with the unverified bits marked.

- **Radar images and overview data** ship in the game's depot. Source 2 Viewer (free, open source) can browse the VPKs and export them, but it is not required: a short Python reader of the archive index is enough (confirmed 2026-10-28, §8.4). Radars are at `panorama/images/overheadmaps/<map>_radar_psd.vtex_c` and overview text at `resource/overviews/<map>.txt`. Official maps carry an overview text file with the projection values (`pos_x`, `pos_y`, `scale`; multi-floor maps have vertical-section data). A community-run repository ([cs2-map-icons](https://github.com/MurkyYT/cs2-map-icons)) mirrors radars and overview text, auto-updated when Valve patches. **Use it as a cross-check, not as the source of truth**, and note the files are Valve's property.
- **Callout names live in the nav mesh.** The game's navigation meshes carry a *place name* per area (the same names that appear in text radio like "Enemy spotted in …"). The NAV format has a place-name directory, with each nav area pointing to one. Parsers exist (awpy's `Nav` class; `csgonavparse` in Go). Demo parsers expose the same strings per player tick as `last_place_name`.
  - **Checked in Phase 0 (2026-10-28):** (a) the nav data is `maps/<map>.nav` inside each map's own archive (`maps/<map>.vpk`), readable with the same Python reader; (b) it is **version 36**, a Source 2 layout that does not follow the documented CS:GO structure, and it holds **no place-name strings**, only generation settings; (c) the names come from a global list, `navplace.db` (277 names, one per line), with English display text in `resource/csgo_english.txt` (266 of them); (d) a time-boxed decode **recovered the full walkable geometry** (vertex pool and 2,000–3,900 triangle/quad areas per map; layout in `content-tools/spike/NAV_FORMAT.md`), but **which place each area carries is not decoded**. I did not test awpy (installing it would be a download).
  - **Fallback if the nav data can't be read:** derive place names from a demo using `last_place_name` samples joined to positions, then build regions by clustering sampled points (rougher polygons, hand-refined in the Editor).
- **Status:** geometry decoded and validated; place ids not decoded. The chosen route is not to decode them but to ask the game for each painted region's place name (§8.3, §10 spike log).
- **The payoff, even without place ids:** every callout region can be a union of real nav areas, so click regions follow the true walkable surface exactly. Authoring becomes "paint the mesh and name it" (§8.3), not "draw everything". Place ids, if decoded later, would only pre-fill that painting.
- **Community callouts still need human curation** (§3.3): nav names are Valve's labels, not necessarily what players say, and the nav set can be coarser or finer than community naming.

### 7.5 Projection math

Standard Source overview convention, **verified in Phase 0** against 29–39 known positions per map (§8.4):

```
pixel_x = (world_x − pos_x) / scale
pixel_y = (pos_y − world_y) / scale      // y is flipped
```

`pos_x, pos_y` is the world coordinate of the radar image's top-left corner; `scale` is world units per pixel on the (typically 1024 px) square radar. Multi-floor maps pick the level by comparing `world_z` to the altitude cutoffs. The overview's `rotate` flag (Dust II sets it to 1) does not change this mapping for the extracted radar images.

The same function is used to: place regions and labels; draw the camera cone for a screenshot from `(pos, yaw)`; hit-test clicks (inverse); and validate that every stored coordinate lies inside the radar bounds.

### 7.6 State and data flow

- Data and media are **immutable per version** and loaded per map.
- **Review log** (append-only IndexedDB store): `{ itemId, mode, ts, correct, latencyMs, hint, rating, chosen }`.
- **Derived state**: FSRS card state per item, mastery state per callout, confusion counts. Rebuildable from the log at any time (also what powers "import backup").
- **Session builder** is a pure function: `(state, settings, scope, now) → ordered cards`. Unit-tested with fixed clocks and seeds.
- **Quiz engine** is separate from the UI so modes are small, testable plug-ins: `makePrompt(item) → prompt`, `grade(prompt, input) → outcome`.
- **Built (2026-11-02):** `core/quiz.ts` is that engine (`makePrompt`, `gradeAnswer`, `answerEventFor`), `core/runner.ts` walks a planned session card by card, and `storage/idb-store.ts` keeps the log in IndexedDB (database `callouts`, one object store of events keyed by id; the synthetic development map uses `callouts-demo`). Every answer is written as it happens through a queue (`core/store.ts`) that keeps events when a write fails and says so on screen; if the browser refuses storage, the session runs from memory and says that its progress is not being saved. Stored rows that no longer match the schema are counted and left in place, never deleted.
- **Export/import**: one JSON file of the log + settings. Import merges by event ID.

### 7.7 Testing and quality gates

| Layer | What | Tool |
|---|---|---|
| Scheduler and session builder | Intervals sane; new-card cap honoured; due ordering; clock-injected | Vitest |
| Answer matching | Aliases, typos, edge cases, near-collisions between callout names | Vitest + table tests |
| Projection | Round-trip world ↔ pixel; known landmarks land in the right place | Vitest |
| Data validation | Schema; unique IDs; aliases don't collide within a map; polygons valid, non-self-intersecting, inside bounds; every callout meets shot minimums; every shot has camera metadata; name and blurb length limits (§5.3) | CI script (zod + custom) |
| Flows | Start session → answer → reveal → summary; offline; export/import | Playwright |
| Viewport fit | No screen scrolls or overflows at any viewport in the matrix (§5.3) | Playwright |
| Visual | Map rendering per map/level/state | Playwright screenshots |
| Accessibility | Axe checks + manual keyboard and screen-reader pass | Playwright + manual |

**Built (2026-11-01):** the validation row is `pnpm content:validate` (full report, `--strict` fails on warnings) and the same check runs inside `pnpm test`; the scheduler, session builder, matching, projection and data rows are Vitest suites in `app/src/core/`; with the quiz engine, runner, store and map-view suites added on 2026-11-02 there are 212 unit tests. **Flows and viewport fit (2026-11-02):** `app/e2e/` drives the installed Edge through the synthetic map (`pnpm build --mode e2e` includes it; the normal build does not): a first session end to end, saving and carrying on after a reload, answering by click, key and typing, hints, skips, `Esc`, every one of the six modes with a seeded history (typed suggestions and the one-typo accept included), and the no-scroll, no-overflow, no-clipping check on every screen of that session at nine viewports (1920×1080, 1366×768, 1280×720, 1024×600, 768×1024, 390×844, 360×640, 844×390, 640×360) plus 360×340 for the typed question with the keyboard open: 27 tests. A test hook (`window.__callouts`, development and e2e builds only) lets a test read what is on screen. Visual-regression and accessibility rows are not built yet.

**Content QA is a first-class gate:** a map cannot be marked `verified` until every Tier 1 and 2 callout passes the data checks *and* Dan has walked it in-game against the list. Tier 3 (Hard) callouts can ship as `draft` and stay hidden from Hard mode until verified, so Hard content lands map by map.

### 7.8 Build, hosting, versioning

- `pnpm dev` / `pnpm build` / `pnpm preview`. Content tools are separate scripts (`pnpm content:extract`, `content:capture`, `content:process`, `content:validate`).
- Delivery is **local only** (decided): it runs on Dan's machine through `pnpm preview`, optionally installed as a PWA. It stays a static build, so hosting would be possible later, but public hosting is not planned (§9).
- **Content versioning:** each map has a `revision` and `gameBuild`. When Valve patches a map, the pipeline diffs radar hash and nav place names and flags affected callouts and screenshots as `stale`. Progress is keyed on stable callout IDs, so a map revision doesn't wipe your memory state; deleted callouts are archived, renamed ones keep the same ID.

---

## 8. Content pipeline and authoring tools

### 8.1 Pipeline per map

1. **Extract** radar, overview (projection, levels), nav place names, map thumbnail from the user's local CS2 install.
2. **Seed** callout candidates from nav place names; merge with community names; produce a draft list.
3. **Curate** the list (names, aliases, tiers, zones, neighbours, blurbs) in the Editor.
4. **Define regions** by painting decoded nav areas into named regions in the Editor (hand-drawn polygons only for anything the mesh misses).
5. **Plan shots:** the Editor proposes camera positions (approach/inside) from region geometry; Dan adjusts in-game and records the final.
6. **Capture** (§8.2).
7. **Process** to AVIF/WebP, build the SVG base map, write the map pack.
8. **Validate** (CI script) → **review in-game** → mark `verified`.

### 8.2 Screenshot capture (Phase 0 spike: works)

Goal: capture hundreds of shots deterministically from a manifest of `{ id, pos, yaw, pitch, stance }`.

- **Plan A, scripted in-game capture: verified, in a different form.** The method that works is a driver that talks to a running game over its local console port and grabs the screen (see the result below). The config-file version of Plan A as first written does **not** work, because CS2 has no `wait` command and runs a startup config in a single instant.
- **Plan B, semi-automatic:** the same manifest drives a key-bound alias chain: press one key, the game moves to the next position; a tiny helper takes the screenshot and names the file from the manifest.
- **Plan C, manual with a shot list:** the Editor exports a checklist with coordinates to paste; capture is by hand. Slowest, always works.
- **Plan D, offline renderer:** render views directly from the exported map geometry. High effort; only if A–C fail. (Also a possible route to higher-quality overhead art.)

All plans write the same metadata, so the app doesn't care which was used.

#### Capture spike result (2026-10-28)

Ten Mirage positions plus three experiment shots were captured automatically: **13 of 13 saved, all 1920×1080, with the HUD, weapon and crosshair hidden.** I checked six by eye (the clean and HUD-on versions of the first pose, market, underpass, palace, short/cat). In the HUD-on baseline the game's own location label under the radar read "Connector", which matches Valve's label for that position, so the game itself confirms the camera pose. Code is in `content-tools/spike/` (`capture_run.py`, `capture_screen.ps1`, `netcon.py`, `make_capture_cfg.py`) and the output is in `assets/valve/capture/run1/`.

**What works**

- **Launch:** `-applaunch 730 -insecure -novid -fullscreen -w 1920 -h 1080 -netconport <port> -netconpassword <random> +map de_mirage`.
- **Console commands, all verified:** `sv_cheats 1`, `bot_kick`, `mp_freezetime 0`, `noclip 1`, `cl_drawhud 0`, `r_drawviewmodel 0`, `setpos_exact x y z`, `setang_exact pitch yaw 0`. The port speaks a simple text protocol: `PASS <password>`, then one command per line, and it returns each command's output.
- **Per shot:** teleport and aim, wait 1.4 s for the frame to settle, then capture. The capture takes about 1 s, so about 2.5 s per shot, and roughly 1,400 shots would take about an hour.
- **Capture:** a PowerShell script copies the screen at the native 1920×1080 and **refuses to capture unless CS2 is the foreground window**.
- **Heights:** set the player origin to the eye position minus 64 (§8.4).
- **Metadata:** exact camera position and angles come for free, since the driver set them.
- **Shutdown:** `quit` over the port closes the game cleanly in about 4 s.

**What does not work (do not retry)**

- A startup config (`+exec`): there is no `wait` command, so the engine ran `map` and then `quit` in the same instant and discarded the load. It also left the game process hung in shutdown.
- The `screenshot [filename]` command is accepted but writes no file anywhere I could find. `jpeg` is an unknown command, even though F5 is bound to it.
- Console output is not written to `console.log` (`-condebug`), so command replies are only visible through the console port.

**Side effects and safety**

- The console port listens on **all network interfaces**, protected only by its password (an unauthenticated connection is refused with "Must send PASS command"). Use a fresh random password each time, keep sessions short, and quit the game when done. It is not something to leave running.
- The test launches rewrote the saved video settings. The file now reads fullscreen 1920×1080 at 120 Hz with `nowindowborder` set to 1. The earlier value of that last flag is unknown, so check Settings → Video. A backup of the post-test file is in `content-tools/spike/cfg/`.
- The tooling needs any running CS2 closed first. The spike closed Dan's session with their OK. The temporary configs placed in the game's `cfg` folder were removed afterwards.

**Still to do:** a per-map pass for stray on-screen elements, picking a shot-batching scheme, and the PNG to AVIF conversion in the process step.

### 8.3 The Callout Editor (dev-only)

A small internal tool, in the same repo, built on the same map component. Without it, curating ~250 callouts is a spreadsheet slog; with it, it's a pleasant afternoon per map.

- Load a map; see the radar, the decoded nav mesh (about 2,000–4,000 areas per map, with neighbours derived from shared edges) and existing regions.
- Paint nav areas into named regions (brush, flood fill across connected areas, subtract), then name them and set aliases, tier, zone, neighbours. Hand-drawn polygons stay available.
- Place camera markers with heading cones; preview which regions a shot "contains".
- Live validation panel (the CI checks, in the UI).
- **Ask the game:** for each painted region, teleport the game camera to the region's centre (the capture driver already does this) and read the place label under the radar with Windows' built-in OCR (`content-tools/spike/place_ocr.py`), to pre-fill `gameplaceName`. About 50 regions per map, about two minutes of game time per map. It needs CS2 running at the screen's foreground, so it is run on request.
- Reads/writes the JSON in `/data`. Not part of the production bundle.

**Built (2026-11-02).** It lives in `app/src/editor/` (screens) and `app/src/core/editor/` (logic, tested), not in a top-level `/editor` folder as §7.3 sketched, because it shares the core, the map maths and the Vite setup with the app. Open it with `pnpm dev`, then `http://localhost:5173/#/editor/de_mirage`. The file access is a Vite dev-server plugin (`app/tools/editor-plugin.ts`, `apply: 'serve'`), so a production build has no way to reach `/data` or `/assets`: checked, the production bundle contains no editor code.
- *Mesh and radar.* The decoded nav mesh is drawn from `assets/valve/nav/<map>.json` over the radar. Adjacency is T-junction-aware (the mesh meets itself along partial edges: exact shared edges leave Mirage in 155 islands, overlap-along-an-edge leaves one island of 2,085 of 2,544 areas), which is what flood fill and neighbour suggestions use.
- *Tools.* Select, Paint (round brush, radius with `[` and `]`), Erase, Fill (bounded by a radius and by areas another callout owns, unless "overwrite others" is on), Polygon (hand-drawn region), Label (move the label point), Camera (plan shots). Undo and redo (a paint stroke is one step), wheel zoom up to 40×, space-drag or middle-drag to pan.
- *Regions.* A callout's region is the union of its painted areas as one simple polygon (corners on shared edges are merged, near-straight corners dropped, about 1 unit of tolerance). Holes and loose pieces are left out and the form says how many. A standard callout owns an area exclusively; a Hard spot lies over its parent and only competes with other Hard spots.
- *Callout fields.* Name (28), aliases (5), zone, tier, level, parent (Hard spots), the game's own name, route order, status, blurb (120, with counters), neighbours (at most 4, always linked both ways, suggested from how long the painted edges touch). Zones can be added, renamed, reordered (route order drives intro cards) and removed when empty.
- *Where things are saved.* The content file (`data/callouts/<map>.json`) gets only **finished** callouts (a region and a blurb), with links to unfinished ones left out; everything else the Editor needs lives in `data/editor/<map>.work.json`: every callout including unfinished ones, the painted area ids and the shot plan. Area ids belong to one game build; loading a work file made against another build says so. If the content file was edited by hand since the Editor last wrote it, its callouts win and a notice says so.
- *Shots.* "Propose shots" suggests an inside view along the region's long axis, an approach and an alternate approach from different sides, and an overview for large areas (Hard spots get a close-up and a wider shot), at eye height (nav surface + 60) from places reachable by walking. Markers can be dragged and turned on the map, each lists the regions its view reaches (walls are not considered), and the plan is written to `data/editor/<map>.capture-manifest.json` in the shape `content-tools/spike/capture_run.py` reads. The proposals do not know about walls and the manifest has not been run against the real driver or the game.
- *Checks and saving.* The Check tab shows the content validator's findings for the file that would be written, plus what is left out. Save is refused if the data fails the schemas, if the files changed on disk since they were loaded (etag), or from another origin (`X-Editor` header, localhost only); the previous files are copied to `data/.backups/<map>/` first (the newest 30 are kept) and writes are atomic.
- *Not built:* "Ask the game" (OCR of the place label), seeding callout candidates from place names, creating a new map record from the overview data (only maps that already have a record in `data/maps` open), editing a polygon's corners in place (redraw it), and a radar level picker beyond the level tabs. Tests: 83 unit tests in `app/src/core/editor/` (including the real Mirage mesh when it is on the machine) and 13 browser tests (`pnpm e2e:editor`, against a throw-away copy of the data in the temp folder). The real Mirage mesh was also loaded and painted in the browser (27 areas became a 15-corner outline) without saving.

### 8.4 Screenshot sourcing: what exists online (researched 2026-10-28)

Before committing to capture every screenshot ourselves, I looked for ready-made ones. Short answer: nothing online fits, so the capture pipeline (§8.2) stays the plan.

| Source | What it offers | Why it doesn't solve it |
|---|---|---|
| Callout guides (csdb.gg, bo3.gg, Profilerr, Prima Games, esports.net and similar) | Text lists, radar plots, interactive maps | No first-person screenshot per callout in anything I could read. Images are the sites' own and carry no reuse licence |
| Lineup and utility guides (PC Invasion, Sportskeeda) | In-game screenshots, some credited "Image via Valve" | They show grenade spots, not callouts, and only a few per map |
| Valve's own map thumbnails (shipped in the game files; mirrored on GitHub by cs2-map-icons) | Official 1920×1080 in-game scenes: 4–6 per map, 51 across the ten Premier and FACEIT-candidate maps, 2.3–4.5 MB each. **Now extracted locally (see below)** | Scenic, not per-callout, and Valve's property. Good as map-picker art |
| Steam store page for Counter-Strike 2 | 19 promotional JPGs at 1920×1080 on Valve's CDN | Generic, not map-specific |
| Wikis (Liquipedia, Valve Developer Community, Fandom) | A few map images | Licensing unclear or by-permission; the Valve wiki blocked my fetch; coverage is sparse |
| Datasets (Roboflow, Hugging Face, Kaggle) | Player-detection and cheat-detection frames | Not labelled by place; built for a different task |

Even a perfect find would have three problems. There would be **no camera position or heading**, so no "Where am I?" mode and no stale detection. Game versions would be **mixed**: CS:GO-era shots predate CS2 lighting and several map changes, and Cache is a recent Source 2 rebuild, so almost nothing older is valid. And **framing would be inconsistent** (HUD, players, crosshair).

What we do instead:

1. Capture our own (§8.2), which gives consistent frames and camera metadata for free.
2. Use Valve's thumbnails from the local install as hero art on the map-picker cards. Done; see "Extraction results" below.
3. Use guide sites only to cross-check names, never as image sources.

#### Extraction results (Phase 0, 2026-10-28)

The thumbnails came from Dan's own CS2 install (Steam build 26144732) using a small read-only Python script in `content-tools/spike/`. It needs only the standard library plus numpy. Nothing was downloaded and nothing was written to the game folder.

- **51 PNGs, all 1920×1080**, in `assets/valve/thumbs/` (gitignored, about 162 MB), with a `manifest.json` recording each file's path inside the game archive, size, SHA-256 and the game build.
- **By map:** Ancient 5, Anubis 6, Cache 5, Dust II 4, Inferno 5, Mirage 5, Nuke 5 (35 for Premier); Overpass 6, Train 5, Vertigo 5 (16 for the FACEIT candidates). Night variants are excluded.
- **How they are stored.** Most thumbnails keep their pixels as an embedded PNG, so extraction is slicing it out and verifying every chunk checksum. Two (Ancient #1 and Dust II #3) are raw DXT5 with compressed data and scaled YCoCg colour; they needed a small decoder, and the first attempt had a strong colour cast until the YCoCg step was added.
- **Checked by eye:** Cache (embedded PNG) and the two decoded files. The other 48 were validated only by PNG checksums and dimensions.
- **Cache is the new Source 2 version**, so it matches the current game.

Radars, projection and position data (extracted and checked afterwards, also 2026-10-28):

- **Radars extracted:** 13 images in `assets/valve/radars/` (the ten maps plus lower levels for Nuke, Train and Vertigo), all 1024×1024 with transparency, from `panorama/images/overheadmaps/<map>_radar_psd.vtex_c`. Cache also has a 2048×2048 variant that I did not extract. The radars are clean, flat renderings of the walkable area, which suits the vectorising plan in §3.6.
- **Overview numbers read** for all ten maps and parsed into `assets/valve/overviews/overviews.json` (`pos_x`, `pos_y`, `scale`, altitude cut-offs for multi-level maps, and fractional spawn and bombsite markers). **Mirage is `pos_x −3230, pos_y 1713, scale 5.0`**, the same figures used as the example in §3.2. Scales vary by map (Mirage 5, Dust II 4.4, Vertigo 4, Train 4.082077, Nuke 7).
- **Projection verified.** `pixel_x = (x − pos_x) / scale`, `pixel_y = (pos_y − y) / scale` puts 100 % of Valve's known standing positions on walkable radar pixels for eight maps, and 95–97 % on Ancient and Mirage (one edge-case point each), using 29–39 positions per map. Flipped, swapped and rotated variants score 26–84 %, which is close to chance. Dust II's `rotate=1` flag needs no special handling, and the multi-level maps pick the right radar from the altitude cut-offs.
- **Retake spawn files are a good position source.** `maps/<map>_retake.txt` holds about 25–32 Valve-authored player positions per map with full camera angles (x, y, z, pitch, yaw), usually with a short location comment (Mirage: "palace", "market", "underpass", "top of mid", "t aps"). Useful as seed camera positions for the capture plan, as the projection check above, and as an informal name cross-check. The comments are descriptive rather than an official list, and Nuke, Overpass and Vertigo have none.
- **Valve's annotation files are too small to matter.** `annotations/official/<map>/<map>.txt` holds only about 4–11 grenade lineup spots per map (Vertigo has none), with titles like "Ramp Smoke". Not a source of callout names. This corrects an earlier note in this section.
- **Nav mesh geometry decoded (time-boxed reverse engineering, same day).** `maps/<map>.nav` is a version-36 Source 2 file with no public documentation. Its vertex pool and area polygons are readable: a `u32` vertex count, the (x, y, z) world-space vertices, then a `u32` area count and one triangle or quad per area. The layout is written up in `content-tools/spike/NAV_FORMAT.md` and the results are exported to `assets/valve/nav/<map>.json`. Sizes: Mirage 3,613 vertices and 2,544 areas (1,543 triangles, 1,001 quads), and 2,105–3,938 areas on the other maps.
- **Nav geometry validated.** Valve's known floor positions fall inside a polygon in x/y on every map (Mirage 27/27, Ancient 32/32, Vertigo 29/29, Cache 24/24, Inferno 25/25, Train 25/25, Nuke 27/28, Anubis 26/27, Dust II 26/29, Overpass 24/25), and the triangles tile Mirage's walkable area with no gaps when overlaid on the radar.
- **Eye height.** On most maps the retake positions sit about 60 units above the nav surface, so they are **eye positions** (64-unit eye height, with the nav surface about 4 units above the feet); on Cache and Nuke they are floor positions. This matters for the capture plan in §8.2: convert between eye and origin height before using a position.
- **Place names:** the global list and display text are readable, but the per-area assignment is not decoded. The nav file holds no place strings. Its per-area attribute tables are byte-packed and variable-length, and the map's entity data (chunked-LZ4 KV3) was not decoded; either might carry the assignment (§7.4).

---

## 9. Legal and IP

Not legal advice; a plan for staying on the right side of an obvious risk.

- The game's radars, screenshots and textures are **Valve's property**. The Steam Subscriber Agreement has a fan-content clause that allows use of Valve game content in fan works **on a non-commercial basis**, and requires you to hold rights to any third-party content you add. Valve's community-wiki guidance on mods is similarly non-commercial and is not authoritative. (Secondary reading; read the current SSA and the Counter-Strike terms directly before any public release.)
- **Therefore:**
  1. The app is **personal and local-first (decided), non-commercial, no ads, no payments, no accounts**.
  2. **Valve-owned media is never committed to the repo.** `/assets` is gitignored. The repo ships *tooling and facts* (callout names, coordinates, regions, camera metadata); each user generates the media from their own CS2 install.
  3. If the project is ever hosted publicly, that is a **separate decision** with its own review: hosted screenshots are redistribution of Valve content, not the same as local generation. Public hosting is not planned.
  4. Prominent notice: unofficial fan project, not affiliated with or endorsed by Valve; Counter-Strike is a trademark of Valve Corporation. Don't use Valve logos or the proprietary UI font.
  5. Don't use Valve audio.
- **Tooling licences:** Source 2 Viewer, ts-fsrs, awpy etc. are open source; record each licence in a `THIRD-PARTY.md`. Fonts must be OFL or equivalent.
- **Privacy:** no analytics, no network calls at runtime except fetching static assets. Progress is local and exportable.

---

## 10. Roadmap

Effort is rough, for one person working with an AI pair, and given as relative size (S ≈ 1–2 days, M ≈ 3–5, L ≈ 1–2 weeks). Each phase has an exit test. Don't start a phase before the previous one passes.

### Phase 0: Spikes and decisions (S–M)

Answer the open technical questions cheaply, before building anything.

| Spike | Question | Exit |
|---|---|---|
| **Pool check** | What do Valve's release notes say about the current Premier pool, and which maps are in FACEIT's queue today (Dan can read this off the FACEIT client)? | Final map list for Phases 1–3. **Dropped 2026-10-28 by Dan: the FACEIT queue is not being verified. The ten maps of §3.1 stay as the working list (seven Premier maps built first, three extras last), and the list is data** |
| **Extraction** | Can we pull radar + overview for one map with Source 2 Viewer? Does the projection formula land a known landmark correctly? | Radar + numbers in hand; formula validated. **Done 2026-10-28 for all ten maps (§8.4)** |
| **Nav names** | Can we read place names (and areas) for that map? Which tool? | Dump of place names with polygons, **or** the demo-based fallback working. **Done 2026-11-01 with a decision: polygons and the global name list are in hand; assigning a place to each painted region is done in the Editor by asking the game and reading its HUD label with built-in OCR (tested on a real screenshot, read "Connector" correctly)** |
| **Capture** | Does Plan A work? If not, B/C. Frame quality (HUD hidden, lighting) acceptable? | 10 shots captured automatically from a manifest. **Done 2026-10-28: 13 of 13 (§8.2)** |
| **Vector base** | Does radar → potrace → SVG look good enough? | One styled base map. **Done 2026-10-28, by a better route: the map art is generated from the decoded nav mesh (§6.8), so tracing the radar is not needed** |
| **Design** | Moodboard, three directions, pick one; three hi-fi static screens, dark only | Signed-off look, token file. **Done 2026-10-28: built in direction C, chosen and confirmed by Dan (§6.8)** |
| **Fit check** | Can the tightest screens (Home picker, Session, Map/Study with about 15 callouts in a zone) hold real content at 1280 × 720 and 360 × 640 with no scrolling? | Three static or lightly coded screens that pass, or a revised content-length budget. **Done 2026-10-28, widened 2026-11-01: 132 of 132 checks pass across 15 comps, including long-content twins, landscape phones and the keyboard-open case (§6.8)** |
| **Stack** | Svelte vs. React, once | ADR. **Done 2026-10-28: Svelte 5 + Vite + TypeScript (`docs/adr/0001-stack.md`)** |
| **Scheduler sanity** | FSRS with simulated answers: intervals and daily load look reasonable under the grading map in §4.4 | Simulation output reviewed. **Done 2026-10-28: sane with three changes (new-item throttle, reshaped rating bands, stability-gated unlocks); see §4.4** |

**Spike log.**

- *Extraction, done apart from nav regions (2026-10-28).* Thumbnails, radars and overview numbers are extracted for all ten maps, and the projection formula is verified (§8.4). The archive reader works on the local install with no download, so Source 2 Viewer is optional.
- *Nav mesh: geometry decoded, place ids not (2026-10-28).* The time-boxed decode reverse-engineered the version-36 file. The vertex pool and area polygons are readable and validated on all ten maps (§8.4, `content-tools/spike/NAV_FORMAT.md`), so regions can be painted onto real nav areas in the Editor. Place assignment per area is still unknown. Optional follow-ups, none of which blocks Phase 1: (a) decode the byte-packed per-area tables to recover place ids, which needs more reverse engineering; (b) decode the chunked-LZ4 entity data, which may define place volumes; (c) derive places from a CS2 demo's `last_place_name` data, which needs a demo file and a demo-parser library (a download); (d) read the game's own place label: the HUD shows the current place name under the radar (it read "Connector" in the baseline capture), so the capture driver could teleport to sample points and read that label with Windows' built-in OCR, with no download, at about 2.5 s per sample. Recommendation: start Phase 1 with painted regions. **Resolved 2026-11-01:** option (d) was tested on the existing baseline screenshot with no game launch. Windows' built-in OCR (a 5.1 PowerShell command, `content-tools/spike/ocr_image.ps1`, driven by `place_ocr.py`) read the label under the radar as "Connector" after the white text was isolated and enlarged, so the image side works. It will be run per painted region in the Editor (§8.3), not over the whole mesh: about 50 samples a map instead of thousands. The in-game loop was not run now, because it needs CS2 launched in front of the screen and rewrites the video config, and nothing blocks on it. Options (a), (b) and (c) are dropped.
- *Screenshot capture, works (2026-10-28).* 13 of 13 Mirage shots were captured automatically at 1920×1080 with the HUD, weapon and crosshair hidden, about 2.5 s each (§8.2). The method is a driver over the game's local console port plus a guarded screen grab. The startup-config approach and the in-game `screenshot` command do not work. Open items: a per-map pass for stray on-screen elements, the AVIF conversion step, and the side effects listed in §8.2.
- *Design spike, done (2026-10-28).* Three directions compared side by side; Dan chose C ("terminal"). Tokens written and comps built with real screenshots and nav-mesh map art; extended on 2026-11-01 (see "Design follow-ups" below). Dan confirmed C as the look.
- *Scheduler sanity, done (2026-10-28).* A pure-Python FSRS-6 simulation (`content-tools/spike/fsrs_sim.py`) shows the scheduler is sane but needs three changes: a new-item throttle, reshaped rating bands and stability-gated stage unlocks (§4.4). Without the throttle seven maps overwhelm any sensible daily time.
- *Stack, done (2026-10-28).* Svelte 5 + Vite + TypeScript, no SvelteKit (`docs/adr/0001-stack.md`, §7.2). Node and pnpm were installed on 2026-11-01 once Dan said yes (see Phase 1 setup, §10).
- *Pool check, dropped (2026-10-28).* Dan told me to forget the FACEIT pool. The ten maps of §3.1 stay as the working list, the extras are built last, and the list is data.
- *Design follow-ups, done (2026-11-01).* States and motion, the question screens (multiple choice and typed), Pin it, the Hard-mode map, long-content twins, landscape phones, the keyboard-open phone and an accessibility pass are built and measured (§6.8, `design/A11Y.md`).
- *Environment.* Python 3.10 with numpy and zstandard is present, and the content tooling stays in Python. Node 26.13.0 and pnpm 12.16.1 were added on 2026-11-01 for the app (see Phase 1 setup).

**Phase 0 outcome (2026-11-01).** Every spike is closed. Settled: the maps (the ten of §3.1, no FACEIT check), the look (direction C), the stack (Svelte 5 + Vite + TypeScript), the scheduler's rules (§4.4, with the throttle and the reshaped rating bands), the map-art method (nav mesh), the capture method, the place-name method (ask the game, per region) and the no-scroll gate (132 of 132 on the comps). **What Phase 1 needed from Dan:** a go-ahead to download Node and pnpm and the npm packages (including the self-hosted font), given and done on 2026-11-01; and the in-game review pass on each map's callouts (§3.3), still to come. Open questions with defaults are in §12.

### Phase 1: Vertical slice, one complete map (L)

Mirage (or Dan's choice), end to end.

**Setup done (2026-11-01).** Node 26.13.0 (LTS) and pnpm 12.16.1 are installed, and `app/` is a Svelte 5 + Vite 8 + strict TypeScript project with the packages of §7.2 (`ts-fsrs`, `idb`, `zod`, `sharp`, Vitest, Playwright, `@fontsource/ibm-plex-mono`, latin subset only). Checked end to end: `pnpm test` (5 tests, the hash router), `pnpm check` (0 errors), `pnpm build` (26 kB of JS, 10.6 kB gzipped, plus the latin fonts: three weights, each as woff2 and woff, about 86 kB in all), `pnpm e2e` (2 Playwright tests in the Edge that ships with Windows, so no browser download; they confirm the self-hosted font loads and the page does not scroll), and `sharp` encoding AVIF. Two things that differ from the plan: TypeScript is pinned to 6.x, because `svelte-check` only accepts 5 or 6 and TypeScript 7 (the native rewrite) broke its peer range; and Node 26 no longer ships `corepack`, so pnpm comes from npm. The app so far is a shell (tokens, global styles, hash router in `app/src/core/router.ts`), not a screen. On this PC use `pnpm.cmd` and `npm.cmd` from PowerShell, because the `.ps1` shims are blocked by the execution policy.

**Core logic done (2026-11-01).** The framework-free part of Phase 1 is written and tested in `app/src/core/`, with no UI: content schemas and a cross-record validator (§7.7), projection and polygon geometry (§7.5, nested hit-testing for Hard mode), typed-answer matching and suggestions, rating inference, the FSRS-6 wrapper, the review log with replay and confusion counts, stage unlocks and mastery, multiple-choice option choice, and the session builder. Every rule the session builder enforces (§4.3, §4.4, §4.11) has a test, and the throttle boundary was broken on purpose once to check that a test notices. The choices the code made are listed under §4.4. `data/` holds the map index for the Home picker (all ten maps, only Mirage available), Mirage's map record (the real projection and game build `26144732` from the game files; five proposed zones for Dan to confirm), and an **empty** callout list: names, regions and screenshots come from painting in the Editor and the in-game review pass, so nothing was invented. (What was still to do at that point is in the next paragraph.)

**Quiz engine, store and Session screen done (2026-11-02).** The core loop works end to end in a browser, against a synthetic map because Mirage has no callouts yet. `core/quiz.ts` makes a prompt for each of the six Phase 1 modes and grades the answer; `core/runner.ts` is the session as a state machine (intro, question, reveal, done) with a fake-clock-testable timer that pauses while the tab is hidden; `core/mapview.ts` holds the map maths (region shapes, fit, zoom and pan limits, camera cone); `storage/idb-store.ts` and `core/store.ts` persist the log; `screens/Session.svelte` and `components/RegionMap.svelte` draw it, ported from the comps (`styles/components.css` and `styles/session.css` are the shared and per-screen CSS, global because the comps' layouts reach across parts of a screen). 212 unit tests, 27 browser tests, `svelte-check` clean, production JS 75 KB gzipped. To look at it: `pnpm dev` in `app/`, then open `http://localhost:5173/?seed=1#/session/de_test` (the synthetic map exists only in development and e2e builds; its progress is kept apart from the real log). **Choices the build made** (Dan can overrule any): *skip* is an answer, "I don't know", logged as wrong with nothing chosen; a pin or placement on the next region is *close* but still wrong, as in the comps; a click inside a Hard spot counts for the standard callout around it; the screenshot rotates with an item's answer count, and different modes of one callout start on different pictures; the question's alt text does not describe the place, and the reveal's does; typed suggestions are on for the first typed question of an item only; the hint is the first letter for Name it, Read the map and typed, one wrong picture ruled out for Which view?, and the zone lit for Pin it and Where am I?; no clock runs while a question is open, the time is shown on the reveal (SCOPE §4.11 says nothing counts down before Speed); the confusion line on a reveal appears from the second mix-up and does not yet promise a contrast card, because those are not built. **Not built yet:** pinch to zoom, the minimap, arrow-key movement between regions, the tap-to-zoom assist for tiny Hard spots, the heading drag in Where am I?, contrast cards (§4.6), early practice, settings (the session uses the defaults), and serving real screenshots (the app asks for `/shots/<file>`; the content pipeline has to put them there). A map with one or two playable callouts would ask multiple-choice questions with almost no distractors; real maps will not.

**Still to do in Phase 1:** the Editor, the Mirage callouts and their screenshots and Dan's in-game review, the Home, Map, Study, Summary, Settings and primer screens, and the exit test.

- Data + media for the whole map, validated, `verified` in-game.
- Hard mode on this map as well (nested regions, zoom, Tier 3 spots), to prove the feature early.
- Map component (pan/zoom, regions, labels, levels support, mastery tinting).
- Modes 1–4 and 5 (typed and MC); intro cards; reveal; summary.
- Scheduler, review log, session builder, mastery model, map overlay.
- Home (with the map picker; unbuilt maps dimmed), Map, Session, Summary, Settings (incl. export/import), and the first-run primer (§4.11).
- **Exit test:** Dan, a beginner who has not looked at the Mirage data, can name the Core callouts after ≤ 3 short sessions and the full Core + Standard set within about 10 days of ≤ 10-minute sessions, with ≥ 85 % recall at day 7 (targets, to be adjusted with real data). The no-scroll gate (§5.3) passes on every screen. Plus a UX pass: three things that annoyed Dan are fixed.

### Phase 2: Premier maps and full feature set (L–XL)

- Remaining six Premier maps through the pipeline (Cache last, with the second verification pass).
- Where am I? polish; Speed call; contrast cards; confusion handling; Progress screen.
- Study mode; zone tours.
- Each map ships Standard-complete (Core + Standard callouts); its Hard-mode spots follow in Phase 3.
- PWA offline with per-map packs; performance budgets met.
- Accessibility review passed.
- **Exit test:** all Tier 1 and 2 callouts on seven maps verified; offline works; budgets met; a11y pass; no-scroll gate green everywhere.

### Phase 3: Breadth and polish (L)

- Hard-mode (Tier 3) content for every map, one map at a time.
- The extras (Overpass, Vertigo, Train), each as a complete unit. The list was never verified against FACEIT (§12), so trim it here if a map turns out not to be played.
- Route walk mode (if still wanted).
- Content-update tooling: nav/radar diff on game patches, stale flags.
- **Exit test:** a Valve map patch can be processed, reviewed and released in under an afternoon per map.

### Not planned: public release

Decided: personal and local-first. If that ever changes, the first step is the legal review of hosting screenshots and radars (§9); hosting and a feedback channel would follow from it.

### Backlog (unscheduled)

Demo-clip challenge; voice answers; shareable "map mastery" image; per-team shared callout glossary; additional languages.

---

## 11. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Screenshot capture is hard to automate** | Low (spike succeeded) | High if it breaks (hundreds of shots by hand is a slog) | A working method is proven (§8.2). It relies on the console port and the screen grab surviving game updates, so Plans B–D stay as fallbacks |
| **Nav place names unreadable or don't match community names** | Med | Med | Fallback to demo-derived positions and hand-drawn regions; the Editor is built for it |
| **Callout names disputed or inconsistent** | High | Med | ≥ 3-source rule, `aliases`, show both community and game names, Dan has final say, changelog |
| **Valve patches maps (and the pool rotates)** | High, ~annually | Med | Content versioning, stale detection, stable IDs, phased delivery per map; Cache especially volatile |
| **IP / redistribution issues** | Low (personal, local) | High if it ever goes public | Decided personal; media never in repo; public hosting would need its own review (§9) |
| **Scope creep into lineups / strats** | High | High | Explicit non-goals; data model leaves hooks; backlog only |
| **Learning design doesn't beat re-reading a map** | Low–Med | High | Phase 1 exit test measures retention against a stated target; thresholds tuned with real data |
| **Design drifts to generic** | Med | Med | §6.1 banned list; moodboard and static comps before code; critique pass each phase |
| **Large media size breaks offline/mobile** | Med | Med | Image budgets, AVIF, per-map packs, lazy caching |
| **Over-gamification undermines focus** | Low | Med | No streak mechanics in v1; progress = map tinting |
| **Tool/format churn** (Source 2 Viewer, CS2 file layout) | Med | Low–Med | Pin tool versions; pipeline is scripted and re-runnable; cross-check with community mirror |
| **No-scroll rule makes dense screens cramped, or content overflows** | Low–Med (the Phase 0 comps pass 132 of 132 viewport checks) | High | Length limits enforced by the validator; chunking patterns (§5.3); the viewport-matrix gate, which already caught two layout bugs; accessibility fallback |
| **Hard-mode spots too small to click, or too many to manage** | Med | Med | Nested regions, map zoom, tap-to-zoom assist; Tier 3 can ship `draft` and stay hidden per map |
| **FACEIT pool is unclear or changes** | Med | Low | Map list is data; the verification was dropped (§12); the extras are built last, so a wrong guess costs little |
| **Beginner gets overwhelmed** | Med | High | Core-first path, 4 new per session, primer, gentle defaults (§4.11); tune with Phase 1 sessions |

---

## 12. Decisions and open questions

### Decided (Dan, 2026-10-28)

| # | Question | Decision | Where it landed |
|---|---|---|---|
| 1 | Personal or public? | **Personal, local-first** | No hosting and no public-release phase; §9, §10 |
| 2 | Map choice | **Map picker on the Home screen. Premier and FACEIT maps only.** Every callout at a high level of detail; the smallest spots and niche callouts live in **Hard mode** | §3.1 pools, §3.3 tiers, §4.12 Hard mode |
| 3 | Naming convention | **Both** community and in-game place names | §3.3 |
| 4 | CS2 installed here? | **Yes** | Extraction and capture are unblocked |
| 5 | Phones | Default: desktop-first, phone-friendly | §5.6 |
| 6 | Name | **Callouts** | Title stays |
| 7 | Maps beyond Premier/FACEIT | **No** | Office, Italy, Agency etc. removed from scope |
| 8 | Light theme | **Dark only** | §6.2, §6.6 |
| 9 | Experience level | **Very new; knows few callouts** | §4.11 beginner path |
| + | New requirement | **No scrolling: every screen fits one page** | §5.3, test gate in §7.7 |
| 10 | Look and feel | **Direction C, "terminal", chosen and confirmed by Dan** (2026-10-28) | §6.2, §6.8, `design/` |
| 11 | FACEIT pool check | **Dropped.** Keep the working list of ten maps; do not verify the queue | §3.1, §10 |

### Still open (defaults apply)

| # | Question | Default |
|---|---|---|
| b | **Build order.** Mirage first (most settled callouts), or a map you are about to play? | Mirage |
| c | **Hard mode scope.** Content only (the extra Tier 3 spots), or also stricter rules (tighter map-click tolerance, shorter flash times)? | Content only; revisit after Phase 1 |
| d | **No-scroll exception.** Is it acceptable to fall back to a scrolling layout only when the window is smaller than the supported minimum, or text is zoomed past 200 %? (§5.3) | Yes, for accessibility |

---

## 13. Research notes and sources

Conducted 2026-10-28 by web search. Most pool and callout material comes from **secondary, SEO-style sources** and should be treated as provisional until checked against Valve.

### Map pool

- Active Duty as of mid-to-late 2026: Ancient, Anubis, Cache, Dust II, Inferno, Mirage, Nuke. Overpass out, Cache in; Anubis replaced Train in January 2026. Sources: [GINX: Cache returns, Overpass replaced](https://www.ginx.tv/en/cache-cs2-active-duty-overpass-replaced), [Tradeit: Active Duty pool 2026](https://tradeit.gg/blog/cs2-maps).
- Conflict: Cache return dates reported as 28 April (matchmaking) and 8 July (Active Duty / Premier Season 5); the GINX article gives June 23 as its own publication date; some earlier lists still show Overpass. Reserve and other-mode lists (Warden / Stronghold / Alpine / Sanctum) are inconsistent across sources.
- Cache callouts and rework: [Hotspawn](https://www.hotspawn.com/counter-strike/guide/cs2-cache-callouts), [bo3.gg](https://bo3.gg/de/articles/cs2-cache-callouts-full-map-2026), [Playnews](https://www.playnews.gg/en/guides/counter-strike-2-the-2026-cache-guide-callouts-rework-and-changes-up-to-the-august-3-patch), [Profilerr](https://profilerr.net/cs2-cache-callouts/). Most classic Cache names persist; a few are new.
- FACEIT pool: [dust2.us, FACEIT adds Cache in Season 8](https://www.dust2.us/news/72972/faceit-to-add-cache-to-map-pool-in-season-8-update) (read: Cache is the eighth map from 22 April, optional and Elo-counted; the other seven are not named). [skin.club, Vertigo returns in Season 9](https://community.skin.club/en/news/faceit-vertigo-returns-in-season-9) (search snippet only, not fetched: Vertigo won the community vote and joined on 5 August, with the vote counts quoted in §3.1). [FACEIT Season 9 Map Vote FAQ](https://support.faceit.com/hc/en-us/articles/28929221706652-Season-9-Map-Vote-FAQ) and [talkesport on Season 9](https://www.talkesport.com/news/cs2/faceit-season-9-cs2-cache-return/) both blocked my fetch, so they are unread. No source I could read lists FACEIT's full current pool.

### Extraction and data

- [Source 2 Viewer](https://s2v.app/): open-source tool to browse VPKs and export Source 2 assets; map export guide at [s2v.app/…/exporting-maps](https://s2v.app/ValveResourceFormat/guides/exporting-maps.html).
- [cs2-map-icons](https://github.com/MurkyYT/cs2-map-icons): community mirror of radars, overview text and thumbnails, updated on Valve patches; assets stated to be Valve's property.
- [Valve Developer Wiki: NAV file format](https://developer.valvesoftware.com/wiki/NAV_(file_format)): place-name directory and per-area place index.
- [awpy navigation docs](https://awpy.readthedocs.io/en/latest/modules/nav.html) and [awpy demo module](https://awpy.readthedocs.io/en/latest/_modules/awpy/demo.html): nav parsing and the `last_place_name` player property in demo parsing.

### Existing tools (gap analysis)

- [csdb.gg Callout Hunt](https://csdb.gg/games/callout-hunt/train/): five-per-round pinned callouts on the radar, with separate pages for other maps (for example [Mirage](https://csdb.gg/games/callout-hunt/mirage/) and [Dust II](https://csdb.gg/games/callout-hunt/dust2/)). Radar-based; I saw no first-person screenshots.
- [metabot.gg interactive map](https://metabot.gg/de_DE/cs2/map/de_train/interactive): reference, not a quiz.
- [Sporcle CS:GO callout quizzes](https://www.sporcle.com/games/MachineGunBelly/csgo-callouts-quiz---nuke): typed names, untimed.
- [CSGO-Callout-Quiz](https://github.com/Stripa18/CSGO-Callout-Quiz): open-source, CS:GO-era.
- Lineup/utility apps (Util Master, CSMentor, Smoke Nade Trainer): not callouts.

### Learning and scheduling

- [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) (MIT, FSRS v6 in current releases, Node ≥ 20); [Open Spaced Repetition](https://github.com/open-spaced-repetition).

### Legal

- [Steam Subscriber Agreement](https://store.steampowered.com/subscriber_agreement/): fan-content clause (non-commercial; third-party rights are your responsibility).
- [Valve Developer Wiki: Mod Content Usage](https://developer.valvesoftware.com/wiki/Mod_Content_Usage): community-maintained, non-authoritative.

### Design references

- [Game UI Database](https://www.gameuidatabase.com/about.php), [Interface In Game](https://interfaceingame.com).

### Things stated here from general knowledge, not verified in this research

Radar projection formula and the overview-file field names (§7.5); CS2 standing eye height and the exact console commands for capture (§3.5, §8.2); the specific design inspirations in §6.7 other than Game UI Database / Interface In Game; the exact fonts' availability and licences; the claim that no callout trainer combines first-person screenshots, spaced repetition and a position mode (only a quick search was done); FACEIT's full current pool (§3.1). All of these are scheduled for Phase 0 checks or are low-stakes.

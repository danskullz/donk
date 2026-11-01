"""Second batch of comps (design spike, follow-ups): the question (multiple choice and typed), pin it with its
reveal, the Hard-mode map (zoomed, nested spots), the states sheet, and long-content "stress" variants.

Reuses the generator in build.py. Placeholder content as before (data.py); the Hard spots below are placeholders too,
positioned as offsets from real Mirage anchors, then snapped to the nearest nav polygons of the parent region.
"""
import os
import sys
from collections import deque

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build as B  # noqa: E402
from art import anchor_px, poly_d  # noqa: E402
from data import BLURB, STATE_LABEL, STATES  # noqa: E402

SHOT = B.SHOT
CHECK = '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M2 7.5 5.5 11 12 3"/></svg>'
CROSS = '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2 12 12M12 2 2 12"/></svg>'

# id, name, parent callout, dx, dy (radar px from the parent region's centre; snapped to a nav polygon of that region), state
HARD = [
    ("top-mid-boxes", "Top Mid Boxes", "top-mid", 70, 34, "seen"),
    ("window-ledge", "Window Ledge", "window", -6, -50, "new"),
    ("under-arch", "Under Arch", "connector", 6, -46, "new"),
    ("underpass-stairs", "Underpass Stairs", "underpass", 10, -52, "new"),
    ("ticket-booth", "Ticket Booth", "a-site", 60, -40, "new"),
    ("stairs", "Stairs", "a-site", -40, 50, "new"),
    ("jungle", "Jungle", "a-site", -70, -30, "seen"),
    ("balcony", "Balcony", "palace", -30, 24, "new"),
    ("bench", "Bench", "b-site", 50, -30, "new"),
    ("van", "Van", "b-site", -50, 40, "new"),
    ("shop-window", "Shop Window", "market", 20, 30, "new"),
    ("ct-boxes", "CT Boxes", "ct-spawn", 40, -30, "new"),
    ("tunnel-mouth", "Tunnel Mouth", "a-ramp", -20, 40, "new"),
    ("spawn-boxes", "Spawn Boxes", "t-spawn", 20, -40, "new"),
]
HARD_LONG = {"top-mid-boxes": "Top Mid Boxes Left Of Cat", "window-ledge": "Window Ledge Above Left Box",
             "under-arch": "Under Arch Wall Behind Plant", "underpass-stairs": "Underpass Stairs Dark Corner"}
assert all(len(v) <= 28 for v in HARD_LONG.values())


def nm(i):
    return next(a["name"] for a in B.ANCH if a["id"] == i)


def idx(i):
    return next(k for k, a in enumerate(B.ANCH) if a["id"] == i)


def hname(h):
    return HARD_LONG.get(h[0], h[1]) if B.STRESS_ON else h[1]


# ---------------------------------------------------------------- geometry helpers
def region_center(i):
    """Centre of a region in radar px: the polygon centroid nearest the mean, so it always lies on the region."""
    m = B.MIR
    px, polys, reg = m["px"], m["polys"], m["region"]
    cents = np.array([px[list(p)].mean(axis=0) for p, r in zip(polys, reg) if r == i])
    j = int(((cents - cents.mean(axis=0)) ** 2).sum(axis=1).argmin())
    return cents[j]


def region_distance(a, b):
    """Number of region boundaries crossed on the shortest route between two regions."""
    m = B.MIR
    polys, reg = m["polys"], m["region"]
    owner = {}
    for pi, p in enumerate(polys):
        for k in range(len(p)):
            owner.setdefault(tuple(sorted((p[k], p[(k + 1) % len(p)]))), []).append(pi)
    adj = {}
    for pis in owner.values():
        if len(pis) == 2 and reg[pis[0]] != reg[pis[1]]:
            adj.setdefault(int(reg[pis[0]]), set()).add(int(reg[pis[1]]))
            adj.setdefault(int(reg[pis[1]]), set()).add(int(reg[pis[0]]))
    seen, q = {a: 0}, deque([a])
    while q:
        x = q.popleft()
        for y in adj.get(x, ()):
            if y not in seen:
                seen[y] = seen[x] + 1
                q.append(y)
    return seen.get(b)


_HARD_CACHE = []


SPOT_R = 30   # radar px; a stand-in for the painted polygon union the Editor will produce


def hard_geometry():
    if _HARD_CACHE:
        return _HARD_CACHE
    m = B.MIR
    polys, reg, px = m["polys"], m["region"], m["px"]
    for h in HARD:
        sid, name, parent, dx, dy, state = h
        pi = idx(parent)
        cands = [i for i, r in enumerate(reg) if r == pi]
        cpx = np.array([px[list(polys[i])].mean(axis=0) for i in cands])
        target = region_center(pi) + np.array([dx, dy], dtype=float)
        c = cpx[int(((cpx - target) ** 2).sum(axis=1).argmin())]
        _HARD_CACHE.append(dict(h=h, id=sid, parent=parent, pi=pi, state=state, c=c))
    return _HARD_CACHE


# ---------------------------------------------------------------- shared chrome
def qbar(mode, n=8, total=20, timer="00.0 s"):
    ticks = "".join('<i class="%s"></i>' % ("d" if i < n - 1 else ("c" if i == n - 1 else "")) for i in range(total))
    return ('<header class="bar"><span class="brand">CALLOUTS</span><span class="crumb"><b>Mirage</b> · %s</span><span class="grow"></span>'
            '<div class="seg" role="progressbar" aria-label="Question" aria-valuemin="1" aria-valuemax="%d" aria-valuenow="%d">%s</div><span class="nums">%d / %d</span><span class="nums hide-s">%s</span></header>'
            % (mode, total, n, ticks, n, total, timer))


FOOT_Q = ('<footer class="foot"><span class="hide-s"><kbd>esc</kbd> leave</span><span class="grow"></span>'
          '<button class="btn">hint <kbd class="hide-s">h</kbd></button><button class="btn">skip <kbd class="hide-s">s</kbd></button></footer>')


# ---------------------------------------------------------------- question: multiple choice
def ask():
    names = ["top-mid", "window", "connector", "underpass"]
    opts = "".join('<button class="opt"><kbd>%d</kbd><span class="lab">%s</span><span class="mk"></span></button>' % (i + 1, nm(k)) for i, k in enumerate(names))
    body = (qbar("Name it") +
            '<main class="a-body"><div class="a-left"><div class="plate shot"><img src="%s" alt="First-person view of a narrow arched passage"></div>'
            '<div class="cap">Plate 07 · 1920×1080</div></div>'
            '<div class="a-right"><div class="prompt"><span class="eyebrow">Question 8 · 4 choices</span><span class="big">Where is this?</span></div>'
            '<div class="opts" role="group" aria-label="Answers">%s</div>'
            '<div class="keys"><span><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd><kbd>4</kbd> answer, no confirm</span><span><kbd>h</kbd> hint: the first letter, one rating step</span></div></div></main>'
            % (SHOT, opts) + FOOT_Q)
    return B.page("Callouts · Question", "ask", body)


# ---------------------------------------------------------------- question: typed, with suggestions (the bridge stage)
def typeq(typed="t"):
    pool = [("t-spawn", "t side"), ("t-apps", "b side"), ("top-mid", "mid"), ("ticket-booth", "a"), ("tunnel-mouth", "t side")]
    rows = []
    for k, z in pool:
        name = nm(k) if k in {a["id"] for a in B.ANCH} else next(hname(h) for h in HARD if h[0] == k)
        n = len(typed)
        rows.append('<div class="sug%s" role="option"><span class="t"><b>%s</b>%s</span><span class="z">%s</span></div>'
                    % (" hl" if not rows else "", name[:n], name[n:], z))
    body = (qbar("Name it<span class=\"hide-s\"> · typed</span>") +
            '<main class="a-body"><div class="a-left"><div class="plate shot"><img src="%s" alt="First-person view of a narrow arched passage"></div>'
            '<div class="cap">Plate 07 · 1920×1080</div></div>'
            '<div class="a-right"><div class="prompt"><span class="eyebrow">Question 8 · suggestions on</span><span class="big">Type the name</span></div>'
            '<div class="a-field"><div class="field is-focus"><span class="pre">&gt;</span><span>%s</span><span class="caret"></span></div>'
            '<div class="sugg" role="listbox">%s</div></div>'
            '<div class="keys"><span><kbd>↑</kbd><kbd>↓</kbd> pick</span><span><kbd>tab</kbd> complete</span><span><kbd>enter</kbd> answer</span></div></div></main>'
            % (SHOT, typed, "".join(rows)) + FOOT_Q)
    return B.page("Callouts · Typed question", "typeq", body, viewport="width=device-width,initial-scale=1,interactive-widget=resizes-content")


# ---------------------------------------------------------------- pin it
def pin(reveal=False):
    m = B.MIR
    vx, vy, vw, vh = m["view"]
    ti, gi = idx("connector"), idx("window")
    fills = "".join('<path class="r-new" d="%s"/>' % d for d in m["region_paths"])
    extra = ""
    if reveal:
        t, g = region_center(ti), region_center(gi)
        g = g + np.array([6.0, 14.0])
        tx, ty, gx, gy = t[0], t[1], g[0], g[1]
        extra = ('<path class="truthfill" d="%s"/><g filter="url(#ring)"><path d="%s" fill="#000"/></g>'
                 '<text class="lbl" x="%.0f" y="%.0f">%s</text><text class="lbl sel" x="%.0f" y="%.0f">%s</text>'
                 '<path class="guessline" d="M%.0f %.0fL%.0f %.0f"/><path class="guessx" d="M%.0f %.0fL%.0f %.0fM%.0f %.0fL%.0f %.0f"/>'
                 '<circle class="truthdot" cx="%.0f" cy="%.0f" r="8"/>'
                 % (m["region_paths"][ti], m["region_paths"][ti], gx, gy - 18, nm("window"), tx, ty - 26, nm("connector"),
                    gx, gy, tx, ty, gx - 9, gy - 9, gx + 9, gy + 9, gx + 9, gy - 9, gx - 9, gy + 9, tx, ty))
    svg = ('<svg viewBox="%.0f %.0f %.0f %.0f" role="img" aria-label="Mirage map, answer surface">'
           '<path class="m-wall" d="%s"/>%s<path class="m-bound" d="%s"/>%s</svg>' % (vx, vy, vw, vh, m["silhouette"], fills, m["boundaries"], extra))
    n = len(nm("connector"))
    if reveal:
        dist = region_distance(gi, ti)
        right = ('<div class="verdict"><span class="eyebrow">You pinned</span><span class="miss">%s<span class="nm">%s</span></span><span class="eyebrow" style="margin-top:6px">It is here</span>'
                 '<span class="answer" style="--n:%d">%s</span><div class="off"><span class="chip">%d region%s away</span><span class="sub">close, still counts as wrong</span></div></div>'
                 '<div class="about"><p class="blurb">%s</p><div class="chips"><span class="eyebrow">Next to</span><span class="chip">%s</span><span class="chip">%s</span></div></div>'
                 % (CROSS, nm("window"), n, nm("connector"), dist, "" if dist == 1 else "s", BLURB["connector"], nm("window"), nm("top-mid")))
        cap = "Guess to truth · %d region%s away" % (dist, "" if dist == 1 else "s")
        foot = ('<div class="sr-only" role="status">Wrong. You pinned %s. It is %s, %d region%s away.</div>'
                '<footer class="foot"><span class="hide-s"><kbd>h</kbd> hint</span><span class="grow"></span><span class="hide-s"><kbd>Space</kbd></span>'
                '<button class="btn primary">Continue</button></footer>' % (nm("window"), nm("connector"), dist, "" if dist == 1 else "s"))
        cls = "pin reveal"
    else:
        right = ('<div class="verdict"><span class="eyebrow">Pin it</span><span class="answer" style="--n:%d">%s</span></div>'
                 '<div class="keys"><span>click or tap where it is</span><span>scroll or pinch to zoom, drag to pan</span><span><kbd>h</kbd> hint: lights up the zone</span></div>'
                 % (n, nm("connector")))
        cap = "Click a region · no confirm step"
        foot = FOOT_Q
        cls = "pin"
    body = (qbar("Pin it", n=9) +
            '<main class="p-body"><div class="plate p-map"><div class="stage">%s</div><div class="cap">%s</div></div><div class="p-right">%s</div></main>' % (svg, cap, right) + foot)
    return B.page("Callouts · Pin it", cls, body)


# ---------------------------------------------------------------- Hard-mode map (zoomed, nested spots)
def map_hard(selected="under-arch", zone="mid"):
    m = B.MIR
    info = m["info"]
    vx, vy, vw, vh = m["view"]
    geo = hard_geometry()
    mid = [a for a in B.ANCH if a["zone"] == zone]
    in_zone = lambda g: next(a for a in B.ANCH if a["id"] == g["parent"])["zone"] == zone
    pts = np.array([region_center(idx(a["id"])) for a in mid] + [g["c"] for g in geo if in_zone(g)])
    lo, hi = pts.min(axis=0), pts.max(axis=0)
    pad = 40
    # leave room top-left for the minimap and top-right for the zoom buttons
    w0, h0 = hi[0] - lo[0] + 2 * pad, hi[1] - lo[1] + 2 * pad
    zx, zy = lo[0] - pad - 0.14 * w0, lo[1] - pad - 0.3 * h0
    w, h = w0 * 1.14, h0 * 1.3
    aspect = 1.14
    if w / h < aspect:
        w = h * aspect
    else:
        h = w / aspect
    fills = "".join('<path class="r-%s" d="%s"/>' % (a["state"], d) for a, d in zip(B.ANCH, m["region_paths"]))
    sel_geo = next(g for g in geo if g["id"] == selected)
    labels = []
    for a in B.ANCH:
        if a["zone"] == zone:
            x, y = region_center(idx(a["id"]))
            labels.append('<text class="lbl focus" x="%.0f" y="%.0f">%s</text>' % (x, y + 2, a["name"]))
    for g in geo:
        if in_zone(g):
            x, y = g["c"]
            pc = region_center(g["pi"])
            ly = y - SPOT_R - 4 if y < pc[1] else y + SPOT_R + 8   # label on the side away from the parent's own label
            labels.append('<text class="lbl hard%s" x="%.0f" y="%.0f">%s</text>' % (" sel" if g["id"] == selected else "", x, ly, hname(g["h"])))
    cx, cy = sel_geo["c"]

    def scene(sfx):
        """Everything inside the SVG; clip-path ids carry a suffix so the two views never share ids."""
        defs, spots = [], []
        for g in geo:
            if not in_zone(g):
                continue
            cid = "cp-%s-%s" % (g["id"], sfx)
            defs.append('<clipPath id="%s"><path d="%s"/></clipPath>' % (cid, m["region_paths"][g["pi"]]))
            x, y = g["c"]
            spots.append('<g class="hs %s" clip-path="url(#%s)"><circle class="r-%s" cx="%.0f" cy="%.0f" r="%d"/><circle class="ol" cx="%.0f" cy="%.0f" r="%d"/></g>'
                         % (g["state"], cid, g["state"], x, y, SPOT_R, x, y, SPOT_R))
        ring = ('<g filter="url(#ringz)"><g clip-path="url(#cp-%s-%s)"><circle cx="%.0f" cy="%.0f" r="%d" fill="#000"/></g></g>' % (sel_geo["id"], sfx, cx, cy, SPOT_R))
        return "<defs>%s</defs><path class=\"m-wall\" d=\"%s\"/>%s<path class=\"m-bound\" d=\"%s\"/>%s%s%s" % (
            "".join(defs), m["silhouette"], fills, m["boundaries"], "".join(spots), ring, "".join(labels))

    # desktop view: the whole middle zone; phone view: the selected spot and its surroundings (what tap-to-zoom would give)
    kd = max(674 / w, 590 / h)
    sx, sy = sel_geo["c"]
    mw = 250.0
    mh = mw / (336 / 194)
    km = 336 / mw
    svg = ('<svg class="zoomed only-d" style="--kd:%.2f" viewBox="%.0f %.0f %.0f %.0f" role="img" aria-label="Mirage, middle zone, zoomed, with Hard-mode spots">%s</svg>'
           '<svg class="zoomed only-m" style="--km:%.2f" viewBox="%.0f %.0f %.0f %.0f" role="img" aria-label="Mirage, zoomed to the selected Hard-mode spot">%s</svg>'
           % (kd, zx, zy, w, h, scene("d"), km, sx - mw / 2, sy - mh / 2 - 10, mw, mh, scene("m")))
    mini = ('<div class="minimap" aria-label="Zoom position"><svg viewBox="%.0f %.0f %.0f %.0f" aria-hidden="true"><path class="m-sil" d="%s"/>'
            '<rect class="vp" x="%.0f" y="%.0f" width="%.0f" height="%.0f"/></svg></div>' % (vx, vy, vw, vh, m["silhouette"], zx, zy, w, h))
    zoom = ('<div class="zoom"><button class="zbtn" aria-label="Zoom in">+</button><button class="zbtn" aria-label="Zoom out">−</button>'
            '<button class="zbtn" aria-label="Fit to frame">fit</button></div>')
    tabs = "".join('<button class="tab" role="tab" aria-selected="%s">%s</button>' % ("true" if z == zone else "false", lab)
                   for z, lab in (("t", "T"), ("a", "A"), ("mid", "Mid"), ("b", "B"), ("ct", "CT")))
    # rows of the middle zone in route order, each standard callout followed by its Hard spots; page 2 of 2
    rows_all = []
    for a in B.ANCH:
        if a["zone"] != zone:
            continue
        rows_all.append(("std", a["id"], a["name"], a["state"]))
        for g in geo:
            if g["parent"] == a["id"]:
                rows_all.append(("hard", g["id"], hname(g["h"]), g["state"]))
    page_size = 4   # a page never splits a callout from its Hard spots
    page_rows = rows_all[page_size:]
    rows = []
    for kind, rid, name, st in page_rows:
        cur = "true" if rid == selected else "false"
        rows.append('<div class="row%s" aria-current="%s">%s<span class="nm">%s</span><span class="st">%s</span><span class="dueflag none"></span></div>'
                    % (" nested" if kind == "hard" else "", cur, B.glyph(st), name, STATE_LABEL[st] + (" · hard" if kind == "hard" else "")))
    sel_name = hname(sel_geo["h"])
    peek = ('<div class="peek"><div class="plate"><img src="%s" alt=""></div><div><span class="eyebrow">Selected · hard spot</span><h3>%s</h3>'
            '<p>Inside %s. Needs the zoomed map to place exactly.</p><span class="chip">2 shots · tier 3</span></div></div>' % (SHOT, sel_name, nm(sel_geo["parent"])))
    legend = B.legend().replace("</div>", '<span><i class="sw-hard"></i>hard spot</span></div>')
    body = ('<header class="bar"><span class="brand">CALLOUTS</span><span class="crumb"><span class="hide-s">Maps / </span><b>Mirage</b></span><span class="grow"></span>'
            '<span class="switch on"><i></i><span class="hide-s">Hard mode</span><span class="chip hide-s">on · 14 spots</span></span><span class="chip due">3 due</span></header>'
            '<main class="mp-body"><div class="plate mp-plate"><div class="stage">%s</div>%s%s%s</div>'
            '<div class="mp-side"><div class="title"><h1>Mirage</h1><div class="stats"><span><b>4 of 13</b> known</span><span><b>45%%</b> mastery</span><span class="chip">0 of 14 spots</span></div></div>'
            '<div class="tabs" role="tablist">%s</div><div class="listwrap"><div class="list">%s</div><div class="pager"><span>2 / 2</span><span><kbd>,</kbd> prev <kbd>.</kbd> next</span></div>%s</div>'
            '<div class="acts2"><button class="btn primary">Quiz this map <kbd class="hide-s">Enter</kbd></button><button class="btn">Study</button><button class="btn">Weakest first</button></div></div></main>'
            % (svg, mini, zoom, legend, tabs, "".join(rows), peek))
    return B.page("Callouts · Mirage, Hard mode", "mapscreen hard", body)


# ---------------------------------------------------------------- states sheet
def tile(cls, extra=""):
    return ('<svg viewBox="0 0 80 56" aria-hidden="true"><g class="rg %s"><path class="r-familiar" d="M8 10 L56 6 L72 24 L60 50 L14 46 Z"/></g>%s</svg>' % (cls, extra))


def sheet():
    def pair(tag, cls="", dis=False):
        d = " disabled" if dis else ""
        return ('<div class="sh-row"><span class="tag">%s</span><div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px">'
                '<button class="btn primary %s"%s>start</button><button class="btn %s"%s>study</button></div></div>' % (tag, cls, d, cls, d))

    btn = "".join([pair("default"), pair("hover", "s-hover"), pair("pressed", "s-active"), pair("focus", "s-focus"), pair("disabled", "s-disabled", True)])

    def opt(tag, cls, label="connector", mk=""):
        return ('<div class="sh-row"><span class="tag">%s</span><button class="opt %s"><kbd>3</kbd><span class="lab">%s</span><span class="mk">%s</span></button></div>' % (tag, cls, label, mk))

    opts = "".join([opt("default", ""), opt("hover", "s-hover"), opt("pressed", "s-active"), opt("focus", "s-focus"),
                    opt("correct", "ok", mk=CHECK), opt("wrong", "no", "window", CROSS), opt("locked", "s-disabled")])

    nav = ('<div class="sh-row"><span class="tag">tabs</span><div class="tabs"><button class="tab" aria-selected="false">a</button><button class="tab s-hover" aria-selected="false">mid</button>'
           '<button class="tab" aria-selected="true">b</button><button class="tab s-focus" aria-selected="false">ct</button></div></div>'
           '<div class="sh-row"><span class="tag">row</span><div style="display:grid;gap:0">'
           '<div class="row" aria-current="false" style="height:38px">%s<span class="nm" style="font-size:13px">top mid</span><span class="st">known</span><span class="dueflag none"></span></div>'
           '<div class="row s-hover" aria-current="false" style="height:38px">%s<span class="nm" style="font-size:13px">window</span><span class="st">learning</span><span class="dueflag"></span></div>'
           '<div class="row" aria-current="true" style="height:38px">%s<span class="nm" style="font-size:13px">connector</span><span class="st">familiar</span><span class="dueflag"></span></div></div></div>'
           '<div class="sh-row"><span class="tag">field</span><div class="field"><span class="pre">&gt;</span><span class="ph">type the name</span></div></div>'
           '<div class="sh-row"><span class="tag">focus</span><div class="field is-focus"><span class="pre">&gt;</span><span>con</span><span class="caret"></span></div></div>'
           '<div class="sh-row"><span class="tag">error</span><div class="field err"><span class="pre">&gt;</span><span>conector</span></div></div>'
           '<div class="sh-row"><span class="tag">switch</span><div style="display:flex;gap:18px"><span class="switch"><i></i>off</span><span class="switch on"><i></i>on</span></div></div>'
           % (B.glyph("known"), B.glyph("learning"), B.glyph("familiar")))

    maps = ('<div class="sh-map">' +
            "".join('<div>%s<div class="tag">%s</div></div>' % (tile(c), t) for c, t in
                    (("", "default"), ("s-hover", "hover"), ("s-focus", "focus"), ("dim", "dimmed"))) +
            '<div><svg viewBox="0 0 80 56" aria-hidden="true"><g><path class="r-familiar" d="M8 10 L56 6 L72 24 L60 50 L14 46 Z"/></g><g filter="url(#ring)"><path d="M8 10 L56 6 L72 24 L60 50 L14 46 Z" fill="#000"/></g></svg><div class="tag">selected</div></div></div>')

    motion = ('<div class="sh-motion">'
              '<div><b>state</b><span>colour only, 90 ms, no movement</span></div>'
              '<div><b>focus</b><span>2 px accent ring, instant</span></div>'
              '<div><b>reveal</b><span>screen swaps at once, then the guess-to-truth line draws and the region fades in over 400 ms</span></div>'
              '<div><b>next card</b><span>instant; the next screenshot is preloaded, so nothing flashes</span></div>'
              '<div><b>caret</b><span>blinks 1.1 s</span></div>'
              '<div><b>reduced</b><span>every duration 0, caret static; nothing else changes</span></div></div>')

    body = ('<header class="bar"><span class="brand">CALLOUTS</span><span class="crumb"><b>States</b> · component sheet, direction C</span><span class="grow"></span><span class="sub">hover and pressed are real :hover / :active styles; shown still here</span></header>'
            '<main class="sh-body"><section class="sh-col"><h2>buttons</h2>%s<p class="sh-note"><b>primary</b> is the only filled control. Disabled is dimmed to 40%% and not clickable.</p></section>'
            '<section class="sh-col"><h2>answer options</h2>%s<p class="sh-note"><b>correct</b> and <b>wrong</b> never rely on colour: a mark, a left bar, and a strike-through on the wrong one.</p></section>'
            '<section class="sh-col"><h2>navigation and input</h2>%s</section>'
            '<section class="sh-col"><h2>map regions</h2>%s<p class="sh-note">Hover and focus use outlines, never fill, so the mastery colour stays readable. Focus is dashed.</p><h2>motion</h2>%s</section></main>'
            % (btn, opts, nav, maps, motion))
    return B.page("Callouts · States", "sheet", body)


# ---------------------------------------------------------------- build everything
def write(name, html):
    with open(os.path.join(HERE, name + ".html"), "w", encoding="utf-8") as f:
        f.write(html)
    print("%-20s %7d bytes" % (name + ".html", len(html)))


PAGES2 = {
    "ask": ask, "typeq": typeq, "pin": pin, "pin-reveal": lambda: pin(True), "map-hard": map_hard, "states": sheet,
}
STRESS2 = ["ask", "typeq", "pin-reveal", "map-hard"]

if __name__ == "__main__":
    # extra defs: a thinner ring for the zoomed map
    for name, fn in PAGES2.items():
        write(name, fn())
    for name in STRESS2:
        write(name + "-stress", B.stressed(PAGES2[name]))
    write("session-stress", B.stressed(B.session))
    write("map-stress", B.stressed(B.map_screen))

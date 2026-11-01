"""Generate the three static comps (home, session, map) with real content (design spike).

Real: Valve's thumbnails and our captured screenshot, map art generated from the decoded nav mesh,
Mirage positions from Valve's retake file. Placeholder: callout names/blurbs/mastery states
(see data.py). Output goes next to this file; CSS is hand-written (tokens.css, base.css, screens.css).
"""
import os
import re
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from art import anchor_px, assign_regions, build, cone_path, load
from data import BLURB, GAME_NAME, HOME, MIRAGE, STATE_LABEL, STATES, THUMB, ZONES, mirage_anchors

HERE = os.path.dirname(os.path.abspath(__file__))
SHOT = "../assets/valve/capture/run1/shot_03_cl-drawhud-0-r-drawviewmodel-0.png"
THUMBS = "../assets/valve/thumbs/%s.png"
FONTS = "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap"

DEFS = """<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
<pattern id="p-seen" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" style="fill:var(--m-new)"/><rect width="1.6" height="6" style="fill:var(--m-seen-line)"/></pattern>
<pattern id="p-learning" width="7" height="7" patternUnits="userSpaceOnUse"><rect width="7" height="7" style="fill:var(--m-learning)"/><circle cx="3.5" cy="3.5" r="1.5" style="fill:var(--m-learning-dot)"/></pattern>
<filter id="ring" x="-6%" y="-6%" width="112%" height="112%"><feMorphology in="SourceAlpha" operator="dilate" radius="4.4" result="d2"/><feComposite in="d2" in2="SourceAlpha" operator="out" result="o2"/><feFlood flood-color="#1c1d1f"/><feComposite in2="o2" operator="in" result="halo"/><feMorphology in="SourceAlpha" operator="dilate" radius="2.4" result="d"/><feComposite in="d" in2="SourceAlpha" operator="out" result="o"/><feFlood flood-color="#c8e04a"/><feComposite in2="o" operator="in" result="ring"/><feMorphology in="SourceAlpha" operator="erode" radius="1.6" result="e"/><feComposite in="SourceAlpha" in2="e" operator="out" result="ib"/><feFlood flood-color="#1c1d1f"/><feComposite in2="ib" operator="in" result="inner"/><feMerge><feMergeNode in="halo"/><feMergeNode in="inner"/><feMergeNode in="ring"/></feMerge></filter>
<filter id="ringz" x="-6%" y="-6%" width="112%" height="112%"><feMorphology in="SourceAlpha" operator="dilate" radius="2.2" result="d2"/><feComposite in="d2" in2="SourceAlpha" operator="out" result="o2"/><feFlood flood-color="#1c1d1f"/><feComposite in2="o2" operator="in" result="halo"/><feMorphology in="SourceAlpha" operator="dilate" radius="1.1" result="d"/><feComposite in="d" in2="SourceAlpha" operator="out" result="o"/><feFlood flood-color="#c8e04a"/><feComposite in2="o" operator="in" result="ring"/><feMorphology in="SourceAlpha" operator="erode" radius="0.8" result="e"/><feComposite in="SourceAlpha" in2="e" operator="out" result="ib"/><feFlood flood-color="#1c1d1f"/><feComposite in2="ib" operator="in" result="inner"/><feMerge><feMergeNode in="halo"/><feMergeNode in="inner"/><feMergeNode in="ring"/></feMerge></filter>
</defs></svg>"""

ANCH = mirage_anchors()
MIR = build("de_mirage", ANCH)
STATE_BY_ID = {a["id"]: a["state"] for a in ANCH}

# Stress content: every name at the 28-character limit and every blurb at 120 (SCOPE.md 5.3 rule 4), used by the *-stress comps.
LONG_NAMES = {"connector": "Under Palace Balcony Stairs", "window": "Mid Window Frame Left Ledge", "top-mid": "Top Mid Boxes Behind Cover",
              "underpass": "Underpass Stairs Lower Level", "t-apps": "T Apartments Back Staircase", "palace": "Palace Balcony Above A Site",
              "short": "Short Stairs To Lower Mid", "market": "Market Behind The Shelves", "a-ramp": "A Ramp Top Left Boxes"}
LONG_BLURB = "Narrow covered passage joining the middle of the map to the A side, running under the arch beside the shop and stairs."
assert all(len(v) <= 28 for v in LONG_NAMES.values()) and len(LONG_BLURB) <= 120
EXTRA_CHIPS = ["game name: Connector", "aka Arch", "aka Under Arch", "aka Mid Tunnel"]
STRESS_ON = False


def stressed(fn, *args, **kw):
    """Run a comp builder with long names and blurbs swapped in, then restore."""
    global STRESS_ON
    saved = [(a, a["name"]) for a in ANCH]
    saved_blurb = dict(BLURB)
    for a in ANCH:
        a["name"] = LONG_NAMES.get(a["id"], a["name"])
    BLURB.update({k: LONG_BLURB for k in BLURB})
    STRESS_ON = True
    try:
        return fn(*args, **kw)
    finally:
        STRESS_ON = False
        for a, n in saved:
            a["name"] = n
        BLURB.clear()
        BLURB.update(saved_blurb)


def page(title, cls, body, css=("tokens.css", "base.css", "screens.css", "screens2.css"), viewport="width=device-width,initial-scale=1"):
    links = "".join('<link rel="stylesheet" href="%s">' % c for c in css)
    return ('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="%s">'
            '<title>%s</title><link rel="stylesheet" href="%s">%s<body>%s<div class="app %s">%s</div>%s</body></html>') % (
        viewport, title, FONTS, links, DEFS, cls, body, FIT_SCRIPT)


# Fit instrument: after load, record the viewport, the document's scroll size, and any element that overflows it.
FIT_SCRIPT = """<script>addEventListener('load',function(){document.fonts.ready.then(function(){var d=document.documentElement,w=innerWidth,h=innerHeight,over=[];
document.querySelectorAll('.app *').forEach(function(e){if(e.closest('svg')&&e.tagName!=='svg')return;var r=e.getBoundingClientRect();if(r.width>0&&r.height>0&&(r.right>w+1||r.bottom>h+1||r.left<-1||r.top<-1))over.push((e.className&&e.className.baseVal!==undefined?e.className.baseVal:e.className||e.tagName)+'@'+Math.round(r.right)+'x'+Math.round(r.bottom))});
var sc=[];document.querySelectorAll('.app *').forEach(function(e){if(e.scrollHeight>e.clientHeight+1&&getComputedStyle(e).overflowY!=='visible'&&e.clientHeight>2)sc.push((e.className||e.tagName)+':'+e.scrollHeight+'>'+e.clientHeight)});
var sp=[];document.querySelectorAll('.app, .app *').forEach(function(e){if(e.closest('svg'))return;var cs=getComputedStyle(e);if(cs.display==='contents'||cs.display==='inline'||cs.overflowX!=='visible'||cs.overflowY!=='visible')return;var r=e.getBoundingClientRect();if(r.width<3||r.height<3)return;for(var i=0;i<e.children.length;i++){var c=e.children[i],cc=getComputedStyle(c);if(cc.position==='absolute'||cc.position==='fixed'||cc.display==='none'||cc.display==='contents'||c.tagName==='svg')continue;var q=c.getBoundingClientRect();if(q.width<1||q.height<1)continue;if(q.bottom>r.bottom+4||q.right>r.right+4){sp.push((e.className||e.tagName)+'>'+(c.className||c.tagName)+':'+Math.round(q.right-r.right)+'x'+Math.round(q.bottom-r.bottom));break}}});
document.title='FIT '+JSON.stringify({vw:w,vh:h,sw:d.scrollWidth,sh:d.scrollHeight,over:over.slice(0,6).concat(sp.map(function(x){return 'SPILL '+x})),clipped:sc.slice(0,6)})})})</script>"""


def glyph(state):
    return '<svg class="mg" viewBox="0 0 14 14" aria-hidden="true"><rect width="14" height="14" class="r-%s"/></svg>' % state


def legend():
    return '<div class="legend">%s</div>' % "".join("<span>%s%s</span>" % (glyph(s), STATE_LABEL[s]) for s in STATES)


def seg(total, done, current=None):
    cells = []
    for i in range(total):
        cls = "d" if i < done else ("c" if current is not None and i == current else "")
        cells.append('<i class="%s"></i>' % cls)
    return '<div class="seg" aria-hidden="true">%s</div>' % "".join(cells)


def mini_round(d):
    return re.sub(r"(\d+)\.\d+", r"\1", d)


def mini_svg(map_name, states=None):
    """Small map for cards. With states: tinted regions (sample split); without: plain silhouette."""
    verts, polys, info = load(map_name)
    if states is None:
        m = build(map_name)
        vx, vy, vw, vh = m["view"]
        return ('<svg viewBox="%.0f %.0f %.0f %.0f" aria-hidden="true"><path class="m-sil" d="%s"/></svg>' % (vx, vy, vw, vh, mini_round(m["silhouette"])))
    if map_name == "de_mirage":
        m = MIR
        regs = [(a["state"], d) for a, d in zip(ANCH, m["region_paths"])]
    else:
        cents = np.array([verts[list(p)].mean(axis=0) for p in polys])
        k = len(states)
        pick = [int(np.argmin(((cents[:, :2] - cents[:, :2].mean(axis=0)) ** 2).sum(axis=1)))]
        while len(pick) < k:
            d = np.min([((cents - cents[i]) ** 2 * np.array([1, 1, 6.25])).sum(axis=1) for i in pick], axis=0)
            pick.append(int(d.argmax()))
        anchors = [tuple(cents[i]) for i in pick]
        reg = assign_regions(verts, polys, anchors)
        m = build(map_name)
        from art import poly_d
        regs = [(states[r], "".join(poly_d(m["px"], p) for p, rr in zip(polys, reg) if rr == r)) for r in range(k)]
    vx, vy, vw, vh = m["view"]
    body = '<path class="m-wall" d="%s"/>' % mini_round(m["silhouette"]) + "".join('<path class="r-%s" d="%s"/>' % (s, mini_round(d)) for s, d in regs)
    return '<svg viewBox="%.0f %.0f %.0f %.0f" aria-hidden="true">%s</svg>' % (vx, vy, vw, vh, body)


def stats():
    core = [a for a in ANCH if a["tier"] == 1]
    known = lambda xs: sum(1 for a in xs if a["state"] in ("known", "auto"))
    score = sum(STATES.index(a["state"]) for a in ANCH) / (5 * len(ANCH))
    return {"core_total": len(core), "core_known": known(core), "all_total": len(ANCH), "all_known": known(ANCH), "pct": round(100 * score)}


ST = stats()
DUE = {"palace": True, "window": True, "connector": True}


# ---------------------------------------------------------------- home
def home():
    cards = []
    for mid, name, state, pct, due, line in HOME:
        if mid == "de_mirage":
            inset = mini_svg(mid, STATES)
            pct, line = ST["pct"], "Core %d of %d" % (ST["core_known"], ST["core_total"])
            ticks = seg(ST["core_total"], ST["core_known"])
        elif mid == "de_dust2":
            inset = mini_svg(mid, ["auto", "known", "familiar", "seen", "new", "new", "learning", "new"])
            ticks = seg(12, 2)
        else:
            inset = mini_svg(mid)
            ticks = seg(12, 0)
        text = '<span class="hide-s">%s</span><span class="show-s">%s</span>' % (line, line.replace(' of ', '/'))
        low = ('%s<span class="chip due"><span>%d</span><span class="hide-s"> due</span></span>' % (text, due)) if due else text
        pctel = '<span class="pct nums">%d%%</span>' % pct if state == "active" else ""
        cards.append('<article class="card %s"><div class="thumb"><img src="%s" alt=""></div><div class="inset">%s</div>'
                     '<div class="info"><div class="top"><h3>%s</h3>%s</div>%s<div class="low">%s</div></div></article>'
                     % (state, THUMBS % THUMB[mid], inset, name, pctel, ticks, low))
    body = ('<h1 class="sr-only">Callouts: pick a map</h1><header class="bar"><span class="brand">CALLOUTS</span><span class="crumb hide-s">Maps</span><span class="grow"></span>'
            '<span class="chip due">5 due</span><span class="hide-s"><kbd>/</kbd> find</span></header>'
            '<section class="today"><div class="lead"><span class="eyebrow">Today</span><span class="big">5 due · 4 new</span><span class="sub hide-s">Mirage, Dust II</span></div>'
            '<div class="acts"><button class="btn">Weakest first</button><button class="btn primary">Start session <kbd class="hide-s">Enter</kbd></button></div></section>'
            '<main class="picker" aria-label="Maps">%s</main>'
            '<footer class="hints"><span><kbd>←</kbd><kbd>→</kbd> select map</span><span><kbd>Enter</kbd> start session</span><span><kbd>/</kbd> find</span><span><kbd>?</kbd> keys</span></footer>'
            % "".join(cards))
    return page("Callouts · Maps", "home", body)


# ---------------------------------------------------------------- session
def session():
    info = MIR["info"]
    cx, cy = anchor_px(info, -638.1, -1043.5)
    vx, vy, vw, vh = MIR["view"]
    regs = "".join('<path class="r-%s" d="%s"/>' % (a["state"], d) for a, d in zip(ANCH, MIR["region_paths"]))
    cone = cone_path(info, -638.1, -1043.5, 99.0, length=140)
    mini = ('<svg viewBox="%.0f %.0f %.0f %.0f" aria-label="Camera position and facing on the Mirage map">'
            '<path class="m-wall" d="%s"/>%s<path class="m-bound" d="%s"/><path class="cone" d="%s"/><circle class="you" cx="%.0f" cy="%.0f" r="9"/></svg>'
            % (vx, vy, vw, vh, MIR["silhouette"], regs, MIR["boundaries"], cone, cx, cy))
    x_icon = '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2 12 12M12 2 2 12"/></svg>'
    ticks = "".join('<i class="%s"></i>' % ("d" if i < 6 else ("c" if i == 6 else "")) for i in range(20))
    nm = {a["id"]: a["name"] for a in ANCH}
    more = "".join('<span class="chip hide-s">%s</span>' % x for x in EXTRA_CHIPS) if STRESS_ON else ""
    body = ('<header class="bar"><span class="brand">CALLOUTS</span><span class="crumb"><b>Mirage</b> · Name it</span><span class="grow"></span>'
            '<div class="seg" role="progressbar" aria-label="Question" aria-valuemin="1" aria-valuemax="20" aria-valuenow="7">%s</div><span class="nums">7 / 20</span><span class="nums hide-s">02.4 s</span></header>'
            '<main class="s-body"><div class="s-left"><div class="plate shot"><img src="%s" alt="First-person view of a narrow arched passage"></div>'
            '<div class="cap">Plate 07 · %s<span class="hide-s"> · eye −146.1 · facing north · 1920×1080</span></div>'
            '<div class="confuse">Mixed up with <b>%s</b> twice this week. A contrast card is queued for tomorrow.</div></div>'
            '<div class="s-right"><div class="verdict"><span class="eyebrow">You chose</span><span class="miss">%s<span class="nm">%s</span></span><span class="eyebrow" style="margin-top:6px">It is</span><span class="answer" style="--n:%d">%s</span></div>'
            '<div class="plate map-plate">%s</div>'
            '<div class="about"><p class="blurb">%s</p></div><div class="chips"><span class="eyebrow">Next to</span><span class="chip">%s</span><span class="chip">%s</span>%s<span class="chip hide-s">game name: %s</span></div></div></main>'
            '<div class="sr-only" role="status">Wrong. It is %s. You chose %s.</div>'
            '<footer class="foot"><span class="hide-s"><kbd>H</kbd> hint</span><span class="grow"></span><span class="hide-s"><kbd>Space</kbd></span><button class="btn primary">Continue</button></footer>'
            % (ticks, SHOT, nm["connector"], nm["window"].upper(), x_icon, nm["window"], len(nm["connector"]), nm["connector"], mini,
               BLURB["connector"], nm["window"], nm["top-mid"], more, nm["connector"], nm["connector"], nm["window"]))
    return page("Callouts · Session", "session", body)


# ---------------------------------------------------------------- map screen
PEEK = ('<div class="peek"><div class="plate"><img src="' + SHOT + '" alt=""></div><div><span class="eyebrow">Selected</span><h3>Connector</h3>'
        '<p>' + BLURB["connector"] + '</p><span class="chip">3 shots · 1 hard spot</span></div></div>')


def map_screen(selected="connector", zone="mid"):
    info = MIR["info"]
    vx, vy, vw, vh = MIR["view"]
    fills = "".join('<path class="r-%s" d="%s"/>' % (a["state"], d) for a, d in zip(ANCH, MIR["region_paths"]))
    sel_i = next(i for i, a in enumerate(ANCH) if a["id"] == selected)
    ring = '<g filter="url(#ring)"><path d="%s" fill="#000"/></g>' % MIR["region_paths"][sel_i]
    labels = []
    for a in ANCH:
        x, y = anchor_px(info, a["x"], a["y"])
        cls = "lbl" + (" focus" if a["zone"] == zone else "") + (" sel" if a["id"] == selected else "")
        labels.append('<text class="%s" x="%.0f" y="%.0f">%s</text>' % (cls, x, y + 5, a["name"]))
    svg = ('<svg viewBox="%.0f %.0f %.0f %.0f" role="img" aria-label="Mirage with mastery by callout">'
           '<path class="m-wall" d="%s"/>%s<path class="m-bound" d="%s"/>%s%s</svg>'
           % (vx, vy, vw, vh, MIR["silhouette"], fills, MIR["boundaries"], ring, "".join(labels)))
    tabs = "".join('<button class="tab" role="tab" aria-selected="%s">%s</button>' % ("true" if z == zone else "false", lab if z != "mid" else "Mid") for z, lab in
                   [(z, {"t": "T", "a": "A", "mid": "Mid", "b": "B", "ct": "CT"}[z]) for z, _ in ZONES])
    rows = []
    for a in [a for a in ANCH if a["zone"] == zone]:
        flag = "dueflag" if DUE.get(a["id"]) else "dueflag none"
        rows.append('<div class="row" aria-current="%s">%s<span class="nm">%s</span><span class="st">%s</span><span class="%s" title="due"></span></div>'
                    % ("true" if a["id"] == selected else "false", glyph(a["state"]), a["name"], STATE_LABEL[a["state"]], flag))
    body = ('<header class="bar"><span class="brand">CALLOUTS</span><span class="crumb"><span class="hide-s">Maps / </span><b>Mirage</b></span><span class="grow"></span>'
            '<span class="switch"><i></i><span class="hide-s">Hard mode</span><span class="chip hide-s">off · 14 spots hidden</span></span><span class="chip due">3 due</span></header>'
            '<main class="mp-body"><div class="plate mp-plate"><div class="stage">%s</div>%s</div>'
            '<div class="mp-side"><div class="title"><h1>Mirage</h1><div class="stats"><span><b>%d of %d</b> known</span><span><b>%d%%</b> mastery</span><span class="chip due">3 due</span></div></div>'
            '<div class="tabs" role="tablist">%s</div><div class="listwrap"><div class="list">%s</div><div class="pager"><span>1 / 1</span><span>Core first</span></div>%s</div>'
            '<div class="acts2"><button class="btn primary">Quiz this map <kbd class="hide-s">Enter</kbd></button><button class="btn">Study</button><button class="btn">Weakest first</button></div></div></main>'
            % (svg, legend(), ST["all_known"], ST["all_total"], ST["pct"], tabs, "".join(rows), PEEK))
    return page("Callouts · Mirage", "mapscreen", body)


if __name__ == "__main__":
    for name, html in (("home", home()), ("session", session()), ("map", map_screen())):
        with open(os.path.join(HERE, name + ".html"), "w", encoding="utf-8") as f:
            f.write(html)
        print("%-8s %7d bytes" % (name + ".html", len(html)))
    print("stats:", ST)

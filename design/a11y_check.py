"""Accessibility checks for the comps (design spike, Phase 0). Measured, not eyeballed.

1. Contrast: every text and non-text pair the comps use, computed from tokens.css (WCAG 2.x relative luminance).
2. Targets: size of every interactive element at 360 x 640 and 1280 x 720, measured in headless Edge.
3. Text size: the smallest rendered text sizes at 360 x 640.
4. Structure: alt text, accessible names, roles, language, headings, reduced-motion and forced-colors rules.

usage: python -I a11y_check.py
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fit_check as F  # noqa: E402


def tokens():
    css = open(os.path.join(HERE, "tokens.css"), encoding="utf-8").read()
    return {k: v.lower() for k, v in re.findall(r"--([\w-]+):\s*(#[0-9a-fA-F]{6})", css)}


def lum(hexv):
    c = [int(hexv[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    c = [x / 12.92 if x <= 0.03928 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


def ratio(a, b):
    la, lb = sorted((lum(a), lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def contrast():
    t = tokens()
    text_pairs = [
        ("text", "bg"), ("text", "surface"), ("text", "surface-hi"), ("text", "surface-lo"),
        ("sub", "bg"), ("sub", "surface"), ("sub", "surface-hi"), ("sub", "surface-lo"),
        ("main", "bg"), ("main", "surface"), ("main", "ok-bg"),
        ("main-ink", "main"), ("main-ink", "main-hi"), ("main-ink", "main-lo"),
        ("error", "bg"), ("error", "surface"), ("error", "no-bg"),
    ]
    nontext = [
        ("rule-strong", "bg", "control outlines, swatch outlines"), ("rule-strong", "surface", "control outlines on a card"),
        ("main", "bg", "focus ring, selected marker"), ("main", "surface-hi", "focus ring on a hovered control"),
        ("error", "bg", "wrong-answer icon"), ("text", "m-new", "hover outline on an unstarted region"),
        ("main", "bg", "selected-region ring: it carries a dark band on both sides, so it is judged against bg, not against the region fill"),
    ]
    ramp = [("m-new", "new"), ("m-seen-line", "seen (hatch line)"), ("m-learning-dot", "learning (dot)"),
            ("m-familiar", "familiar"), ("m-known", "known"), ("m-auto", "automatic")]
    rows, worst = [], 99
    print("TEXT (needs 4.5:1; 3:1 for text 18 px and up)")
    for fg, bg in text_pairs:
        r = ratio(t[fg], t[bg])
        worst = min(worst, r)
        print("  %-9s on %-10s %5.1f  %s" % (fg, bg, r, "ok" if r >= 4.5 else "FAIL"))
        rows.append(("text", fg, bg, round(r, 2), r >= 4.5))
    print("NON-TEXT (needs 3:1)")
    for fg, bg, what in nontext:
        r = ratio(t[fg], t[bg])
        print("  %-12s on %-10s %5.1f  %s  (%s)" % (fg, bg, r, "ok" if r >= 3 else "FAIL", what))
        rows.append(("non-text", fg, bg, round(r, 2), r >= 3))
    print("MASTERY RAMP against the page background (information also carried by hatch/dots and by text in the list)")
    for k, name in ramp:
        print("  %-18s %5.1f" % (name, ratio(t[k], t["bg"])))
    return rows


MEASURE = r"""<!doctype html><meta charset="utf-8"><title>wait</title><body style="margin:0"><iframe id="f" src="../%s.html" width="%d" height="%d" style="border:0"></iframe>
<script>f.onload=function(){setTimeout(function(){var d=f.contentDocument,t=[],fs={};
d.querySelectorAll('button,a[href],[role=tab],.opt,.row,.sug,.zbtn,.card,.field,input').forEach(function(e){var r=e.getBoundingClientRect(),cs=f.contentWindow.getComputedStyle(e);if(r.width<2||r.height<2||cs.display==='none'||cs.visibility==='hidden')return;if(e.closest('.sh-body'))return;t.push([(e.className&&e.className.baseVal===undefined?e.className:e.tagName).toString().split(' ')[0]||e.tagName,Math.round(r.width),Math.round(r.height)])});
var w=d.createTreeWalker(d.body,NodeFilter.SHOW_TEXT),n;while(n=w.nextNode()){if(!n.nodeValue.trim())continue;var p=n.parentElement;if(p.closest('script,style'))continue;var cs=f.contentWindow.getComputedStyle(p);if(cs.display==='none'||cs.visibility==='hidden'||p.getBoundingClientRect().width<2)continue;if(p.closest('svg'))continue;var s=parseFloat(cs.fontSize);fs[s]=(fs[s]||0)+n.nodeValue.trim().length}
document.title='A '+JSON.stringify({t:t,fs:fs})},1800)}</script>"""


def measure(page, w, h):
    path = os.path.join(F.RENDERS, "_a11y_%s_%dx%d.html" % (page, w, h))
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(MEASURE % (page, w, h))
    out = F.edge(["--virtual-time-budget=12000", "--dump-dom", F.furl(path)], w, h).stdout
    os.remove(path)
    m = re.search(r"<title>A (\{.*?\})</title>", out, re.S)
    return json.loads(m.group(1).replace("&quot;", '"')) if m else None


def targets():
    pages = ["home", "ask", "typeq", "pin", "pin-reveal", "session", "map", "map-hard"]
    res = {}
    for w, h in ((360, 640), (1280, 720)):
        print("\nTARGETS at %dx%d (24 px is the WCAG 2.2 AA floor; 44 px is our own rule, SCOPE.md 5.4)" % (w, h))
        print("  %-11s %5s %6s %6s   %s" % ("page", "count", "min h", "min w", "smaller than 44 px in height (class: size, count)"))
        for p in pages:
            r = measure(p, w, h)
            if not r:
                print("  %-11s no measurement" % p)
                continue
            t = r["t"]
            small = {}
            for cls, tw, th in t:
                if th < 44:
                    small.setdefault("%s: %dx%d" % (cls, tw, th), 0)
                    small["%s: %dx%d" % (cls, tw, th)] += 1
            mh = min((th for _, _, th in t), default=0)
            mw = min((tw for _, tw, _ in t), default=0)
            res[(p, w)] = (mh, mw)
            print("  %-11s %5d %6d %6d   %s" % (p, len(t), mh, mw, "; ".join("%s x%d" % kv for kv in list(small.items())[:5]) or "none"))
            if w == 360 and p in ("session", "map"):
                fs = r["fs"]
                print("      text sizes (px: characters): " + ", ".join("%s: %d" % (k, v) for k, v in sorted(fs.items(), key=lambda kv: float(kv[0]))))
    return res


def structure():
    print("\nSTRUCTURE (static checks over the generated pages)")
    issues = 0
    css = "".join(open(os.path.join(HERE, c), encoding="utf-8").read() for c in ("base.css", "screens.css", "screens2.css"))
    for name in ("prefers-reduced-motion", "forced-colors", ":focus-visible", ".sr-only"):
        ok = name in css
        issues += 0 if ok else 1
        print("  css has %-24s %s" % (name, "yes" if ok else "MISSING"))
    for p in F.PAGES:
        h = open(os.path.join(HERE, p + ".html"), encoding="utf-8").read()
        probs = []
        if 'lang="en"' not in h:
            probs.append("no lang")
        if "<main" not in h and "sh-body" not in h:
            probs.append("no main landmark")
        for m in re.finditer(r"<img\b[^>]*>", h):
            if " alt=" not in m.group(0):
                probs.append("img without alt")
        for m in re.finditer(r"<button\b([^>]*)>(.*?)</button>", h, re.S):
            label = re.sub(r"<[^>]+>", "", m.group(2)).strip()
            if not label and "aria-label" not in m.group(1):
                probs.append("button without a name")
        for m in re.finditer(r'<svg\b[^>]*role="img"[^>]*>', h):
            if "aria-label" not in m.group(0):
                probs.append("svg role=img without a label")
        for m in re.finditer(r'<div class="seg"[^>]*aria-label', h):
            if "role=" not in m.group(0) and 'role="progressbar"' not in h:
                probs.append("seg has aria-label but no role")
        if p == "home" and "<h1" not in h:
            probs.append("no h1")
        issues += len(probs)
        print("  %-18s %s" % (p, "ok" if not probs else "; ".join(sorted(set(probs)))))
    return issues


if __name__ == "__main__":
    rows = contrast()
    bad = [r for r in rows if not r[4]]
    targets()
    s = structure()
    print("\ncontrast failures: %d, structure issues: %d" % (len(bad), s))

"""Render every comp at the SCOPE.md viewport matrix and check that nothing scrolls or overflows.

Each comp is loaded in an <iframe> of the exact target size inside headless Edge, so media queries and
measurements see that exact viewport (headless Edge itself cannot go below ~492 px wide). The comps
record their own scroll size and any overflowing element in document.title (see build.py FIT_SCRIPT).

Pages: the original three, the question screens (multiple choice and typed), pin it, the Hard-mode map and
the states sheet, plus a "-stress" twin of each with every name at 28 characters and every blurb at 120.
The typed question is also checked at 360 x 340, a phone with the soft keyboard open.

usage: python -I fit_check.py [shots]     # 'shots' also writes PNGs for the tight sizes into design/renders/
"""
import json
import os
import re
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
RENDERS = os.path.join(HERE, "renders")
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
BASE = ["home", "session", "map"]
NEW = ["ask", "typeq", "pin", "pin-reveal", "map-hard"]
STRESS = ["session-stress", "map-stress", "ask-stress", "typeq-stress", "pin-reveal-stress", "map-hard-stress"]
SHEET = ["states"]
PAGES = BASE + NEW + STRESS + SHEET
MATRIX = [(1920, 1080), (1366, 768), (1280, 720), (1024, 600), (768, 1024), (390, 844), (360, 640)]
DESKTOP_ONLY = [(1920, 1080), (1366, 768), (1280, 720), (1024, 600)]
KEYBOARD = [(360, 340)]
LANDSCAPE = [(640, 360), (844, 390)]   # a phone on its side: the desktop layout, compressed (SCOPE.md 5.3 rule 7)
TIGHT = [(1280, 720), (360, 640)]
CHROME = (24, 92)  # headless Edge: window size minus viewport


def viewports(page):
    if page in SHEET:
        return DESKTOP_ONLY
    return MATRIX + LANDSCAPE + (KEYBOARD if page.startswith("typeq") else [])


def furl(path):
    return "file:///" + path.replace("\\", "/")


def wrapper(page, w, h):
    os.makedirs(RENDERS, exist_ok=True)
    path = os.path.join(RENDERS, "_frame_%s_%dx%d.html" % (page, w, h))
    html = ('<!doctype html><meta charset="utf-8"><title>wait</title><body style="margin:0;background:#0c0d0e">'
            '<iframe id="f" src="../%s.html" width="%d" height="%d" style="border:0;display:block"></iframe>'
            '<script>f.onload=function(){setTimeout(function(){try{document.title=f.contentDocument.title}catch(e){document.title="ERR "+e}},1500)}</script>'
            % (page, w, h))
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(html)
    return path


def edge(args, w, h, slot=0):
    win = ("--window-size=%d,%d" % (max(w + CHROME[0], 500), h + CHROME[1]))
    prof = os.path.join(tempfile.gettempdir(), "callouts_edge_%d" % slot)
    return subprocess.run([EDGE, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--allow-file-access-from-files",
                           "--user-data-dir=" + prof, win] + args,
                          capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=180)


def measure(job):
    (page, w, h), slot = job
    out = edge(["--virtual-time-budget=12000", "--dump-dom", furl(wrapper(page, w, h))], w, h, slot).stdout
    m = re.search(r"<title>FIT (\{.*?\})</title>", out)
    if not m:  # parallel headless Edge occasionally returns nothing: retry once, alone in its own profile
        out = edge(["--virtual-time-budget=12000", "--dump-dom", furl(wrapper(page, w, h))], w, h, slot + 100).stdout
        m = re.search(r"<title>FIT (\{.*?\})</title>", out)
    return (page, w, h), (json.loads(m.group(1).replace("&quot;", '"')) if m else None)


def main(shots, only=None):
    pages = [p for p in PAGES if not only or p in only]
    jobs = [(p, w, h) for p in pages for (w, h) in viewports(p)]
    workers = 4
    with ThreadPoolExecutor(workers) as ex:
        results = dict(ex.map(measure, [(j, i % workers) for i, j in enumerate(jobs)]))
    bad = 0
    print("%-18s %-10s %-9s %-14s %s" % ("page", "viewport", "seen as", "scroll w x h", "result"))
    for page, w, h in jobs:
        r = results[(page, w, h)]
        if not r:
            print("%-18s %4dx%-5d %-9s %-14s %s" % (page, w, h, "-", "-", "NO MEASUREMENT"))
            bad += 1
            continue
        exact = (r["vw"], r["vh"]) == (w, h)
        ok = exact and r["sw"] <= r["vw"] and r["sh"] <= r["vh"] and not r["over"]
        bad += 0 if ok else 1
        note = "ok" if ok else "FAIL " + json.dumps({k: r[k] for k in ("over", "clipped") if r[k]})
        if ok and r["clipped"]:
            note += "  (internal clip: %s)" % ", ".join(r["clipped"][:3])
        print("%-18s %4dx%-5d %-9s %-14s %s" % (page, w, h, "%dx%d" % (r["vw"], r["vh"]), "%d x %d" % (r["sw"], r["sh"]), note))
    if shots:
        from pngcrop import crop
        for page in pages:
            for w, h in [v for v in viewports(page) if v in TIGHT + KEYBOARD]:
                out = os.path.join(RENDERS, "%s_%dx%d.png" % (page, w, h))
                edge(["--virtual-time-budget=12000", "--screenshot=" + out, furl(wrapper(page, w, h))], w, h)
                crop(out, w, h)  # drop the headless window chrome: leave exactly the viewport
        print("wrote renders for the tight sizes")
    print("\npages: %d, checks: %d, failures: %d" % (len(pages), len(jobs), bad))
    return bad


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a != "shots"]
    sys.exit(1 if main("shots" in sys.argv[1:], args or None) else 0)

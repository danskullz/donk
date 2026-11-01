"""Three candidate directions for the same 'Name it' reveal state, side by side (design spike)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from art import anchor_px, build, cone_path
from data import mirage_anchors

HERE = os.path.dirname(os.path.abspath(__file__))
SHOT = "../assets/valve/capture/run1/shot_03_cl-drawhud-0-r-drawviewmodel-0.png"

anchors = mirage_anchors()
m = build("de_mirage", anchors)
vx, vy, vw, vh = m["view"]
CONE = cone_path(m["info"], -638.1, -1043.5, 99.0, length=130)
cx, cy = anchor_px(m["info"], -638.1, -1043.5)


def minimap(fill_sil, fill_reg, stroke, cone, dot, wall):
    regs = "".join('<path d="%s" fill="%s"/>' % (d, fill_reg(a["state"])) for a, d in zip(anchors, m["region_paths"]))
    return ('<svg viewBox="%.0f %.0f %.0f %.0f" xmlns="http://www.w3.org/2000/svg">'
            '<path d="%s" fill="%s" stroke="%s" stroke-width="3" stroke-linejoin="round"/>%s'
            '<path d="%s" fill="none" stroke="%s" stroke-width="1.4"/>'
            '<path d="%s" fill="%s" fill-opacity=".55"/><circle cx="%.0f" cy="%.0f" r="9" fill="%s"/></svg>') % (
        vx, vy, vw, vh, m["silhouette"], fill_sil, wall, regs, m["boundaries"], stroke, CONE, cone, cx, cy, dot)


RAMP = {"new": "#26282c", "seen": "#2d3033", "learning": "#444d2a", "familiar": "#62762c", "known": "#86a232", "auto": "#c8e04a"}

CSS = """
*{box-sizing:border-box;margin:0}
body{background:#0c0d0e;color:#e8e6e1;font:14px/1.4 'IBM Plex Sans','Segoe UI',sans-serif;padding:20px;display:grid;grid-template-columns:repeat(3,620px);gap:20px;width:1960px}
h2{font:600 12px 'IBM Plex Mono',Consolas,monospace;color:#8d8a84;margin-bottom:8px;letter-spacing:.04em}
.panel{height:470px;overflow:hidden;position:relative}
img{display:block;width:100%;aspect-ratio:16/9;object-fit:cover}
svg{display:block;width:100%;height:100%}
.cond{font-family:'Barlow Condensed',Bahnschrift,'Segoe UI',sans-serif;font-stretch:75%;text-transform:uppercase}
.mono{font-family:'IBM Plex Mono','Cascadia Mono',Consolas,monospace}
/* ---------- A: survey sheet ---------- */
.A{background:#17181a;border:1px solid #34373c;padding:0;display:grid;grid-template-rows:34px 1fr 40px}
.A .bar{display:flex;align-items:center;justify-content:space-between;padding:0 14px;border-bottom:1px solid #34373c;font-size:12px;color:#a9a69f}
.A .bar b{color:#e8e6e1;letter-spacing:.08em;font-weight:600;font-size:15px}
.A .seg{display:flex;gap:2px}.A .seg i{width:10px;height:6px;background:#34373c}.A .seg i.d{background:#c8e04a}
.A .body{display:grid;grid-template-columns:1.5fr 1fr;gap:14px;padding:14px}
.A .plate{position:relative;border:1px solid #34373c}
.A .plate:before,.A .plate:after{content:"";position:absolute;width:9px;height:9px;border:1px solid #c8e04a}
.A .plate:before{left:-5px;top:-5px;border-right:0;border-bottom:0}.A .plate:after{right:-5px;bottom:-5px;border-left:0;border-top:0}
.A .cap{font-size:11px;color:#75726c;margin-top:7px;letter-spacing:.04em}
.A .verdict{border-top:2px solid #f0644a;padding-top:8px}.A .verdict small{color:#a9a69f;font-size:11px}
.A .name{font-size:46px;line-height:.95;font-weight:700;color:#c8e04a;letter-spacing:.01em}
.A .miss{font-size:15px;color:#f0644a;text-decoration:line-through;text-decoration-thickness:2px}
.A .map{height:150px;border:1px solid #34373c;margin-top:12px;padding:4px;background:#1e2023}
.A p{color:#a9a69f;font-size:13px;margin-top:10px}
.A .foot{border-top:1px solid #34373c;display:flex;align-items:center;justify-content:space-between;padding:0 14px;font-size:12px;color:#a9a69f}
.A kbd{font:500 11px 'IBM Plex Mono',Consolas,monospace;border:1px solid #4a4e54;padding:1px 6px;color:#e8e6e1}
.A .go{background:#c8e04a;color:#17181a;font-weight:700;padding:5px 14px;clip-path:polygon(0 0,calc(100% - 7px) 0,100% 7px,100% 100%,0 100%)}
/* ---------- B: broadcast overlay ---------- */
.B{background:#0e1114;position:relative}
.B .hero{position:absolute;inset:0 0 auto 0;height:360px}.B .hero img{height:100%;aspect-ratio:auto}
.B .top{position:absolute;left:0;right:0;top:0;height:44px;display:flex;align-items:center;gap:14px;padding:0 18px;background:#0e1114d9}
.B .top .n{font-size:30px;font-weight:700;font-style:italic;color:#fff}.B .top .t{font-size:13px;color:#9aa4ae;letter-spacing:.1em}
.B .ct{width:6px;height:26px;background:#5aa0e6}
.B .tag{position:absolute;left:18px;bottom:130px;background:#0e1114ee;padding:8px 18px 8px 14px;border-left:6px solid #f0644a;clip-path:polygon(0 0,100% 0,calc(100% - 14px) 100%,0 100%)}
.B .tag .name{font-size:54px;font-weight:700;font-style:italic;color:#fff;line-height:.9}.B .tag small{display:block;color:#f0644a;font-size:13px;letter-spacing:.12em}
.B .mm{position:absolute;right:16px;top:60px;width:190px;height:190px;background:#0e1114d9;border:2px solid #5aa0e6;border-radius:50%;padding:12px;overflow:hidden}
.B .row{position:absolute;left:0;right:0;bottom:0;height:110px;background:#161a1e;display:flex;align-items:center;gap:18px;padding:0 18px;color:#9aa4ae}
.B .row b{color:#fff;font-size:24px;font-style:italic}.B .btn{margin-left:auto;background:#5aa0e6;color:#06121f;padding:10px 26px;font-weight:700;font-style:italic;font-size:20px;clip-path:polygon(12px 0,100% 0,calc(100% - 12px) 100%,0 100%)}
/* ---------- C: terminal ---------- */
.C{background:#1c1d1f;padding:22px 26px;font-family:'IBM Plex Mono','Cascadia Mono',Consolas,monospace;color:#d1d0c5;display:grid;grid-template-columns:1.45fr 1fr;gap:24px}
.C .l{display:flex;flex-direction:column;gap:12px}.C .r{display:flex;flex-direction:column;gap:12px}
.C .sub{color:#6c6e72;font-size:12px}.C .main{color:#c8e04a}.C .err{color:#d96a5a}
.C .line{font-size:13px}.C .big{font-size:34px;color:#c8e04a;font-weight:500}
.C .map{height:160px;margin-top:4px}.C kbd{color:#c8e04a}
"""

A = f"""<section class="panel A">
<div class="bar mono"><span><b class="cond">MIRAGE</b> &nbsp;NAME IT</span><span class="seg">{''.join('<i class="d"></i>' for _ in range(7))}{''.join('<i></i>' for _ in range(13))}</span><span>7 / 20 &nbsp; 02.4s</span></div>
<div class="body"><div><div class="plate"><img src="{SHOT}"></div><div class="cap mono">PLATE 07 &nbsp;·&nbsp; CONNECTOR &nbsp;·&nbsp; EYE -146.1 &nbsp;·&nbsp; FACING N</div>
<p style="margin-top:14px">Short passage joining Mid to the A side, under the arch.</p></div>
<div><div class="verdict"><small class="mono">YOU CHOSE</small><div class="miss cond">Window</div><small class="mono" style="display:block;margin-top:8px">IT IS</small><div class="name cond">Connector</div></div>
<div class="map">{minimap('#3a3e43', lambda s: RAMP[s], '#17181a', '#c8e04a', '#c8e04a', '#4a4e54')}</div></div></div>
<div class="foot mono"><span>game name: Connector &nbsp;·&nbsp; next to Window, Top Mid</span><span><kbd>Space</kbd> &nbsp;<span class="go cond">CONTINUE</span></span></div></section>"""

B = f"""<section class="panel B"><div class="hero"><img src="{SHOT}"></div>
<div class="top cond"><span class="ct"></span><span class="n">07</span><span class="t">/ 20 &nbsp; NAME IT &nbsp; MIRAGE</span></div>
<div class="mm">{minimap('#5b6670', lambda s: {'new':'#3a444d','seen':'#46525c','learning':'#4f6f8f','familiar':'#5a8fc0','known':'#76b0e8','auto':'#a9d2f5'}[s], '#0e1114', '#f0644a', '#f0644a', '#2c343b')}</div>
<div class="tag cond"><small>YOU CHOSE WINDOW</small><div class="name">Connector</div></div>
<div class="row cond"><span>NEXT TO &nbsp;<b>WINDOW</b> &nbsp;<b>TOP MID</b></span><span class="btn">CONTINUE</span></div></section>"""

C = f"""<section class="panel C"><div class="l"><div class="sub">mirage / name it / 7 of 20</div><img src="{SHOT}" style="margin-top:2px">
<div class="line sub">eye -146.1 &nbsp; facing north &nbsp; 1920x1080</div><div class="line">short passage joining mid to the a side, under the arch.</div></div>
<div class="r"><div class="line err">&gt; window &nbsp;&nbsp;x</div><div class="big">connector</div><div class="line sub">game name: connector</div>
<div class="map">{minimap('#2b2d30', lambda s: {'new':'#2b2d30','seen':'#33363a','learning':'#3e4630','familiar':'#566530','known':'#76902f','auto':'#c8e04a'}[s], '#1c1d1f', '#c8e04a', '#c8e04a', '#44474b')}</div>
<div class="line sub" style="margin-top:auto"><kbd>space</kbd> next &nbsp; <kbd>h</kbd> hint &nbsp; <kbd>esc</kbd> leave</div></div></section>"""

HTML = f"""<!doctype html><meta charset="utf-8"><title>Directions</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@0,500;0,600;0,700;1,700&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500&display=swap">
<style>{CSS}</style>
<div><h2>A  SURVEY SHEET</h2>{A}</div><div><h2>B  BROADCAST OVERLAY</h2>{B}</div><div><h2>C  TERMINAL</h2>{C}</div>"""

open(os.path.join(HERE, "directions.html"), "w", encoding="utf-8").write(HTML)
print("directions.html written", len(HTML))

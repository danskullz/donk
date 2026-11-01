"""Export nav geometry for every candidate map and check it against known floor positions.

For each map: parse vertices + polygons (nav.py), confirm Valve's retake spawn positions fall
inside a polygon (x/y containment, z close to the polygon surface), and write
<out_root>/nav/<map>.json. Optionally draws one map's polygons over its radar.

usage: python -I nav_export.py <out_root> [overlay_map overlay_png]
"""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from extract_thumbs import encode_png  # noqa: E402
from nav import parse_geometry, read_nav  # noqa: E402
from radar import MAPS, load_bgra, open_pak01, radar_path, read_overview  # noqa: E402
from validate_projection import level_for, project, read_spawns  # noqa: E402


def triangles(verts, polys):
    """Fan-triangulate every polygon. Returns (tris (T,3,3), owner area index (T,))."""
    tris, owner = [], []
    for ai, p in enumerate(polys):
        for k in range(1, len(p) - 1):
            tris.append((verts[p[0]], verts[p[k]], verts[p[k + 1]]))
            owner.append(ai)
    return np.array(tris, dtype=np.float64), np.array(owner)


def locate(tris, owner, x, y, z):
    """Best triangle containing (x, y); returns (area index, |dz|) or (None, None)."""
    a, b, c = tris[:, 0], tris[:, 1], tris[:, 2]
    d = (b[:, 1] - c[:, 1]) * (a[:, 0] - c[:, 0]) + (c[:, 0] - b[:, 0]) * (a[:, 1] - c[:, 1])
    ok = np.abs(d) > 1e-9
    l1 = np.where(ok, ((b[:, 1] - c[:, 1]) * (x - c[:, 0]) + (c[:, 0] - b[:, 0]) * (y - c[:, 1])) / np.where(ok, d, 1), -1)
    l2 = np.where(ok, ((c[:, 1] - a[:, 1]) * (x - c[:, 0]) + (a[:, 0] - c[:, 0]) * (y - c[:, 1])) / np.where(ok, d, 1), -1)
    l3 = 1 - l1 - l2
    inside = ok & (l1 >= -1e-6) & (l2 >= -1e-6) & (l3 >= -1e-6)
    idx = np.nonzero(inside)[0]
    if not len(idx):
        return None, None
    zs = l1[idx] * a[idx, 2] + l2[idx] * b[idx, 2] + l3[idx] * c[idx, 2]
    best = int(np.argmin(np.abs(zs - z)))
    return int(owner[idx[best]]), float(abs(zs[best] - z))


def main(out_root, overlay_map=None, overlay_png=None):
    vpk = open_pak01()
    out_dir = os.path.join(out_root, "nav")
    os.makedirs(out_dir, exist_ok=True)
    print("%-12s %6s %6s  %-14s  %s" % ("map", "verts", "areas", "polygon sizes", "retake spawns inside a polygon (|dz| <= 40)"))
    for m in MAPS:
        nav = read_nav(m)
        try:
            verts, polys, end = parse_geometry(nav)
        except Exception as exc:
            print("%-12s FAILED: %s" % (m, exc))
            continue
        tris, owner = triangles(verts, polys)
        spawns = read_spawns(vpk, m)
        inside = 0
        dzs = []
        for s in spawns:
            area, dz = locate(tris, owner, s["x"], s["y"], s["z"])
            if area is not None and dz <= 40:
                inside += 1
            if dz is not None:
                dzs.append(dz)
        sizes = np.bincount([len(p) for p in polys])
        sz = " ".join("%d:%d" % (i, c) for i, c in enumerate(sizes) if c)
        print("%-12s %6d %6d  %-14s  %d/%d (median |dz| %.1f)" % (
            m, len(verts), len(polys), sz, inside, len(spawns), float(np.median(dzs)) if dzs else float("nan")))
        with open(os.path.join(out_dir, m + ".json"), "w", encoding="utf-8") as f:
            json.dump({
                "map": m,
                "vertices": [[round(float(v), 2) for v in row] for row in verts],
                "polygons": [list(p) for p in polys],
            }, f, separators=(",", ":"))

    if overlay_map:
        info = read_overview(vpk, overlay_map)
        base = load_bgra(vpk, radar_path(overlay_map))
        alpha = base[..., 3:4].astype(np.float32) / 255.0
        canvas = (np.array([28, 30, 34], dtype=np.float32) * (1 - alpha) + base[..., :3].astype(np.float32) * alpha).astype(np.uint8)
        verts, polys, _ = parse_geometry(read_nav(overlay_map))
        px = np.array([project(float(v[0]), float(v[1]), info) for v in verts])
        for p in polys:
            for k in range(len(p)):
                x0, y0 = px[p[k]]
                x1, y1 = px[p[(k + 1) % len(p)]]
                steps = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
                xs = np.rint(np.linspace(x0, x1, steps)).astype(int)
                ys = np.rint(np.linspace(y0, y1, steps)).astype(int)
                keep = (xs >= 0) & (xs < 1024) & (ys >= 0) & (ys < 1024)
                canvas[ys[keep], xs[keep]] = (64, 220, 255)
        rgba = np.concatenate([canvas, np.full(canvas.shape[:2] + (1,), 255, dtype=np.uint8)], axis=-1)
        with open(overlay_png, "wb") as f:
            f.write(encode_png(rgba))
        print("overlay written:", overlay_png)


if __name__ == "__main__":
    a = sys.argv[1:]
    main(a[0], a[1] if len(a) > 1 else None, a[2] if len(a) > 2 else None)

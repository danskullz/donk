"""Vector map art from the decoded nav mesh (design spike).

Projects the nav polygons into radar pixel space, groups them into sample regions, and emits SVG
fragments: a seamless fill path per region, region boundaries, and a silhouette. Region membership
here is a nearest-anchor split of the real walkable surface; real regions will be painted in the
Callout Editor (SCOPE.md section 8.3).
"""
import json
import math
import os

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets", "valve")


def load(map_name):
    with open(os.path.join(ASSETS, "nav", map_name + ".json"), encoding="utf-8") as f:
        nav = json.load(f)
    with open(os.path.join(ASSETS, "overviews", "overviews.json"), encoding="utf-8") as f:
        info = json.load(f)["maps"][map_name]
    return np.array(nav["vertices"], dtype=np.float64), nav["polygons"], info


def to_px(verts, info):
    px = (verts[:, 0] - info["posX"]) / info["scale"]
    py = (info["posY"] - verts[:, 1]) / info["scale"]
    return np.stack([px, py], axis=1)


def assign_regions(verts, polys, anchors, z_weight=2.5):
    """anchors: list of (x, y, z). Returns a region index per polygon (nearest anchor, z weighted)."""
    cents = np.array([verts[list(p)].mean(axis=0) for p in polys])
    a = np.array(anchors, dtype=np.float64)
    d = ((cents[:, None, 0] - a[None, :, 0]) ** 2 + (cents[:, None, 1] - a[None, :, 1]) ** 2
         + (z_weight * (cents[:, None, 2] - a[None, :, 2])) ** 2)
    return d.argmin(axis=1)


def _fmt(v):
    return ("%.1f" % v).rstrip("0").rstrip(".")


def poly_d(px, p):
    pts = [px[i] for i in p]
    return "M" + "L".join("%s %s" % (_fmt(x), _fmt(y)) for x, y in pts) + "Z"


def build(map_name, anchors=None, pad=26):
    verts, polys, info = load(map_name)
    px = to_px(verts, info)
    used = sorted({i for p in polys for i in p})
    lo = px[used].min(axis=0) - pad
    hi = px[used].max(axis=0) + pad
    view = (lo[0], lo[1], hi[0] - lo[0], hi[1] - lo[1])
    out = {"view": view, "px": px, "info": info, "polys": polys, "verts": verts}
    out["silhouette"] = "".join(poly_d(px, p) for p in polys)
    if anchors:
        region = assign_regions(verts, polys, [(a["x"], a["y"], a["z"]) for a in anchors])
        out["region"] = region
        paths = []
        for r in range(len(anchors)):
            paths.append("".join(poly_d(px, p) for p, rr in zip(polys, region) if rr == r))
        out["region_paths"] = paths
        # boundaries: edges shared by polygons that belong to different regions
        edge_owner = {}
        for ai, p in enumerate(polys):
            for k in range(len(p)):
                e = tuple(sorted((p[k], p[(k + 1) % len(p)])))
                edge_owner.setdefault(e, []).append(ai)
        segs = []
        for (a, b), owners in edge_owner.items():
            if len(owners) == 2 and region[owners[0]] != region[owners[1]]:
                segs.append("M%s %sL%s %s" % (_fmt(px[a][0]), _fmt(px[a][1]), _fmt(px[b][0]), _fmt(px[b][1])))
        out["boundaries"] = "".join(segs)
    return out


def anchor_px(info, x, y):
    return ((x - info["posX"]) / info["scale"], (info["posY"] - y) / info["scale"])


def cone_path(info, x, y, yaw_deg, length=120.0, half_fov=53.0):
    """Camera wedge in radar px. CS yaw 0 = +x, 90 = +y (north); screen y is flipped."""
    cx, cy = anchor_px(info, x, y)
    pts = []
    for off in (-half_fov, half_fov):
        a = math.radians(yaw_deg + off)
        pts.append((cx + length * math.cos(a), cy - length * math.sin(a)))
    return "M%s %sL%s %sL%s %sZ" % (_fmt(cx), _fmt(cy), _fmt(pts[0][0]), _fmt(pts[0][1]), _fmt(pts[1][0]), _fmt(pts[1][1]))

"""Check the world -> radar projection against Valve's own annotation positions.

Each annotation file lists standing positions (grenade throw spots) in world units. If the
projection in the overview file is right, those points must land on walkable (covered)
radar pixels; a wrong projection should only hit them by chance.

usage: python -I validate_projection.py [overlay_map] [overlay_out.png]
"""
import os
import re
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from extract_thumbs import encode_png  # noqa: E402
from radar import MAPS, load_bgra, open_pak01, radar_path, read_overview  # noqa: E402

N = 1024
NODE = re.compile(r"MapAnnotationNode\d+\s*=\s*\{(.*?)\n\t\}", re.S)
NUM = r"(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)"
POS = re.compile(r"Position\s*=\s*\[\s*%s,\s*%s,\s*%s\s*\]" % (NUM, NUM, NUM))
SUBTYPE = re.compile(r'SubType\s*=\s*"(\w+)"')
TITLE = re.compile(r'Title\s*=\s*\{\s*Text\s*=\s*"([^"]*)"')


SPAWN = re.compile(r'"\d+"\s+"' + " ".join([NUM] * 6) + r'"[ \t]*(?://[ \t]*([^\n]*))?')


def read_spawns(vpk, map_name):
    """Retake spawn positions (x y z pitch yaw roll) with Valve's short location labels."""
    path = "maps/%s_retake.txt" % map_name
    if path not in vpk.entries:
        return []
    text = vpk.read(path).decode("utf-8", "replace")
    out = []
    for m in SPAWN.finditer(text):
        x, y, z, pitch, yaw, _roll = (float(v) for v in m.groups()[:6])
        label = (m.group(7) or "").strip()
        out.append({"x": x, "y": y, "z": z, "pitch": pitch, "yaw": yaw, "sub": "spawn", "title": label})
    return out


def read_nodes(vpk, map_name):
    path = "annotations/official/%s/%s.txt" % (map_name, map_name)
    if path not in vpk.entries:
        return []
    text = vpk.read(path).decode("utf-8", "replace")
    nodes = []
    for body in NODE.findall(text):
        p = POS.search(body)
        if not p:
            continue
        sub = SUBTYPE.search(body)
        title = TITLE.search(body)
        nodes.append({
            "x": float(p.group(1)), "y": float(p.group(2)), "z": float(p.group(3)),
            "sub": sub.group(1) if sub else "",
            "title": title.group(1) if title else "",
        })
    return nodes


def level_for(info, z):
    """Pick the radar level for a world height using the overview's altitude cut-offs."""
    for lv in info["levels"]:
        if "altitudeMax" not in lv:
            return lv["id"]
        if lv["altitudeMin"] <= z < lv["altitudeMax"]:
            return lv["id"]
    return info["levels"][0]["id"]


def project(x, y, info, mode="standard"):
    u = (x - info["posX"]) / info["scale"]
    v = (info["posY"] - y) / info["scale"]
    return {
        "standard": (u, v),
        "flipY": (u, N - v),
        "flipX": (N - u, v),
        "swap": (v, u),
        "rotCW": (N - 1 - v, u),
        "rotCCW": (v, N - 1 - u),
    }[mode]


def hit(mask, px, py, radius=2):
    ix, iy = int(round(px)), int(round(py))
    if ix < 0 or iy < 0 or ix >= N or iy >= N:
        return False
    return bool(mask[max(iy - radius, 0):iy + radius + 1, max(ix - radius, 0):ix + radius + 1].any())


def score(nodes, info, masks, mode):
    hits = total = 0
    for n in nodes:
        px, py = project(n["x"], n["y"], info, mode)
        total += 1
        hits += hit(masks[level_for(info, n["z"])], px, py)
    return hits / total if total else float("nan"), total


def main(overlay_map=None, overlay_out=None):
    vpk = open_pak01()
    modes = ["standard", "flipY", "flipX", "swap", "rotCW", "rotCCW"]
    print("share of standing positions landing on walkable radar pixels (random chance ~ map coverage)\n")
    print("%-12s %5s  %s" % ("map", "nodes", "  ".join("%8s" % m for m in modes)))
    arrays = {}
    for m in MAPS:
        info = read_overview(vpk, m)
        masks = {}
        for lv in info["levels"]:
            arr = load_bgra(vpk, radar_path(m, lv["id"]))
            arrays[(m, lv["id"])] = arr
            masks[lv["id"]] = arr[..., 3] > 16
        nodes = [n for n in read_nodes(vpk, m) if n["sub"] == "main"] + read_spawns(vpk, m)
        scores = []
        for mode in modes:
            s, total = score(nodes, info, masks, mode)
            scores.append(s)
        best = modes[int(np.argmax(scores))]
        print("%-12s %5d  %s   best=%s%s" % (
            m, len(nodes), "  ".join("%7.0f%%" % (s * 100) for s in scores), best,
            "  (rotate=%d)" % info["rotate"] if info["rotate"] else ""))
        for n in nodes:
            px, py = project(n["x"], n["y"], info)
            if not hit(masks[level_for(info, n["z"])], px, py):
                print("      miss: %-28r world(%7.1f, %7.1f, %7.1f) -> px(%6.1f, %6.1f) level=%s" % (
                    n["title"], n["x"], n["y"], n["z"], px, py, level_for(info, n["z"])))

    if overlay_map:
        info = read_overview(vpk, overlay_map)
        base = arrays[(overlay_map, "default")]
        alpha = base[..., 3:4].astype(np.float32) / 255.0
        canvas = (np.array([28, 30, 34], dtype=np.float32) * (1 - alpha) + base[..., :3].astype(np.float32) * alpha)
        canvas = canvas.astype(np.uint8)
        nodes = read_nodes(vpk, overlay_map) + read_spawns(vpk, overlay_map)
        for n in nodes:
            px, py = project(n["x"], n["y"], info)
            colour = {"main": (255, 64, 64), "spawn": (255, 214, 64)}.get(n["sub"], (64, 220, 255))
            x0, y0 = int(round(px)), int(round(py))
            canvas[max(y0 - 4, 0):y0 + 5, max(x0 - 4, 0):x0 + 5] = colour
        rgba = np.concatenate([canvas, np.full(canvas.shape[:2] + (1,), 255, dtype=np.uint8)], axis=-1)
        with open(overlay_out, "wb") as f:
            f.write(encode_png(rgba))
        print("\noverlay written:", overlay_out, "(yellow = retake spawns, red = lineup spots, cyan = aim targets,", len(nodes), "nodes)")


if __name__ == "__main__":
    args = sys.argv[1:]
    main(args[0] if args else None, args[1] if len(args) > 1 else None)

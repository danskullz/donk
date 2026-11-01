"""Radar images and overview (projection) data from the local CS2 install.

Read-only on the game folder. Reuses the texture helpers from extract_thumbs.py.

usage:
  python -I radar.py extract <out_root>   # radars -> <out_root>/radars, overview data -> <out_root>/overviews
"""
import json
import os
import re
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from extract_thumbs import CS2_ROOT, build_id, decompress, encode_png, vtex_info  # noqa: E402
from vpk import Vpk  # noqa: E402

MAPS = [
    "de_ancient", "de_anubis", "de_cache", "de_dust2", "de_inferno",
    "de_mirage", "de_nuke", "de_overpass", "de_train", "de_vertigo",
]
FMT_BGRA8888 = 28
RADAR_DIR = "panorama/images/overheadmaps/"


def open_pak01():
    return Vpk(os.path.join(CS2_ROOT, "game", "csgo", "pak01_dir.vpk"))


def load_bgra(vpk, path):
    """Return the base mip of a BGRA8888 texture as an (h, w, 4) RGBA uint8 array."""
    blob = vpk.read(path)
    fmt, w, h, mips, header_end = vtex_info(blob)
    if fmt != FMT_BGRA8888 or mips != 1:
        raise ValueError("%s: format %d with %d mips is not a single-mip BGRA texture" % (path, fmt, mips))
    expected = w * h * 4
    data = blob[header_end:]
    raw = data if len(data) == expected else decompress(data, expected)
    arr = np.frombuffer(raw, dtype=np.uint8).reshape(h, w, 4)
    return arr[..., [2, 1, 0, 3]].copy()


def parse_kv(text):
    """Parse Valve KeyValues text (the overview files) into nested dicts."""
    toks = [t for t in re.findall(r'//[^\n]*|"[^"]*"|[{}]|[^\s{}"]+', text) if not t.startswith("//")]
    pos = 0

    def block():
        nonlocal pos
        out = {}
        while pos < len(toks):
            t = toks[pos]
            pos += 1
            if t == "}":
                return out
            value = toks[pos]
            pos += 1
            if value == "{":
                out[t.strip('"')] = block()
            else:
                out[t.strip('"')] = value.strip('"')
        return out

    return block()


def read_overview(vpk, map_name):
    """Projection and level data for one map, as plain numbers."""
    raw = parse_kv(vpk.read("resource/overviews/%s.txt" % map_name).decode("utf-8", "replace"))
    kv = raw[map_name]
    info = {
        "posX": float(kv["pos_x"]),
        "posY": float(kv["pos_y"]),
        "scale": float(kv["scale"]),
        "rotate": int(float(kv.get("rotate", 0))),
        "zoom": float(kv.get("zoom", 0)),
        "material": kv.get("material"),
        "levels": [],
    }
    sections = kv.get("verticalsections")
    if sections:
        for name, s in sections.items():
            info["levels"].append({"id": name, "altitudeMax": float(s["AltitudeMax"]), "altitudeMin": float(s["AltitudeMin"])})
    else:
        info["levels"].append({"id": "default"})
    for key in ("CTSpawn", "TSpawn", "bombA", "bombB"):
        if key + "_x" in kv:
            info[key] = [float(kv[key + "_x"]), float(kv[key + "_y"])]  # fractions of the radar image
    return info


def radar_path(map_name, level="default"):
    stem = map_name if level == "default" else "%s_%s" % (map_name, level)
    return "%s%s_radar_psd.vtex_c" % (RADAR_DIR, stem)


def main_extract(out_root):
    vpk = open_pak01()
    radar_out = os.path.join(out_root, "radars")
    over_out = os.path.join(out_root, "overviews")
    os.makedirs(radar_out, exist_ok=True)
    os.makedirs(over_out, exist_ok=True)

    overviews = {"gameBuildId": build_id(), "maps": {}}
    for m in MAPS:
        info = read_overview(vpk, m)
        for level in info["levels"]:
            path = radar_path(m, level["id"])
            if path not in vpk.entries:
                level["radar"] = None
                continue
            arr = load_bgra(vpk, path)
            name = "%s.png" % m if level["id"] == "default" else "%s_%s.png" % (m, level["id"])
            with open(os.path.join(radar_out, name), "wb") as f:
                f.write(encode_png(arr))
            opaque = float((arr[..., 3] > 16).mean())
            level["radar"] = name
            level["radarSize"] = [arr.shape[1], arr.shape[0]]
            level["coveredFraction"] = round(opaque, 3)
            print("%-30s %dx%d  covered %.0f%%" % (name, arr.shape[1], arr.shape[0], opaque * 100))
        overviews["maps"][m] = info
        with open(os.path.join(over_out, m + ".txt"), "wb") as f:
            f.write(vpk.read("resource/overviews/%s.txt" % m))

    with open(os.path.join(over_out, "overviews.json"), "w", encoding="utf-8") as f:
        json.dump(overviews, f, indent=2)
    print("\nwrote overviews.json for %d maps" % len(overviews["maps"]))


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "extract":
        main_extract(sys.argv[2])
    else:
        print(__doc__)

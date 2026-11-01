"""Reader for the geometry part of CS2 navigation meshes (maps/<map>.nav, version 36).

Phase 0 spike, reverse-engineered from the file itself (no documentation found), so every
step is checked against the data. Standard library plus numpy; read-only on the game folder.

What is decoded so far:
  offset 145            u32  vertex count V
  offset 149            V x (f32 x, f32 y, f32 z)   world-space vertex pool
  right after the pool  u32  area count A
                        A x [u8 n][n x u32 vertex index][u32 0xFFFFFFFF]   one polygon per area
What follows the polygons is still being worked out (see decode_tail).
"""
import os
import struct
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from radar import CS2_ROOT  # noqa: E402
from vpk import Vpk  # noqa: E402

VERTEX_COUNT_OFFSET = 145


def read_nav(map_name):
    vpk = Vpk(os.path.join(CS2_ROOT, "game", "csgo", "maps", map_name + ".vpk"))
    return vpk.read("maps/%s.nav" % map_name)


def parse_geometry(nav):
    """Return (vertices (V,3) float32, polygons list of tuples, end_offset)."""
    (count,) = struct.unpack_from("<I", nav, VERTEX_COUNT_OFFSET)
    start = VERTEX_COUNT_OFFSET + 4
    verts = np.frombuffer(nav, dtype="<f4", count=count * 3, offset=start).reshape(count, 3)
    pos = start + count * 12
    (areas,) = struct.unpack_from("<I", nav, pos)
    pos += 4
    polys = []
    for i in range(areas):
        n = nav[pos]
        pos += 1
        idx = struct.unpack_from("<%dI" % n, nav, pos)
        pos += 4 * n
        (term,) = struct.unpack_from("<I", nav, pos)
        pos += 4
        if term != 0xFFFFFFFF:
            raise ValueError("area %d: bad terminator 0x%08x at %d" % (i, term, pos - 4))
        if idx and max(idx) >= count:
            raise ValueError("area %d: vertex index %d out of range" % (i, max(idx)))
        polys.append(idx)
    return verts, polys, pos


if __name__ == "__main__":
    name = sys.argv[1] if len(sys.argv) > 1 else "de_mirage"
    nav = read_nav(name)
    verts, polys, end = parse_geometry(nav)
    sizes = np.bincount([len(p) for p in polys])
    print("%s: %d bytes, %d vertices, %d areas; geometry ends at byte %d (%.0f%% of file)" % (
        name, len(nav), len(verts), len(polys), end, 100.0 * end / len(nav)))
    print("polygon sizes (vertex count: areas):", {i: int(c) for i, c in enumerate(sizes) if c})
    print("vertex bounds: x %.0f..%.0f  y %.0f..%.0f  z %.0f..%.0f" % (
        verts[:, 0].min(), verts[:, 0].max(), verts[:, 1].min(), verts[:, 1].max(), verts[:, 2].min(), verts[:, 2].max()))
    print("\nu32 words after the polygons:")
    words = struct.unpack_from("<48I", nav, end)
    for r in range(0, 48, 8):
        print("  %6d: %s" % (end + 4 * r, " ".join("%10d" % w for w in words[r:r + 8])))

"""Extract Valve's map-vote thumbnails from the local CS2 install into assets/.

Read-only on the game folder. Dependencies: the standard library plus numpy (only used
for the rare DXT5 textures). Most thumbnails are Source 2 textures whose pixel data is
an embedded PNG (vtex format 16 or 18), so extraction is slicing the PNG out and
checking it. A few are raw DXT5 (scaled YCoCg, LZ4- or zstd-compressed); those are decoded.

usage: python -I extract_thumbs.py <out_dir> [map ...]
"""
import hashlib
import json
import os
import re
import struct
import sys
import zlib

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vpk import Vpk  # noqa: E402

CS2_ROOT = r"C:\Program Files (x86)\Steam\steamapps\common\Counter-Strike Global Offensive"
STEAM_APPS = r"C:\Program Files (x86)\Steam\steamapps"
THUMB_DIR = "panorama/images/map_icons/screenshots/1080p/"
DEFAULT_MAPS = [
    "de_ancient", "de_anubis", "de_cache", "de_dust2", "de_inferno",
    "de_mirage", "de_nuke", "de_overpass", "de_train", "de_vertigo",
]
PNG_SIG = b"\x89PNG\r\n\x1a\n"
FMT_DXT5 = 2
PNG_FORMATS = {16: "PNG_RGBA8888", 18: "PNG_DXT5"}


def build_id():
    path = os.path.join(STEAM_APPS, "appmanifest_730.acf")
    with open(path, encoding="utf-8", errors="replace") as f:
        m = re.search(r'"buildid"\s+"(\d+)"', f.read())
    return m.group(1) if m else None


def vtex_info(blob):
    """Return (format, width, height, mip_count, header_end) from a compiled texture."""
    file_size, _hdr_ver, _ver, block_off, block_count = struct.unpack_from("<IHHII", blob, 0)
    pos = 8 + block_off
    for _ in range(block_count):
        kind = blob[pos:pos + 4]
        off, size = struct.unpack_from("<II", blob, pos + 4)
        if kind == b"DATA":
            start = pos + 4 + off
            # u16 version, u16 flags, 4 x f32 reflectivity, then width, height, depth, format, mips
            width, height, _depth, fmt, mips = struct.unpack_from("<HHHBB", blob, start + 20)
            return fmt, width, height, mips, file_size
        pos += 12
    raise ValueError("no DATA block")


def slice_png(blob, search_from):
    """Cut the embedded PNG out of the blob and validate every chunk."""
    start = blob.find(PNG_SIG, search_from)
    if start < 0:
        raise ValueError("no PNG signature after header")
    pos = start + 8
    ihdr = None
    while True:
        length, ctype = struct.unpack_from(">I4s", blob, pos)
        data = blob[pos + 8:pos + 8 + length]
        (crc,) = struct.unpack_from(">I", blob, pos + 8 + length)
        if zlib.crc32(ctype + data) & 0xFFFFFFFF != crc:
            raise ValueError("bad CRC in chunk %r" % ctype)
        if ctype == b"IHDR":
            ihdr = struct.unpack(">II", data[:8])
        pos += 12 + length
        if ctype == b"IEND":
            break
    return blob[start:pos], ihdr


def lz4_block_decompress(src):
    """Raw LZ4 block decoder (no frame header)."""
    dst = bytearray()
    i, n = 0, len(src)
    while i < n:
        token = src[i]
        i += 1
        lit = token >> 4
        if lit == 15:
            while True:
                b = src[i]
                i += 1
                lit += b
                if b != 255:
                    break
        dst += src[i:i + lit]
        i += lit
        if i >= n:
            break
        offset = src[i] | (src[i + 1] << 8)
        i += 2
        match = token & 15
        if match == 15:
            while True:
                b = src[i]
                i += 1
                match += b
                if b != 255:
                    break
        match += 4
        start = len(dst) - offset
        if offset >= match:
            dst += dst[start:start + match]
        else:  # overlapping copy repeats the last `offset` bytes
            dst += (bytes(dst[start:]) * (match // offset + 1))[:match]
    return bytes(dst)


def decompress(data, expected):
    if data[:4] == b"\x28\xb5\x2f\xfd":
        import zstandard
        out = zstandard.ZstdDecompressor().decompress(data, max_output_size=expected)
    else:
        out = lz4_block_decompress(data)
    if len(out) != expected:
        raise ValueError("decompressed %d bytes, expected %d" % (len(out), expected))
    return out


def _rgb565(c):
    r = (c >> 11) & 31
    g = (c >> 5) & 63
    b = c & 31
    return np.stack([(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)], axis=-1).astype(np.int32)


def decode_dxt5(data, w, h):
    """Decode a BC3/DXT5 surface to an (h, w, 4) uint8 array."""
    bw, bh = (w + 3) // 4, (h + 3) // 4
    n = bw * bh
    blk = np.frombuffer(data, dtype=np.uint8, count=n * 16).reshape(n, 16)

    a0 = blk[:, 0].astype(np.int32)
    a1 = blk[:, 1].astype(np.int32)
    ab = blk[:, 2:8].astype(np.uint64)
    bits = ab[:, 0] | (ab[:, 1] << 8) | (ab[:, 2] << 16) | (ab[:, 3] << 24) | (ab[:, 4] << 32) | (ab[:, 5] << 40)
    aidx = ((bits[:, None] >> (np.arange(16, dtype=np.uint64) * 3)[None, :]) & 7).astype(np.int64)
    apal = np.zeros((n, 8), dtype=np.int32)
    apal[:, 0], apal[:, 1] = a0, a1
    six = a0 > a1
    for i in range(1, 7):
        apal[:, 1 + i] = np.where(six, ((7 - i) * a0 + i * a1) // 7, 0)
    for i in range(1, 5):
        apal[:, 1 + i] = np.where(six, apal[:, 1 + i], ((5 - i) * a0 + i * a1) // 5)
    apal[:, 6] = np.where(six, apal[:, 6], 0)
    apal[:, 7] = np.where(six, apal[:, 7], 255)
    alpha = np.take_along_axis(apal, aidx, axis=1)

    c0 = blk[:, 8].astype(np.int32) | (blk[:, 9].astype(np.int32) << 8)
    c1 = blk[:, 10].astype(np.int32) | (blk[:, 11].astype(np.int32) << 8)
    p0, p1 = _rgb565(c0), _rgb565(c1)
    cpal = np.stack([p0, p1, (2 * p0 + p1) // 3, (p0 + 2 * p1) // 3], axis=1)  # (n, 4, 3)
    cb = blk[:, 12:16].astype(np.uint32)
    cbits = cb[:, 0] | (cb[:, 1] << 8) | (cb[:, 2] << 16) | (cb[:, 3] << 24)
    cidx = ((cbits[:, None] >> (np.arange(16, dtype=np.uint32) * 2)[None, :]) & 3).astype(np.int64)
    rgb = cpal[np.arange(n)[:, None], cidx]  # (n, 16, 3)

    px = np.concatenate([rgb, alpha[..., None]], axis=-1).astype(np.uint8)  # (n, 16, 4)
    px = px.reshape(bh, bw, 4, 4, 4).transpose(0, 2, 1, 3, 4).reshape(bh * 4, bw * 4, 4)
    return px[:h, :w]


def ycocg_to_rgba(px):
    """Scaled YCoCg (Y in alpha, Co/Cg in R/G, scale in B) back to opaque RGBA."""
    f = px.astype(np.float32)
    scale = f[..., 2] / 8.0 + 1.0
    co = (f[..., 0] - 128.0) / scale
    cg = (f[..., 1] - 128.0) / scale
    y = f[..., 3]
    rgb = np.stack([y + co - cg, y + cg, y - co - cg], axis=-1)
    out = np.empty(px.shape, dtype=np.uint8)
    out[..., :3] = np.clip(np.rint(rgb), 0, 255).astype(np.uint8)
    out[..., 3] = 255
    return out


def encode_png(pixels):
    """Encode an (h, w, 4) uint8 array; drops alpha when it is fully opaque."""
    h, w, _ = pixels.shape
    if (pixels[..., 3] == 255).all():
        pixels, ctype, ch = pixels[..., :3], 2, 3
    else:
        ctype, ch = 6, 4
    raw = np.concatenate([np.zeros((h, 1), dtype=np.uint8), np.ascontiguousarray(pixels).reshape(h, w * ch)], axis=1)

    def chunk(kind, body):
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF)

    return (PNG_SIG + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, ctype, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw.tobytes(), 6)) + chunk(b"IEND", b""))


def extract(blob):
    """Return (png_bytes, width, height, how) for one compiled thumbnail texture."""
    fmt, w, h, mips, header_end = vtex_info(blob)
    if fmt in PNG_FORMATS:
        png, (pw, ph) = slice_png(blob, header_end)
        if (pw, ph) != (w, h):
            raise ValueError("header says %dx%d but PNG is %dx%d" % (w, h, pw, ph))
        return png, w, h, "embedded " + PNG_FORMATS[fmt]
    if fmt == FMT_DXT5 and mips == 1:
        expected = ((w + 3) // 4) * ((h + 3) // 4) * 16
        data = blob[header_end:]
        raw = data if len(data) == expected else decompress(data, expected)
        return encode_png(ycocg_to_rgba(decode_dxt5(raw, w, h))), w, h, "decoded DXT5 (scaled YCoCg)"
    raise ValueError("unsupported texture format %d with %d mips" % (fmt, mips))


def main(argv):
    out_dir = argv[1]
    maps = argv[2:] or DEFAULT_MAPS
    os.makedirs(out_dir, exist_ok=True)

    vpk = Vpk(os.path.join(CS2_ROOT, "game", "csgo", "pak01_dir.vpk"))
    pats = {m: re.compile("^" + re.escape(THUMB_DIR + m) + r"(_\d+)?_png\.vtex_c$") for m in maps}

    manifest = {"gameBuildId": build_id(), "source": "pak01_dir.vpk", "files": []}
    problems = []
    for path in sorted(vpk.entries):
        if not path.startswith(THUMB_DIR):
            continue
        for m, pat in pats.items():
            hit = pat.match(path)
            if not hit:
                continue
            name = "%s%s.png" % (m, hit.group(1) or "")
            try:
                png, w, h, how = extract(vpk.read(path))
            except Exception as exc:  # report and keep going
                problems.append((path, str(exc)))
                continue
            with open(os.path.join(out_dir, name), "wb") as f:
                f.write(png)
            manifest["files"].append({
                "file": name, "map": m, "vpkPath": path, "how": how,
                "width": w, "height": h, "bytes": len(png),
                "sha256": hashlib.sha256(png).hexdigest(),
            })
            print("%-26s %4dx%-4d %6.2f MB  %s" % (name, w, h, len(png) / 1e6, how))

    with open(os.path.join(out_dir, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
    per_map = {}
    for rec in manifest["files"]:
        per_map[rec["map"]] = per_map.get(rec["map"], 0) + 1
    print("\nextracted %d files:" % len(manifest["files"]), per_map)
    if problems:
        print("\nPROBLEMS:")
        for p, why in problems:
            print(" ", p, "->", why)
        sys.exit(1)


if __name__ == "__main__":
    main(sys.argv)

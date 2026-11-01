"""Crop a PNG to its top-left W x H using only numpy and zlib (used to trim headless-Edge chrome off renders)."""
import struct
import zlib

import numpy as np


def _read(path):
    data = open(path, "rb").read()
    pos, idat, ihdr = 8, [], None
    while pos < len(data):
        length, kind = struct.unpack(">I4s", data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + length]
        pos += 12 + length
        if kind == b"IHDR":
            ihdr = struct.unpack(">IIBBBBB", body)
        elif kind == b"IDAT":
            idat.append(body)
    w, h, depth, ctype, _, _, interlace = ihdr
    if depth != 8 or interlace or ctype not in (2, 6):
        raise ValueError("unsupported PNG: depth %d type %d interlace %d" % (depth, ctype, interlace))
    ch = 3 if ctype == 2 else 4
    raw = zlib.decompress(b"".join(idat))
    stride = w * ch
    out = np.zeros((h, stride), dtype=np.uint8)
    prev = np.zeros(stride, dtype=np.int32)
    i = 0
    for y in range(h):
        f = raw[i]
        line = np.frombuffer(raw, dtype=np.uint8, count=stride, offset=i + 1).astype(np.int32)
        i += 1 + stride
        if f == 1:
            line = (np.cumsum(line.reshape(w, ch), axis=0) & 255).reshape(-1)
        elif f == 2:
            line = (line + prev) & 255
        elif f == 3:
            cur = line.copy()
            for x in range(stride):
                left = cur[x - ch] if x >= ch else 0
                cur[x] = (line[x] + ((left + prev[x]) >> 1)) & 255
            line = cur
        elif f == 4:
            cur = line.copy()
            for x in range(stride):
                a = cur[x - ch] if x >= ch else 0
                b = prev[x]
                c = prev[x - ch] if x >= ch else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                cur[x] = (line[x] + pr) & 255
            line = cur
        out[y] = line
        prev = line
    return out.reshape(h, w, ch)


def crop(path, w, h):
    img = _read(path)[:h, :w]
    ch = img.shape[2]
    raw = np.concatenate([np.zeros((img.shape[0], 1), dtype=np.uint8), img.reshape(img.shape[0], -1)], axis=1).tobytes()

    def chunk(kind, body):
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF)

    png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", img.shape[1], img.shape[0], 8, 2 if ch == 3 else 6, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))
    open(path, "wb").write(png)

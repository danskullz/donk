"""Read the in-game place label under the radar from a screenshot, with Windows' built-in OCR.

CS2's HUD prints the current place name (the nav "place", e.g. "Connector") under the radar. Reading it at a
sample point is the no-download way to learn which place the game assigns to a spot (SCOPE.md 7.4, option d).
This module only does the image side: crop the label, clean it up, run OCR. The teleport-and-grab loop is
capture_run.py's job.

usage: python -I place_ocr.py <screenshot.png> [x y w h]     (default box: the 1920x1080 label under the radar)
"""
import base64
import os
import struct
import subprocess
import sys
import tempfile
import zlib

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(HERE)), "design"))
from pngcrop import _read  # noqa: E402

LABEL_BOX_1080P = (30, 322, 240, 36)   # x, y, w, h of the label under the radar at 1920 x 1080


def write_png(path, img):
    img = np.ascontiguousarray(img)
    h, w = img.shape[:2]
    ch = 1 if img.ndim == 2 else img.shape[2]
    raw = np.concatenate([np.zeros((h, 1), dtype=np.uint8), img.reshape(h, -1)], axis=1).tobytes()

    def chunk(kind, body):
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF)

    ctype = {1: 0, 3: 2, 4: 6}[ch]
    open(path, "wb").write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, ctype, 0, 0, 0))
                           + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))


def prepare(img, box, scale=3):
    """Crop the label, keep only the near-white text pixels, draw them black on white, enlarge."""
    x, y, w, h = box
    tile = img[y:y + h, x:x + w, :3].astype(np.int32)
    text = (tile.min(axis=2) > 205)                      # the label is white with a dark shadow
    out = np.where(text, 0, 255).astype(np.uint8)
    out = np.pad(out, 12, constant_values=255)           # OCR likes a margin
    return np.kron(out, np.ones((scale, scale), dtype=np.uint8))


def ocr(paths):
    env = dict(os.environ, OCR_IMG="|".join(paths))
    script = open(os.path.join(HERE, "ocr_image.ps1"), encoding="utf-8").read()
    enc = base64.b64encode(script.encode("utf-16-le")).decode("ascii")   # a command string, so the execution policy is not involved
    r = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-EncodedCommand", enc], env=env,
                       capture_output=True, text=True, timeout=120)
    if "NO_OCR_ENGINE" in r.stdout:
        raise RuntimeError("Windows has no OCR language pack for the user's languages")
    lines = [l[4:] for l in r.stdout.splitlines() if l.startswith("OCR|")]
    if len(lines) != len(paths):
        raise RuntimeError("OCR failed: " + (r.stderr or r.stdout)[:400])
    return [l.strip() for l in lines]


def read_labels(shots, box=LABEL_BOX_1080P):
    tmp = tempfile.mkdtemp(prefix="place_ocr_")
    paths = []
    for i, s in enumerate(shots):
        p = os.path.join(tmp, "label_%03d.png" % i)
        write_png(p, prepare(_read(s), box))
        paths.append(p)
    return ocr(paths), tmp


if __name__ == "__main__":
    shot = sys.argv[1]
    box = tuple(int(v) for v in sys.argv[2:6]) if len(sys.argv) >= 6 else LABEL_BOX_1080P
    texts, tmp = read_labels([shot], box)
    print("label crop kept in", tmp)
    print("OCR read: %r" % texts[0])

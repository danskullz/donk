"""Minimal reader for Source 2 VPK v2 archives (read-only, standard library only).

Phase 0 spike code. Reads the directory file (pak01_dir.vpk) and pulls file bytes
out of the numbered archives next to it. It never writes into the game folder.
"""
import os
import re
import struct
import sys
from collections import Counter

SIGNATURE = 0x55AA1234


class VpkEntry:
    __slots__ = ("path", "crc", "preload", "archive", "offset", "length")

    def __init__(self, path, crc, preload, archive, offset, length):
        self.path = path
        self.crc = crc
        self.preload = preload
        self.archive = archive
        self.offset = offset
        self.length = length


class Vpk:
    def __init__(self, dir_path):
        self.dir_path = dir_path
        self.base = re.sub(r"_dir\.vpk$", "", dir_path)
        self.entries = {}
        self._read_tree()

    @staticmethod
    def _cstr(buf, pos):
        end = buf.index(b"\x00", pos)
        return buf[pos:end].decode("utf-8", "replace"), end + 1

    def _read_tree(self):
        with open(self.dir_path, "rb") as f:
            data = f.read()
        sig, version, tree_size = struct.unpack_from("<III", data, 0)
        if sig != SIGNATURE:
            raise ValueError("not a VPK file: %r" % hex(sig))
        header_size = 28 if version == 2 else 12
        self.version = version
        self.data_offset = header_size + tree_size  # embedded data (archive 0x7FFF) starts here
        pos = header_size
        end = header_size + tree_size
        while pos < end:
            ext, pos = self._cstr(data, pos)
            if ext == "":
                break
            while True:
                path, pos = self._cstr(data, pos)
                if path == "":
                    break
                while True:
                    name, pos = self._cstr(data, pos)
                    if name == "":
                        break
                    crc, preload_len, archive, offset, length, term = struct.unpack_from("<IHHIIH", data, pos)
                    pos += 18
                    preload = data[pos:pos + preload_len]
                    pos += preload_len
                    full = name if ext == " " else name + "." + ext
                    if path != " ":
                        full = path + "/" + full
                    self.entries[full] = VpkEntry(full, crc, preload, archive, offset, length)

    def read(self, path):
        e = self.entries[path]
        chunks = [e.preload]
        if e.length:
            if e.archive == 0x7FFF:
                with open(self.dir_path, "rb") as f:
                    f.seek(self.data_offset + e.offset)
                    chunks.append(f.read(e.length))
            else:
                with open("%s_%03d.vpk" % (self.base, e.archive), "rb") as f:
                    f.seek(e.offset)
                    chunks.append(f.read(e.length))
        return b"".join(chunks)


def main(argv):
    dir_path = argv[1]
    pattern = re.compile(argv[2], re.I) if len(argv) > 2 else None
    limit = int(argv[3]) if len(argv) > 3 else 200
    vpk = Vpk(dir_path)
    print("entries: %d (vpk v%d)" % (len(vpk.entries), vpk.version))
    if pattern is None:
        by_ext = Counter(os.path.splitext(p)[1] for p in vpk.entries)
        for ext, n in by_ext.most_common(25):
            print("  %-12s %d" % (ext or "(none)", n))
        return
    shown = 0
    for p, e in sorted(vpk.entries.items()):
        if pattern.search(p):
            print("%9d  %s" % (e.length + len(e.preload), p))
            shown += 1
            if shown >= limit:
                print("... (limit %d reached)" % limit)
                break
    print("matches shown:", shown)


if __name__ == "__main__":
    main(sys.argv)

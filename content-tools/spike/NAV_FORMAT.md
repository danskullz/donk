# CS2 `.nav` (version 36): what is decoded

Reverse-engineered from `maps/de_mirage.nav` and checked on all ten Premier and FACEIT-candidate
maps (2026-10-28, Steam build 26144732). No public documentation was found, so everything here
is inferred from the data and validated against known positions. Code: `nav.py`, `nav_export.py`.

The files live inside each map's own archive (`game/csgo/maps/<map>.vpk`), not in `pak01`.

## Decoded

| Offset | Content |
|---|---|
| 0x00 | `u32` magic `0xFEEDFACE`, `u32` version = 36, `u32` subversion = 1, `u32` `0x01000001` |
| 0x10 | A tiny KV3 v5 blob (uncompressed, 9 payload bytes), ending with the trailer `00 DD EE FF` at 0x8D–0x90 |
| 145 | `u32` **V**, the vertex count (Mirage: 3613) |
| 149 | **V** × (`f32` x, `f32` y, `f32` z): world-space vertex pool. Little-endian, **no alignment padding** (offsets are 1 mod 4) |
| 149 + 12·V | `u32` **A**, the area count (Mirage: 2544) |
| next | **A** records of `[u8 n][n × u32 vertex index][u32 0xFFFFFFFF]`. `n` is 3 or 4, so every area is a triangle or a quad |

The vertices are plain world units, the same space as the overview projection in `radar.py`.

## Present but not decoded

- **Area attribute table.** Starts after a second tiny KV3 blob (Mirage: byte 90,776) with `u32` A repeated at 90,905. About
  55–64 bytes per area, byte-packed (1-, 2- and 4-byte fields at unaligned offsets). Place ids are expected here but unconfirmed.
- **Adjacency.** Another table that begins with A again (Mirage: byte 230,606), listing neighbouring area ids in variable-length records.
- **`NavGenParams` KV3** (plain, uncompressed): generation settings such as `HullParams` / `player` / `FlowMap_*`.
- **A large KV3 v5 blob, ZSTD, two frames** (Mirage: from byte 263,528). Frame 1 holds the string table and integers, frame 2 the type bytes
  (224,039 of them, valid KV3 type codes, ending in the standard trailer). The keys are `arealist`, `hidingspotdata`,
  `spotencounterdata`, `approachdata`, `earliestoccupytime`: auxiliary per-area data, **no place ids and no polygons**.
  The tree walk itself was not implemented.

## Not in the nav file

There are **no place-name strings** anywhere in it. The names come from the global list `navplace.db` (277 names) with English
display text in `resource/csgo_english.txt`. Which place each area carries is not decoded. The map's entity lump
(`maps/<map>/entities/default_ents.vents_c`) is a chunked-LZ4 KV3 and was not decoded either; it might define place volumes.

## How it was validated

- All 2,544 Mirage polygons have valid terminators and in-range indices; the same holds for all ten maps.
- Valve's retake spawn positions fall inside a polygon in x/y on every map: Mirage 27/27, Ancient 32/32, Vertigo 29/29, Cache 24/24,
  Inferno 25/25, Train 25/25, Nuke 27/28, Anubis 26/27, Dust II 26/29, Overpass 24/25.
- Height: on most maps those positions sit about 60 units above the nav surface (they are eye positions: 64-unit eye height, with the
  nav surface about 4 units above the feet). On Cache and Nuke they sit about 3–4 units below it (floor positions).
- Overlaying the triangles on the radar tiles the walkable area with no gaps (checked by eye on Mirage).

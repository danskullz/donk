# Content pipeline

How a map goes from Valve's game files to callouts with screenshots and a silhouette in the app. Everything derived
from the game (radars, nav meshes, captures, processed screenshots, map art) is Valve's and stays out of the
repository: `assets/` and `data/art/` are gitignored (SCOPE §9). What is committed is the tooling and the facts
(`data/maps/*.json`, `data/callouts/*.json`).

Commands run from the repository root unless a line starts with `cd app`. On Windows PowerShell write `pnpm.cmd` for
`pnpm`.

## What needs what

Read this first: the table says which steps need the game, and what has and has not been run.

| # | Step | Needs CS2? | Command | State |
|---|------|------------|---------|-------|
| 1 | Extract radars and overview data | Game files (Steam install, game closed is fine) | `python -I content-tools/spike/radar.py extract assets/valve` | Worked in the Phase 0 spike (2026-10-28). **Not run in the package that wrote this guide.** |
| 2 | Extract nav meshes | Game files | `python -I content-tools/spike/nav_export.py assets/valve` | Same as step 1. |
| 3 | Make the map art | No (uses 1 and 2) | `cd app && pnpm content:art` | Written and unit-tested on synthetic meshes only. Never run on a real mesh: expect to check sizes and the radar overlap (below). |
| 4 | Curate callouts, paint regions, plan shots | No (the dev-only Editor needs 2) | `cd app && pnpm dev`, then `#/editor/de_mirage` | Built and browser-tested by the Editor's owner. |
| 5 | Capture screenshots | **Yes: CS2 running**, in the foreground | `capture_run.py`, see below | Worked once, in the spike, with a ten-pose manifest of Valve's retake positions. **The Editor's manifest has never been run against the driver or the game**; nothing in this guide's package launches CS2. |
| 6 | Process captures into the app's screenshots | No | `cd app && pnpm content:process -- --map de_mirage` | Written and tested on synthetic PNGs only. Never run on a real capture. |
| 7 | Check everything | No | `cd app && pnpm content:validate` | Tested on synthetic content. |
| 8 | Review in the game, mark `verified` | **Yes**, by hand | The Editor | Not automated. |

`pnpm content:all` runs step 3 and then step 7. It stops with an error if there are no nav meshes yet.

## Before you start

- Windows with Counter-Strike 2 installed under Steam. The extractors read the game folder (read-only); the path is
  hard-coded in `content-tools/spike/extract_thumbs.py` as `CS2_ROOT` (the default Steam library). Change it there if
  the game is elsewhere.
- Python 3 with `numpy` for steps 1, 2 and 5 (run as `python -I`, which keeps the current folder off the import path).
- Node and pnpm, `cd app && pnpm install --frozen-lockfile`, for everything else.

## 1 and 2: extract

```sh
python -I content-tools/spike/radar.py extract assets/valve
python -I content-tools/spike/nav_export.py assets/valve
```

This writes `assets/valve/radars/<map>.png` (and `<map>_<level>.png` for lower floors), `assets/valve/overviews/overviews.json`
(projection, level cut-offs, game build) and `assets/valve/nav/<map>.json` (vertices and polygons in world units).
Both are re-run after a game update: the art and the shots record the build they were made from, and the validator warns
when they disagree with the map record.

## 3: map art

```sh
cd app
pnpm content:art                          # every map that has assets/valve/nav/<id>.json
pnpm content:art --map de_mirage          # one map (repeat the flag for more)
```

(`pnpm content:art -- --map de_mirage` works too.) For each map it draws the union of the nav areas as one SVG path per
level in radar pixels and writes `data/art/<map>.json`:

```json
{ "map": "de_mirage", "gameBuild": "26144732", "levels": { "default": "M512.3 100l4.5 0 ..." } }
```

- The projection comes from `data/maps/<map>.json` if the map has a record, else from `assets/valve/overviews/overviews.json`,
  so every map with a nav mesh gets art whether or not it has callouts.
- Coordinates are rounded to 0.1 px, corners within about 1 px of a straight line are dropped, and specks smaller than
  about 1.4 px across are left out. If a map's file is over 150 KB the tolerance is raised (1, 1.5, 2.25, ...) up to six
  times until it fits. If it still does not, the file is written anyway and the run warns. Holes (courtyards, pillars)
  are kept: the path is meant to be drawn with the non-zero fill rule.
- Unless `--no-check` is given, each level is compared with Valve's radar image (`radars/<map>.png`, `<map>_<level>.png`)
  and the run prints how much of the art lies on the radar's solid pixels. With the right projection nearly all of it
  should. **The 70% warning threshold is a guess made without real data**; if it cries wolf on a good map, or stays quiet
  on a bad one, say so. The radar also draws wall thickness and, on multi-floor maps, only part of each floor, so the
  share of the radar that the art covers is expected to be well under 100%.
- Re-running with nothing changed rewrites nothing.
- Other flags: `--tolerance <radar px>`, `--budget <bytes>`, `--data <dir>`, `--assets <dir>`, `--out <dir>`.

The app reads `data/art/<map>.json` into `MapData.art` (and `artLevels` for every level) when the file exists and passes
the schema in `app/src/core/artfile.ts`; without it the map screens draw without a silhouette.

## 4: plan shots (Editor)

In the Editor, "Propose shots" suggests camera positions (inside, approach, alternate, overview; close-up and wide for
Hard spots) from the region geometry and the nav mesh. They do not know about walls: move them in the Editor and in the
game. Saving writes `data/editor/<map>.capture-manifest.json`, one line per planned shot:

```json
{ "n": 1, "id": "mirage.palace", "kind": "inside", "stance": "stand",
  "pose": { "x": 0, "y": 0, "z": 0, "pitch": 0, "yaw": 0, "title": "mirage.palace-inside-1" }, "note": "retake planned" }
```

`pose` is the **eye** position; the driver puts the player origin 64 units lower. The title (`<callout id>-<kind>-<n>`)
is what names the capture file and, later, the processed picture.

## 5: capture (needs CS2 running; the only step that touches the game)

Only what is known to work, from SCOPE §8.2. Nothing here was run for this guide.

1. Close CS2 if it is running.
2. Start it with the console port open and a **fresh random password**. The port listens on **all network interfaces**
   and is protected only by that password, so keep the session short and quit the game afterwards:

   ```
   steam.exe -applaunch 730 -insecure -novid -fullscreen -w 1920 -h 1080 -netconport 2121 -netconpassword <random> +map de_mirage
   ```

3. When the map has loaded, leave CS2 in the foreground; the screen grab refuses to run otherwise (it stops the run the
   first time it is not).
4. From the repository root:

   ```sh
   python -I content-tools/spike/capture_run.py 2121 <password> data/editor/de_mirage.capture-manifest.json assets/valve/capture/de_mirage powershell.exe
   ```

   It teleports and aims for each shot, waits 1.4 s, grabs 1920x1080 with the HUD, weapon and crosshair hidden, and
   writes `shot_NN_<slug of the title>.png` plus `results.json` (a failed grab is listed there with a status). About
   2.5 s per shot.
5. Quit the game.

Things the spike did not settle (SCOPE §8.2): a pass for stray on-screen elements per map, the lighting preset, how to
batch hundreds of shots, and whether the Editor's positions look right in the game (they are proposals).

## 6: process captures

```sh
cd app
pnpm content:process --map de_mirage
```

For every shot in `data/editor/de_mirage.capture-manifest.json` whose PNG is in `assets/valve/capture/de_mirage/` it:

- checks the picture is 16:9, scales it to 1280x720 and writes `assets/shots/mirage/<callout>-<n>.avif` (`n` is the
  number in the title, so re-capturing one shot replaces the same file). It starts at quality 60 and lowers it in steps
  of 5 until the file is 90 KB or less, down to quality 40;
- adds the matching entry (`file, pos, yaw, pitch, stance, kind, captured, build`) to that callout's `shots` in
  `data/callouts/de_mirage.json`, written the way the Editor writes it, after copying the old file to
  `data/.backups/de_mirage/<time>/callouts.json` (the last 30 are kept). New entries go after existing ones; the
  callouts file is only written if something was added or replaced.

It is safe to run again. An entry that is already there and identical is left alone (and not re-encoded if its picture
exists). One that **differs is not overwritten** and the run exits 1 naming the fields; `--force` replaces it. A callout
that is not in the file is skipped, never created. A missing capture, a picture that is not 16:9, or a shot that the
validator would reject (for example a position outside the radar) is reported and left out; the others still go through.

`captured` is the date of the PNG (local time), so a recapture on a later day shows up as a difference and needs
`--force`. If you copy the capture folder somewhere and its dates change, the same happens to every shot; use `--force`
once, or give the day yourself with `--date 2026-11-02` (applies to every entry that run). `build` is the map record's
`gameBuild` unless `--build` says otherwise.

Flags: `--captures <dir>`, `--manifest <file>`, `--dry-run` (convert in memory, write nothing), `--quality`, `--min-quality`,
`--max-kb`, `--effort 0-9` (AVIF encoder effort: higher is slower and smaller; default 4), `--webp` (also write a WebP beside each
AVIF), `--data <dir>`, `--shots <dir>`.

`--webp` writes spare files only. The entries and the app use the AVIF; nothing in the app falls back to the WebP yet.

The dev and preview servers serve `assets/shots` at `/shots/...` (`app/tools/shots-plugin.ts`: images only, 404 rather
than the app page for a missing file, ETag so a recapture shows up) and `pnpm build` copies the images into `dist/shots`.
`CALLOUTS_SHOTS_DIR` points them somewhere else.

## 7: validate

```sh
cd app
pnpm content:validate            # exits 1 on any error
pnpm content:validate --strict   # warnings fail too
```

On top of the schema and consistency rules, when `assets/shots` exists it checks that every screenshot a callout
lists is there, is a readable image, is 1280x720 (a warning if not), and reports files nobody lists (a `.webp` or
`.png` beside a listed `.avif` is not a stray). It prints the number and total size of the listed shots per map. For
every map it lists whether art exists and, if it does, checks that it parses, is for that map, lies inside the radar,
is under 150 KB, has a level for each level in the map record, and was made from the same game build.
`CALLOUTS_DATA_DIR`, `CALLOUTS_SHOTS_DIR` and `CALLOUTS_ART_DIR` move the folders.

## Tests for the tooling

`cd app && pnpm test:scripts` runs the tests for `scripts/` and `tools/` (the main `pnpm test` only looks in `src/`):
the art generator, the shot processing (with PNGs made by `sharp`), the three command-line scripts as real processes
against a temp folder, and the `/shots` handler. They use a synthetic grid map; none of it is Valve's data.
`pnpm e2e shots.spec` (a file-name filter) starts the app's own Vite config inside the test, as dev server and as preview of a production
build, with `CALLOUTS_SHOTS_DIR` pointing at a temp folder, and checks serving over HTTP and in a browser.

## When you run it on the real data, please send back

- `pnpm content:art`: the whole output. In particular the size of each map's file, the "% of the art is on the radar"
  figure per level and any warning.
- `pnpm content:process`: the last summary line (how many KB per picture on average, seconds) and a look at three or
  four pictures: do 1280x720 AVIFs at this size look good enough?
- `pnpm content:validate`: the whole output.

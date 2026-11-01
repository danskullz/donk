# Package E: content pipeline (`cloud/content`)

Written 2026-11-01 on Linux, without Counter-Strike files, without Edge, and without Valve's `assets/`. Every script was
exercised on synthetic data: a grid and staircase nav mesh, PNGs and radars made with `sharp`, the fixture map
`de_test`. Nothing here has seen a real nav mesh, radar or capture. The pipeline guide is `content-tools/README.md`.

## What was in the snapshot, and what I did with it

Most of the package was already written. I read all of it, found defects (below), added the tests that were missing,
and wrote what was not there.

| File | State in the snapshot | Now |
|---|---|---|
| `app/tools/shots-plugin.ts` + `.test.ts` | complete, 18 tests | reviewed, unchanged; also proved over real HTTP by `e2e/shots.spec.ts` |
| `app/scripts/lib/art.ts` + `art.test.ts` | complete | unchanged |
| `app/scripts/lib/art-run.ts` | written, **no tests** | fixed (below), 21 tests in `art-run.test.ts` |
| `app/scripts/make-art.mjs` | written | prints warnings, validates numbers, accepts a leading `--` |
| `app/src/core/editor/outline.ts` `silhouetteLoops` + `outline-silhouette.test.ts` | complete | unchanged (the additive function the package asked for was already there; `outlineOf` is untouched) |
| `app/src/core/artfile.ts` + test | complete | unchanged |
| `app/src/app/data.ts` (art only) | loads art with `import.meta.glob`, untested | loader exported as `loadMapArt`, load errors tolerated, `data.test.ts` (8 tests) |
| `app/scripts/lib/shots.ts`, `process-run.ts`, `process-shots.mjs` | written, **no tests** | fixed (below); `shots.test.ts` (19), `process-run.test.ts` (24) |
| `app/scripts/validate-content.mjs` | had shot-file existence and art checks | extended (below); tested through the CLI |
| `app/package.json` scripts | all five `content:*` lines and `test:scripts` already there | unchanged |
| `app/scripts/lib/fixtures.ts`, `scripts/cli.test.ts`, `e2e/shots.spec.ts`, `content-tools/README.md`, this file | missing | new |

## Defects found and fixed

1. **`pnpm content:process -- --map de_mirage` did not work**, though that is the form in the scripts' own headers: pnpm 12
   hands the `--` on and Node's `parseArgs` then reads `--map` as a positional argument and throws. Both scripts now drop
   a leading `--` (`cliArgs()` in `lib/boot.mjs`), so either form works. Tested through the real CLI.
2. **Radar file names in `art-run.ts`** used "first level gets no suffix"; the extractor (`content-tools/spike/radar.py`)
   gives no suffix to the level *called* `default`. They agree for the shipped maps but not in general. Now follows the extractor.
3. **An empty nav mesh wrote an art file with no levels**, which the app then rejects as unusable. Now an error for that
   map, and no file is written (an earlier file is kept).
4. **A map record that failed to parse threw outside the per-map `try`**, killing the whole `content:art` run. Now it fails that map only.
5. **A non-numeric `--quality`, `--tolerance` and so on reached the encoder as `NaN`.** Now exit 2 with the flag named.
6. **`tsconfig.json` did not include `scripts/**/*.ts`**, so `pnpm check` never type-checked the art or shot code or their
   tests. I added the include (not my file; the smallest change that lets the checker see them). It type-checks clean.
7. The validator did not check art for a map with a nav mesh but no record, nor art files that match no map, and a
   zero-byte or truncated shot would have passed the "file exists" check and shown as a broken picture.
8. `data.ts` could not be tested without a real `data/art` folder, and a failing loader would have thrown out of `loadAvailableMaps`.

## Added behaviour

- `content:art`: a level's art is compared with its radar; the run warns when less than 70% of the art lies on the radar
  (`MIN_ON_RADAR`) and when a file is still over the 150 KB budget after the tolerance was raised six times. Both
  are warnings, counted in the summary; neither fails the run.
- `content:process`: `--effort 0-9` for the AVIF encoder (default 4). Used at 0 in the tests, which would otherwise take
  over three minutes; useful for Dan to try 6 to 9 for a final run.
- `content:validate`: each listed shot must be a readable image (`shot-unreadable`, error) of 1280x720 (`shot-size`,
  warning); per map it prints how many shots are on disk, their total and average size; art is checked for maps
  without a record too; `art-orphan` warns about an art file for a map not in `index.json`.

## Tests, exact results (all on Linux, Node 22.23.4, pnpm 12.16.1)

| Command | Result |
|---|---|
| `pnpm test` | 31 files passed, 1 skipped; 532 tests passed, 3 skipped (the three skip themselves without the real Mirage nav mesh). Before my changes: 30 files, 524 tests. The 8 new ones are `src/app/data.test.ts`. |
| `pnpm test:scripts` | 6 files, 114 tests passed; run three times in a row, about 17 s each. (`art.test.ts` 11, `art-run.test.ts` 21, `shots.test.ts` 19, `process-run.test.ts` 24, `cli.test.ts` 21, `tools/shots-plugin.test.ts` 18; I wrote the `art-run`, `shots`, `process-run` and `cli` ones.) |
| `pnpm check` | **7 errors, 2 warnings**, all in files I do not own: `src/screens/Session.svelte` (7 errors, package C), `Settings.svelte` and `Summary.svelte` (the warnings). Nothing in my files. Same 7 errors before I started. |
| `pnpm build` | **fails on `main` and on this branch** for a reason outside this package: `src/screens/Settings.svelte` imports `../styles/settings.css`, which package D has not created yet (`UNRESOLVED_IMPORT`). With an empty placeholder file there (never committed, removed again) the build succeeds in about 1.4 s, and with `CALLOUTS_SHOTS_DIR` set prints `callouts-shots: copied 1 screenshot (0 KB) to dist/shots`; with the folder absent it copies nothing and says nothing. |
| `pnpm content:validate` | exit 0: 0 errors, 5 warnings (the five empty zones of Mirage, which has no callouts). Lists all ten maps' art as `none`. |
| `pnpm content:art` | exit 1 here, on purpose: `no nav meshes under .../assets/valve/nav (run the extraction first: content-tools/README.md)`. |
| `e2e/shots.spec.ts` | 13 tests passed (6 to 10 s), **in the pre-installed Chromium through a throwaway Playwright config outside the repository**, not in Edge, and with the placeholder `settings.css` above so the e2e build could run. `pnpm e2e` as configured (Edge) was **not** run, and no other e2e spec was run. |
| `tsc --noEmit` | clean, with `scripts/**/*.ts` now included. |

Also checked once by hand, not committed because it needs `python3`: the Python driver's `slug()` and `slugOf` in
`lib/shots.ts` give identical results on eight sample titles, so a PNG the driver names is a PNG `content:process` looks for.

Timing, so you know what to expect: the art generator took 148 ms for a 2,500-area synthetic mesh (Mirage's size) and
1.6 s for 30,000 areas. AVIF encoding at the default effort took about 0.4 s for a flat 1280x720 frame here; real
screenshots are busier, so expect longer. These are laptop-in-a-container numbers, not Dan's machine.

## Choices Dan might overrule

- **A recapture needs `--force`.** An entry counts as different if `captured` differs, and `captured` is the PNG's file
  date, so a retake on a later day is a conflict rather than being silently ignored (the image bytes are not compared).
  The cost: if the capture folder is copied and its dates change, every shot conflicts until one `--force` run. The
  alternative is to ignore `captured` and `build` when deciding, and compare image content some other way.
- **`--date` applies to every entry of that run**, so `--force --date` rewrites every date.
- **Size budget 90 KB, quality 60 down to 40 in steps of 5**, from SCOPE §3.5 (60 to 90 KB). Not measured on real pictures.
- **Art over budget is a warning, not a failure**, after raising the tolerance up to about 11 px. That is a coarse
  simplification; Dan may prefer a failure so he looks at the map.
- **The 70% radar-overlap warning threshold is a guess.** I had no real radar to calibrate it.
- **`content:all` is `content:art` then `content:validate`.** `content:process` needs a map and captures, so it is not in
  it. On a machine with no nav meshes the chain stops at the art step with exit 1.
- **Shots are served with `Cache-Control: public, no-cache` and an ETag**, so every picture costs a 304 round trip per
  page load. File names carry no content hash, so a long cache would hide a recapture. The plugin has an `immutable`
  option for the day names carry hashes.
- **`--webp` writes spare files nothing uses.** The entries and the app use the AVIF only.
- **A wrong-sized shot is a validator warning**, an unreadable one an error.
- **Branch.** The task named `cloud/content`; the session's harness also named `claude/admiring-brown-9huvmu`. The work is on
  `cloud/content`, the pull request's head. See the report for whether the other branch was moved.

## Not done, not verified

- **Nothing was run on real data**: no real nav mesh, radar, overview file, capture or Mirage callouts. So unknown:
  the size of each map's art file (the synthetic meshes have coarse edges; a real irregular mesh will give more corners),
  whether 1 px simplification looks right at the sizes the app draws, how closely the silhouette lies on Valve's radar,
  how big real AVIFs are at quality 60 and whether they look good enough, and whether the 70% threshold is sensible.
- **Steps 1, 2, 5 and 8 of the README were not run** (extraction, capture, in-game review). The Editor's capture manifest has never
  been fed to `capture_run.py` or the game; that is the biggest open risk in the chain.
- **Edge**: no spec was run in Edge. `e2e/shots.spec.ts` ran in Chromium only, as above.
- `data/art` loading was tested with fake loaders and with the folder absent; it was not tested with a real art file in
  `data/art`, nor drawn on screen (`RegionMap`'s `art` prop is package A's).
- The preview server serves `/shots` from the live folder, not from the copy in `dist/shots`; the copy is what a static
  host would serve. The copy is proved by file comparison, not by serving `dist` from a static server.
- The validator reads every listed shot's image header with `sharp`; for about 1,400 shots that should add seconds. Not timed.

## Errors in files I do not own

- `app/src/screens/Session.svelte`: 7 `svelte-check` errors (`mode` on `ContrastCard`; `Done` props `canPractise`, `onpractise`,
  `onsummary` missing). Package C.
- `app/src/screens/Settings.svelte`: imports `../styles/settings.css`, which does not exist: **breaks `pnpm build`**. Package D.
  Also a warning about `role="tabpanel"` on `<main>`.
- `app/src/screens/Summary.svelte`: `state_referenced_locally` warning on `map`. Package B.
- `app/vite.config.ts`: loading it prints the "configLoader: 'native'" warning because `tools/editor-plugin.ts` imports core files
  without extensions. Harmless, noisy, the coordinator's.
- `app/tsconfig.json` (coordinator): I added `scripts/**/*.ts` to `include`. If you prefer, move that to a separate tsconfig.
- `.gitignore` lists `/data/art/` twice. Harmless.

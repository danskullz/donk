# Starting a new map: `content:init-map`

Only Mirage has a map record in `data/maps/`, and the dev-only Callout Editor can only open a map that has one. This
command makes the record for another map from Valve's overview data, so the Editor can open it. It does not make
callouts and it does not choose zones: **the zones are yours to pick**, and the command refuses to run without them.

The rules are in `app/src/core/mapinit.ts` (unit tested); `app/scripts/init-map.mjs` only reads and writes files.

## What it reads

| File | Default | Override |
|---|---|---|
| Valve's overview data | `assets/valve/overviews/overviews.json` | `--overviews <path>` |
| the map list (display name, pool) | `data/index.json` | `--data <dir>` (the folder that holds `index.json`, `maps/`, `callouts/`) |

The overview file is generated from your own CS2 install and is not in the repository (`assets/` is gitignored):
`content-tools/spike/radar.py extract <out_root>` writes `<out_root>/overviews/overviews.json` (its header says how to
run it; `<out_root>` is `assets/valve` here). Relative paths you pass are relative to where you run the command; the
defaults are fixed to the repository.

From the overview entry it takes the projection (`posX`, `posY`, `scale`), the radar size (first level's `radarSize[0]`),
the levels (floors) and the game build (`gameBuildId`). The display name and pool come from the map's row in
`data/index.json`; a map that is not listed there is refused.

## What it writes

- `data/maps/<id>.json`: `revision: 1`, `status: "draft"`, your zones in the order you gave them (ids made with the same
  `slugify` the Editor uses, so `"A Site"` becomes `a-site`), key order and layout identical to `de_mirage.json`.
- `data/callouts/<id>.json`: an empty list.

It checks the result with `parseMapData` (the same rules as `pnpm content:validate`) before writing anything. A map with
no callouts produces no errors and one `zone-empty` warning per zone; that is expected.

It never touches `data/index.json`: `available` stays `false`, so the app keeps showing the map as "coming". Set it to
`true` by hand when the map is ready to be played (`pnpm content:validate` and the content test then check it fully).

Existing files are never overwritten unless you pass `--force`. With `--force` the old files are first copied to
`data/.backups/<id>/<time>/` (the folder the Editor also uses; it is not under version control), because the callouts
file may hold real work. The Editor's own work file (`data/editor/<id>.work.json`) is left alone.

### Floors

A multi-floor map gets one level per entry in the overview file, in that order (the first is the one whose radar is
`<id>.png`). Valve writes 10000 (20000 on Vertigo) for "no limit"; those bounds are left out of the record, so Nuke's
floors become `default` from `-495` up and `lower` below `-495`. A bound is only treated as "no limit" when it is also
the outermost one: Vertigo's real cut-off at `11700` is larger than 10000 but is kept.

The command prints a warning, and still writes, when the overview has a non-zero `rotate` (the projection has no
rotation), when the first level is not called `default`, or when the floors' radar images differ in size.

## Commands

Run from `app/`. Choose the zones for each map first; they go inside the quotes, comma separated, up to 28 characters
each. For example Mirage's are `"T Spawn, Mid, A Site, B Site, CT Spawn"` (that map already exists, so the command would
refuse it; it is only here to show the format). PowerShell:

```powershell
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
cd app
pnpm.cmd content:init-map de_ancient  --zones "<your zones, comma separated>"
pnpm.cmd content:init-map de_anubis   --zones "<your zones, comma separated>"
pnpm.cmd content:init-map de_cache    --zones "<your zones, comma separated>"
pnpm.cmd content:init-map de_dust2    --zones "<your zones, comma separated>"
pnpm.cmd content:init-map de_inferno  --zones "<your zones, comma separated>"
pnpm.cmd content:init-map de_nuke     --zones "<your zones, comma separated>"
pnpm.cmd content:init-map de_overpass --zones "<your zones, comma separated>"
pnpm.cmd content:init-map de_train    --zones "<your zones, comma separated>"
pnpm.cmd content:init-map de_vertigo  --zones "<your zones, comma separated>"
```

Options: `--overviews <path>`, `--data <dir>`, `--force`, `--help`. Exit code 0 on success; 1 with a one-line
`error: ...` and nothing written otherwise. Afterwards `pnpm.cmd content:validate` should still report no errors (it
only validates maps marked `available`; for the others it just notes that data exists).

## What the Editor shows afterwards

Run `pnpm.cmd dev` and open `#/editor`. The list shows every map in `index.json`:

- **no map record in data/maps**: you have not run the command for this map.
- **no nav mesh in assets/valve/nav**: the record exists but `assets/valve/nav/<id>.json` does not (made by
  `content-tools/spike/nav_export.py`). The Editor needs both before it shows an **Open** link.
- **Open**: opens the map with an empty callout list, the zones you gave in the zones panel (rename, reorder, add and
  remove work as usual), the radar image as a backdrop (`assets/valve/radars/<id>.png`, and `<id>_<level>.png` for the
  other floors; the "radar" box is greyed out if the image is missing), and a floor tab per level when there is more than one. The check panel lists one `zone-empty` warning
  per zone until callouts are painted into it.

Zones can still be changed in the Editor later, so the list you give here is a starting point, not a commitment.

## What was and was not verified

Written and tested without the real overview file: the unit tests (`pnpm test`, `app/src/core/mapinit.test.ts`) and the
end-to-end script test (`pnpm test:scripts`, `app/scripts/init-map.test.ts`) use a synthetic overview file. The Nuke and
Vertigo shapes are the ones given in the brief and the shape `radar.py` writes. Not yet seen: the real file's entries for
the nine maps. If one of them is refused, the error names the field; send it back rather than editing the file.

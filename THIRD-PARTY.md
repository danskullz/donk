# Third-party material

What this project uses that other people made, and under which licence. SCOPE.md §9 asks for this file.

Callouts is an unofficial fan project. It is not affiliated with or endorsed by Valve. Counter-Strike is a trademark of
Valve Corporation. The game's radars, screenshots, textures and nav meshes are Valve's property and are not in this
repository: `assets/` is gitignored and is generated from the owner's own CS2 install. The only binary files tracked by
git are the five PNG app icons in `app/public/icons/` (`git ls-files --eol` marks only those as binary; see "Other
material" below).

This file records what could be read in the repository. It is a list, not legal advice, and where something could not
be read or verified it says so.

## npm packages

The table covers the **direct** dependencies and devDependencies of `app/package.json`, not what they pull in. Versions
and licences are made by `node scripts/licences.mjs --write` from each package's own `package.json` in
`app/node_modules` (the lockfile `app/pnpm-lock.yaml` pins the versions). The licence is whatever that file declares in its
`license` field; nobody has re-read each licence text. Only the "Used for" column is written by hand.

`pnpm check:licences` (part of CI) fails if a dependency is missing from the table, if a version or licence has moved
since the table was written, or if a "Used for" is still `TODO`. After adding or updating a dependency, run
`node scripts/licences.mjs --write` and describe the new row.

"devDependency" does not mean "never shipped". Looking for each library's identifiers in the production build (`pnpm
build`) found code from `svelte` (its runtime), `zod`, `idb` and `ts-fsrs` in the app's JavaScript, and the font files
(next section) are copied into `dist/assets/`. The remaining packages are build, test and type-checking tools:
nothing under `app/src/` imports them except the tests (`vitest`).

<!-- licences:start - made by `node scripts/licences.mjs --write`; edit only the "Used for" column -->

### Dependencies (`dependencies` in `app/package.json`)

| Package | Version | Licence | Used for |
|---|---|---|---|
| `@fontsource/ibm-plex-mono` | 5.3.0 | OFL-1.1 | The IBM Plex Mono font files, bundled so the app needs no font download (see "Font" below). |
| `idb` | 8.0.4 | ISC | Promise wrapper around IndexedDB; the review log is stored through it (`src/storage/idb-store.ts`). |
| `ts-fsrs` | 6.0.0 | MIT | The FSRS spaced-repetition algorithm, wrapped in `src/core/scheduler.ts`. |
| `zod` | 4.6.7 | MIT | Schemas that validate map and callout data, settings, the export file and the Editor's documents (`src/core/schema.ts` and others). |

### Development tools (`devDependencies` in `app/package.json`)

| Package | Version | Licence | Used for |
|---|---|---|---|
| `@playwright/test` | 1.64.1 | Apache-2.0 | Browser tests (`pnpm e2e`, `pnpm e2e:editor`); they drive the Microsoft Edge installed on the machine. Not run in CI. |
| `@sveltejs/vite-plugin-svelte` | 7.3.1 | MIT | Compiles `.svelte` files inside Vite and Vitest (`app/vite.config.ts`). |
| `@types/node` | 26.6.6 | MIT | TypeScript types for Node's built-in modules, for the Vite plugins in `app/tools/` and the content scripts. |
| `sharp` | 0.35.5 | Apache-2.0 | Image processing for the content scripts (rasterises the map art in `scripts/lib/art-run.ts`); ADR 0001 also names it for AVIF/WebP conversion of screenshots. Not part of the built app. |
| `svelte` | 5.57.3 | MIT | The UI framework. The compiler runs at build time; its small runtime ships inside the app's JavaScript. |
| `svelte-check` | 4.7.7 | MIT | `pnpm check`: type-checks `.svelte` and `.ts` files. |
| `typescript` | 6.0.3 | Apache-2.0 | The type checker behind `pnpm check` (through `svelte-check`); pinned to 6.x, see ADR 0001. |
| `vite` | 8.3.5 | MIT | Dev server and production bundler (`pnpm dev`, `pnpm build`); the content scripts also use it to load the TypeScript core. |
| `vitest` | 5.0.5 | MIT | Unit tests (`pnpm test`). |

<!-- licences:end -->

## Font

The app's one typeface is **IBM Plex Mono**, from the npm package `@fontsource/ibm-plex-mono`.

- **Files:** latin subset, weights 400, 500 and 600, each as `.woff2` and `.woff`, imported in `app/src/main.ts`. The
  build copies them into `dist/assets/` unchanged (checked: the six files in a production build are byte-identical to
  the ones in the package), so the app needs no font download and makes no request to a font service.
- **Licence:** SIL Open Font License 1.1. The package's `package.json` says `OFL-1.1`, and its `LICENSE` file opens with
  "Copyright 2017 IBM Corp. All rights reserved." and "This Font Software is licensed under the SIL Open Font License,
  Version 1.1", followed by the licence text.
- **Not done yet:** the production build does not include a copy of that licence text. The app is personal and is not
  distributed (SCOPE.md §9, "Public hosting is not planned"), so nothing is redistributed today. If the app is ever
  published, the copyright notice and licence need to ship with the font files; read the licence's conditions then.

## Other material

- **App icons**, `app/public/icons/` (`icon.svg`, `icon-maskable.svg` and the five PNG sizes): no record of where they
  came from was found in the repository. `icon.svg` is three plain shapes (a rounded square, an arc and a bar) in the
  app's own colours. If they were made with a tool or taken from somewhere, note it here.
- **Service worker**, `app/public/sw.js` and `sw-caches.js`: hand-written. The header of `sw.js` says "Hand-written, no
  library", and `sw-caches.js` imports nothing. There is no Workbox or other library in `app/public/`.
- **Design comps**, `design/`: the generator scripts (`design/build.py`, `design/directions.py`) make comps that load
  IBM Plex Mono, IBM Plex Sans and Barlow Condensed from Google Fonts by URL for design exploration. The generated HTML is
  gitignored, nothing from those families is bundled, and `app/index.html` makes no such request. Their licences were
  not read.
- **Python content tools**, `content-tools/spike/` and `design/*.py`: import `numpy` (named in ADR 0001) and, in
  `extract_thumbs.py` only when a file turns out to be zstd-compressed, `zstandard`. Neither is vendored or installed by
  this repository, so no version or licence is recorded here. The other imports are the Python standard library or the
  scripts' own modules.
- **Tools named in SCOPE.md but not used:** SCOPE.md §9 mentions Source 2 Viewer and awpy. Nothing in the repository calls
  either (the archive reader in `content-tools/spike/vpk.py` is the project's own), so they are not listed.
- **`sharp`'s native binaries:** `sharp` is a development tool for the content scripts and is not part of the built app.
  It installs a platform-specific binary package next to it. On the Linux machine used to write this file those were
  `@img/sharp-linux-x64` (Apache-2.0) and `@img/sharp-libvips-linux-x64` (LGPL-3.0-or-later), as declared in their
  `package.json` files. The Windows packages that the owner's machine installs were not read.
- **Valve content:** none is tracked (see the top of this file). SCOPE.md §9 treats the data in `data/` (callout names,
  regions, coordinates) as facts rather than media, and keeps the media itself out of the repository; this file does
  not judge that.

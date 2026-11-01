# Package D: settings, data, offline (`cloud/settings`)

Finished on a Linux cloud machine, from the snapshot of a local agent that was stopped mid-way. What is below was run
here unless it says otherwise. The Playwright spec was run on the **Chromium that ships in the cloud image, not on
Edge**; see "Not verified".

## What the snapshot already had, and what was wrong with it

Present and sound after review: the tab files in `screens/settings/`, `core/exportfile.ts` and its tests,
`storage/idb-store.ts` (`readEvents`, `addEventsIfNew`, `deleteEventsForMap`), `app/packs.ts`, the service worker,
the manifest and the icons (the 512 px plain and maskable PNGs were opened and looked at, the glyph is inside the
maskable safe zone; the other sizes were only checked with `file` for their dimensions).

Found and fixed:

| Problem | Effect | Fix |
|---|---|---|
| `styles/settings.css` did not exist, and `Settings.svelte` imports it | `pnpm build` failed on the snapshot | written (below) |
| my class names used the prefix `st-`, which Study (`styles/study.css`) also uses globally: `.st-body`, `.st-row`, `.st-rows`, `.st-link` | Settings would have picked up Study's grid and row styles | renamed to `set-` in every file D owns |
| `idb-store.openExisting` aborts the creation of a database that does not exist, and idb's `tx.done` for that aborted upgrade was never awaited | an uncaught `AbortError` in the console on every first look at a log that is not there yet (Settings → Data on a fresh browser) | `tx.done.catch(() => undefined)` before the abort |
| the worker looked caches up with `cache.match(request)`, which obeys `Vary` | `vite preview` sends `Vary: Origin`; the install's copy has no `Origin` header, the page's module-script requests do, so **no cached build file ever matched and a reload offline showed a blank page**. Found by the offline test | every look-up uses `{ ignoreVary: true }` (static files, nothing legitimately varies) |
| the install kept the page and the files it names, not the lazy chunks | the scheduler (`fsrs-6-*.js`), map data and the demo map were only kept after first use, so "open once, then go offline, start a session" failed | the install follows `"./x.js"` and `"assets/x.js"` references inside the files it caches (`chunkRefs` in `sw-caches.js`, unit-tested); a chunk that fails does not fail the install |
| `buildIdFrom` did not deduplicate, and read the page's tags at `load` | the same file named twice gave another id; Vite adds links for lazy style sheets, so the id could change from visit to visit and install a new worker every time | deduplicated; the tags are read when the module first runs |
| a slow navigation returned the copy and dropped the late network answer | the copy never refreshed on a slow connection, and a rejected promise was left dangling | the late answer refreshes the copy (`event.waitUntil`); no dangling rejection |
| `resetSettings()` reset `primerSeen` | "Reset settings" sent the learner back through the first-run primer | `primerSeen` is kept (see choices) |
| one out-of-range stored field made `read()` discard every stored setting | a hand edit or a value from another version reset everything | fields are salvaged one by one, as `settingsFromBackup` already did for files |
| pack size was a running total | wrong after a partial download, a repeat, or a picture dropped from the map | the pack's record holds each picture's size by address; the size shown is the sum over the pictures in the pack now; pictures the map no longer has are deleted after a complete run |
| `formatBytes(9.96 MB)` gave `10.0 MB` | cosmetic | gives `10 MB` |
| Keys tab did not list the arrow keys between regions (SCOPE §5.4; `RegionMap.svelte` has them) | incomplete key map | row added |
| `<main role="tabpanel">` | svelte-check a11y warning (an interactive role on a landmark) | the panel is a `div` inside `<main>` |
| the offline list called the development map "Test", the progress list "Test (development)" | inconsistent | both say "(development)" |
| `1 hard spots` | grammar | `1 hard spot` |

## Built, per file

- `app/src/styles/settings.css` (new): the whole screen. Flat surfaces, one accent, tokens only. Two columns on desktop,
  one on a phone in portrait (tabs on one line at 360 px, targets 40 px tall), and a compact layout on a phone on its side
  that drops the explanations (`.set-help`) but keeps statements of fact (`.set-status`: "works offline: yes", a stored
  value the screen does not offer). Hidden radios and checkboxes sit under flat drawings so the browser's own keyboard
  behaviour is kept.
- `app/src/screens/Settings.svelte`, `screens/settings/*`: reviewed, renamed to `set-`, tab panel markup fixed; Data tab
  import text reworded (see below), development-log chip moved out of the help text so it survives the short layout,
  reset also forgets the last-session summary of that map (it would describe answers that are gone).
- `app/src/core/exportfile.ts`: `importCounts(parsed, merge)` (new): the three numbers the import screen shows, so the
  screen does not do the arithmetic inline. `exportfile.test.ts`: +4 tests (35).
- `app/src/app/settings.ts`: field-by-field salvage on read, `resetSettings` keeps `primerSeen`, `motionReduced(s?)`
  (new: for code that animates in script, e.g. the speed call's flash; stylesheets use `data-motion`).
- `app/src/app/packs.ts`: per-picture sizes, pruning, honest size, `delete` on `CacheLike`, development map name.
- `app/src/app/register-sw.ts`: dedupe, read at module start.
- `app/src/app/keymap.ts`: arrow-keys row.
- `app/src/storage/idb-store.ts`: the `tx.done` fix.
- `app/public/sw.js`, `public/sw-caches.js`: `ignoreVary`, chunk crawl, navigation refresh. Manifest and icons unchanged.
- Tests (new): `app/src/app/settings.test.ts` (27), `packs.test.ts` (27), `sw-caches.test.ts` (22: cache names, which
  caches an update deletes, request kinds, chunk references, and that `sw.js` is valid and `PACK_PREFIX` equals the
  worker's `PACK_CURRENT`), `register-sw.test.ts` (7), `keymap.test.ts` (6).
- `app/e2e/settings-offline.spec.ts` (new, 44 tests): below.

### What the browser spec covers

Fit (`expectFits` plus a containment check that nothing runs over the edge of its block, which `expectFits` cannot see)
for every tab, every Data part, the offline list's second page, an import waiting for its click, and both questions
("reset settings", "reset one map"), at all nine viewports. Keyboard (tabs with arrows/Home/End and no history entries,
tab order, radios, slider, switch, the question's default focus and Escape, Data parts). Persistence across reload
(every setting, tab and part in the address, one bad stored field). Reduced motion (computed `transition-duration` with
the device asking and not asking, all three choices, a second screen, reload). Export (file name, versioned content,
every event, settings, the "Downloaded N events" note; the real log is not created). Import (counts, conflicts kept as
stored, nothing written before the click, repeatable, settings only when asked and only the valid ones, cancel, four bad
files, a backup that round-trips). Reset one map (names the map, asks first, only that map's events, `test2.` survives
`test.`, settings untouched, the real log is not created). Offline: a visited app opens and plays a whole session with no
connection (events saved offline), every build file is in the cache (compared with the files of the build), the page
reloads offline with its font, "works offline: yes", a pack downloads with a size equal to the files' real sizes and
serves its pictures offline after they are removed from the app's own cache, a failed picture leaves a partial pack that
says so, a new build deletes the old shell cache but keeps downloaded packs and removes only old-format ones, manifest
and icons.

Guards so the offline tests cannot pass by accident: each checks that a fetch of a file that was never cached is
**refused** while offline (so the worker's own network is down too), and the "pack serves offline" test deletes the
pictures from the shell cache first so only the pack can answer.

## Results

Run in `app/` on Linux (Node 22.23.4, pnpm 12.16.1):

- `pnpm test`: **35 files passed, 1 skipped; 617 tests passed, 3 skipped** (the snapshot: 30 files, 524 passed, 3
  skipped; +93 tests, all package D).
- `pnpm check`: **7 errors, 1 warning, none in files D owns.** All 7 errors are in `src/screens/Session.svelte`
  (package C: `ContrastCard` has no `mode`; `Done` props `canPractise`/`onpractise`/`onsummary` not passed). The warning is
  `Summary.svelte` 44:31 (package B). The snapshot's warning in `Settings.svelte` is gone.
- `pnpm build`: passes (the snapshot failed on the missing `settings.css`).
- `e2e/settings-offline.spec.ts` on the container's Chromium (Playwright 1.64.1, `executablePath:
  /opt/pw-browsers/chromium`, through a local config that is not committed): **43 passed, 1 skipped**, and the same
  with `--repeat-each=3` (129 passed, 3 skipped). The skipped one (reset also forgets the last-session summary) needs the
  Session screen to call `reportSession` (`app/start-session.ts`), which nothing calls yet (package C, task 5); it
  skips itself with that reason and will run once that lands.
- `e2e/smoke.spec.ts` and `e2e/session.spec.ts` on the same Chromium with the worker now active in the e2e build: 27
  passed, 1 failed: `session.spec.ts` "the typed question fits with the keyboard open (360x340)" timed out. It fails the
  same way with service workers blocked, so it is not the worker; it is package C's, and may be a Chromium-vs-Edge
  difference. Not investigated.
- `pnpm content:validate`: 0 errors, 5 warnings (not touched by this package; the warnings are Mirage's five zones that
  have no callouts yet). `pnpm e2e:editor`: not run (not touched).

## Choices Dan might overrule

- **`Reset settings` keeps `primerSeen`.** Otherwise tidying settings sends you through the primer again. The Display tab
  has "Show the primer again".
- **Import: settings are opt-in** ("Also use its settings", off by default), taken field by field; invalid ones are named
  and skipped. Events are never overwritten; an event with the same id but different content is counted ("1 event
  differs from yours; yours are kept") and the stored one stays.
- **Counts read "412 new, 30 already here, 0 invalid"** as in the brief. "Already here" includes ids the file repeats.
- **Export/import work on one log**: the real one, or the synthetic map's when the address has `?log=demo` (development
  and e2e builds only; a "development log" chip says so). Per-map reset works on whichever log each map lives in.
- **The worker ignores `Vary`** and precaches every `assets/` file the entry names. A first visit therefore downloads
  every FSRS version chunk (the build splits `ts-fsrs` into one lazy chunk per FSRS version; about 21 KB uncompressed in
  all) as well as the one in use.
- **Packs are deleted only by the learner**, never by an update; only a pack in an older cache format is removed.
- **Pack size is shown only after a download** (sizes of files not yet fetched are not known; no HEAD requests). While
  Mirage has no screenshots its pack reads "no pictures yet".
- **Short landscape phones hide the explanatory text** and keep the controls and the facts. At 640x360 and 844x390 there
  is no room for both.
- **Tab targets are 40 px on a phone** (the brief's 44 would not fit six words in 336 px with the Session tab's content on a
  360x640 screen; same exception as the Map screen). The phone also hides the two words under the recall slider below 700
  px of height.
- **Colour is not the only signal for a selected option**: it also has the fill/weight change and, for switches, the
  written `on`/`off`.
- **Keys tab lists the session, map and settings keys.** Study's keys (`[`/`]` for zones, digits for pictures) and Home's
  arrows are not listed.

## Not done, not verified

- **Not run on Edge or Windows.** Chromium 1243 was used. Whether Edge behaves the same was not
  tested. Service-worker and `setOffline` behaviour in particular should be run once on the owner's machine:
  `pnpm.cmd e2e --grep "offline"` (set `E2E_PORT`).
- **A real update across two real builds was not run.** The test registers a second worker address
  (`sw.js?build=next1`), which is how a new build looks to the browser, and checks the caches. The real id is made from the
  build's file names (`buildIdFrom`, unit-tested) and was seen to be stable over repeated visits only through the tests, not
  across two different builds.
- **The service worker is not unit-tested as a whole**, only its rules (`sw-caches.js`); its network behaviour is covered
  by the browser spec only.
- **`idb-store.ts` has no unit tests**: there is no IndexedDB in Node and no fake may be added (no new dependencies). It is
  covered by the browser spec (export, import, reset, "reading does not create the database").
- **Nothing was measured on a real phone.** Phone layouts are checked at 390x844, 360x640, 844x390 and 640x360 in a
  desktop browser.
- **The `vite preview` server is not a real host.** A deploy behind a CDN or with a base path other than `/` was not tried:
  `chunkRefs` follows `assets/` under the scope only.
- **Sound** is stored and does nothing (there are no sounds). **A theme** is not offered (dark only, SCOPE §5.8).
- Browser storage that is blocked (private windows) is handled in code (memory only for settings; the log's own error
  path) but not tested in a browser.

## For the other packages

- `settings.ts` now exports `motionReduced(settings?)`. A script-driven animation (package C's speed-call flash) should
  call it instead of reading `matchMedia` itself, or the override in Settings will not reach it.
- `reportSession` (`app/start-session.ts`) is not called by any screen (grep over `src/` and `e2e/`). From reading
  `Summary.svelte`, it will say "Nothing to summarise" after a real session until `Session.svelte` calls it; I did not
  open that screen after a played session.
- The `st-` prefix is Study's; Settings uses `set-`. Keep it that way.
- Errors in files D does not own are listed under Results.

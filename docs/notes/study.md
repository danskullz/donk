# Package B: study (branch `cloud/study`)

Study, Summary, Progress and the Primer, with `core/stats.ts` under them. Written by a cloud session on Linux (no Edge, no
Counter-Strike files) on top of the stopped local agent's snapshot. What was and was not run is at the end; read that part
before trusting any of this.

## What was there, what changed

The snapshot already had `core/stats.ts` (+ test), `Study.svelte`, `Summary.svelte`, `study.css` and `summary.css`.
`Progress.svelte` and `Primer.svelte` were three-line stubs. I reviewed the existing files by running them in a browser,
and they were sound except for the things listed under each file below.

## Built, file by file

**`core/stats.ts`** (+ `stats.test.ts`, 50 tests): events in, numbers out, no clock and no storage (`now` is passed in).
Days and weeks are the learner's local ones. Existing: `heatGrid`, `weeklyLatency`, `speedTrend`, `totals`,
`mapConfusions`, `masteryFills`, `fillsAt`, `headingOf`, day helpers. Changed and added:
- `masteryFills` now defaults to `DEFAULT_SESSION_SETTINGS.enabledModes`, the same modes `app/progress.ts` uses, so the
  tint on Study and Summary is the tint on Home and Map (it used `PHASE1_MODES`).
- Removed `masteryPercent`, `masteryCounts`, `countAll`, `countKnown` and `accuracyByMode`. `masteryPercent` weighted the
  states differently from `MASTERY_WEIGHT` in `app/progress.ts`, so Progress and Home would have quoted different
  percentages for the same map; the others became unused. Progress uses `mapProgress` for those numbers.
- Added `pageWindow` (which slice of a list is on screen), `fitLists` (how many rows of several stacked lists fit),
  `heatLayout` (biggest square for the heat-grid), `sparkline` (line-chart geometry), `secondsText`, `dayLabel`,
  `weeksText`. All pure and tested.

**`Summary.svelte` + `summary.css`** (`#/summary/<map>`): reads `getLastSession(map)`; cards done, accuracy, average,
slowest, new confusions, moved up, mastery map before and after (`RegionMap` `fills` + `changed`), "Another round",
"Done", honest empty states (no session since the page opened; a session with nothing to do, with the reason; unknown
map). Changes to the snapshot:
- The three lists overflowed the window at 1024x600 and 640x360 (27 px and 40 px). They now share the room the column
  has (`fitLists`, sizes handed over from the CSS as `--sm-row` / `--sm-head`) and each heading says "and N more" when rows
  were left out. On a phone in portrait the lists sit side by side and size themselves, as before.
- Fixed the `state_referenced_locally` warning on `map`, the missing space in the breadcrumb, a "0% correct" shown for a
  session with no answers, and reads the log through `loadLearner` (reads only, never creates it).
- Keeps the test hook `window.__calloutsStudy.setLastSession` / `clearLastSession` (dev and e2e builds only; the
  production bundle has none, checked). This is how a browser test hands Summary a session; `__callouts.lastSession()` in
  `test-hook.ts` only reads.

**`Study.svelte` + `study.css`** (`#/study/<map>`): map, zone-paged list and one large screenshot with a thumbnail strip,
linked; name through `core/naming.ts`, blurb, game name, neighbours, camera cone; zone tour previous/next in route order;
filters by tier and state; Hard spots only when `hardModeFor` says so; never writes to the review log. Changes:
- The log is read through `loadLearner`, so opening Study no longer creates an empty database (a test checks this).
- Aliases are shown ("Also called ..."), as SCOPE §4.8 lists them; hidden with "game names only".
- Zone keys: `PageUp`/`PageDown` as well as `[`/`]`. The hint line used `[` `]` inside `kbd`, which rendered as `[[]`.
- The two filter selects stack in a narrow list column (container query) instead of cutting "all states" in two.
- A Hard-tier filter cannot outlive Hard mode; paging uses `pageWindow`; the map gets `follow` so the view keeps the
  selected region in view. I tried `labels` and left it off: at 640x360 the label collided with the zoom buttons.

**`Progress.svelte` + `progress.css`** (`#/progress`, new): four small multiples and a totals line.
- *Mastery by map*: one row per map, a bar of the six states (patterns, not only colour), percent, "Core x of y", due.
  Numbers are `mapProgress` from `app/progress.ts`, so they match Home. A map with no callouts says so. Paged by the
  rows that fit.
- *Mixed up most*: pairs confused at least twice (`mapConfusions`), names through the naming setting, paged.
- *Speed*: weekly median time of right answers, last 12 weeks, latest value and change against the earliest week in view,
  with a line chart drawn to the box it is given.
- *Reviews*: answers per day for 26 weeks, one square a day, weeks as columns, newest at the right, 4 shades of the accent.
- Reads the whole log with `readEvents` (`storage/idb-store.ts`). Development and e2e builds also hold the synthetic map's
  log: a two-button switch in the bar ("Your log" / "Development") shows one at a time, and the development one is labelled
  "development data". A development build opens on the development log only while the real one is empty.
- Empty log: every panel says what is missing; nothing breaks. Unreadable events and an unreadable log are shown as chips.
- A phone in portrait shows one panel at a time (four tabs); a phone on its side shows the four panels compressed.

**`Primer.svelte`** (`#/primer`, new): one skippable screen: what a callout is, T and CT spawns, A and B sites, the radar
never turns (north up). Four cards with small flat pictograms, "Got it" (focused, so Enter works) and "Skip" (Esc). Both set
`primerSeen` through `updateSettings` and `location.replace('#/')` (replace, so Back does not land on the primer again).
Opened again once seen, it has no Skip. Map-neutral: no map is named and nothing is said that holds only for one map; a test
checks no map name appears. Styles are scoped in the file (`primer` has no CSS file in the ownership table).

**`e2e/study-summary-progress.spec.ts`** (83 tests): fit at all nine viewports for Study (first zone, zone with a nested
Hard spot, phone list and map panes), Summary (four states), Progress (every panel, empty log, many pairs) and the Primer;
Study keyboard flow, linked panes, filters, Hard mode, naming, "never writes / never creates the log"; Summary with seeded
sessions (numbers, lists, "and N more", before/after, steady, nothing to do, no session, other map, unknown map, Tab order);
Progress heat-grid, speed, confusions, totals and mastery rows from a seeded log with known numbers, the development switch,
paging, phone tabs; Primer "Got it" / "Skip" / Enter / Esc / Back / already-seen, and the `callouts.settings` flag.
It seeds only the demo database (`callouts-demo`) and never touches the real one.

## Choices Dan might overrule

- Progress shows only maps that have data (available maps, plus the synthetic one in dev builds), not the ten of the index.
  A map still being built has nothing to show; Home already lists the others as "coming".
- Hard callouts are left out of mastery rows and confusion pairs while Hard mode is off (SCOPE §4.12), but heat-grid, speed
  and totals count every answer ever given: they describe what you did, not what is in play.
- The speed trend mixes all modes. A shift from fast modes to slow ones (Pin it, typed) can make it look worse while the
  learner improves. A per-mode view would fix that; I did not add it.
- The heat-grid's shades are the accent at four strengths, relative to the busiest day in view, not absolute counts. Shade is
  the only visual signal there; the numbers are in each square's `title` and in the grid's text label. Mastery state, which
  SCOPE §4.10 is about, does carry patterns as well as colour.
- Summary drops the "Moved up" list first when the room is short (the map's highlighted regions show the same callouts).
- The primer says "Most maps have two" bombsites and nothing about the in-game radar's own behaviour (SCOPE §4.11 says
  "fixed like the in-game one"; I could not verify that claim, so the text only says that this map never turns).
- Primer "Skip" and "Got it" do the same thing. Escape = Skip.
- Progress's default log in a development build is the development one when the real one is empty.

## Not done, not verified

- **The browser tests were not run on Microsoft Edge.** I ran them on the Linux sandbox's Chromium with a throwaway config
  outside the repository (`playwright.linux.config.ts`, git-excluded, not committed): 83 of 83 passed, and 166 of 166 with
  `--repeat-each=2`. Edge may differ in font metrics, native `<select>` widths and `color-mix`; the fit tests are the
  likeliest to disagree by a pixel. Run `pnpm e2e --grep "Study|Summary|Progress|Primer"` on Windows.
- No test against real Mirage data (it has no callouts) or real screenshots; everything used the synthetic map.
- Progress with the ten real maps' worth of rows (paging of the mastery list) is covered by `pageWindow` unit tests and by the
  paging test on the confusion list, not by a browser test with many maps: the build has only two.
- No screen reader or keyboard-only pass by a person; roles, names and tab order are asserted in tests, not listened to.
- Forced-colors rules are written, not looked at.
- Study does not use A's `levels` / `onlevel` floor switcher in `RegionMap`; it has its own button row, which only appears for maps with more than one floor (the synthetic map has one, so it was never seen working).

## Things in other packages' files (not touched)

- **`pnpm build` and `pnpm e2e` fail on `main`**: `screens/Settings.svelte` imports `styles/settings.css`, which does not exist
  (package D). I verified my work with an empty, git-excluded placeholder at `app/src/styles/settings.css`; it is not in the PR.
- `pnpm check` has 7 errors, all in `screens/Session.svelte` (package C), the same 7 as on `main`. (`test-hook.ts` and
  `mapui.ts` report none here.) One warning in `Settings.svelte` (a11y role on `<main>`).
- `e2e/session.spec.ts:274` ("the typed question fits with the keyboard open (360x340)") times out on Linux Chromium, and
  also on a clean `origin/main` build, so it is not from this branch. Other session and smoke tests pass (27 of 28).
- `storage/idb-store.ts` `openExisting` (used by `readEvents` and `deleteEventsForMap`) aborts the upgrade to detect a missing
  database, and `idb` reports the aborted transaction as an unhandled `AbortError` in the console. Progress asks
  `indexedDB.databases()` first to avoid it; the other callers will log it.
- `main.ts` does not import `study.css`, `summary.css`, `progress.css`; each screen imports its own (`study.css` carries the
  mastery swatch `.mgl` that Summary and Progress use), so the coordinator can move them if wanted.
- Package B depends on: `app/progress.ts` (`loadLearner`, `mapProgress`, `includeDraftFor`), `storage/idb-store.ts`
  (`readEvents`, `DB_NAME`, `DEMO_DB_NAME`), `RegionMap` props `fills`, `changed`, `art`, `selected`, `onregion`, `follow`,
  and `e2e/support.ts` (`DEMO_DB`, `expectFits`, `savedEvents`). If those packages rename them, these screens need the rename.

## Results (exact)

- `pnpm test`: 30 files passed, 1 skipped; 544 tests passed, 3 skipped (was 524 passed on `main`; `stats.test.ts` has 50).
- `pnpm check`: 553 files, 7 errors (all `Session.svelte`), 1 warning (`Settings.svelte`). None in files of this package.
- `pnpm build`: passes only with the placeholder CSS above (fails without it, on `main` too); JS 354.68 kB, 114.65 kB gzip.
- `pnpm content:validate`: 0 errors, 5 warnings (unchanged).
- Browser tests on Linux Chromium (not Edge): this spec 83 of 83 (and 166 of 166 repeated); `smoke` + `session` 27 of 28.

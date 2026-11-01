# Package A: map (`cloud/map`)

Home, the Map screen, `RegionMap`, and the pure logic under them. Written 2026-11-01 by a cloud session on Linux (no
Counter-Strike files, no Edge). Read the last section before trusting any of it: it says what was and was not run.

## What was already there, and what this branch did

The earlier local agent had finished most of `RegionMap.svelte`, `Home.svelte`, `home.css`, `progress.ts` (+ tests) and
`mapui.ts` (+ tests). Per PACKAGES.md those were reviewed and tested, not rewritten. `Map.svelte` was a stub.

| File | State on `main` | What this branch did |
|---|---|---|
| `components/RegionMap.svelte` | fills, changed, art, selected, onregion, pinch, minimap, roving arrow keys, tap-to-zoom, floor switcher, labels, Hard inlays all written | New optional `focus` prop (regions outside the open zone are dimmed and unlabelled, for the zone tabs); `data-mastery` on each region. Everything else unchanged. |
| `screens/Home.svelte`, `styles/home.css` | complete in structure | Fixes found by the browser tests: the corner tag covered the percent on narrow cards (the marker is now words in the stats line there); the narrow "Core 4/10" text never showed because a CSS rule of lower specificity lost to `display: none`; the short-landscape row card was 3 px too tall (clipped); the bar's spacer is kept in landscape (session.css squeezes it). |
| `screens/Map.svelte`, `styles/map.css` | stub | Built (below). |
| `core/mapui.ts` (+ test) | type error already fixed on `main` | Added `pathBounds`, `fitWithArt` (the fit must take in the art, which can run past the callouts), `pageOf`, `listRows`, `MASTERY_LABEL`, with tests. |
| `app/progress.ts` (+ test) | complete, 42 tests | Not changed. `weakestZone` is exported and tested but no screen uses it (see below). |
| `screens/session/AskPoint.svelte` | | One line: the keyboard hint said "tab then enter picks a region by name", which stopped being true when regions became one tab stop with arrow keys. |
| `screens/session/PointReveal.svelte` | | Not changed. |
| `e2e/home-map.spec.ts` | none | New, 70 tests. |

## The Map screen (`#/map/<id>`, `{ map: string }`)

- Mastery overlay map (`RegionMap` with `fills`, `art`, `selected`, `onregion`, `focus`, `follow`, labels, floor switcher),
  legend with the six states (+ "Hard spot" while Hard mode is on and the map has any).
- Zone tabs in the map record's zone order (route order), only zones that have callouts; roving tab stop, arrow keys,
  Home and End.
- List of the open zone in route order (`order`, then tier, then name); each Hard spot nested under its callout and never
  split from it across pages. **Page size is measured**: the list box is a `1fr` grid row, its height divided by the row
  height (`--mp-row-h`, 44 / 42 phone / 28 landscape). Nothing scrolls; the pager (`‹ 1 / 3 ›`, keys `,` and `.`) appears
  only when there is more than one page. Choosing a callout on the map turns to the page that holds its row.
- Peek (desktop only, as in the comps): first screenshot (approach shot first), blurb, name through `core/naming.ts`
  (`displayName`, `otherName`), shot count and Hard-spot count. No shot or a shot that fails to load says so.
- Hard mode: a switch in the bar (`updateSettings({ hardMode })`, per map, default untouched) with a chip: "off · 1 hidden",
  "on · 1 spot", "off · no hard spots yet". Hidden when the map has no callouts at all.
- Buttons: Quiz this map (`#/session/<id>`), Study (`#/study/<id>`), Quiz this zone (`#/session/<id>?zone=<zone>`).
- Keys, when nothing has focus: `Enter` quiz this map, `S` study, `H` Hard mode, `,` `.` pages, `Esc` Home. A focused row,
  region or button keeps its own Enter.
- States: loading, unknown map, a map that is "coming", load error, and a map with no callouts (Mirage today): a plain
  explanation, the silhouette if there is art, disabled buttons.
- A warning chip when the review log could not be read (the numbers are then those of an empty log).

## Choices Dan might overrule

- Opening a zone tab selects that zone's first callout, so the ring moves and the map may pan or zoom to it.
- Rows are in route order, not "Core first" as the comp's pager text said.
- No "Weakest first" button anywhere (SCOPE §4.5 and the comps mention one; PACKAGES.md does not ask for it). The
  logic (`weakestZone`) is there if it is wanted.
- Home lists maps in index (alphabetical) order, the development map last, the "coming" ones dimmed in place. Mirage sits
  in the middle with "no callouts yet".
- Home's Enter starts a session only when nothing has focus; on a focused card Enter opens the map (it is a link).
- The minimap is hidden on phones (portrait, up to 820 px), as the earlier agent did.
- Dimming is `filter: brightness(.55)`, not opacity: opacity let the wall colour show through and made New regions look
  brighter than the open zone.
- The Pin it hint now reads "tab in, arrows move, enter picks" (kept short: the longer wording made that screen overflow
  at 1024 x 600, which the session spec caught).

## What was run

All on Linux. Edge was not available.

| What | Result |
|---|---|
| `pnpm test` | 39 files passed, 1 skipped; **705 tests passed**, 3 skipped (696 on `main`; +9 in `mapui.test.ts`) |
| `pnpm check` | **0 errors**, 2 warnings, both in files that are not mine (`Settings.svelte` a11y role, `Summary.svelte` `state_referenced_locally`) |
| `pnpm check:runes`, `check:budget`, `check:licences`, `content:validate` | pass (JS 113.4 KB gzip, 76 % of the budget); `content:validate` 0 errors, 5 warnings that were there before |
| `pnpm build` | passes **only with an empty `src/styles/settings.css`**; see "Not mine" |
| Browser tests | run in **Chromium 1243 on Linux through a throwaway config** (`app/pw.local.config.ts`, kept out of git), **not in Edge**: `home-map.spec.ts` 70 / 70 (also twice over in a row, 140 / 140), `session.spec.ts` 72 / 72, `smoke.spec.ts` 3 / 3 |

The spec covers: Home lists, order, "coming", honest Mirage, recommended marker, navigation, progress with a seeded
history, mini-map fills, the primer redirect (once, no loop), arrow keys; Map zone tabs and their keys, list ↔ map
selection both ways, mastery on regions and rows, due flags, buttons, Hard mode and its persistence in `localStorage`,
smallest-region-wins on a Hard spot, paging (buttons and keys, no split of a callout from its spot), unknown / coming /
empty maps; pinch, minimap, `+ - 0` and the wheel, the tap-to-zoom assist (touch) against a plain click (mouse); and
`expectFits` for Home (empty and with history) and Map (plain, and Hard mode + history + zoomed) at all nine sizes.

## What was not done or not verified

- **Not run in Edge on Windows.** `pnpm e2e` is for the owner. A different engine may differ in layout by a pixel.
- Pinch and the tap assist are driven with synthetic `PointerEvent`s, not real fingers.
- **The floor switcher is untested**: `de_test` has one level and there is no multi-level data yet.
- **Map art is untested with real data.** A made-up silhouette (an L with a hole, in a gitignored file, since removed) was
  drawn and fitted correctly; there is no automated test of `art` in the component.
- The "screenshot failed to load" fallback in the peek is written, not exercised (the demo shots are data URLs).
- Only the 9-callout test map was laid out. A 50-callout map has not been seen; the label collision, paging and the
  fit are written for it, not checked on it.
- `filter: brightness` on ~60 regions was not measured for speed on a phone.
- No screen reader was used; roles and labels follow the ARIA patterns in `design/A11Y.md` but were not listened to.
- Home counts "new" as `min(newPerSession, new callouts)` for the map it offers: that is the earlier agent's choice.

## Not mine, found on the way

- **`pnpm build` fails on `main`**: `screens/Settings.svelte` imports `../styles/settings.css`, which does not exist
  (package D owns both). CI's `verify` job will fail on this until D's pull request is merged. I used an empty untracked
  placeholder locally and did not commit it, so as not to collide with D's file.
- `styles/session.css` has global rules inside its short-landscape media query that reach every screen
  (`.bar .grow { flex: 0 }`, `.btn { height: 30px }`, `.zbtn`, `:root` sizes). I overrode the first for Home and Map; the
  rest were left as they are shared by design.
- `storage/idb-store.ts`: `readEvents` on a database that does not exist yet (a first run) gave an unhandled
  `AbortError` page error when I tried it from Home in an earlier attempt, and the error went away when the database
  was checked in `indexedDB.databases()` first, as `progress.ts` does. I did not dig into why. Screens that call
  `readEvents` on a first run (Progress, Settings) may show the same error in the console.

# Package C: session (cloud session, 2026-11-01)

Branch `cloud/session`, from `main` at `447bcef` (the snapshot). Written by a cloud session on Linux: no Counter-Strike
files, no Microsoft Edge. What was and was not run is spelled out under "Verification".

## What the snapshot already had, and what this session added

The snapshot already held most of the logic: Speed call in `quiz.ts`, `session.ts`, `runner.ts` and `mastery.ts`, the
contrast picker (`core/contrast.ts`), early practice in `buildSession`, the time limit in the runner, the settings
wiring and the summary hand-off in `app/start-session.ts`, and the screens `AskSpeed.svelte`, `Contrast.svelte` and
`Done.svelte`, with core unit tests for all of it. What was missing was the **screen that ties them together**:
`Session.svelte` did not compile (7 type errors) and did not draw contrast cards or Speed call, did not call
`flashEnded`, did not offer early practice, did not hand the summary over, and there was no CSS for either new screen.

Added, file by file:

- `screens/Session.svelte`: contrast phase (`Contrast.svelte`), Speed call (`AskSpeed.svelte`, `flashEnded`, keys 1 to 4
  only once the picture is gone, hint disabled while it is up), the preload of the next card's pictures for the new card
  types, the header counter ("compare"), crumb and screen-reader text for both, an "early practice" chip, `Done` wired
  to "Practise anyway" / "Another round" / "Full summary", `?flash=` read through the dev hook, and the summary handed
  to `setLastSession` (via `reportSession`) when the end screen appears or the screen is left mid-session.
- `screens/session/test-hook.ts`: `flashFromQuery` (the `?flash=` override, dev and e2e builds only). The snapshot shape
  was already extended by the earlier agent (`flashing`, `flashMs`, `other`, `endedBy`, `earlyPractice`).
- `screens/session/helpers.ts`: `motionReduced(setting, systemPrefers)`.
- `screens/session/AskSpeed.svelte`: one line; the countdown bar's `animation-duration` is no longer `!important`, so the
  global reduced-motion rule can never be overridden by it.
- `styles/session.css`: Speed call (plate that keeps its size when the picture goes, the drain bar, the number) and the
  contrast card (two columns on desktop, picture-left rows on portrait phones and short landscape).
- `core/types.ts`: one comment that pointed at the wrong file.
- Unit tests (new): `app/start-session.test.ts` (28), `screens/session/test-hook.test.ts` (10),
  `screens/session/helpers.test.ts` (5).
- `e2e/support.ts` (only additions, plus two small internal changes to existing helpers, see below) and
  `e2e/session.spec.ts` (47 new tests).

## The features, as built

1. **Settings in `startSession`**: `sessionCards` (null = until I stop = 1000, the daily cap and the learner end it),
   `sessionMinutes`, `newPerSession`, `gentleStart`, `retention` (scheduler), Hard mode via `hardModeFor`, `naming`
   (callouts are presented through `core/present.ts`: names via `displayName`/`otherName`, typed answers accept
   `acceptedNames`). `?seed=` and `?draft` kept. The new `start-session.test.ts` runs the real `startSession` in Node
   against the synthetic map with an in-memory store and checks every one of these, including the time limit end to end
   with a fake `Date`.
2. **Speed call**: picture 1.5 to 3 s (3 s first, half a second less per right answer, floor 1.5 s, `flashFor`), then
   hides, then four options, keys 1 to 4. Timed from the hide (`flashEnded`), so the flash does not make every answer
   "slow". The only visible countdown in the app. Unlocks when Where am I? is stable for >= 21 days (stage 5), is in the
   default enabled modes. "I don't know" works while the picture is up. Reduced motion (browser or Settings): no bar, the
   picture stays for the full time, the number counts whole seconds.
3. **Contrast cards**: a pair confused >= 2 times gets one card next session (both pictures, names, blurbs, neighbours,
   nothing to answer), then a Which view? question for it with both callouts among the views. Not shown again within a
   week; the record is kept beside the log in `localStorage` (`callouts.contrast-seen[.demo]`), written when the learner
   moves past the card, not when they leave on it.
4. **Early practice**: when nothing is due and something is started, the end screen offers "Practise anyway" (up to the
   card limit, the items closest to due, nothing new). The summary is flagged `earlyPractice`, the end screen says so,
   and a chip shows during the session.
5. **Hand-off**: `setLastSession` is called when the end screen appears (also for empty sessions, which carry `note` and
   `playable` for an honest empty state) and when the Session screen is left mid-session with something done.
   "Full summary" goes to `#/summary/<map>`.

## Choices Dan might overrule

- **Contrast repeat rule is stricter than "once a week"**: after a card, the same pair comes back only after 7 days *and*
  only if it was mixed up again since (`core/contrast.ts`, already in the snapshot). I kept it: a pair the learner has
  sorted out is not shown for ever.
- **"Another round" after early practice is another early-practice session**, not an ordinary one (an ordinary one would
  be empty, and the learner would have to click "Practise anyway" again).
- **Leaving mid-session by navigating away hands the summary over** (unless nothing was done yet, so opening a session
  and leaving never replaces a real last summary). Escape did this already.
- **The contrast card does not call out "the single differentiator"** of SCOPE §4.6: the content has no field for it. It
  shows blurbs and neighbours. A `differentiator` field would be a schema change (not mine).
- **The contrast cards show each callout's approach picture** (the first `approach` shot), not the one the question will
  use. The question's pictures are chosen when it is made.
- **Speed call has no hint while the picture is up** and the first-letter hint afterwards, like Name it.
- **`?flash=<ms>`** (100 to 10 000) fixes the flash time in dev and e2e builds only; it is absent from the production
  bundle (checked by searching the built JS).
- **Reduced motion is read once per session start** (Settings cannot change while a session is on screen).

## Verification

Run here (Linux, Node 22, pnpm 12.16.1, `pnpm install --frozen-lockfile`):

| command | result |
|---|---|
| `pnpm test` | 33 files passed, 1 skipped; **567 passed, 3 skipped** (524 before this work; the 3 skips are tests that need the real Mirage nav mesh) |
| `pnpm check` | **0 errors**, 2 warnings, both in files not owned by C (`Settings.svelte`, `Summary.svelte`) |
| `pnpm build` | succeeds **only with a stub for `styles/settings.css`**, see "Errors in files I do not own" |
| `pnpm content:validate` | 0 errors, 5 warnings (all `zone-empty`: Mirage has no callouts yet; map art is reported as "none" for every map) |

**Browser tests were run on Chromium, not Edge.** The repository's `playwright.config.ts` drives Edge, which is not
here. A local, uncommitted config (`playwright.linux.config.ts`, same config with the channel replaced by the
pre-installed Chromium at `/opt/pw-browsers/chromium`) ran `e2e/session.spec.ts` and `e2e/smoke.spec.ts`: **75 passed**,
and the 47 new tests repeated three times with 8 workers: **141 passed, none flaky**. So the new tests pass on Chromium
1243 with Playwright 1.64.1. They have **not** been run on Edge; Edge is Chromium-based but that is an inference, and the
owner should run `pnpm.cmd e2e` once. Two deliberate breakages of `runner.ts` (answer timed from the picture's
appearance; time limit off) were caught by both the unit tests and the browser tests, then reverted.

Also looked at by eye (screenshots at 1280x720, 1024x600, 768x1024, 360x640, 640x360): Speed call with the picture up
and gone, and the contrast card. Found and fixed one real layout bug that way (the Speed plate's picture overflowing
into its caption row in short landscape).

### Browser test coverage added

Speed call (flash, hide, inert choices, no key during the flash, timed from the hide, skip during the flash, hint after
the hide, reduced motion from the browser and from Settings both ways, no countdown on any other screen, a whole
session of Speed calls with the 30 % new-item cap, never asked before it is unlocked); contrast cards (the card, the
question after it, Space, once a week, leaving on the card, a whole session); early practice (offered, played, flagged,
logged, "Another round", not offered for an empty map or while something is due); settings (new per session, gentle
start, card limit, Hard mode, time limit with Playwright's fake clock, inside the time limit); the hand-off (finished,
Escape, walking away, leaving at once leaves the last real summary alone, empty map); and fit at all nine viewports for
Speed call (picture up, gone, reveal), the contrast card, and the early-practice end screen.

`e2e/support.ts` additions: `CONTRAST_SEEN_KEY`, `lastSession`, `LastSessionSnapshot`, `waitForView`, `MasteredOptions`,
`seedMastered` (a learner whose items are stable long enough that Speed call has just opened, or has been asked once so
nothing is due), `seedConfusions`. Two internal changes to existing helpers: `play`/`answerQuestion` now handle the
contrast phase and Speed call, and a map click lands on the lower left of the region (see below); `seedVeteran` now
writes through the shared `writeDemoEvents` with unchanged behaviour.

## Not done, or not verified

- Not run on Edge or on Windows. Nothing was tried on a real phone.
- Not tried with real screenshots (AVIF from the game), so the flash on a real, large picture is untested; the Speed
  call waits for the picture to load before it starts the clock (4 s give-up), which is exercised only with the synthetic
  data-URL pictures.
- The Speed call has no non-visual alternative (the picture is the question); the screen reader is told that the
  picture is up and when it is gone, which is all it can do.
- Hard mode "stricter rules" (SCOPE §12c) is not built; the Hard-mode switch is content only.
- No retention (0.85 to 0.95) browser test: it is read by `createScheduler(prefs.retention)` and covered by the scheduler
  tests only.

## Errors in files I do not own (not touched)

- **`pnpm build` and the e2e build fail on a clean checkout**: `screens/Settings.svelte` (package D) imports
  `../styles/settings.css`, which does not exist. I created an empty, uncommitted local stub (excluded in
  `.git/info/exclude`) to build and test; D must add the real file.
- `Settings.svelte:140` a11y warning (`<main role="tabpanel">`), `Summary.svelte:44` `state_referenced_locally`.
- Package A's `RegionMap.svelte` now has a third zoom button ("fit"); on phones the three 44 px buttons span 132 px and
  cover most of a very small map (360x340 with the keyboard open). This made the existing "typed question fits with the
  keyboard open" test fail on the unchanged snapshot (a region's centre was under a button). I made the test helper click
  the lower left of a region instead, which is what a person would do; the cramped map is A's to look at.

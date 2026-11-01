# Brief for parallel work packages (2026-11-02)

You are one of several agents finishing the **Callouts** app in parallel, in one shared folder, tonight. Read this whole
file, then your work package at the bottom. Dan (the owner) wants everything that does not depend on his in-game
review finished. Report honestly: what works, what you tested, what you did not.

## The project in one paragraph

Callouts is a personal, local-first web app that teaches Counter-Strike 2 map callouts: real screenshots, a custom
overhead map, quizzes scheduled with FSRS. Svelte 5 (runes only) + Vite + strict TypeScript, no SvelteKit, hash router,
IndexedDB for the review log. Hand-made "direction C" design: dark only, one monospace face (IBM Plex Mono), six
colours, flat surfaces, lowercase text. **Every screen fits one viewport and never scrolls** (SCOPE §5.3) except the
dev-only Editor. Beginner friendly. The spec is `SCOPE.md` at the repo root (long: read the sections you need with
Grep, e.g. §4 learning design, §5 screens, §6 design, §7 architecture). The design comps are in `design/` (HTML+CSS;
`design/home.html`, `map.html`, `session.html`, `states.html`, `screens.css`, `screens2.css`, `tokens.css`). Port the
comps; do not restyle. Decisions: `docs/adr/0001-stack.md`. Built so far: `SCOPE.md` §10 "Phase 1" paragraphs.

## Layout and rules

- `app/src/core/` framework-free logic with Vitest tests next to it (`*.test.ts`). **No Svelte, no DOM in core.**
  Learning logic (scheduler, session builder, quiz engine, mastery, log, matching, mapview maths) is already there and
  tested: read `app/src/core/*.ts` before writing similar code; reuse, do not duplicate.
- `app/src/screens/`, `components/`, `app/` (data, settings, session start), `storage/` (IndexedDB), `styles/` (global
  CSS ported from the comps: `components.css` shared primitives, `session.css` session screens; add your own file per
  screen group and import it in `main.ts` **only if you own that screen**), `editor/` and `tools/` (the dev-only Editor,
  not yours).
- Svelte 5 **runes only** (`$state`, `$derived`, `$effect`, `$props`); no `export let`, no `$:`, no stores for
  component state. Use `$state.raw` for big objects. TypeScript strict, `noUncheckedIndexedAccess`.
- Comment density and naming like the surrounding code: short header comment saying what a file is and why; comments
  explain reasons, not mechanics. Plain, specific English. No filler.
- Text is lowercased by CSS (`body { text-transform: lowercase }`); write sentence case in the source.
- Content limits (name ≤ 28, blurb ≤ 120, ≤ 4 neighbours, ≤ 5 aliases) are enforced by schema; do not scroll to cope.
- **No new dependencies. No downloads or installs of any kind.** If you believe one is needed, do it without, or stop and
  say so in your report. No `ExecutionPolicy Bypass`. Do not launch, close or touch Counter-Strike 2.
- The folder is **not a git repository**: nothing to commit, no worktrees. Never delete files you did not create. Never
  rewrite `SCOPE.md`, `docs/adr/*`, `data/*.json` (content) or another work package's files; write your notes to
  `docs/notes/<your-package>.md` instead (what you built, choices, what is not done), and the coordinator merges them.
- Tell the truth in comments, notes and your report. If a test was not run, say so.

## Commands (Windows PowerShell; run from `app/`)

```powershell
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
pnpm.cmd exec vitest run src/core/yourfile.test.ts   # unit tests for your files (fast)
pnpm.cmd test                                       # all unit tests
pnpm.cmd check                                      # svelte-check + tsc for everything
pnpm.cmd build                                      # production build
$env:E2E_PORT = '41NN'; pnpm.cmd e2e --grep "yourtests"   # browser tests; pick your own free port 4180-4199
```

- Use `pnpm.cmd` / `npm.cmd`, never bare `pnpm` in PowerShell. `pnpm.cmd` passes arguments through cmd.exe, so **do not
  put `|` in `--grep`**; use one pattern.
- **Use your own `E2E_PORT`** (each package has a number below). The e2e build includes the synthetic map `de_test`
  (`app/.env.e2e`); open it as `/?seed=1#/session/de_test`. Playwright drives the installed Edge; do not download browsers.
- Other agents edit other files at the same time, so `pnpm.cmd check` may show errors in files you do not own. Fix
  yours; list the others in your report, do not touch them.
- Write temporary files and screenshots outside the repo (use a scratch folder under `$env:TEMP`).
- Screens are checked at 1920×1080, 1366×768, 1280×720, 1024×600, 768×1024, 390×844, 360×640, 844×390, 640×360:
  `app/e2e/support.ts` has `expectFits`, `play`, `seedVeteran`, `savedEvents` helpers; read `app/e2e/session.spec.ts` for
  the pattern (a fit test per viewport, a keyboard test, a persistence test). Every screen you build gets Playwright
  tests in a spec file of your own, including the fit matrix and keyboard operation.

## Contracts already in place (do not break; extend compatibly)

- Routes (`app/src/core/router.ts`): `#/` home, `#/map/<id>`, `#/study/<id>`, `#/session/<id>[?zone=<zone>]`,
  `#/summary/<id>`, `#/progress`, `#/settings`, `#/editor[/<id>]` (dev only). `App.svelte` already routes to stub files in
  `app/src/screens/` (`Home`, `Map`, `Study`, `Summary`, `Progress`, `Settings`): the owner of a screen **replaces its
  stub file** (keep the `$props` shape: map screens take `{ map: string }`).
- Settings: `app/src/app/settings.ts` (`getSettings`, `updateSettings`, `subscribeSettings`, `hardModeFor`,
  `AppSettings`). localStorage. Everyone reads settings through it.
- Hand-off Session → Summary: `app/src/app/last-session.ts` (`setLastSession`, `getLastSession`).
- Map data: `app/src/app/data.ts` (`loadAvailableMaps`, `MapData` incl. `art: string | null`, the walkable-surface
  silhouette path in radar pixels, null until generated). The synthetic map `de_test` exists in dev/e2e builds only.
- Review log: `app/src/storage/idb-store.ts` + `core/log.ts`. DB `callouts` (real) and `callouts-demo` (synthetic map).
  **Never write to the real DB from tests.**
- Primer: route `#/primer` (stub `screens/Primer.svelte`, owned by package B). Home (package A) sends a first-time user
  there when `settings.primerSeen` is false; the primer sets it when seen or skipped; Settings (D) links back to it.
- Names: `app/src/core/naming.ts` (`displayName`, `otherName`, `acceptedNames` for the settings `naming`). Show callout
  names through it wherever a name is shown; the session uses `acceptedNames` for typed answers.
- `components/RegionMap.svelte` already **accepts** (but does not yet draw) these optional props, so any screen can pass
  them: `fills` (mastery by callout id), `changed` (ids to emphasise), `art` (walkable-surface silhouette path),
  `selected` (callout id), `onregion` (called with a callout id when a region is clicked or activated). Package A
  implements them; others only pass them.
- Mirage (`de_mirage`) has **no callouts yet** (empty list); the app must handle "no callouts" gracefully everywhere.
- The shots URL base is `/shots/<file>`; `tools/shots-plugin.ts` serves them (content-pipeline package fills it in).

## Work packages and who owns which files

| Package | Owns |
|---|---|
| **A map** | `components/RegionMap.svelte`, `screens/Home.svelte`, `screens/Map.svelte`, `screens/session/AskPoint.svelte`, `screens/session/PointReveal.svelte`, `app/progress.ts`, `styles/home.css`, `styles/map.css`, `e2e/home-map.spec.ts` |
| **B study** | `screens/Study.svelte`, `screens/Summary.svelte`, `screens/Progress.svelte`, `screens/Primer.svelte`, `core/stats.ts`, `styles/study.css`, `styles/summary.css`, `styles/progress.css`, `e2e/study-summary-progress.spec.ts` |
| **C session** | `core/{quiz,runner,session,mastery,rating,distractors,log,types,match,store}.ts` (+tests), `screens/Session.svelte`, `screens/session/*` except AskPoint/PointReveal, `styles/session.css`, `app/start-session.ts`, `e2e/session.spec.ts`, `e2e/support.ts` |
| **D settings/data/offline** | `screens/Settings.svelte`, `app/settings.ts`, `core/exportfile.ts`, `storage/*`, `app/packs.ts`, `app/register-sw.ts`, `public/*` (service worker, manifest, icons), `styles/settings.css`, `e2e/settings-offline.spec.ts`; may add one line to `main.ts` to register the service worker |
| **E content pipeline** | `scripts/*` (new), `tools/shots-plugin.ts`, `app/src/app/data.ts` (art only), `content-tools/**` (new files), `data/art/*`, `package.json` (add **scripts only**), `e2e/shots.spec.ts` |
| coordinator | `editor/`, `core/editor/`, `tools/editor-plugin.ts`, `App.svelte`, `core/router.ts`, `main.ts`, `vite.config.ts`, `playwright.config.ts`, docs |

If you need a change in a file you do not own, make the smallest additive change that unblocks you and say so in your
report, or work around it. `main.ts` imports your CSS files: ask the coordinator in your report; until then import
yours at the top of your screen's `<script>` as `import '../styles/yours.css'` (Vite handles CSS imports in components).
`package.json`: re-read it right before editing and change only your lines.

## Report format

End with: (1) what you built, file by file; (2) test results (commands and counts, exactly); (3) design/behaviour
choices Dan might overrule; (4) what is not done or not verified; (5) errors in files you do not own. Also write the
same to `docs/notes/<package>.md`.

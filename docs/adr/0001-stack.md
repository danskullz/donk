# ADR 0001: UI stack

Status: accepted, 2026-10-28 (Phase 0). Decided once; do not reopen unless one of the triggers at the end fires.

## Context

Callouts is a personal, local-first, installable web app (SCOPE.md §7.1). What the stack has to carry:

- **Hand-written CSS.** The look is direction C (SCOPE.md §6): one monospace face, six colours, flat surfaces. The comps in `design/` are plain HTML and CSS and must port across with little change.
- **A map component that reacts to data.** An inline SVG of 60–150 regions whose fill follows each callout's mastery state, with hover, selection, pan and zoom, hit-testing on nested regions (Hard mode) and a camera cone.
- **One-viewport screens** built from CSS grids with `fr` rows (SCOPE.md §5.3). The framework must not fight this, for example by wrapping everything in extra scroll containers.
- **Real logic outside the UI.** The scheduler glue, quiz engine, answer matching and review log are the part that must be correct. They should be testable without a browser.
- **Offline.** A service worker, per-map asset packs, IndexedDB.
- **Environment.** Node and pnpm are **not installed** on this machine. Content tooling so far is Python (stdlib and numpy) and works.

## Options

| Option | For | Against |
|---|---|---|
| **Svelte 5 + Vite + TypeScript** (SPA, no SvelteKit) | Scoped CSS in the component file, so each screen of `design/` ports nearly one-to-one. Compiled, fine-grained updates suit a map where one region changes fill. Small runtime. Svelte 5 is current (5.56 in June 2026). | Runes syntax is newer than the Svelte 4 material that most examples and most model training use, so an AI pair can slip into the old syntax. Smaller ecosystem than React. |
| **React + Vite + TypeScript** | Largest ecosystem and the most familiar code for an AI pair. | Scoped CSS needs CSS Modules or a convention, re-rendering a 150-path SVG needs memoisation care, more boilerplate for the same screens. Nothing here needs what React is best at. |
| **Preact + htm, no build step** | Runs without Node. | No TypeScript, no scoped CSS, no Vitest or Playwright integration worth the name. Fine for a small page, thin for a mid-size app with a scheduler and a data layer. |
| **Plain ES modules, no library** | Zero downloads. | A hand-rolled view layer for five screens and a reactive map is more code to get wrong than the framework it avoids. |

## Decision

**Svelte 5 + Vite + TypeScript (strict), as a static single-page app. No SvelteKit.** Routing is a hash router of about twenty lines, because there are seven screens (SCOPE.md §5.1) and three levels of navigation at most. Everything else in SCOPE.md §7.2 stands, with these changes made during Phase 0:

- **Content tooling stays in Python** (`content-tools/`): extraction, nav decode, capture, and the scheduler simulation already work with no extra downloads. TypeScript is for the app and its build scripts only.
- **potrace is not needed.** The map art is generated from the decoded nav mesh (SCOPE.md §6.8), not vectorised from the radar.
- **Fonts via `@fontsource/ibm-plex-mono`** (SIL Open Font Licence, bundled woff2 files), so the offline app needs no separate font download or Google Fonts request.
- **`sharp`** for AVIF/WebP conversion of the captured PNGs, since Python has no AVIF encoder here.
- **`ts-fsrs`** (MIT) for scheduling in the app, with the parameters and rating rules in SCOPE.md §4.4 as revised by the simulation.

## Rules that limit the risk

1. **Keep the logic framework-free.** Scheduler glue, quiz engine, answer matching, mastery derivation, projection maths and the review log live in plain TypeScript modules under `app/src/core/`, with Vitest tests and no Svelte imports. Svelte is the view layer only. If the framework is ever replaced, the core and the CSS survive.
2. **Runes only.** Write `$state`, `$derived`, `$effect` and `$props`. No `export let`, no `$:`, no stores for component state. A lint rule or a CI grep catches Svelte 4 syntax.
3. **Port the comps, don't restyle them.** The three screens in `design/` are the visual reference. Visual-regression screenshots (SCOPE.md §7.7) are compared against renders of those comps.

## Consequences

- **Installed 2026-11-01, with Dan's go-ahead:** Node 26.13.0 (LTS, from winget) and pnpm 12.16.1 (from npm; Node 26 has no `corepack`), then the packages in `app/`. Checked end to end: unit tests, `svelte-check`, the production build, `sharp` AVIF encoding, and Playwright driving the Edge that ships with Windows (`channel: 'msedge'`, so Playwright's own browser download is not needed).
- **`ts-fsrs` 6 defaults to FSRS-7, and the app asks for FSRS-6.** The Phase 0 simulation (SCOPE §4.4) is FSRS-6; the wrapper in `app/src/core/scheduler.ts` names the model and a test fails if it changes. Moving to FSRS-7 means re-running the simulation first.
- **TypeScript is pinned to 6.x.** `svelte-check` accepts 5 or 6 only, and the native TypeScript 7 produced an unmet peer. Move to 7 when `svelte-check` supports it.
- The repository gets two toolchains, Python for content and Node for the app, joined by JSON and images in `data/` and `assets/`.
- Svelte's compiler catches unused CSS and missing accessibility attributes at build time, which suits the accessibility goals in SCOPE.md §5.7.
- **Session CSS is global, not scoped (2026-11-02).** The comps' layouts reach across the parts of a screen (a rule such as `display: contents` on a column so its children join the parent grid), and scoped styles cannot do that across component boundaries. `styles/components.css` (shared primitives) and `styles/session.css` (the session screens) are ported from the comps nearly verbatim; self-contained components such as the map (`RegionMap.svelte`) keep scoped styles. The cost is that unused rules are not flagged by the compiler.
- **A synthetic map for development and browser tests (2026-11-02).** `de_test`, built from the test fixtures with generated placeholder pictures, is loaded only when `import.meta.env.DEV` or `VITE_DEMO=1` (`pnpm build --mode e2e`, from `.env.e2e`). The condition is written inline at the import site so the bundler drops the code; the normal production build was checked to contain neither the map nor the test hook (`window.__callouts`).

- **The Callout Editor lives in `app/`, not `/editor` (2026-11-02).** SCOPE §7.3 sketched a top-level `/editor` folder; the Editor needs the core (nav mesh, polygons, schemas, validator), the map maths and the Vite dev server, so it is `app/src/editor/` + `app/src/core/editor/` + a dev-server plugin in `app/tools/`. It is reached by `#/editor/<map>` under `pnpm dev` only: the route imports it behind an inline `import.meta.env.DEV` test, and the production build was checked to contain none of it.

## What would change this

- Runes-related mistakes cost more than the framework saves, seen as repeated review comments in Phase 1.
- A required library exists only for React (for example a map-interaction library that the custom pan and zoom cannot replace).
- Node cannot be installed on the machine.

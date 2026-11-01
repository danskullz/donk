# Callouts

A personal, local-first web app for learning Counter-Strike 2 map callouts: real screenshots, a custom overhead map,
and quizzes scheduled with spaced repetition (FSRS). Svelte 5 + Vite + strict TypeScript. No accounts, no analytics,
no payments; progress stays in the browser (IndexedDB) and is exportable.

**Unofficial fan project. Not affiliated with or endorsed by Valve.** Counter-Strike is a trademark of Valve
Corporation. The game's radars, screenshots and textures are Valve's property and are **not** in this repository: they
are generated from the user's own CS2 install and live in the gitignored `assets/` folder. The repository holds the
tooling and the facts (callout names, regions, camera metadata).

- `SCOPE.md`: the product and technical plan, and the build log (§10).
- `docs/adr/`: decisions. `docs/notes/`: working notes.
- `app/`: the app. `data/`: callout data. `content-tools/`: extraction and capture tooling (Python, Phase 0 spikes).
- `design/`: design tokens, comps' CSS and decision log.

```sh
cd app
pnpm install
pnpm dev          # http://localhost:5173/  (development builds include a synthetic map: /?seed=1#/session/de_test)
pnpm test         # unit tests
pnpm check        # svelte-check
pnpm build
```

The Callout Editor (development only) is at `#/editor/<map>` under `pnpm dev`; it needs the generated nav meshes in
`assets/valve/nav`.

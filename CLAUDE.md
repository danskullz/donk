# Callouts: notes for Claude sessions

Personal, local-first CS2 callout-learning app. Read `README.md`, then `SCOPE.md` (spec and build log; long, use search
for the sections you need) and `docs/notes/AGENT_BRIEF.md` (conventions, contracts, file ownership). Decisions:
`docs/adr/0001-stack.md`.

## Rules that matter

- Svelte 5 **runes only**; strict TypeScript. Logic that is not UI lives in `app/src/core/` with Vitest tests, no
  Svelte or DOM there. Port the design (dark, one monospace face, lowercase text, flat surfaces, one accent); every app
  screen fits one viewport and never scrolls (the dev-only Editor is exempt).
- **No new dependencies** without asking the owner. Never commit Valve-owned media (`assets/` is gitignored).
- Content is data in `data/` (schemas in `app/src/core/schema.ts`, checks in `core/validate.ts`); Mirage has no
  callouts yet: they come from the Editor and the owner's in-game review. Do not invent callouts.
- Write comments that say why, in plain specific English. Tell the truth about what was and was not tested.

## Commands (run in `app/`)

```sh
pnpm install --frozen-lockfile
pnpm test            # Vitest (unit)
pnpm check           # svelte-check + tsc
pnpm build           # production build
pnpm content:validate
```

Browser tests (`pnpm e2e`, `pnpm e2e:editor`) drive the **Microsoft Edge that ships with Windows** (`channel:
'msedge'`) and will not run on a Linux machine without changing the channel; on Linux run unit tests and `pnpm check`
and say that browser tests were not run. The owner's machine is Windows (PowerShell: call `pnpm.cmd`).

## What is not in the repository

`assets/` (Valve media: radars, nav meshes, captured screenshots), `design/*.html` (generated comps), `data/art/`.
Tests that need the real Mirage nav mesh skip themselves when it is absent.

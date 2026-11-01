// A read-only window onto the session for the browser tests (e2e/): what is on screen, in plain data, so a test can
// give the right answer or check the reveal without scraping text. Installed only in development and in the e2e
// build (the same condition as the demo map in app/data.ts), so production builds do not carry it.

import { getLastSession } from '../../app/last-session';
import type { RunnerView } from '../../core/runner';

export interface ViewSnapshot {
  phase: RunnerView['phase'];
  mode: string | null;
  target: { id: string; name: string; level: string } | null;
  /** Option labels in the order shown, for the choice modes. */
  options: { id: string; name: string }[];
  hint: string | null;
  result: { correct: boolean; chosen: string | null; close: boolean; skipped: boolean; fuzzy: boolean; hops: number | null } | null;
  progress: { done: number; total: number };
  summary: { answered: number; correct: number; finished: boolean; endedBy: string | null; earlyPractice: boolean } | null;
  /** Speed call: the picture is still showing, and for how long it will (ms). */
  flashing: boolean;
  flashMs: number | null;
  /** A contrast card: the other callout of the pair. */
  other: { id: string; name: string } | null;
}

export function describeView(view: RunnerView | null): ViewSnapshot | null {
  if (!view) return null;
  const base = { options: [], hint: null, result: null, summary: null, progress: view.progress, flashing: false, flashMs: null, other: null };
  switch (view.phase) {
    case 'intro':
      return { ...base, phase: 'intro', mode: null, target: { id: view.callout.id, name: view.callout.name, level: view.callout.level } };
    case 'contrast':
      return {
        ...base,
        phase: 'contrast',
        mode: null,
        target: { id: view.a.id, name: view.a.name, level: view.a.level },
        other: { id: view.b.id, name: view.b.name },
      };
    case 'done':
      return {
        ...base,
        phase: 'done',
        mode: null,
        target: null,
        summary: { answered: view.summary.answered, correct: view.summary.correct, finished: view.summary.finished, endedBy: view.summary.endedBy ?? null, earlyPractice: view.summary.earlyPractice === true },
      };
    case 'question':
    case 'reveal': {
      const p = view.prompt;
      const options = p.mode === 'which-view' ? p.options.map((o) => o.callout) : p.mode === 'name-mc' || p.mode === 'read-map' || p.mode === 'speed' ? p.options : [];
      return {
        ...base,
        phase: view.phase,
        mode: p.mode,
        target: { id: p.target.id, name: p.target.name, level: p.target.level },
        options: options.map((c) => ({ id: c.id, name: c.name })),
        hint: view.phase === 'question' && view.hint ? view.hint.kind : null,
        result: view.phase === 'reveal' ? { correct: view.result.correct, chosen: view.result.chosen, close: view.result.close, skipped: view.result.skipped, fuzzy: view.result.fuzzy, hops: view.result.hops } : null,
        flashing: view.phase === 'question' && view.flashing,
        flashMs: p.mode === 'speed' ? p.flashMs : null,
      };
    }
  }
}

type Hooked = { snapshot: () => ViewSnapshot | null; lastSession: () => unknown };

/** Development and the e2e build only; a production build has neither the hook nor the address overrides below. */
const DEV_HOOKS = import.meta.env.DEV || import.meta.env.VITE_DEMO === '1';

/**
 * `?flash=1500` in the address: show every Speed call picture for exactly this long, so a browser test does not have to
 * wait out (or race) the item's own time. Ignored in production builds and for anything that is not a time in
 * 100 ms to 10 s.
 */
export function flashFromQuery(query: URLSearchParams, enabled: boolean = DEV_HOOKS): number | undefined {
  const raw = enabled ? query.get('flash') : null;
  const ms = raw === null || raw.trim() === '' ? Number.NaN : Number(raw);
  return Number.isFinite(ms) && ms >= 100 && ms <= 10_000 ? ms : undefined;
}

export function installTestHook(read: () => RunnerView | null): void {
  if (DEV_HOOKS) {
    const hook: Hooked = {
      snapshot: () => describeView(read()),
      // What the Summary screen would be handed (app/last-session.ts), for the tests of the hand-off.
      lastSession: () => getLastSession() ?? null,
    };
    (window as unknown as { __callouts?: Hooked }).__callouts = hook;
  }
}

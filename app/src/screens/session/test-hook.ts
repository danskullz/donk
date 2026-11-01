// A read-only window onto the session for the browser tests (e2e/): what is on screen, in plain data, so a test can
// give the right answer or check the reveal without scraping text. Installed only in development and in the e2e
// build (the same condition as the demo map in app/data.ts), so production builds do not carry it.

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
  summary: { answered: number; correct: number; finished: boolean } | null;
}

export function describeView(view: RunnerView | null): ViewSnapshot | null {
  if (!view) return null;
  const base = { options: [], hint: null, result: null, summary: null, progress: view.progress };
  switch (view.phase) {
    case 'intro':
      return { ...base, phase: 'intro', mode: null, target: { id: view.callout.id, name: view.callout.name, level: view.callout.level } };
    case 'done':
      return { ...base, phase: 'done', mode: null, target: null, summary: { answered: view.summary.answered, correct: view.summary.correct, finished: view.summary.finished } };
    case 'question':
    case 'reveal': {
      const p = view.prompt;
      const options = p.mode === 'which-view' ? p.options.map((o) => o.callout) : p.mode === 'name-mc' || p.mode === 'read-map' ? p.options : [];
      return {
        ...base,
        phase: view.phase,
        mode: p.mode,
        target: { id: p.target.id, name: p.target.name, level: p.target.level },
        options: options.map((c) => ({ id: c.id, name: c.name })),
        hint: view.phase === 'question' && view.hint ? view.hint.kind : null,
        result: view.phase === 'reveal' ? { correct: view.result.correct, chosen: view.result.chosen, close: view.result.close, skipped: view.result.skipped, fuzzy: view.result.fuzzy, hops: view.result.hops } : null,
      };
    }
  }
}

export function installTestHook(read: () => RunnerView | null): void {
  if (import.meta.env.DEV || import.meta.env.VITE_DEMO === '1') {
    (window as unknown as { __callouts?: { snapshot: () => ViewSnapshot | null } }).__callouts = { snapshot: () => describeView(read()) };
  }
}

import { beforeAll, describe, expect, it } from 'vitest';
import { createDerived } from '../../core/log';
import { mulberry32 } from '../../core/rng';
import { SessionRunner, type RunnerView } from '../../core/runner';
import { createScheduler, type Scheduler } from '../../core/scheduler';
import { DEFAULT_SESSION_SETTINGS, playableCallouts, type SessionCard, type SessionPlan, type SessionSettings } from '../../core/session';
import { makeCallouts, makeMap } from '../../core/test-fixtures';
import { itemKey } from '../../core/types';
import { describeView, flashFromQuery } from './test-hook';

const settings: SessionSettings = { ...DEFAULT_SESSION_SETTINGS, includeDraft: true };
const callouts = playableCallouts(makeCallouts(), settings);
let scheduler: Scheduler;
beforeAll(async () => {
  scheduler = await createScheduler();
});

function runnerFor(cards: SessionCard[], over: { earlyPractice?: boolean; flashMs?: number } = {}) {
  const plan: SessionPlan = { cards, dueCount: 0, throttled: false, introduced: [], note: null, ...(over.earlyPractice ? { earlyPractice: true } : {}) };
  let n = 0;
  return new SessionRunner({ map: makeMap(), callouts, derived: createDerived(), scheduler, settings, plan, rng: mulberry32(2), now: () => 1000 * (n += 1), newId: () => `e${(n += 1)}`, flashMs: over.flashMs });
}
const quiz = (id: string, mode: 'speed' | 'which-view' | 'name-mc'): SessionCard => ({ type: 'quiz', calloutId: `test.${id}`, mode, key: itemKey(`test.${id}`, mode), reason: 'due', options: 4 });

describe('flashFromQuery (?flash= in the address)', () => {
  const q = (s: string) => new URLSearchParams(s);

  it('reads a time in milliseconds', () => {
    expect(flashFromQuery(q('flash=1500'), true)).toBe(1500);
    expect(flashFromQuery(q('seed=1&flash=250'), true)).toBe(250);
  });

  it('is absent when there is no usable time', () => {
    expect(flashFromQuery(q(''), true)).toBeUndefined();
    expect(flashFromQuery(q('flash='), true)).toBeUndefined();
    expect(flashFromQuery(q('flash=soon'), true)).toBeUndefined();
    expect(flashFromQuery(q('flash=Infinity'), true)).toBeUndefined();
  });

  it('refuses times a test could not mean: under 100 ms or over 10 s', () => {
    expect(flashFromQuery(q('flash=99'), true)).toBeUndefined();
    expect(flashFromQuery(q('flash=0'), true)).toBeUndefined();
    expect(flashFromQuery(q('flash=-500'), true)).toBeUndefined();
    expect(flashFromQuery(q('flash=10001'), true)).toBeUndefined();
    expect(flashFromQuery(q('flash=10000'), true)).toBe(10_000);
  });

  it('is ignored when the hooks are switched off, as in a production build', () => {
    expect(flashFromQuery(q('flash=1500'), false)).toBeUndefined();
  });
});

describe('describeView', () => {
  it('has nothing to say before the session has loaded', () => {
    expect(describeView(null)).toBeNull();
  });

  it('describes a Speed call: flashing with its time, then open with its four options', () => {
    const r = runnerFor([quiz('mid', 'speed')], { flashMs: 1800 });
    const flashing = describeView(r.view);
    expect(flashing).toMatchObject({ phase: 'question', mode: 'speed', flashing: true, flashMs: 1800, target: { id: 'test.mid' }, hint: null });
    expect(flashing?.options).toHaveLength(4);
    expect(flashing?.options.map((o) => o.id)).toContain('test.mid');

    const open = describeView(r.flashEnded());
    expect(open).toMatchObject({ phase: 'question', mode: 'speed', flashing: false, flashMs: 1800 });
  });

  it('describes the reveal of a Speed call with its result and no longer flashing', () => {
    const r = runnerFor([quiz('mid', 'speed')]);
    r.flashEnded();
    const view = describeView(r.answer({ kind: 'choice', calloutId: 'test.mid' }));
    expect(view).toMatchObject({ phase: 'reveal', mode: 'speed', flashing: false, result: { correct: true, chosen: 'test.mid', skipped: false } });
  });

  it('describes a contrast card with both callouts and nothing to answer', () => {
    const r = runnerFor([{ type: 'contrast', calloutId: 'test.a-ramp', otherId: 'test.mid', confusions: 3 }, quiz('a-ramp', 'which-view')]);
    expect(describeView(r.view)).toMatchObject({
      phase: 'contrast',
      mode: null,
      target: { id: 'test.a-ramp', name: 'A Ramp' },
      other: { id: 'test.mid', name: 'Mid' },
      options: [],
      result: null,
      flashing: false,
      progress: { done: 0, total: 1 },
    });
  });

  it('describes the end: how it ended and whether it was early practice', () => {
    const early = describeView(runnerFor([quiz('mid', 'name-mc')], { earlyPractice: true }).leave());
    expect(early).toMatchObject({ phase: 'done', target: null, summary: { answered: 0, finished: false, endedBy: 'left', earlyPractice: true } });
    const plain = describeView(runnerFor([]).view);
    expect(plain).toMatchObject({ phase: 'done', summary: { finished: true, endedBy: 'plan', earlyPractice: false } });
  });

  it('gives other views a null "other" and false "flashing"', () => {
    const r = runnerFor([{ type: 'intro', calloutId: 'test.mid' }, quiz('mid', 'name-mc')]);
    const intro: RunnerView = r.view;
    expect(describeView(intro)).toMatchObject({ phase: 'intro', other: null, flashing: false, flashMs: null });
    expect(describeView(r.continue())).toMatchObject({ phase: 'question', mode: 'name-mc', other: null, flashing: false, flashMs: null });
  });
});

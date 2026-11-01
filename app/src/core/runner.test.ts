import { beforeAll, describe, expect, it } from 'vitest';
import { applyEvent, createDerived, replay, type Derived, type ReviewEvent } from './log';
import type { Prompt } from './quiz';
import { mulberry32 } from './rng';
import { SessionRunner, startOfLocalDay, summaryCalloutIds, type RunnerInput, type RunnerView } from './runner';
import { createScheduler, type Scheduler } from './scheduler';
import { buildSession, DEFAULT_SESSION_SETTINGS, playableCallouts, type QuizCard, type SessionPlan, type SessionSettings } from './session';
import { makeCallouts, makeMap } from './test-fixtures';
import { answer, intro } from './test-helpers';
import { CHOICE_MODES, Grade, itemKey, MODES, type Mode } from './types';

const T0 = Date.parse('2026-02-01T09:00:00Z');
const settings: SessionSettings = { ...DEFAULT_SESSION_SETTINGS, includeDraft: true };
const map = makeMap();
const callouts = playableCallouts(makeCallouts(), settings);
let scheduler: Scheduler;
beforeAll(async () => {
  scheduler = await createScheduler();
});

interface Rig {
  runner: SessionRunner;
  derived: Derived;
  events: ReviewEvent[];
  contrasts: { a: string; b: string; count: number; ts: number }[];
  clock: { t: number };
}

function rig(over: { derived?: Derived; plan?: SessionPlan; seed?: number; settings?: Partial<SessionSettings>; flashMs?: number } = {}): Rig {
  const derived = over.derived ?? createDerived();
  const clock = { t: T0 };
  const events: ReviewEvent[] = [];
  const contrasts: Rig['contrasts'] = [];
  let n = 0;
  const plan =
    over.plan ??
    buildSession({ callouts, derived, scheduler, settings, zoneOrder: map.zones.map((z) => z.id), answersToday: 0, now: new Date(T0), rng: mulberry32(1) });
  const input: RunnerInput = {
    map, callouts, derived, scheduler, settings: { ...settings, ...over.settings }, plan,
    rng: mulberry32(over.seed ?? 3),
    now: () => clock.t,
    newId: () => `ev${(n += 1)}`,
    onEvent: (e) => events.push(e),
    onContrast: (c) => contrasts.push(c),
    flashMs: over.flashMs,
  };
  return { runner: new SessionRunner(input), derived, events, contrasts, clock };
}

const card = (id: string, mode: Mode, reason: QuizCard['reason'] = 'due'): QuizCard => ({ type: 'quiz', calloutId: `test.${id}`, mode, key: itemKey(`test.${id}`, mode), reason, options: CHOICE_MODES.includes(mode) || mode === 'speed' ? 4 : null });
const planOf = (...cards: QuizCard[]): SessionPlan => ({ cards, dueCount: cards.length, throttled: false, introduced: [], note: null });

/** What a learner who knows the answer would do on this prompt. */
function rightAnswer(p: Prompt) {
  switch (p.mode) {
    case 'name-mc':
    case 'read-map':
    case 'which-view':
    case 'speed':
      return { kind: 'choice' as const, calloutId: p.target.id };
    case 'name-typed':
      return { kind: 'typed' as const, text: p.target.name };
    case 'pin':
    case 'where-am-i':
      return { kind: 'point' as const, x: p.target.anchor[0], y: p.target.anchor[1], level: p.target.level };
  }
}

/** Play to the end, answering every question correctly after `thinkMs`. */
function playAll(r: Rig, thinkMs = 1500): RunnerView {
  for (let guard = 0; guard < 200; guard++) {
    const v = r.runner.view;
    if (v.phase === 'done') return v;
    if (v.phase === 'question') {
      // a Speed call picture shows for its whole time first
      if (v.flashing) r.clock.t += v.prompt.mode === 'speed' ? v.prompt.flashMs : 0;
      if (v.flashing) r.runner.flashEnded();
      r.clock.t += thinkMs;
      r.runner.answer(rightAnswer(v.prompt));
    } else r.runner.continue();
  }
  throw new Error('session did not end');
}

describe('a first session, played through', () => {
  it('shows each intro, then quizzes on the same callouts, then finishes', () => {
    const r = rig();
    const seen: string[] = [];
    for (let guard = 0; guard < 100 && r.runner.view.phase !== 'done'; guard++) {
      const v = r.runner.view;
      seen.push(v.phase);
      if (v.phase === 'question') {
        r.clock.t += 2500;
        r.runner.answer(rightAnswer(v.prompt));
      } else r.runner.continue();
    }
    expect(seen.slice(0, 4)).toEqual(['intro', 'intro', 'intro', 'intro']);
    expect(seen.slice(4)).toEqual(['question', 'reveal', 'question', 'reveal', 'question', 'reveal', 'question', 'reveal']);
    const done = r.runner.view;
    if (done.phase !== 'done') throw new Error('phase');
    expect(done.summary).toMatchObject({ finished: true, answered: 4, correct: 4 });
    expect(done.summary.introduced).toHaveLength(4);
  });

  it('numbers intros "n of 4" and counts only quiz cards in the progress', () => {
    const r = rig();
    const first = r.runner.view;
    if (first.phase !== 'intro') throw new Error('phase');
    expect([first.introIndex, first.introTotal, first.progress]).toEqual([1, 4, { done: 0, total: 4 }]);
    const second = r.runner.continue();
    if (second.phase !== 'intro') throw new Error('phase');
    expect(second.introIndex).toBe(2);
    r.runner.continue();
    r.runner.continue();
    const q = r.runner.continue();
    expect(q.phase).toBe('question');
    expect(q.progress).toEqual({ done: 0, total: 4 });
    const a = r.runner.answer(rightAnswer((q as Extract<RunnerView, { phase: 'question' }>).prompt));
    expect(a.progress).toEqual({ done: 1, total: 4 });
  });

  it('logs an intro event for each callout the learner moves past, and an answer event for each answer', () => {
    const r = rig();
    playAll(r);
    expect(r.events.filter((e) => e.kind === 'intro')).toHaveLength(4);
    expect(r.events.filter((e) => e.kind === 'answer')).toHaveLength(4);
    expect(new Set(r.events.map((e) => e.id)).size).toBe(8);
  });

  it('keeps the live state identical to a replay of the log (the log is the source of truth)', () => {
    const r = rig();
    playAll(r);
    const fresh = replay(r.events, scheduler);
    expect([...fresh.introduced.keys()].sort()).toEqual([...r.derived.introduced.keys()].sort());
    expect([...fresh.items.keys()].sort()).toEqual([...r.derived.items.keys()].sort());
    for (const [key, item] of r.derived.items) {
      const again = fresh.items.get(key)!;
      expect(scheduler.stabilityDays(again.memory)).toBeCloseTo(scheduler.stabilityDays(item.memory), 10);
      expect(scheduler.dueAt(again.memory).getTime()).toBe(scheduler.dueAt(item.memory).getTime());
    }
  });

  it('reports the callouts that moved up in mastery', () => {
    const r = rig();
    const done = playAll(r);
    if (done.phase !== 'done') throw new Error('phase');
    expect(done.summary.mastery).toHaveLength(4);
    expect(done.summary.mastery.every((m) => m.from === 'new' && m.to === 'learning')).toBe(true);
  });

  it('is repeatable: the same seed asks the same questions', () => {
    const prompts = (seed: number) => {
      const r = rig({ seed });
      const out: string[] = [];
      for (let guard = 0; guard < 100 && r.runner.view.phase !== 'done'; guard++) {
        const v = r.runner.view;
        if (v.phase === 'question' && v.prompt.mode === 'name-mc') out.push(v.prompt.options.map((o) => o.id).join(','));
        if (v.phase === 'question') r.runner.answer(rightAnswer(v.prompt));
        else r.runner.continue();
      }
      return out;
    };
    expect(prompts(5)).toEqual(prompts(5));
    expect(prompts(5)).not.toEqual(prompts(6));
  });
});

describe('answering', () => {
  const learnerWith = (...ids: string[]) => {
    const d = createDerived();
    for (const id of ids) {
      applyEvent(d, intro(`test.${id}`, T0 - 1000), scheduler);
      applyEvent(d, answer(`test.${id}`, 'name-mc', T0 - 500, Grade.Good), scheduler);
    }
    return d;
  };

  it('measures the time from the question appearing to the answer', () => {
    const r = rig({ derived: learnerWith('mid'), plan: planOf(card('mid', 'name-mc')) });
    r.clock.t += 2345;
    const v = r.runner.answer({ kind: 'choice', calloutId: 'test.mid' });
    if (v.phase !== 'reveal') throw new Error('phase');
    expect(v.outcome.latencyMs).toBe(2345);
    expect(r.events[0]).toMatchObject({ kind: 'answer', latencyMs: 2345, ts: T0 + 2345 });
  });

  it('does not count time spent away from the tab', () => {
    const r = rig({ derived: learnerWith('mid'), plan: planOf(card('mid', 'name-mc'), card('mid', 'name-mc')) });
    r.clock.t += 1000;
    r.runner.pause();
    r.runner.pause(); // a second hide event changes nothing
    r.clock.t += 60_000;
    r.runner.resume();
    r.clock.t += 500;
    const v = r.runner.answer({ kind: 'choice', calloutId: 'test.mid' });
    if (v.phase !== 'reveal') throw new Error('phase');
    expect(v.outcome.latencyMs).toBe(1500);

    // still hidden when the answer arrives (a key press brings the tab back first): the same result
    r.runner.continue();
    r.clock.t += 800;
    r.runner.pause();
    r.clock.t += 30_000;
    const w = r.runner.answer({ kind: 'choice', calloutId: 'test.mid' });
    if (w.phase !== 'reveal') throw new Error('phase');
    expect(w.outcome.latencyMs).toBe(800);
  });

  it('tells a wrong answer apart and counts repeated mix-ups', () => {
    const d = learnerWith('mid', 'a-ramp');
    const r = rig({ derived: d, plan: planOf(card('mid', 'name-mc'), card('mid', 'name-mc')), seed: 1 });
    const reveals: Extract<RunnerView, { phase: 'reveal' }>[] = [];
    for (let i = 0; i < 2; i++) {
      const q = r.runner.view;
      if (q.phase !== 'question') throw new Error('phase');
      // always pick the same wrong neighbour: a-ramp is not necessarily offered, so force an offered one that is
      const wrong = q.prompt.mode === 'name-mc' ? q.prompt.options.find((o) => o.id === 'test.t-spawn') ?? q.prompt.options.find((o) => o.id !== 'test.mid')! : null;
      const v = r.runner.answer({ kind: 'choice', calloutId: wrong!.id });
      if (v.phase !== 'reveal') throw new Error('phase');
      reveals.push(v);
      r.runner.continue();
    }
    expect(reveals[0]!.result.correct).toBe(false);
    expect(reveals[0]!.outcome.rating).toBe(Grade.Again);
    expect(reveals[0]!.outcome.confusions).toBe(1);
    if (reveals[0]!.result.chosen === reveals[1]!.result.chosen) expect(reveals[1]!.outcome.confusions).toBe(2);
    const done = r.runner.view;
    if (done.phase !== 'done') throw new Error('phase');
    expect(done.summary).toMatchObject({ answered: 2, correct: 0 });
    expect(done.summary.confusions.length).toBeGreaterThan(0);
    expect(done.summary.confusions[0]).toMatchObject({ target: 'test.mid' });
  });

  it('logs a right answer without a "chosen"', () => {
    const r = rig({ derived: learnerWith('mid'), plan: planOf(card('mid', 'name-mc')) });
    r.runner.answer({ kind: 'choice', calloutId: 'test.mid' });
    expect(r.events[0]).toMatchObject({ correct: true, chosen: null });
  });

  it('treats a skip as a wrong answer with nothing chosen, and shows the reveal', () => {
    const r = rig({ derived: learnerWith('mid'), plan: planOf(card('mid', 'name-mc')) });
    const v = r.runner.skip();
    if (v.phase !== 'reveal') throw new Error('phase');
    expect(v.result).toMatchObject({ correct: false, skipped: true, chosen: null });
    expect(r.events[0]).toMatchObject({ correct: false, rating: Grade.Again, chosen: null });
  });

  it('costs a rating step to ask for a hint, except on the first answer of an item', () => {
    const withHint = rig({ derived: learnerWith('mid'), plan: planOf(card('mid', 'name-mc')) });
    const q = withHint.runner.view;
    if (q.phase !== 'question') throw new Error('phase');
    expect(q.hint).toBeNull();
    const h = withHint.runner.hint();
    if (h.phase !== 'question') throw new Error('phase');
    expect(h.hint).toEqual({ kind: 'letter', text: 'M' });
    withHint.clock.t += 1000;
    const done = withHint.runner.answer({ kind: 'choice', calloutId: 'test.mid' });
    if (done.phase !== 'reveal') throw new Error('phase');
    expect(done.outcome).toMatchObject({ hintUsed: true, rating: Grade.Hard });
    expect(withHint.events[0]).toMatchObject({ hint: true });

    // a brand-new item: hints are free (SCOPE §4.11)
    const fresh = rig({ plan: planOf(card('palace', 'read-map', 'new-mode')), derived: (() => { const d = createDerived(); applyEvent(d, intro('test.palace', T0 - 5), scheduler); return d; })() });
    fresh.runner.hint();
    fresh.clock.t += 1000;
    const v = fresh.runner.answer({ kind: 'choice', calloutId: 'test.palace' });
    if (v.phase !== 'reveal') throw new Error('phase');
    expect(v.outcome.rating).toBe(Grade.Good);
  });

  it('ignores calls that do not fit the phase', () => {
    const r = rig({ derived: learnerWith('mid'), plan: planOf(card('mid', 'name-mc')) });
    const q = r.runner.view;
    expect(r.runner.continue()).toBe(q);
    r.runner.answer({ kind: 'choice', calloutId: 'test.mid' });
    const reveal = r.runner.view;
    expect(r.runner.answer({ kind: 'choice', calloutId: 'test.mid' })).toBe(reveal);
    expect(r.runner.hint()).toBe(reveal);
    expect(r.events).toHaveLength(1);
    r.runner.continue();
    expect(r.runner.view.phase).toBe('done');
    expect(r.runner.continue().phase).toBe('done');
    expect(r.runner.skip().phase).toBe('done');
    expect(r.events).toHaveLength(1);
  });

  it('can ask every mode and log each answer against its own item', () => {
    const everyone = createDerived();
    for (const c of callouts) applyEvent(everyone, intro(c.id, T0 - 10), scheduler);
    const plan = planOf(...MODES.map((m) => card('a-ramp', m, 'new-mode')));
    const r = rig({ derived: everyone, plan });
    playAll(r);
    const answers = r.events.filter((e) => e.kind === 'answer');
    expect(answers.map((e) => (e.kind === 'answer' ? e.mode : null))).toEqual(['name-mc', 'read-map', 'which-view', 'pin', 'name-typed', 'where-am-i', 'speed']);
    expect(answers.every((e) => e.kind === 'answer' && e.correct)).toBe(true);
    expect([...r.derived.items.keys()].sort()).toEqual(answers.map((e) => itemKey((e as { callout: string }).callout, (e as { mode: Mode }).mode)).sort());
  });
});

describe('leaving early', () => {
  it('ends the session at once and keeps everything answered so far', () => {
    const r = rig();
    r.runner.continue();
    r.runner.continue();
    r.runner.continue();
    r.runner.continue();
    const q = r.runner.view;
    if (q.phase !== 'question') throw new Error('phase');
    r.runner.answer(rightAnswer(q.prompt));
    const out = r.runner.leave();
    if (out.phase !== 'done') throw new Error('phase');
    expect(out.summary).toMatchObject({ finished: false, answered: 1, correct: 1 });
    expect(out.progress).toEqual({ done: 1, total: 4 });
    expect(r.events.filter((e) => e.kind === 'answer')).toHaveLength(1);
    expect(r.runner.leave()).toBe(out);
  });

  it('can leave during the intros: only the intros already passed are logged', () => {
    const r = rig();
    r.runner.continue();
    r.runner.continue();
    const out = r.runner.leave();
    if (out.phase !== 'done') throw new Error('phase');
    expect(out.summary).toMatchObject({ finished: false, answered: 0 });
    expect(out.summary.introduced).toHaveLength(2);
    expect(r.events).toHaveLength(2);
  });
});

describe('an empty plan', () => {
  it('goes straight to done', () => {
    const r = rig({ plan: { cards: [], dueCount: 0, throttled: false, introduced: [], note: 'nothing-due' } });
    const v = r.runner.view;
    if (v.phase !== 'done') throw new Error('phase');
    expect(v.summary).toMatchObject({ finished: true, answered: 0, correct: 0, totalMs: 0 });
    expect(v.progress).toEqual({ done: 0, total: 0 });
  });
});

describe('summary figures', () => {
  it('lists the three slowest right answers, slowest first, and leaves out wrong ones', () => {
    const d = createDerived();
    for (const c of callouts) applyEvent(d, intro(c.id, T0 - 10), scheduler);
    const plan = planOf(card('mid', 'pin'), card('a-ramp', 'pin'), card('palace', 'pin'), card('b-site', 'pin'), card('connector', 'pin'));
    const r = rig({ derived: d, plan });
    const times = [1000, 9000, 4000, 7000, 20000];
    times.forEach((ms, i) => {
      const q = r.runner.view;
      if (q.phase !== 'question') throw new Error('phase');
      r.clock.t += ms;
      // the last, slowest answer is wrong
      r.runner.answer(i === 4 ? { kind: 'point', x: 5000, y: 5000, level: 'default' } : rightAnswer(q.prompt));
      r.runner.continue();
    });
    const done = r.runner.view;
    if (done.phase !== 'done') throw new Error('phase');
    expect(done.summary.slowest.map((s) => s.latencyMs)).toEqual([9000, 7000, 4000]);
    expect(done.summary).toMatchObject({ answered: 5, correct: 4, totalMs: 41000 });
  });
});

describe('startOfLocalDay', () => {
  it('is midnight in the local time zone and never later than the time given', () => {
    const noon = new Date(2026, 5, 15, 12, 30, 45).getTime();
    const start = new Date(startOfLocalDay(noon));
    expect([start.getHours(), start.getMinutes(), start.getSeconds(), start.getMilliseconds()]).toEqual([0, 0, 0, 0]);
    expect(start.getDate()).toBe(15);
    expect(startOfLocalDay(noon)).toBeLessThanOrEqual(noon);
  });
});

/** A learner who has met `ids` and answered the given modes once each, well, a moment before the session. */
function metWith(ids: readonly string[], modes: readonly Mode[] = ['name-mc']): Derived {
  const d = createDerived();
  for (const id of ids) {
    applyEvent(d, intro(`test.${id}`, T0 - 2000), scheduler);
    for (const m of modes) applyEvent(d, answer(`test.${id}`, m, T0 - 1000, Grade.Good), scheduler);
  }
  return d;
}
const asked = (r: Rig) => {
  const v = r.runner.view;
  if (v.phase !== 'question') throw new Error(`phase ${v.phase}`);
  return v;
};
const revealed = (v: RunnerView) => {
  if (v.phase !== 'reveal') throw new Error(`phase ${v.phase}`);
  return v;
};

describe('Speed call', () => {
  const speed = (modes: readonly Mode[] = ['name-mc', 'speed'], flashMs?: number) => rig({ derived: metWith(['mid'], modes), plan: planOf(card('mid', 'speed')), flashMs });

  it("opens flashing for the item's own time: 3 s the first time", () => {
    const q = asked(speed(['name-mc']));
    expect(q.flashing).toBe(true);
    expect(q.prompt.mode === 'speed' && q.prompt.flashMs).toBe(3000);
  });

  it('takes no answer while the picture is up, except "I don\'t know"', () => {
    const r = speed();
    const q = asked(r);
    expect(r.runner.answer({ kind: 'choice', calloutId: 'test.mid' })).toBe(q);
    expect(r.runner.hint()).toBe(q);
    expect(r.events).toHaveLength(0);
    const skipped = revealed(r.runner.skip());
    expect(skipped.result).toMatchObject({ skipped: true, correct: false });
    expect(r.events[0]).toMatchObject({ mode: 'speed', correct: false, rating: Grade.Again });
  });

  it('times the answer from the moment the picture hides, not from when it appeared', () => {
    const r = speed();
    r.clock.t += 3000; // the picture was up for its full 3 s
    const open = r.runner.flashEnded();
    expect(open).toMatchObject({ phase: 'question', flashing: false });
    r.clock.t += 1100;
    const v = revealed(r.runner.answer({ kind: 'choice', calloutId: 'test.mid' }));
    expect(v.outcome.latencyMs).toBe(1100);
    expect(v.outcome.rating).toBe(Grade.Easy); // 1.1 s is under 0.6 x the 2 s fluent time, and this is not the first answer
    expect(r.events[0]).toMatchObject({ mode: 'speed', latencyMs: 1100, correct: true });
  });

  it('rates slow naming Hard and ordinary naming Good', () => {
    const slow = speed();
    slow.clock.t += 3000;
    slow.runner.flashEnded();
    slow.clock.t += 3300;
    expect(revealed(slow.runner.answer({ kind: 'choice', calloutId: 'test.mid' })).outcome.rating).toBe(Grade.Hard);
    const normal = speed();
    normal.clock.t += 3000;
    normal.runner.flashEnded();
    normal.clock.t += 2000;
    expect(revealed(normal.runner.answer({ kind: 'choice', calloutId: 'test.mid' })).outcome.rating).toBe(Grade.Good);
  });

  it('allows a hint once the picture has hidden, and it costs a rating step', () => {
    const r = speed();
    r.clock.t += 3000;
    r.runner.flashEnded();
    const h = r.runner.hint();
    expect(h).toMatchObject({ phase: 'question', hint: { kind: 'letter', text: 'M' } });
    r.clock.t += 1000;
    expect(revealed(r.runner.answer({ kind: 'choice', calloutId: 'test.mid' })).outcome.rating).toBe(Grade.Hard);
  });

  it('leaves out time away from the tab after the picture hid', () => {
    const r = speed();
    r.clock.t += 3000;
    r.runner.flashEnded();
    r.clock.t += 400;
    r.runner.pause();
    r.clock.t += 120_000;
    r.runner.resume();
    r.clock.t += 300;
    expect(revealed(r.runner.answer({ kind: 'choice', calloutId: 'test.mid' })).outcome.latencyMs).toBe(700);
  });

  it('starts timing at the hide even when the tab was hidden at that moment', () => {
    const r = speed();
    r.clock.t += 500;
    r.runner.pause();
    r.clock.t += 60_000;
    r.runner.flashEnded();
    r.clock.t += 20_000; // still hidden
    r.runner.resume();
    r.clock.t += 900;
    expect(revealed(r.runner.answer({ kind: 'choice', calloutId: 'test.mid' })).outcome.latencyMs).toBe(900);
  });

  it('ignores flashEnded on a card that is not flashing, and on other modes', () => {
    const r = rig({ derived: metWith(['mid']), plan: planOf(card('mid', 'name-mc')) });
    const q = asked(r);
    expect(q.flashing).toBe(false);
    expect(r.runner.flashEnded()).toBe(q);
    const s = speed();
    s.runner.flashEnded();
    const open = s.runner.view;
    expect(s.runner.flashEnded()).toBe(open);
  });

  it('can be told how long to flash', () => {
    const q = asked(speed(['name-mc'], 300));
    expect(q.prompt.mode === 'speed' && q.prompt.flashMs).toBe(300);
  });

  it('shortens the flash as the item is answered right again', () => {
    const d = metWith(['mid'], ['name-mc']);
    applyEvent(d, answer('test.mid', 'speed', T0 - 500, Grade.Good), scheduler);
    applyEvent(d, answer('test.mid', 'speed', T0 - 400, Grade.Good), scheduler);
    const q = asked(rig({ derived: d, plan: planOf(card('mid', 'speed')) }));
    expect(q.prompt.mode === 'speed' && q.prompt.flashMs).toBe(2000);
  });
});

describe('a contrast card', () => {
  const pairPlan = (): SessionPlan => ({
    cards: [
      { type: 'contrast', calloutId: 'test.palace', otherId: 'test.a-site', confusions: 3 },
      { ...card('palace', 'which-view', 'contrast'), partner: 'test.a-site' },
    ],
    dueCount: 0,
    throttled: false,
    introduced: [],
    note: null,
  });
  const pair = () => rig({ derived: metWith(['palace', 'a-site'], ['name-mc', 'which-view']), plan: pairPlan() });

  it('shows the pair with nothing to answer, outside the progress count', () => {
    const r = pair();
    const v = r.runner.view;
    if (v.phase !== 'contrast') throw new Error(`phase ${v.phase}`);
    expect([v.a.id, v.b.id, v.confusions]).toEqual(['test.palace', 'test.a-site', 3]);
    expect(v.progress).toEqual({ done: 0, total: 1 });
    expect(r.runner.answer({ kind: 'choice', calloutId: 'test.palace' })).toBe(v);
    expect(r.runner.skip()).toBe(v);
    expect(r.runner.hint()).toBe(v);
    expect(r.events).toHaveLength(0);
  });

  it('is followed by a Which view? question with both callouts among the views', () => {
    const r = pair();
    r.runner.continue();
    const q = asked(r);
    expect(q.prompt.mode).toBe('which-view');
    if (q.prompt.mode !== 'which-view') throw new Error('mode');
    expect(q.prompt.target.id).toBe('test.palace');
    expect(q.prompt.options.map((o) => o.callout.id)).toContain('test.a-site');
    expect(q.progress).toEqual({ done: 0, total: 1 });
  });

  it('reports itself as seen when the learner moves past it, once, and logs nothing to the review log', () => {
    const r = pair();
    expect(r.contrasts).toEqual([]);
    r.runner.continue();
    expect(r.contrasts).toEqual([{ a: 'test.palace', b: 'test.a-site', count: 3, ts: T0 }]);
    expect(r.events).toHaveLength(0);
    r.runner.continue(); // on a question, this does nothing
    expect(r.contrasts).toHaveLength(1);
  });

  it('is not reported as seen when the learner leaves on it', () => {
    const r = pair();
    r.runner.leave();
    expect(r.contrasts).toEqual([]);
  });

  it('plays through: the session ends after the question, counting one answer', () => {
    const r = pair();
    const done = playAll(r);
    if (done.phase !== 'done') throw new Error('phase');
    expect(done.summary).toMatchObject({ finished: true, answered: 1, correct: 1, introduced: [] });
  });
});

describe('the time limit', () => {
  const three = (minutes: number | null) =>
    rig({ derived: metWith(['mid', 'a-ramp', 'palace']), plan: planOf(card('mid', 'name-mc'), card('a-ramp', 'name-mc'), card('palace', 'name-mc')), settings: { maxMinutes: minutes } });
  const answerNow = (r: Rig) => revealed(r.runner.answer(rightAnswer(asked(r).prompt)));

  it('ends the session after the card on screen once the time is up', () => {
    const r = three(5);
    r.clock.t += 1000;
    answerNow(r);
    r.clock.t += 5 * 60_000;
    const v = r.runner.continue();
    if (v.phase !== 'done') throw new Error(`phase ${v.phase}`);
    expect(v.summary).toMatchObject({ finished: true, endedBy: 'time', answered: 1 });
    expect(r.events.filter((e) => e.kind === 'answer')).toHaveLength(1);
  });

  it('never cuts a question short: the one on screen can still be answered after the time is up', () => {
    const r = three(1);
    r.clock.t += 3 * 60_000; // the time passes while the learner thinks
    answerNow(r);
    expect(r.runner.view.phase).toBe('reveal');
    expect(r.runner.continue().phase).toBe('done');
  });

  it('keeps going while there is time left', () => {
    const r = three(5);
    r.clock.t += 60_000;
    answerNow(r);
    expect(r.runner.continue().phase).toBe('question');
  });

  it('does not count the time the tab was hidden', () => {
    const r = three(5);
    answerNow(r);
    r.runner.pause();
    r.clock.t += 30 * 60_000;
    r.runner.resume();
    expect(r.runner.continue().phase).toBe('question');
    // and while it is still hidden
    answerNow(r);
    r.runner.pause();
    r.clock.t += 30 * 60_000;
    r.runner.continue();
    expect(r.runner.view.phase).not.toBe('done');
  });

  it('has no effect without a limit, and a plan that runs out says so', () => {
    const r = three(null);
    r.clock.t += 24 * 3_600_000;
    const done = playAll(r);
    if (done.phase !== 'done') throw new Error('phase');
    expect(done.summary).toMatchObject({ finished: true, endedBy: 'plan', answered: 3 });
  });

  it('does not end between an intro and the question that tests it', () => {
    const fresh = rig({ settings: { maxMinutes: 1 } });
    fresh.clock.t += 10 * 60_000; // the intros take longer than the limit
    for (let i = 0; i < 4; i++) fresh.runner.continue();
    expect(fresh.runner.view.phase).toBe('question');
  });

  it('records that the learner left', () => {
    const r = three(5);
    const out = r.runner.leave();
    if (out.phase !== 'done') throw new Error('phase');
    expect(out.summary).toMatchObject({ finished: false, endedBy: 'left' });
  });
});

describe('early practice and the summary hand-off', () => {
  it('flags the summary when the plan was early practice', () => {
    const plan: SessionPlan = { ...planOf(card('mid', 'name-mc', 'early')), earlyPractice: true };
    const done = playAll(rig({ derived: metWith(['mid']), plan }));
    if (done.phase !== 'done') throw new Error('phase');
    expect(done.summary.earlyPractice).toBe(true);
    const normal = playAll(rig({ derived: metWith(['mid']), plan: planOf(card('mid', 'name-mc')) }));
    if (normal.phase !== 'done') throw new Error('phase');
    expect(normal.summary.earlyPractice).toBe(false);
  });

  it('lists every callout the summary mentions, once', () => {
    const ids = summaryCalloutIds({
      finished: true,
      answered: 2,
      correct: 1,
      totalMs: 3000,
      slowest: [{ calloutId: 'test.mid', mode: 'name-mc', latencyMs: 2000 }],
      confusions: [{ target: 'test.palace', chosen: 'test.mid', count: 2 }],
      introduced: ['test.a-ramp', 'test.mid'],
      mastery: [{ calloutId: 'test.b-site', from: 'new', to: 'learning' }],
    });
    expect(ids.sort()).toEqual(['test.a-ramp', 'test.b-site', 'test.mid', 'test.palace']);
  });
});

import { beforeAll, describe, expect, it } from 'vitest';
import { applyEvent, createDerived, type Derived } from './log';
import { mulberry32 } from './rng';
import { createScheduler, type Scheduler } from './scheduler';
import { answerEventFor, entriesFor, FLASH_FLOOR_MS, FLASH_START_MS, flashFor, gradeAnswer, hopsBetween, makePrompt, pickShot, type AnswerInput, type Prompt, type PromptContext } from './quiz';
import type { QuizCard } from './session';
import { makeCallouts } from './test-fixtures';
import { answer } from './test-helpers';
import { CHOICE_MODES, Grade, itemKey, type Mode } from './types';

let scheduler: Scheduler;
beforeAll(async () => {
  scheduler = await createScheduler();
});

const all = makeCallouts();
const standard = all.filter((c) => c.tier !== 3);
const byId = (id: string) => all.find((c) => c.id === `test.${id}`)!;
const ctx = (over: Partial<PromptContext> = {}): PromptContext => ({ callouts: standard, derived: createDerived(), levels: ['default'], rng: mulberry32(7), ...over });
const grading = (callouts = standard) => ({ callouts, entries: entriesFor(callouts) });
const card = (id: string, mode: Mode, options: 3 | 4 | null = CHOICE_MODES.includes(mode) ? 4 : null): QuizCard => ({ type: 'quiz', calloutId: `test.${id}`, mode, key: itemKey(`test.${id}`, mode), reason: 'due', options });
const prompt = (id: string, mode: Mode, over: Partial<PromptContext> = {}) => makePrompt(card(id, mode), ctx(over));
const ids = (list: { id: string }[]) => list.map((c) => c.id);

describe('makePrompt', () => {
  it('Name it: a screenshot of the target and the right number of options, target among them', () => {
    const p = prompt('palace', 'name-mc');
    if (p.mode !== 'name-mc') throw new Error('mode');
    expect(p.options).toHaveLength(4);
    expect(ids(p.options)).toContain('test.palace');
    expect(byId('palace').shots).toContainEqual(p.shot);
    expect(p.hint).toEqual({ kind: 'letter', text: 'P' });
    const gentle = makePrompt(card('palace', 'name-mc', 3), ctx());
    if (gentle.mode !== 'name-mc') throw new Error('mode');
    expect(gentle.options).toHaveLength(3);
  });

  it('Read the map: options only, target among them', () => {
    const p = prompt('connector', 'read-map');
    if (p.mode !== 'read-map') throw new Error('mode');
    expect(ids(p.options)).toContain('test.connector');
    expect(new Set(ids(p.options)).size).toBe(4);
  });

  it('Which view?: every option carries its own screenshot, and the hint drops a wrong one', () => {
    const p = prompt('mid', 'which-view');
    if (p.mode !== 'which-view') throw new Error('mode');
    expect(p.options).toHaveLength(4);
    for (const o of p.options) expect(o.callout.shots).toContainEqual(o.shot);
    expect(p.options.find((o) => o.callout.id === 'test.mid')).toBeDefined();
    expect(p.hint.kind).toBe('eliminate');
    if (p.hint.kind === 'eliminate') {
      expect(p.hint.calloutId).not.toBe('test.mid');
      expect(ids(p.options.map((o) => o.callout))).toContain(p.hint.calloutId);
    }
  });

  it('Which view? leaves out callouts that have no screenshot to show', () => {
    const bare = standard.map((c) => (c.id === 'test.palace' ? { ...c, shots: [] } : c));
    for (let seed = 1; seed <= 20; seed++) {
      const p = prompt('mid', 'which-view', { callouts: bare, rng: mulberry32(seed) });
      if (p.mode !== 'which-view') throw new Error('mode');
      expect(p.options.map((o) => o.callout.id)).not.toContain('test.palace');
    }
  });

  it('Pin it starts on the first level, so the level does not give the answer away; the hint is the zone', () => {
    const p = prompt('a-site', 'pin', { levels: ['upper', 'lower'] });
    if (p.mode !== 'pin') throw new Error('mode');
    expect(p.level).toBe('upper');
    expect(p.hint).toEqual({ kind: 'zone', zone: 'a' });
  });

  it('typed answers offer suggestions on the first question of an item only', () => {
    const first = prompt('palace', 'name-typed');
    if (first.mode !== 'name-typed') throw new Error('mode');
    expect(first.suggestions).toBe(true);
    const derived = createDerived();
    applyEvent(derived, answer('test.palace', 'name-typed', 1000, Grade.Good), scheduler);
    const later = prompt('palace', 'name-typed', { derived });
    if (later.mode !== 'name-typed') throw new Error('mode');
    expect(later.suggestions).toBe(false);
  });

  it('Where am I? shows a screenshot of the target', () => {
    const p = prompt('b-site', 'where-am-i');
    if (p.mode !== 'where-am-i') throw new Error('mode');
    expect(byId('b-site').shots).toContainEqual(p.shot);
    expect(p.level).toBe('default');
  });

  it('Speed call: a screenshot, four named options with the target among them, and a flash time', () => {
    const p = prompt('mid', 'speed');
    if (p.mode !== 'speed') throw new Error('mode');
    expect(byId('mid').shots).toContainEqual(p.shot);
    expect(p.options).toHaveLength(4);
    expect(ids(p.options)).toContain('test.mid');
    expect(p.hint).toEqual({ kind: 'letter', text: 'M' });
    expect(p.flashMs).toBe(FLASH_START_MS);
  });

  it('a callout that is not playable is refused', () => {
    expect(() => prompt('bench', 'pin')).toThrow(/not playable/);
  });

  it('adapts the options to pairs the learner has confused', () => {
    const derived = createDerived();
    for (let i = 0; i < 3; i++) applyEvent(derived, answer('test.palace', 'name-mc', 1000 + i, Grade.Again, 1500, 'test.b-apps'), scheduler);
    // b-apps is far from the palace, so only the confusions can bring it into a three-way choice
    let seen = 0;
    for (let seed = 1; seed <= 25; seed++) {
      const p = makePrompt(card('palace', 'name-mc', 3), ctx({ derived, rng: mulberry32(seed) }));
      if (p.mode === 'name-mc' && ids(p.options).includes('test.b-apps')) seen += 1;
    }
    expect(seen).toBeGreaterThan(20);
  });
});

describe('pickShot', () => {
  it('moves to the next screenshot on every answer and comes back round', () => {
    const palace = byId('palace');
    const files = [0, 1, 2, 3].map((n) => pickShot(palace, 'k', n).file);
    expect(new Set(files.slice(0, 3)).size).toBe(3);
    expect(files[3]).toBe(files[0]);
  });
  it('does not start every item on the same image', () => {
    const starts = new Set(['a:name-mc', 'a:name-typed', 'a:where-am-i', 'b:name-mc', 'c:name-mc', 'd:name-mc'].map((k) => pickShot(byId('palace'), k, 0).file));
    expect(starts.size).toBeGreaterThan(1);
  });
});

describe('hopsBetween', () => {
  it('counts neighbour steps in either direction', () => {
    expect(hopsBetween('test.mid', 'test.mid', all)).toBe(0);
    expect(hopsBetween('test.mid', 'test.t-spawn', all)).toBe(1);
    expect(hopsBetween('test.t-spawn', 'test.mid', all)).toBe(1);
    expect(hopsBetween('test.t-spawn', 'test.a-ramp', all)).toBe(2);
    expect(hopsBetween('test.t-spawn', 'test.palace', all)).toBe(4);
  });
  it('gives up beyond the limit and for callouts with no route', () => {
    expect(hopsBetween('test.t-spawn', 'test.palace', all, 2)).toBeNull();
    expect(hopsBetween('test.bench', 'test.mid', all)).toBeNull();
  });
});

describe('gradeAnswer: choices', () => {
  const p = (mode: 'name-mc' | 'read-map' | 'which-view') => prompt('a-ramp', mode);
  const pick = (id: string): AnswerInput => ({ kind: 'choice', calloutId: `test.${id}` });

  it('is right for the target, with nothing to flag', () => {
    const r = gradeAnswer(p('name-mc'), pick('a-ramp'), grading());
    expect(r).toMatchObject({ correct: true, chosen: 'test.a-ramp', close: false, skipped: false, fuzzy: false, hops: 0 });
  });

  it('is wrong for another option, and "close" when that one is a neighbour', () => {
    for (let seed = 1; seed < 40; seed++) {
      const pr = makePrompt(card('a-ramp', 'name-mc'), ctx({ rng: mulberry32(seed) }));
      if (pr.mode !== 'name-mc') throw new Error('mode');
      const wrong = pr.options.find((o) => o.id !== 'test.a-ramp')!;
      const r = gradeAnswer(pr, { kind: 'choice', calloutId: wrong.id }, grading());
      expect(r.correct).toBe(false);
      expect(r.chosen).toBe(wrong.id);
      expect(r.close).toBe(wrong.neighbours.includes('test.a-ramp') || byId('a-ramp').neighbours.includes(wrong.id));
    }
  });

  it('grades Which view? by the callout that owns the picked picture', () => {
    const pr = p('which-view');
    if (pr.mode !== 'which-view') throw new Error('mode');
    const other = pr.options.find((o) => o.callout.id !== 'test.a-ramp')!;
    expect(gradeAnswer(pr, { kind: 'choice', calloutId: other.callout.id }, grading()).correct).toBe(false);
    expect(gradeAnswer(pr, pick('a-ramp'), grading()).correct).toBe(true);
  });

  it('refuses answers of the wrong kind or for a callout that was not offered', () => {
    expect(() => gradeAnswer(p('name-mc'), { kind: 'typed', text: 'ramp' }, grading())).toThrow(/takes a choice/);
    expect(() => gradeAnswer(p('read-map'), { kind: 'point', x: 1, y: 1, level: 'default' }, grading())).toThrow(/takes a choice/);
    const pr = p('name-mc');
    if (pr.mode !== 'name-mc') throw new Error('mode');
    const missing = standard.find((c) => !pr.options.some((o) => o.id === c.id))!;
    expect(() => gradeAnswer(pr, { kind: 'choice', calloutId: missing.id }, grading())).toThrow(/not one of the options/);
  });
});

describe('gradeAnswer: typed', () => {
  const pr = prompt('palace', 'name-typed');
  const type = (text: string) => gradeAnswer(pr, { kind: 'typed', text }, grading());

  it('takes the name, an alias, and a one-typo spelling with no penalty', () => {
    expect(type('Palace')).toMatchObject({ correct: true, fuzzy: false, chosen: 'test.palace' });
    expect(type('  PALACE ')).toMatchObject({ correct: true });
    expect(type('pal')).toMatchObject({ correct: true, fuzzy: false });
    expect(type('palase')).toMatchObject({ correct: true, fuzzy: true });
  });

  it('counts another callout as wrong and remembers which one was meant', () => {
    expect(type('connector')).toMatchObject({ correct: false, chosen: 'test.connector' });
    expect(type('a ramp')).toMatchObject({ correct: false, chosen: 'test.a-ramp' });
  });

  it('counts nonsense and empty answers as wrong with nothing chosen', () => {
    expect(type('zzzz')).toMatchObject({ correct: false, chosen: null, close: false });
    expect(type('')).toMatchObject({ correct: false, chosen: null });
  });

  it('is "close" when the callout typed is next to the target', () => {
    expect(type('a site')).toMatchObject({ correct: false, chosen: 'test.a-site', close: true });
  });
});

describe('gradeAnswer: points (Pin it and Where am I?)', () => {
  const pinA = prompt('a-site', 'pin');
  const at = (x: number, y: number, level = 'default'): AnswerInput => ({ kind: 'point', x, y, level });

  it('is right for a point inside the target, and records the guess', () => {
    const r = gradeAnswer(pinA, at(700, 150), grading());
    expect(r).toMatchObject({ correct: true, chosen: 'test.a-site', guess: [700, 150], close: false });
  });

  it('is wrong but close for the next region, and wrong with nothing chosen for empty ground', () => {
    expect(gradeAnswer(pinA, at(500, 100), grading())).toMatchObject({ correct: false, chosen: 'test.a-ramp', close: true, hops: 1 });
    expect(gradeAnswer(pinA, at(100, 100), grading())).toMatchObject({ correct: false, chosen: 'test.t-spawn', close: false });
    expect(gradeAnswer(pinA, at(5000, 5000), grading())).toMatchObject({ correct: false, chosen: null, hops: null });
  });

  it('treats a point on a shared edge as inside, like the map does', () => {
    expect(gradeAnswer(pinA, at(600, 100), grading()).chosen).not.toBeNull();
  });

  it('ignores regions on other levels', () => {
    expect(gradeAnswer(pinA, at(700, 150, 'lower'), grading())).toMatchObject({ correct: false, chosen: null });
  });

  it('uses the same test for Where am I?', () => {
    const where = prompt('palace', 'where-am-i');
    expect(gradeAnswer(where, at(700, 300), grading())).toMatchObject({ correct: true });
    expect(gradeAnswer(where, at(700, 100), grading())).toMatchObject({ correct: false, chosen: 'test.a-site', close: true });
  });

  describe('with Hard spots in play (SCOPE §4.12)', () => {
    const withBench = { callouts: all, entries: entriesFor(all) };
    it('a click inside a Hard spot counts for the standard callout around it', () => {
      expect(gradeAnswer(pinA, at(670, 70), withBench)).toMatchObject({ correct: true, chosen: 'test.a-site' });
    });
    it('the Hard spot itself must be hit: its parent is not enough', () => {
      const pinBench = makePrompt(card('bench', 'pin'), ctx({ callouts: all }));
      expect(gradeAnswer(pinBench, at(670, 70), withBench)).toMatchObject({ correct: true, chosen: 'test.bench' });
      expect(gradeAnswer(pinBench, at(750, 150), withBench)).toMatchObject({ correct: false, chosen: 'test.a-site' });
    });
  });

  it('refuses a choice for a map question', () => {
    expect(() => gradeAnswer(pinA, { kind: 'choice', calloutId: 'test.a-site' }, grading())).toThrow(/takes a point/);
  });
});

describe('skipping', () => {
  it('is a wrong answer with nothing chosen, in every mode', () => {
    for (const mode of ['name-mc', 'read-map', 'which-view', 'pin', 'name-typed', 'where-am-i'] as const) {
      const r = gradeAnswer(prompt('mid', mode), { kind: 'skip' }, grading());
      expect(r, mode).toMatchObject({ correct: false, chosen: null, skipped: true, close: false });
    }
  });
});

describe('answerEventFor', () => {
  const pr: Prompt = prompt('palace', 'name-mc');
  const result = (correct: boolean, chosen: string | null) => ({ correct, chosen, fuzzy: false, close: false, skipped: false, guess: null, hops: null });
  const facts = (over: Partial<Parameters<typeof answerEventFor>[0]> = {}) => ({ prompt: pr, result: result(true, 'test.palace'), latencyMs: 1500, hintUsed: false, ts: 5000, id: 'e1', firstAnswer: false, ...over });

  it('infers the rating the way SCOPE §4.4 says', () => {
    expect(answerEventFor(facts()).rating).toBe(Grade.Good);
    expect(answerEventFor(facts({ latencyMs: 900 })).rating).toBe(Grade.Easy);
    expect(answerEventFor(facts({ latencyMs: 900, firstAnswer: true })).rating).toBe(Grade.Good);
    expect(answerEventFor(facts({ latencyMs: 4000 })).rating).toBe(Grade.Hard);
    expect(answerEventFor(facts({ hintUsed: true })).rating).toBe(Grade.Hard);
    expect(answerEventFor(facts({ hintUsed: true, firstAnswer: true })).rating).toBe(Grade.Good);
    expect(answerEventFor(facts({ result: result(false, 'test.mid') })).rating).toBe(Grade.Again);
  });

  it('records what was chosen only when it was wrong', () => {
    expect(answerEventFor(facts()).chosen).toBeNull();
    expect(answerEventFor(facts({ result: result(false, 'test.mid') })).chosen).toBe('test.mid');
    expect(answerEventFor(facts({ result: result(false, null) })).chosen).toBeNull();
  });

  it('keeps the facts of the answer', () => {
    expect(answerEventFor(facts({ latencyMs: 1234.6, hintUsed: true }))).toMatchObject({ kind: 'answer', id: 'e1', ts: 5000, callout: 'test.palace', mode: 'name-mc', correct: true, latencyMs: 1235, hint: true });
  });
});

describe('a whole item over time', () => {
  it('feeds the scheduler through the log: wrong, then right, grows stability', () => {
    const d: Derived = createDerived();
    applyEvent(d, answer('test.palace', 'name-mc', 1000, Grade.Again), scheduler);
    const s1 = scheduler.stabilityDays(d.items.get('test.palace:name-mc')!.memory);
    applyEvent(d, answer('test.palace', 'name-mc', 2000, Grade.Good), scheduler);
    expect(scheduler.stabilityDays(d.items.get('test.palace:name-mc')!.memory)).toBeGreaterThan(s1);
  });
});

describe('Speed call (SCOPE §4.2)', () => {
  const speedWith = (rightAnswers: number, over: Partial<PromptContext> = {}) => {
    const derived = createDerived();
    for (let i = 0; i < rightAnswers; i++) applyEvent(derived, answer('test.mid', 'speed', 1000 + i, Grade.Good), scheduler);
    const p = prompt('mid', 'speed', { derived, ...over });
    if (p.mode !== 'speed') throw new Error('mode');
    return p;
  };

  it('flashes for 3 s at first and half a second less after every right answer, never under 1.5 s', () => {
    expect([0, 1, 2, 3, 4, 10].map(flashFor)).toEqual([3000, 2500, 2000, 1500, 1500, 1500]);
    expect(FLASH_FLOOR_MS).toBe(1500);
    expect(speedWith(0).flashMs).toBe(3000);
    expect(speedWith(2).flashMs).toBe(2000);
    expect(speedWith(5).flashMs).toBe(1500);
  });

  it('counts right answers only: a wrong one does not shorten the flash', () => {
    const derived = createDerived();
    applyEvent(derived, answer('test.mid', 'speed', 1000, Grade.Again, 1500, 'test.a-ramp'), scheduler);
    const p = prompt('mid', 'speed', { derived });
    expect(p.mode === 'speed' && p.flashMs).toBe(3000);
  });

  it('can be fixed to one time for tests and the ?flash= hook', () => {
    expect(speedWith(0, { flashMs: 250 }).flashMs).toBe(250);
  });

  it('is graded as a choice, like Name it, and a skip is wrong', () => {
    const p = speedWith(0);
    expect(gradeAnswer(p, { kind: 'choice', calloutId: 'test.mid' }, grading())).toMatchObject({ correct: true, chosen: 'test.mid' });
    const wrong = p.options.find((o) => o.id !== 'test.mid')!;
    expect(gradeAnswer(p, { kind: 'choice', calloutId: wrong.id }, grading())).toMatchObject({ correct: false, chosen: wrong.id });
    expect(gradeAnswer(p, { kind: 'skip' }, grading())).toMatchObject({ correct: false, skipped: true });
    expect(() => gradeAnswer(p, { kind: 'typed', text: 'mid' }, grading())).toThrow(/takes a choice/);
  });

  it('is rated against a 2 s fluent time: Easy under 1.2 s, Good to 3.2 s, Hard beyond', () => {
    const p = speedWith(0);
    const rate = (latencyMs: number) => answerEventFor({ prompt: p, result: { correct: true, chosen: null, fuzzy: false, close: false, skipped: false, guess: null, hops: 0 }, latencyMs, hintUsed: false, ts: 1, id: 'x', firstAnswer: false }).rating;
    expect([rate(1000), rate(2000), rate(3100), rate(3300)]).toEqual([Grade.Easy, Grade.Good, Grade.Good, Grade.Hard]);
  });
});

describe('the question after a contrast card', () => {
  it('always has the other callout of the pair among its views', () => {
    for (let seed = 1; seed <= 20; seed++) {
      // b-apps is far from palace, so only the pairing can bring it into the four views
      const c: QuizCard = { ...card('palace', 'which-view'), reason: 'contrast', partner: 'test.b-apps' };
      const p = makePrompt(c, ctx({ rng: mulberry32(seed) }));
      if (p.mode !== 'which-view') throw new Error('mode');
      expect(ids(p.options.map((o) => o.callout))).toEqual(expect.arrayContaining(['test.palace', 'test.b-apps']));
      expect(p.options).toHaveLength(4);
    }
  });
});

import { beforeAll, describe, expect, it } from 'vitest';
import { applyEvent, createDerived, type Derived } from './log';
import { mulberry32 } from './rng';
import { createScheduler, type Scheduler } from './scheduler';
import type { Callout } from './schema';
import { buildSession, DEFAULT_SESSION_SETTINGS, playableCallouts, spaceOut, type QuizCard, type SessionInput, type SessionSettings } from './session';
import { makeCallouts, makeMap } from './test-fixtures';
import { answer, intro } from './test-helpers';
import { DAY_MS, Grade } from './types';

const T0 = Date.parse('2026-02-01T09:00:00Z');
const zoneOrder = makeMap().zones.map((z) => z.id);
const dev: SessionSettings = { ...DEFAULT_SESSION_SETTINGS, includeDraft: true };
let s: Scheduler;
beforeAll(async () => {
  s = await createScheduler();
});

function plan(over: Partial<SessionInput> & { derived?: Derived; callouts?: Callout[] } = {}) {
  return buildSession({
    callouts: makeCallouts(),
    derived: createDerived(),
    scheduler: s,
    settings: dev,
    zoneOrder,
    answersToday: 0,
    now: new Date(T0),
    rng: mulberry32(1),
    ...over,
  });
}
const quizzes = (p: ReturnType<typeof plan>) => p.cards.filter((c): c is QuizCard => c.type === 'quiz');
const introIds = (p: ReturnType<typeof plan>) => p.cards.filter((c) => c.type === 'intro').map((c) => c.calloutId);

/** A learner who met `ids`, answering name-mc, read-map and which-view well at T0. */
function learner(ids: readonly string[], modes: readonly ('name-mc' | 'read-map' | 'which-view')[] = ['name-mc', 'read-map', 'which-view']): Derived {
  const d = createDerived();
  for (const id of ids) {
    applyEvent(d, intro(id, T0), s);
    for (const m of modes) applyEvent(d, answer(id, m, T0 + 1000, Grade.Good), s);
  }
  return d;
}

describe('playableCallouts', () => {
  const list = makeCallouts();
  it('hides drafts unless development mode is on, and never offers stale ones', () => {
    expect(playableCallouts(list, { hardMode: false, includeDraft: false })).toHaveLength(0);
    const verified = list.map((c) => ({ ...c, status: 'verified' as const }));
    expect(playableCallouts(verified, { hardMode: false, includeDraft: false })).toHaveLength(8);
    verified[0]!.status = 'stale' as never;
    expect(playableCallouts(verified, { hardMode: false, includeDraft: false })).toHaveLength(7);
  });
  it('adds Hard spots only in Hard mode, and only when the parent is playable', () => {
    expect(playableCallouts(list, { hardMode: false, includeDraft: true }).map((c) => c.id)).not.toContain('test.bench');
    expect(playableCallouts(list, { hardMode: true, includeDraft: true }).map((c) => c.id)).toContain('test.bench');
    const orphan = list.filter((c) => c.id !== 'test.a-site');
    expect(playableCallouts(orphan, { hardMode: true, includeDraft: true }).map((c) => c.id)).not.toContain('test.bench');
  });
});

describe('a first session (SCOPE §4.3, §4.11)', () => {
  let p: ReturnType<typeof plan>;
  beforeAll(() => {
    p = plan();
  });
  it('introduces four Core callouts, then quizzes on them', () => {
    expect(introIds(p)).toHaveLength(4);
    expect(p.cards.slice(0, 4).every((c) => c.type === 'intro')).toBe(true);
    expect(p.cards.slice(4).every((c) => c.type === 'quiz')).toBe(true);
    expect(quizzes(p).map((q) => q.calloutId).sort()).toEqual(introIds(p).sort());
  });
  it('starts at the first zone along the route, Core only', () => {
    expect(introIds(p)[0]).toBe('test.t-spawn');
    expect(introIds(p).every((id) => makeCallouts().find((c) => c.id === id)!.tier === 1)).toBe(true);
  });
  it('asks Name it as multiple choice with three options', () => {
    expect(quizzes(p).every((q) => q.mode === 'name-mc' && q.reason === 'intro-quiz' && q.options === 3)).toBe(true);
  });
  it('uses four options when the gentle start is off', () => {
    const q = quizzes(plan({ settings: { ...dev, gentleStart: false } }));
    expect(q.every((x) => x.options === 4)).toBe(true);
  });
  it('is not throttled and has no reviews', () => {
    expect(p.throttled).toBe(false);
    expect(p.dueCount).toBe(0);
    expect(p.note).toBeNull();
  });
  it('keeps one zone together before moving on', () => {
    const p2 = plan({ zoneOrder: ['a', 'spawn', 'mid', 'b'] });
    expect(introIds(p2).slice(0, 2)).toEqual(['test.a-ramp', 'test.a-site']);
  });
  it('is repeatable for a seed', () => {
    expect(plan({ rng: mulberry32(5) })).toEqual(plan({ rng: mulberry32(5) }));
  });
});

describe('limits on new material', () => {
  it('caps new items at 30 % of the session, at least one', () => {
    expect(introIds(plan({ settings: { ...dev, maxCards: 20 } }))).toHaveLength(4); // 6 allowed, 4 per session
    expect(introIds(plan({ settings: { ...dev, maxCards: 10 } }))).toHaveLength(3);
    expect(introIds(plan({ settings: { ...dev, maxCards: 5 } }))).toHaveLength(1);
    expect(introIds(plan({ settings: { ...dev, maxCards: 1 } }))).toHaveLength(1);
  });
  it('teaches Core before Standard, and Standard before Hard', () => {
    const core = ['test.t-spawn', 'test.mid', 'test.a-ramp', 'test.a-site', 'test.b-site'];
    const afterCore = plan({ derived: learner(core) , now: new Date(T0 + 4 * DAY_MS) });
    expect(introIds(afterCore).every((id) => ['test.palace', 'test.connector', 'test.b-apps'].includes(id))).toBe(true);
    expect(introIds(afterCore).length).toBeGreaterThan(0);
    const std = [...core, 'test.palace', 'test.connector', 'test.b-apps'];
    const hardOff = plan({ derived: learner(std), now: new Date(T0 + 4 * DAY_MS) });
    expect(introIds(hardOff)).toEqual([]);
    const hardOn = plan({ derived: learner(std), now: new Date(T0 + 4 * DAY_MS), settings: { ...dev, hardMode: true } });
    expect(introIds(hardOn)).toEqual(['test.bench']);
  });
  it('waits for the parent before teaching a Hard spot', () => {
    const d = learner(['test.t-spawn']);
    const p = plan({ derived: d, settings: { ...dev, hardMode: true } });
    expect(introIds(p)).not.toContain('test.bench');
  });
});

describe('reviews and new modes', () => {
  const four = ['test.t-spawn', 'test.mid', 'test.a-ramp', 'test.a-site'];
  let p: ReturnType<typeof plan>;
  beforeAll(() => {
    p = plan({ derived: learner(four), now: new Date(T0 + 4 * DAY_MS) });
  });

  it('puts all four due callouts back into the session, as reviews', () => {
    expect(p.dueCount).toBe(12);
    expect(quizzes(p).filter((q) => q.reason === 'due')).toHaveLength(12);
  });
  it('keeps new items to 30 % of the quiz cards', () => {
    const q = quizzes(p);
    const fresh = q.filter((x) => x.reason !== 'due');
    expect(fresh.length).toBeLessThanOrEqual(Math.floor(0.3 * 20));
    expect(q.length).toBeLessThanOrEqual(20);
  });
  it('opens Locate once Recognise is stable, as a new-mode card', () => {
    const pin = quizzes(p).filter((x) => x.mode === 'pin');
    expect(pin.every((x) => x.reason === 'new-mode' && x.options === null)).toBe(true);
  });
  it('asks the other Recognise modes of a callout met last time as new items', () => {
    const d = learner(four, ['name-mc']);
    const next = plan({ derived: d, now: new Date(T0 + 1000) });
    expect(quizzes(next).some((x) => x.reason === 'new-mode' && x.mode === 'read-map')).toBe(true);
  });
  it('asks due items from the most forgotten up', () => {
    const d = createDerived();
    applyEvent(d, answer('test.mid', 'name-mc', T0, Grade.Good), s);
    applyEvent(d, answer('test.a-ramp', 'name-mc', T0 + 5 * DAY_MS, Grade.Good), s);
    const later = plan({ derived: d, now: new Date(T0 + 12 * DAY_MS), settings: { ...dev, enabledModes: ['name-mc'], maxCards: 4 } });
    const due = quizzes(later).filter((x) => x.reason === 'due').map((x) => x.calloutId);
    expect(due.slice(0, 2)).toEqual(['test.mid', 'test.a-ramp']);
  });
  it('does not ask an item before it is due', () => {
    const d = learner(four);
    const early = plan({ derived: d, now: new Date(T0 + 2 * DAY_MS) });
    expect(quizzes(early).some((x) => x.reason === 'due')).toBe(false);
  });
});

describe('the throttle (SCOPE §4.4)', () => {
  const many = Array.from({ length: 25 }, (_, i) => ({ ...makeCallouts()[1]!, id: `test.x${i}`, name: `X${i}`, aliases: [] as string[] }));
  let d: Derived;
  beforeAll(() => {
    d = learner(many.map((c) => c.id));
  });
  const later = new Date(T0 + 4 * DAY_MS);

  it('stops all new callouts and modes while more than 60 reviews are due', () => {
    const p = plan({ callouts: many, derived: d, now: later });
    expect(p.dueCount).toBe(75);
    expect(p.throttled).toBe(true);
    expect(introIds(p)).toEqual([]);
    expect(quizzes(p).every((q) => q.reason === 'due')).toBe(true);
    expect(quizzes(p)).toHaveLength(20);
  });
  it('lets new material back in at 60 or fewer', () => {
    const p = plan({ callouts: [...many.slice(0, 20), ...makeCallouts()], derived: learner(many.slice(0, 20).map((c) => c.id)), now: later });
    expect(p.dueCount).toBe(60);
    expect(p.throttled).toBe(false);
    expect(introIds(p).length).toBeGreaterThan(0);
  });
  it('counts due items across maps even when the session is for one map', () => {
    const other = many.map((c) => ({ ...c, map: 'de_other' }));
    const p = plan({ callouts: [...makeCallouts(), ...other], derived: d, now: later, map: 'de_test' });
    expect(p.throttled).toBe(true);
    expect(introIds(p)).toEqual([]);
  });
});

describe('daily cap and empty sessions', () => {
  it('stops at 120 answers a day', () => {
    const p = plan({ answersToday: 120 });
    expect(p.cards).toEqual([]);
    expect(p.note).toBe('daily-cap');
  });
  it('shrinks the session to what is left of the cap', () => {
    const p = plan({ answersToday: 117 });
    expect(quizzes(p).length).toBeLessThanOrEqual(3);
  });
  it('says nothing is due when there is nothing to ask', () => {
    const only = [makeCallouts()[0]!];
    const d = learner(['test.t-spawn'], ['name-mc']);
    const p = plan({ callouts: only, derived: d, settings: { ...dev, enabledModes: ['name-mc'] }, now: new Date(T0 + 1000) });
    expect(p.cards).toEqual([]);
    expect(p.note).toBe('nothing-due');
  });
  it('offers nothing when no callout is playable', () => {
    const p = plan({ settings: { ...dev, includeDraft: false } });
    expect(p.cards).toEqual([]);
  });
});

describe('scope', () => {
  it('restricts teaching to one zone', () => {
    const p = plan({ zone: 'b' });
    expect(introIds(p)).toEqual(['test.b-site']);
  });
  it('restricts teaching to one map', () => {
    const other = makeCallouts().map((c) => ({ ...c, id: c.id.replace('test.', 'zzz.'), map: 'de_zzz' }));
    const p = plan({ callouts: [...makeCallouts(), ...other], map: 'de_zzz' });
    expect(introIds(p).every((id) => id.startsWith('zzz.'))).toBe(true);
  });
});

describe('spaceOut', () => {
  it('keeps cards of one callout at least three places apart where it can', () => {
    const cards = ['a', 'a', 'b', 'c', 'd', 'e', 'f'].map((calloutId) => ({ calloutId }));
    const out = spaceOut(cards).map((c) => c.calloutId);
    expect(out.slice().sort()).toEqual(['a', 'a', 'b', 'c', 'd', 'e', 'f']);
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j <= i + 3 && j < out.length; j++) expect(out[j]).not.toBe(out[i]);
  });
  it('keeps priority order when nothing needs moving, and never drops a card', () => {
    const cards = ['a', 'b', 'c', 'd'].map((calloutId) => ({ calloutId }));
    expect(spaceOut(cards)).toEqual(cards);
    const same = ['a', 'a', 'a'].map((calloutId) => ({ calloutId }));
    expect(spaceOut(same)).toHaveLength(3);
  });
});

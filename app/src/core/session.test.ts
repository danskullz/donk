import { beforeAll, describe, expect, it } from 'vitest';
import { applyEvent, createDerived, type Derived } from './log';
import { mulberry32 } from './rng';
import { createScheduler, type Scheduler } from './scheduler';
import type { Callout } from './schema';
import { pairKey } from './contrast';
import { buildSession, DEFAULT_SESSION_SETTINGS, playableCallouts, sessionSettingsFrom, spaceOut, UNLIMITED_CARDS, type QuizCard, type SessionInput, type SessionSettings } from './session';
import { makeCallouts, makeMap } from './test-fixtures';
import { answer, drive, intro } from './test-helpers';
import { DAY_MS, Grade, MODES, PHASE1_MODES } from './types';

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

describe('settings', () => {
  const prefs = { sessionCards: 20, sessionMinutes: null, newPerSession: 4, gentleStart: true };
  const map = { hardMode: false, includeDraft: true };

  it('turns the preferences into session settings', () => {
    expect(sessionSettingsFrom(prefs, map)).toEqual({ ...DEFAULT_SESSION_SETTINGS, includeDraft: true });
    const custom = sessionSettingsFrom({ sessionCards: 35, sessionMinutes: 10, newPerSession: 2, gentleStart: false }, { hardMode: true, includeDraft: false });
    expect(custom).toMatchObject({ maxCards: 35, maxMinutes: 10, newPerSession: 2, gentleStart: false, hardMode: true, includeDraft: false });
  });
  it('"until I stop" is a card limit too large to bind: the daily cap and the learner end it', () => {
    const open = sessionSettingsFrom({ ...prefs, sessionCards: null }, map);
    expect(open.maxCards).toBe(UNLIMITED_CARDS);
    expect(open.maxCards).toBeGreaterThan(open.dailyReviewCap);
    const many = Array.from({ length: 150 }, (_, i) => ({ ...makeCallouts()[1]!, id: `test.x${i}`, name: `X${i}`, aliases: [] as string[] }));
    const d = learner(many.map((c) => c.id), ['name-mc']);
    const settings = { ...open, enabledModes: ['name-mc'] as const, dueThrottle: 500 };
    const later = new Date(T0 + 5 * DAY_MS);
    expect(quizzes(plan({ callouts: many, derived: d, settings, now: later }))).toHaveLength(open.dailyReviewCap); // 150 due, 120 allowed today
    expect(quizzes(plan({ callouts: many, derived: d, settings, answersToday: 100, now: later }))).toHaveLength(20);
  });
  it('a card limit from Settings is the number of quiz cards asked', () => {
    const four = ['test.t-spawn', 'test.mid', 'test.a-ramp', 'test.a-site'];
    const p = plan({ derived: learner(four), now: new Date(T0 + 4 * DAY_MS), settings: sessionSettingsFrom({ ...prefs, sessionCards: 7 }, map) });
    expect(quizzes(p)).toHaveLength(7);
  });
  it('the new-per-session setting caps the intros, and gentleStart picks three options or four', () => {
    const two = plan({ settings: sessionSettingsFrom({ ...prefs, newPerSession: 2 }, map) });
    expect(introIds(two)).toHaveLength(2);
    expect(quizzes(two).every((q) => q.options === 3)).toBe(true);
    const harder = plan({ settings: sessionSettingsFrom({ ...prefs, gentleStart: false }, map) });
    expect(quizzes(harder).every((q) => q.options === 4)).toBe(true);
  });
  it('asks for every mode by default, Speed call included', () => {
    expect(DEFAULT_SESSION_SETTINGS.enabledModes).toEqual(MODES);
    expect(DEFAULT_SESSION_SETTINGS.enabledModes).toContain('speed');
  });
});

describe('Speed call in the plan', () => {
  const mid = 'test.mid';
  /** Everything stable up to Where am I?, so stage 5 is open for test.mid. */
  function placed(): Derived {
    const d = createDerived();
    applyEvent(d, intro(mid, T0), s);
    for (const m of ['name-mc', 'read-map', 'which-view'] as const) applyEvent(d, answer(mid, m, T0, Grade.Good), s);
    drive(d, s, mid, 'pin', T0, [Grade.Good, Grade.Good]);
    drive(d, s, mid, 'name-typed', T0, [Grade.Good, Grade.Good]);
    drive(d, s, mid, 'where-am-i', T0, [Grade.Good, Grade.Good, Grade.Good, Grade.Good]);
    return d;
  }
  const midOnly = [makeCallouts()[1]!];

  it('arrives as a new item with four options, once Where am I? is stable', () => {
    const p = plan({ callouts: midOnly, derived: placed(), now: new Date(T0 + 70 * DAY_MS) });
    const speed = quizzes(p).filter((q) => q.mode === 'speed');
    expect(speed).toEqual([expect.objectContaining({ calloutId: mid, reason: 'new-mode', options: 4 })]);
  });
  it('is four options even with the gentle start, and on later reviews', () => {
    const d = placed();
    applyEvent(d, answer(mid, 'speed', T0 + 70 * DAY_MS, Grade.Good), s);
    const p = plan({ callouts: midOnly, derived: d, now: new Date(T0 + 400 * DAY_MS), settings: { ...dev, gentleStart: true } });
    expect(quizzes(p).find((q) => q.mode === 'speed')).toMatchObject({ reason: 'due', options: 4 });
  });
  it('is not asked before it is unlocked, or when switched off', () => {
    const early = learner([mid]);
    expect(quizzes(plan({ callouts: midOnly, derived: early, now: new Date(T0 + 400 * DAY_MS) })).some((q) => q.mode === 'speed')).toBe(false);
    const off = plan({ callouts: midOnly, derived: placed(), now: new Date(T0 + 70 * DAY_MS), settings: { ...dev, enabledModes: PHASE1_MODES } });
    expect(quizzes(off).some((q) => q.mode === 'speed')).toBe(false);
  });
});

describe('contrast cards in the plan (SCOPE §4.6)', () => {
  /** Palace taken for A Site three times, and the callouts all answered a few days ago. */
  function mixedUp(times = 3): Derived {
    const d = learner(['test.t-spawn', 'test.mid', 'test.a-ramp', 'test.a-site', 'test.palace']);
    for (let i = 0; i < times; i++) applyEvent(d, answer('test.palace', 'name-mc', T0 + 2000 + i, Grade.Again, 1800, 'test.a-site'), s);
    return d;
  }
  const later = new Date(T0 + 4 * DAY_MS);
  const contrastOf = (p: ReturnType<typeof plan>) => p.cards.find((c) => c.type === 'contrast');

  it('puts one contrast card first, then a Which view? question for the pair', () => {
    const p = plan({ derived: mixedUp(), now: later });
    expect(p.cards[0]).toEqual({ type: 'contrast', calloutId: 'test.palace', otherId: 'test.a-site', confusions: 3 });
    expect(p.cards[1]).toMatchObject({ type: 'quiz', calloutId: 'test.palace', mode: 'which-view', reason: 'contrast', options: 4, partner: 'test.a-site' });
    expect(p.cards.filter((c) => c.type === 'contrast')).toHaveLength(1);
  });
  it('asks that Which view? item once: it replaces the review that would have been due anyway', () => {
    const p = plan({ derived: mixedUp(), now: later });
    expect(quizzes(p).filter((q) => q.key === 'test.palace:which-view')).toHaveLength(1);
  });
  it('keeps the session to its card limit', () => {
    for (const maxCards of [5, 8, 20]) {
      const p = plan({ derived: mixedUp(), now: later, settings: { ...dev, maxCards } });
      expect(quizzes(p).length).toBeLessThanOrEqual(maxCards);
    }
  });
  it('goes in front of the intros', () => {
    const p = plan({ derived: mixedUp(), now: later });
    const kinds = p.cards.map((c) => c.type);
    expect(kinds.indexOf('contrast')).toBe(0);
    expect(kinds.indexOf('intro')).toBeGreaterThan(1);
  });
  it('needs two mix-ups', () => {
    expect(contrastOf(plan({ derived: mixedUp(1), now: later }))).toBeUndefined();
    expect(contrastOf(plan({ derived: mixedUp(2), now: later }))).toBeDefined();
  });
  it('is not repeated within a week, and comes back only after a new mix-up', () => {
    const key = pairKey('test.palace', 'test.a-site');
    const shown = (daysAgo: number, count: number) => new Map([[key, { at: later.getTime() - daysAgo * DAY_MS, count }]]);
    expect(contrastOf(plan({ derived: mixedUp(), now: later, contrastSeen: shown(2, 2) }))).toBeUndefined();
    expect(contrastOf(plan({ derived: mixedUp(), now: later, contrastSeen: shown(8, 3) }))).toBeUndefined();
    expect(contrastOf(plan({ derived: mixedUp(), now: later, contrastSeen: shown(8, 2) }))).toBeDefined();
  });
  it('is left out when Which view? is switched off, or the session has room for one card only', () => {
    expect(contrastOf(plan({ derived: mixedUp(), now: later, settings: { ...dev, enabledModes: ['name-mc', 'read-map'] } }))).toBeUndefined();
    expect(contrastOf(plan({ derived: mixedUp(), now: later, settings: { ...dev, maxCards: 1 } }))).toBeUndefined();
  });
  it('is not held back by the new-material throttle: it teaches from an error, it adds no new callout', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ ...makeCallouts()[1]!, id: `test.x${i}`, name: `X${i}`, aliases: [] as string[] }));
    const d = learner(many.map((c) => c.id));
    for (let i = 0; i < 2; i++) applyEvent(d, answer('test.x1', 'name-mc', T0 + 2000 + i, Grade.Again, 1800, 'test.x2'), s);
    const p = plan({ callouts: many, derived: d, now: later });
    expect(p.throttled).toBe(true);
    expect(contrastOf(p)).toBeDefined();
    expect(introIds(p)).toEqual([]);
  });
  it('stays within the scope of the session: both callouts must be in the zone being practised', () => {
    expect(contrastOf(plan({ derived: mixedUp(), now: later, zone: 'a' }))).toBeDefined();
    expect(contrastOf(plan({ derived: mixedUp(), now: later, zone: 'b' }))).toBeUndefined();
  });
});

describe('early practice', () => {
  const four = ['test.t-spawn', 'test.mid', 'test.a-ramp', 'test.a-site'];
  /** Every standard callout met and answered at T0, a day before the session: nothing is due and nothing new is left to teach. */
  const rested = () => {
    const d = learner(four);
    for (const id of ['test.palace', 'test.connector', 'test.b-site', 'test.b-apps']) {
      applyEvent(d, intro(id, T0), s);
      for (const m of ['name-mc', 'read-map', 'which-view'] as const) applyEvent(d, answer(id, m, T0 + 1000, Grade.Good), s);
    }
    // Locate is open for all of them and has been asked once; Recall needs 5 days of stability, so it is still shut
    for (const id of [...four, 'test.palace', 'test.connector', 'test.b-site', 'test.b-apps']) applyEvent(d, answer(id, 'pin', T0 + 2000, Grade.Good), s);
    return d;
  };
  const day = new Date(T0 + DAY_MS);

  it('the ordinary session is empty then, which is when "Practise anyway" is offered', () => {
    const p = plan({ derived: rested(), now: day });
    expect(p.cards).toEqual([]);
    expect(p.note).toBe('nothing-due');
  });
  it('practises the items closest to being due, up to the card limit, flagged as early', () => {
    const p = plan({ derived: rested(), now: day, earlyPractice: true, settings: { ...dev, maxCards: 10 } });
    expect(p.earlyPractice).toBe(true);
    expect(p.note).toBeNull();
    expect(quizzes(p)).toHaveLength(10);
    expect(p.cards.every((c) => c.type === 'quiz' && c.reason === 'early')).toBe(true);
    expect(p.introduced).toEqual([]);
  });
  it('takes the least remembered first', () => {
    const d = createDerived();
    applyEvent(d, answer('test.mid', 'name-mc', T0, Grade.Good), s); // answered long ago: the least remembered
    applyEvent(d, answer('test.a-ramp', 'name-mc', T0 + 1.5 * DAY_MS, Grade.Good), s);
    applyEvent(d, answer('test.a-site', 'name-mc', T0 + 2.5 * DAY_MS, Grade.Good), s);
    const p = plan({ derived: d, now: new Date(T0 + 2.6 * DAY_MS), earlyPractice: true, settings: { ...dev, enabledModes: ['name-mc'] } });
    expect(quizzes(p).map((q) => q.calloutId)).toEqual(['test.mid', 'test.a-ramp', 'test.a-site']);
  });
  it('adds nothing new: no intros, no newly unlocked modes, no contrast card', () => {
    const d = rested();
    for (let i = 0; i < 3; i++) applyEvent(d, answer('test.palace', 'name-mc', T0 + 2000 + i, Grade.Again, 1800, 'test.a-site'), s);
    const p = plan({ derived: d, now: day, earlyPractice: true });
    expect(p.cards.every((c) => c.type === 'quiz')).toBe(true);
    expect(quizzes(p).every((q) => d.items.has(q.key))).toBe(true);
  });
  it('asks multiple choice with four options', () => {
    const p = plan({ derived: rested(), now: day, earlyPractice: true });
    expect(quizzes(p).every((q) => q.options === 4)).toBe(true);
  });
  it('is empty for a learner with nothing started, and respects the daily cap', () => {
    const none = plan({ earlyPractice: true });
    expect(none.cards).toEqual([]);
    expect(none.note).toBe('nothing-due');
    expect(plan({ derived: rested(), now: day, earlyPractice: true, answersToday: 120 })).toMatchObject({ cards: [], note: 'daily-cap' });
    expect(quizzes(plan({ derived: rested(), now: day, earlyPractice: true, answersToday: 115 }))).toHaveLength(5);
  });
  it('keeps cards of one callout apart where it can', () => {
    const p = plan({ derived: rested(), now: day, earlyPractice: true });
    const ids = quizzes(p).map((q) => q.calloutId).slice(0, 10);
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j <= i + 3 && j < ids.length; j++) expect(ids[j]).not.toBe(ids[i]);
  });
});

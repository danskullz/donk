// startSession is where the learner's settings, the review log, the plan and the runner meet. These tests run it for
// real (in Node, against the synthetic map) with only the browser's storage replaced: the review store is an in-memory
// one holding whatever log a test wants, and localStorage is a small fake.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { pairKey } from '../core/contrast';
import type { ReviewEvent } from '../core/log';
import { gradeTyped } from '../core/match';
import { entriesFor } from '../core/quiz';
import type { SessionCard } from '../core/session';
import { createMemoryStore, type ReviewStore } from '../core/store';
import { createScheduler, type Scheduler } from '../core/scheduler';
import { answer, intro } from '../core/test-helpers';
import { DAY_MS, Grade } from '../core/types';
import { clearLastSession, getLastSession } from './last-session';
import { resetSettings, updateSettings, useSettingsStorage } from './settings';
import { lastSessionFor, reportSession, startSession } from './start-session';

const held = vi.hoisted(() => ({ store: null as ReviewStore | null }));
vi.mock('../storage/idb-store', () => ({
  openReviewStore: async () => {
    if (!held.store) throw new Error('no store');
    return held.store;
  },
}));

// The synthetic map's Mid has a second name in the game, so the naming setting has something to choose between.
vi.mock('./data', async (importOriginal) => {
  const real = await importOriginal<typeof import('./data')>();
  return {
    ...real,
    loadAvailableMaps: async () =>
      (await real.loadAvailableMaps()).map((m) => (m.demo ? { ...m, callouts: m.callouts.map((c) => (c.id === 'test.mid' ? { ...c, gameplaceName: 'Middle Doors' } : c)) } : m)),
  };
});

let scheduler: Scheduler;
beforeAll(async () => {
  scheduler = await createScheduler();
});

const NOW = Date.parse('2026-03-10T12:00:00Z');
const STANDARD = ['t-spawn', 'mid', 'a-ramp', 'a-site', 'palace', 'connector', 'b-site', 'b-apps'].map((s) => `test.${s}`);

/** Everything standard met and answered in the three recognition modes and Pin it, `daysAgo` days ago. */
function learner(daysAgo: number): ReviewEvent[] {
  const ts = NOW - daysAgo * DAY_MS;
  return STANDARD.flatMap((id) => [intro(id, ts), ...(['name-mc', 'read-map', 'which-view', 'pin'] as const).map((m) => answer(id, m, ts + 1000, Grade.Good))]);
}

const fakeStorage = () => {
  const data = new Map<string, string>();
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
};

let local: ReturnType<typeof fakeStorage>;
beforeEach(() => {
  held.store = createMemoryStore();
  local = fakeStorage();
  useSettingsStorage(fakeStorage());
  resetSettings();
  vi.stubGlobal('localStorage', local);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  clearLastSession();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const start = (options: Parameters<typeof startSession>[1] = {}) => startSession('de_test', { seed: 1, ...options }).then((s) => s ?? Promise.reject(new Error('no session')));
const types = (cards: readonly SessionCard[]) => cards.map((c) => c.type);
const quizzes = (cards: readonly SessionCard[]) => cards.filter((c) => c.type === 'quiz');

describe('which map', () => {
  it('is null for a map the app does not have', async () => {
    expect(await startSession('de_nowhere')).toBeNull();
  });

  it('starts a map with no callouts yet with an empty plan, and offers nothing to practise', async () => {
    const s = await startSession('de_mirage');
    expect(s?.plan).toMatchObject({ cards: [], note: 'nothing-due' });
    expect(s?.playable).toEqual([]);
    expect(s?.canPracticeEarly).toBe(false);
  });
});

describe('the session settings', () => {
  it('start from the defaults: 20 cards, four new callouts, three options on a first multiple choice, no time limit', async () => {
    const s = await start();
    expect(s.settings).toMatchObject({ maxCards: 20, maxMinutes: null, newPerSession: 4, gentleStart: true, hardMode: false });
    expect(types(s.plan.cards).filter((t) => t === 'intro')).toHaveLength(4);
    expect(quizzes(s.plan.cards).every((c) => c.type === 'quiz' && c.options === 3)).toBe(true);
  });

  it('follow Settings: new per session, the gentle start, the time limit', async () => {
    updateSettings({ newPerSession: 2, gentleStart: false, sessionMinutes: 10, sessionCards: null });
    const s = await start();
    expect(s.settings).toMatchObject({ maxMinutes: 10, newPerSession: 2, gentleStart: false });
    expect(types(s.plan.cards).filter((t) => t === 'intro')).toHaveLength(2);
    expect(quizzes(s.plan.cards).every((c) => c.type === 'quiz' && c.options === 4)).toBe(true);
  });

  it('use the card limit from Settings, and "until I stop" asks for everything that is due', async () => {
    held.store = createMemoryStore(learner(30));
    updateSettings({ sessionCards: 5 });
    expect(quizzes((await start()).plan.cards)).toHaveLength(5);
    updateSettings({ sessionCards: null });
    // 8 callouts x 4 items are due; the daily cap (120) is far away
    expect(quizzes((await start()).plan.cards).length).toBeGreaterThan(20);
  });

  it('count answers already given today against the daily cap', async () => {
    const today = Array.from({ length: 118 }, (_, i) => answer('test.mid', 'name-mc', NOW - 60_000 - i, Grade.Good));
    held.store = createMemoryStore([...learner(30), ...today]);
    expect(quizzes((await start()).plan.cards)).toHaveLength(2);
  });

  it('give Hard mode per map, falling back to the default', async () => {
    expect((await start()).playable.map((c) => c.id)).not.toContain('test.bench');
    updateSettings({ hardMode: { de_test: true } });
    const on = await start();
    expect(on.settings.hardMode).toBe(true);
    expect(on.playable.map((c) => c.id)).toContain('test.bench');
    updateSettings({ hardModeDefault: true, hardMode: { de_test: false } });
    expect((await start()).settings.hardMode).toBe(false);
    updateSettings({ hardMode: {} });
    expect((await start()).settings.hardMode).toBe(true);
  });
});

describe('the time limit, from Settings to the end of the session', () => {
  it('ends the session after the card on screen once the minutes are up', async () => {
    held.store = createMemoryStore(learner(30));
    updateSettings({ sessionMinutes: 5, sessionCards: null });
    const s = await start();
    const first = s.runner.view;
    expect(first.phase).toBe('question');
    if (first.phase !== 'question') return;
    const view = s.runner.answer({ kind: 'skip' });
    expect(view.phase).toBe('reveal');
    vi.setSystemTime(NOW + 6 * 60_000);
    const ended = s.runner.continue();
    expect(ended).toMatchObject({ phase: 'done', summary: { finished: true, endedBy: 'time', answered: 1 } });
  });

  it('does not end a session that is still inside its time', async () => {
    held.store = createMemoryStore(learner(30));
    updateSettings({ sessionMinutes: 5, sessionCards: null });
    const s = await start();
    s.runner.answer({ kind: 'skip' });
    vi.setSystemTime(NOW + 4 * 60_000);
    expect(s.runner.continue().phase).toBe('question');
  });
});

describe('names, as the naming setting shows them', () => {
  const mid = async () => (await start()).playable.find((c) => c.id === 'test.mid');

  it('both: the community name, with the game name beside it, and either is accepted', async () => {
    const s = await start();
    const m = s.playable.find((c) => c.id === 'test.mid');
    expect(m).toMatchObject({ name: 'Mid', gameplaceName: 'Middle Doors' });
    const entries = entriesFor(s.playable);
    expect(gradeTyped('Middle Doors', m!, entries).correct).toBe(true);
    expect(gradeTyped('Mid', m!, entries).correct).toBe(true);
  });

  it('game names only: the game name is shown and the community name no longer counts', async () => {
    updateSettings({ naming: 'game' });
    const s = await start();
    const m = (await mid())!;
    expect(m).toMatchObject({ name: 'Middle Doors', gameplaceName: null });
    const entries = entriesFor(s.playable);
    expect(gradeTyped('Middle Doors', m, entries).correct).toBe(true);
    expect(gradeTyped('Mid', m, entries).correct).toBe(false);
  });

  it('community names only: the game name is neither shown nor accepted', async () => {
    updateSettings({ naming: 'community' });
    const s = await start();
    const m = s.playable.find((c) => c.id === 'test.mid')!;
    expect(m).toMatchObject({ name: 'Mid', gameplaceName: null });
    expect(gradeTyped('Middle Doors', m, entriesFor(s.playable)).correct).toBe(false);
  });

  it('changes nothing that is logged: answers name the callout by id', async () => {
    updateSettings({ naming: 'game' });
    const store = createMemoryStore();
    held.store = store;
    const s = await start();
    expect(s.runner.view.phase).toBe('intro');
    s.runner.continue();
    await s.saver.flush();
    expect(store.events).toHaveLength(1);
    expect(store.events[0]).toMatchObject({ kind: 'intro', callout: expect.stringMatching(/^test\./) });
    expect(JSON.stringify(store.events)).not.toContain('Middle Doors');
  });
});

describe('contrast cards', () => {
  const mixedUp = (): ReviewEvent[] => [
    ...learner(30),
    answer('test.a-ramp', 'name-mc', NOW - 20 * DAY_MS, Grade.Again, 3000, 'test.mid'),
    answer('test.a-ramp', 'name-mc', NOW - 19 * DAY_MS, Grade.Again, 3000, 'test.mid'),
  ];

  it('open a session for a pair mixed up twice, with the question for it right after', async () => {
    held.store = createMemoryStore(mixedUp());
    const s = await start();
    expect(s.plan.cards[0]).toMatchObject({ type: 'contrast', calloutId: 'test.a-ramp', otherId: 'test.mid', confusions: 2 });
    expect(s.plan.cards[1]).toMatchObject({ type: 'quiz', mode: 'which-view', reason: 'contrast', partner: 'test.mid' });
  });

  it('are remembered once the learner has read one, so the pair is not shown again within a week', async () => {
    held.store = createMemoryStore(mixedUp());
    const first = await start();
    expect(first.runner.view.phase).toBe('contrast');
    first.runner.continue();
    expect(JSON.parse(local.data.get('callouts.contrast-seen.demo') ?? '{}')).toEqual({ [pairKey('test.a-ramp', 'test.mid')]: { at: NOW, count: 2 } });

    const second = await start();
    expect(types(second.plan.cards)).not.toContain('contrast');

    vi.setSystemTime(NOW + 8 * DAY_MS);
    // a week on, the pair is back only if it was mixed up again since: it was not
    expect(types((await start()).plan.cards)).not.toContain('contrast');
  });

  it('come back after a week when the pair has been mixed up again', async () => {
    held.store = createMemoryStore(mixedUp());
    (await start()).runner.continue();
    held.store = createMemoryStore([...mixedUp(), answer('test.mid', 'name-mc', NOW + DAY_MS, Grade.Again, 3000, 'test.a-ramp')]);
    vi.setSystemTime(NOW + 8 * DAY_MS);
    expect((await start()).plan.cards[0]).toMatchObject({ type: 'contrast', confusions: 3 });
  });

  it('are not remembered when the learner leaves on the card', async () => {
    held.store = createMemoryStore(mixedUp());
    const s = await start();
    s.runner.leave();
    expect(local.data.has('callouts.contrast-seen.demo')).toBe(false);
    expect((await start()).plan.cards[0]?.type).toBe('contrast');
  });

  it('are kept apart for the synthetic map and the real ones', async () => {
    held.store = createMemoryStore(mixedUp());
    (await start()).runner.continue();
    expect([...local.data.keys()]).toEqual(['callouts.contrast-seen.demo']);
  });

  it('survive blocked storage: the card may show again, nothing breaks', async () => {
    held.store = createMemoryStore(mixedUp());
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    const s = await start();
    expect(s.runner.view.phase).toBe('contrast');
    expect(() => s.runner.continue()).not.toThrow();
  });
});

describe('early practice', () => {
  it('is offered when nothing is due and there is something started to practise', async () => {
    held.store = createMemoryStore(learner(1));
    const s = await start();
    expect(s.plan).toMatchObject({ cards: [], note: 'nothing-due' });
    expect(s.canPracticeEarly).toBe(true);
    expect(s.runner.view).toMatchObject({ phase: 'done', summary: { answered: 0, earlyPractice: false } });
  });

  it('is not offered to a learner with nothing started, or when something is due', async () => {
    expect((await start()).canPracticeEarly).toBe(false);
    held.store = createMemoryStore(learner(30));
    expect((await start()).canPracticeEarly).toBe(false);
  });

  it('asks the items closest to being due, nothing new, and says so in the summary', async () => {
    held.store = createMemoryStore(learner(1));
    const s = await start({ earlyPractice: true });
    expect(s.plan.earlyPractice).toBe(true);
    expect(s.canPracticeEarly).toBe(false);
    expect(s.plan.cards).toHaveLength(20);
    expect(s.plan.cards.every((c) => c.type === 'quiz' && c.reason === 'early')).toBe(true);
    const ended = s.runner.leave();
    expect(ended).toMatchObject({ phase: 'done', summary: { earlyPractice: true, endedBy: 'left' } });
  });

  it('respects the zone it was asked for', async () => {
    held.store = createMemoryStore(learner(1));
    const s = await start({ earlyPractice: true, zone: 'a' });
    const ids = new Set(s.plan.cards.map((c) => c.calloutId));
    expect([...ids].sort()).toEqual(['test.a-ramp', 'test.a-site', 'test.palace']);
  });
});

describe('the hand-off to the Summary screen', () => {
  it('names every callout the summary mentions the way the learner sees them, and says why a session was short', async () => {
    updateSettings({ naming: 'game' });
    const s = await start();
    s.runner.continue(); // moves past one intro
    const ended = s.runner.leave();
    if (ended.phase !== 'done') throw new Error('not done');
    const last = lastSessionFor(s, ended.summary, 1234);
    expect(last).toMatchObject({ mapId: 'de_test', at: 1234, note: null, playable: 8, summary: { finished: false, endedBy: 'left' } });
    expect(Object.keys(last.names)).toEqual(ended.summary.introduced);
    expect(Object.values(last.names).every((n) => n.length > 0)).toBe(true);
  });

  it('falls back to the id for a callout that is not playable here', async () => {
    const s = await start();
    const last = lastSessionFor(s, { finished: true, answered: 1, correct: 0, totalMs: 1, slowest: [], confusions: [{ target: 'test.mid', chosen: 'test.gone', count: 1 }], introduced: [], mastery: [] });
    expect(last.names).toEqual({ 'test.mid': 'Mid', 'test.gone': 'test.gone' });
  });

  it('keeps the explanation of an empty session: nothing playable, nothing due', async () => {
    const mirage = await startSession('de_mirage');
    expect(mirage).not.toBeNull();
    if (!mirage) return;
    const view = mirage.runner.view;
    if (view.phase !== 'done') throw new Error('not done');
    reportSession(mirage, view.summary);
    expect(getLastSession('de_mirage')).toMatchObject({ mapId: 'de_mirage', playable: 0, note: 'nothing-due', summary: { answered: 0, finished: true, endedBy: 'plan' } });
  });

  it('is what getLastSession returns afterwards, for its own map only', async () => {
    const s = await start();
    const ended = s.runner.leave();
    if (ended.phase !== 'done') throw new Error('not done');
    reportSession(s, ended.summary);
    expect(getLastSession('de_test')?.summary).toBe(ended.summary);
    expect(getLastSession('de_mirage')).toBeNull();
  });
});

describe('what the runner saves', () => {
  it('writes each answer to the store as it happens', async () => {
    const store = createMemoryStore(learner(30));
    held.store = store;
    const s = await start();
    s.runner.answer({ kind: 'skip' });
    await s.saver.flush();
    const saved = store.events.filter((e) => e.kind === 'answer' && e.ts >= NOW);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ correct: false, chosen: null, rating: Grade.Again });
  });
});

import { beforeAll, describe, expect, it } from 'vitest';
import { applyEvent, createDerived, type Derived } from '../core/log';
import { createScheduler, type Scheduler } from '../core/scheduler';
import { makeCallouts } from '../core/test-fixtures';
import { createMemoryStore } from '../core/store';
import { answer, drive, intro } from '../core/test-helpers';
import { DAY_MS, Grade } from '../core/types';
import type { MapData } from './data';
import { loadLearner, loadProgress, mapProgress, pickMaps, weakestZone, type PickEntry, type ProgressInput } from './progress';

const T0 = Date.parse('2026-02-01T09:00:00Z');
let scheduler: Scheduler;
beforeAll(async () => {
  scheduler = await createScheduler();
});

const callouts = makeCallouts(); // eight standard callouts and one Hard spot, all draft; five are Core
function input(derived: Derived, over: Partial<ProgressInput> = {}): ProgressInput {
  return { callouts, derived, scheduler, now: T0, hardMode: false, includeDraft: true, ...over };
}

/** Bring a callout to Familiar: all three recognition items answered well. */
function toFamiliar(d: Derived, id: string, ts = T0) {
  applyEvent(d, intro(id, ts), scheduler);
  for (const m of ['name-mc', 'read-map', 'which-view'] as const) applyEvent(d, answer(id, m, ts, Grade.Good), scheduler);
}

describe('a learner with no history', () => {
  const p = mapProgress(input(createDerived()));

  it('has every callout in play at New, none due, nothing started', () => {
    expect(p.total).toBe(8); // the Hard spot is out while Hard mode is off
    expect(p.playable).toBe(true);
    expect(p.states).toEqual({ new: 8, seen: 0, learning: 0, familiar: 0, known: 0, automatic: 0 });
    expect(Object.values(p.fills).every((m) => m === 'new')).toBe(true);
    expect(p).toMatchObject({ percent: 0, due: 0, started: 0, lastActivity: null, dueByCallout: {} });
    expect(p.core).toEqual({ total: 5, familiar: 0 });
  });
});

describe('which callouts count', () => {
  it('leaves drafts out unless drafts are on, and says the map has nothing to play', () => {
    const p = mapProgress(input(createDerived(), { includeDraft: false }));
    expect(p).toMatchObject({ total: 0, playable: false, percent: 0, core: { total: 0, familiar: 0 } });
    expect(p.fills).toEqual({});
  });

  it('counts verified callouts without drafts', () => {
    const verified = callouts.map((c) => (c.id === 'test.mid' ? { ...c, status: 'verified' as const } : c));
    const p = mapProgress(input(createDerived(), { callouts: verified, includeDraft: false }));
    expect(p.total).toBe(1);
    expect(Object.keys(p.fills)).toEqual(['test.mid']);
  });

  it('has nothing for a map with no callouts at all', () => {
    const p = mapProgress(input(createDerived(), { callouts: [] }));
    expect(p).toMatchObject({ total: 0, playable: false, percent: 0, due: 0, states: { new: 0 } });
  });

  it('adds the Hard spot in Hard mode, and keeps its progress while Hard mode is off', () => {
    const d = createDerived();
    toFamiliar(d, 'test.a-site'); // the spot's parent has to be in play too
    toFamiliar(d, 'test.bench');
    const off = mapProgress(input(d));
    const on = mapProgress(input(d, { hardMode: true }));
    expect(off.total).toBe(8);
    expect(off.fills['test.bench']).toBeUndefined();
    expect(on.total).toBe(9);
    expect(on.fills['test.bench']).toBe('familiar');
    // Hard spots are not Core
    expect(on.core.total).toBe(5);
  });

  it('drops a stale callout', () => {
    const stale = callouts.map((c) => (c.id === 'test.mid' ? { ...c, status: 'stale' as const } : c));
    expect(mapProgress(input(createDerived(), { callouts: stale })).total).toBe(7);
  });
});

describe('mastery states and the counts', () => {
  it('derives each callout\'s state from the log and counts them', () => {
    const d = createDerived();
    applyEvent(d, intro('test.t-spawn', T0), scheduler); // seen
    applyEvent(d, answer('test.mid', 'name-mc', T0, Grade.Good), scheduler); // learning
    toFamiliar(d, 'test.a-ramp'); // familiar
    toFamiliar(d, 'test.a-site');
    drive(d, scheduler, 'test.a-site', 'pin', T0, [Grade.Good, Grade.Good]); // known
    const p = mapProgress(input(d));
    expect(p.fills).toMatchObject({
      'test.t-spawn': 'seen',
      'test.mid': 'learning',
      'test.a-ramp': 'familiar',
      'test.a-site': 'known',
      'test.palace': 'new',
    });
    expect(p.states).toEqual({ new: 4, seen: 1, learning: 1, familiar: 1, known: 1, automatic: 0 });
    expect(p.started).toBe(4);
    expect(Object.values(p.states).reduce((a, b) => a + b, 0)).toBe(p.total);
  });

  it('reaches Automatic with fast typed answers', () => {
    const d = createDerived();
    toFamiliar(d, 'test.mid');
    drive(d, scheduler, 'test.mid', 'pin', T0, [Grade.Good, Grade.Good]);
    drive(d, scheduler, 'test.mid', 'name-typed', T0, [Grade.Good, Grade.Good]);
    expect(mapProgress(input(d)).fills['test.mid']).toBe('automatic');
  });
});

describe('Core x of y', () => {
  it('counts Core (tier 1) callouts that are at least Familiar, and ignores the rest', () => {
    const d = createDerived();
    toFamiliar(d, 'test.mid'); // core, familiar
    toFamiliar(d, 'test.a-ramp'); // core, familiar
    toFamiliar(d, 'test.palace'); // standard, not core
    applyEvent(d, answer('test.b-site', 'name-mc', T0, Grade.Good), scheduler); // core but only learning
    expect(mapProgress(input(d)).core).toEqual({ total: 5, familiar: 2 });
  });

  it('counts Known and Automatic too', () => {
    const d = createDerived();
    toFamiliar(d, 'test.mid');
    drive(d, scheduler, 'test.mid', 'pin', T0, [Grade.Good, Grade.Good]);
    expect(mapProgress(input(d)).fills['test.mid']).toBe('known');
    expect(mapProgress(input(d)).core.familiar).toBe(1);
  });
});

describe('the overall percent', () => {
  it('is the weighted share of the map learned, rounded', () => {
    const d = createDerived();
    for (const c of callouts.filter((x) => x.tier !== 3)) toFamiliar(d, c.id); // all eight Familiar: 0.55 each
    expect(mapProgress(input(d)).percent).toBe(55);
  });

  it('counts a Seen callout a little and a New one not at all', () => {
    const d = createDerived();
    applyEvent(d, intro('test.mid', T0), scheduler);
    // 0.1 of eight callouts = 1.25 %
    expect(mapProgress(input(d)).percent).toBe(1);
  });

  it('is 100 when everything is Automatic', () => {
    const d = createDerived();
    for (const c of callouts.filter((x) => x.tier !== 3)) {
      toFamiliar(d, c.id);
      drive(d, scheduler, c.id, 'pin', T0, [Grade.Good, Grade.Good]);
      drive(d, scheduler, c.id, 'name-typed', T0, [Grade.Good, Grade.Good]);
    }
    expect(mapProgress(input(d)).percent).toBe(100);
  });
});

describe('what is due', () => {
  it('counts items past their due time, by callout, and not before', () => {
    const d = createDerived();
    toFamiliar(d, 'test.mid'); // three items, all answered Good at T0
    toFamiliar(d, 'test.a-ramp');
    expect(mapProgress(input(d, { now: T0 + 60_000 })).due).toBe(0);
    const later = mapProgress(input(d, { now: T0 + 60 * DAY_MS }));
    expect(later.due).toBe(6);
    expect(later.dueByCallout).toEqual({ 'test.mid': 3, 'test.a-ramp': 3 });
  });

  it('counts a callout that has only been introduced as nothing due', () => {
    const d = createDerived();
    applyEvent(d, intro('test.mid', T0), scheduler);
    expect(mapProgress(input(d, { now: T0 + 400 * DAY_MS })).due).toBe(0);
  });

  it('does not count callouts that are not in play', () => {
    const d = createDerived();
    toFamiliar(d, 'test.a-site');
    toFamiliar(d, 'test.bench');
    const later = T0 + 60 * DAY_MS;
    expect(mapProgress(input(d, { now: later })).due).toBe(3);
    expect(mapProgress(input(d, { now: later, hardMode: true })).due).toBe(6);
  });

  it('does not count items of modes the callout cannot be asked in', () => {
    // a callout without screenshots is never asked the picture modes, so a stray old answer in one is not "due"
    const bare = callouts.map((c) => (c.id === 'test.mid' ? { ...c, shots: [] } : c));
    const d = createDerived();
    applyEvent(d, answer('test.mid', 'name-mc', T0, Grade.Good), scheduler);
    applyEvent(d, answer('test.mid', 'read-map', T0, Grade.Good), scheduler);
    expect(mapProgress(input(d, { callouts: bare, now: T0 + 60 * DAY_MS })).due).toBe(1);
  });
});

describe('when the learner last did anything', () => {
  it('is the latest intro or answer on a callout in play', () => {
    const d = createDerived();
    applyEvent(d, intro('test.mid', T0), scheduler);
    applyEvent(d, answer('test.a-ramp', 'name-mc', T0 + 5000, Grade.Good), scheduler);
    expect(mapProgress(input(d)).lastActivity).toBe(T0 + 5000);
    applyEvent(d, intro('test.palace', T0 + 9000), scheduler);
    expect(mapProgress(input(d)).lastActivity).toBe(T0 + 9000);
  });

  it('ignores callouts of other maps', () => {
    const d = createDerived();
    applyEvent(d, intro('other.thing', T0), scheduler);
    expect(mapProgress(input(d)).lastActivity).toBeNull();
  });
});

describe('zones', () => {
  it('has a percent and a due count for each zone that has callouts', () => {
    const d = createDerived();
    toFamiliar(d, 'test.a-ramp');
    toFamiliar(d, 'test.a-site');
    const p = mapProgress(input(d, { now: T0 + 60 * DAY_MS }));
    expect(p.zones['a']).toEqual({ total: 3, percent: Math.round((100 * 1.1) / 3), due: 6 });
    expect(p.zones['spawn']).toEqual({ total: 1, percent: 0, due: 0 });
    expect(Object.keys(p.zones).sort()).toEqual(['a', 'b', 'mid', 'spawn']);
  });

  it('names the weakest zone, the earlier one on a tie, and none when there are none', () => {
    const order = ['spawn', 'mid', 'a', 'b'];
    expect(weakestZone(mapProgress(input(createDerived())), order)).toBe('spawn');
    const d = createDerived();
    toFamiliar(d, 'test.t-spawn');
    toFamiliar(d, 'test.mid');
    toFamiliar(d, 'test.connector');
    expect(weakestZone(mapProgress(input(d)), order)).toBe('a');
    expect(weakestZone(mapProgress(input(d, { callouts: [] })), order)).toBeNull();
  });
});

describe('which map to offer', () => {
  const e = (mapId: string, over: Partial<PickEntry> = {}): PickEntry => ({ mapId, demo: false, playable: true, due: 0, lastActivity: null, ...over });

  it('has nothing to offer when no map can be played', () => {
    expect(pickMaps([e('de_mirage', { playable: false }), e('de_dust2', { playable: false })])).toEqual({ start: null, recommended: null, resume: null });
    expect(pickMaps([])).toEqual({ start: null, recommended: null, resume: null });
  });

  it('recommends the first playable map to a new learner, with nothing to resume', () => {
    const picks = pickMaps([e('de_mirage', { playable: false }), e('de_dust2'), e('de_inferno')]);
    expect(picks).toEqual({ start: 'de_dust2', recommended: 'de_dust2', resume: null });
  });

  it('starts the map with most due, and resumes the one worked on last', () => {
    const picks = pickMaps([e('a', { due: 3, lastActivity: 100 }), e('b', { due: 9, lastActivity: 50 }), e('c', { due: 0, lastActivity: 200 })]);
    expect(picks).toEqual({ start: 'b', recommended: 'c', resume: 'c' });
  });

  it('starts the recommended map when nothing is due', () => {
    expect(pickMaps([e('a', { lastActivity: 100 }), e('b', { lastActivity: 300 })]).start).toBe('b');
  });

  it('breaks a tie in due counts by recent activity', () => {
    expect(pickMaps([e('a', { due: 4, lastActivity: 10 }), e('b', { due: 4, lastActivity: 20 })]).start).toBe('b');
  });

  it('keeps the development map out of the way while a real map can be played', () => {
    const picks = pickMaps([e('de_test', { demo: true, due: 50, lastActivity: 999 }), e('de_mirage', { due: 1, lastActivity: 5 })]);
    expect(picks).toEqual({ start: 'de_mirage', recommended: 'de_mirage', resume: 'de_mirage' });
  });

  it('offers the development map when it is the only one', () => {
    expect(pickMaps([e('de_mirage', { playable: false }), e('de_test', { demo: true })]).start).toBe('de_test');
  });
});

describe('the loader', () => {
  function mapData(id: string, demo: boolean, list = callouts): MapData {
    return { map: { id } as MapData['map'], callouts: list, shotUrl: (f) => f, demo, art: null };
  }

  it('replays the log it is given into a learner', async () => {
    const store = createMemoryStore([intro('test.mid', T0), answer('test.mid', 'name-mc', T0, Grade.Good)]);
    const names: string[] = [];
    const learner = await loadLearner(true, { open: async (n) => (names.push(n), store) });
    expect(names).toEqual(['callouts-demo']);
    expect(learner.failed).toBe(false);
    expect(learner.derived.items.size).toBe(1);
    expect(learner.derived.introduced.has('test.mid')).toBe(true);
  });

  it('opens the real log for real maps', async () => {
    const names: string[] = [];
    await loadLearner(false, { open: async (n) => (names.push(n), null) });
    expect(names).toEqual(['callouts']);
  });

  it('treats a log that was never written as empty, not as a failure', async () => {
    const learner = await loadLearner(true, { open: async () => null });
    expect(learner).toMatchObject({ failed: false });
    expect(learner.derived.items.size).toBe(0);
  });

  it('falls back to an empty learner when the log cannot be read, and says so', async () => {
    const learner = await loadLearner(false, {
      open: async () => {
        throw new Error('storage blocked');
      },
    });
    expect(learner.failed).toBe(true);
    expect(learner.derived.items.size).toBe(0);
  });

  it('gives each map progress against the log it belongs to', async () => {
    const real = createMemoryStore([answer('test.mid', 'name-mc', T0, Grade.Good)]);
    const demo = createMemoryStore([answer('test.a-ramp', 'name-mc', T0, Grade.Good), answer('test.a-ramp', 'read-map', T0, Grade.Good)]);
    const verified = callouts.map((c) => ({ ...c, status: 'verified' as const })); // a real map has no drafts in play
    const snapshot = await loadProgress([mapData('de_one', false, verified), mapData('de_test', true)], {
      now: T0 + 60 * DAY_MS,
      open: async (n) => (n === 'callouts' ? real : demo),
    });
    expect(snapshot.failed).toBe(false);
    // both fixtures use the same callout ids, so what differs is which log was read
    expect(snapshot.byMap.get('de_one')?.fills['test.mid']).toBe('learning');
    expect(snapshot.byMap.get('de_one')?.due).toBe(1);
    expect(snapshot.byMap.get('de_test')?.fills['test.a-ramp']).toBe('learning');
    expect(snapshot.byMap.get('de_test')?.due).toBe(2);
  });

  it('reports a failed log and still returns every map', async () => {
    const snapshot = await loadProgress([mapData('de_one', false, [])], {
      open: async () => {
        throw new Error('nope');
      },
    });
    expect(snapshot.failed).toBe(true);
    expect(snapshot.byMap.get('de_one')).toMatchObject({ playable: false, total: 0 });
  });
});

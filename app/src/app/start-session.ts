// Everything a session needs, assembled: the map's data, the learner's log replayed into state, the plan, the
// runner, and a saver that writes every event as it happens (SCOPE.md §4.3, §5.4 "never lose work", §7.6).

import { answersSince, replay, type Derived } from '../core/log';
import { mulberry32 } from '../core/rng';
import { SessionRunner, startOfLocalDay } from '../core/runner';
import { createScheduler } from '../core/scheduler';
import type { Callout } from '../core/schema';
import { buildSession, DEFAULT_SESSION_SETTINGS, playableCallouts, type SessionPlan, type SessionSettings } from '../core/session';
import { createMemoryStore, createSaver, type ReviewStore, type SaveStatus, type Saver } from '../core/store';
import { openReviewStore } from '../storage/idb-store';
import { loadAvailableMaps, type MapData } from './data';

export interface StartOptions {
  /** Narrow the session to one zone of the map. */
  zone?: string | undefined;
  /** Fixes the random source: the same seed and log ask the same questions. For tests (`?seed=` in the address). */
  seed?: number | undefined;
  /** Callout drafts are for development; `?draft` in the address turns them on for any map. */
  includeDraft?: boolean | undefined;
  onSaveStatus?: ((status: SaveStatus) => void) | undefined;
}

export interface StartedSession {
  data: MapData;
  runner: SessionRunner;
  saver: Saver;
  plan: SessionPlan;
  /** What questions and options draw on: this map's playable callouts. */
  playable: Callout[];
  /** The learner's live state, which the runner keeps up to date as answers come in. */
  derived: Derived;
  /** The browser would not give out storage, so this session's progress is kept in memory only. */
  volatile: boolean;
  settings: SessionSettings;
}

async function openStore(demo: boolean): Promise<{ store: ReviewStore; volatile: boolean }> {
  try {
    // The synthetic map keeps its own log, so trying things out never touches real progress.
    return { store: await openReviewStore(demo ? 'callouts-demo' : 'callouts'), volatile: false };
  } catch (e) {
    console.warn('IndexedDB is not available; this session will not be saved', e);
    return { store: createMemoryStore(), volatile: true };
  }
}

/** Null when the map is not one the app has. */
export async function startSession(mapId: string, options: StartOptions = {}): Promise<StartedSession | null> {
  const maps = await loadAvailableMaps();
  const data = maps.find((m) => m.map.id === mapId);
  if (!data) return null;

  const { store, volatile } = await openStore(data.demo);
  const [loaded, scheduler] = await Promise.all([store.load(), createScheduler()]);
  const derived = replay(loaded.events, scheduler);

  const settings: SessionSettings = { ...DEFAULT_SESSION_SETTINGS, includeDraft: data.demo || options.includeDraft === true };
  const now = Date.now();
  const rng = mulberry32(options.seed ?? (now ^ Math.floor(Math.random() * 0x7fffffff)));
  // The new-item throttle counts every map's backlog, so plan over all of them (never mixing in the demo map).
  const pool = maps.filter((m) => m.demo === data.demo).flatMap((m) => m.callouts);
  const plan = buildSession({
    callouts: pool,
    derived,
    scheduler,
    settings,
    zoneOrder: data.map.zones.map((z) => z.id),
    map: mapId,
    zone: options.zone,
    answersToday: answersSince(loaded.events, startOfLocalDay(now)),
    now: new Date(now),
    rng,
  });

  const saver = createSaver(store, options.onSaveStatus);
  const playable = playableCallouts(data.callouts, settings);
  const runner = new SessionRunner({
    map: data.map,
    callouts: playable,
    derived,
    scheduler,
    settings,
    plan,
    rng,
    now: Date.now,
    newId: () => crypto.randomUUID(),
    onEvent: (event) => saver.save(event),
  });
  return { data, runner, saver, plan, playable, derived, volatile, settings };
}

// Everything a session needs, assembled: the map's data, the learner's log replayed into state, the plan, the
// runner, and a saver that writes every event as it happens (SCOPE.md §4.3, §5.4 "never lose work", §7.6).
// Settings are read here, once per session (app/settings.ts): card limit and time limit, new per session, the gentle
// start, the retention target, Hard mode for the map, and which names are shown and accepted.

import { pairKey, parseContrastSeen, serialiseContrastSeen, type ContrastSeen } from '../core/contrast';
import { answersSince, replay, type Derived } from '../core/log';
import { presentCallouts } from '../core/present';
import { mulberry32 } from '../core/rng';
import { SessionRunner, startOfLocalDay, summaryCalloutIds, type SessionSummary } from '../core/runner';
import { createScheduler } from '../core/scheduler';
import type { Callout } from '../core/schema';
import { buildSession, playableCallouts, sessionSettingsFrom, type SessionInput, type SessionPlan, type SessionSettings } from '../core/session';
import { createMemoryStore, createSaver, type ReviewStore, type SaveStatus, type Saver } from '../core/store';
import { openReviewStore } from '../storage/idb-store';
import { loadAvailableMaps, type MapData } from './data';
import { setLastSession, type LastSession } from './last-session';
import { getSettings, hardModeFor } from './settings';

export interface StartOptions {
  /** Narrow the session to one zone of the map. */
  zone?: string | undefined;
  /** Fixes the random source: the same seed and log ask the same questions. For tests (`?seed=` in the address). */
  seed?: number | undefined;
  /** Callout drafts are for development; `?draft` in the address turns them on for any map. */
  includeDraft?: boolean | undefined;
  onSaveStatus?: ((status: SaveStatus) => void) | undefined;
  /** "Practise anyway": a session of the items closest to being due, when nothing is. */
  earlyPractice?: boolean | undefined;
  /** Show Speed call pictures for exactly this long, in ms. For tests (`?flash=` in the address, development builds). */
  flashMs?: number | undefined;
}

export interface StartedSession {
  data: MapData;
  runner: SessionRunner;
  saver: Saver;
  plan: SessionPlan;
  /** What questions and options draw on: this map's playable callouts, named the way the naming setting says. */
  playable: Callout[];
  /** The learner's live state, which the runner keeps up to date as answers come in. */
  derived: Derived;
  /** The browser would not give out storage, so this session's progress is kept in memory only. */
  volatile: boolean;
  settings: SessionSettings;
  /** The plan is empty because nothing is due, and an early practice session would not be: offer "Practise anyway". */
  canPracticeEarly: boolean;
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

// When a contrast card was last shown is kept beside the log, not in it: it is not a learning event (core/contrast.ts).
const seenKey = (demo: boolean) => (demo ? 'callouts.contrast-seen.demo' : 'callouts.contrast-seen');

function loadSeen(demo: boolean): Map<string, ContrastSeen> {
  try {
    return parseContrastSeen(localStorage.getItem(seenKey(demo)));
  } catch {
    return new Map(); // storage blocked: a card may then show again, which is harmless
  }
}

function saveSeen(demo: boolean, seen: ReadonlyMap<string, ContrastSeen>): void {
  try {
    localStorage.setItem(seenKey(demo), serialiseContrastSeen(seen));
  } catch {
    // quota or blocked storage: the record lasts for this page only
  }
}

/** Null when the map is not one the app has. */
export async function startSession(mapId: string, options: StartOptions = {}): Promise<StartedSession | null> {
  const maps = await loadAvailableMaps();
  const data = maps.find((m) => m.map.id === mapId);
  if (!data) return null;

  const prefs = getSettings();
  const { store, volatile } = await openStore(data.demo);
  const [loaded, scheduler] = await Promise.all([store.load(), createScheduler(prefs.retention)]);
  const derived = replay(loaded.events, scheduler);

  const settings = sessionSettingsFrom(prefs, { hardMode: hardModeFor(prefs, mapId), includeDraft: data.demo || options.includeDraft === true });
  const now = Date.now();
  const rng = mulberry32(options.seed ?? (now ^ Math.floor(Math.random() * 0x7fffffff)));
  const contrastSeen = loadSeen(data.demo);
  // The new-item throttle counts every map's backlog, so plan over all of them (never mixing in the demo map).
  const pool = maps.filter((m) => m.demo === data.demo).flatMap((m) => m.callouts);
  const input: SessionInput = {
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
    contrastSeen,
  };
  const plan = buildSession({ ...input, earlyPractice: options.earlyPractice });
  // "Practise anyway" is only worth offering when there is something to practise.
  const canPracticeEarly = options.earlyPractice !== true && plan.note === 'nothing-due' && buildSession({ ...input, earlyPractice: true }).cards.length > 0;

  const saver = createSaver(store, options.onSaveStatus);
  // The session works on the callouts as the naming setting shows them (core/present.ts).
  const playable = playableCallouts(presentCallouts(data.callouts, prefs.naming), settings);
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
    onContrast: (shown) => {
      contrastSeen.set(pairKey(shown.a, shown.b), { at: shown.ts, count: shown.count });
      saveSeen(data.demo, contrastSeen);
    },
    flashMs: options.flashMs,
  });
  return { data, runner, saver, plan, playable, derived, volatile, settings, canPracticeEarly };
}

/** What the Summary screen is handed when a session ends, whether it finished or was left (app/last-session.ts). */
export function lastSessionFor(started: StartedSession, summary: SessionSummary, at: number = Date.now()): LastSession {
  const shown = new Map(started.playable.map((c) => [c.id, c.name]));
  const names: Record<string, string> = {};
  for (const id of summaryCalloutIds(summary)) names[id] = shown.get(id) ?? id;
  return { mapId: started.data.map.id, at, summary, note: started.plan.note, names, playable: started.playable.length };
}

export function reportSession(started: StartedSession, summary: SessionSummary): void {
  setLastSession(lastSessionFor(started, summary));
}

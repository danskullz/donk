// What the review log says about each map (SCOPE.md §4.5): the mastery state of every callout, the counts the Home
// picker and the Map screen show (Core x of y, an overall percent, what is due now), and which map to offer first.
// The functions are pure; `loadLearner` and `loadProgress` at the end read the log and never write to it.
//
// "Playable" matches the session builder (core/session.ts `playableCallouts`): verified callouts, drafts only in
// development builds or with `?draft`, Hard spots only while Hard mode is on for the map. A map with none is shown
// as "no callouts yet" rather than as 0 %.

import { replay, type Derived } from '../core/log';
import { applicableModes, masteryOf } from '../core/mastery';
import { createScheduler, type Scheduler } from '../core/scheduler';
import type { Callout } from '../core/schema';
import { DEFAULT_SESSION_SETTINGS, playableCallouts } from '../core/session';
import type { ReviewStore } from '../core/store';
import { MASTERY_STATES, type Mastery, type Mode } from '../core/types';
import { openReviewStore } from '../storage/idb-store';
import type { MapData } from './data';
import { getSettings, hardModeFor } from './settings';

/** How much each state counts toward a map's percent. Seen is a little (you have met it), Automatic is all of it. */
export const MASTERY_WEIGHT: Readonly<Record<Mastery, number>> = {
  new: 0,
  seen: 0.1,
  learning: 0.3,
  familiar: 0.55,
  known: 0.8,
  automatic: 1,
};

/** Position of a state in the ramp, lowest first. */
export const masteryRank = (m: Mastery): number => MASTERY_STATES.indexOf(m);

export interface ZoneProgress {
  total: number;
  percent: number;
  due: number;
}

export interface MapProgress {
  /** Callouts in play for this map under the current Hard mode and draft rules. */
  total: number;
  /** Something can be taught and asked. False for a map with no callouts yet (Mirage today). */
  playable: boolean;
  /** How many callouts are in each state. */
  states: Record<Mastery, number>;
  /** Mastery of each callout by id: the `fills` of the map component. */
  fills: Record<string, Mastery>;
  /** Items (a callout in one mode) due now, by callout id. Only callouts with a due item appear. */
  dueByCallout: Record<string, number>;
  /** Core callouts (tier 1): how many there are, and how many have reached Familiar or better. */
  core: { total: number; familiar: number };
  /** Share of the map learned, 0 to 100, weighted by state (`MASTERY_WEIGHT`). */
  percent: number;
  /** Items due now across the map. */
  due: number;
  /** Callouts that are past New. */
  started: number;
  /** Time of the latest answer or intro on this map's callouts, or null if there is none. */
  lastActivity: number | null;
  zones: Record<string, ZoneProgress>;
}

export interface ProgressInput {
  callouts: readonly Callout[];
  derived: Derived;
  scheduler: Scheduler;
  /** Epoch ms: what "due" is measured against. */
  now: number;
  hardMode: boolean;
  /** Drafts count as callouts (development maps, or `?draft`). */
  includeDraft: boolean;
  modes?: readonly Mode[];
}

const emptyStates = (): Record<Mastery, number> => ({ new: 0, seen: 0, learning: 0, familiar: 0, known: 0, automatic: 0 });
const percentOf = (weight: number, total: number): number => (total === 0 ? 0 : Math.round((100 * weight) / total));

export function mapProgress(input: ProgressInput): MapProgress {
  const { derived, scheduler, now } = input;
  const modes = input.modes ?? DEFAULT_SESSION_SETTINGS.enabledModes;
  const inPlay = playableCallouts(input.callouts, { hardMode: input.hardMode, includeDraft: input.includeDraft });
  const byId = new Map(inPlay.map((c) => [c.id, c]));

  const states = emptyStates();
  const fills: Record<string, Mastery> = {};
  const zoneWeight = new Map<string, { total: number; weight: number; due: number }>();
  let weight = 0;
  let coreTotal = 0;
  let coreFamiliar = 0;
  let lastActivity: number | null = null;
  const touch = (ts: number | undefined) => {
    if (ts !== undefined && (lastActivity === null || ts > lastActivity)) lastActivity = ts;
  };

  for (const c of inPlay) {
    const m = masteryOf(c.id, derived, scheduler, applicableModes(c, modes));
    fills[c.id] = m;
    states[m] += 1;
    weight += MASTERY_WEIGHT[m];
    if (c.tier === 1) {
      coreTotal += 1;
      if (masteryRank(m) >= masteryRank('familiar')) coreFamiliar += 1;
    }
    const z = zoneWeight.get(c.zone) ?? { total: 0, weight: 0, due: 0 };
    z.total += 1;
    z.weight += MASTERY_WEIGHT[m];
    zoneWeight.set(c.zone, z);
    touch(derived.introduced.get(c.id));
  }

  const dueByCallout: Record<string, number> = {};
  let due = 0;
  for (const item of derived.items.values()) {
    const c = byId.get(item.calloutId);
    if (!c) continue;
    touch(item.lastTs);
    if (item.answers === 0 || !modes.includes(item.mode) || !applicableModes(c, modes).includes(item.mode)) continue;
    if (scheduler.dueAt(item.memory).getTime() > now) continue;
    dueByCallout[c.id] = (dueByCallout[c.id] ?? 0) + 1;
    due += 1;
    const z = zoneWeight.get(c.zone);
    if (z) z.due += 1;
  }

  const zones: Record<string, ZoneProgress> = {};
  for (const [id, z] of zoneWeight) zones[id] = { total: z.total, percent: percentOf(z.weight, z.total), due: z.due };

  return {
    total: inPlay.length,
    playable: inPlay.length > 0,
    states,
    fills,
    dueByCallout,
    core: { total: coreTotal, familiar: coreFamiliar },
    percent: percentOf(weight, inPlay.length),
    due,
    started: inPlay.length - states.new,
    lastActivity,
    zones,
  };
}

/** The zone with the lowest percent that has callouts; ties go to the earlier zone on the route. Null if no zone has any. */
export function weakestZone(progress: Pick<MapProgress, 'zones'>, zoneOrder: readonly string[]): string | null {
  let best: { id: string; percent: number; at: number } | null = null;
  for (const [id, z] of Object.entries(progress.zones)) {
    if (z.total === 0) continue;
    const i = zoneOrder.indexOf(id);
    const at = i < 0 ? zoneOrder.length : i;
    if (!best || z.percent < best.percent || (z.percent === best.percent && at < best.at)) best = { id, percent: z.percent, at };
  }
  return best?.id ?? null;
}

// ------------------------------------------------------------------------------------------------ what to offer first

export interface PickEntry {
  mapId: string;
  /** The synthetic development map: offered only when there is nothing else. */
  demo: boolean;
  playable: boolean;
  due: number;
  lastActivity: number | null;
}

export interface Picks {
  /** The map the "Start session" button opens: the one with most due, else the recommended one. */
  start: string | null;
  /** The map to begin with: the one worked on last, else the first that can be played. The "start here" marker. */
  recommended: string | null;
  /** The map worked on last (the "Continue" button), or null if nothing has been started. */
  resume: string | null;
}

export function pickMaps(entries: readonly PickEntry[]): Picks {
  const playable = entries.filter((e) => e.playable);
  // Real maps first: the development map is not recommended while a real one can be played.
  const pool = playable.some((e) => !e.demo) ? playable.filter((e) => !e.demo) : playable;
  const latest = (list: readonly PickEntry[]): PickEntry | null =>
    list.reduce<PickEntry | null>((best, e) => (e.lastActivity !== null && (best === null || e.lastActivity > (best.lastActivity ?? -1)) ? e : best), null);

  const resume = latest(pool);
  const recommended = resume ?? pool[0] ?? null;
  const mostDue = pool.reduce<PickEntry | null>((best, e) => {
    if (e.due <= 0) return best;
    if (best === null || e.due > best.due) return e;
    if (e.due === best.due && (e.lastActivity ?? -1) > (best.lastActivity ?? -1)) return e;
    return best;
  }, null);
  return { start: (mostDue ?? recommended)?.mapId ?? null, recommended: recommended?.mapId ?? null, resume: resume?.mapId ?? null };
}

// ------------------------------------------------------------------------------------------------------- the loader

export const REAL_DB = 'callouts';
export const DEMO_DB = 'callouts-demo';

/** Drafts are for development: the synthetic map always, any other map with `?draft` in the address (as the session does). */
export function includeDraftFor(map: Pick<MapData, 'demo'>): boolean {
  if (map.demo) return true;
  try {
    return new URLSearchParams(location.search).has('draft');
  } catch {
    return false;
  }
}

export interface Learner {
  derived: Derived;
  scheduler: Scheduler;
  /** The log could not be read; the numbers are those of an empty log. */
  failed: boolean;
}

export interface LoadOptions {
  /** Where to open a log from; null means there is none. Tests pass their own; the default is IndexedDB. */
  open?: (name: string) => Promise<ReviewStore | null>;
  retention?: number;
}

/** Opening a database creates it, and reading progress must change nothing, so a log that was never written is skipped. */
async function openExisting(name: string): Promise<ReviewStore | null> {
  try {
    const known = await indexedDB.databases?.();
    if (known && !known.some((d) => d.name === name)) return null;
  } catch {
    // no way to ask: open it, which at worst creates the empty database the first session would create anyway
  }
  return openReviewStore(name);
}

/** The learner's state for the real maps (`demo` false) or the synthetic one. Reading only. */
export async function loadLearner(demo: boolean, options: LoadOptions = {}): Promise<Learner> {
  const scheduler = await createScheduler(options.retention ?? getSettings().retention);
  try {
    const store = await (options.open ?? openExisting)(demo ? DEMO_DB : REAL_DB);
    const loaded = store ? await store.load() : { events: [] };
    return { derived: replay(loaded.events, scheduler), scheduler, failed: false };
  } catch (e) {
    console.warn('The review log could not be read; progress is shown as empty', e);
    return { derived: replay([], scheduler), scheduler, failed: true };
  }
}

export interface ProgressSnapshot {
  byMap: Map<string, MapProgress>;
  /** A log could not be read, so some numbers are those of an empty log. */
  failed: boolean;
  now: number;
}

/** Progress for every map given, each against the log it belongs to (real maps share one, the synthetic map has its own). */
export async function loadProgress(maps: readonly MapData[], options: LoadOptions & { now?: number } = {}): Promise<ProgressSnapshot> {
  const now = options.now ?? Date.now();
  const learners = new Map<boolean, Learner>();
  for (const demo of new Set(maps.map((m) => m.demo))) learners.set(demo, await loadLearner(demo, options));
  const settings = getSettings();
  const byMap = new Map<string, MapProgress>();
  for (const m of maps) {
    const learner = learners.get(m.demo) as Learner;
    byMap.set(
      m.map.id,
      mapProgress({
        callouts: m.callouts,
        derived: learner.derived,
        scheduler: learner.scheduler,
        now,
        hardMode: hardModeFor(settings, m.map.id),
        includeDraft: includeDraftFor(m),
      }),
    );
  }
  return { byMap, failed: [...learners.values()].some((l) => l.failed), now };
}

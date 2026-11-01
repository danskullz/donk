// Stage unlocks (SCOPE.md §4.4) and the six mastery states (§4.5), both derived from FSRS stability.
//
//   New        nothing yet
//   Seen       an intro card was shown, no answers
//   Learning   answering, but the Recognise stage is not yet stable for 2 days
//   Familiar   Recognise items all stable >= 2 days   (Locate unlocks)
//   Known      Locate items stable >= 5 days          (Recall unlocks)
//   Automatic  Recall (typed) stable >= 10 days, and the last typed answers were fast
//
// "Derived from stability and speed" (§4.5): speed enters twice, through the rating (a slow answer is Hard
// and grows stability less) and through the fluent-time test for Automatic. Thresholds are Phase 1 defaults,
// to be tuned with real data.

import type { Derived } from './log';
import type { Scheduler } from './scheduler';
import type { Callout } from './schema';
import { FLUENT_MS, itemKey, STAGE_MODES, UNLOCK_STABILITY_DAYS, type Mastery, type Mode, type Stage } from './types';

/** Modes that make sense for this callout under the learner's settings. */
export function applicableModes(callout: Pick<Callout, 'shots'>, enabled: readonly Mode[]): Mode[] {
  const hasShot = callout.shots.length > 0;
  return enabled.filter((m) => {
    if (m === 'name-mc' || m === 'which-view' || m === 'where-am-i' || m === 'speed') return hasShot;
    return true;
  });
}

function stageModes(stage: Stage, modes: readonly Mode[]): Mode[] {
  return (STAGE_MODES[stage - 1] ?? []).filter((m) => modes.includes(m));
}

/** Every item of the stage exists, has been answered, and is stable for at least `days`. A stage with no modes is cleared. */
export function stageCleared(calloutId: string, stage: Stage, state: Derived, scheduler: Scheduler, modes: readonly Mode[], days: number): boolean {
  for (const mode of stageModes(stage, modes)) {
    const item = state.items.get(itemKey(calloutId, mode));
    if (!item || item.answers === 0 || scheduler.stabilityDays(item.memory) < days) return false;
  }
  return true;
}

/** Stage 1 is open once a callout is introduced; each later stage opens when the one before it is stable enough. */
export function unlockedStages(calloutId: string, state: Derived, scheduler: Scheduler, modes: readonly Mode[]): Stage[] {
  if (!state.introduced.has(calloutId)) return [];
  const out: Stage[] = [1];
  for (let stage = 1; stage <= 4; stage++) {
    const need = UNLOCK_STABILITY_DAYS[stage - 1] as number;
    if (!stageCleared(calloutId, stage as Stage, state, scheduler, modes, need)) break;
    out.push((stage + 1) as Stage);
  }
  return out;
}

export function unlockedModes(calloutId: string, state: Derived, scheduler: Scheduler, modes: readonly Mode[]): Mode[] {
  return unlockedStages(calloutId, state, scheduler, modes).flatMap((s) => stageModes(s, modes));
}

function median(values: readonly number[]): number {
  const s = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

export function masteryOf(calloutId: string, state: Derived, scheduler: Scheduler, modes: readonly Mode[]): Mastery {
  const answered = [...state.items.values()].some((i) => i.calloutId === calloutId && i.answers > 0);
  if (!answered) return state.introduced.has(calloutId) ? 'seen' : 'new';
  const [r, l, c] = UNLOCK_STABILITY_DAYS as readonly [number, number, number, number];
  if (!stageCleared(calloutId, 1, state, scheduler, modes, r)) return 'learning';
  if (!stageCleared(calloutId, 2, state, scheduler, modes, l)) return 'familiar';
  if (!stageCleared(calloutId, 3, state, scheduler, modes, c)) return 'known';
  const typed = state.items.get(itemKey(calloutId, 'name-typed'));
  const fast = typed !== undefined && typed.recentLatencies.length >= 2 && median(typed.recentLatencies) <= FLUENT_MS['name-typed'];
  return fast ? 'automatic' : 'known';
}

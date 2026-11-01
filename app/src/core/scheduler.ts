// Thin wrapper over ts-fsrs, so the rest of the core sees only memory, grades and days.
//
// Choices made here (SCOPE.md §4.4, checked against ts-fsrs 6.0.0 on 2026-11-01):
// - FSRS-6, asked for by name. ts-fsrs 6 now defaults to FSRS-7; the Phase 0 simulation and every figure in
//   SCOPE §4.4 are FSRS-6, so a silent model change would invalidate them.
// - No minute-long learning steps. Each item is asked once per session, so a "10 minutes" due time would
//   only be an annoyance. A first Good answer comes back in 3 days (then 14, 57, ...).
// - No fuzz: the same log always replays to the same state.

import { DefaultScheduler } from 'ts-fsrs';
import { DAY_MS, type GradeValue } from './types';

export const MIN_RETENTION = 0.85;
export const MAX_RETENTION = 0.95;
export const DEFAULT_RETENTION = 0.9;
export const MAX_INTERVAL_DAYS = 365;

async function build(retention: number) {
  return DefaultScheduler({
    version: 'FSRS-6',
    desiredRetention: retention,
    learningSteps: [],
    relearningSteps: [],
    enableFuzz: false,
    maximumInterval: MAX_INTERVAL_DAYS,
  });
}
type Impl = Awaited<ReturnType<typeof build>>;
type Card = ReturnType<Impl['newCard']>;

/** The scheduler's state for one item. Opaque outside this file: ask the Scheduler about it. */
export interface Memory {
  readonly card: Card;
}

export interface Scheduler {
  readonly retention: number;
  readonly model: string;
  newMemory(key: string, now: Date): Memory;
  review(memory: Memory, grade: GradeValue, now: Date): Memory;
  /** Days of stability: the interval at which recall falls to 90 %. 0 before the first review. */
  stabilityDays(memory: Memory): number;
  dueAt(memory: Memory): Date;
  /** Probability of recall right now, 0 to 1. 0 for an item that has never been reviewed. */
  retrievability(memory: Memory, now: Date): number;
  reps(memory: Memory): number;
  lapses(memory: Memory): number;
}

export function clampRetention(value: number): number {
  return Math.min(MAX_RETENTION, Math.max(MIN_RETENTION, value));
}

export async function createScheduler(retention: number = DEFAULT_RETENTION): Promise<Scheduler> {
  const r = clampRetention(retention);
  const impl = await build(r);
  return {
    retention: r,
    model: String(impl.definition.model.name),
    // A fixed card id (the item key) keeps replays identical; ts-fsrs would otherwise draw a random one.
    newMemory: (key, now) => ({ card: impl.newCard({ now, cardId: key }) }),
    review: (memory, grade, now) => ({ card: impl.review({ card: memory.card, grade, now }).card }),
    stabilityDays: (m) => m.card.stability,
    dueAt: (m) => m.card.dueAt,
    reps: (m) => m.card.reps,
    lapses: (m) => m.card.lapses,
    retrievability: (m, now) => {
      const last = m.card.lastReviewAt;
      if (!last || m.card.reps === 0) return 0;
      const elapsedDays = Math.max(0, (now.getTime() - last.getTime()) / DAY_MS);
      return impl.model.forgettingCurve(m.card, elapsedDays);
    },
  };
}

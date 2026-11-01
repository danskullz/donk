// Helpers for tests that need a learner with a history. Not imported by the app.

import { applyEvent, type AnswerEvent, type Derived, type IntroEvent } from './log';
import type { Scheduler } from './scheduler';
import { itemKey, type GradeValue, type Mode } from './types';

let seq = 0;
export const nextId = () => `t${(seq += 1)}`;

export function answer(callout: string, mode: Mode, ts: number, grade: GradeValue, latencyMs = 1500, chosen: string | null = null): AnswerEvent {
  return { kind: 'answer', id: nextId(), ts, callout, mode, correct: grade > 1, latencyMs, hint: false, rating: grade, chosen };
}

export function intro(callout: string, ts: number): IntroEvent {
  return { kind: 'intro', id: nextId(), ts, callout };
}

/**
 * Answer an item with each grade in turn: the first at `ts0`, every later one on the day the scheduler
 * says it is due. Returns the time of the last answer.
 */
export function drive(state: Derived, scheduler: Scheduler, callout: string, mode: Mode, ts0: number, grades: readonly GradeValue[], latencyMs = 1500): number {
  let ts = ts0;
  grades.forEach((g, i) => {
    if (i > 0) ts = scheduler.dueAt((state.items.get(itemKey(callout, mode)) as NonNullable<ReturnType<Derived['items']['get']>>).memory).getTime();
    applyEvent(state, answer(callout, mode, ts, g, latencyMs), scheduler);
  });
  return ts;
}

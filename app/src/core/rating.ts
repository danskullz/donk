// Rating is inferred, never entered (SCOPE.md §4.4). The bands come from the Phase 0 simulation: Easy only
// when clearly fast, Hard only when clearly slow, and a fixed fluent time per mode, not a percentile of the
// learner's own times (a percentile hands out Hard to a fixed share of answers for ever).

import { FLUENT_MS, Grade, type GradeValue, type Mode } from './types';

export const SLOW_FACTOR = 1.6;
export const FAST_FACTOR = 0.6;

export interface Outcome {
  mode: Mode;
  correct: boolean;
  /** A hint was used ("show first letter", a spoken clue). */
  hint: boolean;
  latencyMs: number;
  /** This is the item's first ever answer. It is asked seconds after the intro card, so it proves little. */
  firstAnswer: boolean;
}

export function inferRating(o: Outcome, fluent: Readonly<Record<Mode, number>> = FLUENT_MS): GradeValue {
  if (!o.correct) return Grade.Again;
  const t = fluent[o.mode];
  // Hints cost nothing on a brand-new item (SCOPE §4.11).
  if ((o.hint && !o.firstAnswer) || o.latencyMs > SLOW_FACTOR * t) return Grade.Hard;
  if (!o.firstAnswer && o.latencyMs < FAST_FACTOR * t) return Grade.Easy;
  return Grade.Good;
}

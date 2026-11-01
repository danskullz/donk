// The review log is the source of truth (SCOPE.md §4.4, §7.6). Every answer is an immutable event; the
// scheduler state, mastery and confusion counts are derived by replaying it, so parameters can be
// re-optimised or the scheduler swapped without losing history. Import merges by event id.

import { z } from 'zod';
import { CalloutIdSchema } from './schema';
import type { Scheduler, Memory } from './scheduler';
import { inferRating, type Outcome } from './rating';
import { itemKey, MODES, type GradeValue, type ItemKey, type Mode } from './types';

const base = { id: z.string().min(1), ts: z.number().int().nonnegative() };

export const AnswerEventSchema = z.strictObject({
  ...base,
  kind: z.literal('answer'),
  callout: CalloutIdSchema,
  mode: z.enum(MODES),
  correct: z.boolean(),
  latencyMs: z.number().int().min(0),
  hint: z.boolean(),
  /** What was inferred at the time. Replay can re-derive it from latencyMs and hint instead. */
  rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  /** The callout the learner picked, typed or clicked, when it was not the target. Null if none. */
  chosen: CalloutIdSchema.nullable(),
});

/** An intro card was shown. Study views never count toward scheduling, but an intro marks a callout as "seen". */
export const IntroEventSchema = z.strictObject({ ...base, kind: z.literal('intro'), callout: CalloutIdSchema });

export const ReviewEventSchema = z.discriminatedUnion('kind', [AnswerEventSchema, IntroEventSchema]);
export const LogFileSchema = z.array(ReviewEventSchema);

export type AnswerEvent = z.infer<typeof AnswerEventSchema>;
export type IntroEvent = z.infer<typeof IntroEventSchema>;
export type ReviewEvent = z.infer<typeof ReviewEventSchema>;

/** One schedulable (callout, mode) pair. */
export interface Item {
  key: ItemKey;
  calloutId: string;
  mode: Mode;
  memory: Memory;
  answers: number;
  correct: number;
  firstTs: number;
  lastTs: number;
  /** Latencies of the last three correct answers, oldest first. Feeds the "Automatic" test (§4.5). */
  recentLatencies: number[];
}

export interface Derived {
  items: Map<ItemKey, Item>;
  /** Callout id -> time of its first intro card or first answer. */
  introduced: Map<string, number>;
  /** "target>chosen" -> times the learner answered `chosen` for `target`. */
  confusions: Map<string, number>;
  seenEvents: Set<string>;
}

export function createDerived(): Derived {
  return { items: new Map(), introduced: new Map(), confusions: new Map(), seenEvents: new Set() };
}

export interface ApplyOptions {
  /** Re-derive each rating from latency and hint instead of using the stored one (after recalibration). */
  rerate?: boolean;
}

/** Fold one event into the state, in place. Events with an id already seen are ignored (merge-safe). */
export function applyEvent(state: Derived, event: ReviewEvent, scheduler: Scheduler, options: ApplyOptions = {}): void {
  if (state.seenEvents.has(event.id)) return;
  state.seenEvents.add(event.id);
  if (!state.introduced.has(event.callout)) state.introduced.set(event.callout, event.ts);
  if (event.kind === 'intro') return;

  const key = itemKey(event.callout, event.mode);
  const now = new Date(event.ts);
  let item = state.items.get(key);
  const first = item === undefined;
  if (item === undefined) {
    item = {
      key,
      calloutId: event.callout,
      mode: event.mode,
      memory: scheduler.newMemory(key, now),
      answers: 0,
      correct: 0,
      firstTs: event.ts,
      lastTs: event.ts,
      recentLatencies: [],
    };
    state.items.set(key, item);
  }
  const grade: GradeValue = options.rerate
    ? inferRating({ mode: event.mode, correct: event.correct, hint: event.hint, latencyMs: event.latencyMs, firstAnswer: first })
    : event.rating;
  item.memory = scheduler.review(item.memory, grade, now);
  item.answers += 1;
  item.lastTs = event.ts;
  if (event.correct) {
    item.correct += 1;
    item.recentLatencies = [...item.recentLatencies, event.latencyMs].slice(-3);
  } else if (event.chosen !== null && event.chosen !== event.callout) {
    const pair = `${event.callout}>${event.chosen}`;
    state.confusions.set(pair, (state.confusions.get(pair) ?? 0) + 1);
  }
}

/** Replay a whole log. Sorted by time, then id, so the order of a merged import does not matter. */
export function replay(events: readonly ReviewEvent[], scheduler: Scheduler, options: ApplyOptions = {}): Derived {
  const state = createDerived();
  const sorted = events.slice().sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const e of sorted) applyEvent(state, e, scheduler, options);
  return state;
}

/** The outcome fields of an answer, as `inferRating` wants them. `firstAnswer` is true when the item is new. */
export function outcomeOf(event: AnswerEvent, firstAnswer: boolean): Outcome {
  return { mode: event.mode, correct: event.correct, hint: event.hint, latencyMs: event.latencyMs, firstAnswer };
}

/** Times `a` and `b` were confused with each other, in either direction. */
export function confusionCount(state: Pick<Derived, 'confusions'>, a: string, b: string): number {
  return (state.confusions.get(`${a}>${b}`) ?? 0) + (state.confusions.get(`${b}>${a}`) ?? 0);
}

export interface ConfusionPair {
  a: string;
  b: string;
  count: number;
}

/** Pairs confused at least `min` times, worst first. At 2 a contrast card is created (SCOPE §4.6). */
export function confusedPairs(state: Pick<Derived, 'confusions'>, min = 2): ConfusionPair[] {
  const seen = new Set<string>();
  const out: ConfusionPair[] = [];
  for (const pair of state.confusions.keys()) {
    const [x, y] = pair.split('>') as [string, string];
    const [a, b] = x < y ? [x, y] : [y, x];
    const k = `${a}|${b}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const count = confusionCount(state, a, b);
    if (count >= min) out.push({ a, b, count });
  }
  return out.sort((p, q) => q.count - p.count || (p.a + p.b < q.a + q.b ? -1 : 1));
}

/** Answers given at or after `since` (epoch ms): the day's count for the review cap (SCOPE §4.4). */
export function answersSince(events: readonly ReviewEvent[], since: number): number {
  let n = 0;
  for (const e of events) if (e.kind === 'answer' && e.ts >= since) n += 1;
  return n;
}

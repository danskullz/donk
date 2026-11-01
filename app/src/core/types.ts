// Vocabulary shared by the core: modes, stages and item keys (SCOPE.md §4.2, §4.4).
// No Svelte, no DOM: everything under src/core is plain TypeScript (ADR 0001, rule 1).

/** One schedulable skill. Mode 1 of SCOPE §4.2 is two items: multiple choice first, typed later. */
export const MODES = ['name-mc', 'read-map', 'which-view', 'pin', 'name-typed', 'where-am-i', 'speed'] as const;
export type Mode = (typeof MODES)[number];

/** The six modes of Phase 1. Speed call came after them (SCOPE §10); sessions now ask for all of `MODES`. */
export const PHASE1_MODES: readonly Mode[] = ['name-mc', 'read-map', 'which-view', 'pin', 'name-typed', 'where-am-i'];

export type Stage = 1 | 2 | 3 | 4 | 5;

/** Intro, then Recognise, Locate, Recall, Place yourself, Speed (SCOPE §4.4). Index 0 is stage 1. */
export const STAGE_MODES: readonly (readonly Mode[])[] = [
  ['name-mc', 'read-map', 'which-view'],
  ['pin'],
  ['name-typed'],
  ['where-am-i'],
  ['speed'],
];

export const STAGE_NAMES = ['recognise', 'locate', 'recall', 'place', 'speed'] as const;

/**
 * Stability (days) every item of stage N must reach before stage N + 1 unlocks.
 * "Two correct in a row" opened every stage within 26 days in the simulation, which is far too early.
 */
export const UNLOCK_STABILITY_DAYS: readonly number[] = [2, 5, 10, 21];

export function stageOf(mode: Mode): Stage {
  for (let i = 0; i < STAGE_MODES.length; i++) {
    if (STAGE_MODES[i]?.includes(mode)) return (i + 1) as Stage;
  }
  throw new Error(`unknown mode ${mode}`);
}

/**
 * Multiple-choice style modes: answered by picking, so a guess has a floor (SCOPE §4.4 simulation). Speed call is
 * multiple choice too but is left out here: it never gets the gentle three-option start, and its time is measured
 * from the moment the picture hides (see rating.ts).
 */
export const CHOICE_MODES: readonly Mode[] = ['name-mc', 'read-map', 'which-view'];

/**
 * Starting guesses for the "fluent time" per mode (SCOPE §4.4). A fixed number, not a percentile of the
 * learner's own times. Recalibrate from real latencies after the first weeks.
 */
export const FLUENT_MS: Readonly<Record<Mode, number>> = {
  'name-mc': 2000,
  'read-map': 2000,
  'which-view': 2000,
  pin: 6000,
  'name-typed': 4000,
  'where-am-i': 6000,
  speed: 2000,
};

export type ItemKey = `${string}:${Mode}`;

export function itemKey(calloutId: string, mode: Mode): ItemKey {
  return `${calloutId}:${mode}`;
}

export function parseItemKey(key: string): { calloutId: string; mode: Mode } {
  const i = key.lastIndexOf(':');
  const calloutId = key.slice(0, i);
  const mode = key.slice(i + 1);
  if (i <= 0 || !(MODES as readonly string[]).includes(mode)) throw new Error(`bad item key ${key}`);
  return { calloutId, mode: mode as Mode };
}

/** FSRS ratings as inferred from an answer (SCOPE §4.4). The numbers match ts-fsrs. */
export const Grade = { Again: 1, Hard: 2, Good: 3, Easy: 4 } as const;
export type GradeValue = (typeof Grade)[keyof typeof Grade];

/** Mastery states, lowest to highest (SCOPE §4.5). */
export const MASTERY_STATES = ['new', 'seen', 'learning', 'familiar', 'known', 'automatic'] as const;
export type Mastery = (typeof MASTERY_STATES)[number];

export const DAY_MS = 86_400_000;

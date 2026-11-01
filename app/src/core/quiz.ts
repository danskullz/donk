// The quiz engine (SCOPE.md §7.6): `makePrompt(card) -> prompt` and `gradeAnswer(prompt, input) -> result`,
// one small branch per mode and nothing about screens. Pure: the clock and the random source are passed in.
//
// Choices made here:
//  - Pin it and Where am I? are graded by the same hit test: the smallest region under the point wins (§4.12),
//    and a click inside a Hard spot counts for the standard callout it sits in. A neighbouring region is "close"
//    but still wrong, as in the comps ("close, still counts as wrong").
//  - Skipping is an answer: "I don't know", logged as wrong with nothing chosen.
//  - The screenshot shown rotates with the item's answer count, so repeat reviews do not turn into recognising
//    one image; different modes of one callout start on different images.
//  - Typed suggestions are a bridge for the first typed question of an item only (§4.7: off at the typed stage).
//  - Speed call (§4.2): the picture shows for `flashMs`, then hides, then the learner picks the name from four. The
//    time that is rated starts when the picture hides, not when it appears (the runner does that); otherwise a
//    three-second flash alone would make every answer "slow". The flash starts at 3 s and shortens by half a second
//    for each right answer, down to 1.5 s, so it gets harder as the item gets surer.

import type { AnswerEvent, Derived } from './log';
import { pickOptions } from './distractors';
import { gradeTyped, nameEntries, type NameEntry } from './match';
import { smallestRegionAt, type Point } from './geometry';
import { inferRating } from './rating';
import type { Rng } from './rng';
import type { QuizCard } from './session';
import type { Callout, Shot } from './schema';
import { itemKey, type Mode } from './types';

/** One tap of help. It costs one rating step on any answer after an item's first (SCOPE §4.4, §4.11). */
export type Hint =
  | { kind: 'letter'; text: string }
  /** Which view?: one wrong picture drops out. */
  | { kind: 'eliminate'; calloutId: string }
  /** Pin it and Where am I?: the target's zone lights up. */
  | { kind: 'zone'; zone: string };

export interface ViewOption {
  callout: Callout;
  shot: Shot;
}

interface PromptBase {
  card: QuizCard;
  target: Callout;
  hint: Hint;
}

export type Prompt =
  | (PromptBase & { mode: 'name-mc'; shot: Shot; options: Callout[] })
  | (PromptBase & { mode: 'read-map'; options: Callout[] })
  | (PromptBase & { mode: 'which-view'; options: ViewOption[] })
  | (PromptBase & { mode: 'pin'; level: string })
  | (PromptBase & { mode: 'name-typed'; shot: Shot; suggestions: boolean })
  | (PromptBase & { mode: 'where-am-i'; shot: Shot; level: string })
  | (PromptBase & { mode: 'speed'; shot: Shot; options: Callout[]; flashMs: number });

/** How long the Speed call picture shows (SCOPE §4.2: 1.5 to 3 s): longest at first, shorter with every right answer. */
export const FLASH_START_MS = 3000;
export const FLASH_FLOOR_MS = 1500;
export const FLASH_STEP_MS = 500;

export function flashFor(rightAnswers: number): number {
  return Math.max(FLASH_FLOOR_MS, FLASH_START_MS - FLASH_STEP_MS * Math.max(0, rightAnswers));
}

export type AnswerInput =
  | { kind: 'choice'; calloutId: string }
  | { kind: 'typed'; text: string }
  /** A point on the map in world units, on the level that was showing. */
  | { kind: 'point'; x: number; y: number; level: string }
  | { kind: 'skip' };

export interface Result {
  correct: boolean;
  /** The callout the learner picked, typed or hit, when there was one. Set for right answers too. */
  chosen: string | null;
  /** Right, with a typo: show the proper spelling, no penalty (SCOPE §4.7). */
  fuzzy: boolean;
  /** Wrong, but the chosen callout is next to the target. */
  close: boolean;
  skipped: boolean;
  /** The clicked point (world units), for Pin it and Where am I?. */
  guess: Point | null;
  /** Neighbour steps between the chosen callout and the target, when both are known. 0 = the target itself. */
  hops: number | null;
}

export interface PromptContext {
  /** Playable callouts of the map being played: questions and options draw only on these. */
  callouts: readonly Callout[];
  derived: Derived;
  /** Level ids of the map, in display order. The first is where a map question starts. */
  levels: readonly string[];
  rng: Rng;
  /** Show Speed call pictures for exactly this long instead of the item's own time. For tests and the `?flash=` hook. */
  flashMs?: number | undefined;
}

export interface GradeContext {
  callouts: readonly Callout[];
  entries: readonly NameEntry[];
}

/** FNV-1a: a small stable hash, used to give each item its own starting screenshot. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** The screenshot for this showing: starts at a per-item offset and moves on by one for every answer given. */
export function pickShot(callout: Callout, salt: string, answers: number): Shot {
  const shot = callout.shots[(hash(salt) + answers) % callout.shots.length];
  if (!shot) throw new Error(`${callout.id} has no screenshots`);
  return shot;
}

function answersSoFar(derived: Derived, calloutId: string, mode: Mode): number {
  return derived.items.get(itemKey(calloutId, mode))?.answers ?? 0;
}

export function makePrompt(card: QuizCard, ctx: PromptContext): Prompt {
  const target = ctx.callouts.find((c) => c.id === card.calloutId);
  if (!target) throw new Error(`${card.calloutId} is not playable here`);
  const answers = answersSoFar(ctx.derived, target.id, card.mode);
  const letter: Hint = { kind: 'letter', text: target.name.charAt(0) };
  const firstLevel = ctx.levels[0] ?? target.level;
  const optionContext = (candidates: readonly Callout[]) => ({
    target,
    candidates,
    introduced: new Set(ctx.derived.introduced.keys()),
    confusions: ctx.derived,
    count: card.options ?? 4,
    rng: ctx.rng,
    include: card.partner,
  });

  switch (card.mode) {
    case 'name-mc':
      return { mode: 'name-mc', card, target, hint: letter, shot: pickShot(target, card.key, answers), options: pickOptions(optionContext(ctx.callouts)) };
    case 'read-map':
      return { mode: 'read-map', card, target, hint: letter, options: pickOptions(optionContext(ctx.callouts)) };
    case 'which-view': {
      const withShots = ctx.callouts.filter((c) => c.shots.length > 0);
      const picked = pickOptions(optionContext(withShots));
      const options = picked.map((c) => ({ callout: c, shot: pickShot(c, `${card.key}>${c.id}`, c.id === target.id ? answers : 0) }));
      const wrong = options.find((o) => o.callout.id !== target.id);
      return { mode: 'which-view', card, target, hint: wrong ? { kind: 'eliminate', calloutId: wrong.callout.id } : letter, options };
    }
    case 'pin':
      return { mode: 'pin', card, target, hint: { kind: 'zone', zone: target.zone }, level: firstLevel };
    case 'name-typed':
      return { mode: 'name-typed', card, target, hint: letter, shot: pickShot(target, card.key, answers), suggestions: answers === 0 };
    case 'where-am-i':
      return { mode: 'where-am-i', card, target, hint: { kind: 'zone', zone: target.zone }, shot: pickShot(target, card.key, answers), level: firstLevel };
    case 'speed': {
      const flashMs = ctx.flashMs ?? flashFor(ctx.derived.items.get(card.key)?.correct ?? 0);
      return { mode: 'speed', card, target, hint: letter, shot: pickShot(target, card.key, answers), options: pickOptions(optionContext(ctx.callouts)), flashMs };
    }
  }
}

/** Steps along neighbour links from one callout to another, either direction, or null if more than `limit` apart. */
export function hopsBetween(from: string, to: string, callouts: readonly Callout[], limit = 8): number | null {
  if (from === to) return 0;
  const links = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!links.has(a)) links.set(a, new Set());
    links.get(a)?.add(b);
  };
  for (const c of callouts) {
    for (const n of c.neighbours) {
      link(c.id, n);
      link(n, c.id);
    }
  }
  let frontier = [from];
  const seen = new Set(frontier);
  for (let hops = 1; hops <= limit; hops++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const n of links.get(id) ?? []) {
        if (n === to) return hops;
        if (!seen.has(n)) {
          seen.add(n);
          next.push(n);
        }
      }
    }
    if (next.length === 0) return null;
    frontier = next;
  }
  return null;
}

function resultFor(prompt: Prompt, ctx: GradeContext, chosen: string | null, correct: boolean, rest: Partial<Result> = {}): Result {
  const hops = chosen === null ? null : hopsBetween(chosen, prompt.target.id, ctx.callouts);
  return { correct, chosen, fuzzy: false, close: !correct && hops === 1, skipped: false, guess: null, hops, ...rest };
}

export function gradeAnswer(prompt: Prompt, input: AnswerInput, ctx: GradeContext): Result {
  if (input.kind === 'skip') return resultFor(prompt, ctx, null, false, { skipped: true });

  switch (prompt.mode) {
    case 'name-mc':
    case 'read-map':
    case 'which-view':
    case 'speed': {
      if (input.kind !== 'choice') throw new Error(`${prompt.mode} takes a choice, got ${input.kind}`);
      const options = prompt.mode === 'which-view' ? prompt.options.map((o) => o.callout) : prompt.options;
      if (!options.some((c) => c.id === input.calloutId)) throw new Error(`${input.calloutId} was not one of the options`);
      return resultFor(prompt, ctx, input.calloutId, input.calloutId === prompt.target.id);
    }
    case 'name-typed': {
      if (input.kind !== 'typed') throw new Error(`name-typed takes typed text, got ${input.kind}`);
      const graded = gradeTyped(input.text, prompt.target, ctx.entries);
      return resultFor(prompt, ctx, graded.chosen, graded.correct, { fuzzy: graded.fuzzy });
    }
    case 'pin':
    case 'where-am-i': {
      if (input.kind !== 'point') throw new Error(`${prompt.mode} takes a point, got ${input.kind}`);
      const guess: Point = [input.x, input.y];
      const regions = ctx.callouts.filter((c) => c.level === input.level).map((c) => ({ id: c.id, polygon: c.region, callout: c }));
      const hit = smallestRegionAt(guess, regions)?.callout ?? null;
      // A click inside a Hard spot is a click on the callout around it.
      const correct = hit !== null && (hit.id === prompt.target.id || hit.parent === prompt.target.id);
      return resultFor(prompt, ctx, correct ? prompt.target.id : (hit?.id ?? null), correct, { guess });
    }
  }
}

export interface AnswerFacts {
  prompt: Prompt;
  result: Result;
  latencyMs: number;
  hintUsed: boolean;
  ts: number;
  id: string;
  /** The item has never been answered before. */
  firstAnswer: boolean;
}

/** The log event for an answer, with the rating inferred (SCOPE §4.4). */
export function answerEventFor(f: AnswerFacts): AnswerEvent {
  const latencyMs = Math.max(0, Math.round(f.latencyMs));
  return {
    kind: 'answer',
    id: f.id,
    ts: f.ts,
    callout: f.prompt.target.id,
    mode: f.prompt.mode,
    correct: f.result.correct,
    latencyMs,
    hint: f.hintUsed,
    rating: inferRating({ mode: f.prompt.mode, correct: f.result.correct, hint: f.hintUsed, latencyMs, firstAnswer: f.firstAnswer }),
    // The log records what was picked when it was wrong; a right answer is its own target.
    chosen: f.result.correct ? null : f.result.chosen,
  };
}

/** The matching table for typed answers over a set of callouts. */
export function entriesFor(callouts: readonly Callout[]): NameEntry[] {
  return nameEntries(callouts);
}

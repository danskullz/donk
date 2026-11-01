// Contrast cards (SCOPE.md §4.6): when two callouts have been mixed up at least twice, the next session shows them
// side by side and then asks a Which view? question for the pair. This file decides which pair, if any, and keeps the
// rule that a pair is not shown again within a week.
//
// "Shown" is not a learning event, so it is not in the review log (adding an event kind would break every reader of
// the log, the importer included). The app keeps it beside the log as a small record, and passes it in here.

import { confusedPairs, type Derived } from './log';
import type { Callout } from './schema';
import { DAY_MS } from './types';

/** A pair is mixed up this many times (either way round) before it earns a card. */
export const CONTRAST_MIN_CONFUSIONS = 2;
/** The same pair gets a card at most once in this time. */
export const CONTRAST_REPEAT_MS = 7 * DAY_MS;

/** When a pair's card was last shown, and how many times the pair had been mixed up by then. */
export interface ContrastSeen {
  at: number;
  count: number;
}

/** The same key for (a, b) and (b, a). */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export interface ContrastPick {
  /** The callout that gets mistaken for the other more often: the Which view? question asks for this one. */
  target: Callout;
  other: Callout;
  /** Times the two have been mixed up, either way round. */
  count: number;
}

export interface ContrastInput {
  /** The callouts this session may teach and ask about (already narrowed to its map and zone). */
  playable: readonly Callout[];
  derived: Pick<Derived, 'confusions'>;
  seen: ReadonlyMap<string, ContrastSeen>;
  now: number;
}

/**
 * The one pair to show this session: the worst pair that has both pictures to show, is not a Hard spot against the
 * callout it sits in (those are not rivals), and has not had a card within a week. After a card, the pair comes back
 * only when it has been mixed up again since: a pair the learner has sorted out is not shown for ever.
 */
export function pickContrast(input: ContrastInput): ContrastPick | null {
  const byId = new Map(input.playable.map((c) => [c.id, c]));
  for (const pair of confusedPairs(input.derived, CONTRAST_MIN_CONFUSIONS)) {
    const a = byId.get(pair.a);
    const b = byId.get(pair.b);
    if (!a || !b || a.shots.length === 0 || b.shots.length === 0) continue;
    if (a.parent === b.id || b.parent === a.id) continue;
    const last = input.seen.get(pairKey(a.id, b.id));
    if (last && (input.now - last.at < CONTRAST_REPEAT_MS || pair.count <= last.count)) continue;
    const aForB = input.derived.confusions.get(`${a.id}>${b.id}`) ?? 0;
    const bForA = input.derived.confusions.get(`${b.id}>${a.id}`) ?? 0;
    return bForA > aForB ? { target: b, other: a, count: pair.count } : { target: a, other: b, count: pair.count };
  }
  return null;
}

/** Read the stored record. Anything unreadable is the same as nothing stored: a card may then show once more. */
export function parseContrastSeen(raw: string | null | undefined): Map<string, ContrastSeen> {
  const out = new Map<string, ContrastSeen>();
  if (!raw) return out;
  try {
    const data: unknown = JSON.parse(raw);
    if (typeof data !== 'object' || data === null) return out;
    for (const [key, value] of Object.entries(data)) {
      const v = value as Partial<ContrastSeen> | null;
      if (v && Number.isFinite(v.at) && Number.isFinite(v.count)) out.set(key, { at: v.at as number, count: v.count as number });
    }
  } catch {
    // damaged: start again
  }
  return out;
}

export function serialiseContrastSeen(seen: ReadonlyMap<string, ContrastSeen>): string {
  return JSON.stringify(Object.fromEntries(seen));
}

// Multiple-choice options (SCOPE.md §4.6): plausible and informative, so favour spatial neighbours and pairs
// the learner has already confused. Used by Name it, Read the map and Which view?.

import { confusionCount, type Derived } from './log';
import type { Rng } from './rng';
import { shuffle } from './rng';
import type { Callout } from './schema';

export interface OptionContext {
  target: Callout;
  /** Callouts that may appear as options: the playable ones of the same map. */
  candidates: readonly Callout[];
  /** Callouts the learner has met. Unmet names are used only when there are too few others. */
  introduced: ReadonlySet<string>;
  confusions: Pick<Derived, 'confusions'>;
  /** Options shown, the right one included: 3 on a first question for a beginner (SCOPE §4.11), else 4. */
  count: 3 | 4;
  rng: Rng;
  /** A callout that must be among the options when it can be: the other half of a contrast card's pair. */
  include?: string | undefined;
}

function related(a: Callout, b: Callout): boolean {
  // A Hard spot and the callout it sits in are not rivals: either answer describes the place.
  return a.parent === b.id || b.parent === a.id;
}

function score(c: Callout, ctx: OptionContext): number {
  const t = ctx.target;
  let s = 0;
  if (t.neighbours.includes(c.id) || c.neighbours.includes(t.id)) s += 3;
  s += 2 * Math.min(3, confusionCount(ctx.confusions, t.id, c.id));
  if (c.zone === t.zone) s += 1.5;
  if (c.level === t.level) s += 0.5;
  if (c.tier === t.tier) s += 0.5;
  return s + ctx.rng() * 0.9; // jitter, so the same neighbours do not appear every time
}

/** The target plus `count - 1` distractors, in random order. Fewer options only if the map is that small. */
export function pickOptions(ctx: OptionContext): Callout[] {
  const need = ctx.count - 1;
  const pool = ctx.candidates.filter((c) => c.id !== ctx.target.id && !related(c, ctx.target));
  const met = pool.filter((c) => ctx.introduced.has(c.id));
  const byScore = (list: readonly Callout[]) =>
    list
      .map((c) => ({ c, s: score(c, ctx) }))
      .sort((a, b) => b.s - a.s || (a.c.id < b.c.id ? -1 : 1))
      .map((x) => x.c);
  const forced = pool.find((c) => c.id === ctx.include);
  const chosen = forced ? [forced] : [];
  chosen.push(...byScore(met.filter((c) => c !== forced)).slice(0, need - chosen.length));
  if (chosen.length < need) {
    const taken = new Set(chosen.map((c) => c.id));
    chosen.push(...byScore(pool.filter((c) => !taken.has(c.id))).slice(0, need - chosen.length));
  }
  return shuffle([ctx.target, ...chosen], ctx.rng);
}

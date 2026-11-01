// Typed answers (SCOPE §4.7): case-, punctuation- and space-insensitive, alias-aware, with a one-edit
// typo allowance. Two edits is wrong. Also the type-to-find suggestions (SCOPE §5.3 rule 3).

export interface Nameable {
  id: string;
  name: string;
  aliases: readonly string[];
}

/** Lowercase, accents and punctuation removed, words kept apart by single spaces. */
export function normalise(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** The form answers are compared in: "Top Mid", "top-mid" and "topmid" are the same answer. */
export function compact(text: string): string {
  return normalise(text).replace(/ /g, '');
}

/** Damerau-Levenshtein, optimal string alignment variant: insert, delete, substitute, swap two neighbours. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const n = a.length;
  const m = b.length;
  if (n === 0) return m;
  if (m === 0) return n;
  let prev2: number[] = new Array<number>(m + 1).fill(0);
  let prev: number[] = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i++) {
    const cur: number[] = new Array<number>(m + 1).fill(0);
    cur[0] = i;
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min((prev[j] as number) + 1, (cur[j - 1] as number) + 1, (prev[j - 1] as number) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, (prev2[j - 2] as number) + 1);
      }
      cur[j] = v;
    }
    prev2 = prev;
    prev = cur;
  }
  return prev[m] as number;
}

/** Typos are forgiven from four characters up, by one edit. Short names ("T", "CT", "Pal") must be exact. */
export function toleranceFor(length: number): number {
  return length >= 4 ? 1 : 0;
}

export interface NameEntry {
  calloutId: string;
  /** What the learner sees and can type: the name or one alias. */
  text: string;
  isName: boolean;
  key: string;
}

export function nameEntries(callouts: readonly Nameable[]): NameEntry[] {
  const out: NameEntry[] = [];
  for (const c of callouts) {
    out.push({ calloutId: c.id, text: c.name, isName: true, key: compact(c.name) });
    for (const alias of c.aliases) out.push({ calloutId: c.id, text: alias, isName: false, key: compact(alias) });
  }
  return out;
}

export type TypedMatch =
  | { outcome: 'exact'; calloutId: string; text: string }
  | { outcome: 'fuzzy'; calloutId: string; text: string; distance: number }
  | { outcome: 'none'; ambiguous: boolean };

/** Works out which callout the learner meant, if any. */
export function matchTyped(input: string, entries: readonly NameEntry[]): TypedMatch {
  const key = compact(input);
  if (key === '') return { outcome: 'none', ambiguous: false };
  const exact = entries.find((e) => e.key === key);
  if (exact) return { outcome: 'exact', calloutId: exact.calloutId, text: exact.text };

  let best = Infinity;
  const near: NameEntry[] = [];
  for (const e of entries) {
    if (Math.abs(e.key.length - key.length) > 1) continue;
    const d = editDistance(key, e.key);
    if (d > toleranceFor(Math.min(e.key.length, key.length))) continue;
    if (d < best) {
      best = d;
      near.length = 0;
    }
    if (d === best) near.push(e);
  }
  const first = near[0];
  if (!first) return { outcome: 'none', ambiguous: false };
  if (near.some((e) => e.calloutId !== first.calloutId)) return { outcome: 'none', ambiguous: true };
  return { outcome: 'fuzzy', calloutId: first.calloutId, text: first.text, distance: best };
}

export interface TypedGrade {
  correct: boolean;
  /** Right, but with a typo: show the correct spelling, no penalty (SCOPE §4.7). */
  fuzzy: boolean;
  /** The callout the learner meant, whether or not it was the target. Null when nothing matched. */
  chosen: string | null;
  /** The target's own spelling to show after a fuzzy accept or a miss. */
  spelling: string;
}

export function gradeTyped(input: string, target: Nameable, entries: readonly NameEntry[]): TypedGrade {
  const m = matchTyped(input, entries);
  if (m.outcome === 'none') return { correct: false, fuzzy: false, chosen: null, spelling: target.name };
  return {
    correct: m.calloutId === target.id,
    fuzzy: m.outcome === 'fuzzy' && m.calloutId === target.id,
    chosen: m.calloutId,
    spelling: target.name,
  };
}

export interface Suggestion {
  calloutId: string;
  text: string;
}

/**
 * At most `max` names to offer while the learner types or finds a callout. Prefix matches first, then
 * word-prefix, then substring, then one-typo matches. One row per callout.
 */
export function suggest(input: string, entries: readonly NameEntry[], max = 5): Suggestion[] {
  const key = compact(input);
  const spaced = normalise(input);
  if (key === '') return [];
  const scored = new Map<string, { score: number; entry: NameEntry }>();
  for (const e of entries) {
    const words = normalise(e.text).split(' ');
    let score = Infinity;
    if (e.key.startsWith(key)) score = 0;
    else if (words.some((w) => w.startsWith(spaced))) score = 1;
    else if (e.key.includes(key)) score = 2;
    else if (key.length >= 4 && editDistance(key, e.key.slice(0, key.length)) <= 1) score = 3;
    if (score === Infinity) continue;
    const prior = scored.get(e.calloutId);
    if (!prior || score < prior.score || (score === prior.score && e.isName && !prior.entry.isName)) {
      scored.set(e.calloutId, { score, entry: e });
    }
  }
  return [...scored.values()]
    .sort((a, b) => a.score - b.score || a.entry.text.length - b.entry.text.length || a.entry.text.localeCompare(b.entry.text))
    .slice(0, max)
    .map(({ entry }) => ({ calloutId: entry.calloutId, text: entry.text }));
}

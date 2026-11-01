// The session builder (SCOPE.md §4.3, §4.4, §4.11, §7.6): a pure function from the learner's state to an
// ordered list of cards. No clock, no randomness of its own: both are passed in, so tests are exact.
//
// What it enforces:
//  - Due reviews come first in priority, lowest recall probability first.
//  - New-item throttle: no new callouts and no newly unlocked modes while more than 60 reviews are due.
//  - New items are at most 30 % of the session's quiz cards (at least one, unless throttled).
//  - Intros: up to 4 callouts, one zone or route segment at a time, Core before Standard before Hard,
//    each followed by an immediate quiz.
//  - A safety cap of 120 answers per day.
//  - Items of one callout are spaced apart; they would otherwise give each other away.
//  - One contrast card at most (SCOPE §4.6): the worst mixed-up pair, side by side, then a Which view? question for it.
//  - Early practice (`earlyPractice`): when nothing is due, the items closest to being due, and nothing new.

import { pickContrast, type ContrastSeen } from './contrast';
import { applicableModes, unlockedModes } from './mastery';
import type { Derived } from './log';
import { shuffle, type Rng } from './rng';
import type { Scheduler } from './scheduler';
import type { Callout } from './schema';
import { CHOICE_MODES, itemKey, MODES, type ItemKey, type Mode } from './types';

/** "Until I stop" in Settings: no card limit of its own, so the daily cap and the learner decide when it ends. */
export const UNLIMITED_CARDS = 1000;

export interface SessionSettings {
  /** Quiz cards per session; intro cards are not counted. 20 is the "20 cards" option. */
  maxCards: number;
  /** A time limit: once it has passed, the session ends after the card on screen. Null for none. Read by the runner. */
  maxMinutes: number | null;
  /** Callouts introduced per session (SCOPE §4.3). */
  newPerSession: number;
  maxNewShare: number;
  dueThrottle: number;
  dailyReviewCap: number;
  hardMode: boolean;
  /** Draft callouts are for development; Dan's in-game review turns them `verified`. */
  includeDraft: boolean;
  enabledModes: readonly Mode[];
  /** Three options instead of four on an item's first multiple-choice question (SCOPE §4.11). */
  gentleStart: boolean;
}

export const DEFAULT_SESSION_SETTINGS: SessionSettings = {
  maxCards: 20,
  maxMinutes: null,
  newPerSession: 4,
  maxNewShare: 0.3,
  dueThrottle: 60,
  dailyReviewCap: 120,
  hardMode: false,
  includeDraft: false,
  enabledModes: MODES,
  gentleStart: true,
};

/** The preferences that shape a session, as the Settings screen stores them (app/settings.ts has more besides). */
export interface SessionPrefs {
  /** Null means "until I stop". */
  sessionCards: number | null;
  sessionMinutes: number | null;
  newPerSession: number;
  gentleStart: boolean;
}

/** Session settings from the learner's preferences. Hard mode and the draft switch depend on the map, so they come apart. */
export function sessionSettingsFrom(prefs: SessionPrefs, map: { hardMode: boolean; includeDraft: boolean }): SessionSettings {
  return {
    ...DEFAULT_SESSION_SETTINGS,
    maxCards: prefs.sessionCards ?? UNLIMITED_CARDS,
    maxMinutes: prefs.sessionMinutes,
    newPerSession: prefs.newPerSession,
    gentleStart: prefs.gentleStart,
    hardMode: map.hardMode,
    includeDraft: map.includeDraft,
  };
}

export interface QuizCard {
  type: 'quiz';
  calloutId: string;
  mode: Mode;
  key: ItemKey;
  /** Why it is here: the quiz right after an intro, a due review, a newly unlocked mode, the question after a contrast card, or early practice. */
  reason: 'intro-quiz' | 'due' | 'new-mode' | 'contrast' | 'early';
  /** Number of choices for a multiple-choice mode (Speed call included), null for the others. */
  options: 3 | 4 | null;
  /** On the question after a contrast card: the other callout of the pair, which is always among the options. */
  partner?: string | undefined;
}

/** Two callouts the learner mixes up, shown side by side with nothing to judge: the card before its question. */
export interface ContrastCard {
  type: 'contrast';
  /** The callout the question asks for. */
  calloutId: string;
  otherId: string;
  /** Times the pair has been mixed up. */
  confusions: number;
}

export type SessionCard = { type: 'intro'; calloutId: string } | ContrastCard | QuizCard;

export interface SessionPlan {
  cards: SessionCard[];
  /** Reviews due across everything the learner has started, the number the throttle looks at. */
  dueCount: number;
  throttled: boolean;
  introduced: string[];
  /** Why the list is empty or short: 'nothing-due', 'daily-cap', or null. */
  note: 'nothing-due' | 'daily-cap' | null;
  /** Built with `earlyPractice`: items that were not due yet. The summary says so. */
  earlyPractice?: boolean;
}

/** How many choices a card of this mode offers: three on a gentle first question, Speed call always four. */
function optionsFor(mode: Mode, gentle: boolean): 3 | 4 | null {
  if (mode === 'speed') return 4;
  return CHOICE_MODES.includes(mode) ? (gentle ? 3 : 4) : null;
}

export interface SessionInput {
  callouts: readonly Callout[];
  derived: Derived;
  scheduler: Scheduler;
  settings: SessionSettings;
  /** Zone ids in route order (the map's `zones`). Unlisted zones sort last. */
  zoneOrder: readonly string[];
  /** Restrict what is taught and asked to one map, and within it to one zone. The throttle still looks at everything. */
  map?: string | undefined;
  zone?: string | undefined;
  /** Answers already given today, for the daily cap. */
  answersToday: number;
  now: Date;
  rng: Rng;
  /** "Practise anyway": only reviews, the items closest to being due, no new callouts and no new modes. */
  earlyPractice?: boolean | undefined;
  /** When each pair's contrast card was last shown (key from `pairKey`). Absent means none ever was. */
  contrastSeen?: ReadonlyMap<string, ContrastSeen> | undefined;
}

/** Callouts that may be taught and asked: verified (or draft in development), not stale, Hard only in Hard mode. */
export function playableCallouts(callouts: readonly Callout[], settings: Pick<SessionSettings, 'hardMode' | 'includeDraft'>): Callout[] {
  const ok = (c: Callout) => c.status === 'verified' || (c.status === 'draft' && settings.includeDraft);
  const byId = new Map(callouts.map((c) => [c.id, c]));
  return callouts.filter((c) => {
    if (!ok(c)) return false;
    if (c.tier === 3) {
      if (!settings.hardMode) return false;
      const parent = c.parent ? byId.get(c.parent) : undefined;
      return parent !== undefined && ok(parent);
    }
    return true;
  });
}

function introOrder(a: Callout, b: Callout, zoneIndex: (z: string) => number): number {
  return a.tier - b.tier || zoneIndex(a.zone) - zoneIndex(b.zone) || (a.order ?? 9999) - (b.order ?? 9999) || (a.id < b.id ? -1 : 1);
}

/** The next callouts to teach: the lowest tier still unintroduced, one zone at a time, in route order. */
function pickIntros(playable: readonly Callout[], derived: Derived, count: number, zoneOrder: readonly string[]): Callout[] {
  if (count <= 0) return [];
  const zoneIndex = (z: string) => {
    const i = zoneOrder.indexOf(z);
    return i < 0 ? zoneOrder.length : i;
  };
  const fresh = playable
    .filter((c) => !derived.introduced.has(c.id))
    // A Hard spot is taught relative to its parent, so the parent must already be known.
    .filter((c) => c.tier !== 3 || (c.parent !== null && derived.introduced.has(c.parent)))
    .sort((a, b) => introOrder(a, b, zoneIndex));
  const first = fresh[0];
  if (!first) return [];
  const tier = first.tier;
  const sameTier = fresh.filter((c) => c.tier === tier);
  const inZone = sameTier.filter((c) => c.zone === first.zone);
  const out = inZone.slice(0, count);
  if (out.length < count) out.push(...sameTier.filter((c) => c.zone !== first.zone).slice(0, count - out.length));
  return out;
}

/** Keep cards of one callout at least `gap` places apart where the list allows it; otherwise keep priority order. */
export function spaceOut<T extends { calloutId: string }>(cards: readonly T[], gap = 3): T[] {
  const rest = cards.slice();
  const out: T[] = [];
  while (rest.length) {
    const recent = new Set(out.slice(-gap).map((c) => c.calloutId));
    let i = rest.findIndex((c) => !recent.has(c.calloutId));
    if (i < 0) i = 0;
    out.push(rest.splice(i, 1)[0] as T);
  }
  return out;
}

/** Insert `extra` evenly through `base`, keeping each list's own order. */
function spread<T>(base: readonly T[], extra: readonly T[]): T[] {
  if (extra.length === 0) return base.slice();
  const out = base.slice();
  const step = (out.length + extra.length) / (extra.length + 1);
  extra.forEach((x, i) => out.splice(Math.min(out.length, Math.round(step * (i + 1)) - 1), 0, x));
  return out;
}

export function buildSession(input: SessionInput): SessionPlan {
  const { derived, scheduler, settings, now } = input;
  const everything = playableCallouts(input.callouts, settings);
  const playable = everything.filter((c) => (!input.map || c.map === input.map) && (!input.zone || c.zone === input.zone));
  const playableIds = new Set(playable.map((c) => c.id));

  // The throttle looks at the whole backlog the learner could be asked, not just this scope.
  const startedIds = new Set(everything.map((c) => c.id));
  let dueCount = 0;
  for (const item of derived.items.values()) {
    if (item.answers > 0 && startedIds.has(item.calloutId) && settings.enabledModes.includes(item.mode) && scheduler.dueAt(item.memory).getTime() <= now.getTime()) {
      dueCount += 1;
    }
  }
  const throttled = dueCount > settings.dueThrottle;

  const room = Math.max(0, Math.min(settings.maxCards, settings.dailyReviewCap - input.answersToday));
  if (room === 0) return { cards: [], dueCount, throttled, introduced: [], note: 'daily-cap' };

  // Every item the learner has started in this scope, with the chance they would remember it now.
  const byId = new Map(playable.map((c) => [c.id, c]));
  const started: { card: QuizCard; r: number; due: boolean }[] = [];
  for (const item of derived.items.values()) {
    if (item.answers === 0 || !playableIds.has(item.calloutId) || !settings.enabledModes.includes(item.mode)) continue;
    const callout = byId.get(item.calloutId);
    if (!callout || !applicableModes(callout, settings.enabledModes).includes(item.mode)) continue;
    const due = scheduler.dueAt(item.memory).getTime() <= now.getTime();
    started.push({
      card: { type: 'quiz', calloutId: item.calloutId, mode: item.mode, key: item.key, reason: due ? 'due' : 'early', options: optionsFor(item.mode, false) },
      r: scheduler.retrievability(item.memory, now),
      due,
    });
  }
  const mostAtRisk = (a: { card: QuizCard; r: number }, b: { card: QuizCard; r: number }) => a.r - b.r || (a.card.key < b.card.key ? -1 : 1);

  if (input.earlyPractice) {
    // Nothing new and no contrast card: this is only about keeping what is known warm, the least remembered first.
    const cards = spaceOut(started.slice().sort(mostAtRisk).slice(0, room).map((x) => ({ ...x.card, reason: 'early' as const })));
    return { cards, dueCount, throttled, introduced: [], note: cards.length === 0 ? 'nothing-due' : null, earlyPractice: true };
  }

  const newCap = throttled ? 0 : Math.max(1, Math.floor(settings.maxNewShare * room));

  // New callouts: each costs one intro card and one immediate quiz, and one place in the new-item cap.
  const intros = pickIntros(playable, derived, Math.min(settings.newPerSession, newCap), input.zoneOrder);
  const introIds = new Set(intros.map((c) => c.id));

  // One contrast card for the worst mixed-up pair, then a Which view? question for it. It is a lesson on an error, not
  // new material, so the throttle does not hold it back; it needs room for its question beside the intro quizzes.
  const contrast = room >= 2 && settings.enabledModes.includes('which-view') ? pickContrast({ playable, derived, seen: input.contrastSeen ?? new Map(), now: now.getTime() }) : null;
  const contrastKey = contrast ? itemKey(contrast.target.id, 'which-view') : null;
  const contrastCards: SessionCard[] = contrast
    ? [
        { type: 'contrast', calloutId: contrast.target.id, otherId: contrast.other.id, confusions: contrast.count },
        { type: 'quiz', calloutId: contrast.target.id, mode: 'which-view', key: itemKey(contrast.target.id, 'which-view'), reason: 'contrast', options: 4, partner: contrast.other.id },
      ]
    : [];

  // Newly unlocked modes of callouts already met, oldest first: unlocked, but never asked.
  const newModes: QuizCard[] = [];
  const met = playable.filter((c) => derived.introduced.has(c.id) && !introIds.has(c.id)).sort((a, b) => (derived.introduced.get(a.id) as number) - (derived.introduced.get(b.id) as number));
  for (const c of met) {
    const enabled = applicableModes(c, settings.enabledModes);
    for (const mode of unlockedModes(c.id, derived, scheduler, enabled)) {
      const key = itemKey(c.id, mode);
      if (derived.items.has(key) || key === contrastKey) continue;
      newModes.push({ type: 'quiz', calloutId: c.id, mode, key, reason: 'new-mode', options: optionsFor(mode, settings.gentleStart) });
    }
  }
  const takenNew = newModes.slice(0, Math.max(0, newCap - intros.length));

  // Due reviews, most at risk first. The contrast question is that item's review, so it is not asked a second time.
  const due = started.filter((x) => x.due && x.card.key !== contrastKey).sort(mostAtRisk);

  const introQuizzes: QuizCard[] = shuffle(intros, input.rng).map((c) => ({
    type: 'quiz',
    calloutId: c.id,
    mode: 'name-mc',
    key: itemKey(c.id, 'name-mc'),
    reason: 'intro-quiz',
    options: settings.gentleStart ? 3 : 4,
  }));

  const reviewRoom = Math.max(0, room - introQuizzes.length - takenNew.length - (contrast ? 1 : 0));
  const reviews = due.slice(0, reviewRoom).map((d) => d.card);
  const body = spaceOut(spread(reviews, takenNew));

  const cards: SessionCard[] = [...contrastCards, ...intros.map((c): SessionCard => ({ type: 'intro', calloutId: c.id })), ...introQuizzes, ...body];
  const note = cards.length === 0 ? 'nothing-due' : null;
  return { cards, dueCount, throttled, introduced: intros.map((c) => c.id), note };
}

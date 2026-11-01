// The session runner: walks a planned session card by card (SCOPE.md §4.3). It is a plain state machine, so
// the Session screen only draws `view` and forwards keys and clicks, and a whole session is testable with a
// fake clock. Every answer is logged and folded into the derived state at once ("never lose work", §5.4).
//
//   intro / contrast ──continue──► (next card)
//   question ──answer / skip──► reveal ──continue──► (next card)
//   (no more cards, the time limit after a card, or leave) ──► done
//
// A Speed call question starts `flashing`: the picture is up and nothing can be answered but "I don't know". The
// screen calls `flashEnded()` once the picture has hidden, which is also when the answer clock starts.

import { confusionCount, applyEvent, type Derived, type ReviewEvent } from './log';
import { applicableModes, masteryOf } from './mastery';
import type { NameEntry } from './match';
import { answerEventFor, entriesFor, gradeAnswer, makePrompt, type AnswerInput, type Hint, type Prompt, type Result } from './quiz';
import type { Rng } from './rng';
import type { Scheduler } from './scheduler';
import type { Callout, MapRecord } from './schema';
import type { QuizCard, SessionCard, SessionPlan, SessionSettings } from './session';
import { itemKey, type GradeValue, type Mastery, type Mode } from './types';

export interface RunnerInput {
  map: MapRecord;
  /** The playable callouts of the map: what questions and options may draw on. */
  callouts: readonly Callout[];
  /** Mutated as the session goes: this is the learner's live state. */
  derived: Derived;
  scheduler: Scheduler;
  settings: SessionSettings;
  plan: SessionPlan;
  rng: Rng;
  now: () => number;
  newId: () => string;
  /** Called with every event as it happens, for the store. */
  onEvent?: (event: ReviewEvent) => void;
  /** A contrast card was read and moved past: the app remembers it, so the pair is not shown again within a week. */
  onContrast?: (shown: { a: string; b: string; count: number; ts: number }) => void;
  /** Show Speed call pictures for exactly this long (tests and the `?flash=` hook). */
  flashMs?: number | undefined;
}

export interface Progress {
  /** Quiz cards answered so far. Intro and contrast cards do not count. */
  done: number;
  total: number;
}

export interface Outcome {
  rating: GradeValue;
  latencyMs: number;
  hintUsed: boolean;
  /** Times this wrong pair has now happened, counting this one. 0 when the answer was right or nothing was chosen. */
  confusions: number;
}

export interface SessionSummary {
  /** False when the learner left before the last card. A session that ran out of time still counts as finished. */
  finished: boolean;
  answered: number;
  correct: number;
  totalMs: number;
  /** The three slowest right answers. */
  slowest: { calloutId: string; mode: Mode; latencyMs: number }[];
  /** Wrong pairs from this session, with their running totals. */
  confusions: { target: string; chosen: string; count: number }[];
  introduced: string[];
  /** Callouts whose mastery state changed. */
  mastery: { calloutId: string; from: Mastery; to: Mastery }[];
  /** How it ended: the cards ran out, the time limit passed, or the learner left. */
  endedBy?: 'plan' | 'time' | 'left';
  /** The session was "Practise anyway": items that were not due yet. */
  earlyPractice?: boolean;
}

export type RunnerView =
  | { phase: 'intro'; callout: Callout; introIndex: number; introTotal: number; progress: Progress }
  | { phase: 'contrast'; a: Callout; b: Callout; confusions: number; progress: Progress }
  /** `flashing`: Speed call only, the picture is still showing. */
  | { phase: 'question'; prompt: Prompt; hint: Hint | null; flashing: boolean; progress: Progress }
  | { phase: 'reveal'; prompt: Prompt; result: Result; outcome: Outcome; progress: Progress }
  | { phase: 'done'; summary: SessionSummary; progress: Progress };

interface Answered {
  calloutId: string;
  mode: Mode;
  correct: boolean;
  latencyMs: number;
  chosen: string | null;
}

export class SessionRunner {
  private readonly cards: readonly SessionCard[];
  private readonly entries: NameEntry[];
  private readonly total: number;
  private readonly introTotal: number;
  private readonly before = new Map<string, Mastery>();
  private readonly answered: Answered[] = [];
  private readonly introduced: string[] = [];
  private readonly startedAt: number;
  private index = -1;
  private done = 0;
  private introSeen = 0;
  private shownAt = 0;
  private hintUsed = false;
  private pausedAt: number | null = null;
  /** Time the tab was hidden, for the session's own time limit. */
  private awayAt: number | null = null;
  private awayMs = 0;
  private current!: RunnerView;

  constructor(private readonly input: RunnerInput) {
    this.cards = input.plan.cards;
    this.entries = entriesFor(input.callouts);
    this.startedAt = input.now();
    this.total = this.cards.filter((c) => c.type === 'quiz').length;
    this.introTotal = this.cards.filter((c) => c.type === 'intro').length;
    const mentioned = new Set<string>();
    for (const card of this.cards) {
      mentioned.add(card.calloutId);
      if (card.type === 'contrast') mentioned.add(card.otherId);
    }
    for (const id of mentioned) this.before.set(id, this.masteryNow(id));
    this.advance();
  }

  get view(): RunnerView {
    return this.current;
  }

  /** The card after the current one, so the screen can load its picture before it is needed. */
  get upcoming(): SessionCard | undefined {
    return this.cards[this.index + 1];
  }

  private get progress(): Progress {
    return { done: this.done, total: this.total };
  }

  private masteryNow(calloutId: string): Mastery {
    const callout = this.input.callouts.find((c) => c.id === calloutId);
    const modes = callout ? applicableModes(callout, this.input.settings.enabledModes) : [];
    return masteryOf(calloutId, this.input.derived, this.input.scheduler, modes);
  }

  private emit(event: ReviewEvent): void {
    applyEvent(this.input.derived, event, this.input.scheduler);
    this.input.onEvent?.(event);
  }

  private calloutById(id: string): Callout {
    const callout = this.input.callouts.find((c) => c.id === id);
    if (!callout) throw new Error(`${id} is not playable here`);
    return callout;
  }

  /** The session's own clock, without the time the tab was hidden. */
  private get elapsedMs(): number {
    const now = this.input.now();
    return now - this.startedAt - this.awayMs - (this.awayAt === null ? 0 : now - this.awayAt);
  }

  private get timeIsUp(): boolean {
    const limit = this.input.settings.maxMinutes;
    return limit !== null && this.elapsedMs >= limit * 60_000;
  }

  private advance(): RunnerView {
    this.index += 1;
    const card: SessionCard | undefined = this.cards[this.index];
    if (!card) return this.finish(true, 'plan');
    if (card.type === 'intro') {
      this.current = { phase: 'intro', callout: this.calloutById(card.calloutId), introIndex: this.introSeen + 1, introTotal: this.introTotal, progress: this.progress };
      return this.current;
    }
    if (card.type === 'contrast') {
      this.current = { phase: 'contrast', a: this.calloutById(card.calloutId), b: this.calloutById(card.otherId), confusions: card.confusions, progress: this.progress };
      return this.current;
    }
    return this.ask(card);
  }

  private ask(card: QuizCard): RunnerView {
    const prompt = makePrompt(card, {
      callouts: this.input.callouts,
      derived: this.input.derived,
      levels: this.input.map.levels.map((l) => l.id),
      rng: this.input.rng,
      flashMs: this.input.flashMs,
    });
    this.hintUsed = false;
    this.pausedAt = null;
    this.shownAt = this.input.now();
    this.current = { phase: 'question', prompt, hint: null, flashing: prompt.mode === 'speed', progress: this.progress };
    return this.current;
  }

  /** Leave the intro card, the contrast card or the reveal. Does nothing on a question: those are answered, not skipped past. */
  continue(): RunnerView {
    const view = this.current;
    if (view.phase === 'intro') {
      const id = view.callout.id;
      this.emit({ kind: 'intro', id: this.input.newId(), ts: this.input.now(), callout: id });
      this.introduced.push(id);
      this.introSeen += 1;
      return this.advance();
    }
    if (view.phase === 'contrast') {
      this.input.onContrast?.({ a: view.a.id, b: view.b.id, count: view.confusions, ts: this.input.now() });
      return this.advance();
    }
    if (view.phase === 'reveal') {
      // The time limit ends the session after a card, never in the middle of one, and never between an intro or a
      // contrast card and the question that tests it.
      if (this.index + 1 < this.cards.length && this.timeIsUp) return this.finish(true, 'time');
      return this.advance();
    }
    return view;
  }

  /** The tab was hidden: time away from a question does not count against the answer. */
  pause(): void {
    const now = this.input.now();
    this.awayAt ??= now;
    if (this.current.phase === 'question' && this.pausedAt === null) this.pausedAt = now;
  }

  resume(): void {
    const now = this.input.now();
    if (this.awayAt !== null) {
      this.awayMs += now - this.awayAt;
      this.awayAt = null;
    }
    if (this.pausedAt === null) return;
    this.shownAt += now - this.pausedAt;
    this.pausedAt = null;
  }

  /**
   * Speed call: the picture has been on screen for its whole time and is gone. From now on the question can be
   * answered, and this is where the answer is timed from.
   */
  flashEnded(): RunnerView {
    const view = this.current;
    if (view.phase !== 'question' || !view.flashing) return view;
    const now = this.input.now();
    this.shownAt = now;
    if (this.pausedAt !== null) this.pausedAt = now;
    this.current = { ...view, flashing: false };
    return this.current;
  }

  /** One tap of help. It is remembered for the rating and shown by the screen. Not while a Speed call picture is up. */
  hint(): RunnerView {
    const view = this.current;
    if (view.phase !== 'question' || view.flashing) return view;
    this.hintUsed = true;
    this.current = { ...view, hint: view.prompt.hint };
    return this.current;
  }

  answer(input: AnswerInput): RunnerView {
    const view = this.current;
    if (view.phase !== 'question') return view;
    // While the picture is up there is nothing to choose from yet; "I don't know" is still allowed.
    if (view.flashing && input.kind !== 'skip') return view;
    const { prompt } = view;
    this.resume();
    const latencyMs = Math.max(0, this.input.now() - this.shownAt);
    const result = gradeAnswer(prompt, input, { callouts: this.input.callouts, entries: this.entries });
    const key = itemKey(prompt.target.id, prompt.mode);
    const firstAnswer = (this.input.derived.items.get(key)?.answers ?? 0) === 0;
    const event = answerEventFor({ prompt, result, latencyMs, hintUsed: this.hintUsed, ts: this.input.now(), id: this.input.newId(), firstAnswer });
    this.emit(event);
    this.done += 1;
    this.answered.push({ calloutId: prompt.target.id, mode: prompt.mode, correct: result.correct, latencyMs: event.latencyMs, chosen: event.chosen });
    const confusions = !result.correct && event.chosen ? confusionCount(this.input.derived, prompt.target.id, event.chosen) : 0;
    this.current = { phase: 'reveal', prompt, result, outcome: { rating: event.rating, latencyMs: event.latencyMs, hintUsed: this.hintUsed, confusions }, progress: this.progress };
    return this.current;
  }

  /** "I don't know": logged as a wrong answer with nothing chosen. */
  skip(): RunnerView {
    return this.answer({ kind: 'skip' });
  }

  /** End the session now. Everything answered so far is already saved. */
  leave(): RunnerView {
    return this.current.phase === 'done' ? this.current : this.finish(false, 'left');
  }

  private finish(finished: boolean, endedBy: NonNullable<SessionSummary['endedBy']>): RunnerView {
    const correct = this.answered.filter((a) => a.correct);
    const pairs = new Map<string, { target: string; chosen: string }>();
    for (const a of this.answered) if (!a.correct && a.chosen) pairs.set(`${a.calloutId}>${a.chosen}`, { target: a.calloutId, chosen: a.chosen });
    const mastery: SessionSummary['mastery'] = [];
    for (const [calloutId, from] of this.before) {
      const to = this.masteryNow(calloutId);
      if (to !== from) mastery.push({ calloutId, from, to });
    }
    const summary: SessionSummary = {
      finished,
      answered: this.answered.length,
      correct: correct.length,
      totalMs: this.answered.reduce((sum, a) => sum + a.latencyMs, 0),
      slowest: correct
        .slice()
        .sort((a, b) => b.latencyMs - a.latencyMs)
        .slice(0, 3)
        .map(({ calloutId, mode, latencyMs }) => ({ calloutId, mode, latencyMs })),
      confusions: [...pairs.values()].map((p) => ({ ...p, count: confusionCount(this.input.derived, p.target, p.chosen) })).sort((a, b) => b.count - a.count),
      introduced: this.introduced.slice(),
      mastery,
      endedBy,
      earlyPractice: this.input.plan.earlyPractice === true,
    };
    this.current = { phase: 'done', summary, progress: this.progress };
    return this.current;
  }
}

/** Every callout the summary mentions, once: what a screen needs names for. */
export function summaryCalloutIds(summary: SessionSummary): string[] {
  const ids = new Set<string>(summary.introduced);
  for (const s of summary.slowest) ids.add(s.calloutId);
  for (const c of summary.confusions) {
    ids.add(c.target);
    ids.add(c.chosen);
  }
  for (const m of summary.mastery) ids.add(m.calloutId);
  return [...ids];
}

/** Midnight at the start of the day `ms` falls on, in the learner's own time zone: where the daily cap resets. */
export function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

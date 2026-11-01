// What the Progress, Summary and Study screens show, as plain data (SCOPE.md §4.5, §5.1): events in, numbers out.
// Nothing here reads a clock, the browser's time zone settings or storage; the screens pass `now` in, so the results
// are exact in tests. Days and weeks are the learner's own (local time), because "I practised today" means their today.

import { confusedPairs, type AnswerEvent, type ConfusionPair, type Derived, type ReviewEvent } from './log';
import { applicableModes, masteryOf } from './mastery';
import type { Scheduler } from './scheduler';
import type { Callout } from './schema';
import { DEFAULT_SESSION_SETTINGS } from './session';
import type { Mastery, Mode } from './types';

// ---- days and weeks --------------------------------------------------------------------------------------------

/** Midnight at the start of the day `ms` falls on, local time. */
export function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** The midnight `n` calendar days after (or before) the one at `dayStart`. Uses the calendar, so a 23 or 25 hour day is still one day. */
export function addDays(dayStart: number, n: number): number {
  const d = new Date(dayStart);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `2026-11-02`, local. */
export function dateKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** First day of the week containing `ms`. `weekStartsOn` is 0 for Sunday, 1 for Monday. */
export function startOfWeek(ms: number, weekStartsOn: 0 | 1 = 1): number {
  const day = startOfDay(ms);
  const back = (new Date(day).getDay() - weekStartsOn + 7) % 7;
  return addDays(day, -back);
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] as const;

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

export function answersOf(events: readonly ReviewEvent[]): AnswerEvent[] {
  return events.filter((e): e is AnswerEvent => e.kind === 'answer');
}

// ---- answers per day and the heat-grid --------------------------------------------------------------------------

export interface DayCount {
  /** Local midnight of the day. */
  day: number;
  date: string;
  answers: number;
  correct: number;
}

/** One entry per day that has answers, oldest first. Intro events are not answers and are left out. */
export function answersPerDay(events: readonly ReviewEvent[]): DayCount[] {
  const byDay = new Map<number, DayCount>();
  for (const e of answersOf(events)) {
    const day = startOfDay(e.ts);
    let entry = byDay.get(day);
    if (!entry) {
      entry = { day, date: dateKey(day), answers: 0, correct: 0 };
      byDay.set(day, entry);
    }
    entry.answers += 1;
    if (e.correct) entry.correct += 1;
  }
  return [...byDay.values()].sort((a, b) => a.day - b.day);
}

export interface HeatCell {
  date: string;
  day: number;
  /** Column, 0 for the oldest week. */
  week: number;
  /** Row, 0 for the first day of the week. */
  weekday: number;
  answers: number;
  /** 0 for none, then 1 to 4 relative to the busiest day in view. */
  level: 0 | 1 | 2 | 3 | 4;
}

export interface HeatGrid {
  weeks: number;
  /** Days up to and including today. Days after today are not cells. */
  cells: HeatCell[];
  /** Answers on the busiest day in view. */
  max: number;
  /** Answers in view. */
  total: number;
  activeDays: number;
  /** Where a month starts, for the labels above the columns. */
  months: { week: number; label: string }[];
}

/** The heat level of a day: 0 for none, otherwise 1 to 4 in proportion to the busiest day. */
export function heatLevel(answers: number, max: number): HeatCell['level'] {
  if (answers <= 0 || max <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((4 * answers) / max))) as HeatCell['level'];
}

/**
 * A calendar-style grid of answers per day: `weeks` columns ending with the week that contains `now`, one row per
 * weekday. The columns are placed by week and weekday, not by order, so a screen can draw it with a plain CSS grid.
 */
export function heatGrid(events: readonly ReviewEvent[], now: number, weeks = 26, weekStartsOn: 0 | 1 = 1): HeatGrid {
  const today = startOfDay(now);
  const first = addDays(startOfWeek(now, weekStartsOn), -7 * (weeks - 1));
  const counts = new Map<number, number>();
  for (const d of answersPerDay(events)) if (d.day >= first && d.day <= today) counts.set(d.day, d.answers);

  let max = 0;
  let total = 0;
  for (const n of counts.values()) {
    max = Math.max(max, n);
    total += n;
  }

  const cells: HeatCell[] = [];
  const months: HeatGrid['months'] = [];
  for (let week = 0; week < weeks; week++) {
    const weekStart = addDays(first, 7 * week);
    for (let weekday = 0; weekday < 7; weekday++) {
      const day = addDays(weekStart, weekday);
      if (day > today) break;
      const answers = counts.get(day) ?? 0;
      cells.push({ date: dateKey(day), day, week, weekday, answers, level: heatLevel(answers, max) });
      if (new Date(day).getDate() === 1) months.push({ week, label: MONTHS[new Date(day).getMonth()] as string });
    }
  }
  // the first column names its month too, unless another month begins within two columns of it
  const head = months[0];
  if (!head || head.week >= 3) months.unshift({ week: 0, label: MONTHS[new Date(first).getMonth()] as string });
  return { weeks, cells, max, total, activeDays: counts.size, months };
}

// ---- speed -----------------------------------------------------------------------------------------------------

export interface WeekPoint {
  /** First day of the week, local midnight. */
  start: number;
  date: string;
  answers: number;
  correct: number;
  /** Median time to a correct answer, ms. Null in a week without one. */
  medianMs: number | null;
}

/** The median answer time of correct answers for each of the last `weeks` weeks, oldest first. Empty weeks are kept. */
export function weeklyLatency(events: readonly ReviewEvent[], now: number, weeks = 12, weekStartsOn: 0 | 1 = 1): WeekPoint[] {
  const first = addDays(startOfWeek(now, weekStartsOn), -7 * (weeks - 1));
  const points: WeekPoint[] = Array.from({ length: weeks }, (_, i) => {
    const start = addDays(first, 7 * i);
    return { start, date: dateKey(start), answers: 0, correct: 0, medianMs: null };
  });
  const times: number[][] = points.map(() => []);
  const end = addDays(first, 7 * weeks);
  for (const e of answersOf(events)) {
    if (e.ts < first || e.ts >= end) continue;
    // found by the weeks' own start times, so a clock change inside a week cannot throw the index off
    const i = points.findLastIndex((w) => w.start <= e.ts);
    const p = points[i] as WeekPoint;
    p.answers += 1;
    if (e.correct) {
      p.correct += 1;
      (times[i] as number[]).push(e.latencyMs);
    }
  }
  points.forEach((p, i) => (p.medianMs = median(times[i] as number[])));
  return points;
}

export interface SpeedTrend {
  /** The latest week that has a median, and the earliest one in view. */
  latest: WeekPoint | null;
  earliest: WeekPoint | null;
  /** latest minus earliest, ms; negative means faster. Null with fewer than two weeks of data. */
  changeMs: number | null;
}

export function speedTrend(points: readonly WeekPoint[]): SpeedTrend {
  const withData = points.filter((p) => p.medianMs !== null);
  const earliest = withData[0] ?? null;
  const latest = withData[withData.length - 1] ?? null;
  const changeMs = earliest && latest && earliest !== latest ? (latest.medianMs as number) - (earliest.medianMs as number) : null;
  return { latest, earliest, changeMs };
}

// ---- totals ---------------------------------------------------------------------------------------------------------

export interface Totals {
  answers: number;
  correct: number;
  /** 0 to 1, null before the first answer. */
  accuracy: number | null;
  activeDays: number;
  /** Callouts that have been met (an intro card or an answer). */
  met: number;
  firstTs: number | null;
  lastTs: number | null;
}

export function totals(events: readonly ReviewEvent[]): Totals {
  const answers = answersOf(events);
  const correct = answers.filter((a) => a.correct).length;
  const met = new Set(events.map((e) => e.callout));
  let firstTs: number | null = null;
  let lastTs: number | null = null;
  for (const e of events) {
    if (firstTs === null || e.ts < firstTs) firstTs = e.ts;
    if (lastTs === null || e.ts > lastTs) lastTs = e.ts;
  }
  return {
    answers: answers.length,
    correct,
    accuracy: answers.length ? correct / answers.length : null,
    activeDays: answersPerDay(events).length,
    met: met.size,
    firstTs,
    lastTs,
  };
}

/** Whole percent, or null with nothing to divide. */
export function percent(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((100 * part) / whole) : null;
}

// ---- mastery ---------------------------------------------------------------------------------------------------
//
// The per-map counts, "Core x of y" and the percent that Home, Map and Progress show are `mapProgress` in app/progress.ts,
// so every screen quotes the same number. What is here is the part the Study and Summary screens need: the tint of each
// callout, and a session's before and after.

/** Mastery state by callout id: what the map draws as its tint (SCOPE §4.5). */
export type Fills = Record<string, Mastery>;

/** `enabled` defaults to the modes a session asks for, as `mapProgress` does, so the tint here is the tint on Home. */
export function masteryFills(callouts: readonly Callout[], derived: Derived, scheduler: Scheduler, enabled: readonly Mode[] = DEFAULT_SESSION_SETTINGS.enabledModes): Fills {
  const out: Fills = {};
  for (const c of callouts) out[c.id] = masteryOf(c.id, derived, scheduler, applicableModes(c, enabled));
  return out;
}

export interface MasteryChange {
  calloutId: string;
  from: Mastery;
  to: Mastery;
}

/**
 * The map's fills at one end of a session: every callout as it is now, except the ones that changed, which are set to
 * their state at that end. The summary shows before and after this way because the log may not have caught up with the
 * session's last answers when the screen opens, while the session's own record of what moved is complete.
 */
export function fillsAt(now: Readonly<Fills>, changes: readonly MasteryChange[], end: 'from' | 'to'): Fills {
  const out: Fills = { ...now };
  for (const c of changes) out[c.calloutId] = c[end];
  return out;
}

// ---- confusions --------------------------------------------------------------------------------------------------

/** The confused pairs of one map, worst first, at most `limit`. Both callouts must belong to the map. */
export function mapConfusions(derived: Pick<Derived, 'confusions'>, ids: ReadonlySet<string>, min = 2, limit = Infinity): ConfusionPair[] {
  return confusedPairs(derived, min)
    .filter((p) => ids.has(p.a) && ids.has(p.b))
    .slice(0, limit);
}

// ---- camera heading -----------------------------------------------------------------------------------------------

const POINTS = ['east', 'north-east', 'north', 'north-west', 'west', 'south-west', 'south', 'south-east'] as const;

/**
 * Where a screenshot looks, as a compass point on the radar (north is up, fixed, like the in-game one). Source yaw
 * 0 faces +x, which is east on the radar, and grows counter-clockwise seen from above.
 */
export function headingOf(yawDeg: number): (typeof POINTS)[number] {
  const turn = ((yawDeg % 360) + 360) % 360;
  return POINTS[Math.round(turn / 45) % 8] as (typeof POINTS)[number];
}

// ---- paging and fitting (nothing on these screens scrolls, SCOPE §5.3) ---------------------------------------------------

export interface PageWindow {
  /** The page shown, from 0. */
  page: number;
  pageCount: number;
  /** Indexes `from` up to but not including `to` are on this page. */
  from: number;
  to: number;
}

/**
 * Which slice of a list is on screen. `perPage` comes from measuring the room (0 while that is unknown, which shows
 * nothing rather than guessing). With no page picked by hand the page is the one holding `anchor`, the selected row, so a
 * tour that steps past the end of a page turns it; a hand-picked page always wins.
 */
export function pageWindow(count: number, perPage: number, picked: number | null, anchor: number | null = null): PageWindow {
  if (perPage <= 0 || count <= 0) return { page: 0, pageCount: 1, from: 0, to: 0 };
  const pageCount = Math.max(1, Math.ceil(count / perPage));
  const wanted = picked ?? (anchor !== null && anchor >= 0 ? Math.floor(anchor / perPage) : 0);
  const page = Math.min(pageCount - 1, Math.max(0, wanted));
  return { page, pageCount, from: page * perPage, to: Math.min(count, page * perPage + perPage) };
}

/**
 * How many rows of each of several stacked lists fit in `room` px, when a row takes `row` px and a list's heading `head`.
 * Every list gets a first row before any gets a second, so none is cut to nothing while another runs to full length. A
 * list that cannot have even one row is dropped (0). `wants` is how many rows each would like; 0 means it has nothing.
 */
export function fitLists(room: number, wants: readonly number[], row: number, head: number): number[] {
  const counts = wants.map(() => 0);
  let used = 0;
  const longest = Math.max(0, ...wants);
  for (let round = 1; round <= longest; round++) {
    for (let i = 0; i < wants.length; i++) {
      if (counts[i] !== round - 1 || (wants[i] as number) < round) continue;
      const cost = row + (round === 1 ? head : 0);
      if (used + cost > room) continue;
      used += cost;
      counts[i] = round;
    }
  }
  return counts;
}

// ---- words for numbers ---------------------------------------------------------------------------------------------

/** `2.4 s`. */
export const secondsText = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

/** `2 nov`, local; the stylesheet capitalises nothing, the app is lowercase. */
export function dayLabel(ms: number): string {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS[d.getMonth()] as string}`;
}

// ---- drawing: sizes and geometry for the Progress charts (pixels in, pixels out; no DOM) -----------------------------------

export interface HeatLayout {
  /** Side of one day's square, px. */
  cell: number;
  /** Width kept at the left for the weekday letters; 0 when the squares are too small to label. */
  gutter: number;
}

export interface HeatLayoutOptions {
  gap?: number;
  /** Height kept above the squares for the month names. */
  head?: number;
  gutter?: number;
  min?: number;
  max?: number;
}

/**
 * The biggest square that lets `weeks` columns and 7 rows fit a box, so the grid fills what it is given and never
 * overflows. Weekday letters come only when the squares are big enough (10 px) to carry them.
 */
export function heatLayout(width: number, height: number, weeks = 26, options: HeatLayoutOptions = {}): HeatLayout {
  const { gap = 2, head = 14, gutter = 26, min = 4, max = 22 } = options;
  const side = (g: number) => Math.floor(Math.min((width - g - gap * (weeks - 1)) / weeks, (height - head - gap * 7) / 7));
  const labelled = side(gutter);
  if (labelled >= 10) return { cell: Math.min(max, labelled), gutter };
  return { cell: Math.max(min, Math.min(max, side(0))), gutter: 0 };
}

export interface Sparkline {
  /** Runs of consecutive weeks that have a value, as SVG path data. A week without one breaks the line. */
  paths: string[];
  /** One dot per week that has a value; `last` marks the newest. */
  dots: { x: number; y: number; index: number; last: boolean }[];
  /** The value at the top of the chart. The bottom is 0. */
  top: number;
}

/**
 * A line chart of one value per week, for a box of `width` x `height` px with `pad` px around it. The scale starts at 0
 * so a small change does not look like a big one, and tops out a little above the largest value.
 */
export function sparkline(values: readonly (number | null)[], width: number, height: number, pad = 6): Sparkline {
  const known = values.filter((v): v is number => v !== null);
  const top = Math.max(1, Math.ceil(Math.max(0, ...known) * 1.15));
  const x = (i: number) => (values.length <= 1 ? width / 2 : pad + (i * (width - 2 * pad)) / (values.length - 1));
  const y = (v: number) => height - pad - (v / top) * (height - 2 * pad);
  const r = (n: number) => Math.round(n * 10) / 10;
  const paths: string[] = [];
  const dots: Sparkline['dots'] = [];
  let run: string[] = [];
  const close = () => {
    if (run.length > 1) paths.push(run.join(''));
    run = [];
  };
  const lastIndex = values.findLastIndex((v) => v !== null);
  values.forEach((v, i) => {
    if (v === null) return close();
    run.push(`${run.length === 0 ? 'M' : 'L'}${r(x(i))} ${r(y(v))}`);
    dots.push({ x: r(x(i)), y: r(y(v)), index: i, last: i === lastIndex });
    if (i + 1 >= values.length || values[i + 1] === null) close();
  });
  return { paths, dots, top };
}

/** `5 weeks`, `1 week`. */
export const weeksText = (n: number): string => `${n} ${n === 1 ? 'week' : 'weeks'}`;

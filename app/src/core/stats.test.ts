import { beforeAll, describe, expect, it } from 'vitest';
import { replay, type ReviewEvent } from './log';
import { createScheduler, type Scheduler } from './scheduler';
import { makeCallouts } from './test-fixtures';
import { answer, intro } from './test-helpers';
import { Grade } from './types';
import {
  accuracyByMode,
  addDays,
  answersPerDay,
  countAll,
  countKnown,
  dateKey,
  fillsAt,
  headingOf,
  heatGrid,
  heatLevel,
  mapConfusions,
  masteryCounts,
  masteryFills,
  masteryPercent,
  median,
  percent,
  speedTrend,
  startOfDay,
  startOfWeek,
  totals,
  weeklyLatency,
} from './stats';

// All times are built from local calendar fields, so the tests mean the same thing in any time zone.
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const NOW = at(2026, 11, 4, 15); // a Wednesday

let s: Scheduler;
beforeAll(async () => {
  s = await createScheduler();
});

const right = (id: string, ts: number, ms = 1500, mode: Parameters<typeof answer>[1] = 'name-mc') => answer(id, mode, ts, Grade.Good, ms);
const wrong = (id: string, ts: number, chosen: string | null = null, mode: Parameters<typeof answer>[1] = 'name-mc') => answer(id, mode, ts, Grade.Again, 5000, chosen);

describe('days and weeks', () => {
  it('finds local midnight, the date key and the start of a Monday week', () => {
    expect(startOfDay(at(2026, 11, 4, 23, 59))).toBe(at(2026, 11, 4, 0));
    expect(dateKey(at(2026, 11, 4, 23, 59))).toBe('2026-11-04');
    expect(dateKey(at(2026, 1, 9, 0, 1))).toBe('2026-01-09');
    expect(dateKey(startOfWeek(NOW))).toBe('2026-11-02'); // Wednesday -> Monday
    expect(dateKey(startOfWeek(at(2026, 11, 2, 0, 1)))).toBe('2026-11-02');
    expect(dateKey(startOfWeek(at(2026, 11, 8, 23)))).toBe('2026-11-02'); // Sunday belongs to the week before
    expect(dateKey(startOfWeek(NOW, 0))).toBe('2026-11-01');
  });
  it('adds calendar days across a month and a year end', () => {
    expect(dateKey(addDays(at(2026, 12, 30, 0), 3))).toBe('2027-01-02');
    expect(dateKey(addDays(at(2026, 3, 1, 0), -1))).toBe('2026-02-28');
  });
});

describe('median', () => {
  it('handles odd, even and empty lists without changing the input', () => {
    const list = [5, 1, 3];
    expect(median(list)).toBe(3);
    expect(list).toEqual([5, 1, 3]);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe('answersPerDay', () => {
  it('counts answers and correct answers per local day, oldest first, and skips intro events', () => {
    const events: ReviewEvent[] = [
      right('test.mid', at(2026, 11, 3, 23, 30)),
      wrong('test.mid', at(2026, 11, 3, 8)),
      intro('test.mid', at(2026, 11, 3, 7)),
      right('test.mid', at(2026, 11, 1, 10)),
    ];
    expect(answersPerDay(events)).toEqual([
      { day: at(2026, 11, 1, 0), date: '2026-11-01', answers: 1, correct: 1 },
      { day: at(2026, 11, 3, 0), date: '2026-11-03', answers: 2, correct: 1 },
    ]);
  });
  it('is empty for an empty log', () => {
    expect(answersPerDay([])).toEqual([]);
  });
});

describe('heatLevel', () => {
  it('is 0 for no answers and 1 to 4 in proportion to the busiest day', () => {
    expect(heatLevel(0, 10)).toBe(0);
    expect(heatLevel(1, 10)).toBe(1);
    expect(heatLevel(3, 10)).toBe(2);
    expect(heatLevel(6, 10)).toBe(3);
    expect(heatLevel(10, 10)).toBe(4);
    expect(heatLevel(1, 1)).toBe(4);
    expect(heatLevel(5, 0)).toBe(0);
  });
});

describe('heatGrid', () => {
  const events: ReviewEvent[] = [
    right('test.mid', at(2026, 11, 4, 9)),
    right('test.mid', at(2026, 11, 4, 10)),
    wrong('test.mid', at(2026, 11, 4, 11)),
    right('test.mid', at(2026, 11, 4, 12)),
    right('test.mid', at(2026, 11, 2, 9)),
    right('test.mid', at(2026, 10, 30, 9)),
    right('test.mid', at(2025, 1, 5, 9)), // far outside the window
  ];

  it('has one column per week ending with this week, and no cells after today', () => {
    const grid = heatGrid(events, NOW, 26);
    expect(grid.weeks).toBe(26);
    // 25 full weeks, then Monday to Wednesday of this one
    expect(grid.cells).toHaveLength(25 * 7 + 3);
    const first = grid.cells[0]!;
    expect(first).toMatchObject({ week: 0, weekday: 0 });
    expect(new Date(first.day).getDay()).toBe(1); // a Monday
    const last = grid.cells[grid.cells.length - 1]!;
    expect(last).toMatchObject({ date: '2026-11-04', week: 25, weekday: 2 });
    expect(grid.cells.every((c) => c.day <= startOfDay(NOW))).toBe(true);
  });
  it('places each day by week and weekday, with the counts and levels of its answers', () => {
    const grid = heatGrid(events, NOW, 26);
    const byDate = new Map(grid.cells.map((c) => [c.date, c]));
    expect(byDate.get('2026-11-04')).toMatchObject({ answers: 4, level: 4, week: 25, weekday: 2 });
    expect(byDate.get('2026-11-02')).toMatchObject({ answers: 1, level: 1, week: 25, weekday: 0 });
    expect(byDate.get('2026-10-30')).toMatchObject({ answers: 1, level: 1, week: 24, weekday: 4 });
    expect(byDate.get('2026-11-03')).toMatchObject({ answers: 0, level: 0 });
    expect(grid.max).toBe(4);
    expect(grid.total).toBe(6);
    expect(grid.activeDays).toBe(3);
  });
  it('keeps every date unique and in order', () => {
    const grid = heatGrid(events, NOW, 26);
    const dates = grid.cells.map((c) => c.date);
    expect(new Set(dates).size).toBe(dates.length);
    expect(dates).toEqual(dates.slice().sort());
  });
  it('is all zeros for an empty log', () => {
    const grid = heatGrid([], NOW, 26);
    expect(grid.total).toBe(0);
    expect(grid.max).toBe(0);
    expect(grid.activeDays).toBe(0);
    expect(grid.cells.every((c) => c.answers === 0 && c.level === 0)).toBe(true);
  });
  it('does not count answers from after now or from before the window', () => {
    const grid = heatGrid([right('test.mid', at(2026, 11, 5, 9)), right('test.mid', at(2026, 4, 1, 9))], NOW, 26);
    // 2026-04-01 is 31 weeks back, outside 26 weeks; 2026-11-05 is tomorrow
    expect(grid.total).toBe(0);
  });
  it('marks where months begin, plus the first column', () => {
    const grid = heatGrid([], NOW, 26);
    expect(grid.months.map((m) => m.label)).toEqual(['may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov']);
    // weeks are 7 columns apart, so the labels of neighbouring months are 4 or 5 columns apart
    for (let i = 1; i < grid.months.length; i++) expect(grid.months[i]!.week - grid.months[i - 1]!.week).toBeGreaterThanOrEqual(3);
  });
  it('works with a Sunday week start and a different length', () => {
    const grid = heatGrid(events, NOW, 4, 0);
    expect(grid.weeks).toBe(4);
    expect(new Date(grid.cells[0]!.day).getDay()).toBe(0);
    expect(grid.cells).toHaveLength(3 * 7 + 4); // Sunday to Wednesday this week
  });
  it('counts a day across a daylight-saving change as one day', () => {
    // whatever the zone does around the end of October or March, the grid still has one cell per calendar date
    for (const now of [at(2026, 3, 30, 12), at(2026, 10, 28, 12), at(2026, 11, 2, 12)]) {
      const grid = heatGrid([], now, 26);
      const dates = grid.cells.map((c) => c.date);
      expect(new Set(dates).size).toBe(dates.length);
      expect(dates[dates.length - 1]).toBe(dateKey(now));
    }
  });
});

describe('weeklyLatency', () => {
  it('takes the median time of correct answers in each week and keeps empty weeks', () => {
    const events: ReviewEvent[] = [
      right('test.mid', at(2026, 11, 3, 9), 1000),
      right('test.mid', at(2026, 11, 3, 10), 3000),
      right('test.mid', at(2026, 11, 4, 10), 2000), // this week: 1000, 2000, 3000 -> 2000
      wrong('test.mid', at(2026, 11, 4, 11)), // a wrong answer is counted but its time is not
      right('test.mid', at(2026, 10, 20, 9), 4000), // two weeks back
      right('test.mid', at(2026, 10, 26, 23, 59), 5000), // Monday of last week, late: still last week
    ];
    const points = weeklyLatency(events, NOW, 4);
    expect(points.map((p) => p.date)).toEqual(['2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02']);
    expect(points.map((p) => p.medianMs)).toEqual([null, 4000, 5000, 2000]);
    expect(points.map((p) => p.answers)).toEqual([0, 1, 1, 4]);
    expect(points.map((p) => p.correct)).toEqual([0, 1, 1, 3]);
  });
  it('ignores answers outside the weeks asked for', () => {
    const points = weeklyLatency([right('test.mid', at(2026, 9, 1), 1000), right('test.mid', at(2026, 11, 10), 1000)], NOW, 4);
    expect(points.every((p) => p.answers === 0 && p.medianMs === null)).toBe(true);
  });
  it('is a row of empty weeks for an empty log', () => {
    const points = weeklyLatency([], NOW, 12);
    expect(points).toHaveLength(12);
    expect(points.every((p) => p.medianMs === null)).toBe(true);
  });
});

describe('speedTrend', () => {
  it('compares the latest week with data against the earliest one in view', () => {
    const points = weeklyLatency(
      [right('test.mid', at(2026, 10, 14), 4000), right('test.mid', at(2026, 11, 3), 2500)],
      NOW,
      6,
    );
    const trend = speedTrend(points);
    expect(trend.earliest?.medianMs).toBe(4000);
    expect(trend.latest?.medianMs).toBe(2500);
    expect(trend.changeMs).toBe(-1500);
  });
  it('has no change with a single week of data, and nothing with none', () => {
    const one = speedTrend(weeklyLatency([right('test.mid', at(2026, 11, 3), 2500)], NOW, 6));
    expect(one.latest?.medianMs).toBe(2500);
    expect(one.changeMs).toBeNull();
    expect(speedTrend(weeklyLatency([], NOW, 6))).toEqual({ latest: null, earliest: null, changeMs: null });
  });
});

describe('accuracyByMode and totals', () => {
  const events: ReviewEvent[] = [
    intro('test.mid', at(2026, 11, 1, 8)),
    right('test.mid', at(2026, 11, 1, 9), 1000, 'name-mc'),
    right('test.a-ramp', at(2026, 11, 1, 9), 3000, 'name-mc'),
    wrong('test.mid', at(2026, 11, 2, 9), 'test.a-ramp', 'name-mc'),
    right('test.mid', at(2026, 11, 2, 9), 7000, 'pin'),
  ];
  it('reports answers, accuracy and median time of right answers per mode, in the order of the modes', () => {
    expect(accuracyByMode(events)).toEqual([
      { mode: 'name-mc', answers: 3, correct: 2, accuracy: 2 / 3, medianMs: 2000 },
      { mode: 'pin', answers: 1, correct: 1, accuracy: 1, medianMs: 7000 },
    ]);
  });
  it('totals answers, accuracy, active days, callouts met and the span of the log', () => {
    expect(totals(events)).toEqual({
      answers: 4,
      correct: 3,
      accuracy: 3 / 4,
      activeDays: 2,
      met: 2,
      firstTs: at(2026, 11, 1, 8),
      lastTs: at(2026, 11, 2, 9),
    });
  });
  it('handles an empty log', () => {
    expect(accuracyByMode([])).toEqual([]);
    expect(totals([])).toEqual({ answers: 0, correct: 0, accuracy: null, activeDays: 0, met: 0, firstTs: null, lastTs: null });
  });
  it('percent is whole numbers, or null with nothing to divide', () => {
    expect(percent(2, 3)).toBe(67);
    expect(percent(0, 0)).toBeNull();
  });
});

describe('mastery summaries', () => {
  const callouts = makeCallouts().filter((c) => c.tier !== 3);
  const T0 = at(2026, 10, 1, 9);

  it('fills every callout, with New for the unmet and Seen for an intro with no answers', () => {
    const derived = replay([intro('test.mid', T0)], s);
    const fills = masteryFills(callouts, derived, s);
    expect(Object.keys(fills)).toHaveLength(callouts.length);
    expect(fills['test.mid']).toBe('seen');
    expect(fills['test.palace']).toBe('new');
  });
  it('a callout answered but not yet stable is Learning', () => {
    const derived = replay([intro('test.mid', T0), right('test.mid', T0 + 1000)], s);
    expect(masteryFills(callouts, derived, s)['test.mid']).toBe('learning');
  });
  it('counts states, ignoring ids that are not in the fills as New', () => {
    const fills = { a: 'known', b: 'new', c: 'automatic', d: 'known' } as const;
    const counts = masteryCounts(fills);
    expect(counts).toEqual({ new: 1, seen: 0, learning: 0, familiar: 0, known: 2, automatic: 1 });
    expect(countAll(counts)).toBe(4);
    expect(countKnown(counts)).toBe(3);
    expect(masteryCounts(fills, ['a', 'zzz']).new).toBe(1);
    expect(masteryCounts(fills, ['a', 'zzz']).known).toBe(1);
  });
  it('turns the counts into one percentage: New is 0, Automatic is 100, and an empty map has none', () => {
    const empty = masteryCounts({});
    expect(masteryPercent(empty)).toBeNull();
    expect(masteryPercent(masteryCounts({ a: 'new', b: 'new' }))).toBe(0);
    expect(masteryPercent(masteryCounts({ a: 'automatic', b: 'automatic' }))).toBe(100);
    expect(masteryPercent(masteryCounts({ a: 'new', b: 'automatic' }))).toBe(50);
    expect(masteryPercent(masteryCounts({ a: 'learning' }))).toBe(40);
  });
  it('builds the before and after fills of a session from the changes', () => {
    const now = { a: 'known', b: 'learning', c: 'new' } as const;
    const changes = [
      { calloutId: 'a', from: 'familiar', to: 'known' },
      { calloutId: 'b', from: 'seen', to: 'learning' },
    ] as const;
    expect(fillsAt(now, changes, 'from')).toEqual({ a: 'familiar', b: 'seen', c: 'new' });
    expect(fillsAt(now, changes, 'to')).toEqual({ a: 'known', b: 'learning', c: 'new' });
    // the inputs are not changed
    expect(now.a).toBe('known');
    // the session's record wins over a log that has not caught up
    expect(fillsAt({ a: 'familiar', b: 'seen', c: 'new' }, changes, 'to')).toEqual({ a: 'known', b: 'learning', c: 'new' });
  });
});

describe('mapConfusions', () => {
  it('lists pairs confused at least twice, in either direction, worst first, for one map only', () => {
    const events: ReviewEvent[] = [
      wrong('test.mid', 1000, 'test.a-ramp'),
      wrong('test.a-ramp', 2000, 'test.mid'),
      wrong('test.palace', 3000, 'test.a-site'),
      wrong('test.palace', 4000, 'test.a-site'),
      wrong('test.palace', 5000, 'test.a-site'),
      wrong('test.connector', 6000, 'test.b-site'),
      wrong('other.thing', 7000, 'other.place'),
      wrong('other.thing', 8000, 'other.place'),
    ];
    const derived = replay(events, s);
    const ids = new Set(makeCallouts().map((c) => c.id));
    expect(mapConfusions(derived, ids)).toEqual([
      { a: 'test.a-site', b: 'test.palace', count: 3 },
      { a: 'test.a-ramp', b: 'test.mid', count: 2 },
    ]);
    expect(mapConfusions(derived, ids, 1, 1)).toHaveLength(1);
    expect(mapConfusions(derived, ids, 1)).toHaveLength(3);
    expect(mapConfusions(replay([], s), ids)).toEqual([]);
  });
});

describe('headingOf', () => {
  it('names the compass point a camera yaw looks at, north up, yaw 0 facing east', () => {
    expect(headingOf(0)).toBe('east');
    expect(headingOf(90)).toBe('north');
    expect(headingOf(180)).toBe('west');
    expect(headingOf(270)).toBe('south');
    expect(headingOf(-90)).toBe('south');
    expect(headingOf(45)).toBe('north-east');
    expect(headingOf(-45)).toBe('south-east');
    expect(headingOf(360)).toBe('east');
    expect(headingOf(22)).toBe('east');
    expect(headingOf(23)).toBe('north-east');
  });
});

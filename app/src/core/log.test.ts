import { beforeAll, describe, expect, it } from 'vitest';
import { answersSince, applyEvent, confusedPairs, confusionCount, createDerived, LogFileSchema, replay, type Derived, type ReviewEvent } from './log';
import { createScheduler, type Scheduler } from './scheduler';
import { answer, intro } from './test-helpers';
import { DAY_MS, Grade, itemKey } from './types';

const T0 = Date.parse('2026-02-01T09:00:00Z');
let s: Scheduler;
beforeAll(async () => {
  s = await createScheduler();
});

describe('replay', () => {
  const events = (): ReviewEvent[] => [
    intro('test.mid', T0),
    answer('test.mid', 'name-mc', T0 + 1000, Grade.Good),
    answer('test.mid', 'name-mc', T0 + 4 * DAY_MS, Grade.Good),
    answer('test.mid', 'pin', T0 + 4 * DAY_MS, Grade.Again, 7000, 'test.palace'),
  ];

  it('builds items, the introduced map and the confusion counts', () => {
    const d = replay(events(), s);
    expect(d.items.size).toBe(2);
    const mc = d.items.get(itemKey('test.mid', 'name-mc'))!;
    expect(mc.answers).toBe(2);
    expect(mc.correct).toBe(2);
    expect(s.stabilityDays(mc.memory)).toBeGreaterThan(5);
    expect(d.introduced.get('test.mid')).toBe(T0);
    expect(d.confusions.get('test.mid>test.palace')).toBe(1);
  });
  it('gives the same state whatever order the events arrive in (a merged import)', () => {
    const a = replay(events(), s);
    const b = replay(events().reverse(), s);
    for (const [key, item] of a.items) {
      const other = b.items.get(key)!;
      expect(s.stabilityDays(other.memory)).toBe(s.stabilityDays(item.memory));
      expect(s.dueAt(other.memory).getTime()).toBe(s.dueAt(item.memory).getTime());
    }
  });
  it('ignores an event id it has already seen, so importing twice changes nothing', () => {
    const list = events();
    const once = replay(list, s);
    const twice = replay([...list, ...list], s);
    expect(twice.items.get(itemKey('test.mid', 'name-mc'))!.answers).toBe(once.items.get(itemKey('test.mid', 'name-mc'))!.answers);
  });
  it('marks a callout introduced by its first answer even without an intro card', () => {
    const d = replay([answer('test.mid', 'name-mc', T0, Grade.Good)], s);
    expect(d.introduced.get('test.mid')).toBe(T0);
  });
  it('lets an intro event alone leave the callout seen but unanswered', () => {
    const d = replay([intro('test.mid', T0)], s);
    expect(d.introduced.has('test.mid')).toBe(true);
    expect(d.items.size).toBe(0);
  });
  it('keeps the last three correct latencies only', () => {
    const d = createDerived();
    [1000, 2000, 3000, 4000].forEach((ms, i) => applyEvent(d, answer('test.mid', 'name-typed', T0 + i * DAY_MS * 5, Grade.Good, ms), s));
    applyEvent(d, answer('test.mid', 'name-typed', T0 + 30 * DAY_MS, Grade.Again, 9999, 'test.palace'), s);
    expect(d.items.get(itemKey('test.mid', 'name-typed'))!.recentLatencies).toEqual([2000, 3000, 4000]);
  });
  it('can re-derive ratings from latency after the fluent times change', () => {
    // Stored as Easy, but 5 s on a 2 s mode is Hard when re-rated; Hard grows stability less.
    const ev = [answer('test.mid', 'name-mc', T0, Grade.Easy, 5000)];
    const stored = replay(ev, s);
    const rerated = replay(ev, s, { rerate: true });
    const key = itemKey('test.mid', 'name-mc');
    expect(s.stabilityDays(rerated.items.get(key)!.memory)).toBeLessThan(s.stabilityDays(stored.items.get(key)!.memory));
  });
});

describe('confusions (SCOPE §4.6)', () => {
  let d: Derived;
  beforeAll(() => {
    d = createDerived();
    applyEvent(d, answer('test.a', 'name-mc', T0, Grade.Again, 2000, 'test.b'), s);
    applyEvent(d, answer('test.b', 'name-mc', T0 + 1, Grade.Again, 2000, 'test.a'), s);
    applyEvent(d, answer('test.a', 'read-map', T0 + 2, Grade.Again, 2000, 'test.c'), s);
    applyEvent(d, answer('test.a', 'name-typed', T0 + 3, Grade.Again, 2000, null), s);
  });

  it('counts a pair in both directions', () => {
    expect(confusionCount(d, 'test.a', 'test.b')).toBe(2);
    expect(confusionCount(d, 'test.b', 'test.a')).toBe(2);
    expect(confusionCount(d, 'test.a', 'test.c')).toBe(1);
  });
  it('lists pairs confused at least twice, once each, worst first', () => {
    expect(confusedPairs(d)).toEqual([{ a: 'test.a', b: 'test.b', count: 2 }]);
    expect(confusedPairs(d, 1)).toHaveLength(2);
  });
  it('does not count a wrong answer with no chosen callout as a confusion', () => {
    expect(d.confusions.size).toBe(3);
  });
});

describe('daily count', () => {
  it('counts answers at or after a time, not intro cards', () => {
    const ev = [intro('test.mid', T0), answer('test.mid', 'name-mc', T0 + 10, Grade.Good), answer('test.mid', 'pin', T0 + DAY_MS, Grade.Good)];
    expect(answersSince(ev, T0 + 10)).toBe(2);
    expect(answersSince(ev, T0 + DAY_MS)).toBe(1);
  });
});

describe('the file format (export/import)', () => {
  it('accepts a real log and rejects a bad one', () => {
    const good = [intro('test.mid', T0), answer('test.mid', 'name-mc', T0, Grade.Good)];
    expect(LogFileSchema.safeParse(JSON.parse(JSON.stringify(good))).success).toBe(true);
    expect(LogFileSchema.safeParse([{ ...good[1], rating: 5 }]).success).toBe(false);
    expect(LogFileSchema.safeParse([{ ...good[1], mode: 'sprint' }]).success).toBe(false);
    expect(LogFileSchema.safeParse([{ ...good[1], extra: 1 }]).success).toBe(false);
    expect(LogFileSchema.safeParse([{ kind: 'answer', id: 'x', ts: -1 }]).success).toBe(false);
  });
});

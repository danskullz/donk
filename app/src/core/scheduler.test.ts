import { beforeAll, describe, expect, it } from 'vitest';
import { clampRetention, createScheduler, type Memory, type Scheduler } from './scheduler';
import { DAY_MS, Grade } from './types';

const t0 = new Date('2026-01-01T09:00:00Z');
const after = (d: Date, days: number) => new Date(d.getTime() + days * DAY_MS);

let s: Scheduler;
beforeAll(async () => {
  s = await createScheduler(0.9);
});

/** Review at the due time, `grade` every time, and return the interval in days after each review. */
function ladder(grade: 1 | 2 | 3 | 4, steps: number): number[] {
  let m: Memory = s.newMemory('x:name-mc', t0);
  let now = t0;
  const out: number[] = [];
  for (let i = 0; i < steps; i++) {
    m = s.review(m, grade, now);
    const due = s.dueAt(m);
    out.push(Math.round((due.getTime() - now.getTime()) / DAY_MS));
    now = due;
  }
  return out;
}

describe('the model', () => {
  it('is FSRS-6 (ts-fsrs 6 defaults to FSRS-7, which the Phase 0 simulation did not cover)', () => {
    expect(s.model).toBe('fsrs-6');
  });
  it('clamps retention to 0.85-0.95 (SCOPE §4.4)', () => {
    expect(clampRetention(0.5)).toBe(0.85);
    expect(clampRetention(0.99)).toBe(0.95);
    expect(clampRetention(0.9)).toBe(0.9);
  });
});

describe('intervals', () => {
  it('start at 3 days after a first Good and grow without minute-long steps', () => {
    const [first, second, third] = ladder(Grade.Good, 3);
    expect(first).toBe(3);
    expect(second).toBeGreaterThan(8);
    expect(third).toBeGreaterThan(second!);
  });
  it('are capped at a year', () => {
    expect(Math.max(...ladder(Grade.Easy, 8))).toBeLessThanOrEqual(365);
  });
  it('grow faster for Easy and slower for Hard', () => {
    const easy = ladder(Grade.Easy, 3);
    const good = ladder(Grade.Good, 3);
    const hard = ladder(Grade.Hard, 3);
    expect(easy[2]).toBeGreaterThan(good[2]!);
    expect(good[2]).toBeGreaterThan(hard[2]!);
  });
  it('shrink after Again', () => {
    let m = s.newMemory('x:pin', t0);
    let now = t0;
    for (let i = 0; i < 3; i++) {
      m = s.review(m, Grade.Good, now);
      now = s.dueAt(m);
    }
    const before = s.stabilityDays(m);
    const lapsed = s.review(m, Grade.Again, now);
    expect(s.stabilityDays(lapsed)).toBeLessThan(before);
    expect(s.lapses(lapsed)).toBe(1);
    expect(s.dueAt(lapsed).getTime()).toBeGreaterThan(now.getTime());
  });
  it('come sooner at a higher retention target (0.95 versus 0.85)', async () => {
    const hi = await createScheduler(0.95);
    const lo = await createScheduler(0.85);
    const run = (sc: Scheduler) => {
      let m = sc.newMemory('x:pin', t0);
      let now = t0;
      for (let i = 0; i < 3; i++) {
        m = sc.review(m, Grade.Good, now);
        now = sc.dueAt(m);
      }
      return now.getTime() - t0.getTime();
    };
    expect(run(hi)).toBeLessThan(run(lo));
  });
});

describe('retrievability', () => {
  it('is 0 before the first review and falls with time after it', () => {
    const fresh = s.newMemory('x:pin', t0);
    expect(s.retrievability(fresh, t0)).toBe(0);
    const m = s.review(fresh, Grade.Good, t0);
    const r0 = s.retrievability(m, t0);
    const r1 = s.retrievability(m, after(t0, 2));
    const r2 = s.retrievability(m, after(t0, 20));
    expect(r0).toBeCloseTo(1, 5);
    expect(r1).toBeLessThan(r0);
    expect(r2).toBeLessThan(r1);
  });
  it('is about the target retention on the due date', () => {
    const m = s.review(s.newMemory('x:pin', t0), Grade.Good, t0);
    expect(s.retrievability(m, s.dueAt(m))).toBeGreaterThan(0.88);
    expect(s.retrievability(m, s.dueAt(m))).toBeLessThan(0.92);
  });
});

describe('determinism', () => {
  it('replays the same answers to the same state', () => {
    const run = () => {
      let m = s.newMemory('mirage.palace:pin', t0);
      let now = t0;
      for (const g of [3, 3, 2, 1, 3, 4] as const) {
        m = s.review(m, g, now);
        now = s.dueAt(m);
      }
      return [s.stabilityDays(m), s.dueAt(m).getTime(), s.lapses(m)];
    };
    expect(run()).toEqual(run());
  });
});

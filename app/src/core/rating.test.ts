import { describe, expect, it } from 'vitest';
import { inferRating, type Outcome } from './rating';
import { FLUENT_MS, Grade } from './types';

const base: Outcome = { mode: 'name-mc', correct: true, hint: false, latencyMs: FLUENT_MS['name-mc'], firstAnswer: false };
const rate = (o: Partial<Outcome>) => inferRating({ ...base, ...o });

describe('inferRating (SCOPE §4.4 table)', () => {
  it('Again for a wrong answer, however fast', () => {
    expect(rate({ correct: false, latencyMs: 100 })).toBe(Grade.Again);
  });
  it('Good at about the fluent time', () => {
    expect(rate({})).toBe(Grade.Good);
    expect(rate({ latencyMs: 0.6 * 2000 })).toBe(Grade.Good); // exactly 0.6x is not "faster than"
    expect(rate({ latencyMs: 1.6 * 2000 })).toBe(Grade.Good); // exactly 1.6x is not "slower than"
  });
  it('Easy only when clearly faster than the fluent time', () => {
    expect(rate({ latencyMs: 0.6 * 2000 - 1 })).toBe(Grade.Easy);
  });
  it('Hard when clearly slower, or when a hint was used', () => {
    expect(rate({ latencyMs: 1.6 * 2000 + 1 })).toBe(Grade.Hard);
    expect(rate({ hint: true })).toBe(Grade.Hard);
  });
  it('caps an item\'s first answer at Good, and a hint costs nothing on it', () => {
    expect(rate({ firstAnswer: true, latencyMs: 100 })).toBe(Grade.Good);
    expect(rate({ firstAnswer: true, hint: true })).toBe(Grade.Good);
    expect(rate({ firstAnswer: true, latencyMs: 1.6 * 2000 + 1 })).toBe(Grade.Hard);
  });
  it('uses each mode\'s own fluent time', () => {
    expect(rate({ mode: 'pin', latencyMs: 5000 })).toBe(Grade.Good); // slow for MC, fine for map placement
    expect(rate({ mode: 'name-mc', latencyMs: 5000 })).toBe(Grade.Hard);
    expect(rate({ mode: 'name-typed', latencyMs: 2000 })).toBe(Grade.Easy);
  });
  it('takes fluent times as a parameter so ratings can be re-derived after calibration', () => {
    const slowLearner = { ...FLUENT_MS, 'name-mc': 4000 };
    expect(inferRating({ ...base, latencyMs: 5000 }, slowLearner)).toBe(Grade.Good);
  });
});

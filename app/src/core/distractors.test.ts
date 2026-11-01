import { describe, expect, it } from 'vitest';
import { pickOptions } from './distractors';
import { createDerived } from './log';
import { mulberry32 } from './rng';
import { makeCallouts } from './test-fixtures';

const all = makeCallouts();
const get = (slug: string) => all.find((c) => c.id === `test.${slug}`)!;
const everyone = new Set(all.map((c) => c.id));
const none = createDerived();

const ids = (list: readonly { id: string }[]) => list.map((c) => c.id).sort();

describe('pickOptions', () => {
  it('returns the target plus count - 1 different options', () => {
    const four = pickOptions({ target: get('mid'), candidates: all, introduced: everyone, confusions: none, count: 4, rng: mulberry32(1) });
    expect(four).toHaveLength(4);
    expect(new Set(four.map((c) => c.id)).size).toBe(4);
    expect(four.map((c) => c.id)).toContain('test.mid');
    const three = pickOptions({ target: get('mid'), candidates: all, introduced: everyone, confusions: none, count: 3, rng: mulberry32(1) });
    expect(three).toHaveLength(3);
  });

  it('prefers spatial neighbours (SCOPE §4.6)', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const o = pickOptions({ target: get('mid'), candidates: all, introduced: everyone, confusions: none, count: 4, rng: mulberry32(seed) });
      const others = o.filter((c) => c.id !== 'test.mid');
      expect(others.every((c) => get('mid').neighbours.includes(c.id))).toBe(true);
    }
  });

  it('pulls in a pair the learner has confused, even if it is not a neighbour', () => {
    const d = createDerived();
    d.confusions.set('test.mid>test.palace', 3);
    for (let seed = 1; seed <= 10; seed++) {
      const o = pickOptions({ target: get('mid'), candidates: all, introduced: everyone, confusions: d, count: 4, rng: mulberry32(seed) });
      expect(o.map((c) => c.id)).toContain('test.palace');
    }
  });

  it('always offers the callout it is told to include, far away or not (a contrast card\'s pair)', () => {
    for (let seed = 1; seed <= 15; seed++) {
      const o = pickOptions({ target: get('mid'), candidates: all, introduced: everyone, confusions: none, count: 4, rng: mulberry32(seed), include: 'test.b-apps' });
      expect(o).toHaveLength(4);
      expect(new Set(o.map((c) => c.id)).size).toBe(4);
      expect(o.map((c) => c.id)).toEqual(expect.arrayContaining(['test.mid', 'test.b-apps']));
    }
  });

  it('ignores an include that cannot be offered: the target itself, or a Hard spot against its parent', () => {
    const o = pickOptions({ target: get('a-site'), candidates: all, introduced: everyone, confusions: none, count: 4, rng: mulberry32(2), include: 'test.bench' });
    expect(o.map((c) => c.id)).not.toContain('test.bench');
    expect(o).toHaveLength(4);
    const self = pickOptions({ target: get('mid'), candidates: all, introduced: everyone, confusions: none, count: 4, rng: mulberry32(2), include: 'test.mid' });
    expect(new Set(self.map((c) => c.id)).size).toBe(4);
  });

  it('never offers a Hard spot against the callout it sits in', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const o = pickOptions({ target: get('a-site'), candidates: all, introduced: everyone, confusions: none, count: 4, rng: mulberry32(seed) });
      expect(o.map((c) => c.id)).not.toContain('test.bench');
      const spot = pickOptions({ target: get('bench'), candidates: all, introduced: everyone, confusions: none, count: 4, rng: mulberry32(seed) });
      expect(spot.map((c) => c.id)).not.toContain('test.a-site');
    }
  });

  it('keeps to callouts the learner has met while there are enough of them', () => {
    const met = new Set(['test.t-spawn', 'test.mid', 'test.a-ramp', 'test.a-site']);
    const o = pickOptions({ target: get('mid'), candidates: all, introduced: met, confusions: none, count: 4, rng: mulberry32(3) });
    expect(ids(o)).toEqual(ids([get('t-spawn'), get('mid'), get('a-ramp'), get('a-site')]));
  });

  it('falls back to unmet callouts when too few are known', () => {
    const met = new Set(['test.mid', 'test.t-spawn']);
    const o = pickOptions({ target: get('mid'), candidates: all, introduced: met, confusions: none, count: 4, rng: mulberry32(3) });
    expect(o).toHaveLength(4);
    expect(o.map((c) => c.id)).toContain('test.t-spawn');
  });

  it('gives fewer options only when the map is that small', () => {
    const tiny = [get('mid'), get('t-spawn')];
    const o = pickOptions({ target: get('mid'), candidates: tiny, introduced: everyone, confusions: none, count: 4, rng: mulberry32(1) });
    expect(ids(o)).toEqual(ids(tiny));
  });

  it('is repeatable for a seed and varies between seeds', () => {
    const run = (seed: number) => pickOptions({ target: get('b-site'), candidates: all, introduced: everyone, confusions: none, count: 4, rng: mulberry32(seed) }).map((c) => c.id);
    expect(run(7)).toEqual(run(7));
    const seen = new Set(Array.from({ length: 12 }, (_, i) => run(i + 1).join()));
    expect(seen.size).toBeGreaterThan(1);
  });
});

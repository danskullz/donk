import { describe, expect, it } from 'vitest';
import { CONTRAST_REPEAT_MS, pairKey, parseContrastSeen, pickContrast, serialiseContrastSeen, type ContrastSeen } from './contrast';
import { createDerived } from './log';
import { makeCallouts } from './test-fixtures';
import { DAY_MS } from './types';

const NOW = Date.parse('2026-03-01T10:00:00Z');
const all = makeCallouts();
const playable = all.filter((c) => c.tier !== 3);

function confused(pairs: Record<string, number>) {
  const d = createDerived();
  for (const [k, n] of Object.entries(pairs)) d.confusions.set(k, n);
  return d;
}
const pick = (pairs: Record<string, number>, seen: ReadonlyMap<string, ContrastSeen> = new Map(), over: Partial<Parameters<typeof pickContrast>[0]> = {}) =>
  pickContrast({ playable, derived: confused(pairs), seen, now: NOW, ...over });

describe('pickContrast', () => {
  it('needs a pair mixed up at least twice, in either direction', () => {
    expect(pick({})).toBeNull();
    expect(pick({ 'test.palace>test.a-site': 1 })).toBeNull();
    expect(pick({ 'test.palace>test.a-site': 2 })).toMatchObject({ count: 2 });
    expect(pick({ 'test.palace>test.a-site': 1, 'test.a-site>test.palace': 1 })).toMatchObject({ count: 2 });
  });

  it('takes the worst pair', () => {
    const p = pick({ 'test.palace>test.a-site': 2, 'test.mid>test.connector': 5 });
    expect([p?.target.id, p?.other.id, p?.count]).toEqual(['test.mid', 'test.connector', 5]);
  });

  it('asks about the callout that gets mistaken for the other more often', () => {
    expect(pick({ 'test.palace>test.a-site': 3, 'test.a-site>test.palace': 1 })).toMatchObject({ target: { id: 'test.palace' }, other: { id: 'test.a-site' } });
    expect(pick({ 'test.palace>test.a-site': 1, 'test.a-site>test.palace': 3 })).toMatchObject({ target: { id: 'test.a-site' }, other: { id: 'test.palace' } });
  });

  it('skips a pair with a callout that is not playable here, or has no picture to show', () => {
    expect(pick({ 'test.palace>test.a-site': 4 }, new Map(), { playable: playable.filter((c) => c.id !== 'test.a-site') })).toBeNull();
    const bare = playable.map((c) => (c.id === 'test.a-site' ? { ...c, shots: [] } : c));
    expect(pick({ 'test.palace>test.a-site': 4 }, new Map(), { playable: bare })).toBeNull();
  });

  it('falls back to the next pair when the worst one cannot be shown', () => {
    const p = pick({ 'test.palace>test.bench': 9, 'test.mid>test.connector': 2 }, new Map(), { playable });
    expect(p?.target.id).toBe('test.mid');
  });

  it('does not treat a Hard spot and the callout it sits in as rivals', () => {
    expect(pick({ 'test.a-site>test.bench': 4 }, new Map(), { playable: all })).toBeNull();
  });

  describe('once a week', () => {
    const key = pairKey('test.palace', 'test.a-site');
    const worn = { 'test.palace>test.a-site': 3 };

    it('does not show a pair again within a week', () => {
      const seen = new Map([[key, { at: NOW - 6 * DAY_MS, count: 2 }]]);
      expect(pick(worn, seen)).toBeNull();
    });
    it('shows it again after a week if the pair has been mixed up since', () => {
      const seen = new Map([[key, { at: NOW - CONTRAST_REPEAT_MS, count: 2 }]]);
      expect(pick(worn, seen)).toMatchObject({ count: 3 });
    });
    it('does not show it again after a week if nothing has gone wrong since', () => {
      const seen = new Map([[key, { at: NOW - 30 * DAY_MS, count: 3 }]]);
      expect(pick(worn, seen)).toBeNull();
    });
    it('moves on to the next pair while one is resting', () => {
      const seen = new Map([[key, { at: NOW - DAY_MS, count: 3 }]]);
      const p = pick({ ...worn, 'test.mid>test.connector': 2 }, seen);
      expect(p?.target.id).toBe('test.mid');
    });
    it('is the same record for the pair either way round', () => {
      expect(pairKey('test.a', 'test.b')).toBe(pairKey('test.b', 'test.a'));
    });
  });
});

describe('the stored record', () => {
  it('survives a round trip', () => {
    const seen = new Map([['a|b', { at: 5, count: 2 }]]);
    expect(parseContrastSeen(serialiseContrastSeen(seen))).toEqual(seen);
  });
  it('treats anything unreadable as nothing stored', () => {
    for (const raw of [null, undefined, '', 'not json', '[1,2]', '"x"', 'null']) expect(parseContrastSeen(raw).size).toBe(0);
    expect(parseContrastSeen('{"a|b":{"at":"x","count":1},"c|d":{"at":1,"count":2},"e|f":null}')).toEqual(new Map([['c|d', { at: 1, count: 2 }]]));
  });
});

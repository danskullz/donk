import { describe, expect, it } from 'vitest';
import {
  buildExport,
  calloutPrefix,
  countEventsForMap,
  EXPORT_FORMAT,
  EXPORT_VERSION,
  exportFileName,
  MIGRATIONS,
  mergeEvents,
  parseImport,
  serializeExport,
} from './exportfile';
import type { ReviewEvent } from './log';
import { answer, intro } from './test-helpers';
import { Grade } from './types';

const T0 = Date.parse('2026-02-01T09:00:00Z');
const SETTINGS = { sessionCards: 20, retention: 0.9, naming: 'both' };

// ids come from a counter, so the events are made once and each test gets its own copies
const FIXED: ReviewEvent[] = [
  intro('test.mid', T0),
  answer('test.mid', 'name-mc', T0 + 1000, Grade.Good),
  answer('test.palace', 'name-mc', T0 + 2000, Grade.Again, 7000, 'test.mid'),
  intro('mirage.palace', T0 + 3000),
];
const sample = (): ReviewEvent[] => FIXED.map((e) => ({ ...e }));

const roundTrip = (events: ReviewEvent[]) => {
  const parsed = parseImport(serializeExport(buildExport(events, SETTINGS, T0)));
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed;
};

describe('the file', () => {
  it('names itself and its version, and keeps events and settings', () => {
    const file = buildExport(sample(), SETTINGS, T0);
    expect(file).toMatchObject({ format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt: '2026-02-01T09:00:00.000Z', settings: SETTINGS });
    expect(file.events).toHaveLength(4);
  });

  it('is sorted by time then id, so the same log always gives the same file', () => {
    const list = sample();
    const a = serializeExport(buildExport(list, SETTINGS, T0));
    const b = serializeExport(buildExport(list.slice().reverse(), SETTINGS, T0));
    expect(b).toBe(a);
    const ids = buildExport(list, SETTINGS, T0).events.map((e) => e.ts);
    expect(ids).toEqual([...ids].sort((x, y) => x - y));
  });

  it('is valid JSON with one event per line', () => {
    const text = serializeExport(buildExport(sample(), SETTINGS, T0));
    expect(() => JSON.parse(text)).not.toThrow();
    expect(text.trim().split('\n')).toHaveLength(4 + 2); // head line, four events, closing line
    expect(JSON.parse(serializeExport(buildExport([], SETTINGS, T0))).events).toEqual([]);
  });

  it('names the download by the local date', () => {
    expect(exportFileName(new Date(2026, 10, 2, 23, 59).getTime())).toBe('callouts-backup-2026-11-02.json');
    expect(exportFileName(new Date(2027, 0, 5, 0, 1).getTime())).toBe('callouts-backup-2027-01-05.json');
  });

  it('drops a repeated id when building, first one wins', () => {
    const e = intro('test.mid', T0);
    expect(buildExport([e, { ...e }, e], SETTINGS, T0).events).toHaveLength(1);
  });
});

describe('a round trip', () => {
  it('gives back exactly the events and the settings', () => {
    const list = sample();
    const parsed = roundTrip(list);
    expect(parsed.invalid).toBe(0);
    expect(parsed.repeated).toBe(0);
    expect(parsed.version).toBe(EXPORT_VERSION);
    expect(parsed.exportedAt).toBe('2026-02-01T09:00:00.000Z');
    expect(parsed.settings).toEqual(SETTINGS);
    expect([...parsed.events].sort((a, b) => a.ts - b.ts)).toEqual([...list].sort((a, b) => a.ts - b.ts));
  });

  it('works for an empty log', () => {
    const parsed = roundTrip([]);
    expect(parsed.events).toEqual([]);
  });

  it('keeps every field of an answer, including a null and a hint', () => {
    const a = { ...answer('test.mid', 'pin', T0, Grade.Hard, 4321, null), hint: true };
    expect(roundTrip([a]).events).toEqual([a]);
  });

  it('survives a non-ASCII and quote-heavy settings value', () => {
    const odd = { note: 'él "dos"   línea', n: 1 };
    const parsed = parseImport(serializeExport(buildExport([], odd, T0)));
    expect(parsed.ok && parsed.settings).toEqual(odd);
  });
});

describe('reading a file that is not right', () => {
  const fileWith = (patch: Record<string, unknown>) => JSON.stringify({ ...buildExport(sample(), SETTINGS, T0), ...patch });

  it('counts a row that does not match the schema and keeps the rest', () => {
    const good = sample();
    const rows = [...good, { kind: 'answer', id: 'x1' }, { kind: 'nope', id: 'x2', ts: 1, callout: 'a.b' }, 'text', null, { ...good[0], extra: 1 }];
    const parsed = parseImport(fileWith({ events: rows }));
    expect(parsed).toMatchObject({ ok: true, invalid: 5 });
    expect(parsed.ok && parsed.events).toHaveLength(4);
  });

  it('rejects an event with a bad callout id, a negative time or a rating outside 1 to 4', () => {
    const base = answer('test.mid', 'name-mc', T0, Grade.Good);
    const rows = [{ ...base, id: 'a', callout: 'NOT AN ID' }, { ...base, id: 'b', ts: -5 }, { ...base, id: 'c', rating: 5 }, { ...base, id: 'd', latencyMs: -1 }];
    expect(parseImport(fileWith({ events: rows }))).toMatchObject({ ok: true, invalid: 4, events: [] });
  });

  it('counts a repeated id inside the file once as an event and then as repeated', () => {
    const list = sample();
    const parsed = parseImport(fileWith({ events: [...list, list[1], list[1]] }));
    expect(parsed).toMatchObject({ ok: true, repeated: 2, invalid: 0 });
    expect(parsed.ok && parsed.events).toHaveLength(4);
  });

  it('refuses text that is not JSON', () => {
    expect(parseImport('{"format": ')).toMatchObject({ ok: false, error: 'not-json' });
    expect(parseImport('hello')).toMatchObject({ ok: false, error: 'not-json' });
  });

  it('refuses an empty file', () => {
    expect(parseImport('')).toMatchObject({ ok: false, error: 'empty' });
    expect(parseImport('  \n ')).toMatchObject({ ok: false, error: 'empty' });
  });

  it('refuses JSON that is not a backup', () => {
    for (const text of ['[]', '42', 'null', '"callouts-export"', '{}', JSON.stringify({ events: sample() }), fileWith({ format: 'something-else' })]) {
      expect(parseImport(text), text.slice(0, 40)).toMatchObject({ ok: false, error: 'not-an-export' });
    }
  });

  it('refuses a file without an events list', () => {
    const { events: _events, ...rest } = buildExport([], SETTINGS, T0);
    expect(parseImport(JSON.stringify(rest))).toMatchObject({ ok: false, error: 'not-an-export' });
    expect(parseImport(fileWith({ events: 'many' }))).toMatchObject({ ok: false, error: 'not-an-export' });
  });

  it('refuses a version that is not a whole number from 1 up', () => {
    for (const version of [0, -1, 1.5, '1', null, true]) {
      expect(parseImport(fileWith({ version })), String(version)).toMatchObject({ ok: false, error: 'not-an-export' });
    }
  });

  it('says plainly when the file is from a newer version', () => {
    const parsed = parseImport(fileWith({ version: EXPORT_VERSION + 1, somethingNew: { shape: true } }));
    expect(parsed).toMatchObject({ ok: false, error: 'too-new' });
    expect(!parsed.ok && parsed.message).toContain('newer version');
  });

  it('reads a newer-version message even when the rest of the file has changed shape', () => {
    expect(parseImport(JSON.stringify({ format: EXPORT_FORMAT, version: 99, tables: [] }))).toMatchObject({ ok: false, error: 'too-new' });
  });

  it('has a migration step for every version before the current one', () => {
    for (let v = 1; v < EXPORT_VERSION; v++) expect(MIGRATIONS[v], `step from version ${v}`).toBeTypeOf('function');
  });

  it('ignores top-level keys it does not know, and settings may be missing', () => {
    const { settings: _settings, ...rest } = buildExport(sample(), SETTINGS, T0);
    const parsed = parseImport(JSON.stringify({ ...rest, generator: 'someone else' }));
    expect(parsed).toMatchObject({ ok: true, settings: null });
    expect(parsed.ok && parsed.events).toHaveLength(4);
  });

  it('does not run anything from the file: a prototype-polluting key stays data', () => {
    const text = '{"format":"callouts-export","version":1,"settings":{"__proto__":{"polluted":true}},"events":[]}';
    const parsed = parseImport(text);
    expect(parsed.ok).toBe(true);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });
});

describe('merging', () => {
  it('adds only what is not there and counts what was', () => {
    const have = sample().slice(0, 2);
    const incoming = sample();
    const result = mergeEvents(have, incoming);
    expect(result.added).toHaveLength(2);
    expect(result.alreadyHere).toBe(2);
    expect(result.conflicts).toBe(0);
    expect(result.merged).toHaveLength(4);
  });

  it('is safe to repeat: merging the result again adds nothing', () => {
    const incoming = sample();
    const once = mergeEvents([], incoming);
    const twice = mergeEvents(once.merged, incoming);
    expect(twice.added).toEqual([]);
    expect(twice.alreadyHere).toBe(4);
    expect(twice.merged).toEqual(once.merged);
  });

  it('gives the same log whichever side is merged into which', () => {
    const a = sample().slice(0, 3);
    const b = sample().slice(1);
    expect(mergeEvents(a, b).merged).toEqual(mergeEvents(b, a).merged);
  });

  it('keeps the stored event when an incoming one has the same id but different content', () => {
    const stored = answer('test.mid', 'name-mc', T0, Grade.Good);
    const changed = { ...stored, correct: false, rating: Grade.Again };
    const result = mergeEvents([stored], [changed]);
    expect(result.added).toEqual([]);
    expect(result.alreadyHere).toBe(1);
    expect(result.conflicts).toBe(1);
    expect(result.merged).toEqual([stored]);
  });

  it('counts a repeated id inside the incoming list as already here after the first', () => {
    const e = intro('test.mid', T0);
    const result = mergeEvents([], [e, { ...e }]);
    expect(result.added).toHaveLength(1);
    expect(result.alreadyHere).toBe(1);
  });

  it('sorts the merged log by time, then id', () => {
    const late = intro('test.mid', T0 + 5000);
    const early = intro('test.palace', T0);
    const tieB = { ...intro('test.mid', T0 + 100), id: 'b' };
    const tieA = { ...intro('test.mid', T0 + 100), id: 'a' };
    expect(mergeEvents([late, tieB], [early, tieA]).merged.map((e) => e.id)).toEqual([early.id, 'a', 'b', late.id]);
  });

  it('copes with a large log', () => {
    const big = Array.from({ length: 20000 }, (_, i) => ({ ...intro('test.mid', T0 + i), id: `e${i}` }));
    const result = mergeEvents(big.slice(0, 10000), big);
    expect(result.added).toHaveLength(10000);
    expect(result.alreadyHere).toBe(10000);
  });
});

describe('one map', () => {
  it('prefixes callout ids with the map name without de_', () => {
    expect(calloutPrefix('de_mirage')).toBe('mirage.');
    expect(calloutPrefix('de_test')).toBe('test.');
  });

  it('counts a map by prefix and does not mix up maps whose names start alike', () => {
    const list = [intro('mirage.palace', T0), intro('mirage2.palace', T0), intro('miragex.a', T0), intro('test.mid', T0)];
    expect(countEventsForMap(list, 'de_mirage')).toBe(1);
    expect(countEventsForMap(list, 'de_test')).toBe(1);
    expect(countEventsForMap(list, 'de_nuke')).toBe(0);
  });
});

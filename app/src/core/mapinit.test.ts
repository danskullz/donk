import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { slugify } from './editor/doc';
import { stableJson } from './editor/json';
import {
  findOverview, MapInitError, mapRecordFromOverview, overviewWarnings, parseZoneList, zonesFromNames, type MapIndexEntry, type MapInitOptions,
} from './mapinit';
import { levelFor } from './projection';
import { MapIndexSchema, MapSchema } from './schema';
import { parseMapData } from './validate';

const dataText = (rel: string): string => readFileSync(new URL(`../../../data/${rel}`, import.meta.url), 'utf8');

const index: MapIndexEntry[] = [
  { id: 'de_mirage', displayName: 'Mirage', pool: 'active-duty', available: true },
  { id: 'de_nuke', displayName: 'Nuke', pool: 'active-duty', available: false },
  { id: 'de_vertigo', displayName: 'Vertigo', pool: 'extra', available: false },
  { id: 'de_dust2', displayName: 'Dust II', pool: 'active-duty', available: false },
];
const zones = ['T Spawn', 'Mid', 'B Site'];
const options: MapInitOptions = { zones, index };

// The Nuke sample is the one from the task brief, in the shape radar.py writes: two floors, Valve's "no limit" is 10000.
// The other entries use made-up positions (only the altitudes of Vertigo are from the brief); no real map data is here.
const nuke = {
  posX: -3453.0,
  posY: 2887.0,
  scale: 7.0,
  rotate: 0,
  zoom: 0.0,
  material: 'overviews/de_nuke',
  levels: [
    { id: 'default', altitudeMax: 10000.0, altitudeMin: -495.0, radar: 'de_nuke.png', radarSize: [1024, 1024], coveredFraction: 0.159 },
    { id: 'lower', altitudeMax: -495.0, altitudeMin: -10000.0, radar: 'de_nuke_lower.png', radarSize: [1024, 1024], coveredFraction: 0.153 },
  ],
  CTSpawn: [0.82, 0.45],
  TSpawn: [0.19, 0.54],
  bombA: [0.58, 0.48],
  bombB: [0.58, 0.58],
};
const vertigo = {
  posX: -3000,
  posY: 1500,
  scale: 4,
  rotate: 0,
  levels: [
    { id: 'default', altitudeMax: 20000, altitudeMin: 11700, radarSize: [1024, 1024] },
    { id: 'lower', altitudeMax: 11700, altitudeMin: -10000, radarSize: [1024, 1024] },
  ],
};
// A single-level map has one level and no altitudes at all.
const singleLevel = { posX: -2000, posY: 2000, scale: 4.4, rotate: 0, levels: [{ id: 'default', radar: 'de_dust2.png', radarSize: [1024, 1024], coveredFraction: 0.2 }] };

const withLevels = (levels: unknown[]) => ({ ...singleLevel, levels });
const fails = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(MapInitError);
    return (e as Error).message;
  }
  throw new Error('expected a MapInitError, but nothing was thrown');
};

describe('mapRecordFromOverview', () => {
  it('builds the Nuke record: projection, radar size, two levels, zones in the order given', () => {
    const r = mapRecordFromOverview('de_nuke', nuke, '26144732', options);
    expect(r).toEqual({
      id: 'de_nuke',
      displayName: 'Nuke',
      pool: 'active-duty',
      projection: { posX: -3453, posY: 2887, scale: 7 },
      radarSize: 1024,
      levels: [{ id: 'default', altitudeMin: -495 }, { id: 'lower', altitudeMax: -495 }],
      gameBuild: '26144732',
      revision: 1,
      zones: [{ id: 't-spawn', name: 'T Spawn' }, { id: 'mid', name: 'Mid' }, { id: 'b-site', name: 'B Site' }],
      status: 'draft',
    });
  });

  it('omits Valve\'s "no limit" bounds (10000, 20000 on Vertigo) but keeps Vertigo\'s real cut at 11700', () => {
    const r = mapRecordFromOverview('de_vertigo', vertigo, '1', options);
    expect(r.displayName).toBe('Vertigo');
    expect(r.pool).toBe('extra');
    // 11700 is larger than 10000 in magnitude, yet it is where the two floors meet: dropping it would make both
    // floors cover every height.
    expect(r.levels).toEqual([{ id: 'default', altitudeMin: 11700 }, { id: 'lower', altitudeMax: 11700 }]);
    expect(r.levels.map((l) => Object.keys(l))).toEqual([['id', 'altitudeMin'], ['id', 'altitudeMax']]);
    expect(levelFor(12000, r.levels)).toBe('default');
    expect(levelFor(11700, r.levels)).toBe('default');
    expect(levelFor(11699, r.levels)).toBe('lower');
    expect(levelFor(-3000, r.levels)).toBe('lower');
  });

  it('keeps a bound just under the limit and drops one at it, either sign', () => {
    const r = mapRecordFromOverview('de_nuke', withLevels([
      { id: 'default', altitudeMin: 9999, altitudeMax: 10000, radarSize: [1024, 1024] },
      { id: 'lower', altitudeMin: -10000, altitudeMax: -9999, radarSize: [1024, 1024] },
    ]), '1', options);
    expect(r.levels).toEqual([{ id: 'default', altitudeMin: 9999 }, { id: 'lower', altitudeMax: -9999 }]);
  });

  it('keeps large bounds that are not the outermost ones, even with a gap between the floors', () => {
    const r = mapRecordFromOverview('de_nuke', withLevels([
      { id: 'default', altitudeMin: 11700, altitudeMax: 20000, radarSize: [1024, 1024] },
      { id: 'lower', altitudeMin: -10000, altitudeMax: 11600, radarSize: [1024, 1024] },
    ]), '1', options);
    expect(r.levels).toEqual([{ id: 'default', altitudeMin: 11700 }, { id: 'lower', altitudeMax: 11600 }]);
  });

  it('drops both sentinels of a single level that has them', () => {
    const r = mapRecordFromOverview('de_dust2', withLevels([{ id: 'default', altitudeMin: -10000, altitudeMax: 10000, radarSize: [1024, 1024] }]), '1', options);
    expect(r.levels).toEqual([{ id: 'default' }]);
  });

  it('gives a single-level map one level with no altitude keys at all', () => {
    const r = mapRecordFromOverview('de_dust2', singleLevel, '26144732', options);
    expect(r.levels).toEqual([{ id: 'default' }]);
    expect(Object.keys(r.levels[0]!)).toEqual(['id']);
    expect(r.projection).toEqual({ posX: -2000, posY: 2000, scale: 4.4 });
    expect(r.displayName).toBe('Dust II');
  });

  it('takes radarSize from the first level', () => {
    const r = mapRecordFromOverview('de_dust2', withLevels([{ id: 'default', radarSize: [2048, 2048] }]), '1', options);
    expect(r.radarSize).toBe(2048);
  });

  it('writes the keys in the order the existing record has, so a diff against the Editor\'s files stays small', () => {
    const mirage = JSON.parse(dataText('maps/de_mirage.json')) as Record<string, unknown>;
    const r = mapRecordFromOverview('de_nuke', nuke, '1', options);
    expect(Object.keys(r)).toEqual(Object.keys(mirage));
  });

  it('reproduces data/maps/de_mirage.json byte for byte from its own numbers (stableJson formatting included)', () => {
    const text = dataText('maps/de_mirage.json');
    const mirage = JSON.parse(text) as { projection: { posX: number; posY: number; scale: number }; radarSize: number; gameBuild: string; zones: { name: string }[] };
    const entry = { ...mirage.projection, rotate: 0, levels: [{ id: 'default', radar: 'de_mirage.png', radarSize: [mirage.radarSize, mirage.radarSize] }] };
    const r = mapRecordFromOverview('de_mirage', entry, mirage.gameBuild, { index, zones: mirage.zones.map((z) => z.name) });
    expect(stableJson(r)).toBe(text);
  });

  it('makes a record the whole content check accepts, with only "zone-empty" warnings and no callouts', () => {
    for (const [id, entry] of [['de_nuke', nuke], ['de_vertigo', vertigo], ['de_dust2', singleLevel]] as const) {
      const r = mapRecordFromOverview(id, entry, '26144732', options);
      expect(MapSchema.safeParse(r).success).toBe(true);
      const parsed = parseMapData(JSON.parse(stableJson(r)), []);
      expect(parsed.issues.filter((i) => i.severity === 'error')).toEqual([]);
      expect(parsed.issues.map((i) => i.rule)).toEqual(zones.map(() => 'zone-empty'));
    }
  });

  it('does not change what it is given', () => {
    const before = JSON.stringify(nuke);
    const opts = { zones: [...zones], index: index.map((m) => ({ ...m })) };
    const snapshot = JSON.stringify(opts);
    mapRecordFromOverview('de_nuke', nuke, '1', opts);
    expect(JSON.stringify(nuke)).toBe(before);
    expect(JSON.stringify(opts)).toBe(snapshot);
  });

  it('works with the real index.json for a map the index lists', () => {
    const real = MapIndexSchema.parse(JSON.parse(dataText('index.json')));
    const r = mapRecordFromOverview('de_dust2', singleLevel, '1', { zones, index: real });
    expect(r.displayName).toBe('Dust II');
    expect(r.pool).toBe('active-duty');
  });

  describe('refuses clearly', () => {
    it('a map that index.json does not list, naming the ones it does', () => {
      const m = fails(() => mapRecordFromOverview('de_cobble', singleLevel, '1', options));
      expect(m).toContain('de_cobble is not listed in data/index.json');
      expect(m).toContain('de_nuke');
    });

    it('a map id that is not one', () => {
      expect(fails(() => mapRecordFromOverview('nuke', nuke, '1', options))).toContain('"nuke" is not a map id');
    });

    it('no zones at all, and says the zones are the owner\'s to choose', () => {
      expect(fails(() => mapRecordFromOverview('de_nuke', nuke, '1', { index, zones: [] }))).toMatch(/at least one zone.*yours to choose/);
    });

    it('zones that become the same id, a name over the limit, a name with nothing to slugify, a blank name', () => {
      expect(fails(() => zonesFromNames(['Mid', 'mid']))).toBe('zones "Mid" and "mid" both become the id "mid"');
      expect(fails(() => zonesFromNames(['A Site', 'a_site']))).toContain('both become the id "a-site"');
      expect(fails(() => zonesFromNames(['x'.repeat(29)]))).toContain('is 29 characters; the limit is 28');
      expect(fails(() => zonesFromNames(['!!!']))).toContain('no letters or digits');
      expect(fails(() => zonesFromNames(['Mid', '  ']))).toBe('a zone name is empty');
      expect(zonesFromNames(['x'.repeat(28)])).toHaveLength(1);
    });

    it('an empty game build', () => {
      expect(fails(() => mapRecordFromOverview('de_nuke', nuke, ' ', options))).toContain('empty gameBuildId');
    });

    it('an entry with a missing or wrong field, saying which one', () => {
      const { posX: _posX, ...noX } = nuke;
      expect(fails(() => mapRecordFromOverview('de_nuke', noX, '1', options))).toMatch(/de_nuke\.posX/);
      expect(fails(() => mapRecordFromOverview('de_nuke', { ...nuke, scale: 0 }, '1', options))).toMatch(/de_nuke\.scale/);
      expect(fails(() => mapRecordFromOverview('de_nuke', { ...nuke, posY: '2887' }, '1', options))).toMatch(/de_nuke\.posY/);
      expect(fails(() => mapRecordFromOverview('de_nuke', { ...nuke, levels: [] }, '1', options))).toMatch(/de_nuke\.levels/);
      expect(fails(() => mapRecordFromOverview('de_nuke', null, '1', options))).toContain('not usable');
      expect(fails(() => mapRecordFromOverview('de_nuke', withLevels([{ id: 'default', radarSize: [1024, 'big'] }]), '1', options))).toMatch(/levels\[0\]\.radarSize\[1\]/);
    });

    it('a first level without radarSize rather than guessing 1024', () => {
      expect(fails(() => mapRecordFromOverview('de_nuke', withLevels([{ id: 'default', radar: null }]), '1', options))).toContain('first level has no radarSize');
    });

    it('a radar that is not square', () => {
      expect(fails(() => mapRecordFromOverview('de_nuke', withLevels([{ id: 'default', radarSize: [1024, 512] }]), '1', options))).toContain('1024x512');
    });

    it('two levels with one id, and a level that covers no height', () => {
      const l = (id: string) => ({ id, radarSize: [1024, 1024] });
      expect(fails(() => mapRecordFromOverview('de_nuke', withLevels([l('default'), l('default')]), '1', options))).toContain('two levels are called "default"');
      const flat = { id: 'lower', altitudeMin: -100, altitudeMax: -495, radarSize: [1024, 1024] };
      expect(fails(() => mapRecordFromOverview('de_nuke', withLevels([flat]), '1', options))).toContain('covers no height');
    });

    it('a level id the schema would reject, by reporting the schema\'s message', () => {
      expect(fails(() => mapRecordFromOverview('de_nuke', withLevels([{ id: 'Lower Level', radarSize: [1024, 1024] }]), '1', options))).toMatch(/map schema.*levels\[0\]\.id/);
    });
  });
});

describe('overviewWarnings', () => {
  it('has nothing to say about the normal shapes', () => {
    expect(overviewWarnings('de_nuke', nuke)).toEqual([]);
    expect(overviewWarnings('de_vertigo', vertigo)).toEqual([]);
    expect(overviewWarnings('de_dust2', singleLevel)).toEqual([]);
  });

  it('flags a rotation, a first level that is not "default", and radar sizes that differ between levels', () => {
    expect(overviewWarnings('de_nuke', { ...nuke, rotate: 1 })).toEqual([expect.stringContaining('rotate 1')]);
    const swapped = { ...nuke, levels: [...nuke.levels].reverse() };
    expect(overviewWarnings('de_nuke', swapped)).toEqual([expect.stringContaining('first level is "lower"')]);
    const mixed = { ...nuke, levels: [nuke.levels[0], { ...nuke.levels[1]!, radarSize: [512, 512] }] };
    expect(overviewWarnings('de_nuke', mixed)).toEqual([expect.stringContaining('1024x1024, 512x512')]);
  });
});

describe('findOverview', () => {
  const file = { gameBuildId: '26144732', maps: { de_nuke: nuke, de_vertigo: vertigo } };

  it('returns the entry and the game build the file was made from', () => {
    expect(findOverview(file, 'de_vertigo')).toEqual({ gameBuildId: '26144732', entry: vertigo });
  });

  it('names the maps the file does have when the one asked for is missing', () => {
    expect(fails(() => findOverview(file, 'de_mirage'))).toBe('de_mirage is not in the overview file (it has: de_nuke, de_vertigo)');
  });

  it('is not stopped by a bad entry for another map', () => {
    const f = { gameBuildId: '1', maps: { de_nuke: nuke, de_broken: { posX: 'x' } } };
    expect(findOverview(f, 'de_nuke').entry).toBe(nuke);
  });

  it('rejects a file that is not the expected shape, saying where', () => {
    expect(fails(() => findOverview({ maps: {} }, 'de_nuke'))).toContain('overviews.gameBuildId');
    expect(fails(() => findOverview({ gameBuildId: '1' }, 'de_nuke'))).toContain('overviews.maps');
    expect(fails(() => findOverview([], 'de_nuke'))).toContain('not the expected shape');
    expect(fails(() => findOverview({ gameBuildId: 26144732, maps: {} }, 'de_nuke'))).toContain('overviews.gameBuildId');
  });
});

describe('parseZoneList', () => {
  it('splits on commas, trims, keeps the order and drops empty items', () => {
    expect(parseZoneList(' A Site , Mid,B Site,, ')).toEqual(['A Site', 'Mid', 'B Site']);
    expect(parseZoneList('')).toEqual([]);
    expect(parseZoneList(' , ')).toEqual([]);
  });

  it('makes ids with the Editor\'s slugify', () => {
    const names = parseZoneList("T Spawn, Mid, CT Spawn, Banana's Café");
    expect(zonesFromNames(names).map((z) => z.id)).toEqual(names.map(slugify));
    expect(zonesFromNames(names).map((z) => z.id)).toEqual(['t-spawn', 'mid', 'ct-spawn', 'bananas-cafe']);
  });
});

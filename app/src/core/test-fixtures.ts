// A tiny synthetic map for tests. It is not Mirage and its names are not real callouts: it only has to be
// valid, connected and big enough to exercise the validator, the session builder and the mastery rules.
// Layout (world units, 200 wide cells; y grows north):
//
//   y 200-400:   b-apps   b-site   connector
//   y   0-200:   t-spawn  mid      a-ramp   a-site (+ bench, a Hard spot)   palace sits above a-site
//
// Every function returns fresh objects so a test can change them freely.

import type { Callout, MapRecord } from './schema';

export function makeMap(): MapRecord {
  return {
    id: 'de_test',
    displayName: 'Test',
    pool: 'extra',
    projection: { posX: -1000, posY: 1000, scale: 2 },
    radarSize: 1024,
    levels: [{ id: 'default' }],
    gameBuild: '0000',
    revision: 1,
    zones: [
      { id: 'spawn', name: 'Spawn' },
      { id: 'mid', name: 'Mid' },
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ],
    status: 'draft',
  };
}

type Cell = { x: number; y: number; w?: number; h?: number };

function rect({ x, y, w = 200, h = 200 }: Cell): [number, number][] {
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
}

function shotsFor(slug: string, cell: Cell, count: number): Callout['shots'] {
  const kinds = ['approach', 'inside', 'alternate', 'overview'] as const;
  return Array.from({ length: count }, (_, i) => ({
    file: `test/${slug}-${i + 1}.avif`,
    pos: [cell.x + 20 + i, cell.y + 20, 64] as [number, number, number],
    yaw: 10 * i,
    pitch: 0,
    stance: 'stand' as const,
    kind: kinds[i % kinds.length] as (typeof kinds)[number],
    captured: '2026-11-01',
    build: '0000',
  }));
}

function make(
  slug: string,
  name: string,
  zone: string,
  tier: 1 | 2 | 3,
  cell: Cell,
  order: number,
  neighbours: string[],
  extra: Partial<Callout> = {},
): Callout {
  const w = cell.w ?? 200;
  const h = cell.h ?? 200;
  return {
    id: `test.${slug}`,
    map: 'de_test',
    name,
    aliases: [],
    zone,
    tier,
    level: 'default',
    region: rect(cell),
    anchor: [cell.x + w / 2, cell.y + h / 2],
    parent: null,
    gameplaceName: null,
    blurb: `${name} in the test map.`,
    neighbours: neighbours.map((n) => `test.${n}`),
    shots: shotsFor(slug, cell, tier === 3 ? 2 : 3),
    status: 'draft',
    order,
    ...extra,
  };
}

/** Nine standard callouts and one Hard spot, `draft`. */
export function makeCallouts(): Callout[] {
  return [
    make('t-spawn', 'T Spawn', 'spawn', 1, { x: 0, y: 0 }, 0, ['mid']),
    make('mid', 'Mid', 'mid', 1, { x: 200, y: 0 }, 0, ['t-spawn', 'a-ramp', 'connector', 'b-site'], { aliases: ['Middle'] }),
    make('a-ramp', 'A Ramp', 'a', 1, { x: 400, y: 0 }, 0, ['mid', 'a-site'], { aliases: ['Ramp'] }),
    make('a-site', 'A Site', 'a', 1, { x: 600, y: 0 }, 1, ['a-ramp', 'palace']),
    make('palace', 'Palace', 'a', 2, { x: 600, y: 200 }, 2, ['a-site'], { aliases: ['Pal'] }),
    make('connector', 'Connector', 'mid', 2, { x: 400, y: 200 }, 1, ['mid', 'b-site']),
    make('b-site', 'B Site', 'b', 1, { x: 200, y: 200 }, 0, ['mid', 'connector', 'b-apps']),
    make('b-apps', 'B Apartments', 'b', 2, { x: 0, y: 200 }, 1, ['b-site'], { aliases: ['Apps'] }),
    make('bench', 'Bench', 'a', 3, { x: 650, y: 50, w: 50, h: 50 }, 3, [], { parent: 'test.a-site' }),
  ];
}

export function makeTestData(): { map: MapRecord; callouts: Callout[] } {
  return { map: makeMap(), callouts: makeCallouts() };
}

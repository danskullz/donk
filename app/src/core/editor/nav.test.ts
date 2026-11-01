import { describe, expect, it } from 'vitest';
import { areaAt, areasWithin, buildNavIndex, contactBetween, contactKey, floodFill, NavMeshSchema, type NavMesh } from './nav';
import { gridIds, makeGridMesh } from './test-fixtures';

const one = [{ id: 'default' }];
const grid = (o: Parameters<typeof makeGridMesh>[0]) => {
  const { mesh, ids } = makeGridMesh(o);
  return { mesh, ids, index: buildNavIndex(mesh, one) };
};

describe('NavMeshSchema', () => {
  it('accepts the real shape and refuses a polygon that points past the vertex list', () => {
    const { mesh } = makeGridMesh({ cols: 2, rows: 1 });
    expect(NavMeshSchema.safeParse(mesh).success).toBe(true);
    expect(NavMeshSchema.safeParse({ ...mesh, polygons: [[0, 1, 99]] }).success).toBe(false);
    expect(NavMeshSchema.safeParse({ ...mesh, polygons: [[0, 1]] }).success).toBe(false);
  });
});

describe('buildNavIndex', () => {
  it('makes every area counter-clockwise, with its centre, height and size', () => {
    const mesh: NavMesh = { map: 'x', vertices: [[0, 0, 10], [0, 10, 10], [10, 10, 10], [10, 0, 10]], polygons: [[0, 1, 2, 3]] };
    const a = buildNavIndex(mesh, one).areas[0]!;
    expect(a.size).toBe(100);
    expect(a.centroid).toEqual([5, 5]);
    expect(a.z).toBe(10);
    expect(a.outline).toEqual([[10, 0], [10, 10], [0, 10], [0, 0]]);
  });

  it('assigns each area to a level by its height', () => {
    const mesh: NavMesh = { map: 'x', vertices: [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 100, -400], [10, 100, -400], [10, 110, -400]], polygons: [[0, 1, 2], [3, 4, 5]] };
    const index = buildNavIndex(mesh, [{ id: 'default', altitudeMin: -200 }, { id: 'lower', altitudeMax: -200 }]);
    expect(index.areas.map((a) => a.level)).toEqual(['default', 'lower']);
  });
});

describe('adjacency', () => {
  const { index, ids } = grid({ cols: 4, rows: 3 });
  const id = (n: string) => gridIds(ids, n)[0]!;

  it('joins areas along a shared edge, not at a corner', () => {
    expect(index.neighbours[id('1,1')]).toEqual(['0,1', '1,0', '2,1', '1,2'].map(id).sort((a, b) => a - b));
    expect(index.neighbours[id('0,0')]).toEqual(['1,0', '0,1'].map(id).sort((a, b) => a - b));
    expect(index.neighbours[id('0,0')]).not.toContain(id('1,1'));
  });

  it('measures the shared edge', () => {
    expect(index.contact.get(contactKey(id('1,1'), id('2,1')))).toBeCloseTo(100);
  });

  it('joins across T-junctions: one long edge against two short ones', () => {
    const t = grid({ cols: 5, rows: 2, halfFrom: 2, halfCols: 1 });
    const full = gridIds(t.ids, '1,0')[0]!;
    const [a, b] = gridIds(t.ids, '2,0a', '2,0b') as [number, number];
    expect(t.index.neighbours[full]).toContain(a);
    expect(t.index.neighbours[full]).toContain(b);
    expect(t.index.contact.get(contactKey(full, a))).toBeCloseTo(50);
    expect(t.index.contact.get(contactKey(full, b))).toBeCloseTo(50);
    // the two halves touch each other, and the full area on the far side meets both
    expect(t.index.neighbours[a]).toContain(b);
    expect(t.index.neighbours[gridIds(t.ids, '3,0')[0]!]).toEqual(expect.arrayContaining([a, b]));
  });

  it('does not join areas at different heights, but does across a step', () => {
    const mesh: NavMesh = {
      map: 'x',
      vertices: [[0, 0, 0], [100, 0, 0], [100, 100, 0], [0, 100, 0], [100, 0, 100], [200, 0, 100], [200, 100, 100], [100, 100, 100], [100, 0, 10], [200, 0, 10], [200, 100, 10], [100, 100, 10]],
      polygons: [[0, 1, 2, 3], [4, 5, 6, 7], [8, 9, 10, 11]],
    };
    const index = buildNavIndex(mesh, one);
    expect(index.neighbours[0]).toEqual([2]);
    expect(index.neighbours[1]).toEqual([]);
  });
});

describe('areaAt and areasWithin', () => {
  const { index, ids } = grid({ cols: 4, rows: 3 });
  const id = (n: string) => gridIds(ids, n)[0]!;

  it('finds the area under a point, and nothing off the mesh', () => {
    expect(areaAt(index, 150, 150)).toBe(id('1,1'));
    expect(areaAt(index, 50, 50)).toBe(id('0,0'));
    expect(areaAt(index, 5000, 5000)).toBeNull();
    expect(areaAt(index, -10, 50)).toBeNull();
  });

  it('prefers the highest floor, and can be told which level to look on', () => {
    const mesh: NavMesh = { map: 'x', vertices: [[0, 0, 0], [100, 0, 0], [100, 100, 0], [0, 100, 0], [0, 0, 300], [100, 0, 300], [100, 100, 300], [0, 100, 300]], polygons: [[0, 1, 2, 3], [4, 5, 6, 7]] };
    const levels = [{ id: 'low', altitudeMax: 100 }, { id: 'high', altitudeMin: 100 }];
    const two = buildNavIndex(mesh, levels);
    expect(areaAt(two, 50, 50)).toBe(1);
    expect(areaAt(two, 50, 50, 'low')).toBe(0);
    expect(areaAt(two, 50, 50, 'high')).toBe(1);
  });

  it('collects the areas a round brush touches', () => {
    expect(areasWithin(index, 150, 150, 1)).toEqual([id('1,1')]);
    // a brush on a corner touches the four areas around it
    expect(areasWithin(index, 100, 100, 5)).toEqual(['0,0', '1,0', '0,1', '1,1'].map(id).sort((a, b) => a - b));
    expect(areasWithin(index, 150, 150, 80).length).toBeGreaterThan(5);
    expect(areasWithin(index, 5000, 5000, 20)).toEqual([]);
  });
});

describe('floodFill', () => {
  const { index, ids } = grid({ cols: 8, rows: 4 });
  const id = (n: string) => gridIds(ids, n)[0]!;

  it('fills what is connected and near, and stops at the radius', () => {
    const near = floodFill(index, id('0,0'), { radius: 150 });
    // centroids within 150 of (50, 50): (50,50) (150,50) (50,150) (150,150) are at 0, 100, 100, 141
    expect(near).toEqual(['0,0', '1,0', '0,1', '1,1'].map(id).sort((a, b) => a - b));
    expect(floodFill(index, id('0,0'), { radius: 1e6 })).toHaveLength(32);
  });

  it('does not enter blocked areas, so a wall of them contains the fill', () => {
    const wall = new Set(['3,0', '3,1', '3,2', '3,3'].map(id));
    const left = floodFill(index, id('0,0'), { radius: 1e6, blocked: wall });
    expect(left).toHaveLength(12);
    expect(left).not.toContain(id('4,0'));
  });

  it('stays on one level', () => {
    const mesh: NavMesh = { map: 'x', vertices: [[0, 0, 0], [100, 0, 0], [100, 100, 0], [0, 100, 0], [100, 0, 5], [200, 0, 5], [200, 100, 5], [100, 100, 5]], polygons: [[0, 1, 2, 3], [4, 5, 6, 7]] };
    const two = buildNavIndex(mesh, [{ id: 'a', altitudeMax: 3 }, { id: 'b', altitudeMin: 3 }]);
    expect(floodFill(two, 0, { radius: 1e6 })).toEqual([0, 1]);
    expect(floodFill(two, 0, { radius: 1e6, level: 'a' })).toEqual([0]);
  });

  it('returns nothing for an area that does not exist', () => {
    expect(floodFill(index, 9999, { radius: 100 })).toEqual([]);
  });
});

describe('contactBetween', () => {
  it('adds up the edge two groups of areas share', () => {
    const { index, ids } = grid({ cols: 4, rows: 2 });
    const left = gridIds(ids, '0,0', '1,0', '0,1', '1,1');
    const right = new Set(gridIds(ids, '2,0', '2,1', '3,0', '3,1'));
    expect(contactBetween(index, left, right)).toBeCloseTo(200);
    expect(contactBetween(index, left, new Set())).toBe(0);
  });
});

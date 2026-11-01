// silhouetteLoops: every boundary loop of a whole walkable surface, for the map art (SCOPE.md §3.6).
// `outlineOf` (outline.test.ts) keeps one polygon for a callout; these tests cover what it drops.

import { describe, expect, it } from 'vitest';
import { polygonArea, type Point } from '../geometry';
import { buildNavIndex, type NavMesh } from './nav';
import { silhouetteLoops } from './outline';
import { gridIds, makeGridMesh } from './test-fixtures';

const one = [{ id: 'default' }];

function loopsOf(opts: Parameters<typeof makeGridMesh>[0], names: string[] | null, simplify?: number, minArea?: number) {
  const { mesh, ids } = makeGridMesh(opts);
  const index = buildNavIndex(mesh, one);
  const areas = names ? gridIds(ids, ...names).map((i) => index.areas[i]!) : index.areas;
  return silhouetteLoops(areas, { ...(simplify !== undefined ? { simplify } : {}), ...(minArea !== undefined ? { minArea } : {}) });
}

const signed = (r: readonly Point[]) => {
  let s = 0;
  r.forEach(([x, y], i) => (s += x * r[(i + 1) % r.length]![1] - r[(i + 1) % r.length]![0] * y));
  return s / 2;
};

const signedTotal = (loops: readonly (readonly Point[])[]) => loops.reduce((s, l) => s + signed(l), 0);

/** Winding number of the loops around a point: what the non-zero fill rule asks. */
function winding(p: Point, loops: readonly (readonly Point[])[]): number {
  let w = 0;
  for (const ring of loops) {
    for (let i = 0; i < ring.length; i++) {
      const [x1, y1] = ring[i]!;
      const [x2, y2] = ring[(i + 1) % ring.length]!;
      const side = (x2 - x1) * (p[1] - y1) - (p[0] - x1) * (y2 - y1);
      if (y1 <= p[1]) {
        if (y2 > p[1] && side > 0) w += 1;
      } else if (y2 <= p[1] && side < 0) w -= 1;
    }
  }
  return w;
}

describe('silhouetteLoops', () => {
  it('is nothing for nothing', () => {
    expect(silhouetteLoops([])).toEqual([]);
  });

  it('is one counter-clockwise loop of four corners for a block of areas, seams gone', () => {
    const loops = loopsOf({ cols: 4, rows: 4 }, ['1,1', '2,1', '1,2', '2,2']);
    expect(loops).toHaveLength(1);
    expect(loops[0]).toHaveLength(4);
    expect(signed(loops[0]!)).toBe(40000);
  });

  it('keeps a hole as a clockwise loop of its own, which outlineOf drops', () => {
    const ring = ['0,0', '1,0', '2,0', '0,1', '2,1', '0,2', '1,2', '2,2'];
    const loops = loopsOf({ cols: 3, rows: 3 }, ring);
    expect(loops.map(signed).sort((a, b) => a - b)).toEqual([-10000, 90000]);
    expect(winding([150, 150], loops)).toBe(0);
    expect(winding([50, 50], loops)).toBe(1);
  });

  it('keeps pieces that are not connected, the way the game links ledges by jumping', () => {
    const loops = loopsOf({ cols: 6, rows: 2 }, ['0,0', '1,0', '0,1', '1,1', '5,0']);
    expect(loops.map((l) => polygonArea(l)).sort((a, b) => a - b)).toEqual([10000, 40000]);
  });

  it('closes up the seams across T-junctions', () => {
    const loops = loopsOf({ cols: 4, rows: 2, halfFrom: 2, halfCols: 1 }, ['1,0', '1,1', '2,0a', '2,0b', '2,1a', '2,1b']);
    expect(loops).toHaveLength(1);
    expect(loops[0]).toHaveLength(4);
    expect(polygonArea(loops[0]!)).toBe(40000);
  });

  it('covers the whole mesh with the loops of a mesh that has T-junctions and holes', () => {
    const loops = loopsOf({ cols: 8, rows: 4, halfFrom: 3, halfCols: 2 }, null);
    expect(loops).toHaveLength(1);
    expect(polygonArea(loops[0]!)).toBe(8 * 4 * 10000);
  });

  it('unions floors that overlap: loops cross and the non-zero rule fills the union', () => {
    // two squares at different heights, the second shifted half way over the first
    const mesh: NavMesh = {
      map: 'x',
      vertices: [[0, 0, 0], [100, 0, 0], [100, 100, 0], [0, 100, 0], [50, 0, 80], [150, 0, 80], [150, 100, 80], [50, 100, 80]],
      polygons: [[0, 1, 2, 3], [4, 5, 6, 7]],
    };
    const loops = silhouetteLoops(buildNavIndex(mesh, one).areas);
    // (how the boundary is cut into loops where the two outlines touch does not matter; the winding does)
    expect(signedTotal(loops)).toBe(20000);
    expect(winding([25, 50], loops)).toBe(1);
    expect(winding([75, 50], loops)).toBe(2);
    expect(winding([125, 50], loops)).toBe(1);
    expect(winding([175, 50], loops)).toBe(0);
    expect(winding([75, 150], loops)).toBe(0);
  });

  it('counts an edge that stacked areas repeat, so no loop is lost', () => {
    // the same square twice, at two heights: both boundaries stay, none cancels the other
    const mesh: NavMesh = {
      map: 'x',
      vertices: [[0, 0, 0], [100, 0, 0], [100, 100, 0], [0, 100, 0], [0, 0, 90], [100, 0, 90], [100, 100, 90], [0, 100, 90]],
      polygons: [[0, 1, 2, 3], [4, 5, 6, 7], [1, 8, 9, 2]],
    };
    mesh.vertices.push([200, 0, 0], [200, 100, 0]);
    const loops = silhouetteLoops(buildNavIndex(mesh, one).areas);
    // the third square (100..200) meets both stacked squares along x = 100
    expect(signedTotal(loops)).toBe(3 * 10000);
    expect(winding([50, 50], loops)).toBe(2);
    expect(winding([150, 50], loops)).toBe(1);
  });

  it('leaves out loops smaller than minArea', () => {
    const loops = loopsOf({ cols: 6, rows: 2 }, ['0,0', '1,0', '0,1', '1,1', '5,0'], undefined, 20000);
    expect(loops).toHaveLength(1);
    expect(polygonArea(loops[0]!)).toBe(40000);
  });

  it('simplifies a staircase edge with the tolerance given', () => {
    const vertices: [number, number, number][] = [];
    const polygons: number[][] = [];
    for (let i = 0; i < 12; i++) {
      const b = vertices.length;
      vertices.push([i * 10, 0, 0], [i * 10 + 10, 0, 0], [i * 10 + 10, 10 * (i + 1), 0], [i * 10, 10 * (i + 1), 0]);
      polygons.push([b, b + 1, b + 2, b + 3]);
    }
    const areas = buildNavIndex({ map: 'x', vertices, polygons }, one).areas;
    const fine = silhouetteLoops(areas, { simplify: 0.1 })[0]!;
    const coarse = silhouetteLoops(areas, { simplify: 8 })[0]!;
    expect(coarse.length).toBeLessThan(fine.length);
    expect(Math.abs(polygonArea(coarse) - polygonArea(fine))).toBeLessThan(0.1 * polygonArea(fine));
  });
});

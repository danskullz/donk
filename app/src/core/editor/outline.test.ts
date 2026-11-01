import { describe, expect, it } from 'vitest';
import { isSimplePolygon, pointInPolygon, polygonArea } from '../geometry';
import { buildNavIndex } from './nav';
import { outlineOf } from './outline';
import { gridIds, makeGridMesh } from './test-fixtures';

const one = [{ id: 'default' }];

function paint(opts: Parameters<typeof makeGridMesh>[0], ...names: string[]) {
  const { mesh, ids } = makeGridMesh(opts);
  const index = buildNavIndex(mesh, one);
  return outlineOf(gridIds(ids, ...names).map((i) => index.areas[i]!));
}

const corners = (p: readonly (readonly [number, number])[]) => p.map(([x, y]) => `${x},${y}`).sort();

describe('outlineOf', () => {
  it('is nothing for nothing', () => {
    expect(outlineOf([])).toEqual({ polygon: null, dropped: 0 });
  });

  it('is the four corners of a block of areas, with the seams gone', () => {
    const o = paint({ cols: 4, rows: 4 }, '1,1', '2,1', '1,2', '2,2');
    expect(o.dropped).toBe(0);
    expect(corners(o.polygon!)).toEqual(['100,100', '100,300', '300,100', '300,300']);
    expect(polygonArea(o.polygon!)).toBe(40000);
  });

  it('is one corner for a single area, and is counter-clockwise', () => {
    const o = paint({ cols: 2, rows: 2 }, '0,0');
    expect(o.polygon).toHaveLength(4);
    let s = 0;
    const p = o.polygon!;
    p.forEach(([x, y], i) => (s += x * p[(i + 1) % p.length]![1] - p[(i + 1) % p.length]![0] * y));
    expect(s).toBeGreaterThan(0);
  });

  it('keeps an L shape as six corners', () => {
    const o = paint({ cols: 4, rows: 4 }, '0,0', '1,0', '2,0', '0,1', '0,2');
    expect(o.polygon).toHaveLength(6);
    expect(polygonArea(o.polygon!)).toBe(5 * 10000);
    expect(isSimplePolygon(o.polygon!)).toBe(true);
  });

  it('closes up the seam across T-junctions', () => {
    // a full column next to a band of half-height areas: the shared edge is split unevenly
    const o = paint({ cols: 4, rows: 2, halfFrom: 2, halfCols: 1 }, '1,0', '1,1', '2,0a', '2,0b', '2,1a', '2,1b');
    expect(o.dropped).toBe(0);
    expect(corners(o.polygon!)).toEqual(['100,0', '100,200', '300,0', '300,200']);
    expect(polygonArea(o.polygon!)).toBe(40000);
  });

  it('closes up a seam where one area overlaps only part of another edge', () => {
    // a 100-tall area next to areas of height 50 that start half way up: one edge, three different spans
    const { mesh } = makeGridMesh({ cols: 1, rows: 1 });
    const extra = { map: 'x', vertices: [...mesh.vertices, [100, 50, 0], [200, 50, 0], [200, 150, 0], [100, 150, 0]] as [number, number, number][], polygons: [...mesh.polygons, [4, 5, 6, 7]] };
    const index = buildNavIndex(extra, one);
    const o = outlineOf(index.areas);
    expect(o.dropped).toBe(0);
    expect(polygonArea(o.polygon!)).toBe(100 * 100 + 100 * 100);
    expect(isSimplePolygon(o.polygon!)).toBe(true);
  });

  it('fills a hole and says so', () => {
    const ring = ['0,0', '1,0', '2,0', '0,1', '2,1', '0,2', '1,2', '2,2'];
    const o = paint({ cols: 3, rows: 3 }, ...ring);
    expect(o.dropped).toBe(1);
    expect(polygonArea(o.polygon!)).toBe(90000);
  });

  it('keeps the biggest piece when the areas are not all connected, and counts the rest', () => {
    const o = paint({ cols: 6, rows: 2 }, '0,0', '1,0', '0,1', '1,1', '5,0');
    expect(o.dropped).toBe(1);
    expect(polygonArea(o.polygon!)).toBe(40000);
  });

  it('treats areas that only touch at a corner as separate pieces', () => {
    const o = paint({ cols: 2, rows: 2 }, '0,0', '1,1');
    expect(o.dropped).toBe(1);
    expect(polygonArea(o.polygon!)).toBe(10000);
  });

  it('keeps every painted area inside the outline of a blob', () => {
    const names: string[] = [];
    for (let r = 0; r < 5; r++) for (let c = 0; c < 6; c++) if ((c - 2.5) ** 2 + (r - 2) ** 2 < 6) names.push(`${c},${r}`);
    const { mesh, ids } = makeGridMesh({ cols: 6, rows: 5 });
    const index = buildNavIndex(mesh, one);
    const areas = gridIds(ids, ...names).map((i) => index.areas[i]!);
    const o = outlineOf(areas);
    expect(o.dropped).toBe(0);
    expect(isSimplePolygon(o.polygon!)).toBe(true);
    for (const a of areas) expect(pointInPolygon(a.centroid, o.polygon!)).toBe(true);
    expect(polygonArea(o.polygon!)).toBeCloseTo(areas.length * 10000, 0);
  });

  it('simplifies a staircase edge but never past the tolerance, and stays simple', () => {
    // a diagonal run of 10-unit steps: 1-unit tolerance keeps the steps, a coarse tolerance flattens them
    const vertices: [number, number, number][] = [];
    const polygons: number[][] = [];
    for (let i = 0; i < 12; i++) {
      const b = vertices.length;
      vertices.push([i * 10, 0, 0], [i * 10 + 10, 0, 0], [i * 10 + 10, 10 * (i + 1), 0], [i * 10, 10 * (i + 1), 0]);
      polygons.push([b, b + 1, b + 2, b + 3]);
    }
    const index = buildNavIndex({ map: 'x', vertices, polygons }, one);
    const fine = outlineOf(index.areas, { simplify: 1 });
    const coarse = outlineOf(index.areas, { simplify: 8 });
    expect(fine.polygon!.length).toBeGreaterThan(coarse.polygon!.length);
    expect(isSimplePolygon(fine.polygon!)).toBe(true);
    expect(isSimplePolygon(coarse.polygon!)).toBe(true);
    expect(Math.abs(polygonArea(coarse.polygon!) - polygonArea(fine.polygon!))).toBeLessThan(0.1 * polygonArea(fine.polygon!));
  });
});

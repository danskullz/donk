import { describe, expect, it } from 'vitest';
import type { NavMesh } from '../../src/core/editor/nav';
import { makeGridMesh } from '../../src/core/editor/test-fixtures';
import { polygonArea } from '../../src/core/geometry';
import { buildArt, parsePathData, pathBounds, pathData } from './art';

describe('pathData', () => {
  it('writes absolute M and relative l, in tenths of a pixel, and reads back', () => {
    const d = pathData([[[10, 20], [14.25, 20], [14.25, 17.5], [10, 17.5]]]);
    expect(d).toBe('M10 20l4.3 0 0-2.5-4.3 0z');
    expect(parsePathData(d)).toEqual([[[10, 20], [14.3, 20], [14.3, 17.5], [10, 17.5]]]);
  });

  it('writes numbers under one as .5 and -.5, and zero as 0', () => {
    const d = pathData([[[0, 0], [0.5, 0], [0.5, -0.5], [0, -0.5]]]);
    expect(d).toBe('M0 0l.5 0 0-.5-.5 0z');
    expect(parsePathData(d)[0]).toEqual([[0, 0], [0.5, 0], [0.5, -0.5], [0, -0.5]]);
  });

  it('keeps several loops as sub-paths and drops loops that collapse when rounded', () => {
    const d = pathData([
      [[0, 0], [10, 0], [10, 10]],
      [[5, 5], [5.01, 5], [5, 5.01]],
      [[20, 20], [30, 20], [30, 30], [20, 30]],
    ]);
    expect(parsePathData(d)).toHaveLength(2);
    expect(d.match(/z/g)).toHaveLength(2);
  });

  it('does not repeat a closing corner or a corner twice in a row', () => {
    const d = pathData([[[0, 0], [10, 0], [10, 0.04], [10, 10], [0, 0]]]);
    expect(parsePathData(d)[0]).toEqual([[0, 0], [10, 0], [10, 10]]);
  });

  it('survives a long walk without drifting: deltas are taken between rounded corners', () => {
    const loop: [number, number][] = [];
    for (let i = 0; i < 400; i++) loop.push([i * 0.333, Math.sin(i / 7) * 40 + 60]);
    loop.push([130, 130], [0, 130]);
    const back = parsePathData(pathData([loop]))[0]!;
    loop.forEach(([x, y], i) => {
      expect(Math.abs(back[i]![0] - x)).toBeLessThanOrEqual(0.05 + 1e-9);
      expect(Math.abs(back[i]![1] - y)).toBeLessThanOrEqual(0.05 + 1e-9);
    });
  });

  it('makes only characters the schema allows', () => {
    expect(pathData([[[1, 2], [3, 4], [5, -6]]])).toMatch(/^M[MmLlZz0-9\s.,-]*$/);
  });
});

describe('pathBounds', () => {
  it('is the box around every loop', () => {
    expect(pathBounds('M1 2l3 4 5-6zM-2 0l1 1 1 -1z')).toEqual({ minX: -2, minY: 0, maxX: 9, maxY: 6 });
  });
});

const proj = { posX: -1000, posY: 1000, scale: 2 };

describe('buildArt', () => {
  it('draws a grid mesh as its outline in radar pixels, with the y axis flipped', () => {
    // 800 x 400 world units at the origin: x (0+1000)/2 = 500 to (800+1000)/2 = 900, y (1000-400)/2 = 300 to (1000-0)/2 = 500
    const { mesh } = makeGridMesh({ cols: 8, rows: 4 });
    const art = buildArt(mesh, proj, [{ id: 'default' }]);
    expect(Object.keys(art)).toEqual(['default']);
    const loops = parsePathData(art['default']!.path);
    expect(loops).toHaveLength(1);
    expect(pathBounds(art['default']!.path)).toEqual({ minX: 500, minY: 300, maxX: 900, maxY: 500 });
    expect(polygonArea(loops[0]!)).toBe(400 * 200);
    expect(art['default']).toMatchObject({ loops: 1, areas: 32 });
  });

  it('keeps a courtyard as a hole', () => {
    const names: [number, number][] = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) if (!(r === 1 && c === 1)) names.push([c, r]);
    const full = makeGridMesh({ cols: 3, rows: 3 }).mesh;
    const mesh: NavMesh = { ...full, polygons: full.polygons.filter((_, i) => i !== 4) };
    const art = buildArt(mesh, proj, [{ id: 'default' }]);
    expect(art['default']!.loops).toBe(2);
  });

  it('splits levels by altitude and leaves out a level with no areas', () => {
    const upper = makeGridMesh({ cols: 2, rows: 2, z: 100 }).mesh;
    const lower = makeGridMesh({ cols: 2, rows: 2, z: -300, origin: [400, 0] }).mesh;
    const mesh: NavMesh = {
      map: 'x',
      vertices: [...upper.vertices, ...lower.vertices],
      polygons: [...upper.polygons, ...lower.polygons.map((p) => p.map((i) => i + upper.vertices.length))],
    };
    const levels = [{ id: 'default', altitudeMin: -100, altitudeMax: 10000 }, { id: 'lower', altitudeMin: -10000, altitudeMax: -100 }, { id: 'attic', altitudeMin: 10000, altitudeMax: 20000 }];
    const art = buildArt(mesh, proj, levels);
    expect(Object.keys(art)).toEqual(['default', 'lower']);
    expect(pathBounds(art['default']!.path)).toMatchObject({ minX: 500, maxX: 600 });
    expect(pathBounds(art['lower']!.path)).toMatchObject({ minX: 700, maxX: 800 });
  });

  it('leaves out specks under minArea', () => {
    const speck = makeGridMesh({ cols: 1, rows: 1, size: 4, origin: [-200, 0] }).mesh; // 2 x 2 radar px = 4 px^2
    const block = makeGridMesh({ cols: 2, rows: 2 }).mesh;
    const mesh: NavMesh = { map: 'x', vertices: [...block.vertices, ...speck.vertices], polygons: [...block.polygons, ...speck.polygons.map((p) => p.map((i) => i + block.vertices.length))] };
    expect(buildArt(mesh, proj, [{ id: 'default' }], { minArea: 2 })['default']!.loops).toBe(2);
    expect(buildArt(mesh, proj, [{ id: 'default' }], { minArea: 5 })['default']!.loops).toBe(1);
  });
});

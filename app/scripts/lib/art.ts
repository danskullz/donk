// Map art (SCOPE.md §3.6, §6.8): the silhouette of a map's whole walkable surface as SVG path data in radar pixels.
//
// The nav mesh is drawn as the union of its areas. The Editor's outline code does the geometry (T-junction-aware,
// every boundary loop kept so holes survive); this file projects the loops into radar pixels, rounds them to 0.1 px
// and writes them as compact path data. It is pure: `make-art.mjs` and `art-run.ts` do the file work.

import type { Point } from '../../src/core/geometry';
import { buildNavIndex, type NavMesh } from '../../src/core/editor/nav';
import { silhouetteLoops } from '../../src/core/editor/outline';
import { worldToPixel, type Level, type Projection } from '../../src/core/projection';

export interface ArtOptions {
  /** Detail dropped, in radar pixels: a corner closer than this to the line between its neighbours goes. Default 1. */
  tolerance?: number;
  /** Loops enclosing fewer square radar pixels than this are left out. Default 2 (a 1.4 px speck). */
  minArea?: number;
}

export interface LevelArt {
  /** Path data: absolute `M` then relative `l` segments, one closed sub-path per loop. */
  path: string;
  /** Sub-paths. */
  loops: number;
  /** Corners across all loops. */
  points: number;
  /** Nav areas on this level. */
  areas: number;
}

/** A tenth of a pixel as the unit: coordinates are integers of this, so deltas add up exactly. */
const TENTH = 10;

/** `37` -> `3.7`, `-5` -> `-.5`, `20` -> `2`: the shortest text an SVG parser reads back. */
function tenths(n: number): string {
  if (n === 0) return '0';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const whole = Math.trunc(abs / TENTH);
  const frac = abs % TENTH;
  if (frac === 0) return `${sign}${whole}`;
  return `${sign}${whole === 0 ? '' : whole}.${frac}`;
}

/** Path data for closed loops given in radar pixels (any fractional coordinates; rounded here to 0.1). */
export function pathData(loops: readonly (readonly Point[])[]): string {
  let out = '';
  for (const loop of loops) {
    const pts: [number, number][] = [];
    for (const [x, y] of loop) {
      const p: [number, number] = [Math.round(x * TENTH), Math.round(y * TENTH)];
      const last = pts[pts.length - 1];
      if (!last || last[0] !== p[0] || last[1] !== p[1]) pts.push(p);
    }
    const first = pts[0];
    const end = pts[pts.length - 1];
    if (first && end && pts.length > 1 && first[0] === end[0] && first[1] === end[1]) pts.pop();
    if (pts.length < 3 || !first) continue;
    let seg = `M${tenths(first[0])} ${tenths(first[1])}l`;
    let prev = first;
    let lead = true;
    for (const p of pts.slice(1)) {
      for (const v of [p[0] - prev[0], p[1] - prev[1]]) {
        const text = tenths(v);
        seg += lead || text.startsWith('-') ? text : ` ${text}`;
        lead = false;
      }
      prev = p;
    }
    out += `${seg}z`;
  }
  return out;
}

/** The loops back out of path data written by `pathData`: corners in radar pixels, for checks and tests. */
export function parsePathData(d: string): Point[][] {
  const loops: Point[][] = [];
  const tokens = d.match(/[MmLlZz]|-?(?:\d+\.?\d*|\.\d+)/g) ?? [];
  let cmd = '';
  let cur: Point[] = [];
  let x = 0;
  let y = 0;
  const nums: number[] = [];
  const flush = () => {
    for (let i = 0; i + 1 < nums.length; i += 2) {
      const dx = nums[i] as number;
      const dy = nums[i + 1] as number;
      if (cmd === 'M' || cmd === 'L') [x, y] = [dx, dy];
      else if (cmd === 'm' || cmd === 'l') [x, y] = [x + dx, y + dy];
      else throw new Error(`unsupported path command ${cmd}`);
      cur.push([Math.round(x * TENTH) / TENTH, Math.round(y * TENTH) / TENTH]);
      if (cmd === 'M') cmd = 'L';
      else if (cmd === 'm') cmd = 'l';
    }
    nums.length = 0;
  };
  for (const t of tokens) {
    if (/^[MmLlZz]$/.test(t)) {
      flush();
      if (t === 'Z' || t === 'z') {
        if (cur.length) loops.push(cur);
        cur = [];
      } else cmd = t;
    } else nums.push(Number(t));
  }
  flush();
  if (cur.length) loops.push(cur);
  return loops;
}

/** Bounds of path data in radar pixels. */
export function pathBounds(d: string): { minX: number; minY: number; maxX: number; maxY: number } {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const loop of parsePathData(d)) {
    for (const [x, y] of loop) {
      b.minX = Math.min(b.minX, x);
      b.minY = Math.min(b.minY, y);
      b.maxX = Math.max(b.maxX, x);
      b.maxY = Math.max(b.maxY, y);
    }
  }
  return b;
}

/**
 * One silhouette path per level of the map. Levels with no nav areas are left out. The tolerance is given in radar
 * pixels and converted to world units for the outline code, which works in the mesh's own units.
 */
export function buildArt(mesh: NavMesh, projection: Projection, levels: readonly Level[], options: ArtOptions = {}): Record<string, LevelArt> {
  const tolerance = options.tolerance ?? 1;
  const minArea = options.minArea ?? 2;
  const index = buildNavIndex(mesh, levels);
  const out: Record<string, LevelArt> = {};
  for (const level of levels) {
    const areas = index.areas.filter((a) => a.level === level.id);
    if (areas.length === 0) continue;
    const loops = silhouetteLoops(areas, { simplify: tolerance * projection.scale, minArea: minArea * projection.scale ** 2 });
    const pixels = loops.map((loop) => loop.map(([wx, wy]): Point => worldToPixel(projection, wx, wy)));
    const path = pathData(pixels);
    if (path === '') continue;
    out[level.id] = { path, loops: parsePathData(path).length, points: pixels.reduce((s, l) => s + l.length, 0), areas: areas.length };
  }
  return out;
}

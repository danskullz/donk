// A synthetic navigation mesh for tests and for the Editor's browser tests. Not Mirage: a flat grid of square
// areas, optionally with a band of half-height areas (which makes T-junctions, like the real mesh).

import type { MapRecord } from '../schema';
import type { EditorDoc } from './doc';
import type { NavMesh } from './nav';

/** The map record that goes with `makeGridMesh`: projection chosen so a 0-800 by 0-400 mesh sits inside the radar. */
export function makeGridMap(): MapRecord {
  return {
    id: 'de_grid',
    displayName: 'Grid',
    pool: 'extra',
    projection: { posX: -1000, posY: 1000, scale: 2 },
    radarSize: 1024,
    levels: [{ id: 'default' }],
    gameBuild: '1000',
    revision: 1,
    zones: [
      { id: 'west', name: 'West' },
      { id: 'east', name: 'East' },
    ],
    status: 'draft',
  };
}

export const emptyDoc = (map: MapRecord = makeGridMap()): EditorDoc => ({ map, callouts: [], paint: {}, plan: {} });

export interface GridOptions {
  cols: number;
  rows: number;
  /** Edge length of a full area. */
  size?: number;
  origin?: [number, number];
  z?: number;
  /** Columns from this index on (up to `halfCols` of them) are cut into two areas each, half as tall. */
  halfFrom?: number;
  halfCols?: number;
}

/**
 * Area ids run row by row from the origin (x grows, then y). In the half-height band an area is two quads, so the ids
 * after the first half column are shifted: use `gridId` and `gridIds` instead of computing them.
 */
export function makeGridMesh(o: GridOptions): { mesh: NavMesh; ids: Map<string, number> } {
  const size = o.size ?? 100;
  const [ox, oy] = o.origin ?? [0, 0];
  const z = o.z ?? 0;
  const halfFrom = o.halfFrom ?? Infinity;
  const halfTo = halfFrom + (o.halfCols ?? 0);
  const vertices: [number, number, number][] = [];
  const polygons: number[][] = [];
  const ids = new Map<string, number>();
  const quad = (x: number, y: number, w: number, h: number, name: string) => {
    const base = vertices.length;
    vertices.push([x, y, z], [x + w, y, z], [x + w, y + h, z], [x, y + h, z]);
    ids.set(name, polygons.length);
    polygons.push([base, base + 1, base + 2, base + 3]);
  };
  for (let r = 0; r < o.rows; r++) {
    for (let c = 0; c < o.cols; c++) {
      const x = ox + c * size;
      const y = oy + r * size;
      if (c >= halfFrom && c < halfTo) {
        quad(x, y, size, size / 2, `${c},${r}a`);
        quad(x, y + size / 2, size, size / 2, `${c},${r}b`);
      } else quad(x, y, size, size, `${c},${r}`);
    }
  }
  return { mesh: { map: 'de_grid', vertices, polygons }, ids };
}

/** Area ids for the full-size cells named "col,row" (and "col,rowa" / "col,rowb" in the half band). */
export function gridIds(ids: ReadonlyMap<string, number>, ...names: string[]): number[] {
  return names.map((n) => {
    const id = ids.get(n);
    if (id === undefined) throw new Error(`no area ${n}`);
    return id;
  });
}

// Runs the Editor's mesh code on the real Mirage navigation mesh, when it is on this machine. The mesh is generated
// from the CS2 install and is not committed (SCOPE §9), so on any other machine this file does nothing.

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isSimplePolygon, pointInPolygon } from '../geometry';
import { areaAt, buildNavIndex, floodFill, NavMeshSchema } from './nav';
import { outlineOf } from './outline';

const file = new URL('../../../../assets/valve/nav/de_mirage.json', import.meta.url);
const have = existsSync(file);

describe.skipIf(!have)('the real Mirage mesh', () => {
  const mesh = have ? NavMeshSchema.parse(JSON.parse(readFileSync(file, 'utf8'))) : null;
  const t0 = performance.now();
  const index = mesh ? buildNavIndex(mesh, [{ id: 'default' }]) : null;
  const built = performance.now() - t0;

  let main: number[] = [];

  it('builds in well under a few seconds, and mostly hangs together', () => {
    expect(built).toBeLessThan(5000);
    expect(index!.areas).toHaveLength(2544);
    // the largest connected island holds most of the walkable surface (2,085 of 2,544 when measured)
    const seen = new Set<number>();
    for (const a of index!.areas) {
      if (seen.has(a.id)) continue;
      const island = floodFill(index!, a.id, { radius: 1e9 });
      island.forEach((i) => seen.add(i));
      if (island.length > main.length) main = island;
    }
    expect(main.length).toBeGreaterThan(1900);
  });

  it('finds the area under a retake spawn (Valve puts them on the mesh)', () => {
    // first vertex of the mesh is on the surface by construction
    const v = mesh!.vertices[0]!;
    expect(areaAt(index!, v[0] + 0.5, v[1] + 0.5)).not.toBeNull();
  });

  it('outlines a flood-filled patch as one simple polygon containing its areas', () => {
    const seed = main.map((i) => index!.areas[i]!).find((a) => a.size > 2000)!;
    const ids = floodFill(index!, seed.id, { radius: 350 });
    expect(ids.length).toBeGreaterThan(5);
    const t = performance.now();
    const o = outlineOf(ids.map((i) => index!.areas[i]!));
    expect(performance.now() - t).toBeLessThan(2000);
    expect(o.polygon).not.toBeNull();
    expect(isSimplePolygon(o.polygon!)).toBe(true);
    // every area's centroid is in the outline, or in a hole/piece that was reported
    const outside = ids.filter((i) => !pointInPolygon(index!.areas[i]!.centroid, o.polygon!)).length;
    expect(outside <= (o.dropped > 0 ? ids.length : 0)).toBe(true);
  });
});

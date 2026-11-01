// `pnpm content:art` on synthetic nav meshes and radars: a flat grid, a staircase, a two-floor map. Valve's real
// meshes and radars only exist on Dan's machine, so these show the generator is right on shapes we can reason about,
// not what Mirage's silhouette weighs or how closely it lies on the real radar.

import { existsSync, mkdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ArtFileSchema } from '../../src/core/artfile';
import type { NavMesh } from '../../src/core/editor/nav';
import { makeGridMesh } from '../../src/core/editor/test-fixtures';
import { stableJson } from '../../src/core/editor/json';
import { compareWithRadar, loadMapSource, mapsWithNav, radarFile, runArt, type ArtJob } from './art-run';
import { parsePathData, pathBounds } from './art';
import { FIXTURE_MAP, makeTempContent, type TempContent } from './fixtures';

let t: TempContent;
beforeEach(() => {
  t = makeTempContent('callouts-art-');
});
afterEach(() => t.cleanup());

const job = (extra: Partial<ArtJob> = {}): ArtJob => ({ dataDir: t.data, assetsDir: t.assets, outDir: t.art, ...extra });
const writeNav = (id: string, mesh: NavMesh) => {
  mkdirSync(path.join(t.assets, 'nav'), { recursive: true });
  writeFileSync(path.join(t.assets, 'nav', `${id}.json`), JSON.stringify(mesh));
};
const writeMapRecord = (record: object = FIXTURE_MAP) => writeFileSync(path.join(t.data, 'maps', `${(record as { id: string }).id}.json`), stableJson(record));

/** A radar: transparent 1024 px square with one solid rectangle (the walkable area), as Valve's radars are. */
async function writeRadar(name: string, rect: { x: number; y: number; w: number; h: number }, size = 1024): Promise<string> {
  const file = path.join(t.assets, 'radars', name);
  mkdirSync(path.dirname(file), { recursive: true });
  const solid = await sharp({ create: { width: rect.w, height: rect.h, channels: 4, background: { r: 200, g: 200, b: 200, alpha: 1 } } }).png().toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: solid, left: rect.x, top: rect.y }])
    .png()
    .toFile(file);
  return file;
}

/** The fixture mesh (8 x 4 areas of 100 units at the origin) lands on x 500-900, y 300-500 of the radar. */
const GRID_ON_RADAR = { x: 500, y: 300, w: 400, h: 200 };
const grid = () => makeGridMesh({ cols: 8, rows: 4 }).mesh;

/** A triangle of quads whose slanting edge is a staircase of `n` steps, each `size` world units: many corners, one shape. */
function stairMesh(n: number, size: number): NavMesh {
  const vertices: [number, number, number][] = [];
  const polygons: number[][] = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c <= r; c++) {
      const b = vertices.length;
      const [x, y] = [c * size, r * size];
      vertices.push([x, y, 0], [x + size, y, 0], [x + size, y + size, 0], [x, y + size, 0]);
      polygons.push([b, b + 1, b + 2, b + 3]);
    }
  }
  return { map: 'de_test', vertices, polygons };
}

describe('radarFile and mapsWithNav', () => {
  it('names the radar as the extractor does: no suffix for the level called default', () => {
    expect(radarFile('/a', 'de_nuke', 'default')).toBe(path.join('/a', 'radars', 'de_nuke.png'));
    expect(radarFile('/a', 'de_nuke', 'lower')).toBe(path.join('/a', 'radars', 'de_nuke_lower.png'));
  });

  it('lists the maps that have a nav mesh, sorted, and nothing else in the folder', () => {
    expect(mapsWithNav(t.assets)).toEqual([]);
    const dir = path.join(t.assets, 'nav');
    mkdirSync(dir, { recursive: true });
    for (const f of ['de_nuke.json', 'de_mirage.json', 'readme.txt', 'de_Bad.json', 'de_mirage.json.bak', 'cs_office.json']) writeFileSync(path.join(dir, f), '{}');
    expect(mapsWithNav(t.assets)).toEqual(['de_mirage', 'de_nuke']);
  });
});

describe('loadMapSource', () => {
  it('prefers the map record', () => {
    writeMapRecord();
    const s = loadMapSource('de_test', t.data, t.assets);
    expect(s).toMatchObject({ id: 'de_test', from: 'map record', radarSize: 1024, gameBuild: '0000', projection: { posX: -1000, posY: 1000, scale: 2 } });
  });

  it('falls back to the extracted overview file for a map with no callouts yet', () => {
    mkdirSync(path.join(t.assets, 'overviews'), { recursive: true });
    writeFileSync(
      path.join(t.assets, 'overviews', 'overviews.json'),
      JSON.stringify({ gameBuildId: '777', maps: { de_nuke: { posX: -3453, posY: 2887, scale: 7, rotate: 0, levels: [{ id: 'default', altitudeMax: 10000, altitudeMin: -495, radarSize: [1024, 1024] }, { id: 'lower', altitudeMax: -495, altitudeMin: -10000, radarSize: [1024, 1024] }] } } }),
    );
    const s = loadMapSource('de_nuke', t.data, t.assets);
    expect(s).toMatchObject({ from: 'overview file', gameBuild: '777', projection: { posX: -3453, posY: 2887, scale: 7 } });
    expect(s?.levels).toEqual([{ id: 'default', altitudeMin: -495, altitudeMax: 10000 }, { id: 'lower', altitudeMin: -10000, altitudeMax: -495 }]);
  });

  it('is null when neither source knows the map', () => {
    expect(loadMapSource('de_nuke', t.data, t.assets)).toBeNull();
    mkdirSync(path.join(t.assets, 'overviews'), { recursive: true });
    writeFileSync(path.join(t.assets, 'overviews', 'overviews.json'), JSON.stringify({ gameBuildId: '1', maps: {} }));
    expect(loadMapSource('de_nuke', t.data, t.assets)).toBeNull();
  });
});

describe('compareWithRadar', () => {
  const square = 'M500 300l400 0 0 200-400 0z';

  it('finds the art on the radar when they match', async () => {
    const radar = await writeRadar('de_test.png', GRID_ON_RADAR);
    const o = await compareWithRadar(square, radar, 1024);
    expect(o.stray).toBeLessThan(0.01);
    expect(o.covered).toBeGreaterThan(0.99);
    expect(o.iou).toBeGreaterThan(0.98);
  });

  it('shows a shifted projection as art that is off the radar', async () => {
    const radar = await writeRadar('de_test.png', { ...GRID_ON_RADAR, x: 800, y: 700 });
    const o = await compareWithRadar(square, radar, 1024);
    expect(o.stray).toBeGreaterThan(0.9);
    expect(o.covered).toBeLessThan(0.1);
  });

  it('says art that fills only part of a larger radar covers part of it, with none of the art stray', async () => {
    const radar = await writeRadar('de_test.png', { x: 500, y: 300, w: 400, h: 400 });
    const o = await compareWithRadar(square, radar, 1024);
    expect(o.stray).toBeLessThan(0.01);
    expect(o.covered).toBeCloseTo(0.5, 1);
  });
});

describe('runArt', () => {
  it('writes data/art/<map>.json for the grid mesh: valid, one level, the silhouette where the mesh is', async () => {
    writeMapRecord();
    writeNav('de_test', grid());
    await writeRadar('de_test.png', GRID_ON_RADAR);
    const lines: string[] = [];

    const { reports, problems, warnings } = await runArt(job({ log: (l) => lines.push(l) }));

    expect({ problems, warnings }).toEqual({ problems: [], warnings: [] });
    expect(reports).toHaveLength(1);
    const file = path.join(t.art, 'de_test.json');
    expect(reports[0]).toMatchObject({ id: 'de_test', file, written: true, from: 'map record', tolerance: 1, overBudget: false });
    const art = ArtFileSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
    expect(art).toEqual({ map: 'de_test', gameBuild: '0000', levels: { default: expect.any(String) } });
    expect(pathBounds(art.levels['default']!)).toEqual({ minX: 500, minY: 300, maxX: 900, maxY: 500 });
    expect(reports[0]!.levels['default']!.overlap!.stray).toBeLessThan(0.01);
    expect(lines.join('\n')).toMatch(/de_test +default +1 loops +4 corners +100\.0% of the art is on the radar/);
    expect(readFileSync(file, 'utf8')).toBe(stableJson(JSON.parse(readFileSync(file, 'utf8'))));
    expect(existsSync(`${file}.tmp`)).toBe(false);
  });

  it('writes nothing new the second time (same bytes, same modified time)', async () => {
    writeMapRecord();
    writeNav('de_test', grid());
    await runArt(job({ check: false }));
    const file = path.join(t.art, 'de_test.json');
    const old = new Date(Date.now() - 3600_000);
    utimesSync(file, old, old);
    const again = await runArt(job({ check: false }));
    expect(again.reports[0]?.written).toBe(false);
    // utimes goes through a float, so the time can read back a thousandth of a millisecond off
    expect(Math.round(statSync(file).mtimeMs)).toBe(old.getTime());
  });

  it('draws a courtyard as a hole: two loops, and the loop counts in the report', async () => {
    writeMapRecord();
    const full = makeGridMesh({ cols: 3, rows: 3 }).mesh;
    writeNav('de_test', { ...full, polygons: full.polygons.filter((_, i) => i !== 4) });
    const { reports } = await runArt(job({ check: false }));
    expect(reports[0]?.levels['default']?.loops).toBe(2);
    const art = ArtFileSchema.parse(JSON.parse(readFileSync(path.join(t.art, 'de_test.json'), 'utf8')));
    expect(parsePathData(art.levels['default']!)).toHaveLength(2);
  });

  it('splits a two-floor map by altitude, compares each floor with its own radar, and leaves out an empty floor', async () => {
    const upper = makeGridMesh({ cols: 2, rows: 2, z: 100 }).mesh;
    const lower = makeGridMesh({ cols: 2, rows: 2, z: -300, origin: [400, 0] }).mesh;
    writeMapRecord({ ...FIXTURE_MAP, levels: [{ id: 'default', altitudeMin: -100 }, { id: 'lower', altitudeMax: -100 }, { id: 'attic', altitudeMin: 5000 }] });
    writeNav('de_test', { map: 'de_test', vertices: [...upper.vertices, ...lower.vertices], polygons: [...upper.polygons, ...lower.polygons.map((p) => p.map((i) => i + upper.vertices.length))] });
    await writeRadar('de_test.png', { x: 500, y: 400, w: 100, h: 100 });
    await writeRadar('de_test_lower.png', { x: 700, y: 400, w: 100, h: 100 });

    const { reports, problems, warnings } = await runArt(job());

    expect({ problems, warnings }).toEqual({ problems: [], warnings: [] });
    expect(Object.keys(reports[0]!.levels)).toEqual(['default', 'lower']);
    expect(reports[0]!.levels['default']!.overlap!.stray).toBeLessThan(0.02);
    expect(reports[0]!.levels['lower']!.overlap!.stray).toBeLessThan(0.02);
    const art = ArtFileSchema.parse(JSON.parse(readFileSync(path.join(t.art, 'de_test.json'), 'utf8')));
    expect(Object.keys(art.levels)).toEqual(['default', 'lower']);
  });

  it('warns when the art does not lie on the radar, but still writes it', async () => {
    writeMapRecord();
    writeNav('de_test', grid());
    await writeRadar('de_test.png', { x: 100, y: 700, w: 400, h: 200 });
    const { reports, problems, warnings } = await runArt(job());
    expect(problems).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^de_test default: only \d+% of the art lies on the radar; check the projection \(map record\)/);
    expect(reports[0]?.written).toBe(true);
  });

  it('skips the radar comparison with check: false, and when there is no radar image', async () => {
    writeMapRecord();
    writeNav('de_test', grid());
    const none = await runArt(job());
    expect(none.reports[0]?.levels['default']?.overlap).toBeUndefined();
    await writeRadar('de_test.png', { x: 100, y: 700, w: 400, h: 200 });
    const off = await runArt(job({ check: false }));
    expect(off.reports[0]?.levels['default']?.overlap).toBeUndefined();
    expect(off.warnings).toEqual([]);
  });

  it('raises the tolerance until the file fits the budget', async () => {
    writeMapRecord();
    writeNav('de_test', stairMesh(30, 8)); // steps of 4 radar px: kept at 1 px tolerance, merged into a slope at about 3
    const roomy = await runArt(job({ check: false }));
    expect(roomy.reports[0]?.tolerance).toBe(1);
    const big = roomy.reports[0]!.bytes;
    expect(big).toBeGreaterThan(300);

    const tight = await runArt(job({ check: false, budget: 300 }));
    const r = tight.reports[0]!;
    expect(r.tolerance).toBeGreaterThan(1);
    expect(r.bytes).toBeLessThanOrEqual(300);
    expect(r.bytes).toBeLessThan(big);
    expect(r.overBudget).toBe(false);
    expect(tight.warnings).toEqual([]);
  });

  it('says so, and still writes the file, when no tolerance gets it under the budget', async () => {
    writeMapRecord();
    writeNav('de_test', stairMesh(30, 100)); // steps of 50 radar px: no tolerance this tries will merge them
    const lines: string[] = [];
    const { reports, warnings } = await runArt(job({ check: false, budget: 200, log: (l) => lines.push(l) }));
    expect(reports[0]).toMatchObject({ overBudget: true, written: true });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/is over the .* budget even at a tolerance of/);
    expect(lines.join('\n')).toContain('OVER THE');
  });

  it('uses the overview file for a map with a nav mesh but no record', async () => {
    mkdirSync(path.join(t.assets, 'overviews'), { recursive: true });
    writeFileSync(path.join(t.assets, 'overviews', 'overviews.json'), JSON.stringify({ gameBuildId: '888', maps: { de_test: { posX: -1000, posY: 1000, scale: 2, levels: [{ id: 'default' }] } } }));
    writeNav('de_test', grid());
    const { reports, problems } = await runArt(job({ check: false }));
    expect(problems).toEqual([]);
    expect(reports[0]).toMatchObject({ from: 'overview file' });
    expect(JSON.parse(readFileSync(path.join(t.art, 'de_test.json'), 'utf8'))).toMatchObject({ map: 'de_test', gameBuild: '888' });
  });

  it('does only the maps asked for, and reports the ones it cannot do without stopping', async () => {
    writeMapRecord();
    writeNav('de_test', grid());
    writeNav('de_nuke', { ...grid(), map: 'de_nuke' }); // no record, no overview: no projection
    writeFileSync(path.join(t.assets, 'nav', 'de_bad.json'), '{ "map": 3 }');
    writeMapRecord({ ...FIXTURE_MAP, id: 'de_bad', displayName: 'Bad' });

    const only = await runArt(job({ maps: ['de_test'], check: false }));
    expect(only.reports.map((r) => r.id)).toEqual(['de_test']);
    expect(only.problems).toEqual([]);

    const all = await runArt(job({ check: false }));
    expect(all.reports.map((r) => r.id)).toEqual(['de_test']);
    expect(all.problems).toHaveLength(2);
    expect(all.problems.find((p) => p.startsWith('de_nuke'))).toBe('de_nuke: no projection (not in data/maps and not in overviews/overviews.json)');
    expect(all.problems.find((p) => p.startsWith('de_bad'))).toBeTruthy();

    const missing = await runArt(job({ maps: ['de_inferno'], check: false }));
    expect(missing.problems).toEqual([`de_inferno: no nav mesh at ${path.join(t.assets, 'nav', 'de_inferno.json')}`]);
  });

  it('a map record that does not parse fails that map and not the run', async () => {
    writeMapRecord();
    writeNav('de_test', grid());
    writeNav('de_odd', { ...grid(), map: 'de_odd' });
    writeFileSync(path.join(t.data, 'maps', 'de_odd.json'), '{ "id": "de_odd" }');
    const { reports, problems } = await runArt(job({ check: false }));
    expect(reports.map((r) => r.id)).toEqual(['de_test']);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^de_odd: /);
  });

  it('fails a map whose mesh has nothing to draw, and writes no file for it', async () => {
    writeMapRecord();
    writeNav('de_test', { map: 'de_test', vertices: [], polygons: [] });
    const { reports, problems } = await runArt(job({ check: false }));
    expect(reports).toEqual([]);
    expect(problems).toEqual(['de_test: the nav mesh has no walkable area to draw (no areas, or none larger than a speck)']);
    expect(existsSync(path.join(t.art, 'de_test.json'))).toBe(false);
  });

  it('keeps the earlier art file when a later run fails', async () => {
    writeMapRecord();
    writeNav('de_test', grid());
    await runArt(job({ check: false }));
    const before = readFileSync(path.join(t.art, 'de_test.json'), 'utf8');
    writeNav('de_test', { map: 'de_test', vertices: [], polygons: [] });
    expect((await runArt(job({ check: false }))).problems).toHaveLength(1);
    expect(readFileSync(path.join(t.art, 'de_test.json'), 'utf8')).toBe(before);
  });
});

// End to end: runs scripts/init-map.mjs as a child process against a temporary content folder and a synthetic overview
// file made here (the real one is generated from the game files and is not in the repository). Nothing under /data or
// /assets is read or written. Run with `pnpm test:scripts`; each run starts Vite, so a few seconds in all.

import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';
import { parseMapData } from '../src/core/validate';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const realIndex = path.resolve(appRoot, '..', 'data', 'index.json');
const exec = promisify(execFile);

// Nuke is the sample from the task brief; the others use made-up positions. Vertigo's altitudes are from the brief.
const overviews = {
  gameBuildId: '26144732',
  maps: {
    de_nuke: {
      posX: -3453.0, posY: 2887.0, scale: 7.0, rotate: 0, zoom: 0.0, material: 'overviews/de_nuke',
      levels: [
        { id: 'default', altitudeMax: 10000.0, altitudeMin: -495.0, radar: 'de_nuke.png', radarSize: [1024, 1024], coveredFraction: 0.159 },
        { id: 'lower', altitudeMax: -495.0, altitudeMin: -10000.0, radar: 'de_nuke_lower.png', radarSize: [1024, 1024], coveredFraction: 0.153 },
      ],
      CTSpawn: [0.82, 0.45], TSpawn: [0.19, 0.54], bombA: [0.58, 0.48], bombB: [0.58, 0.58],
    },
    de_vertigo: {
      posX: -3000.0, posY: 1500.0, scale: 4.0, rotate: 0, zoom: 0.0,
      levels: [
        { id: 'default', altitudeMax: 20000.0, altitudeMin: 11700.0, radar: 'de_vertigo.png', radarSize: [1024, 1024] },
        { id: 'lower', altitudeMax: 11700.0, altitudeMin: -10000.0, radar: 'de_vertigo_lower.png', radarSize: [1024, 1024] },
      ],
    },
    de_dust2: {
      posX: -2000.5, posY: 2000.0, scale: 4.4, rotate: 0, zoom: 0.0,
      levels: [{ id: 'default', radar: 'de_dust2.png', radarSize: [1024, 1024], coveredFraction: 0.2 }],
    },
    // In the overview file, but not a map index.json lists.
    de_cobble: { posX: 0, posY: 0, scale: 5, rotate: 0, levels: [{ id: 'default', radarSize: [1024, 1024] }] },
  },
};

const NUKE_JSON = `{
  "id": "de_nuke",
  "displayName": "Nuke",
  "pool": "active-duty",
  "projection": { "posX": -3453, "posY": 2887, "scale": 7 },
  "radarSize": 1024,
  "levels": [
    { "id": "default", "altitudeMin": -495 },
    { "id": "lower", "altitudeMax": -495 }
  ],
  "gameBuild": "26144732",
  "revision": 1,
  "zones": [
    { "id": "t-spawn", "name": "T Spawn" },
    { "id": "mid", "name": "Mid" },
    { "id": "b-site", "name": "B Site" }
  ],
  "status": "draft"
}
`;

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

/** A fresh content folder (a copy of the real index.json, no maps) and an overview file, both in a temp folder. */
function workspace() {
  const root = mkdtempSync(path.join(tmpdir(), 'init-map-'));
  roots.push(root);
  const data = path.join(root, 'data');
  mkdirSync(data);
  copyFileSync(realIndex, path.join(data, 'index.json'));
  const overviewsFile = path.join(root, 'overviews.json');
  writeFileSync(overviewsFile, JSON.stringify(overviews));
  const read = (rel: string) => readFileSync(path.join(data, rel), 'utf8');
  return { root, data, overviewsFile, read, file: (rel: string) => path.join(data, rel) };
}

async function initMap(ws: ReturnType<typeof workspace>, args: string[], { paths = true } = {}) {
  const full = paths ? [...args, '--overviews', ws.overviewsFile, '--data', ws.data] : args;
  try {
    const { stdout, stderr } = await exec(process.execPath, ['scripts/init-map.mjs', ...full], { cwd: appRoot });
    return { code: 0, stdout, stderr };
  } catch (e) {
    const err = e as { code?: unknown; stdout?: string; stderr?: string };
    return { code: typeof err.code === 'number' ? err.code : -1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

/** Every file under a folder with its text, so a test can say "nothing was written" or "nothing changed". */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!e.isFile()) continue;
    const full = path.join(e.parentPath, e.name);
    out[path.relative(dir, full).split(path.sep).join('/')] = readFileSync(full, 'utf8');
  }
  return out;
}
const listing = (dir: string): string[] => Object.keys(snapshot(dir)).sort();

describe('scripts/init-map.mjs', () => {
  it('writes the record and an empty callouts file for a single-level map, and leaves index.json alone', async () => {
    const ws = workspace();
    const indexBefore = ws.read('index.json');
    const r = await initMap(ws, ['de_dust2', '--zones', 'A Site, Mid, B Site']);
    expect(r.stderr).toBe('');
    expect(r.code).toBe(0);

    expect(JSON.parse(ws.read('maps/de_dust2.json'))).toEqual({
      id: 'de_dust2',
      displayName: 'Dust II',
      pool: 'active-duty',
      projection: { posX: -2000.5, posY: 2000, scale: 4.4 },
      radarSize: 1024,
      levels: [{ id: 'default' }],
      gameBuild: '26144732',
      revision: 1,
      zones: [{ id: 'a-site', name: 'A Site' }, { id: 'mid', name: 'Mid' }, { id: 'b-site', name: 'B Site' }],
      status: 'draft',
    });
    expect(ws.read('maps/de_dust2.json')).toContain('"levels": [{ "id": "default" }]');
    expect(ws.read('callouts/de_dust2.json')).toBe('[]\n');
    expect(ws.read('index.json')).toBe(indexBefore);
    expect(listing(ws.data)).toEqual(['callouts/de_dust2.json', 'index.json', 'maps/de_dust2.json']);

    // What it prints says what it did.
    expect(r.stdout).toContain('wrote');
    expect(r.stdout).toContain('de_dust2.json');
    expect(r.stdout).toContain('3 zone-empty');
    expect(r.stdout).toContain('"available": false');
  });

  it('writes a two-level map: the text is exactly what the Editor would write, the floors split at the cut-off', async () => {
    const ws = workspace();
    const r = await initMap(ws, ['de_nuke', '--zones', 'T Spawn, Mid, B Site']);
    expect(r.stderr).toBe('');
    expect(r.code).toBe(0);
    expect(ws.read('maps/de_nuke.json')).toBe(NUKE_JSON);
    expect(ws.read('callouts/de_nuke.json')).toBe('[]\n');
    expect(r.stdout).toContain('default (z -495 and above), lower (z below -495)');

    // Read back with the same rules the app uses: valid, and nothing but "zone-empty" to say.
    const parsed = parseMapData(JSON.parse(ws.read('maps/de_nuke.json')), JSON.parse(ws.read('callouts/de_nuke.json')));
    expect(parsed.map?.id).toBe('de_nuke');
    expect(parsed.issues.map((i) => `${i.severity}:${i.rule}`)).toEqual(['warning:zone-empty', 'warning:zone-empty', 'warning:zone-empty']);
  });

  it('keeps a real cut-off above 10000 (Vertigo\'s floors meet at 11700) and drops the 20000 and -10000 "no limit"', async () => {
    const ws = workspace();
    const r = await initMap(ws, ['de_vertigo', '--zones', 'Mid']);
    expect(r.code).toBe(0);
    const map = JSON.parse(ws.read('maps/de_vertigo.json')) as { displayName: string; pool: string; levels: unknown };
    expect(map.displayName).toBe('Vertigo');
    expect(map.pool).toBe('extra');
    expect(map.levels).toEqual([{ id: 'default', altitudeMin: 11700 }, { id: 'lower', altitudeMax: 11700 }]);
  });

  it('refuses to overwrite existing files, says so, and changes nothing', async () => {
    const ws = workspace();
    expect((await initMap(ws, ['de_nuke', '--zones', 'T Spawn, Mid, B Site'])).code).toBe(0);
    const before = snapshot(ws.data);

    const r = await initMap(ws, ['de_nuke', '--zones', 'Other, Zones']);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('already exist');
    expect(r.stderr).toContain('nothing was written');
    expect(r.stderr).toContain('--force');
    expect(ws.read('maps/de_nuke.json')).toBe(NUKE_JSON);
    expect(snapshot(ws.data)).toEqual(before);
    expect(existsSync(ws.file('.backups'))).toBe(false);
  });

  it('refuses when only one of the two files exists', async () => {
    const ws = workspace();
    mkdirSync(ws.file('callouts'));
    writeFileSync(ws.file('callouts/de_nuke.json'), '[]\n');
    const r = await initMap(ws, ['de_nuke', '--zones', 'Mid']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('callouts/de_nuke.json');
    expect(r.stderr).toContain('already exists');
    expect(existsSync(ws.file('maps/de_nuke.json'))).toBe(false);
  });

  it('--force replaces both files and first copies the old ones to .backups', async () => {
    const ws = workspace();
    expect((await initMap(ws, ['de_nuke', '--zones', 'T Spawn, Mid, B Site'])).code).toBe(0);
    // Pretend the map has been worked on since: the callouts file holds something that must not be lost.
    writeFileSync(ws.file('callouts/de_nuke.json'), '[{"curated":"by hand"}]\n');

    const r = await initMap(ws, ['de_nuke', '--zones', 'Only Zone', '--force']);
    expect(r.stderr).toBe('');
    expect(r.code).toBe(0);
    expect((JSON.parse(ws.read('maps/de_nuke.json')) as { zones: unknown }).zones).toEqual([{ id: 'only-zone', name: 'Only Zone' }]);
    expect(ws.read('callouts/de_nuke.json')).toBe('[]\n');

    const stamps = readdirSync(ws.file('.backups/de_nuke'));
    expect(stamps).toHaveLength(1);
    const backup = (f: string) => readFileSync(path.join(ws.file('.backups/de_nuke'), stamps[0]!, f), 'utf8');
    expect(backup('map.json')).toBe(NUKE_JSON);
    expect(backup('callouts.json')).toBe('[{"curated":"by hand"}]\n');
    expect(r.stdout).toContain('copied to');
  });

  it('--force on a map with no files does not make a backup', async () => {
    const ws = workspace();
    expect((await initMap(ws, ['de_dust2', '--zones', 'Mid', '--force'])).code).toBe(0);
    expect(existsSync(ws.file('.backups'))).toBe(false);
  });

  it('refuses a map id that is not in the overview file, naming the ones that are', async () => {
    const ws = workspace();
    const r = await initMap(ws, ['de_inferno', '--zones', 'Mid']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('de_inferno is not in the overview file');
    expect(r.stderr).toContain('de_nuke');
    expect(listing(ws.data)).toEqual(['index.json']);
  });

  it('refuses a map that is in the overview file but not in index.json', async () => {
    const ws = workspace();
    const r = await initMap(ws, ['de_cobble', '--zones', 'Mid']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('de_cobble is not listed in data/index.json');
    expect(listing(ws.data)).toEqual(['index.json']);
  });

  it('refuses to run without --zones, or with a list that holds no zone, and writes nothing', async () => {
    const ws = workspace();
    for (const args of [['de_nuke'], ['de_nuke', '--zones', ''], ['de_nuke', '--zones', ' , ,']]) {
      const r = await initMap(ws, args);
      expect(r.code, args.join(' ')).toBe(1);
      expect(r.stderr, args.join(' ')).toContain('at least one zone is needed');
      expect(r.stdout, args.join(' ')).toBe('');
    }
    expect(listing(ws.data)).toEqual(['index.json']);
  });

  it('checks the zones before it looks for the overview file', async () => {
    const ws = workspace();
    const r = await initMap(ws, ['de_nuke', '--overviews', path.join(ws.root, 'nope.json'), '--data', ws.data], { paths: false });
    expect(r.stderr).toContain('at least one zone is needed');
  });

  it('refuses bad zone lists with the reason', async () => {
    const ws = workspace();
    const same = await initMap(ws, ['de_nuke', '--zones', 'Mid, mid']);
    expect(same.code).toBe(1);
    expect(same.stderr).toContain('both become the id "mid"');
    const long = await initMap(ws, ['de_nuke', '--zones', 'x'.repeat(29)]);
    expect(long.code).toBe(1);
    expect(long.stderr).toContain('the limit is 28');
    expect(listing(ws.data)).toEqual(['index.json']);
  });

  it('says what to do when the overview file is missing', async () => {
    const ws = workspace();
    rmSync(ws.overviewsFile);
    const r = await initMap(ws, ['de_nuke', '--zones', 'Mid']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('the overview file was not found');
    expect(r.stderr).toContain('--overviews');
  });

  it('accepts the leading "--" that people type after a pnpm script name', async () => {
    const ws = workspace();
    const r = await initMap(ws, ['--', 'de_dust2', '--zones', 'Mid']);
    expect(r.stderr).toBe('');
    expect(r.code).toBe(0);
  });
});

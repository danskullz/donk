// The three command-line scripts as Dan runs them (`pnpm content:art`, `content:process`, `content:validate`), started
// as real processes against a temp content folder: exit codes and what they print. Each start boots a small Vite
// server to load the TypeScript core, so these take a second or two apiece.

import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stableJson } from '../src/core/editor/json';
import { makeGridMesh } from '../src/core/editor/test-fixtures';
import { makeCallouts } from '../src/core/test-fixtures';
import { bareCallouts, FIXTURE_MAP, makeTempContent, manifestFor, writeCaptures, writeContent, writeManifest, type TempContent } from './lib/fixtures';

const run = promisify(execFile);
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

interface Outcome {
  code: number;
  out: string;
}

async function script(name: string, args: string[], env: Record<string, string> = {}): Promise<Outcome> {
  try {
    const { stdout, stderr } = await run(process.execPath, [path.join('scripts', name), ...args], { cwd: appRoot, env: { ...process.env, ...env }, timeout: 55_000 });
    return { code: 0, out: stdout + stderr };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return { code: typeof err.code === 'number' ? err.code : -1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

let t: TempContent;
beforeEach(() => {
  t = makeTempContent('callouts-cli-');
});
afterEach(() => t.cleanup());

const validate = (extra: string[] = []) => script('validate-content.mjs', extra, { CALLOUTS_DATA_DIR: t.data, CALLOUTS_SHOTS_DIR: t.shots, CALLOUTS_ART_DIR: t.art });
const makeArt = (extra: string[] = []) => script('make-art.mjs', ['--data', t.data, '--assets', t.assets, '--out', t.art, ...extra]);
const processShots = (extra: string[] = []) =>
  script('process-shots.mjs', ['--map', 'de_test', '--data', t.data, '--shots', t.shots, '--captures', t.captures, '--manifest', t.manifestFile, '--effort', '0', '--date', '2026-11-02', '--quality', '40', ...extra]);

/** A 1280x720 AVIF to stand in for every shot a callout lists. */
async function writeShotFiles(files: readonly string[], size = { width: 1280, height: 720 }): Promise<void> {
  const avif = await sharp({ create: { width: size.width, height: size.height, channels: 3, background: '#335577' } }).avif({ quality: 40, effort: 0 }).toBuffer();
  for (const f of files) {
    mkdirSync(path.dirname(path.join(t.shots, f)), { recursive: true });
    writeFileSync(path.join(t.shots, f), avif);
  }
}
const listedFiles = () => makeCallouts().flatMap((c) => c.shots.map((s) => s.file));
const N = listedFiles().length;
const writeArtFile = (levels: Record<string, string>, over: object = {}) => {
  mkdirSync(t.art, { recursive: true });
  writeFileSync(path.join(t.art, 'de_test.json'), stableJson({ map: 'de_test', gameBuild: FIXTURE_MAP.gameBuild, levels, ...over }));
};

describe('pnpm content:validate', () => {
  beforeEach(() => writeContent(t, makeCallouts()));

  it('passes when there are no generated files, and says what it did not check', async () => {
    const r = await validate();
    expect(r.code).toBe(0);
    expect(r.out).toContain('(assets/shots is not built here, so shot files are not checked for existence)');
    expect(r.out).toContain(`shots: ${N} listed (not checked against disk)`);
    expect(r.out).toContain('art: none (pnpm content:art makes it)');
    expect(r.out).toContain('de_test      none');
    expect(r.out).toMatch(/0 errors, \d+ warnings/);
  });

  it('counts the shots on disk with their size when every listed file is there', async () => {
    await writeShotFiles(listedFiles());
    const r = await validate();
    expect(r.out).toMatch(new RegExp(`shots: ${N} listed, ${N} on disk \\(\\d+ KB, \\d+ KB each\\), ${N} files in assets/shots/test`));
    expect(r.out).not.toMatch(/error {3}\[/);
    expect(r.code).toBe(0);
  });

  it('fails on a listed shot that is not on disk', async () => {
    await writeShotFiles(listedFiles().filter((f) => f !== 'test/palace-2.avif'));
    const r = await validate();
    expect(r.code).toBe(1);
    expect(r.out).toContain('error   [shot-file] test.palace: test/palace-2.avif is not in assets/shots');
    expect(r.out).toContain(`${N - 1} on disk`);
  });

  it('fails on a file that is empty or not an image, and warns about one of the wrong size', async () => {
    await writeShotFiles(listedFiles());
    writeFileSync(path.join(t.shots, 'test', 'palace-1.avif'), '');
    writeFileSync(path.join(t.shots, 'test', 'palace-2.avif'), 'not an image at all');
    await writeShotFiles(['test/palace-3.avif'], { width: 640, height: 360 });
    const r = await validate();
    expect(r.code).toBe(1);
    expect(r.out).toContain('error   [shot-unreadable] test.palace: test/palace-1.avif is not a readable image');
    expect(r.out).toContain('error   [shot-unreadable] test.palace: test/palace-2.avif is not a readable image');
    expect(r.out).toContain('warning [shot-size] test.palace: test/palace-3.avif is 640x360, not 1280x720');
  });

  it('warns about a file in the shots folder that no callout lists, but not about a .webp spare for a listed AVIF', async () => {
    await writeShotFiles([...listedFiles(), 'test/old-1.avif', 'test/palace-1.webp']);
    const r = await validate();
    expect(r.out).toContain('warning [shot-orphan] test/old-1.avif is in assets/shots but no callout lists it');
    expect(r.out).not.toContain('palace-1.webp is in assets');
    expect(r.code).toBe(0);
    expect((await validate(['--strict'])).code).toBe(1);
  });

  it('accepts art that fits the map and reports its size', async () => {
    writeArtFile({ default: 'M500 300l400 0 0 200-400 0z' });
    const r = await validate();
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/art: 1 level, 0\.\d KB/);
    expect(r.out).toMatch(/de_test +1 level, 0\.\d KB/);
  });

  it('fails on art outside the radar, art for another map, an invalid file and an unreadable one', async () => {
    writeArtFile({ default: 'M500 300l5000 0 0 200-5000 0z' });
    let r = await validate();
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/error {3}\[art-bounds\] art level default runs outside the 1024 px radar/);

    writeArtFile({ default: 'M1 1l9 0 0 9z' }, { map: 'de_other' });
    r = await validate();
    expect(r.out).toContain('error   [art-map] art/de_test.json is for de_other');

    writeArtFile({ default: '<script>' });
    r = await validate();
    expect(r.out).toMatch(/error {3}\[art-schema\] art\/de_test\.json: levels\.default/);

    writeFileSync(path.join(t.art, 'de_test.json'), '{ not json');
    r = await validate();
    expect(r.out).toContain('error   [art-json] art/de_test.json is not valid JSON');
    expect(r.out).toContain('de_test      unreadable');
  });

  it('warns about art made from another game build and a level the record does not have', async () => {
    writeArtFile({ default: 'M500 300l400 0 0 200-400 0z', lower: 'M500 300l40 0 0 20-40 0z' }, { gameBuild: '9999' });
    const r = await validate();
    expect(r.code).toBe(0);
    expect(r.out).toContain('warning [art-stale] art was made from game build 9999, the map record says 0000; run pnpm content:art');
    expect(r.out).toContain('warning [art-level] art has level lower, which the map record does not');
  });

  it('warns about a file that is over the size budget, and about art for a map that index.json does not list', async () => {
    const big = `M0 0l${'1 1 '.repeat(40_000)}z`;
    writeArtFile({ default: big });
    writeFileSync(path.join(t.art, 'de_ghost.json'), stableJson({ map: 'de_ghost', gameBuild: '1', levels: { default: 'M1 1l9 0 0 9z' } }));
    const r = await validate();
    expect(r.out).toMatch(/warning \[art-size\] art\/de_test\.json is \d+ KB, over the 150 KB budget/);
    expect(r.out).toContain('warning [art-orphan] art/de_ghost.json is for a map that index.json does not list');
  });

  it('checks the art of a map that has no record, as far as the file can say', async () => {
    mkdirSync(t.art, { recursive: true });
    writeFileSync(path.join(t.data, 'index.json'), stableJson([{ id: 'de_test', displayName: 'Test', pool: 'extra', available: true }, { id: 'de_nuke', displayName: 'Nuke', pool: 'active-duty', available: false }]));
    writeFileSync(path.join(t.art, 'de_nuke.json'), stableJson({ map: 'de_mirage', gameBuild: '1', levels: { default: 'M1 1l9 0 0 9z' } }));
    const r = await validate();
    expect(r.code).toBe(1);
    expect(r.out).toContain('error   [art-map] art/de_nuke.json is for de_mirage');
  });
});

describe('pnpm content:art', () => {
  it('writes the art file for a map with a nav mesh and says what it made', async () => {
    writeContent(t);
    mkdirSync(path.join(t.assets, 'nav'), { recursive: true });
    writeFileSync(path.join(t.assets, 'nav', 'de_test.json'), JSON.stringify(makeGridMesh({ cols: 8, rows: 4 }).mesh));
    const r = await makeArt();
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/de_test +default +1 loops +4 corners +no radar to compare/);
    expect(r.out).toMatch(/1 map, 0\.\d KB/);
    expect(JSON.parse(readFileSync(path.join(t.art, 'de_test.json'), 'utf8'))).toMatchObject({ map: 'de_test', gameBuild: '0000' });
    // and what it wrote is what the validator accepts
    expect((await validate()).code).toBe(0);
  });

  it('exits 1, saying how to get the nav meshes, when there are none', async () => {
    const r = await makeArt();
    expect(r.code).toBe(1);
    expect(r.out).toContain('no nav meshes under');
    expect(r.out).toContain('content-tools/README.md');
  });

  it('exits 1 for a map it was asked for and cannot do', async () => {
    writeContent(t);
    mkdirSync(path.join(t.assets, 'nav'), { recursive: true });
    writeFileSync(path.join(t.assets, 'nav', 'de_test.json'), JSON.stringify(makeGridMesh({ cols: 2, rows: 2 }).mesh));
    const r = await makeArt(['--map', 'de_test', '--map', 'de_inferno']);
    expect(r.code).toBe(1);
    expect(r.out).toContain('error: de_inferno: no nav mesh at');
    expect(r.out).toMatch(/1 map, .* 1 failed/);
  });

  it('takes its flags after a leading -- too', async () => {
    writeContent(t);
    mkdirSync(path.join(t.assets, 'nav'), { recursive: true });
    writeFileSync(path.join(t.assets, 'nav', 'de_test.json'), JSON.stringify(makeGridMesh({ cols: 2, rows: 2 }).mesh));
    const r = await script('make-art.mjs', ['--', '--data', t.data, '--assets', t.assets, '--out', t.art, '--map', 'de_test']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/1 map,/);
  });

  it('exits 2 for a flag that is not a number', async () => {
    const r = await makeArt(['--tolerance', 'lots']);
    expect(r.code).toBe(2);
    expect(r.out).toContain('--tolerance must be a number');
  });
});

describe('pnpm content:process', () => {
  async function ready(): Promise<ReturnType<typeof manifestFor>> {
    const callouts = bareCallouts().filter((c) => c.id === 'test.palace');
    writeContent(t, callouts);
    const manifest = manifestFor(callouts);
    writeManifest(t, manifest);
    await writeCaptures(t, manifest);
    return manifest;
  }

  it('converts, lists, and does nothing the second time', async () => {
    await ready();
    const first = await processShots();
    expect(first.code).toBe(0);
    expect(first.out).toMatch(/3 converted \(\d+ KB, \d+ KB each\), 3 added, 0 replaced, 0 unchanged, 0 conflicts, 0 for callouts not in the file, 0 problems/);
    expect(first.out).toContain('callouts/de_test.json updated (previous copy in data/.backups)');
    expect(JSON.parse(readFileSync(path.join(t.data, 'callouts', 'de_test.json'), 'utf8'))[0].shots).toHaveLength(3);

    const second = await processShots();
    expect(second.code).toBe(0);
    expect(second.out).toMatch(/0 converted \(0 KB\), 0 added, 0 replaced, 3 unchanged/);
    expect(second.out).not.toContain('updated');
  });

  it('exits 1 and prints the problem when a capture is missing', async () => {
    const manifest = await ready();
    rmSync(path.join(t.captures, 'shot_02_test-palace-approach-2.png'));
    const r = await processShots();
    expect(r.code).toBe(1);
    expect(r.out).toContain('test.palace shot 2: no capture shot_02_test-palace-approach-2.png');
    expect(r.out).toMatch(/2 converted/);
    expect(manifest.shots).toHaveLength(3);
  });

  it('exits 1 on a conflict and replaces with --force', async () => {
    const manifest = await ready();
    await processShots();
    writeManifest(t, { ...manifest, shots: manifest.shots.map((s) => (s.n === 1 ? { ...s, pose: { ...s.pose, pitch: 5 } } : s)) });
    const r = await processShots();
    expect(r.code).toBe(1);
    expect(r.out).toContain('test/palace-1.avif is already listed with a different pitch; use --force to replace it');
    const forced = await processShots(['--force']);
    expect(forced.code).toBe(0);
    expect(forced.out).toMatch(/1 replaced/);
  });

  it('--dry-run writes nothing', async () => {
    await ready();
    const before = readFileSync(path.join(t.data, 'callouts', 'de_test.json'), 'utf8');
    const r = await processShots(['--dry-run']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('(dry run)');
    expect(readFileSync(path.join(t.data, 'callouts', 'de_test.json'), 'utf8')).toBe(before);
  });

  it('takes its flags after a leading -- too, which is what `pnpm content:process -- --map x` hands it', async () => {
    await ready();
    const r = await processShots();
    expect(r.code).toBe(0);
    const viaDashes = await script('process-shots.mjs', ['--', '--map', 'de_test', '--data', t.data, '--shots', t.shots, '--captures', t.captures, '--manifest', t.manifestFile, '--date', '2026-11-02', '--dry-run']);
    expect(viaDashes.code).toBe(0);
    expect(viaDashes.out).toMatch(/3 unchanged/);
  });

  it('exits 2 and prints the usage for no map, a bad map, a bad date or a bad number', async () => {
    for (const args of [[], ['--map', 'mirage'], ['--map', 'de_test', '--date', '2.11.2026'], ['--map', 'de_test', '--quality', '0'], ['--map', 'de_test', '--effort', '10']]) {
      const r = await script('process-shots.mjs', args);
      expect({ args, code: r.code }).toEqual({ args, code: 2 });
    }
  });
});

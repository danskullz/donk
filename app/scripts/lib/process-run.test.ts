// `pnpm content:process` end to end on synthetic captures: PNGs made with sharp, a temp content folder, the real
// Editor manifest code. The real captures only exist on Dan's machine, so these tests are the evidence that the
// pipeline works at all; they do not show what a CS2 screenshot looks like after encoding or how big it ends up.

import { existsSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stableJson } from '../../src/core/editor/json';
import { CalloutsFileSchema, type Callout } from '../../src/core/schema';
import { validateMapData } from '../../src/core/validate';
import { bareCallouts, expectedFiles, FIXTURE_MAP, makeTempContent, manifestFor, writeCaptures, writeContent, writeManifest, writePng, type TempContent } from './fixtures';
import { processShots, type ProcessJob } from './process-run';
import { captureFileName } from './shots';

let t: TempContent;
beforeEach(() => {
  t = makeTempContent();
});
afterEach(() => t.cleanup());

const job = (extra: Partial<ProcessJob> = {}): ProcessJob => ({ map: 'de_test', dataDir: t.data, shotsDir: t.shots, capturesDir: t.captures, manifestFile: t.manifestFile, date: '2026-11-02', quality: 40, effort: 0, ...extra });
/** The job as a real run is, without `--date`: each entry is dated by its capture file. */
const withoutDate = (extra: Partial<ProcessJob> = {}): ProcessJob => {
  const { date: _unused, ...rest } = job(extra);
  void _unused;
  return rest;
};
const readCallouts = (): Callout[] => CalloutsFileSchema.parse(JSON.parse(readFileSync(path.join(t.data, 'callouts', 'de_test.json'), 'utf8')));
const calloutsText = () => readFileSync(path.join(t.data, 'callouts', 'de_test.json'), 'utf8');
const backups = () => (existsSync(path.join(t.data, '.backups', 'de_test')) ? readdirSync(path.join(t.data, '.backups', 'de_test')) : []);
const allShots = () => readCallouts().flatMap((c) => c.shots);

/** Four callouts (11 shots) that still include a Hard spot with its parent: encoding is the slow part of these tests. */
/** The manifest of the first callout's first shot only, for tests about one picture. */
const oneShot = (callouts: readonly Callout[]) => {
  const m = manifestFor(callouts.slice(0, 1));
  return { ...m, shots: m.shots.slice(0, 1) };
};

const few = (): Callout[] => bareCallouts().filter((c) => ['test.t-spawn', 'test.a-site', 'test.palace', 'test.bench'].includes(c.id));

/** Everything captured and written once, so a test can start from "already processed". */
async function processedOnce(dated = true): Promise<ReturnType<typeof manifestFor>> {
  const callouts = few();
  writeContent(t, callouts);
  const manifest = manifestFor(callouts);
  writeManifest(t, manifest);
  await writeCaptures(t, manifest);
  const report = await processShots(dated ? job() : withoutDate());
  expect(report.problems).toEqual([]);
  return manifest;
}

describe('processShots, first run', () => {
  it('converts every capture to a 1280x720 AVIF and lists it on its callout', async () => {
    const callouts = few();
    writeContent(t, callouts);
    const manifest = manifestFor(callouts);
    writeManifest(t, manifest);
    await writeCaptures(t, manifest);

    const lines: string[] = [];
    const report = await processShots(job({ log: (l) => lines.push(l) }));

    expect(report.problems).toEqual([]);
    expect(report.wroteCallouts).toBe(true);
    expect(report.rows).toHaveLength(manifest.shots.length);
    expect(report.rows.every((r) => r.status === 'added')).toBe(true);
    expect(report.converted).toHaveLength(manifest.shots.length);

    const files = expectedFiles(manifest);
    expect(files).toContain('test/palace-1.avif');
    expect(files).toContain('test/bench-2.avif');
    for (const f of files) {
      const meta = await sharp(path.join(t.shots, f)).metadata();
      expect({ f, w: meta.width, h: meta.height, format: meta.format }).toEqual({ f, w: 1280, h: 720, format: 'heif' });
    }
    // nothing but the AVIFs, no half-written temp files
    expect(readdirSync(path.join(t.shots, 'test')).every((f) => f.endsWith('.avif'))).toBe(true);

    const palace = readCallouts().find((c) => c.id === 'test.palace');
    expect(palace?.shots.map((s) => s.file)).toEqual(['test/palace-1.avif', 'test/palace-2.avif', 'test/palace-3.avif']);
    expect(palace?.shots[0]).toEqual({
      file: 'test/palace-1.avif',
      pos: [700, 290, 64],
      yaw: 0,
      pitch: 0,
      stance: 'stand',
      kind: 'inside',
      captured: '2026-11-02',
      build: FIXTURE_MAP.gameBuild,
    });
    expect(palace?.shots.map((s) => s.kind)).toEqual(['inside', 'approach', 'alternate']);
    expect(readCallouts().find((c) => c.id === 'test.bench')?.shots.map((s) => s.kind)).toEqual(['approach', 'overview']);
  });

  it('writes the callouts file the way the Editor does, passes the validator, and keeps a backup of the one it replaced', async () => {
    const callouts = few();
    writeContent(t, callouts);
    const before = calloutsText();
    const manifest = manifestFor(callouts);
    writeManifest(t, manifest);
    await writeCaptures(t, manifest);
    await processShots(job());

    const after = calloutsText();
    expect(after).toBe(stableJson(JSON.parse(after)));
    // the four-callout subset has dangling neighbours, which is not what is being tested: only the shot rules are
    const issues = validateMapData(FIXTURE_MAP, readCallouts()).filter((i) => i.rule.startsWith('shot'));
    expect(issues).toEqual([]);

    const kept = backups();
    expect(kept).toHaveLength(1);
    expect(readFileSync(path.join(t.data, '.backups', 'de_test', kept[0] as string, 'callouts.json'), 'utf8')).toBe(before);
    expect(existsSync(path.join(t.data, 'callouts', 'de_test.json.tmp'))).toBe(false);
  });

  it('leaves everything else in the callouts file alone', async () => {
    const callouts = few();
    writeContent(t, callouts);
    const manifest = manifestFor(callouts);
    writeManifest(t, manifest);
    await writeCaptures(t, manifest);
    await processShots(job());
    expect(readCallouts().map((c) => ({ ...c, shots: [] }))).toEqual(callouts);
  });

  it('keeps the shots a callout already had, and adds the new ones after them', async () => {
    const callouts = few();
    const earlier = { file: 'test/old-1.avif', pos: [10, 10, 64] as [number, number, number], yaw: 0, pitch: 0, stance: 'stand' as const, kind: 'approach' as const, captured: '2026-10-01', build: '0000' };
    const at = callouts.findIndex((c) => c.id === 'test.a-site');
    callouts[at] = { ...(callouts[at] as Callout), shots: [earlier] };
    writeContent(t, callouts);
    const manifest = manifestFor(callouts);
    writeManifest(t, manifest);
    await writeCaptures(t, manifest);
    await processShots(job());
    const aSite = readCallouts().find((c) => c.id === 'test.a-site');
    expect(aSite?.shots[0]).toEqual(earlier);
    expect(aSite?.shots.slice(1).map((s) => s.file)).toEqual(['test/a-site-1.avif', 'test/a-site-2.avif', 'test/a-site-3.avif']);
  });
});

describe('processShots, running again', () => {
  it('changes nothing when nothing changed: same entries, same image bytes, no new backup', async () => {
    const manifest = await processedOnce();
    const text = calloutsText();
    const mtimes = expectedFiles(manifest).map((f) => statSync(path.join(t.shots, f)).mtimeMs);
    const kept = backups();

    const report = await processShots(job());

    expect(report.problems).toEqual([]);
    expect(report.wroteCallouts).toBe(false);
    expect(report.converted).toEqual([]);
    expect(report.rows.every((r) => r.status === 'unchanged')).toBe(true);
    expect(calloutsText()).toBe(text);
    expect(expectedFiles(manifest).map((f) => statSync(path.join(t.shots, f)).mtimeMs)).toEqual(mtimes);
    expect(backups()).toEqual(kept);
  });

  it('adds only the new shots when more are captured later', async () => {
    const callouts = few();
    writeContent(t, callouts);
    const manifest = manifestFor(callouts);
    writeManifest(t, manifest);
    const firstBatch = manifest.shots.filter((s) => s.id === 'test.palace').map((s) => s.n);
    await writeCaptures(t, manifest, { only: firstBatch });
    const first = await processShots(job());
    expect(first.problems.filter((p) => p.includes('no capture'))).toHaveLength(manifest.shots.length - firstBatch.length);
    expect(allShots()).toHaveLength(3);

    await writeCaptures(t, manifest);
    const second = await processShots(job());
    expect(second.problems).toEqual([]);
    expect(second.rows.filter((r) => r.status === 'added')).toHaveLength(manifest.shots.length - 3);
    expect(second.rows.filter((r) => r.status === 'unchanged')).toHaveLength(3);
    expect(allShots()).toHaveLength(manifest.shots.length);
    // only the new ones were encoded
    expect(second.converted).toHaveLength(manifest.shots.length - 3);
  });

  it('re-encodes an image that is listed but missing from disk', async () => {
    const manifest = await processedOnce();
    const gone = path.join(t.shots, 'test', 'palace-2.avif');
    writeFileSync(gone, '');
    // an empty file counts as present; delete it for real
    const { rmSync } = await import('node:fs');
    rmSync(gone);
    const report = await processShots(job());
    expect(report.converted.map((c) => c.file)).toEqual(['test/palace-2.avif']);
    expect(report.wroteCallouts).toBe(false);
    expect(existsSync(gone)).toBe(true);
    expect(report.rows).toHaveLength(manifest.shots.length);
  });

  it('refuses to overwrite an entry that differs, and says which fields', async () => {
    const manifest = await processedOnce();
    const before = calloutsText();
    const moved = { ...manifest, shots: manifest.shots.map((s) => (s.n === 1 ? { ...s, pose: { ...s.pose, yaw: s.pose.yaw + 30 }, stance: 'crouch' as const } : s)) };
    writeManifest(t, moved);

    const report = await processShots(job());

    expect(report.problems).toHaveLength(1);
    expect(report.problems[0]).toMatch(/test\/t-spawn-1\.avif.*different yaw, stance.*--force/);
    expect(report.rows.find((r) => r.status === 'conflict')?.differs).toEqual(['yaw', 'stance']);
    expect(calloutsText()).toBe(before);
  });

  it('replaces it with force, re-encodes the image, and leaves the other entries as they were', async () => {
    const manifest = await processedOnce(false);
    const other = readCallouts().find((c) => c.id === 'test.palace')?.shots;
    const imageBefore = readFileSync(path.join(t.shots, 'test', 't-spawn-1.avif'));
    const moved = { ...manifest, shots: manifest.shots.map((s) => (s.n === 1 ? { ...s, pose: { ...s.pose, yaw: 99 } } : s)) };
    writeManifest(t, moved);
    // a retake a week later: new picture under the same name
    const retake = path.join(t.captures, captureFileName(1, moved.shots[0]!.pose.title, moved.shots[0]!.note));
    await writePng(retake, { color: [200, 40, 40], seed: 77 });
    const later = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    utimesSync(retake, later, later);

    const report = await processShots(withoutDate({ force: true }));

    expect(report.problems).toEqual([]);
    expect(report.rows.filter((r) => r.status !== 'unchanged')).toHaveLength(1);
    expect(report.rows.find((r) => r.status === 'replaced')).toMatchObject({ file: 'test/t-spawn-1.avif', differs: ['yaw', 'captured'] });
    const tSpawn = readCallouts().find((c) => c.id === 'test.t-spawn');
    expect(tSpawn?.shots[0]).toMatchObject({ file: 'test/t-spawn-1.avif', yaw: 99 });
    expect(tSpawn?.shots[0]?.captured).not.toBe(tSpawn?.shots[1]?.captured);
    expect(tSpawn?.shots).toHaveLength(3);
    expect(readCallouts().find((c) => c.id === 'test.palace')?.shots).toEqual(other);
    expect(readFileSync(path.join(t.shots, 'test', 't-spawn-1.avif')).equals(imageBefore)).toBe(false);
    expect(report.converted.map((c) => c.file)).toEqual(['test/t-spawn-1.avif']);
  });

  it('treats a newer capture of the same pose as a difference too, so a retake is never silently ignored', async () => {
    const manifest = await processedOnce(false);
    const retake = path.join(t.captures, captureFileName(1, manifest.shots[0]!.pose.title, manifest.shots[0]!.note));
    await writePng(retake, { color: [200, 40, 40], seed: 5 });
    const imageBefore = readFileSync(path.join(t.shots, 'test', 't-spawn-1.avif'));
    const later = new Date(Date.now() + 3 * 24 * 3600 * 1000);
    utimesSync(retake, later, later);
    const report = await processShots(withoutDate());
    expect(report.problems).toHaveLength(1);
    expect(report.problems[0]).toMatch(/test\/t-spawn-1\.avif is already listed with a different captured; use --force/);
    expect(readFileSync(path.join(t.shots, 'test', 't-spawn-1.avif')).equals(imageBefore)).toBe(true);
  });

  it('dates an entry by its capture file when no --date is given', async () => {
    const callouts = few();
    writeContent(t, callouts);
    const manifest = manifestFor(callouts);
    writeManifest(t, manifest);
    await writeCaptures(t, manifest, { only: [1] });
    const png = path.join(t.captures, captureFileName(1, manifest.shots[0]!.pose.title, manifest.shots[0]!.note));
    utimesSync(png, new Date(2026, 9, 31, 12), new Date(2026, 9, 31, 12));
    await processShots(withoutDate());
    expect(allShots()[0]?.captured).toBe('2026-10-31');
  });
});

describe('processShots, things that go wrong', () => {
  it('reports a missing capture and carries on with the others', async () => {
    const callouts = few();
    writeContent(t, callouts);
    const manifest = manifestFor(callouts);
    writeManifest(t, manifest);
    await writeCaptures(t, manifest, { only: manifest.shots.filter((s) => s.n !== 2).map((s) => s.n) });
    const report = await processShots(job());
    expect(report.problems).toHaveLength(1);
    expect(report.problems[0]).toContain('test.t-spawn shot 2');
    expect(report.problems[0]).toContain('no capture');
    expect(allShots()).toHaveLength(manifest.shots.length - 1);
    expect(existsSync(path.join(t.shots, 'test', 't-spawn-2.avif'))).toBe(false);
  });

  it("says when the driver recorded that a capture failed", async () => {
    const callouts = few();
    writeContent(t, callouts);
    const manifest = manifestFor(callouts);
    writeManifest(t, manifest);
    await writeCaptures(t, manifest, { only: [] });
    writeFileSync(path.join(t.captures, 'results.json'), JSON.stringify({ manifest: 'de_test', results: [{ n: 1, file: null, status: 'CS2 is not the foreground window', seconds: 1 }] }));
    const report = await processShots(job());
    expect(report.problems.find((p) => p.includes('shot 1'))).toContain('the capture failed (CS2 is not the foreground window)');
  });

  it('rejects a capture that is not 16:9 and writes neither an image nor an entry for it', async () => {
    const callouts = few();
    writeContent(t, callouts);
    const manifest = manifestFor(callouts);
    writeManifest(t, manifest);
    await writeCaptures(t, manifest, { only: manifest.shots.filter((s) => s.n !== 1).map((s) => s.n) });
    await writePng(path.join(t.captures, captureFileName(1, manifest.shots[0]!.pose.title, manifest.shots[0]!.note)), { width: 800, height: 600 });
    const report = await processShots(job());
    expect(report.problems).toEqual(['test/t-spawn-1.avif: 800x600 is not 16:9']);
    expect(existsSync(path.join(t.shots, 'test', 't-spawn-1.avif'))).toBe(false);
    expect(readCallouts().find((c) => c.id === 't-spawn')?.shots ?? []).toEqual([]);
    expect(allShots().some((s) => s.file === 'test/t-spawn-1.avif')).toBe(false);
    expect(allShots()).toHaveLength(manifest.shots.length - 1);
  });

  it('rejects a file that is not an image', async () => {
    const callouts = few();
    writeContent(t, callouts);
    const manifest = oneShot(callouts);
    writeManifest(t, manifest);
    writeFileSync(path.join(t.captures, captureFileName(1, manifest.shots[0]!.pose.title, manifest.shots[0]!.note)), 'this is not a png');
    const report = await processShots(job());
    expect(report.problems).toHaveLength(1);
    expect(report.problems[0]).toMatch(/^test\/t-spawn-1\.avif: /);
    expect(allShots()).toHaveLength(0);
  });

  it('does not convert or list a shot for a callout that is not in the file, and never creates the callout', async () => {
    const callouts = few();
    writeContent(t, callouts.filter((c) => c.id !== 'test.palace'));
    const manifest = manifestFor(callouts);
    writeManifest(t, manifest);
    await writeCaptures(t, manifest);
    const report = await processShots(job());
    expect(report.rows.filter((r) => r.status === 'no-callout').map((r) => r.calloutId)).toEqual(['test.palace', 'test.palace', 'test.palace']);
    expect(existsSync(path.join(t.shots, 'test', 'palace-1.avif'))).toBe(false);
    expect(readCallouts().some((c) => c.id === 'test.palace')).toBe(false);
    expect(report.problems).toEqual([]);
  });

  it('refuses a manifest for another map, a missing manifest and a missing callouts file, writing nothing', async () => {
    const callouts = few();
    writeContent(t, callouts);
    const manifest = manifestFor(callouts);
    writeManifest(t, { ...manifest, map: 'de_other' });
    await writeCaptures(t, manifest);
    expect((await processShots(job())).problems).toEqual(['the manifest is for de_other, not de_test']);

    const { rmSync } = await import('node:fs');
    rmSync(t.manifestFile);
    const missing = await processShots(job());
    expect(missing.problems[0]).toMatch(/missing .*capture-manifest\.json \(save the plan in the Editor/);

    writeManifest(t, manifest);
    rmSync(path.join(t.data, 'callouts', 'de_test.json'));
    expect((await processShots(job())).problems[0]).toMatch(/missing .*callouts/);
    expect(existsSync(t.shots)).toBe(false);
  });

  it('refuses a manifest that is not a capture manifest', async () => {
    writeContent(t);
    writeFileSync(t.manifestFile, JSON.stringify({ map: 'de_test', shots: [{ n: 'one' }] }));
    const report = await processShots(job());
    expect(report.problems).toHaveLength(1);
    expect(report.problems[0]).toMatch(/^the manifest is not a capture manifest: shots\.0\./);
  });

  it('reports a shot taken outside the radar and writes nothing to the callouts file', async () => {
    const callouts = few();
    writeContent(t, callouts);
    const manifest = manifestFor(callouts.slice(0, 1));
    writeManifest(t, { ...manifest, shots: manifest.shots.map((s) => (s.n === 1 ? { ...s, pose: { ...s.pose, x: 90_000 } } : s)) });
    await writeCaptures(t, manifest);
    const before = calloutsText();
    const report = await processShots(job());
    expect(report.problems.some((p) => p.includes('[shot-bounds]'))).toBe(true);
    expect(report.problems.at(-1)).toBe('nothing written to the callouts file');
    expect(report.wroteCallouts).toBe(false);
    expect(calloutsText()).toBe(before);
  });
});

describe('processShots, options', () => {
  it('a dry run encodes and writes nothing, but reports what it would do', async () => {
    const callouts = few();
    writeContent(t, callouts);
    const manifest = manifestFor(callouts);
    writeManifest(t, manifest);
    await writeCaptures(t, manifest);
    const before = calloutsText();
    const report = await processShots(job({ dryRun: true }));
    expect(report.problems).toEqual([]);
    expect(report.rows.every((r) => r.status === 'added')).toBe(true);
    expect(report.converted).toHaveLength(manifest.shots.length);
    expect(existsSync(t.shots)).toBe(false);
    expect(calloutsText()).toBe(before);
    expect(backups()).toEqual([]);
    expect(report.wroteCallouts).toBe(false);
  });

  it('lowers the quality until the file fits the size budget, and says so when it cannot', async () => {
    const callouts = bareCallouts().slice(0, 1);
    writeContent(t, callouts);
    const manifest = oneShot(callouts);
    writeManifest(t, manifest);
    await writeCaptures(t, manifest, { noise: true, only: [1] });
    const roomy = await processShots(job({ quality: 60, maxKb: 5000, minQuality: 40 }));
    const hungry = roomy.converted[0]!;
    expect(hungry.quality).toBe(60);

    const { rmSync } = await import('node:fs');
    rmSync(path.join(t.shots, 'test', 't-spawn-1.avif'));
    rmSync(path.join(t.data, 'callouts', 'de_test.json'));
    writeContent(t, callouts);
    const lines: string[] = [];
    const tight = await processShots(job({ quality: 60, maxKb: Math.floor(hungry.bytes / 1024 / 2), minQuality: 40, log: (l) => lines.push(l) }));
    expect(tight.converted[0]!.quality).toBeLessThan(60);
    expect(tight.converted[0]!.quality).toBeGreaterThanOrEqual(40);
    expect(tight.converted[0]!.bytes).toBeLessThan(hungry.bytes);
    if (tight.converted[0]!.quality === 40 && tight.converted[0]!.bytes > Math.floor(hungry.bytes / 2)) expect(lines.join('\n')).toContain('over the size budget');
  });

  it('writes a WebP beside each AVIF with --webp', async () => {
    const callouts = bareCallouts().slice(0, 1);
    writeContent(t, callouts);
    const manifest = oneShot(callouts);
    writeManifest(t, manifest);
    await writeCaptures(t, manifest, { only: [1] });
    await processShots(job({ webp: true }));
    const meta = await sharp(path.join(t.shots, 'test', 't-spawn-1.webp')).metadata();
    expect({ w: meta.width, h: meta.height, format: meta.format }).toEqual({ w: 1280, h: 720, format: 'webp' });
    // the entry lists the AVIF; the WebP is a spare for a browser without AVIF
    expect(allShots()[0]?.file).toBe('test/t-spawn-1.avif');
  });

  it('takes the build from --build, else from the map record', async () => {
    const callouts = bareCallouts().slice(0, 1);
    writeContent(t, callouts);
    const manifest = oneShot(callouts);
    writeManifest(t, manifest);
    await writeCaptures(t, manifest, { only: [1] });
    await processShots(job({ build: '99999' }));
    expect(allShots()[0]?.build).toBe('99999');
  });

  it('downsizes a full-size 1920x1080 capture to 1280x720', async () => {
    const callouts = bareCallouts().slice(0, 1);
    writeContent(t, callouts);
    const manifest = oneShot(callouts);
    writeManifest(t, manifest);
    await writeCaptures(t, manifest, { only: [1], width: 1920, height: 1080 });
    expect((await processShots(job())).problems).toEqual([]);
    const meta = await sharp(path.join(t.shots, 'test', 't-spawn-1.avif')).metadata();
    expect([meta.width, meta.height]).toEqual([1280, 720]);
  });
});

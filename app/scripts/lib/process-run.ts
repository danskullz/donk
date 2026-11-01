// `pnpm content:process` without the command line (SCOPE.md §3.5, §8.2): converts the capture driver's PNGs to
// 1280x720 AVIF under the shots folder and adds the matching `shots` entries to data/callouts/<map>.json.
//
// It is safe to run again: an entry that is already there and the same is left alone, one that differs is reported and
// not overwritten unless `force` is set, and a callout that is not in the file is never created or touched. The
// previous callouts file is copied to data/.backups first, as the Editor does.

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { stableJson } from '../../src/core/editor/json';
import { CalloutsFileSchema, MapSchema } from '../../src/core/schema';
import { validateMapData } from '../../src/core/validate';
import { CaptureManifestSchema, fullEntry, localDate, mergeShots, planShots, type MergeRow, type PlannedShot } from './shots';

export const FRAME = { width: 1280, height: 720 } as const;

export interface ProcessJob {
  map: string;
  /** Content folder: maps/<map>.json and callouts/<map>.json. */
  dataDir: string;
  /** Where the AVIF files go: <shotsDir>/<map>/<callout>-<n>.avif. */
  shotsDir: string;
  /** The capture driver's output folder (shot_NN_<title>.png and results.json). */
  capturesDir: string;
  /** The Editor's capture manifest. */
  manifestFile: string;
  /** Replace entries that differ from the ones already in the file. */
  force?: boolean;
  /** Say what would happen; write nothing. */
  dryRun?: boolean;
  /** AVIF quality to start from (1-100). Default 60. */
  quality?: number;
  /** Re-encode at lower quality until a file is no bigger than this, down to `minQuality`. Default 90 KB. */
  maxKb?: number;
  minQuality?: number;
  /** AVIF encoder effort, 0 (fast, larger) to 9 (slow, smaller). Default 4. */
  effort?: number;
  /** Also write <name>.webp beside each AVIF. */
  webp?: boolean;
  /** `captured` for every entry (YYYY-MM-DD). Default: the date of the capture file. */
  date?: string;
  /** `build` for every entry. Default: the map record's gameBuild. */
  build?: string;
  log?: (line: string) => void;
}

export interface ProcessReport {
  rows: MergeRow[];
  /** AVIF files written (or that would be written, on a dry run). */
  converted: { file: string; bytes: number; quality: number; seconds: number }[];
  /** Things that stop a shot being processed: no capture, bad image, not 16:9, a conflict. */
  problems: string[];
  wroteCallouts: boolean;
}

const KEEP_BACKUPS = 30;
const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

/** One PNG to a 1280x720 AVIF, lowering the quality if the first try is over the size budget. */
export async function encodeAvif(png: string, o: { quality: number; maxBytes: number; minQuality: number; effort?: number }): Promise<{ data: Buffer; quality: number }> {
  const meta = await sharp(png).metadata();
  if (!meta.width || !meta.height) throw new Error('not an image');
  if (Math.abs(meta.width / meta.height - FRAME.width / FRAME.height) > 0.01) throw new Error(`${meta.width}x${meta.height} is not 16:9`);
  let quality = o.quality;
  for (;;) {
    const data = await sharp(png).resize(FRAME.width, FRAME.height, { fit: 'cover' }).avif({ quality, effort: o.effort ?? 4 }).toBuffer();
    if (data.length <= o.maxBytes || quality <= o.minQuality) return { data, quality };
    quality = Math.max(o.minQuality, quality - 5);
  }
}

function backup(dataDir: string, mapId: string, file: string): void {
  const root = path.join(dataDir, '.backups', mapId);
  const dir = path.join(root, new Date().toISOString().replace(/[:.]/g, '-'));
  mkdirSync(dir, { recursive: true });
  copyFileSync(file, path.join(dir, 'callouts.json'));
  for (const old of readdirSync(root).sort().slice(0, -KEEP_BACKUPS)) rmSync(path.join(root, old), { recursive: true, force: true });
}

const readJson = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'));

export async function processShots(job: ProcessJob): Promise<ProcessReport> {
  const say = job.log ?? (() => {});
  const report: ProcessReport = { rows: [], converted: [], problems: [], wroteCallouts: false };
  const problem = (text: string) => {
    report.problems.push(text);
    say(`  problem: ${text}`);
  };

  const mapFile = path.join(job.dataDir, 'maps', `${job.map}.json`);
  const calloutsFile = path.join(job.dataDir, 'callouts', `${job.map}.json`);
  for (const f of [mapFile, calloutsFile, job.manifestFile]) {
    if (!existsSync(f)) {
      problem(`missing ${f}${f === job.manifestFile ? ' (save the plan in the Editor to write the capture manifest)' : ''}`);
      return report;
    }
  }
  const map = MapSchema.parse(readJson(mapFile));
  const callouts = CalloutsFileSchema.parse(readJson(calloutsFile));
  const parsedManifest = CaptureManifestSchema.safeParse(readJson(job.manifestFile));
  if (!parsedManifest.success) {
    problem(`the manifest is not a capture manifest: ${parsedManifest.error.issues[0]?.path.join('.')}: ${parsedManifest.error.issues[0]?.message}`);
    return report;
  }
  if (parsedManifest.data.map !== job.map) {
    problem(`the manifest is for ${parsedManifest.data.map}, not ${job.map}`);
    return report;
  }

  const { planned, problems } = planShots(parsedManifest.data);
  problems.forEach(problem);
  const build = job.build ?? map.gameBuild;
  const results = existsSync(path.join(job.capturesDir, 'results.json')) ? (readJson(path.join(job.capturesDir, 'results.json')) as { results?: { n: number; file: string | null; status: string }[] }) : null;

  // Which planned shots have a capture, and when it was taken.
  const have: { plan: PlannedShot; source: string; captured: string }[] = [];
  for (const p of planned) {
    const source = path.join(job.capturesDir, p.capture);
    if (!existsSync(source)) {
      const failed = results?.results?.find((r) => r.n === p.n && r.file === null);
      problem(`${p.calloutId} shot ${p.n}: ${failed ? `the capture failed (${failed.status})` : `no capture ${p.capture} in ${job.capturesDir}`}`);
      continue;
    }
    have.push({ plan: p, source, captured: job.date ?? localDate(statSync(source).mtimeMs) });
  }

  // Decide first, from the entries alone, so nothing is converted for a conflict or a callout that is not in the file.
  const wanted = have.map((h) => ({ calloutId: h.plan.calloutId, entry: fullEntry(h.plan, h.captured, build) }));
  const first = mergeShots(callouts, wanted, job.force === true);
  const quality = job.quality ?? 60;
  const options = { quality, maxBytes: (job.maxKb ?? 90) * 1024, minQuality: job.minQuality ?? 40, effort: job.effort ?? 4 };
  const failed = new Set<string>();

  for (const row of first.rows) {
    const h = have.find((x) => x.plan.file === row.file);
    if (!h) continue;
    if (row.status === 'no-callout') {
      say(`  skip     ${row.file}: ${row.calloutId} is not in callouts/${job.map}.json`);
      continue;
    }
    if (row.status === 'conflict') {
      problem(`${row.file} is already listed with a different ${row.differs?.join(', ')}; use --force to replace it`);
      continue;
    }
    const out = path.join(job.shotsDir, row.file);
    if (row.status === 'unchanged' && existsSync(out)) {
      say(`  same     ${row.file}`);
      continue;
    }
    try {
      const t0 = performance.now();
      const { data, quality: used } = await encodeAvif(h.source, options);
      const seconds = (performance.now() - t0) / 1000;
      if (!job.dryRun) {
        mkdirSync(path.dirname(out), { recursive: true });
        writeFileSync(`${out}.tmp`, data);
        renameSync(`${out}.tmp`, out);
        if (job.webp) {
          const webp = await sharp(h.source).resize(FRAME.width, FRAME.height, { fit: 'cover' }).webp({ quality: 75 }).toBuffer();
          writeFileSync(path.join(job.shotsDir, row.file.replace(/\.avif$/, '.webp')), webp);
        }
      }
      report.converted.push({ file: row.file, bytes: data.length, quality: used, seconds });
      say(`  ${row.status === 'unchanged' ? 'redone   ' : row.status.padEnd(8)} ${row.file}  ${kb(data.length)} (quality ${used}, ${seconds.toFixed(1)} s)${data.length > options.maxBytes ? '  over the size budget' : ''}${row.differs ? `  [was different: ${row.differs.join(', ')}]` : ''}`);
    } catch (e) {
      failed.add(row.file);
      problem(`${row.file}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // The entries to write: those whose image is in place, plus those already listed.
  const final = mergeShots(
    callouts,
    wanted.filter((w) => !failed.has(w.entry.file)),
    job.force === true,
  );
  report.rows = final.rows;
  const touched = new Set(final.rows.filter((r) => r.status === 'added' || r.status === 'replaced').map((r) => r.calloutId));
  if (touched.size === 0) return report;

  const parsed = CalloutsFileSchema.safeParse(final.callouts);
  if (!parsed.success) {
    problem(`the updated callouts do not match the schema (${parsed.error.issues[0]?.path.join('.')}: ${parsed.error.issues[0]?.message}); nothing written`);
    return report;
  }
  const bad = validateMapData(map, parsed.data).filter((i) => i.severity === 'error' && i.rule.startsWith('shot-') && i.callout !== undefined && touched.has(i.callout));
  if (bad.length > 0) {
    bad.forEach((i) => problem(`[${i.rule}] ${i.callout}: ${i.message}`));
    problem('nothing written to the callouts file');
    return report;
  }
  if (job.dryRun) return report;

  backup(job.dataDir, job.map, calloutsFile);
  const tmp = `${calloutsFile}.tmp`;
  writeFileSync(tmp, stableJson(parsed.data), 'utf8');
  renameSync(tmp, calloutsFile);
  report.wroteCallouts = true;
  return report;
}

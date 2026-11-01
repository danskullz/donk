// `pnpm content:art` without the command line: reads the decoded nav meshes and projections, writes data/art/<map>.json
// (SCOPE.md §3.6) and checks each silhouette against Valve's radar image. `make-art.mjs` calls this.
//
// The projection comes from the map's record in data/maps when there is one, and from the extracted overview file
// otherwise, so every map with a nav mesh gets art whether or not it has callouts yet.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { z } from 'zod';
import { ArtFileSchema } from '../../src/core/artfile';
import { NavMeshSchema } from '../../src/core/editor/nav';
import { stableJson } from '../../src/core/editor/json';
import type { Level, Projection } from '../../src/core/projection';
import { MapSchema } from '../../src/core/schema';
import { buildArt, type LevelArt } from './art';

export interface ArtJob {
  /** Content folder: maps/ is read for projections. */
  dataDir: string;
  /** Generated Valve folder: nav/, radars/, overviews/. */
  assetsDir: string;
  /** Where data/art/<map>.json is written. */
  outDir: string;
  /** Only these maps; all maps that have a nav mesh when empty. */
  maps?: readonly string[];
  /** Compare each silhouette with the radar image when there is one. Default true. */
  check?: boolean;
  /** Starting detail tolerance in radar pixels. Default 1. */
  tolerance?: number;
  /** Size budget for one map's file in bytes; the tolerance grows until it fits. Default 150,000. */
  budget?: number;
  log?: (line: string) => void;
}

export interface MapSource {
  id: string;
  projection: Projection;
  levels: Level[];
  radarSize: number;
  gameBuild: string;
  from: 'map record' | 'overview file';
}

export interface Overlap {
  /** Share of the radar's solid pixels that the art covers. Well under 1 is normal: the radar also draws wall thickness
   *  and, on multi-floor maps, the other floor. */
  covered: number;
  /** Share of the art's pixels that the radar does not draw: the alignment error, near 0 when the projection is right. */
  stray: number;
  /** Intersection over union of the two. */
  iou: number;
}

export interface MapReport {
  id: string;
  from: MapSource['from'];
  file: string;
  bytes: number;
  tolerance: number;
  written: boolean;
  levels: Record<string, LevelArt & { overlap?: Overlap }>;
  seconds: number;
}

const OverviewsSchema = z.looseObject({
  gameBuildId: z.string(),
  maps: z.record(
    z.string(),
    z.looseObject({
      posX: z.number(),
      posY: z.number(),
      scale: z.number().positive(),
      levels: z
        .array(z.looseObject({ id: z.string(), altitudeMin: z.number().optional(), altitudeMax: z.number().optional(), radarSize: z.tuple([z.number(), z.number()]).optional() }))
        .min(1),
    }),
  ),
});

const readJson = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'));

/** Projection, levels and build for a map: its record in data/maps, else the extracted overview file; null if neither. */
export function loadMapSource(id: string, dataDir: string, assetsDir: string): MapSource | null {
  const record = path.join(dataDir, 'maps', `${id}.json`);
  if (existsSync(record)) {
    const map = MapSchema.parse(readJson(record));
    return { id, projection: map.projection, levels: map.levels, radarSize: map.radarSize, gameBuild: map.gameBuild, from: 'map record' };
  }
  const overviews = path.join(assetsDir, 'overviews', 'overviews.json');
  if (!existsSync(overviews)) return null;
  const all = OverviewsSchema.parse(readJson(overviews));
  const o = all.maps[id];
  if (!o) return null;
  return {
    id,
    projection: { posX: o.posX, posY: o.posY, scale: o.scale },
    levels: o.levels.map((l): Level => ({ id: l.id, altitudeMin: l.altitudeMin, altitudeMax: l.altitudeMax })),
    radarSize: o.levels[0]?.radarSize?.[0] ?? 1024,
    gameBuild: all.gameBuildId,
    from: 'overview file',
  };
}

/** Valve's radar for a level: `de_nuke.png` for the first, `de_nuke_lower.png` for the others. */
export function radarFile(assetsDir: string, mapId: string, levelId: string, first: boolean): string {
  return path.join(assetsDir, 'radars', first ? `${mapId}.png` : `${mapId}_${levelId}.png`);
}

/** How well the silhouette matches the walkable pixels of the radar (alpha of at least half), both at `size` px square. */
export async function compareWithRadar(pathD: string, radarPng: string, size: number): Promise<Overlap> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" fill="#000"/><path d="${pathD}" fill="#fff" fill-rule="nonzero"/></svg>`;
  const art = await sharp(Buffer.from(svg)).resize(size, size).greyscale().raw().toBuffer();
  const radar = await sharp(radarPng).resize(size, size).ensureAlpha().extractChannel(3).raw().toBuffer();
  let both = 0;
  let onlyRadar = 0;
  let onlyArt = 0;
  for (let i = 0; i < art.length; i++) {
    const a = (art[i] as number) >= 128;
    const r = (radar[i] as number) >= 128;
    if (a && r) both += 1;
    else if (r) onlyRadar += 1;
    else if (a) onlyArt += 1;
  }
  const total = both + onlyRadar;
  const artTotal = both + onlyArt;
  return { covered: total ? both / total : 0, stray: artTotal ? onlyArt / artTotal : 0, iou: both + onlyRadar + onlyArt ? both / (both + onlyRadar + onlyArt) : 0 };
}

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

/** Art for one map. Grows the tolerance until the file fits the budget. */
export async function makeMapArt(source: MapSource, mesh: unknown, job: ArtJob): Promise<MapReport> {
  const t0 = performance.now();
  const parsed = NavMeshSchema.parse(mesh);
  const budget = job.budget ?? 150_000;
  let tolerance = job.tolerance ?? 1;
  let levels = buildArt(parsed, source.projection, source.levels, { tolerance });
  let text = '';
  for (let attempt = 0; ; attempt++) {
    text = stableJson({ map: source.id, gameBuild: source.gameBuild, levels: Object.fromEntries(Object.entries(levels).map(([id, l]) => [id, l.path])) });
    if (Buffer.byteLength(text) <= budget || attempt >= 6) break;
    tolerance = Math.round(tolerance * 1.5 * 100) / 100;
    levels = buildArt(parsed, source.projection, source.levels, { tolerance });
  }
  ArtFileSchema.parse(JSON.parse(text));

  const file = path.join(job.outDir, `${source.id}.json`);
  const unchanged = existsSync(file) && readFileSync(file, 'utf8') === text;
  if (!unchanged) {
    mkdirSync(job.outDir, { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, text, 'utf8');
    renameSync(tmp, file);
  }

  const withOverlap: MapReport['levels'] = {};
  let first = true;
  for (const level of source.levels) {
    const art = levels[level.id];
    if (!art) {
      first = false;
      continue;
    }
    const radar = radarFile(job.assetsDir, source.id, level.id, first);
    withOverlap[level.id] = job.check !== false && existsSync(radar) ? { ...art, overlap: await compareWithRadar(art.path, radar, source.radarSize) } : art;
    first = false;
  }
  return { id: source.id, from: source.from, file, bytes: Buffer.byteLength(text), tolerance, written: !unchanged, levels: withOverlap, seconds: (performance.now() - t0) / 1000 };
}

/** The ids of the maps that have a nav mesh in the assets folder. */
export function mapsWithNav(assetsDir: string): string[] {
  const dir = path.join(assetsDir, 'nav');
  return existsSync(dir) ? readdirSync(dir).filter((f) => /^de_[a-z0-9]+\.json$/.test(f)).map((f) => f.slice(0, -5)).sort() : [];
}

export async function runArt(job: ArtJob): Promise<{ reports: MapReport[]; problems: string[] }> {
  const say = job.log ?? (() => {});
  const available = mapsWithNav(job.assetsDir);
  const wanted = job.maps && job.maps.length > 0 ? [...job.maps] : available;
  const reports: MapReport[] = [];
  const problems: string[] = [];
  for (const id of wanted) {
    if (!available.includes(id)) {
      problems.push(`${id}: no nav mesh at ${path.join(job.assetsDir, 'nav', `${id}.json`)}`);
      continue;
    }
    const source = loadMapSource(id, job.dataDir, job.assetsDir);
    if (!source) {
      problems.push(`${id}: no projection (not in data/maps and not in overviews/overviews.json)`);
      continue;
    }
    try {
      const report = await makeMapArt(source, readJson(path.join(job.assetsDir, 'nav', `${id}.json`)), job);
      reports.push(report);
      for (const [levelId, l] of Object.entries(report.levels)) {
        const o = l.overlap;
        say(
          `${id.padEnd(12)} ${levelId.padEnd(8)} ${String(l.loops).padStart(4)} loops ${String(l.points).padStart(6)} corners  ${o ? `${((1 - o.stray) * 100).toFixed(1)}% of the art is on the radar, which it fills ${(o.covered * 100).toFixed(1)}% of` : 'no radar to compare'}`,
        );
      }
      say(`${' '.repeat(12)} ${path.relative(process.cwd(), report.file) || report.file}: ${kb(report.bytes)}, tolerance ${report.tolerance} px, ${report.written ? 'written' : 'unchanged'}, ${report.seconds.toFixed(1)} s (projection from ${report.from})`);
    } catch (e) {
      problems.push(`${id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { reports, problems };
}

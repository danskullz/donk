// Synthetic content for the pipeline's tests and for e2e/shots.spec.ts: a temp folder laid out like the repository
// (data/, assets/valve, assets/shots) holding the fixture map `de_test`, plus PNGs made with sharp. Nothing here is
// Valve's; the real nav mesh, radars and captures only exist on Dan's machine (SCOPE §9).

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import type { EditorDoc, PlannedShot } from '../../src/core/editor/doc';
import { stableJson } from '../../src/core/editor/json';
import { captureManifest, type CaptureManifest } from '../../src/core/editor/shotplan';
import type { Callout, MapRecord } from '../../src/core/schema';
import { makeCallouts, makeMap } from '../../src/core/test-fixtures';
import { captureFileName, planShots } from './shots';

export interface TempContent {
  root: string;
  /** The content folder: maps/, callouts/, editor/. */
  data: string;
  /** The generated Valve folder: nav/, radars/, overviews/. */
  assets: string;
  /** Processed screenshots: <shots>/<map>/<callout>-<n>.avif */
  shots: string;
  /** The capture driver's output folder. */
  captures: string;
  /** The Editor's capture manifest for the fixture map. */
  manifestFile: string;
  art: string;
  cleanup(): void;
}

/** A new empty folder tree under the system temp folder. */
export function makeTempContent(prefix = 'callouts-content-'): TempContent {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  const data = path.join(root, 'data');
  const assets = path.join(root, 'assets', 'valve');
  const t: TempContent = {
    root,
    data,
    assets,
    shots: path.join(root, 'assets', 'shots'),
    captures: path.join(assets, 'capture', 'de_test'),
    manifestFile: path.join(data, 'editor', 'de_test.capture-manifest.json'),
    art: path.join(data, 'art'),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
  for (const dir of [path.join(data, 'maps'), path.join(data, 'callouts'), path.join(data, 'editor'), t.captures]) mkdirSync(dir, { recursive: true });
  return t;
}

export const FIXTURE_MAP: MapRecord = { ...makeMap(), status: 'draft' };

/** The fixture callouts with no screenshots yet, as they are before the first capture. */
export function bareCallouts(): Callout[] {
  return makeCallouts().map((c) => ({ ...c, shots: [] }));
}

/** Writes data/maps, data/callouts and data/index.json for the fixture map (available) the way the Editor writes them. */
export function writeContent(t: TempContent, callouts: readonly Callout[] = bareCallouts(), map: MapRecord = FIXTURE_MAP): void {
  writeFileSync(path.join(t.data, 'maps', `${map.id}.json`), stableJson(map));
  writeFileSync(path.join(t.data, 'callouts', `${map.id}.json`), stableJson(callouts));
  writeFileSync(path.join(t.data, 'index.json'), stableJson([{ id: map.id, displayName: map.displayName, pool: map.pool, available: true }]));
}

/** Standard callouts get inside, approach, alternate; Hard spots approach and overview: all inside the fixture's radar. */
export function planFor(callouts: readonly Callout[]): Record<string, PlannedShot[]> {
  const plan: Record<string, PlannedShot[]> = {};
  for (const c of callouts) {
    const [ax, ay] = c.anchor;
    const kinds: PlannedShot['kind'][] = c.tier === 3 ? ['approach', 'overview'] : ['inside', 'approach', 'alternate'];
    plan[c.id] = kinds.map((kind, i) => ({ pos: [ax + 10 * i, ay - 10, 64], yaw: 15 * i, pitch: i === 0 ? 0 : -4, stance: 'stand', kind }));
  }
  return plan;
}

/** The capture manifest the Editor would write for these callouts. */
export function manifestFor(callouts: readonly Callout[], plan: Readonly<Record<string, readonly PlannedShot[]>> = planFor(callouts), map: MapRecord = FIXTURE_MAP): CaptureManifest {
  const doc: Pick<EditorDoc, 'map' | 'callouts' | 'plan'> = { map, callouts: [...callouts], plan };
  return captureManifest(doc);
}

export function writeManifest(t: TempContent, manifest: CaptureManifest): void {
  writeFileSync(t.manifestFile, stableJson(manifest));
}

/** A solid or noisy PNG. Noise is the worst case for a codec: it makes an AVIF big enough to test the size budget. */
export async function writePng(file: string, o: { width?: number; height?: number; color?: [number, number, number]; noise?: boolean; seed?: number } = {}): Promise<void> {
  const width = o.width ?? 640;
  const height = o.height ?? 360;
  const [r, g, b] = o.color ?? [60, 90, 130];
  const raw = Buffer.alloc(width * height * 3);
  let state = (o.seed ?? 1) >>> 0 || 1;
  for (let i = 0; i < raw.length; i += 3) {
    if (o.noise) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      raw[i] = state >>> 24;
      raw[i + 1] = (state >>> 16) & 255;
      raw[i + 2] = (state >>> 8) & 255;
    } else {
      // a diagonal gradient, so a "screenshot" is not one flat colour
      const v = ((i / 3) % width) / width;
      raw[i] = Math.round(r * (0.6 + 0.4 * v));
      raw[i + 1] = Math.round(g * (0.6 + 0.4 * v));
      raw[i + 2] = Math.round(b * (0.6 + 0.4 * v));
    }
  }
  mkdirSync(path.dirname(file), { recursive: true });
  await sharp(raw, { raw: { width, height, channels: 3 } }).png().toFile(file);
}

/** Writes the capture driver's PNGs for the manifest's shots (all, or those whose number `only` lists) and its results.json. */
export async function writeCaptures(t: TempContent, manifest: CaptureManifest, o: { only?: readonly number[]; width?: number; height?: number; noise?: boolean } = {}): Promise<string[]> {
  const written: string[] = [];
  const results: { n: number; file: string | null; status: string; seconds: number }[] = [];
  for (const s of manifest.shots) {
    if (o.only && !o.only.includes(s.n)) continue;
    const name = captureFileName(s.n, s.pose.title, s.note);
    await writePng(path.join(t.captures, name), { ...(o.width ? { width: o.width } : {}), ...(o.height ? { height: o.height } : {}), ...(o.noise ? { noise: true } : {}), color: [40 + s.n * 7, 90, 150 - s.n * 3], seed: s.n });
    written.push(name);
    results.push({ n: s.n, file: name, status: 'captured', seconds: 1.5 });
  }
  writeFileSync(path.join(t.captures, 'results.json'), JSON.stringify({ manifest: manifest.map, results }, null, 2));
  return written;
}

/** The files `planShots` expects, for assertions: callout id -> processed file names. */
export function expectedFiles(manifest: CaptureManifest): string[] {
  return planShots(manifest).planned.map((p) => p.file);
}

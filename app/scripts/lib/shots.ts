// The pure side of `pnpm content:process` (SCOPE.md §3.5, §8.2): turning the Editor's capture manifest and the capture
// driver's file names into `shots` entries, and merging those into a map's callouts without disturbing what is there.
// No file access here; `process-run.ts` does that.

import { z } from 'zod';
import { CalloutIdSchema, MapIdSchema, ShotSchema, mapSlug, type Callout, type Shot } from '../../src/core/schema';

/** What the Editor writes (`CaptureManifest` in core/editor/shotplan.ts) and the capture driver reads. */
export const CaptureManifestSchema = z.object({
  map: MapIdSchema,
  shots: z.array(
    z.object({
      n: z.number().int().min(1),
      id: CalloutIdSchema,
      kind: ShotSchema.shape.kind,
      stance: ShotSchema.shape.stance,
      pose: z.object({ x: z.number(), y: z.number(), z: z.number(), pitch: z.number(), yaw: z.number(), title: z.string() }),
      note: z.string(),
    }),
  ),
});

export type CaptureManifest = z.infer<typeof CaptureManifestSchema>;

/** The driver's `slug()` (content-tools/spike/capture_run.py): lower case, runs of other characters become one hyphen. */
export const slugOf = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** `shot_%02d_<slug>.png`, as the driver names it: the title for planned shots, the note for its experiment shots. */
export function captureFileName(n: number, title: string, note: string): string {
  return `shot_${String(n).padStart(2, '0')}_${slugOf(note.startsWith('retake') ? title : note)}.png`;
}

/** `mirage/palace-1.avif`: where a processed shot lives under the shots folder, and the `file` of its entry. */
export const shotFile = (mapId: string, calloutId: string, n: number, ext = 'avif'): string => `${mapSlug(mapId)}/${calloutId.slice(calloutId.indexOf('.') + 1)}-${n}.${ext}`;

/** The shot number of a title `<callout id>-<kind>-<n>`, which the Editor writes; null for a title that is not of that form. */
export function titleNumber(title: string, calloutId: string, kind: string): number | null {
  const prefix = `${calloutId}-${kind}-`;
  if (!title.startsWith(prefix)) return null;
  const rest = title.slice(prefix.length);
  return /^[1-9]\d*$/.test(rest) ? Number(rest) : null;
}

export interface PlannedShot {
  /** Position in the manifest, which is also the number in the capture file's name. */
  n: number;
  calloutId: string;
  /** The capture driver's PNG, relative to the capture folder. */
  capture: string;
  /** The processed AVIF under the shots folder: the entry's `file`. */
  file: string;
  entry: Omit<Shot, 'captured' | 'build'>;
}

/**
 * What each manifest line should become. The number in the file name is the one in the title (`-inside-2` gives
 * `palace-2.avif`), so re-running a capture of a single shot replaces the same file. A title that is not of the
 * Editor's form falls back to counting that callout's shots in manifest order.
 */
export function planShots(manifest: CaptureManifest): { planned: PlannedShot[]; problems: string[] } {
  const planned: PlannedShot[] = [];
  const problems: string[] = [];
  const counted = new Map<string, number>();
  const taken = new Map<string, number>();
  for (const s of manifest.shots) {
    if (!s.id.startsWith(`${mapSlug(manifest.map)}.`)) {
      problems.push(`shot ${s.n}: ${s.id} does not belong to ${manifest.map}`);
      continue;
    }
    const count = (counted.get(s.id) ?? 0) + 1;
    counted.set(s.id, count);
    const number = titleNumber(s.pose.title, s.id, s.kind) ?? count;
    const file = shotFile(manifest.map, s.id, number);
    const clash = taken.get(file);
    if (clash !== undefined) {
      problems.push(`shots ${clash} and ${s.n} would both be ${file}`);
      continue;
    }
    taken.set(file, s.n);
    planned.push({
      n: s.n,
      calloutId: s.id,
      capture: captureFileName(s.n, s.pose.title, s.note),
      file,
      entry: { file, pos: [s.pose.x, s.pose.y, s.pose.z], yaw: s.pose.yaw, pitch: s.pose.pitch, stance: s.stance, kind: s.kind },
    });
  }
  return { planned, problems };
}

/** The entry as the schema orders its keys, so the file diffs cleanly. */
export function fullEntry(p: PlannedShot, captured: string, build: string): Shot {
  const e = p.entry;
  return { file: e.file, pos: e.pos, yaw: e.yaw, pitch: e.pitch, stance: e.stance, kind: e.kind, captured, build };
}

/** Names of the fields in which two entries for the same file differ. */
export function differences(a: Shot, b: Shot): string[] {
  const out: string[] = [];
  for (const key of ['pos', 'yaw', 'pitch', 'stance', 'kind', 'captured', 'build'] as const) {
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) out.push(key);
  }
  return out;
}

export type MergeStatus = 'added' | 'unchanged' | 'replaced' | 'conflict' | 'no-callout';

export interface MergeRow {
  calloutId: string;
  file: string;
  status: MergeStatus;
  /** For a conflict or a replacement: what differs from the entry already there. */
  differs?: string[];
}

/**
 * Adds `wanted` entries to the callouts' `shots`. Existing entries keep their place; new ones go at the end in the
 * order given. An entry for a file that is already listed is left alone if identical, is a conflict if not, and only
 * replaces the old one with `force`. A callout that is not in the list is never created or touched.
 */
export function mergeShots(callouts: readonly Callout[], wanted: readonly { calloutId: string; entry: Shot }[], force: boolean): { callouts: Callout[]; rows: MergeRow[] } {
  const next = callouts.map((c) => ({ ...c, shots: [...c.shots] }));
  const rows: MergeRow[] = [];
  for (const { calloutId, entry } of wanted) {
    const callout = next.find((c) => c.id === calloutId);
    if (!callout) {
      rows.push({ calloutId, file: entry.file, status: 'no-callout' });
      continue;
    }
    const at = callout.shots.findIndex((s) => s.file === entry.file);
    if (at < 0) {
      callout.shots.push(entry);
      rows.push({ calloutId, file: entry.file, status: 'added' });
      continue;
    }
    const diff = differences(callout.shots[at] as Shot, entry);
    if (diff.length === 0) rows.push({ calloutId, file: entry.file, status: 'unchanged' });
    else if (force) {
      callout.shots[at] = entry;
      rows.push({ calloutId, file: entry.file, status: 'replaced', differs: diff });
    } else rows.push({ calloutId, file: entry.file, status: 'conflict', differs: diff });
  }
  return { callouts: next, rows };
}

/** `2026-11-02` in local time. */
export function localDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

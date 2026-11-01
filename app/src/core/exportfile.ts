// The backup file (SCOPE.md §5.8, §7.6): the review log plus the settings in one JSON file, versioned so a later
// version of the app can still read it. Pure functions, no DOM and no storage: the Settings screen reads and writes
// the browser side. Importing merges by event id and never overwrites, so a file can be imported again and again.
//
// The file is read as untrusted input. Each event row is checked on its own with the log's own schema, so one bad row
// is counted and left out instead of sinking the whole file. The settings travel as a plain object: the app layer
// owns their schema (app/settings.ts), and keeping it out of core keeps core free of app code.

import { z } from 'zod';
import { ReviewEventSchema, type ReviewEvent } from './log';
import { mapSlug } from './schema';

export const EXPORT_FORMAT = 'callouts-export';
/** Bump when the file's shape changes, and add the step from the old shape to MIGRATIONS. */
export const EXPORT_VERSION = 1;
/** Larger than any real log (a year of daily use is a few megabytes); the screen refuses bigger files before reading them. */
export const MAX_IMPORT_BYTES = 64 * 1024 * 1024;

export interface ExportFile {
  format: typeof EXPORT_FORMAT;
  version: number;
  /** ISO time the file was made. */
  exportedAt: string;
  settings: Record<string, unknown>;
  events: ReviewEvent[];
}

const byTimeThenId = (a: ReviewEvent, b: ReviewEvent) => a.ts - b.ts || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Events sorted by time then id, so the same log always gives the same file. */
export function buildExport(events: readonly ReviewEvent[], settings: Record<string, unknown>, now: number): ExportFile {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date(now).toISOString(),
    settings: { ...settings },
    events: dedupe(events).sort(byTimeThenId),
  };
}

/** The file's text: valid JSON with one event per line, so a backup is easy to look at and to diff. */
export function serializeExport(file: ExportFile): string {
  const head = JSON.stringify({ format: file.format, version: file.version, exportedAt: file.exportedAt, settings: file.settings });
  const rows = file.events.map((e) => JSON.stringify(e)).join(',\n');
  return `${head.slice(0, -1)},"events":[${rows ? `\n${rows}\n` : ''}]}\n`;
}

/** `callouts-backup-2026-11-02.json`, by the learner's local date. */
export function exportFileName(now: number): string {
  const d = new Date(now);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `callouts-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
}

export type ImportError = 'empty' | 'not-json' | 'not-an-export' | 'too-new';

export type ParsedImport =
  | { ok: false; error: ImportError; message: string }
  | {
      ok: true;
      version: number;
      exportedAt: string | null;
      /** Valid events, each id once, in file order. */
      events: ReviewEvent[];
      /** Rows that did not match the event schema. They are left out. */
      invalid: number;
      /** Valid rows whose id appeared earlier in the same file. */
      repeated: number;
      /** The settings as written in the file, or null when there are none. The app layer validates them. */
      settings: Record<string, unknown> | null;
    };

const FileSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.number().int().min(1),
  exportedAt: z.string().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
  events: z.array(z.unknown()),
});

/**
 * Steps from an older file shape to the next one, keyed by the version they read. Version 1 is the first, so there is
 * nothing here yet; a test fails if EXPORT_VERSION moves without a step for the version before it.
 */
export const MIGRATIONS: Readonly<Record<number, (raw: Record<string, unknown>) => Record<string, unknown>>> = {};

export function parseImport(text: string): ParsedImport {
  if (text.trim() === '') return { ok: false, error: 'empty', message: 'The file is empty.' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'not-json', message: 'That file is not JSON, so it is not a Callouts backup.' };
  }
  const notAnExport: ParsedImport = { ok: false, error: 'not-an-export', message: 'That file is not a Callouts backup.' };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return notAnExport;

  // The version is judged first, so a file from a newer app gets the right message even if its shape has changed.
  const claimed = (raw as Record<string, unknown>)['version'];
  if ((raw as Record<string, unknown>)['format'] !== EXPORT_FORMAT || typeof claimed !== 'number' || !Number.isInteger(claimed) || claimed < 1) {
    return notAnExport;
  }
  if (claimed > EXPORT_VERSION) {
    return {
      ok: false,
      error: 'too-new',
      message: `That backup was made by a newer version of Callouts (file version ${claimed}; this one reads up to ${EXPORT_VERSION}). Update the app first.`,
    };
  }
  let current = raw as Record<string, unknown>;
  for (let v = claimed; v < EXPORT_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) return notAnExport;
    current = step(current);
  }

  const file = FileSchema.safeParse(current);
  if (!file.success) return notAnExport;

  const events: ReviewEvent[] = [];
  const seen = new Set<string>();
  let invalid = 0;
  let repeated = 0;
  for (const row of file.data.events) {
    const parsed = ReviewEventSchema.safeParse(row);
    if (!parsed.success) {
      invalid += 1;
    } else if (seen.has(parsed.data.id)) {
      repeated += 1;
    } else {
      seen.add(parsed.data.id);
      events.push(parsed.data);
    }
  }
  return { ok: true, version: claimed, exportedAt: file.data.exportedAt ?? null, events, invalid, repeated, settings: file.data.settings ?? null };
}

export interface MergeResult {
  /** Everything, sorted by time then id. */
  merged: ReviewEvent[];
  /** Incoming events whose id was not there yet: the ones to write. */
  added: ReviewEvent[];
  /** Incoming events whose id was already there. */
  alreadyHere: number;
  /** Of those, how many differ from the stored one. The stored event is kept. */
  conflicts: number;
}

function sameEvent(a: ReviewEvent, b: ReviewEvent): boolean {
  const x = a as unknown as Record<string, unknown>;
  const y = b as unknown as Record<string, unknown>;
  const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
  for (const k of keys) if (x[k] !== y[k]) return false;
  return true;
}

function dedupe(events: readonly ReviewEvent[]): ReviewEvent[] {
  const seen = new Set<string>();
  const out: ReviewEvent[] = [];
  for (const e of events) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(e);
  }
  return out;
}

/** Merge by event id. The event already stored wins, so an import can never change history. */
export function mergeEvents(existing: readonly ReviewEvent[], incoming: readonly ReviewEvent[]): MergeResult {
  const byId = new Map<string, ReviewEvent>();
  for (const e of existing) if (!byId.has(e.id)) byId.set(e.id, e);
  const added: ReviewEvent[] = [];
  let alreadyHere = 0;
  let conflicts = 0;
  for (const e of incoming) {
    const have = byId.get(e.id);
    if (have) {
      alreadyHere += 1;
      if (!sameEvent(have, e)) conflicts += 1;
    } else {
      byId.set(e.id, e);
      added.push(e);
    }
  }
  return { merged: [...byId.values()].sort(byTimeThenId), added, alreadyHere, conflicts };
}

/** The prefix every callout id of a map carries: `de_mirage` gives `mirage.` */
export function calloutPrefix(mapId: string): string {
  return `${mapSlug(mapId)}.`;
}

/** How many events belong to a map (answers and intro cards), by callout id. */
export function countEventsForMap(events: readonly Pick<ReviewEvent, 'callout'>[], mapId: string): number {
  const prefix = calloutPrefix(mapId);
  let n = 0;
  for (const e of events) if (e.callout.startsWith(prefix)) n += 1;
  return n;
}

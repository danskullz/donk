// Creates the map record for a map that has none yet, from Valve's overview data (the generated file
// assets/valve/overviews/overviews.json). Pure functions only, so the rules are testable without the game files; the
// command that reads and writes files is scripts/init-map.mjs (`pnpm content:init-map`, docs/notes/init-map.md).
//
// Only what the overview file actually knows is filled in: the projection, the radar size, the floors and the game
// build. The zones are Dan's decision and come from the caller; nothing here invents a zone or a callout.

import { z } from 'zod';
import { slugify } from './editor/doc';
import { LIMITS, MapIdSchema, MapSchema, type MapIndexSchema, type MapRecord } from './schema';

export type MapIndexEntry = z.infer<typeof MapIndexSchema>[number];
type Level = MapRecord['levels'][number];
type Zone = MapRecord['zones'][number];

/** Bad input of a kind the owner can fix (as opposed to a bug): the message is meant to be read as it is. */
export class MapInitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MapInitError';
  }
}

// ------------------------------------------------------------------ the overview file

// Loose objects: Valve's file carries more than we use (material, zoom, spawn markers) and may grow. Only the fields
// the record is built from are checked. `radarSize` is optional because the extraction leaves it out of a floor whose
// radar image it could not find; the first floor must have it, and that is checked where it is needed.
const OverviewLevelSchema = z.looseObject({
  id: z.string().min(1),
  altitudeMin: z.number().optional(),
  altitudeMax: z.number().optional(),
  radarSize: z.tuple([z.number().int().positive(), z.number().int().positive()]).optional(),
});

const OverviewEntrySchema = z.looseObject({
  posX: z.number(),
  posY: z.number(),
  scale: z.number().positive(),
  rotate: z.number().optional(),
  levels: z.array(OverviewLevelSchema).min(1),
});

// The entries are left unchecked here so a problem in one map's entry does not stop another map being initialised.
const OverviewFileSchema = z.looseObject({
  gameBuildId: z.string().min(1),
  maps: z.record(z.string(), z.unknown()),
});

type OverviewEntry = z.infer<typeof OverviewEntrySchema>;

const pathText = (path: readonly PropertyKey[]): string =>
  path.map((p, i) => (typeof p === 'number' ? `[${p}]` : `${i === 0 ? '' : '.'}${String(p)}`)).join('');

function issueText(where: string, error: z.ZodError): string {
  return error.issues
    .map((i) => {
      const at = pathText(i.path);
      return `${where}${at === '' ? '' : `.${at}`}: ${i.message}`;
    })
    .join('; ');
}

/** The entry for one map out of the parsed overview file, with the game build the file was made from. */
export function findOverview(json: unknown, mapId: string): { gameBuildId: string; entry: unknown } {
  const file = OverviewFileSchema.safeParse(json);
  if (!file.success) {
    throw new MapInitError(`the overview file is not the expected shape (gameBuildId, maps): ${issueText('overviews', file.error)}`);
  }
  const entry = file.data.maps[mapId];
  if (entry === undefined) {
    const known = Object.keys(file.data.maps).sort();
    throw new MapInitError(`${mapId} is not in the overview file (it has: ${known.length ? known.join(', ') : 'no maps'})`);
  }
  return { gameBuildId: file.data.gameBuildId, entry };
}

function parseEntry(mapId: string, entry: unknown): OverviewEntry {
  const parsed = OverviewEntrySchema.safeParse(entry);
  if (!parsed.success) throw new MapInitError(`the overview entry for ${mapId} is not usable: ${issueText(mapId, parsed.error)}`);
  return parsed.data;
}

// ------------------------------------------------------------------ levels

/**
 * Valve writes 10000 (20000 on Vertigo) where a floor has no limit; the record leaves such a bound out. A size alone
 * cannot tell a sentinel from a real cut: Vertigo's floors really do meet at 11700. So a bound only counts as "no
 * limit" if it is also the outermost one of its kind (the highest max, the lowest min), where nothing sits beyond it.
 */
const NO_LIMIT = 10_000;

function levelsOf(mapId: string, entry: OverviewEntry): Level[] {
  const highest = Math.max(...entry.levels.flatMap((l) => (l.altitudeMax === undefined ? [] : [l.altitudeMax])));
  const lowest = Math.min(...entry.levels.flatMap((l) => (l.altitudeMin === undefined ? [] : [l.altitudeMin])));
  const open = (z: number, outermost: number) => z === outermost && Math.abs(z) >= NO_LIMIT;

  const seen = new Set<string>();
  return entry.levels.map((l) => {
    if (seen.has(l.id)) throw new MapInitError(`${mapId}: two levels are called "${l.id}"`);
    seen.add(l.id);
    const min = l.altitudeMin === undefined || open(l.altitudeMin, lowest) ? undefined : l.altitudeMin;
    const max = l.altitudeMax === undefined || open(l.altitudeMax, highest) ? undefined : l.altitudeMax;
    if (min !== undefined && max !== undefined && min >= max) {
      throw new MapInitError(`${mapId}: level "${l.id}" covers no height (altitudeMin ${min} is not below altitudeMax ${max})`);
    }
    // Key order is the schema's, which is the order the Editor writes.
    return { id: l.id, ...(min === undefined ? {} : { altitudeMin: min }), ...(max === undefined ? {} : { altitudeMax: max }) };
  });
}

function radarSizeOf(mapId: string, entry: OverviewEntry): number {
  const size = entry.levels[0]?.radarSize;
  if (size === undefined) {
    throw new MapInitError(`${mapId}: the first level has no radarSize (the radar image was not found when the overview file was made)`);
  }
  // The record holds one number and the app treats the radar as a square.
  if (size[0] !== size[1]) throw new MapInitError(`${mapId}: the radar is ${size[0]}x${size[1]}, but the app needs a square image`);
  return size[0];
}

/**
 * Things in the overview that the record cannot express, so the numbers may be wrong for this map. They do not stop
 * the record being made; the command prints them.
 */
export function overviewWarnings(mapId: string, entry: unknown): string[] {
  const e = parseEntry(mapId, entry);
  const out: string[] = [];
  if (e.rotate !== undefined && e.rotate !== 0) {
    out.push(`${mapId} has rotate ${e.rotate}; the projection has no rotation, so check the radar against a few known positions`);
  }
  const first = e.levels[0];
  if (first && first.id !== 'default') {
    out.push(`the first level is "${first.id}", not "default"; the Editor takes the first level's radar to be ${mapId}.png`);
  }
  const sizes = new Set(e.levels.flatMap((l) => (l.radarSize ? [`${l.radarSize[0]}x${l.radarSize[1]}`] : [])));
  if (sizes.size > 1) out.push(`the levels' radar images differ in size (${[...sizes].join(', ')}); the record has one radarSize`);
  return out;
}

// ------------------------------------------------------------------ zones

/** `"A Site, Mid, B Site"` -> `["A Site", "Mid", "B Site"]`. Empty items (a trailing comma) are dropped. */
export function parseZoneList(text: string): string[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

/** Zones in the order given, ids made with `slugify` as the Editor does. */
export function zonesFromNames(names: readonly string[]): Zone[] {
  if (names.length === 0) {
    throw new MapInitError('at least one zone is needed, for example --zones "T Spawn, Mid, A Site": the zones are yours to choose');
  }
  const owner = new Map<string, string>();
  return names.map((raw) => {
    const name = raw.trim();
    if (name === '') throw new MapInitError('a zone name is empty');
    if (name.length > LIMITS.name) throw new MapInitError(`zone "${name}" is ${name.length} characters; the limit is ${LIMITS.name}`);
    const id = slugify(name);
    if (id === '') throw new MapInitError(`zone "${name}" has no letters or digits to make an id from`);
    const clash = owner.get(id);
    if (clash !== undefined) throw new MapInitError(`zones "${clash}" and "${name}" both become the id "${id}"`);
    owner.set(id, name);
    return { id, name };
  });
}

// ------------------------------------------------------------------ the record

export interface MapInitOptions {
  /** Zone names, in the order they should have. Required: the zones are Dan's decision, so there is no default. */
  zones: readonly string[];
  /** data/index.json, parsed: where the display name and the pool come from. */
  index: readonly MapIndexEntry[];
}

/** A new `draft` record, revision 1, for a map that is listed in index.json. Throws `MapInitError` on bad input. */
export function mapRecordFromOverview(mapId: string, entry: unknown, gameBuildId: string, options: MapInitOptions): MapRecord {
  const id = MapIdSchema.safeParse(mapId);
  if (!id.success) throw new MapInitError(`"${mapId}" is not a map id (${id.error.issues[0]?.message ?? 'like de_mirage'})`);

  const listed = options.index.find((m) => m.id === mapId);
  if (!listed) {
    throw new MapInitError(`${mapId} is not listed in data/index.json (it lists: ${options.index.map((m) => m.id).join(', ') || 'no maps'})`);
  }
  if (gameBuildId.trim() === '') throw new MapInitError('the overview file has an empty gameBuildId');

  const zones = zonesFromNames(options.zones);
  const e = parseEntry(mapId, entry);

  const record = {
    id: mapId,
    displayName: listed.displayName,
    pool: listed.pool,
    projection: { posX: e.posX, posY: e.posY, scale: e.scale },
    radarSize: radarSizeOf(mapId, e),
    levels: levelsOf(mapId, e),
    gameBuild: gameBuildId,
    revision: 1,
    zones,
    status: 'draft',
  };
  // The schema is the last word: whatever it rejects (a level id that is not a slug, say) is reported, not written.
  const checked = MapSchema.safeParse(record);
  if (!checked.success) throw new MapInitError(`the record for ${mapId} does not pass the map schema: ${issueText('record', checked.error)}`);
  return checked.data;
}

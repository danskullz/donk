// The map art file, data/art/<map>.json (SCOPE.md §3.6): the silhouette of a map's whole walkable surface as SVG path
// data in radar pixels, one path per level. `pnpm content:art` writes it from the decoded nav mesh; the app reads it
// into `MapData.art`. The art is derived from Valve's map geometry, so it is generated and not committed (§9).

import { z } from 'zod';
import { MapIdSchema, type MapRecord } from './schema';

/** Only the characters the generator writes: commands M m L l Z z, numbers, spaces and signs. */
const PATH_DATA = /^M[MmLlZz0-9\s.,-]*$/;

export const ArtFileSchema = z.strictObject({
  map: MapIdSchema,
  gameBuild: z.string().min(1),
  /** Level id -> path data. Draw with the non-zero fill rule: holes are wound the other way, floors that overlap union. */
  levels: z.record(z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), z.string().regex(PATH_DATA, 'path data written by the art generator')),
});

export type ArtFile = z.infer<typeof ArtFileSchema>;

/**
 * The path for a map's first level, which is the one `MapData.art` carries; the file's own first level if the map
 * record names none that the file has. Null when the file is for another map or has no levels.
 */
export function firstLevelArt(file: ArtFile, map: Pick<MapRecord, 'id' | 'levels'>): string | null {
  if (file.map !== map.id) return null;
  const wanted = map.levels[0]?.id;
  return (wanted !== undefined ? file.levels[wanted] : undefined) ?? Object.values(file.levels)[0] ?? null;
}

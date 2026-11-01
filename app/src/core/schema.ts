// Content schemas (SCOPE.md §3.2, §5.3 rule 4, §7.7). Positions are world units; the projection is applied at
// render time. Length limits here are what keep every screen inside one viewport.

import { z } from 'zod';

export const LIMITS = {
  name: 28,
  blurb: 120,
  aliases: 5,
  neighbours: 4,
  gameplaceName: 40,
} as const;

const finite = z.number();
const point = z.tuple([finite, finite]);
export const PolygonSchema = z.array(point).min(3);

const label = z.string().trim().min(1).max(LIMITS.name);
const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'lowercase letters, digits and single hyphens');

export const MapIdSchema = z.string().regex(/^de_[a-z0-9]+$/, 'like de_mirage');
export const CalloutIdSchema = z.string().regex(/^[a-z0-9_]+\.[a-z0-9_-]+$/, 'like mirage.palace');

export const ShotSchema = z.strictObject({
  /** Path under assets/shots, forward slashes. */
  file: z.string().regex(/^[a-z0-9_\-/]+\.(?:avif|webp|png)$/, 'relative path ending .avif, .webp or .png'),
  pos: z.tuple([finite, finite, finite]),
  yaw: z.number().min(-180).max(360),
  pitch: z.number().min(-90).max(90),
  stance: z.enum(['stand', 'crouch']),
  kind: z.enum(['approach', 'alternate', 'inside', 'overview']),
  captured: z.iso.date(),
  build: z.string().min(1),
});

export const CalloutSchema = z.strictObject({
  id: CalloutIdSchema,
  map: MapIdSchema,
  name: label,
  aliases: z.array(label).max(LIMITS.aliases),
  zone: slug,
  /** 1 core, 2 standard, 3 hard-mode only. */
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  level: slug,
  region: PolygonSchema,
  anchor: point,
  /** The standard callout a Hard-mode spot sits inside. Null for tiers 1 and 2. */
  parent: CalloutIdSchema.nullable(),
  gameplaceName: z.string().trim().min(1).max(LIMITS.gameplaceName).nullable(),
  blurb: z.string().trim().min(1).max(LIMITS.blurb),
  neighbours: z.array(CalloutIdSchema).max(LIMITS.neighbours),
  shots: z.array(ShotSchema),
  status: z.enum(['draft', 'verified', 'stale']),
  /** Route order inside the zone, from spawn toward the site: intro cards follow it (SCOPE §4.3, §4.11). */
  order: z.number().int().min(0).optional(),
});

export const LevelSchema = z.strictObject({
  id: slug,
  altitudeMin: finite.optional(),
  altitudeMax: finite.optional(),
});

export const ZoneSchema = z.strictObject({ id: slug, name: label });

export const MapSchema = z.strictObject({
  id: MapIdSchema,
  displayName: label,
  pool: z.enum(['active-duty', 'extra']),
  projection: z.strictObject({ posX: finite, posY: finite, scale: z.number().positive() }),
  radarSize: z.number().int().positive().default(1024),
  levels: z.array(LevelSchema).min(1),
  gameBuild: z.string().min(1),
  revision: z.number().int().min(1),
  zones: z.array(ZoneSchema).min(1),
  /** A map cannot be `verified` until every Tier 1 and 2 callout is and Dan has walked it in-game (SCOPE §7.7). */
  status: z.enum(['draft', 'verified']).default('draft'),
});

export const CalloutsFileSchema = z.array(CalloutSchema);

/** The Home map picker: every supported map, built or not. A map that is not `available` shows as "coming". */
export const MapIndexSchema = z
  .array(z.strictObject({ id: MapIdSchema, displayName: label, pool: z.enum(['active-duty', 'extra']), available: z.boolean() }))
  .refine((rows) => new Set(rows.map((r) => r.id)).size === rows.length, 'a map is listed twice');

export type Shot = z.infer<typeof ShotSchema>;
export type Callout = z.infer<typeof CalloutSchema>;
export type MapRecord = z.infer<typeof MapSchema>;
export type Tier = Callout['tier'];

/** `de_mirage` -> `mirage`: the prefix every callout id of that map carries. */
export function mapSlug(mapId: string): string {
  return mapId.replace(/^de_/, '');
}

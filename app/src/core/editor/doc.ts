// The Editor's document (SCOPE.md §8.3): the map's callouts as they are being curated, plus the two things the
// content files do not hold: which nav areas were painted into each callout, and the shots still to be captured.
// Every operation is a pure function from a document to a new one, so undo is keeping the old one.
//
// A callout may be unfinished (no region yet, no blurb). Those live in the work file only; the content file gets
// the finished ones, so `pnpm test` and the app never see a half-made callout.

import { z } from 'zod';
import { polygonCentroid, pointInPolygon, type Point } from '../geometry';
import { CalloutSchema, LIMITS, mapSlug, type Callout, type MapRecord, type Shot } from '../schema';
import { validateMapData, type Issue } from '../validate';
import { contactBetween, type NavIndex } from './nav';
import { outlineOf } from './outline';

export interface PlannedShot {
  /** Eye position, world units: the nav surface plus eye height. */
  pos: [number, number, number];
  yaw: number;
  pitch: number;
  stance: 'stand' | 'crouch';
  kind: Shot['kind'];
}

export interface EditorDoc {
  map: MapRecord;
  /** Every callout being worked on, finished or not. */
  callouts: readonly Callout[];
  /** Nav area ids painted into each callout, sorted. A callout without an entry has a hand-drawn or no region. */
  paint: Readonly<Record<string, readonly number[]>>;
  plan: Readonly<Record<string, readonly PlannedShot[]>>;
}

export type Patch = Partial<Pick<Callout, 'name' | 'aliases' | 'zone' | 'tier' | 'level' | 'parent' | 'gameplaceName' | 'blurb' | 'order' | 'status' | 'anchor'>>;

// ------------------------------------------------------------------ ids and text

export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function uniqueId(prefix: string, base: string, taken: ReadonlySet<string>): string {
  const root = base === '' ? 'new' : base;
  let id = `${prefix}${root}`;
  for (let n = 2; taken.has(id); n++) id = `${prefix}${root}-${n}`;
  return id;
}

/** A point the content schema's mutable tuple type accepts. */
const mutable = (p: Point): [number, number] => [p[0], p[1]];

const byId = (doc: EditorDoc, id: string): Callout => {
  const c = doc.callouts.find((x) => x.id === id);
  if (!c) throw new Error(`no callout ${id}`);
  return c;
};
const replace = (doc: EditorDoc, id: string, fn: (c: Callout) => Callout): EditorDoc => ({ ...doc, callouts: doc.callouts.map((c) => (c.id === id ? fn(c) : c)) });

// ------------------------------------------------------------------ callouts

export function createCallout(doc: EditorDoc, name: string, init: { zone?: string; tier?: Callout['tier']; level?: string } = {}): { doc: EditorDoc; id: string } {
  const id = uniqueId(`${mapSlug(doc.map.id)}.`, slugify(name), new Set(doc.callouts.map((c) => c.id)));
  const callout: Callout = {
    id,
    map: doc.map.id,
    name: name.trim(),
    aliases: [],
    zone: init.zone ?? doc.map.zones[0]?.id ?? '',
    tier: init.tier ?? 2,
    level: init.level ?? doc.map.levels[0]?.id ?? 'default',
    region: [],
    anchor: [0, 0],
    parent: null,
    gameplaceName: null,
    blurb: '',
    neighbours: [],
    shots: [],
    status: 'draft',
  };
  return { doc: { ...doc, callouts: [...doc.callouts, callout] }, id };
}

function cleanAliases(list: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const a = raw.trim();
    if (a !== '' && !seen.has(a.toLowerCase())) {
      seen.add(a.toLowerCase());
      out.push(a);
    }
  }
  return out;
}

export function updateCallout(doc: EditorDoc, id: string, patch: Patch): EditorDoc {
  return replace(doc, id, (c) => {
    const next: Callout = { ...c, ...patch };
    if (patch.name !== undefined) next.name = patch.name.trim();
    if (patch.aliases !== undefined) next.aliases = cleanAliases(patch.aliases);
    if (patch.gameplaceName !== undefined) next.gameplaceName = patch.gameplaceName === null || patch.gameplaceName.trim() === '' ? null : patch.gameplaceName.trim();
    if (next.tier !== 3) next.parent = null;
    if ('order' in patch && patch.order === undefined) delete next.order;
    return next;
  });
}

export function deleteCallout(doc: EditorDoc, id: string): EditorDoc {
  const { [id]: _paint, ...paint } = doc.paint;
  const { [id]: _plan, ...plan } = doc.plan;
  void _paint;
  void _plan;
  return {
    ...doc,
    callouts: doc.callouts.filter((c) => c.id !== id).map((c) => ({ ...c, neighbours: c.neighbours.filter((n) => n !== id), parent: c.parent === id ? null : c.parent })),
    paint,
    plan,
  };
}

/** Make two callouts neighbours, or stop them being so. Always both ways, since the validator wants it symmetric. */
export function setNeighbour(doc: EditorDoc, a: string, b: string, on: boolean): { doc: EditorDoc; error: string | null } {
  if (a === b) return { doc, error: 'a callout is not its own neighbour' };
  const ca = byId(doc, a);
  const cb = byId(doc, b);
  if (on) {
    for (const c of [ca, cb]) {
      if (!c.neighbours.includes(c === ca ? b : a) && c.neighbours.length >= LIMITS.neighbours) return { doc, error: `${c.name} already has ${LIMITS.neighbours} neighbours` };
    }
  }
  const apply = (c: Callout, other: string): Callout => ({ ...c, neighbours: on ? [...new Set([...c.neighbours, other])] : c.neighbours.filter((n) => n !== other) });
  return { doc: { ...doc, callouts: doc.callouts.map((c) => (c.id === a ? apply(c, b) : c.id === b ? apply(c, a) : c)) }, error: null };
}

// ------------------------------------------------------------------ painting

/** Standard callouts share the mesh among themselves; Hard spots lie inside them and share it among themselves. */
const sameClass = (a: Callout, b: Callout) => (a.tier === 3) === (b.tier === 3);

export interface PaintResult {
  doc: EditorDoc;
  /** Callouts whose areas changed, including those that had areas taken from them. */
  touched: string[];
}

export function paintAreas(doc: EditorDoc, id: string, areas: readonly number[], mode: 'add' | 'remove', options: { steal?: boolean } = {}): PaintResult {
  const target = byId(doc, id);
  const mine = new Set(doc.paint[id] ?? []);
  const touched = new Set<string>();
  const paint: Record<string, readonly number[]> = { ...doc.paint };
  if (mode === 'remove') {
    for (const a of areas) if (mine.delete(a)) touched.add(id);
  } else {
    const rivals = doc.callouts.filter((c) => c.id !== id && sameClass(c, target));
    const owner = new Map<number, string>();
    for (const r of rivals) for (const a of doc.paint[r.id] ?? []) owner.set(a, r.id);
    for (const a of areas) {
      const other = owner.get(a);
      if (other !== undefined) {
        if (!options.steal) continue;
        const left = new Set(paint[other]);
        left.delete(a);
        paint[other] = [...left].sort((p, q) => p - q);
        touched.add(other);
      }
      if (!mine.has(a)) {
        mine.add(a);
        touched.add(id);
      }
    }
  }
  paint[id] = [...mine].sort((p, q) => p - q);
  return { doc: { ...doc, paint }, touched: [...touched] };
}

export interface Regenerated {
  doc: EditorDoc;
  /** Holes and loose pieces left out of a callout's outline, by callout. */
  dropped: Record<string, number>;
}

/** Where a label can go: the middle of the painted areas if that is inside the outline, else the middle of the biggest area. */
function anchorFor(polygon: readonly Point[], areas: readonly { centroid: Point; size: number }[]): Point {
  let wx = 0;
  let wy = 0;
  let total = 0;
  for (const a of areas) {
    wx += a.centroid[0] * a.size;
    wy += a.centroid[1] * a.size;
    total += a.size;
  }
  const mean: Point = [Math.round((wx / total) * 10) / 10, Math.round((wy / total) * 10) / 10];
  if (total > 0 && pointInPolygon(mean, polygon)) return mean;
  const biggest = areas.reduce((best, a) => (a.size > best.size ? a : best));
  return [Math.round(biggest.centroid[0] * 10) / 10, Math.round(biggest.centroid[1] * 10) / 10];
}

/** Rebuild region, anchor and level from the painted areas. A callout whose paint is empty loses its region. */
export function regenerate(doc: EditorDoc, nav: NavIndex, ids: readonly string[]): Regenerated {
  const dropped: Record<string, number> = {};
  const paint: Record<string, readonly number[]> = { ...doc.paint };
  let next = doc;
  for (const id of new Set(ids)) {
    const list = paint[id];
    if (list === undefined) continue;
    const areas = list.map((a) => nav.areas[a]).filter((a): a is NonNullable<typeof a> => a !== undefined);
    const outline = outlineOf(areas);
    if (!outline.polygon) {
      delete paint[id];
      next = replace(next, id, (c) => ({ ...c, region: [] }));
      continue;
    }
    const polygon = outline.polygon;
    dropped[id] = outline.dropped;
    // the level most of the painted surface is on
    const bySize = new Map<string, number>();
    for (const a of areas) bySize.set(a.level, (bySize.get(a.level) ?? 0) + a.size);
    const level = [...bySize.entries()].sort((p, q) => q[1] - p[1])[0]?.[0];
    next = replace(next, id, (c) => ({
      ...c,
      region: polygon.map(mutable),
      level: level ?? c.level,
      anchor: c.region.length > 0 && pointInPolygon(c.anchor, polygon) ? c.anchor : mutable(anchorFor(polygon, areas)),
    }));
  }
  return { doc: { ...next, paint }, dropped };
}

/** Draw a region by hand. It replaces any painted one, since the two cannot both be the outline. */
export function setPolygon(doc: EditorDoc, id: string, polygon: readonly Point[]): EditorDoc {
  const { [id]: _removed, ...paint } = doc.paint;
  void _removed;
  const region = polygon.map(([x, y]): [number, number] => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
  const middle = region.length >= 3 ? polygonCentroid(region) : null;
  return replace({ ...doc, paint }, id, (c) => ({
    ...c,
    region,
    anchor: middle && !pointInPolygon(c.anchor, region) ? [Math.round(middle[0] * 10) / 10, Math.round(middle[1] * 10) / 10] : c.anchor,
  }));
}

export function moveAnchor(doc: EditorDoc, id: string, to: Point): EditorDoc {
  return replace(doc, id, (c) => ({ ...c, anchor: [Math.round(to[0] * 10) / 10, Math.round(to[1] * 10) / 10] }));
}

/** Callouts that touch this one on the mesh, strongest contact first, with the length of shared edge. */
export function neighbourSuggestions(doc: EditorDoc, id: string, nav: NavIndex): { id: string; contact: number }[] {
  const me = byId(doc, id);
  const mine = doc.paint[id];
  if (!mine || mine.length === 0) return [];
  const out: { id: string; contact: number }[] = [];
  for (const other of doc.callouts) {
    if (other.id === id || other.tier === 3 || me.tier === 3 || other.level !== me.level) continue;
    const theirs = doc.paint[other.id];
    if (!theirs || theirs.length === 0) continue;
    const contact = contactBetween(nav, mine, new Set(theirs));
    if (contact > 0) out.push({ id: other.id, contact: Math.round(contact) });
  }
  return out.sort((a, b) => b.contact - a.contact || (a.id < b.id ? -1 : 1));
}

// ------------------------------------------------------------------ zones, plan

export function addZone(doc: EditorDoc, name: string): { doc: EditorDoc; id: string } {
  const id = uniqueId('', slugify(name), new Set(doc.map.zones.map((z) => z.id)));
  return { doc: { ...doc, map: { ...doc.map, zones: [...doc.map.zones, { id, name: name.trim() }] } }, id };
}

export function renameZone(doc: EditorDoc, id: string, name: string): EditorDoc {
  return { ...doc, map: { ...doc.map, zones: doc.map.zones.map((z) => (z.id === id ? { ...z, name: name.trim() } : z)) } };
}

export function removeZone(doc: EditorDoc, id: string): { doc: EditorDoc; error: string | null } {
  if (doc.callouts.some((c) => c.zone === id)) return { doc, error: 'callouts are still in this zone; move them first' };
  if (doc.map.zones.length <= 1) return { doc, error: 'a map needs at least one zone' };
  return { doc: { ...doc, map: { ...doc.map, zones: doc.map.zones.filter((z) => z.id !== id) } }, error: null };
}

/** Zones are in route order (SCOPE §4.3): move one earlier (-1) or later (+1). */
export function moveZone(doc: EditorDoc, id: string, by: -1 | 1): EditorDoc {
  const zones = doc.map.zones.slice();
  const i = zones.findIndex((z) => z.id === id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= zones.length) return doc;
  [zones[i], zones[j]] = [zones[j] as (typeof zones)[number], zones[i] as (typeof zones)[number]];
  return { ...doc, map: { ...doc.map, zones } };
}

export function setPlan(doc: EditorDoc, id: string, shots: readonly PlannedShot[]): EditorDoc {
  const plan = { ...doc.plan };
  if (shots.length === 0) delete plan[id];
  else plan[id] = shots;
  return { ...doc, plan };
}

// ------------------------------------------------------------------ export and checks

const KEY_ORDER = ['id', 'map', 'name', 'aliases', 'zone', 'tier', 'level', 'region', 'anchor', 'parent', 'gameplaceName', 'blurb', 'neighbours', 'shots', 'status', 'order'] as const;

/** The keys in the order the schema lists them, so a rewritten file diffs cleanly. */
function canonical(c: Callout): Callout {
  const out: Record<string, unknown> = {};
  for (const k of KEY_ORDER) if (k in c && (c as Record<string, unknown>)[k] !== undefined) out[k] = (c as Record<string, unknown>)[k];
  return out as unknown as Callout;
}

export interface Exported {
  map: MapRecord;
  callouts: Callout[];
  /** Callouts left out of the content file, with why. */
  unfinished: { id: string; reasons: string[] }[];
}

function reasonsFor(c: Callout): string[] {
  const parsed = CalloutSchema.safeParse(c);
  if (parsed.success) return [];
  return parsed.error.issues.map((i) => {
    const where = i.path.join('.');
    if (where === 'region') return 'no region yet: paint or draw one';
    if (where === 'blurb') return 'no blurb yet';
    return `${where || 'callout'}: ${i.message}`;
  });
}

/** The finished callouts, in a stable order, with links to unfinished ones removed. */
export function exportDoc(doc: EditorDoc): Exported {
  const unfinished: Exported['unfinished'] = [];
  let finished: Callout[] = [];
  for (const c of doc.callouts) {
    const why = reasonsFor(c);
    if (why.length === 0) finished.push(c);
    else unfinished.push({ id: c.id, reasons: why });
  }
  // a Hard spot is only shipped with the callout it sits in
  for (let changed = true; changed; ) {
    changed = false;
    const ids = new Set(finished.map((c) => c.id));
    const keep = finished.filter((c) => {
      if (c.tier === 3 && (c.parent === null || !ids.has(c.parent))) {
        unfinished.push({ id: c.id, reasons: ['its parent callout is not finished'] });
        changed = true;
        return false;
      }
      return true;
    });
    finished = keep;
  }
  const ids = new Set(finished.map((c) => c.id));
  const zoneIndex = (z: string) => {
    const i = doc.map.zones.findIndex((x) => x.id === z);
    return i < 0 ? doc.map.zones.length : i;
  };
  const callouts = finished
    .map((c) => canonical({ ...c, neighbours: c.neighbours.filter((n) => ids.has(n)) }))
    .sort((a, b) => zoneIndex(a.zone) - zoneIndex(b.zone) || a.tier - b.tier || (a.order ?? 9999) - (b.order ?? 9999) || (a.id < b.id ? -1 : 1));
  return { map: doc.map, callouts, unfinished };
}

/** What `pnpm content:validate` would say about the file the editor would write, plus what is not in it. */
export function checkDoc(doc: EditorDoc): Issue[] {
  const out = exportDoc(doc);
  const issues = validateMapData(out.map, out.callouts);
  for (const u of out.unfinished) issues.push({ severity: 'warning', rule: 'unfinished', callout: u.id, message: `not in the content file yet: ${u.reasons.join('; ')}` });
  return issues;
}

// ------------------------------------------------------------------ the work file

const point = z.tuple([z.number(), z.number()]);
export const PlannedShotSchema = z.strictObject({
  pos: z.tuple([z.number(), z.number(), z.number()]),
  yaw: z.number(),
  pitch: z.number(),
  stance: z.enum(['stand', 'crouch']),
  kind: z.enum(['approach', 'alternate', 'inside', 'overview']),
});

/** A callout as the work file keeps it: the real schema, except that region and blurb may still be empty. */
export const DraftCalloutSchema = CalloutSchema.extend({ region: z.array(point), blurb: z.string().trim().max(LIMITS.blurb) });

export const WorkFileSchema = z.strictObject({
  version: z.literal(1),
  /** The game build the nav area ids belong to. Ids mean nothing against another build's mesh. */
  gameBuild: z.string().min(1),
  callouts: z.array(DraftCalloutSchema),
  paint: z.record(z.string(), z.array(z.number().int().nonnegative())),
  plan: z.record(z.string(), z.array(PlannedShotSchema)),
});
export type WorkFile = z.infer<typeof WorkFileSchema>;

export function toWork(doc: EditorDoc): WorkFile {
  return {
    version: 1,
    gameBuild: doc.map.gameBuild,
    callouts: doc.callouts.map(canonical),
    paint: Object.fromEntries(Object.entries(doc.paint).map(([k, v]) => [k, [...v]])),
    plan: Object.fromEntries(Object.entries(doc.plan).map(([k, v]) => [k, v.map((s) => ({ ...s }))])),
  };
}

export interface Loaded {
  doc: EditorDoc;
  notices: string[];
}

/**
 * Open a map for editing. The content file is the truth for the callouts it holds; the work file adds the paint, the
 * shot plan and the unfinished callouts. If the content file was changed by hand since the editor wrote it, its
 * callouts win and a notice says so.
 */
export function loadDoc(map: MapRecord, content: readonly Callout[], work: WorkFile | null): Loaded {
  const notices: string[] = [];
  if (!work) return { doc: { map, callouts: content, paint: {}, plan: {} }, notices };

  const exported = (callouts: readonly Callout[]) => JSON.stringify(exportDoc({ map, callouts, paint: {}, plan: {} }).callouts);
  const same = exported(work.callouts as Callout[]) === exported(content);
  let callouts: Callout[];
  if (same) callouts = work.callouts as Callout[];
  else {
    notices.push('The content file was changed outside the editor since it was last saved here. Its callouts are used; unfinished ones from the work file are kept.');
    const onDisk = new Set(content.map((c) => c.id));
    const extra = (work.callouts as Callout[]).filter((c) => !onDisk.has(c.id) && reasonsFor(c).length > 0);
    callouts = [...content, ...extra];
  }
  const ids = new Set(callouts.map((c) => c.id));
  if (work.gameBuild !== map.gameBuild) notices.push(`The painted areas were made against game build ${work.gameBuild}, but the map is now ${map.gameBuild}. Check the painted regions against the new mesh.`);
  return {
    doc: {
      map,
      callouts,
      paint: Object.fromEntries(Object.entries(work.paint).filter(([k]) => ids.has(k))),
      plan: Object.fromEntries(Object.entries(work.plan).filter(([k]) => ids.has(k))),
    },
    notices,
  };
}

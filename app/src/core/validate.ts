// Content validation (SCOPE.md §7.7): the zod schemas plus the checks a schema cannot express.
// Errors block a build; warnings are for Dan to read.

import { isSimplePolygon, pointInPolygon, polygonArea, polygonWithin } from './geometry';
import { compact } from './match';
import { levelFor, inRadarBounds, worldToPixel } from './projection';
import { CalloutsFileSchema, MapSchema, mapSlug, type Callout, type MapRecord } from './schema';

export interface Issue {
  severity: 'error' | 'warning';
  rule: string;
  callout?: string;
  message: string;
}

const MIN_SHOTS = { standard: 3, hard: 2 } as const;
/** World units squared. A region smaller than this is almost certainly a drawing slip. */
const MIN_AREA = 400;

function error(rule: string, message: string, callout?: string): Issue {
  return callout === undefined ? { severity: 'error', rule, message } : { severity: 'error', rule, callout, message };
}
function warn(rule: string, message: string, callout?: string): Issue {
  return callout === undefined ? { severity: 'warning', rule, message } : { severity: 'warning', rule, callout, message };
}

export interface Parsed {
  map: MapRecord | null;
  callouts: Callout[] | null;
  issues: Issue[];
}

/** Parse raw JSON. Schema failures come back as issues; the cross-record checks run only if both parse. */
export function parseMapData(mapJson: unknown, calloutsJson: unknown): Parsed {
  const issues: Issue[] = [];
  const m = MapSchema.safeParse(mapJson);
  if (!m.success) {
    for (const i of m.error.issues) issues.push(error('map-schema', `${i.path.join('.') || '(map)'}: ${i.message}`));
  }
  const c = CalloutsFileSchema.safeParse(calloutsJson);
  if (!c.success) {
    for (const i of c.error.issues) {
      const where = i.path.length ? i.path.join('.') : '(callouts)';
      const idx = typeof i.path[0] === 'number' ? i.path[0] : -1;
      const id = idx >= 0 && Array.isArray(calloutsJson) ? (calloutsJson[idx] as { id?: unknown } | undefined)?.id : undefined;
      issues.push(error('callout-schema', `${where}: ${i.message}`, typeof id === 'string' ? id : undefined));
    }
  }
  if (m.success && c.success) issues.push(...validateMapData(m.data, c.data));
  return { map: m.success ? m.data : null, callouts: c.success ? c.data : null, issues: sortIssues(issues) };
}

export function sortIssues(issues: readonly Issue[]): Issue[] {
  return issues.slice().sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
}

export function validateMapData(map: MapRecord, callouts: readonly Callout[]): Issue[] {
  const issues: Issue[] = [];
  const slug = mapSlug(map.id);
  const byId = new Map<string, Callout>();
  const zoneIds = new Set(map.zones.map((z) => z.id));
  const levelIds = new Set(map.levels.map((l) => l.id));

  if (zoneIds.size !== map.zones.length) issues.push(error('zone-duplicate', 'two zones share an id'));
  if (levelIds.size !== map.levels.length) issues.push(error('level-duplicate', 'two levels share an id'));

  for (const c of callouts) {
    if (byId.has(c.id)) issues.push(error('id-duplicate', `id used twice`, c.id));
    byId.set(c.id, c);
  }

  // Names and aliases are the typed answers; one text must never mean two callouts.
  const owners = new Map<string, Set<string>>();
  for (const c of callouts) {
    const seenOwn = new Set<string>();
    for (const [text, isAlias] of [[c.name, false], ...c.aliases.map((a) => [a, true] as const)] as const) {
      const key = compact(text);
      if (key === '') {
        issues.push(error('name-empty', `"${text}" has no letters or digits`, c.id));
        continue;
      }
      if (seenOwn.has(key)) issues.push(warn('alias-duplicate', `"${text}" repeats ${isAlias ? 'the name or another alias' : 'an alias'}`, c.id));
      seenOwn.add(key);
      const set = owners.get(key) ?? new Set<string>();
      set.add(c.id);
      owners.set(key, set);
    }
  }
  for (const [key, ids] of owners) {
    if (ids.size > 1) issues.push(error('name-collision', `"${key}" is a name or alias of ${[...ids].join(' and ')}`));
  }

  for (const c of callouts) {
    if (c.map !== map.id) issues.push(error('map-mismatch', `belongs to ${c.map}, not ${map.id}`, c.id));
    if (!c.id.startsWith(`${slug}.`)) issues.push(error('id-prefix', `id should start with "${slug}."`, c.id));
    if (!zoneIds.has(c.zone)) issues.push(error('zone-unknown', `zone "${c.zone}" is not in the map`, c.id));
    if (!levelIds.has(c.level)) issues.push(error('level-unknown', `level "${c.level}" is not in the map`, c.id));

    checkRegion(c, map, issues);
    checkNeighbours(c, byId, issues);
    checkParent(c, byId, issues);
    checkShots(c, map, issues);
    if (c.status === 'stale') issues.push(warn('stale', 'marked stale: re-check after the map update', c.id));
  }

  const used = new Set(callouts.map((c) => c.zone));
  for (const z of map.zones) if (!used.has(z.id)) issues.push(warn('zone-empty', `zone "${z.id}" has no callouts`));

  if (map.status === 'verified') {
    for (const c of callouts) {
      if (c.tier !== 3 && c.status !== 'verified') issues.push(error('map-verified', 'map is verified but this Tier 1/2 callout is not', c.id));
    }
  }
  if (callouts.length >= 20) {
    const core = callouts.filter((c) => c.tier === 1).length;
    if (core < 6 || core > 18) issues.push(warn('core-size', `${core} Core callouts; the plan is roughly 10-15`));
  }
  return sortIssues(issues);
}

function checkRegion(c: Callout, map: MapRecord, issues: Issue[]): void {
  if (!isSimplePolygon(c.region)) {
    issues.push(error('region-invalid', 'region edges cross or fold back', c.id));
    return;
  }
  const area = polygonArea(c.region);
  if (area < MIN_AREA) issues.push(error('region-tiny', `region area ${Math.round(area)} is below ${MIN_AREA} square world units`, c.id));
  const size = map.radarSize;
  const outside = c.region.filter(([x, y]) => {
    const [px, py] = worldToPixel(map.projection, x, y);
    return !inRadarBounds(px, py, size);
  });
  if (outside.length) issues.push(error('region-bounds', `${outside.length} region point(s) fall outside the radar`, c.id));
  if (!pointInPolygon(c.anchor, c.region)) issues.push(error('anchor-outside', 'anchor is not inside the region', c.id));
}

function checkNeighbours(c: Callout, byId: ReadonlyMap<string, Callout>, issues: Issue[]): void {
  if (new Set(c.neighbours).size !== c.neighbours.length) issues.push(error('neighbour-duplicate', 'a neighbour is listed twice', c.id));
  for (const n of c.neighbours) {
    if (n === c.id) {
      issues.push(error('neighbour-self', 'lists itself as a neighbour', c.id));
      continue;
    }
    const other = byId.get(n);
    if (!other) {
      issues.push(error('neighbour-unknown', `neighbour ${n} does not exist`, c.id));
      continue;
    }
    if (!other.neighbours.includes(c.id)) issues.push(warn('neighbour-one-way', `${n} does not list this callout back`, c.id));
  }
}

function checkParent(c: Callout, byId: ReadonlyMap<string, Callout>, issues: Issue[]): void {
  if (c.tier !== 3) {
    if (c.parent !== null) issues.push(error('parent-not-hard', 'only Tier 3 spots have a parent', c.id));
    return;
  }
  if (c.parent === null) {
    issues.push(error('parent-missing', 'a Hard-mode spot needs a parent callout', c.id));
    return;
  }
  const parent = byId.get(c.parent);
  if (!parent) {
    issues.push(error('parent-unknown', `parent ${c.parent} does not exist`, c.id));
    return;
  }
  if (parent.tier === 3) issues.push(error('parent-tier', 'a spot cannot sit inside another Tier 3 spot', c.id));
  if (parent.level !== c.level) issues.push(error('parent-level', 'spot and parent are on different levels', c.id));
  if (isSimplePolygon(c.region) && isSimplePolygon(parent.region) && !polygonWithin(c.region, parent.region)) {
    issues.push(error('parent-contain', `region is not inside ${c.parent}'s region`, c.id));
  }
}

function checkShots(c: Callout, map: MapRecord, issues: Issue[]): void {
  const need = c.tier === 3 ? MIN_SHOTS.hard : MIN_SHOTS.standard;
  if (c.shots.length < need) {
    const make = c.status === 'verified' ? error : warn;
    issues.push(make('shots-min', `${c.shots.length} shot(s); Tier ${c.tier} needs at least ${need}`, c.id));
  }
  if (c.shots.length > 0 && !c.shots.some((s) => s.kind === 'approach')) {
    issues.push(warn('shots-no-approach', 'no approach shot', c.id));
  }
  const files = new Set<string>();
  for (const s of c.shots) {
    if (files.has(s.file)) issues.push(error('shot-duplicate', `${s.file} is listed twice`, c.id));
    files.add(s.file);
    const [px, py] = worldToPixel(map.projection, s.pos[0], s.pos[1]);
    if (!inRadarBounds(px, py, map.radarSize)) issues.push(error('shot-bounds', `${s.file} was taken outside the radar`, c.id));
    if (levelFor(s.pos[2], map.levels) !== c.level) issues.push(warn('shot-level', `${s.file} was taken on another level`, c.id));
  }
}

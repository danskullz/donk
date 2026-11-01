// Planning screenshots (SCOPE.md §3.5, §8.1 step 5): propose camera positions for a callout from the geometry
// around it, preview which regions a camera sees, and write the plan out for the capture driver.
//
// The proposals are a starting point, not a promise: they know where a player can stand (the nav mesh) but not
// what blocks the view. Dan adjusts them in the Editor and in the game, and the capture records the final pose.

import { pointInPolygon, polygonBounds, type Point } from '../geometry';
import { CS2_HFOV_16_9_DEG } from '../projection';
import type { Callout } from '../schema';
import type { EditorDoc, PlannedShot } from './doc';
import { areaAt, floodFill, type NavIndex } from './nav';

/** Eye height above the nav surface: Valve's retake positions sit this far above it (SCOPE §8.2). */
export const EYE = 60;

const round1 = (n: number) => Math.round(n * 10) / 10;
const degrees = (rad: number) => (rad * 180) / Math.PI;

/** Yaw (degrees, 0 faces +x, counter-clockwise) from one point toward another. */
export function yawTo(from: Point, to: Point): number {
  const y = degrees(Math.atan2(to[1] - from[1], to[0] - from[0]));
  return round1(y > 180 ? y - 360 : y <= -180 ? y + 360 : y);
}

/** How far a ray from `from` along `yaw` runs inside the polygon before it leaves. */
function rayInside(from: Point, yawDeg: number, polygon: readonly Point[]): number {
  const dx = Math.cos((yawDeg * Math.PI) / 180);
  const dy = Math.sin((yawDeg * Math.PI) / 180);
  let best = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i] as Point;
    const b = polygon[(i + 1) % polygon.length] as Point;
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const det = dx * ey - dy * ex;
    if (Math.abs(det) < 1e-9) continue;
    const t = ((a[0] - from[0]) * ey - (a[1] - from[1]) * ex) / det;
    const u = ((a[0] - from[0]) * dy - (a[1] - from[1]) * dx) / det;
    if (t > 1e-6 && u >= 0 && u <= 1) best = Math.min(best, t);
  }
  return best === Infinity ? 0 : best;
}

/** The direction along a region's long axis in which it runs on for longer, as seen from `from`. */
function alongYaw(polygon: readonly Point[], from: Point): number {
  const n = polygon.length;
  const mx = polygon.reduce((s, p) => s + p[0], 0) / n;
  const my = polygon.reduce((s, p) => s + p[1], 0) / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const [x, y] of polygon) {
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
    sxy += (x - mx) * (y - my);
  }
  const axis = degrees(0.5 * Math.atan2(2 * sxy, sxx - syy));
  const other = axis > 0 ? axis - 180 : axis + 180;
  return round1(rayInside(from, axis, polygon) >= rayInside(from, other, polygon) ? axis : other);
}

export interface PlanContext {
  callouts: readonly Callout[];
  nav: NavIndex;
}

interface Vantage {
  at: Point;
  z: number;
  dist: number;
  /** Direction from the callout's anchor out to this vantage, degrees. */
  from: number;
}

const separation = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

function vantagePoints(c: Callout, doc: Pick<EditorDoc, 'paint'>, ctx: PlanContext, min: number, max: number): Vantage[] {
  const seed = (doc.paint[c.id]?.[0] as number | undefined) ?? areaAt(ctx.nav, c.anchor[0], c.anchor[1], c.level);
  if (seed === null || seed === undefined) return [];
  // somewhere a player can walk to from the callout, not an unreachable ledge across a gap
  const reachable = floodFill(ctx.nav, seed, { radius: max + 150, level: c.level });
  const out: Vantage[] = [];
  for (const id of reachable) {
    const a = ctx.nav.areas[id];
    if (!a) continue;
    const dist = Math.hypot(a.centroid[0] - c.anchor[0], a.centroid[1] - c.anchor[1]);
    if (dist < min || dist > max) continue;
    if (c.region.length >= 3 && pointInPolygon(a.centroid, c.region)) continue;
    out.push({ at: a.centroid, z: a.z, dist, from: degrees(Math.atan2(a.centroid[1] - c.anchor[1], a.centroid[0] - c.anchor[0])) });
  }
  return out;
}

const pickNear = (list: readonly Vantage[], target: number) => list.slice().sort((a, b) => Math.abs(a.dist - target) - Math.abs(b.dist - target) || a.from - b.from)[0];
const pickApart = (list: readonly Vantage[], from: readonly number[], target: number) =>
  list
    .slice()
    .sort((a, b) => Math.min(...from.map((f) => separation(b.from, f))) - Math.min(...from.map((f) => separation(a.from, f))) || Math.abs(a.dist - target) - Math.abs(b.dist - target))[0];

const shotFrom = (v: Vantage, c: Callout, kind: PlannedShot['kind'], pitch = 0): PlannedShot => ({
  pos: [round1(v.at[0]), round1(v.at[1]), round1(v.z + EYE)],
  yaw: yawTo(v.at, c.anchor),
  pitch,
  stance: 'stand',
  kind,
});

/** Big areas (sites) get a wider overview as well. */
const OVERVIEW_AREA = 60_000;

/**
 * Camera positions for a callout. Standard callouts get "inside" (standing in it, looking along its long axis), an
 * approach and an alternate approach from opposite-ish directions, and an overview if it is large. Hard spots get a
 * close-up and a wider shot (SCOPE §3.5).
 */
export function proposeShots(c: Callout, doc: Pick<EditorDoc, 'paint'>, ctx: PlanContext): PlannedShot[] {
  if (c.region.length < 3) return [];
  const shots: PlannedShot[] = [];
  const bounds = polygonBounds(c.region);
  const size = (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY);

  if (c.tier === 3) {
    const close = pickNear(vantagePoints(c, doc, ctx, 100, 350), 200);
    const wide = pickApart(vantagePoints(c, doc, ctx, 400, 900), close ? [close.from] : [], 600);
    if (close) shots.push(shotFrom(close, c, 'approach'));
    if (wide) shots.push(shotFrom(wide, c, 'overview'));
    return shots;
  }

  const area = areaAt(ctx.nav, c.anchor[0], c.anchor[1], c.level);
  if (area !== null) {
    const a = ctx.nav.areas[area];
    if (a) shots.push({ pos: [round1(c.anchor[0]), round1(c.anchor[1]), round1(a.z + EYE)], yaw: alongYaw(c.region, c.anchor), pitch: 0, stance: 'stand', kind: 'inside' });
  }
  const near = vantagePoints(c, doc, ctx, 250, 800);
  const first = pickNear(near, 500);
  if (first) {
    shots.push(shotFrom(first, c, 'approach'));
    const second = pickApart(
      near.filter((v) => v !== first),
      [first.from],
      500,
    );
    if (second) shots.push(shotFrom(second, c, 'alternate'));
  }
  if (size >= OVERVIEW_AREA) {
    const far = pickApart(vantagePoints(c, doc, ctx, 800, 1400), shots.filter((s) => s.kind !== 'inside').map((s) => yawTo(c.anchor, [s.pos[0], s.pos[1]])), 1000);
    if (far) shots.push(shotFrom(far, c, 'overview', -8));
  }
  return shots;
}

// ------------------------------------------------------------------ what a camera sees

function onSegment(p: Point, a: Point, b: Point): boolean {
  return Math.abs((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) < 1e-9 && p[0] >= Math.min(a[0], b[0]) - 1e-9 && p[0] <= Math.max(a[0], b[0]) + 1e-9 && p[1] >= Math.min(a[1], b[1]) - 1e-9 && p[1] <= Math.max(a[1], b[1]) + 1e-9;
}
function cross(o: Point, a: Point, b: Point): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}
function segmentsMeet(a: Point, b: Point, c: Point, d: Point): boolean {
  const d1 = cross(a, b, c);
  const d2 = cross(a, b, d);
  const d3 = cross(c, d, a);
  const d4 = cross(c, d, b);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return onSegment(c, a, b) || onSegment(d, a, b) || onSegment(a, c, d) || onSegment(b, c, d);
}

export function coneTriangle(from: Point, yaw: number, range: number, hfov = CS2_HFOV_16_9_DEG): [Point, Point, Point] {
  const ray = (deg: number): Point => [from[0] + Math.cos((deg * Math.PI) / 180) * range, from[1] + Math.sin((deg * Math.PI) / 180) * range];
  return [from, ray(yaw - hfov / 2), ray(yaw + hfov / 2)];
}

/** The regions a camera at `from` facing `yaw` can reach with its view, out to `range`, ignoring walls. */
export function regionsInCone(from: Point, yaw: number, regions: readonly { id: string; polygon: readonly Point[] }[], range = 1800): string[] {
  const tri = coneTriangle(from, yaw, range);
  const edges: [Point, Point][] = [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]];
  return regions
    .filter(({ polygon }) => {
      if (polygon.length < 3) return false;
      if (polygon.some((p) => pointInPolygon(p, tri))) return true;
      if (tri.some((p) => pointInPolygon(p, polygon))) return true;
      return polygon.some((p, i) => edges.some(([a, b]) => segmentsMeet(p, polygon[(i + 1) % polygon.length] as Point, a, b)));
    })
    .map((r) => r.id);
}

// ------------------------------------------------------------------ capture manifest

export interface CaptureManifest {
  map: string;
  shots: {
    n: number;
    id: string;
    kind: PlannedShot['kind'];
    stance: PlannedShot['stance'];
    pose: { x: number; y: number; z: number; pitch: number; yaw: number; title: string };
    note: string;
  }[];
}

/**
 * The planned shots in the shape the capture driver reads (`content-tools/spike/capture_run.py`): `pose` is the eye
 * position and the driver sets the player origin 64 units lower. The `retake` note makes it name each file after the
 * pose title, so the title carries the callout id and kind.
 */
export function captureManifest(doc: Pick<EditorDoc, 'map' | 'callouts' | 'plan'>): CaptureManifest {
  const shots: CaptureManifest['shots'] = [];
  let n = 1;
  for (const c of doc.callouts) {
    (doc.plan[c.id] ?? []).forEach((s, i) => {
      shots.push({ n: n++, id: c.id, kind: s.kind, stance: s.stance, pose: { x: s.pos[0], y: s.pos[1], z: s.pos[2], pitch: s.pitch, yaw: s.yaw, title: `${c.id}-${s.kind}-${i + 1}` }, note: 'retake planned' });
    });
  }
  return { map: doc.map.id, shots };
}

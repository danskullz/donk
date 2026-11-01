// Polygon helpers for callout regions, in world units (SCOPE §3.2, §4.12, §7.7).

export type Point = readonly [number, number];
export type Polygon = readonly Point[];

const EPS = 1e-9;

export function distance(a: Point, b: Point): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** Unsigned shoelace area. */
export function polygonArea(poly: Polygon): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i] as Point;
    const [x2, y2] = poly[(i + 1) % poly.length] as Point;
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

/** Area-weighted centroid; falls back to the vertex mean for a degenerate polygon. */
export function polygonCentroid(poly: Polygon): Point {
  let a2 = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i] as Point;
    const [x2, y2] = poly[(i + 1) % poly.length] as Point;
    const cross = x1 * y2 - x2 * y1;
    a2 += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  if (Math.abs(a2) < EPS) {
    const n = poly.length || 1;
    return [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (3 * a2), cy / (3 * a2)];
}

export function polygonBounds(poly: Polygon): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of poly) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

function onSegment(p: Point, a: Point, b: Point): boolean {
  const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  if (Math.abs(cross) / len > 1e-7) return false;
  return (
    p[0] >= Math.min(a[0], b[0]) - 1e-7 &&
    p[0] <= Math.max(a[0], b[0]) + 1e-7 &&
    p[1] >= Math.min(a[1], b[1]) - 1e-7 &&
    p[1] <= Math.max(a[1], b[1]) + 1e-7
  );
}

/** Even-odd ray casting. A point on the boundary counts as inside, so a click on a shared edge is not lost. */
export function pointInPolygon(p: Point, poly: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i] as Point;
    const b = poly[j] as Point;
    if (onSegment(p, a, b)) return true;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) {
      inside = !inside;
    }
  }
  return inside;
}

function orient(a: Point, b: Point, c: Point): number {
  const v = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  return Math.abs(v) < EPS ? 0 : v > 0 ? 1 : -1;
}

/** True when segments ab and cd cross or touch anywhere other than a shared endpoint. */
function segmentsConflict(a: Point, b: Point, c: Point, d: Point): boolean {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(c, a, b)) return true;
  if (o2 === 0 && onSegment(d, a, b)) return true;
  if (o3 === 0 && onSegment(a, c, d)) return true;
  if (o4 === 0 && onSegment(b, c, d)) return true;
  return false;
}

/** Two edges leave `shared` along the same line and in the same direction, so they overlap. */
function foldsBack(shared: Point, p: Point, q: Point): boolean {
  if (orient(p, shared, q) !== 0) return false;
  return (p[0] - shared[0]) * (q[0] - shared[0]) + (p[1] - shared[1]) * (q[1] - shared[1]) > 0;
}

/** A polygon is simple when no two edges cross and no edge passes through a non-adjacent vertex. O(n^2). */
export function isSimplePolygon(poly: Polygon): boolean {
  const n = poly.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    const a = poly[i] as Point;
    const b = poly[(i + 1) % n] as Point;
    for (let j = i + 1; j < n; j++) {
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      const c = poly[j] as Point;
      const d = poly[(j + 1) % n] as Point;
      if (adjacent) {
        // Neighbouring edges share one endpoint; they conflict only if they fold back over each other.
        if (j === i + 1 ? foldsBack(b, a, d) : foldsBack(a, b, c)) return false;
        continue;
      }
      if (segmentsConflict(a, b, c, d)) return false;
    }
  }
  return true;
}

/** Every vertex of `inner` lies inside or on `outer`. Enough for the nested-spot check on simple regions. */
export function polygonWithin(inner: Polygon, outer: Polygon): boolean {
  return inner.every((p) => pointInPolygon(p, outer));
}

export interface RegionLike {
  id: string;
  polygon: Polygon;
}

/**
 * Nested hit test (SCOPE §4.12): of the regions containing the point, the smallest wins, so a Hard spot
 * inside a standard callout is reachable while the rest of the callout still answers to the parent.
 */
export function smallestRegionAt<T extends RegionLike>(p: Point, regions: readonly T[]): T | null {
  let best: T | null = null;
  let bestArea = Infinity;
  for (const region of regions) {
    if (!pointInPolygon(p, region.polygon)) continue;
    const area = polygonArea(region.polygon);
    if (area < bestArea) {
      best = region;
      bestArea = area;
    }
  }
  return best;
}

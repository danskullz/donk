// The outline of a painted set of nav areas (SCOPE.md §8.3): the union of their triangles and quads as one simple
// polygon, which is what a callout's `region` is (§3.2).
//
// Areas meet at T-junctions, so a plain "edge used once is boundary" rule leaves seams. Before cancelling shared
// edges, every edge is split at any corner of another painted area that lies on it. Then the edges that remain
// form closed loops: the largest outer loop is the region; holes and separate pieces are reported, not kept.

import { isSimplePolygon, polygonArea, type Point } from '../geometry';
import type { NavArea } from './nav';

const SNAP = 100; // corners closer than 0.01 units are the same corner
const ON_EDGE = 0.5; // a corner this close to an edge lies on it
const key = (p: Point) => `${Math.round(p[0] * SNAP)},${Math.round(p[1] * SNAP)}`;
const CELL = 64;

export interface Outline {
  /** The region, counter-clockwise, or null when nothing is painted. */
  polygon: Point[] | null;
  /** Boundary loops that were left out: holes in the region and pieces that are not connected to it. */
  dropped: number;
}

interface Directed {
  from: string;
  to: string;
}

function split(p: Point, q: Point, points: ReadonlyMap<string, Point>, grid: ReadonlyMap<string, string[]>): string[] {
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  const len = Math.hypot(dx, dy);
  const out: { k: string; t: number }[] = [];
  const seen = new Set<string>();
  const ux = dx / len;
  const uy = dy / len;
  for (let cx = Math.floor((Math.min(p[0], q[0]) - ON_EDGE) / CELL); cx <= Math.floor((Math.max(p[0], q[0]) + ON_EDGE) / CELL); cx++) {
    for (let cy = Math.floor((Math.min(p[1], q[1]) - ON_EDGE) / CELL); cy <= Math.floor((Math.max(p[1], q[1]) + ON_EDGE) / CELL); cy++) {
      for (const k of grid.get(`${cx},${cy}`) ?? []) {
        if (seen.has(k)) continue;
        seen.add(k);
        const v = points.get(k) as Point;
        const t = (v[0] - p[0]) * ux + (v[1] - p[1]) * uy;
        if (t <= ON_EDGE || t >= len - ON_EDGE) continue;
        if (Math.abs((v[0] - p[0]) * uy - (v[1] - p[1]) * ux) > ON_EDGE) continue;
        out.push({ k, t });
      }
    }
  }
  out.sort((a, b) => a.t - b.t);
  return [key(p), ...out.map((o) => o.k), key(q)];
}

/** Distance from `p` to the segment `a`-`b`. */
function toSegment(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Drop corners that sit on the line between their neighbours. */
function dropStraight(ring: Point[], tolerance: number): Point[] {
  let pts = ring.slice();
  for (let changed = true; changed && pts.length > 3; ) {
    changed = false;
    for (let i = 0; i < pts.length && pts.length > 3; i++) {
      const prev = pts[(i + pts.length - 1) % pts.length] as Point;
      const next = pts[(i + 1) % pts.length] as Point;
      const here = pts[i] as Point;
      const between = (here[0] - prev[0]) * (next[0] - prev[0]) + (here[1] - prev[1]) * (next[1] - prev[1]) > 0 && (here[0] - next[0]) * (prev[0] - next[0]) + (here[1] - next[1]) * (prev[1] - next[1]) > 0;
      if (between && toSegment(here, prev, next) <= tolerance) {
        pts.splice(i, 1);
        changed = true;
        i -= 1;
      }
    }
  }
  return pts;
}

/** Douglas-Peucker on a closed ring, split at the two corners farthest apart. */
function simplifyRing(ring: Point[], epsilon: number): Point[] {
  if (ring.length <= 4 || epsilon <= 0) return ring;
  const n = ring.length;
  let a = 0;
  let b = 0;
  let far = -1;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = Math.hypot((ring[i] as Point)[0] - (ring[j] as Point)[0], (ring[i] as Point)[1] - (ring[j] as Point)[1]);
      if (d > far) {
        far = d;
        a = i;
        b = j;
      }
    }
  }
  const keep = new Set<number>([a, b]);
  /** The chain of `count + 1` corners from `start`, going round the ring. */
  const run = (start: number, count: number) => {
    const at = (i: number) => ring[(start + i) % n] as Point;
    const stack: [number, number][] = [[0, count]];
    while (stack.length) {
      const [lo, hi] = stack.pop() as [number, number];
      let worst = -1;
      let where = -1;
      for (let i = lo + 1; i < hi; i++) {
        const d = toSegment(at(i), at(lo), at(hi));
        if (d > worst) {
          worst = d;
          where = i;
        }
      }
      if (where > 0 && worst > epsilon) {
        keep.add((start + where) % n);
        stack.push([lo, where], [where, hi]);
      }
    }
  };
  run(a, (b - a + n) % n);
  run(b, (a - b + n) % n);
  return ring.filter((_, i) => keep.has(i));
}

/**
 * Every closed boundary loop of the union of `areas`, raw (not simplified, not filtered by size). Areas are
 * counter-clockwise, so outer boundaries come out counter-clockwise and holes clockwise.
 */
function traceLoops(areas: readonly NavArea[]): Point[][] {
  const points = new Map<string, Point>();
  const grid = new Map<string, string[]>();
  for (const a of areas) {
    for (const p of a.outline) {
      const k = key(p);
      if (points.has(k)) continue;
      points.set(k, p);
      const g = `${Math.floor(p[0] / CELL)},${Math.floor(p[1] / CELL)}`;
      const list = grid.get(g);
      if (list) list.push(k);
      else grid.set(g, [k]);
    }
  }

  // Every edge, split at the corners that lie on it. An edge and its reverse cancel: that is a shared seam.
  const live = new Map<string, Directed & { count: number }>();
  for (const a of areas) {
    for (let i = 0; i < a.outline.length; i++) {
      const p = a.outline[i] as Point;
      const q = a.outline[(i + 1) % a.outline.length] as Point;
      if (key(p) === key(q)) continue;
      const chain = split(p, q, points, grid);
      for (let j = 0; j + 1 < chain.length; j++) {
        const from = chain[j] as string;
        const to = chain[j + 1] as string;
        if (from === to) continue;
        // Areas stacked on top of each other repeat an edge, so edges are counted: a seam cancels one copy.
        const back = live.get(`${to}>${from}`);
        if (back) {
          back.count -= 1;
          if (back.count === 0) live.delete(`${to}>${from}`);
        } else {
          const same = live.get(`${from}>${to}`);
          if (same) same.count += 1;
          else live.set(`${from}>${to}`, { from, to, count: 1 });
        }
      }
    }
  }

  const edges: Directed[] = [];
  for (const e of live.values()) for (let i = 0; i < e.count; i++) edges.push({ from: e.from, to: e.to });
  const out = new Map<string, Directed[]>();
  for (const e of edges) {
    const list = out.get(e.from);
    if (list) list.push(e);
    else out.set(e.from, [e]);
  }
  const used = new Set<Directed>();
  const loops: Point[][] = [];
  for (const start of edges) {
    if (used.has(start)) continue;
    const ring: Point[] = [];
    let cur: Directed | undefined = start;
    while (cur && !used.has(cur)) {
      used.add(cur);
      ring.push(points.get(cur.from) as Point);
      if (cur.to === start.from) {
        loops.push(ring);
        break;
      }
      // At a pinch point take the sharpest left turn, which keeps each lobe a loop of its own.
      const here: Directed = cur;
      const a = points.get(here.from) as Point;
      const b = points.get(here.to) as Point;
      let next: Directed | undefined;
      let bestAngle = -Infinity;
      for (const c of out.get(here.to) ?? []) {
        if (used.has(c)) continue;
        const d = points.get(c.to) as Point;
        const angle = Math.atan2((b[0] - a[0]) * (d[1] - b[1]) - (b[1] - a[1]) * (d[0] - b[0]), (b[0] - a[0]) * (d[0] - b[0]) + (b[1] - a[1]) * (d[1] - b[1]));
        if (angle > bestAngle) {
          bestAngle = angle;
          next = c;
        }
      }
      cur = next;
    }
  }

  return loops;
}

const signed = (r: Point[]) => {
  let s = 0;
  for (let i = 0; i < r.length; i++) s += (r[i] as Point)[0] * (r[(i + 1) % r.length] as Point)[1] - (r[(i + 1) % r.length] as Point)[0] * (r[i] as Point)[1];
  return s / 2;
};

export function outlineOf(areas: readonly NavArea[], options: { simplify?: number } = {}): Outline {
  if (areas.length === 0) return { polygon: null, dropped: 0 };
  const rings = traceLoops(areas).filter((r) => r.length >= 3);
  const outer = rings.filter((r) => signed(r) > 0).sort((p, q) => signed(q) - signed(p));
  const best = outer[0];
  if (!best) return { polygon: null, dropped: rings.length };

  let ring = dropStraight(best, 0.3);
  const wanted = options.simplify ?? 1;
  for (let eps = wanted; eps > 0.05; eps /= 2) {
    const simpler = simplifyRing(ring, eps);
    if (simpler.length >= 3 && polygonArea(simpler) > 0 && isSimplePolygon(simpler)) {
      ring = simpler;
      break;
    }
  }
  const rounded = ring.map(([x, y]): Point => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
  return { polygon: isSimplePolygon(rounded) ? rounded : ring, dropped: rings.length - 1 };
}

export interface SilhouetteOptions {
  /** How far a corner may stray from the line between its neighbours before it is kept, world units. Default 1. */
  simplify?: number;
  /** Loops enclosing less than this (square world units) are left out: specks the eye cannot see. Default 0. */
  minArea?: number;
}

/**
 * The silhouette of a whole walkable surface (SCOPE.md §3.6): every boundary loop of the union of `areas`, not only
 * the largest one. `outlineOf` is for one callout and keeps one simple polygon; the silhouette also needs the holes
 * (pillars, courtyards) and the pieces the game links by jumping. Outer loops are counter-clockwise and holes
 * clockwise, so drawing them as one path with the non-zero rule gives the union: where areas of different floors
 * overlap, their loops cross and still fill as one.
 */
export function silhouetteLoops(areas: readonly NavArea[], options: SilhouetteOptions = {}): Point[][] {
  if (areas.length === 0) return [];
  const wanted = options.simplify ?? 1;
  const minArea = options.minArea ?? 0;
  const out: Point[][] = [];
  for (const raw of traceLoops(areas)) {
    if (raw.length < 3 || Math.abs(signed(raw)) < minArea) continue;
    let ring = dropStraight(raw, 0.3);
    // A loop that touches itself at a pinch point is not "simple" to begin with; simplifying must not make it worse.
    const mustStaySimple = isSimplePolygon(ring);
    for (let eps = wanted; eps > 0.05 && ring.length > 4; eps /= 2) {
      const simpler = simplifyRing(ring, eps);
      if (simpler.length >= 3 && simpler.length < ring.length && Math.abs(signed(simpler)) > 0 && (!mustStaySimple || isSimplePolygon(simpler))) {
        ring = simpler;
        break;
      }
    }
    if (ring.length >= 3 && Math.abs(signed(ring)) >= minArea) out.push(ring);
  }
  return out;
}

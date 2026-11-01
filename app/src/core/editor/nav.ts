// The decoded navigation mesh as the Editor uses it (SCOPE.md §7.4, §8.3): the walkable surface as triangles and
// quads in world units, who touches whom, and where a point on the map lands.
//
// The mesh has T-junctions: a long edge often meets two or three shorter ones, so "share exactly the same edge"
// leaves Mirage in 155 islands, while "overlap along a stretch of edge" leaves one island of 2,085 of its 2,544 areas
// (the rest are ledges, boxes and gaps the game links by jumping). Adjacency here is the second kind.

import { z } from 'zod';
import { pointInPolygon, type Point } from '../geometry';
import { levelFor, type Level } from '../projection';

export const NavMeshSchema = z
  .object({
    map: z.string(),
    vertices: z.array(z.tuple([z.number(), z.number(), z.number()])),
    polygons: z.array(z.array(z.number().int().nonnegative()).min(3).max(4)),
  })
  .superRefine((mesh, ctx) => {
    mesh.polygons.forEach((p, i) => {
      if (p.some((v) => v >= mesh.vertices.length)) ctx.addIssue({ code: 'custom', message: `area ${i} uses a vertex that does not exist`, path: ['polygons', i] });
    });
  });

export type NavMesh = z.infer<typeof NavMeshSchema>;

export interface NavArea {
  id: number;
  /** Corners as [x, y, z] in world units, counter-clockwise seen from above. */
  corners: [number, number, number][];
  /** The same corners as x, y pairs. */
  outline: Point[];
  centroid: Point;
  /** Mean height of the corners. */
  z: number;
  /** Square world units seen from above. */
  size: number;
  level: string;
}

export interface NavIndex {
  areas: NavArea[];
  /** Areas that share a stretch of edge, by area id. */
  neighbours: number[][];
  /** Length of shared edge between two touching areas, keyed `low:high`. */
  contact: Map<string, number>;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  /** Spatial hash: cell -> ids of the areas whose bounding box touches it. */
  cells: Map<string, number[]>;
}

const CELL = 64;
/** An edge counts as lying along another within this many world units. */
const ALONG = 0.6;
/** Edges that overlap by less than this are corners touching, not neighbours. */
const MIN_OVERLAP = 1;
/** Neighbouring areas meet at the same height give or take a step (18 units) and some slack. */
const Z_STEP = 24;

const cellKey = (cx: number, cy: number) => `${cx},${cy}`;
export const contactKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);

function signedArea(pts: readonly Point[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i] as Point;
    const [x2, y2] = pts[(i + 1) % pts.length] as Point;
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

export function buildNavIndex(mesh: NavMesh, levels: readonly Level[]): NavIndex {
  const areas: NavArea[] = mesh.polygons.map((poly, id) => {
    let corners = poly.map((i) => mesh.vertices[i] as [number, number, number]);
    if (signedArea(corners.map((c) => [c[0], c[1]] as Point)) < 0) corners = corners.slice().reverse();
    const outline = corners.map((c) => [c[0], c[1]] as Point);
    const z = corners.reduce((s, c) => s + c[2], 0) / corners.length;
    const size = signedArea(outline);
    // Centroid of the corners is enough for a label point and a brush test on triangles and quads.
    const centroid: Point = [outline.reduce((s, p) => s + p[0], 0) / outline.length, outline.reduce((s, p) => s + p[1], 0) / outline.length];
    return { id, corners, outline, centroid, z, size, level: levelFor(z, levels) };
  });

  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const cells = new Map<string, number[]>();
  for (const a of areas) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of a.outline) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    bounds.minX = Math.min(bounds.minX, minX);
    bounds.minY = Math.min(bounds.minY, minY);
    bounds.maxX = Math.max(bounds.maxX, maxX);
    bounds.maxY = Math.max(bounds.maxY, maxY);
    for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) {
      for (let cy = Math.floor(minY / CELL); cy <= Math.floor(maxY / CELL); cy++) {
        const k = cellKey(cx, cy);
        const list = cells.get(k);
        if (list) list.push(a.id);
        else cells.set(k, [a.id]);
      }
    }
  }

  const { neighbours, contact } = adjacency(areas);
  return { areas, neighbours, contact, bounds, cells };
}

interface Edge {
  area: number;
  a: [number, number, number];
  b: [number, number, number];
}

/** Length along edge `e` that edge `f` lies on top of, 0 if they are not along each other or not at one height. */
function overlap(e: Edge, f: Edge): number {
  const dx = e.b[0] - e.a[0];
  const dy = e.b[1] - e.a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return 0;
  const ux = dx / len;
  const uy = dy / len;
  const off = (p: readonly number[]) => Math.abs(((p[0] as number) - e.a[0]) * uy - ((p[1] as number) - e.a[1]) * ux);
  if (off(f.a) > ALONG || off(f.b) > ALONG) return 0;
  const along = (p: readonly number[]) => ((p[0] as number) - e.a[0]) * ux + ((p[1] as number) - e.a[1]) * uy;
  const tf0 = along(f.a);
  const tf1 = along(f.b);
  const lo = Math.max(0, Math.min(tf0, tf1));
  const hi = Math.min(len, Math.max(tf0, tf1));
  if (hi - lo < MIN_OVERLAP) return 0;
  const mid = (lo + hi) / 2;
  const ze = e.a[2] + (e.b[2] - e.a[2]) * (mid / len);
  const zf = f.a[2] + (f.b[2] - f.a[2]) * ((mid - tf0) / (tf1 - tf0));
  return Math.abs(ze - zf) <= Z_STEP ? hi - lo : 0;
}

function adjacency(areas: readonly NavArea[]): { neighbours: number[][]; contact: Map<string, number> } {
  const edges: Edge[] = [];
  for (const a of areas) {
    for (let i = 0; i < a.corners.length; i++) {
      const p = a.corners[i] as [number, number, number];
      const q = a.corners[(i + 1) % a.corners.length] as [number, number, number];
      if (p[0] !== q[0] || p[1] !== q[1]) edges.push({ area: a.id, a: p, b: q });
    }
  }
  const grid = new Map<string, number[]>();
  edges.forEach((e, i) => {
    for (let cx = Math.floor(Math.min(e.a[0], e.b[0]) / CELL); cx <= Math.floor(Math.max(e.a[0], e.b[0]) / CELL); cx++) {
      for (let cy = Math.floor(Math.min(e.a[1], e.b[1]) / CELL); cy <= Math.floor(Math.max(e.a[1], e.b[1]) / CELL); cy++) {
        const k = cellKey(cx, cy);
        const list = grid.get(k);
        if (list) list.push(i);
        else grid.set(k, [i]);
      }
    }
  });

  const contact = new Map<string, number>();
  const done = new Set<number>();
  for (const list of grid.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const [s, t] = [list[i] as number, list[j] as number];
        const e = edges[s] as Edge;
        const f = edges[t] as Edge;
        if (e.area === f.area) continue;
        const pair = s * edges.length + t;
        if (done.has(pair)) continue;
        done.add(pair);
        const len = overlap(e, f);
        if (len > 0) {
          const k = contactKey(e.area, f.area);
          contact.set(k, (contact.get(k) ?? 0) + len);
        }
      }
    }
  }
  const neighbours: number[][] = areas.map(() => []);
  for (const k of contact.keys()) {
    const [a, b] = k.split(':').map(Number) as [number, number];
    (neighbours[a] as number[]).push(b);
    (neighbours[b] as number[]).push(a);
  }
  neighbours.forEach((n) => n.sort((x, y) => x - y));
  return { neighbours, contact };
}

function candidates(index: NavIndex, x: number, y: number, radius: number): number[] {
  const out = new Set<number>();
  for (let cx = Math.floor((x - radius) / CELL); cx <= Math.floor((x + radius) / CELL); cx++) {
    for (let cy = Math.floor((y - radius) / CELL); cy <= Math.floor((y + radius) / CELL); cy++) {
      for (const id of index.cells.get(cellKey(cx, cy)) ?? []) out.add(id);
    }
  }
  return [...out];
}

/** The area under a point. Where floors overlap in one level, the highest wins. */
export function areaAt(index: NavIndex, x: number, y: number, level?: string): number | null {
  let best: NavArea | null = null;
  for (const id of candidates(index, x, y, 0)) {
    const a = index.areas[id] as NavArea;
    if (level !== undefined && a.level !== level) continue;
    if (!pointInPolygon([x, y], a.outline)) continue;
    if (!best || a.z > best.z) best = a;
  }
  return best ? best.id : null;
}

/** Areas under a round brush: those the point is in, plus any whose centroid or a corner is within the radius. */
export function areasWithin(index: NavIndex, x: number, y: number, radius: number, level?: string): number[] {
  const out: number[] = [];
  const r2 = radius * radius;
  for (const id of candidates(index, x, y, radius)) {
    const a = index.areas[id] as NavArea;
    if (level !== undefined && a.level !== level) continue;
    const near = a.outline.some(([px, py]) => (px - x) ** 2 + (py - y) ** 2 <= r2) || (a.centroid[0] - x) ** 2 + (a.centroid[1] - y) ** 2 <= r2;
    if (near || pointInPolygon([x, y], a.outline)) out.push(id);
  }
  return out.sort((p, q) => p - q);
}

export interface FillOptions {
  /** Stay on this level. */
  level?: string | undefined;
  /** Stop at areas whose centroid is farther than this from the seed's, in world units. */
  radius: number;
  /** Areas the fill may not enter (those another callout already owns). */
  blocked?: ReadonlySet<number> | undefined;
}

/** Flood fill across touching areas from `seed`, as a paint bucket: bounded by distance, level and blocked areas. */
export function floodFill(index: NavIndex, seed: number, options: FillOptions): number[] {
  const start = index.areas[seed];
  if (!start) return [];
  const r2 = options.radius * options.radius;
  const seen = new Set<number>([seed]);
  const queue = [seed];
  for (let head = 0; head < queue.length; head++) {
    for (const n of index.neighbours[queue[head] as number] as number[]) {
      if (seen.has(n)) continue;
      const a = index.areas[n] as NavArea;
      if (options.level !== undefined && a.level !== options.level) continue;
      if (options.blocked?.has(n)) continue;
      if ((a.centroid[0] - start.centroid[0]) ** 2 + (a.centroid[1] - start.centroid[1]) ** 2 > r2) continue;
      seen.add(n);
      queue.push(n);
    }
  }
  return [...seen].sort((p, q) => p - q);
}

/** How strongly two sets of areas touch: total shared edge length between them. */
export function contactBetween(index: NavIndex, a: readonly number[], b: ReadonlySet<number>): number {
  let total = 0;
  for (const id of a) {
    for (const n of index.neighbours[id] ?? []) {
      if (b.has(n)) total += index.contact.get(contactKey(id, n)) ?? 0;
    }
  }
  return total;
}

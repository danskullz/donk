// The geometry and layout decisions behind the map component and the map screens (SCOPE.md §5.3, §5.4), kept out of
// Svelte so they are tested without a browser: pinch zoom, the tap-to-zoom assist, arrow-key movement between
// regions, label collisions, how a callout list is cut into pages, and how many cards of the map picker fit a window.

import type { Point } from './geometry';
import { centreOn, MAX_ZOOM, panBy, zoomAt, zoomLevel, type ViewBox } from './mapview';
import type { Callout } from './schema';

// ---------------------------------------------------------------------------------------------- screen <-> map

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Screen pixels per radar pixel. The picture is letterboxed, so the smaller of the two ratios applies. */
export function pixelsPerUnit(view: ViewBox, rect: Pick<Rect, 'width' | 'height'>): number {
  return rect.width > 0 && rect.height > 0 ? Math.min(rect.width / view.w, rect.height / view.h) : 0;
}

/** The radar pixel under a screen point, for an svg of size `rect` showing `view` (xMidYMid meet). */
export function clientToView(view: ViewBox, rect: Rect, x: number, y: number): Point {
  const s = pixelsPerUnit(view, rect);
  if (s === 0) return [view.x, view.y];
  const ox = (rect.width - view.w * s) / 2;
  const oy = (rect.height - view.h * s) / 2;
  return [view.x + (x - rect.left - ox) / s, view.y + (y - rect.top - oy) / s];
}

/** Region outlines are drawn from path data (`M x y L x y … Z`); this reads the corners back for hit tests. */
export function parsePath(d: string): Point[] {
  const nums = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  const out: Point[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i] as number, nums[i + 1] as number]);
  return out;
}

/**
 * The box around path data written with the commands `M m L l Z z` (what `pnpm content:art` writes, core/artfile.ts).
 * Relative commands are followed, so the numbers are not simply read as points. Null for an empty path.
 */
export function pathBounds(d: string): Bounds | null {
  const tokens = d.match(/[MmLlZz]|-?(?:\d+\.?\d*|\.\d+)/g) ?? [];
  let relative = false;
  let x = 0;
  let y = 0;
  let pending: number | null = null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const t of tokens) {
    if (/^[A-Za-z]$/.test(t)) {
      relative = t === 'm' || t === 'l';
      pending = null;
      continue;
    }
    const n = Number(t);
    if (pending === null) {
      pending = n;
      continue;
    }
    x = relative ? x + pending : pending;
    y = relative ? y + n : n;
    pending = null;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return minX === Infinity ? null : { minX, minY, maxX, maxY };
}

/** The fit view widened to take in the map art too, which can run past the outermost callout. */
export function fitWithArt(fit: ViewBox, art: Bounds | null, pad = 0.03): ViewBox {
  if (!art) return fit;
  const margin = Math.max(art.maxX - art.minX, art.maxY - art.minY) * pad;
  const minX = Math.min(fit.x, art.minX - margin);
  const minY = Math.min(fit.y, art.minY - margin);
  const maxX = Math.max(fit.x + fit.w, art.maxX + margin);
  const maxY = Math.max(fit.y + fit.h, art.maxY + margin);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// ---------------------------------------------------------------------------------------------------- pinch zoom

/**
 * The view for two fingers that started at `a0`, `b0` (screen points) on `start` and are now at `a1`, `b1`: spreading
 * zooms about the point between the fingers, and moving both pans, so the map stays under the fingers.
 */
export function pinchView(start: ViewBox, fit: ViewBox, rect: Rect, a0: Point, b0: Point, a1: Point, b1: Point): ViewBox {
  const d0 = Math.hypot(b0[0] - a0[0], b0[1] - a0[1]);
  const d1 = Math.hypot(b1[0] - a1[0], b1[1] - a1[1]);
  const mid0: Point = [(a0[0] + b0[0]) / 2, (a0[1] + b0[1]) / 2];
  const mid1: Point = [(a1[0] + b1[0]) / 2, (a1[1] + b1[1]) / 2];
  const anchor = clientToView(start, rect, mid0[0], mid0[1]);
  const zoomed = d0 < 4 ? start : zoomAt(start, fit, anchor, d1 / d0);
  const under = clientToView(zoomed, rect, mid1[0], mid1[1]);
  return panBy(zoomed, fit, anchor[0] - under[0], anchor[1] - under[1]);
}

// ----------------------------------------------------------------------------------------------- tap-to-zoom assist

export const TAP_TARGET_PX = 44;

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Shortest side of a region as it is on screen now, in pixels. */
export function screenSide(view: ViewBox, rect: Pick<Rect, 'width' | 'height'>, b: Bounds): number {
  return Math.min(b.maxX - b.minX, b.maxY - b.minY) * pixelsPerUnit(view, rect);
}

/**
 * Regions under 44 px on screen are hard to hit with a finger (SCOPE §5.4), so the first tap on one zooms in on it
 * instead. Null when the region is big enough, or the map cannot zoom further (then the tap counts).
 */
export function assistView(view: ViewBox, fit: ViewBox, rect: Pick<Rect, 'width' | 'height'>, b: Bounds, target = 72): ViewBox | null {
  const side = screenSide(view, rect, b);
  if (side >= TAP_TARGET_PX || side <= 0) return null;
  const centre: Point = [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
  const zoomed = centreOn(zoomAt(view, fit, centre, target / side), fit, centre);
  return zoomLevel(zoomed, fit) > zoomLevel(view, fit) * 1.05 ? zoomed : null;
}

/**
 * The view that shows a region the learner chose elsewhere (a row in the list): left alone when the region is already
 * well inside the frame, otherwise centred on it, and zoomed in when the region would be too small to see.
 */
export function revealView(view: ViewBox, fit: ViewBox, rect: Pick<Rect, 'width' | 'height'>, b: Bounds, minSide = 28): ViewBox {
  const centre: Point = [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
  let v = view;
  const side = screenSide(v, rect, b);
  if (side > 0 && side < minSide) v = zoomAt(v, fit, centre, Math.min(MAX_ZOOM, (minSide * 2) / side));
  const insideX = b.minX >= v.x + v.w * 0.1 && b.maxX <= v.x + v.w * 0.9;
  const insideY = b.minY >= v.y + v.h * 0.1 && b.maxY <= v.y + v.h * 0.9;
  return insideX && insideY ? v : centreOn(v, fit, centre);
}

/** Display names of the six mastery states, lowest first (the legend, the list rows, the region labels). */
export const MASTERY_LABEL = { new: 'New', seen: 'Seen', learning: 'Learning', familiar: 'Familiar', known: 'Known', automatic: 'Automatic' } as const;

// ------------------------------------------------------------------------------------------------- arrow-key moves

export type Direction = 'left' | 'right' | 'up' | 'down';

export interface Anchored {
  id: string;
  anchor: Point;
}

/**
 * Where the arrow key goes: the nearest region in that direction, judged by its anchor. Regions inside a 45 degree
 * cone of the direction come first; sideways drift costs double, so the move follows the line the learner pressed
 * along. With nothing in the cone any region on that side will do. Null at the edge of the map.
 */
export function neighbourInDirection(items: readonly Anchored[], fromId: string, dir: Direction): string | null {
  const from = items.find((i) => i.id === fromId);
  if (!from) return null;
  type Best = { id: string; score: number };
  const better = (score: number, id: string, than: Best | null) => than === null || score < than.score || (score === than.score && id < than.id);
  let inCone: Best | null = null;
  let outside: Best | null = null;
  for (const it of items) {
    if (it.id === fromId) continue;
    const dx = it.anchor[0] - from.anchor[0];
    const dy = it.anchor[1] - from.anchor[1];
    const along = dir === 'right' ? dx : dir === 'left' ? -dx : dir === 'down' ? dy : -dy;
    const across = Math.abs(dir === 'left' || dir === 'right' ? dy : dx);
    if (along <= 0) continue;
    const score = along + 2 * across;
    if (across <= along) {
      if (better(score, it.id, inCone)) inCone = { id: it.id, score };
    } else if (better(score, it.id, outside)) {
      outside = { id: it.id, score };
    }
  }
  return (inCone ?? outside)?.id ?? null;
}

// ----------------------------------------------------------------------------------------------- label collisions

export interface LabelBox {
  id: string;
  /** Centre of the text, in radar pixels. */
  x: number;
  y: number;
  /** Size of the text, in radar pixels. */
  w: number;
  h: number;
  /** Higher wins a collision. */
  priority: number;
}

/** Labels to draw: greedy by priority, a label that would cover an earlier one is left out (the learner can zoom). */
export function placeLabels(boxes: readonly LabelBox[], gap = 0): Set<string> {
  const placed: LabelBox[] = [];
  const order = boxes.slice().sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : 1));
  for (const b of order) {
    const hit = placed.some((p) => Math.abs(p.x - b.x) < (p.w + b.w) / 2 + gap && Math.abs(p.y - b.y) < (p.h + b.h) / 2 + gap);
    if (!hit) placed.push(b);
  }
  return new Set(placed.map((p) => p.id));
}

// ---------------------------------------------------------------------------------------------------- paged lists

/**
 * Cut rows into pages of at most `size`. Rows with the same `group` (a callout and its Hard spots) stay together on
 * one page unless the group alone is longer than a page.
 */
export function pageRows<T extends { group: string }>(rows: readonly T[], size: number): T[][] {
  const n = Math.max(1, Math.floor(size));
  const groups: T[][] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && last[0]?.group === row.group) last.push(row);
    else groups.push([row]);
  }
  const pages: T[][] = [];
  let page: T[] = [];
  for (const g of groups) {
    if (page.length > 0 && page.length + g.length > n) {
      pages.push(page);
      page = [];
    }
    if (g.length > n) {
      if (page.length > 0) {
        pages.push(page);
        page = [];
      }
      for (let i = 0; i < g.length; i += n) {
        const chunk = g.slice(i, i + n);
        if (chunk.length === n) pages.push(chunk);
        else page = chunk;
      }
    } else {
      page.push(...g);
    }
  }
  if (page.length > 0) pages.push(page);
  return pages;
}

/** The page that holds a row, or 0 when it is on none (a callout from another zone). */
export function pageOf<T extends { id: string }>(pages: readonly (readonly T[])[], id: string | null): number {
  if (id === null) return 0;
  const i = pages.findIndex((p) => p.some((r) => r.id === id));
  return i < 0 ? 0 : i;
}

export interface ListRow {
  id: string;
  /** The row's callout, or the callout a Hard spot sits in: rows of one group are never split across pages. */
  group: string;
  /** A Hard spot shown under its callout. */
  nested: boolean;
}

type Listed = Pick<Callout, 'id' | 'name' | 'zone' | 'tier' | 'parent' | 'order'>;

const byRoute = (a: Listed, b: Listed): number => (a.order ?? 9999) - (b.order ?? 9999) || a.tier - b.tier || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || (a.id < b.id ? -1 : 1);

/**
 * The rows for one zone: callouts in route order (the order of the walk from spawn toward the site, SCOPE §4.3), each
 * followed by its Hard spots. A Hard spot whose callout is in another zone (or missing) is listed as a row of its own
 * at the end, where it still can be reached.
 */
export function listRows(callouts: readonly Listed[], zone: string): ListRow[] {
  const inZone = callouts.filter((c) => c.zone === zone);
  const ids = new Set(inZone.map((c) => c.id));
  const standard = inZone.filter((c) => c.tier !== 3).sort(byRoute);
  const spots = inZone.filter((c) => c.tier === 3);
  const rows: ListRow[] = [];
  for (const c of standard) {
    rows.push({ id: c.id, group: c.id, nested: false });
    for (const h of spots.filter((x) => x.parent === c.id).sort(byRoute)) rows.push({ id: h.id, group: c.id, nested: true });
  }
  for (const h of spots.filter((x) => x.parent === null || !ids.has(x.parent) || !standard.some((c) => c.id === x.parent)).sort(byRoute)) {
    rows.push({ id: h.id, group: h.id, nested: false });
  }
  return rows;
}

// ----------------------------------------------------------------------------------------------- the picker's grid

export interface GridChoice {
  cols: number;
  rows: number;
  /** Size of one card, in pixels. */
  w: number;
  h: number;
}

/**
 * The columns and rows that give `count` cards the most room inside a `width` x `height` box, with no card smaller
 * than `minW` x `minH`. The score is the biggest card of the wanted shape (`aspect` = width / height) that fits a
 * cell, so a very wide or very tall card is not preferred over a sensible one. Null when nothing is big enough.
 */
export function bestGrid(count: number, width: number, height: number, gap: number, minW: number, minH: number, aspect: number): GridChoice | null {
  let best: (GridChoice & { score: number }) | null = null;
  for (let cols = 1; cols <= Math.max(1, count); cols++) {
    const rows = Math.ceil(count / cols);
    const w = (width - (cols - 1) * gap) / cols;
    const h = (height - (rows - 1) * gap) / rows;
    if (w < minW || h < minH) continue;
    const score = Math.min(w, h * aspect);
    if (!best || score > best.score + 0.5 || (Math.abs(score - best.score) <= 0.5 && cols < best.cols)) best = { cols, rows, w, h, score };
  }
  return best ? { cols: best.cols, rows: best.rows, w: best.w, h: best.h } : null;
}

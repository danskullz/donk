// The maths behind the map component (SCOPE.md §5.4, §6.8), kept out of Svelte so it is tested without a
// browser: region shapes in radar pixels, the fit-to-frame view, zoom and pan limits, and the camera cone.

import { polygonArea, polygonBounds, type Point } from './geometry';
import { cameraCone, worldToPixel, type Projection } from './projection';
import type { Callout, Shot } from './schema';

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MapShape {
  id: string;
  name: string;
  level: string;
  zone: string;
  tier: Callout['tier'];
  parent: string | null;
  /** SVG path data in radar pixels. */
  d: string;
  /** Area in square radar pixels. */
  area: number;
  /** Where the label goes and where a keyboard "click" lands, in radar pixels. */
  anchor: Point;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

const round = (n: number) => Math.round(n * 10) / 10;

/**
 * One shape per callout. Larger shapes come first, so a Hard spot is drawn after (on top of) the callout
 * it sits in and is not hidden by it.
 */
export function shapesFor(callouts: readonly Callout[], proj: Projection): MapShape[] {
  return callouts
    .map((c): MapShape => {
      const pixels = c.region.map(([x, y]) => worldToPixel(proj, x, y));
      return {
        id: c.id,
        name: c.name,
        level: c.level,
        zone: c.zone,
        tier: c.tier,
        parent: c.parent,
        d: `${pixels.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${round(x)} ${round(y)}`).join('')}Z`,
        area: polygonArea(pixels),
        anchor: worldToPixel(proj, c.anchor[0], c.anchor[1]),
        bounds: polygonBounds(pixels),
      };
    })
    .sort((a, b) => b.area - a.area || (a.id < b.id ? -1 : 1));
}

/** The view that shows every shape with a margin: where the map starts, and the most it can zoom out. */
export function fitView(shapes: readonly MapShape[], fallback: ViewBox = { x: 0, y: 0, w: 1024, h: 1024 }, pad = 0.06): ViewBox {
  if (shapes.length === 0) return fallback;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of shapes) {
    minX = Math.min(minX, s.bounds.minX);
    minY = Math.min(minY, s.bounds.minY);
    maxX = Math.max(maxX, s.bounds.maxX);
    maxY = Math.max(maxY, s.bounds.maxY);
  }
  const margin = Math.max(maxX - minX, maxY - minY) * pad;
  return { x: minX - margin, y: minY - margin, w: maxX - minX + 2 * margin, h: maxY - minY + 2 * margin };
}

export const MAX_ZOOM = 8;

/** Keep a view inside the fit box and no smaller than 1/MAX_ZOOM of it. The aspect ratio never changes. */
export function clampView(view: ViewBox, fit: ViewBox, maxZoom = MAX_ZOOM): ViewBox {
  const w = Math.min(fit.w, Math.max(fit.w / maxZoom, view.w));
  const h = (w / fit.w) * fit.h;
  return { x: Math.min(fit.x + fit.w - w, Math.max(fit.x, view.x)), y: Math.min(fit.y + fit.h - h, Math.max(fit.y, view.y)), w, h };
}

/** Zoom by `factor` (above 1 zooms in) keeping the point under the cursor where it is. */
export function zoomAt(view: ViewBox, fit: ViewBox, at: Point, factor: number, maxZoom = MAX_ZOOM): ViewBox {
  const w = Math.min(fit.w, Math.max(fit.w / maxZoom, view.w / factor));
  const k = w / view.w;
  const h = view.h * k;
  return clampView({ x: at[0] - (at[0] - view.x) * k, y: at[1] - (at[1] - view.y) * k, w, h }, fit, maxZoom);
}

export function panBy(view: ViewBox, fit: ViewBox, dx: number, dy: number, maxZoom = MAX_ZOOM): ViewBox {
  return clampView({ ...view, x: view.x + dx, y: view.y + dy }, fit, maxZoom);
}

export function zoomLevel(view: ViewBox, fit: ViewBox): number {
  return fit.w / view.w;
}

/** The view re-centred on a point at the same zoom (the tap-to-zoom assist for tiny targets). */
export function centreOn(view: ViewBox, fit: ViewBox, at: Point): ViewBox {
  return clampView({ ...view, x: at[0] - view.w / 2, y: at[1] - view.h / 2 }, fit);
}

export interface ConeShape {
  apex: Point;
  /** Path data for the triangle of the camera's view. */
  d: string;
}

/** The camera cone of a screenshot, sized to the map so it reads at any zoom of the reveal plate. */
export function coneFor(proj: Projection, shot: Pick<Shot, 'pos' | 'yaw'>, fit: ViewBox): ConeShape {
  const cone = cameraCone(proj, shot.pos, shot.yaw, fit.w * 0.09);
  const p = (pt: Point) => `${round(pt[0])} ${round(pt[1])}`;
  return { apex: cone.apex, d: `M${p(cone.apex)}L${p(cone.left)}L${p(cone.right)}Z` };
}

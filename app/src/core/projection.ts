// World <-> radar-pixel projection (SCOPE §7.5), verified in Phase 0 against 29-39 known positions per map.
//
//   pixel_x = (world_x - pos_x) / scale
//   pixel_y = (pos_y - world_y) / scale        (y is flipped)
//
// pos_x, pos_y is the world coordinate of the radar image's top-left corner; scale is world units per pixel.

import type { Point } from './geometry';

export interface Projection {
  posX: number;
  posY: number;
  scale: number;
}

export function worldToPixel(proj: Projection, x: number, y: number): Point {
  return [(x - proj.posX) / proj.scale, (proj.posY - y) / proj.scale];
}

export function pixelToWorld(proj: Projection, px: number, py: number): Point {
  return [px * proj.scale + proj.posX, proj.posY - py * proj.scale];
}

/** The radar is a square image; `size` is its side in pixels (1024 for the shipped maps). */
export function inRadarBounds(px: number, py: number, size = 1024): boolean {
  return px >= 0 && py >= 0 && px <= size && py <= size;
}

export interface Level {
  id: string;
  /** World z range of this level: altitudeMin <= z < altitudeMax. Open-ended when omitted. */
  altitudeMin?: number | undefined;
  altitudeMax?: number | undefined;
}

/** Multi-floor maps pick the level by comparing world z to the altitude cutoffs (SCOPE §7.5). */
export function levelFor(z: number, levels: readonly Level[]): string {
  for (const level of levels) {
    const lo = level.altitudeMin ?? -Infinity;
    const hi = level.altitudeMax ?? Infinity;
    if (z >= lo && z < hi) return level.id;
  }
  const first = levels[0];
  if (!first) throw new Error('map has no levels');
  return first.id;
}

/** Horizontal field of view of a 16:9 CS2 view at the default 90-degree (4:3) setting. */
export const CS2_HFOV_16_9_DEG = (2 * Math.atan(Math.tan(Math.PI / 4) * (16 / 9) / (4 / 3)) * 180) / Math.PI;

export interface Cone {
  apex: Point;
  left: Point;
  right: Point;
}

/**
 * The camera cone of a screenshot on the radar, in pixels. Source yaw 0 faces +x and grows counter-clockwise
 * seen from above; the pixel y axis points down, hence the sign flip.
 */
export function cameraCone(proj: Projection, pos: readonly [number, number, number], yawDeg: number, lengthPx: number, hfovDeg = CS2_HFOV_16_9_DEG): Cone {
  const apex = worldToPixel(proj, pos[0], pos[1]);
  const ray = (deg: number): Point => {
    const r = (deg * Math.PI) / 180;
    return [apex[0] + Math.cos(r) * lengthPx, apex[1] - Math.sin(r) * lengthPx];
  };
  return { apex, left: ray(yawDeg + hfovDeg / 2), right: ray(yawDeg - hfovDeg / 2) };
}

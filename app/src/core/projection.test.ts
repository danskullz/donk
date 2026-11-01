import { describe, expect, it } from 'vitest';
import { CS2_HFOV_16_9_DEG, cameraCone, inRadarBounds, levelFor, pixelToWorld, worldToPixel, type Projection } from './projection';

// Real Mirage values from the game files (SCOPE §3.2).
const mirage: Projection = { posX: -3230, posY: 1713, scale: 5.0 };

describe('worldToPixel / pixelToWorld', () => {
  it('puts the top-left corner of the radar at pixel 0,0', () => {
    expect(worldToPixel(mirage, -3230, 1713)).toEqual([0, 0]);
  });
  it('flips y: going north moves up the image', () => {
    const [, y1] = worldToPixel(mirage, 0, 0);
    const [, y2] = worldToPixel(mirage, 0, 500);
    expect(y2).toBeLessThan(y1);
  });
  it('round-trips', () => {
    for (const [x, y] of [[-1200, 300], [0, 0], [600, -1800]] as const) {
      const [px, py] = worldToPixel(mirage, x, y);
      const [wx, wy] = pixelToWorld(mirage, px, py);
      expect(wx).toBeCloseTo(x, 9);
      expect(wy).toBeCloseTo(y, 9);
    }
  });
  it('knows the radar bounds', () => {
    expect(inRadarBounds(0, 0)).toBe(true);
    expect(inRadarBounds(1024, 1024)).toBe(true);
    expect(inRadarBounds(-1, 5)).toBe(false);
    expect(inRadarBounds(5, 1025)).toBe(false);
    expect(inRadarBounds(600, 600, 512)).toBe(false);
  });
});

describe('levelFor', () => {
  const nuke = [
    { id: 'default', altitudeMin: -495 },
    { id: 'lower', altitudeMax: -495 },
  ];
  it('picks the level by altitude', () => {
    expect(levelFor(100, nuke)).toBe('default');
    expect(levelFor(-495, nuke)).toBe('default');
    expect(levelFor(-600, nuke)).toBe('lower');
  });
  it('uses the only level of a single-floor map', () => {
    expect(levelFor(12345, [{ id: 'default' }])).toBe('default');
  });
  it('falls back to the first level when none matches', () => {
    expect(levelFor(0, [{ id: 'a', altitudeMin: 100 }, { id: 'b', altitudeMin: 200 }])).toBe('a');
  });
});

describe('cameraCone', () => {
  it('uses the 16:9 horizontal field of view of a default CS2 view', () => {
    expect(CS2_HFOV_16_9_DEG).toBeCloseTo(106.26, 2);
  });
  it('points east for yaw 0 and north (up the image) for yaw 90', () => {
    const east = cameraCone(mirage, [0, 0, 64], 0, 100, 90);
    expect(east.left[0]).toBeGreaterThan(east.apex[0]);
    expect(east.left[1]).toBeLessThan(east.apex[1]);
    expect(east.right[1]).toBeGreaterThan(east.apex[1]);
    const north = cameraCone(mirage, [0, 0, 64], 90, 100, 90);
    expect(north.left[1]).toBeLessThan(north.apex[1]);
    expect(north.right[1]).toBeLessThan(north.apex[1]);
    expect(north.left[0]).toBeLessThan(north.apex[0]);
    expect(north.right[0]).toBeGreaterThan(north.apex[0]);
  });
  it('draws rays of the requested length', () => {
    const cone = cameraCone(mirage, [0, 0, 64], 33, 80);
    expect(Math.hypot(cone.left[0] - cone.apex[0], cone.left[1] - cone.apex[1])).toBeCloseTo(80, 9);
  });
});

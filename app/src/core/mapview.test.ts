import { describe, expect, it } from 'vitest';
import { centreOn, clampView, coneFor, fitView, MAX_ZOOM, panBy, shapesFor, zoomAt, zoomLevel, type ViewBox } from './mapview';
import { worldToPixel } from './projection';
import { makeCallouts, makeMap } from './test-fixtures';

const map = makeMap();
const proj = map.projection;
const shapes = shapesFor(makeCallouts(), proj);
const fit = fitView(shapes);

describe('shapesFor', () => {
  it('makes one shape per callout, with its path in radar pixels', () => {
    expect(shapes).toHaveLength(9);
    const mid = shapes.find((s) => s.id === 'test.mid')!;
    // mid is the cell x 200-400, y 0-200: pixel x = (x + 1000) / 2, y = (1000 - y) / 2
    expect(mid.d).toBe('M600 500L700 500L700 400L600 400Z');
    expect(mid.area).toBe(100 * 100);
    expect(mid.anchor).toEqual([650, 450]);
    expect(mid.bounds).toEqual({ minX: 600, minY: 400, maxX: 700, maxY: 500 });
  });

  it('draws larger shapes first, so a Hard spot lands on top of the callout around it', () => {
    const order = shapes.map((s) => s.id);
    expect(order.indexOf('test.bench')).toBeGreaterThan(order.indexOf('test.a-site'));
    expect(order.at(-1)).toBe('test.bench');
  });
});

describe('fitView', () => {
  it('contains every shape with a margin', () => {
    for (const s of shapes) {
      expect(s.bounds.minX).toBeGreaterThan(fit.x);
      expect(s.bounds.minY).toBeGreaterThan(fit.y);
      expect(s.bounds.maxX).toBeLessThan(fit.x + fit.w);
      expect(s.bounds.maxY).toBeLessThan(fit.y + fit.h);
    }
  });
  it('falls back to the whole radar when there is nothing to show', () => {
    expect(fitView([])).toEqual({ x: 0, y: 0, w: 1024, h: 1024 });
  });
});

describe('zoom and pan', () => {
  const centre = [fit.x + fit.w / 2, fit.y + fit.h / 2] as const;

  it('zooming in keeps the point under the cursor where it is', () => {
    const at: [number, number] = [fit.x + fit.w * 0.3, fit.y + fit.h * 0.7];
    const v = zoomAt(fit, fit, at, 2);
    expect(v.w).toBeCloseTo(fit.w / 2);
    expect(v.h).toBeCloseTo(fit.h / 2);
    // the cursor stays at the same fraction of the view
    expect((at[0] - v.x) / v.w).toBeCloseTo((at[0] - fit.x) / fit.w);
    expect((at[1] - v.y) / v.h).toBeCloseTo((at[1] - fit.y) / fit.h);
  });

  it('cannot zoom out past the fit, nor in past the limit, and keeps the aspect ratio', () => {
    const same = (a: ViewBox, b: ViewBox) => (['x', 'y', 'w', 'h'] as const).forEach((k) => expect(a[k]).toBeCloseTo(b[k]));
    same(zoomAt(fit, fit, [centre[0], centre[1]], 0.5), fit);
    let v: ViewBox = fit;
    for (let i = 0; i < 20; i++) v = zoomAt(v, fit, [centre[0], centre[1]], 2);
    expect(zoomLevel(v, fit)).toBeCloseTo(MAX_ZOOM);
    expect(v.w / v.h).toBeCloseTo(fit.w / fit.h);
  });

  it('cannot pan the view outside the fit box', () => {
    const zoomed = zoomAt(fit, fit, [centre[0], centre[1]], 4);
    const far = panBy(zoomed, fit, 1e6, 1e6);
    expect(far.x + far.w).toBeCloseTo(fit.x + fit.w);
    expect(far.y + far.h).toBeCloseTo(fit.y + fit.h);
    const back = panBy(zoomed, fit, -1e6, -1e6);
    expect([back.x, back.y]).toEqual([fit.x, fit.y]);
    const nudged = panBy(fit, fit, 50, 50);
    expect(nudged.x).toBeCloseTo(fit.x);
    expect(nudged.y).toBeCloseTo(fit.y);
  });

  it('re-centres on a point without changing the zoom, within the limits', () => {
    const zoomed = zoomAt(fit, fit, [centre[0], centre[1]], 4);
    const at: [number, number] = [fit.x + fit.w * 0.6, fit.y + fit.h * 0.4];
    const v = centreOn(zoomed, fit, at);
    expect(v.w).toBeCloseTo(zoomed.w);
    expect(v.x + v.w / 2).toBeCloseTo(at[0]);
    expect(v.y + v.h / 2).toBeCloseTo(at[1]);
    expect(clampView({ x: -1e6, y: -1e6, w: 1, h: 1 }, fit).w).toBeCloseTo(fit.w / MAX_ZOOM);
  });
});

describe('coneFor', () => {
  it('starts at the camera position on the map and opens toward the way it faces', () => {
    const shot = { pos: [500, 100, 64] as [number, number, number], yaw: 90 };
    const cone = coneFor(proj, shot, fit);
    expect(cone.apex).toEqual(worldToPixel(proj, 500, 100));
    expect(cone.d.startsWith(`M${Math.round(cone.apex[0] * 10) / 10} ${Math.round(cone.apex[1] * 10) / 10}L`)).toBe(true);
    // yaw 90 faces +y in the world, which is up the radar: both far corners are above the apex
    const ys = [...cone.d.matchAll(/L(-?[\d.]+) (-?[\d.]+)/g)].map((m) => Number(m[2]));
    expect(ys).toHaveLength(2);
    expect(ys.every((y) => y < cone.apex[1])).toBe(true);
  });
});

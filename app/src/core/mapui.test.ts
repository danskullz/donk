import { describe, expect, it } from 'vitest';
import { MAX_ZOOM, zoomAt, zoomLevel, type ViewBox } from './mapview';
import {
  assistView,
  bestGrid,
  clientToView,
  neighbourInDirection,
  pageRows,
  parsePath,
  pinchView,
  pixelsPerUnit,
  placeLabels,
  revealView,
  screenSide,
  type Rect,
} from './mapui';

const fit: ViewBox = { x: 0, y: 0, w: 1000, h: 800 };
/** A 500 x 400 px svg: 0.5 px per radar pixel, no letterbox. */
const rect: Rect = { left: 100, top: 50, width: 500, height: 400 };
const close = (a: ViewBox, b: ViewBox) => (['x', 'y', 'w', 'h'] as const).forEach((k) => expect(a[k]).toBeCloseTo(b[k], 5));

describe('screen and map coordinates', () => {
  it('maps a screen point to the radar pixel under it', () => {
    expect(pixelsPerUnit(fit, rect)).toBe(0.5);
    expect(clientToView(fit, rect, 100, 50)).toEqual([0, 0]);
    expect(clientToView(fit, rect, 350, 250)).toEqual([500, 400]);
    const zoomed: ViewBox = { x: 200, y: 100, w: 500, h: 400 };
    expect(clientToView(zoomed, rect, 100, 50)).toEqual([200, 100]);
    expect(clientToView(zoomed, rect, 600, 450)).toEqual([700, 500]);
  });

  it('accounts for the letterbox when the picture is narrower than its box', () => {
    // a square view in a 500 x 400 box: 400 px wide, centred, so 50 px of margin each side
    const square: ViewBox = { x: 0, y: 0, w: 800, h: 800 };
    expect(pixelsPerUnit(square, rect)).toBe(0.5);
    expect(clientToView(square, rect, 150, 50)).toEqual([0, 0]);
    expect(clientToView(square, rect, 550, 450)).toEqual([800, 800]);
  });

  it('survives a box with no size yet', () => {
    expect(pixelsPerUnit(fit, { width: 0, height: 0 })).toBe(0);
    expect(clientToView(fit, { left: 0, top: 0, width: 0, height: 0 }, 5, 5)).toEqual([0, 0]);
  });
});

describe('parsePath', () => {
  it('reads the corners of a region back from its path data', () => {
    expect(parsePath('M600 500L700.5 500L700.5 -400.2Z')).toEqual([[600, 500], [700.5, 500], [700.5, -400.2]]);
    expect(parsePath('')).toEqual([]);
  });
});

describe('pinch zoom', () => {
  it('spreading two fingers zooms about the point between them', () => {
    // fingers 100 px apart around screen (350, 250) which is radar (500, 400); they spread to 200 px apart
    const v = pinchView(fit, fit, rect, [300, 250], [400, 250], [250, 250], [450, 250]);
    expect(v.w).toBeCloseTo(500);
    expect(v.h).toBeCloseTo(400);
    // the point between the fingers is still radar (500, 400)
    expect(clientToView(v, rect, 350, 250)[0]).toBeCloseTo(500);
    expect(clientToView(v, rect, 350, 250)[1]).toBeCloseTo(400);
  });

  it('pinching in zooms out again, never past the fit', () => {
    const zoomed = zoomAt(fit, fit, [500, 400], 4);
    const back = pinchView(zoomed, fit, rect, [200, 250], [500, 250], [345, 250], [355, 250]);
    close(back, fit);
  });

  it('moving both fingers together pans, keeping the map under them', () => {
    const zoomed = zoomAt(fit, fit, [500, 400], 2);
    const v = pinchView(zoomed, fit, rect, [300, 250], [400, 250], [350, 250], [450, 250]);
    expect(v.w).toBeCloseTo(zoomed.w);
    // fingers moved 50 px right, so the map moves right under them: the view moves left by 50 px = 100 radar px / 2 (zoom)
    expect(v.x).toBeCloseTo(zoomed.x - 50 / (0.5 * 2));
    expect(v.y).toBeCloseTo(zoomed.y);
  });

  it('cannot zoom past the limit, and ignores fingers that start on top of each other', () => {
    const v = pinchView(fit, fit, rect, [345, 250], [355, 250], [0, 250], [700, 250]);
    expect(zoomLevel(v, fit)).toBeCloseTo(MAX_ZOOM);
    close(pinchView(fit, fit, rect, [350, 250], [350, 250], [200, 250], [500, 250]), fit);
  });
});

describe('the tap-to-zoom assist', () => {
  const tiny = { minX: 480, minY: 380, maxX: 500, maxY: 400 }; // 20 radar px = 10 screen px
  const big = { minX: 100, minY: 100, maxX: 400, maxY: 400 }; // 150 screen px

  it('measures a region as it is on screen', () => {
    expect(screenSide(fit, rect, tiny)).toBe(10);
    expect(screenSide(fit, rect, big)).toBe(150);
  });

  it('leaves a region of 44 px or more alone', () => {
    expect(assistView(fit, fit, rect, big)).toBeNull();
    expect(assistView(fit, fit, rect, { minX: 0, minY: 0, maxX: 88, maxY: 100 })).toBeNull();
  });

  it('zooms in on a smaller one, centred on it, until it is a comfortable target', () => {
    const v = assistView(fit, fit, rect, tiny);
    expect(v).not.toBeNull();
    if (!v) return;
    expect(screenSide(v, rect, tiny)).toBeGreaterThanOrEqual(44);
    expect(v.x + v.w / 2).toBeCloseTo(490, 0);
    expect(v.y + v.h / 2).toBeCloseTo(390, 0);
  });

  it('lets the tap through when the map cannot zoom any further', () => {
    const atMax = zoomAt(fit, fit, [490, 390], MAX_ZOOM);
    const stillTiny = { minX: 489, minY: 389, maxX: 491, maxY: 391 };
    expect(assistView(atMax, fit, rect, stillTiny)).toBeNull();
  });
});

describe('revealView (a callout chosen from the list)', () => {
  const at = (cx: number, cy: number, half = 40) => ({ minX: cx - half, minY: cy - half, maxX: cx + half, maxY: cy + half });

  it('leaves the view alone when the region is well inside it', () => {
    expect(revealView(fit, fit, rect, at(500, 400))).toEqual(fit);
  });

  it('centres on a region that is out of frame', () => {
    const zoomed = zoomAt(fit, fit, [200, 200], 4);
    const v = revealView(zoomed, fit, rect, at(800, 700));
    expect(v.w).toBeCloseTo(zoomed.w);
    expect(v.x + v.w / 2).toBeCloseTo(800);
    expect(v.y + v.h / 2).toBeCloseTo(700);
  });

  it('zooms in on a region too small to see', () => {
    const v = revealView(fit, fit, rect, at(500, 400, 8));
    expect(zoomLevel(v, fit)).toBeGreaterThan(1.5);
    expect(screenSide(v, rect, at(500, 400, 8))).toBeGreaterThanOrEqual(28);
  });
});

describe('moving between regions with the arrow keys', () => {
  //   a  b  c
  //   d  e  f      (anchors on a 100 px grid)
  //         g
  const items = [
    { id: 'a', anchor: [0, 0] },
    { id: 'b', anchor: [100, 0] },
    { id: 'c', anchor: [200, 0] },
    { id: 'd', anchor: [0, 100] },
    { id: 'e', anchor: [100, 100] },
    { id: 'f', anchor: [200, 100] },
    { id: 'g', anchor: [200, 200] },
  ] as const;
  const go = (from: string, dir: 'left' | 'right' | 'up' | 'down') => neighbourInDirection(items, from, dir);

  it('goes to the nearest region in the direction pressed', () => {
    expect(go('e', 'right')).toBe('f');
    expect(go('e', 'left')).toBe('d');
    expect(go('e', 'up')).toBe('b');
    expect(go('e', 'down')).toBe('g'); // nothing straight below, so the one on the diagonal; f is level with e, not below it
    expect(go('b', 'down')).toBe('e');
    expect(go('f', 'down')).toBe('g');
  });

  it('stops at the edge, and for a region it does not know', () => {
    expect(go('a', 'left')).toBeNull();
    expect(go('a', 'up')).toBeNull();
    expect(go('g', 'right')).toBeNull();
    expect(go('zz', 'right')).toBeNull();
  });

  it('prefers a region on the line over a nearer one off to the side', () => {
    const two = [
      { id: 'from', anchor: [0, 0] },
      { id: 'near-but-off', anchor: [40, 38] },
      { id: 'far-on-line', anchor: [100, 0] },
    ] as const;
    expect(neighbourInDirection(two, 'from', 'right')).toBe('far-on-line');
  });

  it('falls back to any region on that side when none is inside the cone', () => {
    const steep = [
      { id: 'from', anchor: [0, 0] },
      { id: 'only', anchor: [10, 100] },
    ] as const;
    expect(neighbourInDirection(steep, 'from', 'right')).toBe('only');
    expect(neighbourInDirection(steep, 'from', 'down')).toBe('only');
  });

  it('breaks a tie the same way every time', () => {
    const tie = [
      { id: 'from', anchor: [0, 0] },
      { id: 'z', anchor: [50, 10] },
      { id: 'b', anchor: [50, -10] },
    ] as const;
    expect(neighbourInDirection(tie, 'from', 'right')).toBe('b');
  });
});

describe('label collisions', () => {
  const box = (id: string, x: number, y: number, priority = 0, w = 60, h = 14) => ({ id, x, y, w, h, priority });

  it('keeps every label that does not touch another', () => {
    expect([...placeLabels([box('a', 0, 0), box('b', 100, 0), box('c', 0, 50)])].sort()).toEqual(['a', 'b', 'c']);
  });

  it('drops the lower-priority label of an overlapping pair', () => {
    expect([...placeLabels([box('low', 10, 0, 1), box('high', 0, 0, 5)])]).toEqual(['high']);
  });

  it('breaks equal priorities by id, and a label can be kept next to a dropped one', () => {
    expect([...placeLabels([box('b', 0, 0), box('a', 5, 0), box('c', 70, 0)])].sort()).toEqual(['a', 'c']);
  });

  it('touching edges do not collide, a gap pushes them apart', () => {
    const pair = [box('a', 0, 0), box('b', 60, 0)];
    expect(placeLabels(pair).size).toBe(2);
    expect(placeLabels(pair, 4).size).toBe(1);
  });
});

describe('paged lists', () => {
  const row = (id: string, group = id) => ({ id, group });
  const ids = (pages: { id: string }[][]) => pages.map((p) => p.map((r) => r.id));

  it('cuts plain rows into pages of the given size', () => {
    const rows = ['a', 'b', 'c', 'd', 'e'].map((id) => row(id));
    expect(ids(pageRows(rows, 2))).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
    expect(ids(pageRows(rows, 5))).toEqual([['a', 'b', 'c', 'd', 'e']]);
  });

  it('has no pages for no rows, and treats a size below one as one', () => {
    expect(pageRows([], 4)).toEqual([]);
    expect(ids(pageRows([row('a'), row('b')], 0))).toEqual([['a'], ['b']]);
  });

  it('never splits a callout from its Hard spots', () => {
    const rows = [row('a'), row('b'), row('b1', 'b'), row('b2', 'b'), row('c')];
    expect(ids(pageRows(rows, 3))).toEqual([['a'], ['b', 'b1', 'b2'], ['c']]);
    expect(ids(pageRows(rows, 4))).toEqual([['a', 'b', 'b1', 'b2'], ['c']]);
    expect(ids(pageRows(rows, 5))).toEqual([['a', 'b', 'b1', 'b2', 'c']]);
  });

  it('splits a group only when it is longer than a page by itself', () => {
    const rows = [row('a'), row('b', 'g'), row('b1', 'g'), row('b2', 'g'), row('b3', 'g'), row('b4', 'g'), row('c')];
    expect(ids(pageRows(rows, 2))).toEqual([['a'], ['b', 'b1'], ['b2', 'b3'], ['b4', 'c']]);
  });
});

describe('the picker grid', () => {
  it('gives ten cards a 5 x 2 grid on a wide desktop', () => {
    const g = bestGrid(10, 1200, 560, 12, 150, 150, 1.15);
    expect(g).toMatchObject({ cols: 5, rows: 2 });
    expect(g?.w).toBeCloseTo((1200 - 4 * 12) / 5);
  });

  it('uses as many rows as it needs on a tall narrow window', () => {
    const g = bestGrid(10, 330, 560, 8, 150, 50, 2.4);
    expect(g?.cols).toBe(2);
    expect(g?.rows).toBe(5);
  });

  it('holds eleven cards (ten maps and the development map) without scrolling', () => {
    const g = bestGrid(11, 1200, 560, 12, 150, 150, 1.15);
    expect(g && g.cols * g.rows >= 11).toBe(true);
    expect(g && g.rows).toBeLessThanOrEqual(3);
  });

  it('returns null when the cards would be smaller than the minimum', () => {
    expect(bestGrid(10, 300, 300, 8, 150, 150, 1.15)).toBeNull();
    expect(bestGrid(1, 100, 100, 8, 150, 150, 1.15)).toBeNull();
  });

  it('copes with a single card', () => {
    expect(bestGrid(1, 400, 300, 8, 100, 100, 1.15)).toMatchObject({ cols: 1, rows: 1, w: 400, h: 300 });
  });
});

import { describe, expect, it } from 'vitest';
import { createCallout, paintAreas, regenerate, setPlan, updateCallout, type EditorDoc } from './doc';
import { buildNavIndex } from './nav';
import { captureManifest, coneTriangle, EYE, proposeShots, regionsInCone, yawTo } from './shotplan';
import { emptyDoc, gridIds, makeGridMesh } from './test-fixtures';

// a 14 by 14 field of 100-unit areas, at height 8
const { mesh, ids } = makeGridMesh({ cols: 14, rows: 14, z: 8 });
const nav = buildNavIndex(mesh, [{ id: 'default' }]);
const cells = (c0: number, r0: number, c1: number, r1: number) => {
  const out: string[] = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push(`${c},${r}`);
  return out;
};
function callout(doc: EditorDoc, name: string, area: string[], tier: 1 | 2 | 3 = 2) {
  const made = createCallout(doc, name, { tier });
  const painted = regenerate(paintAreas(made.doc, made.id, gridIds(ids, ...area), 'add').doc, nav, [made.id]).doc;
  return { doc: updateCallout(painted, made.id, { blurb: 'x' }), id: made.id };
}

describe('yawTo', () => {
  it('is degrees counter-clockwise from +x, in (-180, 180]', () => {
    expect(yawTo([0, 0], [10, 0])).toBe(0);
    expect(yawTo([0, 0], [0, 10])).toBe(90);
    expect(yawTo([0, 0], [-10, 0])).toBe(180);
    expect(yawTo([0, 0], [0, -10])).toBe(-90);
  });
});

describe('proposeShots for a standard callout', () => {
  const { doc, id } = callout(emptyDoc(), 'Middle', cells(5, 6, 8, 7)); // 400 by 200, long axis along x
  const c = doc.callouts.find((x) => x.id === id)!;
  const shots = proposeShots(c, doc, { callouts: doc.callouts, nav });
  const by = (kind: string) => shots.filter((s) => s.kind === kind);

  it('offers an inside shot along the long axis, at eye height on the floor under the label', () => {
    expect(by('inside')).toHaveLength(1);
    const inside = by('inside')[0]!;
    expect(inside.pos[0]).toBe(c.anchor[0]);
    expect(inside.pos[1]).toBe(c.anchor[1]);
    expect(inside.pos[2]).toBe(8 + EYE);
    expect(Math.abs(inside.yaw) === 0 || Math.abs(inside.yaw) === 180).toBe(true);
  });

  it('offers an approach and an alternate from different sides, each looking at the label', () => {
    expect(by('approach')).toHaveLength(1);
    expect(by('alternate')).toHaveLength(1);
    for (const s of [by('approach')[0]!, by('alternate')[0]!]) {
      expect(Math.abs(yawTo([s.pos[0], s.pos[1]], c.anchor) - s.yaw)).toBeLessThan(0.2);
      const d = Math.hypot(s.pos[0] - c.anchor[0], s.pos[1] - c.anchor[1]);
      expect(d).toBeGreaterThanOrEqual(250);
      expect(d).toBeLessThanOrEqual(800);
    }
    const back = (s: (typeof shots)[number]) => yawTo(c.anchor, [s.pos[0], s.pos[1]]);
    const gap = Math.abs(back(by('approach')[0]!) - back(by('alternate')[0]!)) % 360;
    expect(Math.min(gap, 360 - gap)).toBeGreaterThan(90);
  });

  it('keeps every vantage point outside the callout itself, so the callout is what you look at', () => {
    for (const s of shots.filter((x) => x.kind !== 'inside')) {
      expect(s.pos[0] < 500 || s.pos[0] > 900 || s.pos[1] < 600 || s.pos[1] > 800).toBe(true);
    }
  });

  it('meets the three-shot minimum (SCOPE §3.5)', () => {
    expect(shots.length).toBeGreaterThanOrEqual(3);
  });

  it('adds a wider overview for a large callout, looking slightly down', () => {
    const big = callout(emptyDoc(), 'Site', cells(4, 4, 9, 9));
    const s = proposeShots(big.doc.callouts[0]!, big.doc, { callouts: big.doc.callouts, nav });
    const overview = s.filter((x) => x.kind === 'overview');
    expect(overview).toHaveLength(1);
    expect(overview[0]!.pitch).toBeLessThan(0);
  });

  it('proposes nothing for a callout with no region', () => {
    const bare = createCallout(emptyDoc(), 'Bare');
    expect(proposeShots(bare.doc.callouts[0]!, bare.doc, { callouts: bare.doc.callouts, nav })).toEqual([]);
  });
});

describe('proposeShots for a Hard spot', () => {
  it('offers a close-up and a wider shot (two, the Hard minimum)', () => {
    const parent = callout(emptyDoc(), 'Parent', cells(4, 4, 9, 9));
    const spot = callout(parent.doc, 'Spot', ['6,6'], 3);
    const c = spot.doc.callouts.find((x) => x.id === spot.id)!;
    const shots = proposeShots(c, spot.doc, { callouts: spot.doc.callouts, nav });
    expect(shots.map((s) => s.kind)).toEqual(['approach', 'overview']);
    const [close, wide] = shots.map((s) => Math.hypot(s.pos[0] - c.anchor[0], s.pos[1] - c.anchor[1]));
    expect(close).toBeLessThan(wide!);
    expect(close).toBeGreaterThanOrEqual(100);
  });
});

describe('regionsInCone', () => {
  const square = (x: number, y: number, s = 100) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]] as [number, number][];
  const regions = [
    { id: 'ahead', polygon: square(400, -50) },
    { id: 'behind', polygon: square(-500, -50) },
    { id: 'wide', polygon: square(300, 700) },
    { id: 'beyond', polygon: square(5000, -50) },
    { id: 'around', polygon: square(-100000, -100000, 200000) },
  ];

  it('finds what is in the view, not what is behind, off to the side or out of range', () => {
    expect(regionsInCone([0, 0], 0, regions)).toEqual(['ahead', 'around']);
    expect(regionsInCone([0, 0], 180, regions)).toEqual(['behind', 'around']);
    expect(regionsInCone([0, 0], 90, regions)).toEqual(['wide', 'around']);
  });

  it('counts a region the camera stands in, and one that only the edge of the view clips', () => {
    expect(regionsInCone([450, 0], 180, [{ id: 'here', polygon: square(400, -50) }])).toEqual(['here']);
    const [, left] = coneTriangle([0, 0], 0, 1800);
    const edge = { id: 'edge', polygon: [[left[0] - 20, left[1] - 20], [left[0] + 20, left[1] - 20], [left[0], left[1] + 20]] as [number, number][] };
    expect(regionsInCone([0, 0], 0, [edge])).toEqual(['edge']);
  });

  it('ignores a region that is not a polygon yet', () => {
    expect(regionsInCone([0, 0], 0, [{ id: 'empty', polygon: [] }])).toEqual([]);
  });
});

describe('captureManifest', () => {
  it('lists every planned shot in the capture driver’s shape, one after another', () => {
    const one = callout(emptyDoc(), 'One', cells(0, 0, 1, 1));
    const two = callout(one.doc, 'Two', cells(5, 5, 6, 6));
    let d = setPlan(two.doc, one.id, [
      { pos: [10, 20, 68], yaw: 90, pitch: 0, stance: 'stand', kind: 'inside' },
      { pos: [30, 40, 68], yaw: -90, pitch: -8, stance: 'crouch', kind: 'overview' },
    ]);
    d = setPlan(d, two.id, [{ pos: [1, 2, 3], yaw: 0, pitch: 0, stance: 'stand', kind: 'approach' }]);
    const m = captureManifest(d);
    expect(m.map).toBe('de_grid');
    expect(m.shots.map((s) => s.n)).toEqual([1, 2, 3]);
    expect(m.shots[1]).toEqual({ n: 2, id: 'grid.one', kind: 'overview', stance: 'crouch', pose: { x: 30, y: 40, z: 68, pitch: -8, yaw: -90, title: 'grid.one-overview-2' }, note: 'retake planned' });
    expect(m.shots[2]!.pose.title).toBe('grid.two-approach-1');
  });
});

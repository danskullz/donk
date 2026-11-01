import { describe, expect, it } from 'vitest';
import { pointInPolygon } from '../geometry';
import {
  addZone, checkDoc, createCallout, deleteCallout, DraftCalloutSchema, exportDoc, loadDoc, moveAnchor, moveZone, neighbourSuggestions, paintAreas, regenerate,
  removeZone, renameZone, setNeighbour, setPlan, setPolygon, slugify, toWork, updateCallout, WorkFileSchema, type EditorDoc,
} from './doc';
import { buildNavIndex } from './nav';
import { emptyDoc, gridIds, makeGridMap, makeGridMesh } from './test-fixtures';

const { mesh, ids } = makeGridMesh({ cols: 8, rows: 4 });
const nav = buildNavIndex(mesh, [{ id: 'default' }]);
const a = (...names: string[]) => gridIds(ids, ...names);

/** A finished callout: named, painted, with a blurb. */
function finished(doc: EditorDoc, name: string, cells: string[], extra: Parameters<typeof updateCallout>[2] = {}): { doc: EditorDoc; id: string } {
  const made = createCallout(doc, name);
  let d = paintAreas(made.doc, made.id, a(...cells), 'add').doc;
  d = regenerate(d, nav, [made.id]).doc;
  d = updateCallout(d, made.id, { blurb: `${name} on the grid.`, ...extra });
  return { doc: d, id: made.id };
}

describe('slugify', () => {
  it('makes ids from names', () => {
    expect(slugify("Top Mid")).toBe('top-mid');
    expect(slugify("T's  Café / Ramp!")).toBe('ts-cafe-ramp');
    expect(slugify('  ')).toBe('');
  });
});

describe('createCallout', () => {
  it('starts a draft in the first zone, with an id from the map and the name', () => {
    const { doc, id } = createCallout(emptyDoc(), ' Top Mid ');
    expect(id).toBe('grid.top-mid');
    expect(doc.callouts[0]).toMatchObject({ name: 'Top Mid', zone: 'west', tier: 2, level: 'default', region: [], blurb: '', status: 'draft', neighbours: [], parent: null });
  });
  it('never reuses an id, even for the same name', () => {
    let doc = emptyDoc();
    const ids2 = [1, 2, 3].map(() => {
      const r = createCallout(doc, 'Palace');
      doc = r.doc;
      return r.id;
    });
    expect(ids2).toEqual(['grid.palace', 'grid.palace-2', 'grid.palace-3']);
  });
});

describe('updateCallout', () => {
  const base = createCallout(emptyDoc(), 'Mid');
  it('trims, and cleans the aliases', () => {
    const d = updateCallout(base.doc, base.id, { name: '  Middle  ', aliases: [' Mid ', 'mid', '', 'Centre', 'centre'], gameplaceName: '   ' });
    expect(d.callouts[0]).toMatchObject({ name: 'Middle', aliases: ['Mid', 'Centre'], gameplaceName: null });
  });
  it('lets a Hard spot have a parent and takes it away when the tier goes up', () => {
    let d = updateCallout(base.doc, base.id, { tier: 3, parent: 'grid.other' });
    expect(d.callouts[0]).toMatchObject({ tier: 3, parent: 'grid.other' });
    d = updateCallout(d, base.id, { tier: 2 });
    expect(d.callouts[0]!.parent).toBeNull();
  });
  it('can remove the route order', () => {
    let d = updateCallout(base.doc, base.id, { order: 3 });
    expect(d.callouts[0]!.order).toBe(3);
    d = updateCallout(d, base.id, { order: undefined });
    expect('order' in d.callouts[0]!).toBe(false);
  });
  it('does not change the id when the name changes', () => {
    expect(updateCallout(base.doc, base.id, { name: 'Something else' }).callouts[0]!.id).toBe('grid.mid');
  });
});

describe('neighbours', () => {
  let doc = emptyDoc();
  const ids3 = ['One', 'Two', 'Three', 'Four', 'Five', 'Six'].map((n) => {
    const r = createCallout(doc, n);
    doc = r.doc;
    return r.id;
  });
  const [one, two, three, four, five, six] = ids3 as [string, string, string, string, string, string];

  it('are linked both ways, and unlinked both ways', () => {
    const on = setNeighbour(doc, one, two, true);
    expect(on.error).toBeNull();
    expect(on.doc.callouts.find((c) => c.id === one)!.neighbours).toEqual([two]);
    expect(on.doc.callouts.find((c) => c.id === two)!.neighbours).toEqual([one]);
    const off = setNeighbour(on.doc, two, one, false);
    expect(off.doc.callouts.every((c) => c.neighbours.length === 0)).toBe(true);
  });
  it('stop at four, for either side, and say whose list is full', () => {
    let d = doc;
    for (const other of [two, three, four, five]) d = setNeighbour(d, one, other, true).doc;
    const over = setNeighbour(d, one, six, true);
    expect(over.error).toBe('One already has 4 neighbours');
    expect(over.doc).toBe(d);
    const other = setNeighbour(d, six, one, true);
    expect(other.error).toBe('One already has 4 neighbours');
  });
  it('refuse a callout being its own neighbour', () => {
    expect(setNeighbour(doc, one, one, true).error).not.toBeNull();
  });
  it('are removed when a callout is deleted, together with its paint and plan', () => {
    let d = setNeighbour(doc, one, two, true).doc;
    d = { ...d, paint: { [two]: [1, 2] }, plan: { [two]: [{ pos: [0, 0, 0], yaw: 0, pitch: 0, stance: 'stand', kind: 'inside' }] } };
    d = deleteCallout(d, two);
    expect(d.callouts.find((c) => c.id === one)!.neighbours).toEqual([]);
    expect(d.paint[two]).toBeUndefined();
    expect(d.plan[two]).toBeUndefined();
  });
  it('turn a Hard spot loose when its parent is deleted', () => {
    let d = updateCallout(doc, two, { tier: 3, parent: one });
    d = deleteCallout(d, one);
    expect(d.callouts.find((c) => c.id === two)!.parent).toBeNull();
  });
});

describe('painting', () => {
  const two = (() => {
    let doc = emptyDoc();
    const x = createCallout(doc, 'X');
    doc = x.doc;
    const y = createCallout(doc, 'Y');
    return { doc: y.doc, x: x.id, y: y.id };
  })();

  it('adds areas, sorted and without repeats, and removes them', () => {
    let r = paintAreas(two.doc, two.x, a('1,0', '0,0', '1,0'), 'add');
    expect(r.doc.paint[two.x]).toEqual(a('0,0', '1,0').sort((p, q) => p - q));
    expect(r.touched).toEqual([two.x]);
    r = paintAreas(r.doc, two.x, a('0,0'), 'remove');
    expect(r.doc.paint[two.x]).toEqual(a('1,0'));
  });

  it('takes areas from another callout only when told to, and says who lost some', () => {
    const base = paintAreas(two.doc, two.x, a('0,0', '1,0'), 'add').doc;
    const gentle = paintAreas(base, two.y, a('1,0', '2,0'), 'add');
    expect(gentle.doc.paint[two.y]).toEqual(a('2,0'));
    expect(gentle.doc.paint[two.x]).toEqual(a('0,0', '1,0').sort((p, q) => p - q));
    const rough = paintAreas(base, two.y, a('1,0', '2,0'), 'add', { steal: true });
    expect(rough.doc.paint[two.y]).toEqual(a('1,0', '2,0').sort((p, q) => p - q));
    expect(rough.doc.paint[two.x]).toEqual(a('0,0'));
    expect(rough.touched.sort()).toEqual([two.x, two.y].sort());
  });

  it('lets a Hard spot lie on its parent without taking areas from it, but not on another Hard spot', () => {
    let d = paintAreas(two.doc, two.x, a('0,0', '1,0'), 'add').doc;
    const hard1 = createCallout(d, 'Hard 1', { tier: 3 });
    d = hard1.doc;
    const hard2 = createCallout(d, 'Hard 2', { tier: 3 });
    d = hard2.doc;
    d = paintAreas(d, hard1.id, a('1,0'), 'add', { steal: true }).doc;
    expect(d.paint[two.x]).toEqual(a('0,0', '1,0').sort((p, q) => p - q));
    d = paintAreas(d, hard2.id, a('1,0'), 'add', { steal: true }).doc;
    expect(d.paint[hard1.id]).toEqual([]);
  });
});

describe('regenerate', () => {
  it('gives a callout a region, a label point inside it and its level', () => {
    const made = createCallout(emptyDoc(), 'Block');
    const painted = paintAreas(made.doc, made.id, a('1,1', '2,1', '1,2', '2,2'), 'add').doc;
    const { doc, dropped } = regenerate(painted, nav, [made.id]);
    const c = doc.callouts[0]!;
    expect(c.region).toHaveLength(4);
    expect(pointInPolygon(c.anchor, c.region)).toBe(true);
    expect(c.anchor).toEqual([200, 200]);
    expect(c.level).toBe('default');
    expect(dropped[made.id]).toBe(0);
  });

  it('keeps a label point that was moved, while it is still inside', () => {
    const made = createCallout(emptyDoc(), 'Block');
    let d = regenerate(paintAreas(made.doc, made.id, a('0,0', '1,0', '2,0'), 'add').doc, nav, [made.id]).doc;
    d = moveAnchor(d, made.id, [260.04, 40]);
    d = regenerate(paintAreas(d, made.id, a('3,0'), 'add').doc, nav, [made.id]).doc;
    expect(d.callouts[0]!.anchor).toEqual([260, 40]);
    // paint away the part it was in, and it moves
    d = regenerate(paintAreas(d, made.id, a('2,0', '3,0'), 'remove').doc, nav, [made.id]).doc;
    expect(pointInPolygon(d.callouts[0]!.anchor, d.callouts[0]!.region)).toBe(true);
  });

  it('puts the label in the biggest area when the middle of an L is outside it', () => {
    const made = createCallout(emptyDoc(), 'L');
    const d = regenerate(paintAreas(made.doc, made.id, a('0,0', '1,0', '2,0', '3,0', '0,1', '0,2', '0,3'), 'add').doc, nav, [made.id]).doc;
    expect(pointInPolygon(d.callouts[0]!.anchor, d.callouts[0]!.region)).toBe(true);
  });

  it('removes the region and the paint entry when everything is painted away', () => {
    const made = createCallout(emptyDoc(), 'Gone');
    let d = regenerate(paintAreas(made.doc, made.id, a('0,0'), 'add').doc, nav, [made.id]).doc;
    d = regenerate(paintAreas(d, made.id, a('0,0'), 'remove').doc, nav, [made.id]).doc;
    expect(d.callouts[0]!.region).toEqual([]);
    expect(d.paint[made.id]).toBeUndefined();
  });

  it('reports holes and loose pieces that were left out', () => {
    const made = createCallout(emptyDoc(), 'Pieces');
    const d = paintAreas(made.doc, made.id, a('0,0', '1,0', '0,1', '1,1', '6,3'), 'add').doc;
    expect(regenerate(d, nav, [made.id]).dropped[made.id]).toBe(1);
  });

  it('only touches the callouts it is asked about', () => {
    const x = createCallout(emptyDoc(), 'X');
    const y = createCallout(x.doc, 'Y');
    let d = paintAreas(paintAreas(y.doc, x.id, a('0,0'), 'add').doc, y.id, a('5,0'), 'add').doc;
    d = regenerate(d, nav, [x.id]).doc;
    expect(d.callouts.find((c) => c.id === x.id)!.region).toHaveLength(4);
    expect(d.callouts.find((c) => c.id === y.id)!.region).toEqual([]);
  });
});

describe('setPolygon', () => {
  it('draws a region by hand and drops the paint that it replaces', () => {
    const made = createCallout(emptyDoc(), 'Hand');
    let d = regenerate(paintAreas(made.doc, made.id, a('0,0'), 'add').doc, nav, [made.id]).doc;
    d = setPolygon(d, made.id, [[10.04, 10], [90, 10], [90, 90], [10, 90]]);
    expect(d.paint[made.id]).toBeUndefined();
    expect(d.callouts[0]!.region[0]).toEqual([10, 10]);
    expect(pointInPolygon(d.callouts[0]!.anchor, d.callouts[0]!.region)).toBe(true);
  });
});

describe('neighbourSuggestions', () => {
  it('lists painted callouts that touch this one, the longest shared edge first, and leaves out Hard spots', () => {
    let { doc, id } = finished(emptyDoc(), 'Left', ['0,0', '1,0', '0,1', '1,1']);
    const right = finished(doc, 'Right', ['2,0', '2,1', '3,0', '3,1']);
    const corner = finished(right.doc, 'Corner', ['0,2']);
    const far = finished(corner.doc, 'Far', ['6,3']);
    const hard = createCallout(far.doc, 'Spot', { tier: 3 });
    doc = paintAreas(hard.doc, hard.id, a('1,0'), 'add').doc;
    const list = neighbourSuggestions(doc, id, nav);
    expect(list.map((s) => s.id)).toEqual([right.id, corner.id]);
    expect(list[0]!.contact).toBe(200);
    expect(list[1]!.contact).toBe(100);
    expect(neighbourSuggestions(doc, hard.id, nav)).toEqual([]);
  });
});

describe('zones', () => {
  const doc = emptyDoc();
  it('can be added, renamed and reordered', () => {
    const { doc: d, id } = addZone(doc, 'Mid Lane');
    expect(id).toBe('mid-lane');
    expect(addZone(d, 'Mid Lane').id).toBe('mid-lane-2');
    expect(renameZone(d, id, ' Middle ').map.zones.at(-1)).toEqual({ id: 'mid-lane', name: 'Middle' });
    expect(moveZone(d, id, -1).map.zones.map((z) => z.id)).toEqual(['west', 'mid-lane', 'east']);
    expect(moveZone(d, 'west', -1)).toBe(d);
    expect(moveZone(d, id, 1)).toBe(d);
  });
  it('can only be removed when empty, and never the last', () => {
    const made = createCallout(doc, 'In West', { zone: 'west' });
    expect(removeZone(made.doc, 'west').error).toMatch(/still in this zone/);
    expect(removeZone(made.doc, 'east').doc.map.zones.map((z) => z.id)).toEqual(['west']);
    const one = removeZone(doc, 'east').doc;
    expect(removeZone(one, 'west').error).toMatch(/at least one/);
  });
});

describe('export', () => {
  it('writes the finished callouts, in zone then tier then route order, and lists the rest with a reason', () => {
    let { doc, id: a1 } = finished(emptyDoc(), 'Beta', ['0,0'], { zone: 'east', order: 2 });
    const first = finished(doc, 'Alpha', ['1,0'], { zone: 'east', order: 1 });
    const west = finished(first.doc, 'Zed', ['2,0'], { zone: 'west' });
    const noBlurb = createCallout(west.doc, 'No Blurb');
    const painted = regenerate(paintAreas(noBlurb.doc, noBlurb.id, a('3,0'), 'add').doc, nav, [noBlurb.id]).doc;
    const bare = createCallout(painted, 'Bare');
    doc = bare.doc;
    const out = exportDoc(doc);
    expect(out.callouts.map((c) => c.id)).toEqual([west.id, first.id, a1]);
    expect(out.unfinished).toEqual([
      { id: noBlurb.id, reasons: ['no blurb yet'] },
      { id: bare.id, reasons: expect.arrayContaining(['no region yet: paint or draw one', 'no blurb yet']) },
    ]);
  });

  it('leaves out links to unfinished callouts, and Hard spots whose parent is unfinished', () => {
    let { doc, id } = finished(emptyDoc(), 'Done', ['0,0']);
    const pending = createCallout(doc, 'Pending');
    doc = setNeighbour(pending.doc, id, pending.id, true).doc;
    const spot = finished(doc, 'Spot', ['0,0'], { tier: 3, parent: pending.id });
    const out = exportDoc(spot.doc);
    expect(out.callouts.map((c) => c.id)).toEqual([id]);
    expect(out.callouts[0]!.neighbours).toEqual([]);
    expect(out.unfinished.map((u) => u.id)).toContain(spot.id);
    // the work file still has the link
    expect(spot.doc.callouts.find((c) => c.id === id)!.neighbours).toEqual([pending.id]);
  });

  it('writes keys in the schema order', () => {
    const { doc } = finished(emptyDoc(), 'Keys', ['0,0'], { order: 1 });
    expect(Object.keys(exportDoc(doc).callouts[0]!)).toEqual(['id', 'map', 'name', 'aliases', 'zone', 'tier', 'level', 'region', 'anchor', 'parent', 'gameplaceName', 'blurb', 'neighbours', 'shots', 'status', 'order']);
  });
});

describe('checkDoc', () => {
  it('reports what the content validator would, and what is not in the file yet', () => {
    const { doc } = finished(emptyDoc(), 'Tiny', ['0,0']);
    const withPending = createCallout(doc, 'Pending').doc;
    const issues = checkDoc(withPending);
    expect(issues.some((i) => i.severity === 'warning' && i.rule === 'unfinished' && i.callout === 'grid.pending')).toBe(true);
    // a finished draft with no shots is flagged by the shot minimum, as `pnpm content:validate` flags it
    expect(issues.some((i) => i.callout === 'grid.tiny' && /shot/i.test(i.message))).toBe(true);
  });
});

describe('the work file', () => {
  const map = makeGridMap();
  it('keeps paint, plan and unfinished callouts, and reads back the same', () => {
    let { doc, id } = finished(emptyDoc(), 'Kept', ['0,0', '1,0']);
    doc = createCallout(doc, 'Unfinished').doc;
    doc = setPlan(doc, id, [{ pos: [50, 50, 60], yaw: 90, pitch: 0, stance: 'stand', kind: 'inside' }]);
    const work = WorkFileSchema.parse(JSON.parse(JSON.stringify(toWork(doc))));
    const content = exportDoc(doc).callouts;
    const loaded = loadDoc(map, content, work);
    expect(loaded.notices).toEqual([]);
    expect(loaded.doc.callouts.map((c) => c.id)).toEqual(doc.callouts.map((c) => c.id));
    expect(loaded.doc.paint).toEqual(doc.paint);
    expect(loaded.doc.plan).toEqual(doc.plan);
  });

  it('opens a map that has no work file from the content alone', () => {
    const { doc } = finished(emptyDoc(), 'Plain', ['0,0']);
    const loaded = loadDoc(map, exportDoc(doc).callouts, null);
    expect(loaded.doc.callouts).toHaveLength(1);
    expect(loaded.doc.paint).toEqual({});
  });

  it('prefers the content file when it was edited by hand, and says so, keeping unfinished callouts', () => {
    let { doc, id } = finished(emptyDoc(), 'Edited', ['0,0']);
    doc = createCallout(doc, 'Unfinished').doc;
    const work = toWork(doc);
    const content = exportDoc(doc).callouts.map((c) => ({ ...c, blurb: 'Changed by hand.' }));
    const loaded = loadDoc(map, content, work);
    expect(loaded.notices[0]).toMatch(/changed outside the editor/);
    expect(loaded.doc.callouts.find((c) => c.id === id)!.blurb).toBe('Changed by hand.');
    expect(loaded.doc.callouts.map((c) => c.id)).toContain('grid.unfinished');
    expect(loaded.doc.paint[id]).toBeDefined();
  });

  it('drops a finished callout that was deleted from the content file by hand', () => {
    const one = finished(emptyDoc(), 'One', ['0,0']);
    const two = finished(one.doc, 'Two', ['1,0']);
    const loaded = loadDoc(map, exportDoc(one.doc).callouts, toWork(two.doc));
    expect(loaded.doc.callouts.map((c) => c.id)).toEqual([one.id]);
    expect(loaded.doc.paint[two.id]).toBeUndefined();
  });

  it('warns when the painted ids belong to another game build', () => {
    const { doc } = finished(emptyDoc(), 'Old', ['0,0']);
    const work = toWork(doc);
    const loaded = loadDoc({ ...map, gameBuild: '2000' }, exportDoc(doc).callouts, work);
    expect(loaded.notices.some((n) => /game build 1000/.test(n))).toBe(true);
  });

  it('refuses unknown keys in a callout, so a typo cannot slip through', () => {
    const { doc } = finished(emptyDoc(), 'Typo', ['0,0']);
    expect(DraftCalloutSchema.safeParse({ ...doc.callouts[0], oops: 1 }).success).toBe(false);
    expect(DraftCalloutSchema.safeParse({ ...doc.callouts[0], region: [], blurb: '' }).success).toBe(true);
  });
});

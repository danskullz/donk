import { describe, expect, it } from 'vitest';
import { History } from './history';
import { stableJson } from './json';

describe('stableJson', () => {
  it('keeps numbers, points and small objects on one line and nests the rest', () => {
    const text = stableJson({
      id: 'x',
      aliases: ['a', 'b'],
      anchor: [1.5, 2],
      region: [[0, 0], [10, 0], [10, 10]],
      levels: [{ id: 'default' }],
      zones: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
      projection: { posX: -1, posY: 2, scale: 5 },
      shots: [{ file: 'x.avif', pos: [1, 2, 3], yaw: 0, kind: 'inside', captured: '2026-01-01', build: '1' }],
      empty: [],
      none: undefined,
    });
    expect(text).toBe(`{
  "id": "x",
  "aliases": ["a", "b"],
  "anchor": [1.5, 2],
  "region": [
    [0, 0],
    [10, 0],
    [10, 10]
  ],
  "levels": [{ "id": "default" }],
  "zones": [
    { "id": "a", "name": "A" },
    { "id": "b", "name": "B" }
  ],
  "projection": { "posX": -1, "posY": 2, "scale": 5 },
  "shots": [
    {
      "file": "x.avif",
      "pos": [1, 2, 3],
      "yaw": 0,
      "kind": "inside",
      "captured": "2026-01-01",
      "build": "1"
    }
  ],
  "empty": []
}
`);
  });

  it('reads back as the same value', () => {
    const value = { a: [[1, 2], [3, 4]], b: [{ id: 'q', n: 1 }], c: 'text "with" quotes', d: null, e: { f: [1, 2, 3], g: true } };
    expect(JSON.parse(stableJson(value))).toEqual(value);
  });

  it('puts a long list of strings on separate lines', () => {
    const list = Array.from({ length: 6 }, (_, i) => `mirage.some-long-callout-name-${i}`);
    expect(stableJson({ neighbours: list })).toContain('"neighbours": [\n    "mirage.some-long-callout-name-0"');
  });
});

describe('History', () => {
  it('undoes and redoes whole steps, and a new change forgets the redo branch', () => {
    const h = new History('a');
    h.commit('b');
    h.commit('c');
    expect(h.undo()).toBe('b');
    expect(h.undo()).toBe('a');
    expect(h.canUndo).toBe(false);
    expect(h.undo()).toBe('a');
    expect(h.redo()).toBe('b');
    h.commit('d');
    expect(h.canRedo).toBe(false);
    expect(h.undo()).toBe('b');
  });

  it('counts a stroke as one step however many changes it makes', () => {
    const h = new History(0);
    h.begin();
    h.replace(1);
    h.replace(2);
    h.commit(3); // commits inside a stroke are part of it
    h.end();
    expect(h.present).toBe(3);
    expect(h.undo()).toBe(0);
    expect(h.canUndo).toBe(false);
  });

  it('adds no step for a stroke that changed nothing, or for a commit of the same value', () => {
    const h = new History('x');
    h.begin();
    h.end();
    h.commit('x');
    expect(h.canUndo).toBe(false);
  });

  it('keeps only the newest steps up to its limit', () => {
    const h = new History(0, 3);
    for (let i = 1; i <= 10; i++) h.commit(i);
    let steps = 0;
    while (h.canUndo) {
      h.undo();
      steps += 1;
    }
    expect(steps).toBe(3);
    expect(h.present).toBe(7);
  });
});

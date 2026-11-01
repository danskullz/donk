import { describe, expect, it } from 'vitest';
import { compact, editDistance, gradeTyped, matchTyped, nameEntries, normalise, suggest, toleranceFor } from './match';

const callouts = [
  { id: 'mirage.palace', name: 'Palace', aliases: ['Pal', 'Palace Balcony'] },
  { id: 'mirage.ramp', name: 'Ramp', aliases: [] },
  { id: 'mirage.top-mid', name: 'Top Mid', aliases: ['Mid Top'] },
  { id: 'mirage.connector', name: 'Connector', aliases: ['Conn', "Jungle's Brother"] },
  { id: 'mirage.jungle', name: 'Jungle', aliases: [] },
  { id: 'mirage.ct', name: 'CT', aliases: [] },
  { id: 'mirage.cat', name: 'Cat', aliases: [] },
];
const entries = nameEntries(callouts);
const target = (id: string) => callouts.find((c) => c.id === id)!;

describe('normalise / compact', () => {
  it('ignores case, accents, punctuation and apostrophes', () => {
    expect(normalise("  Jungle's  BROTHER! ")).toBe('jungles brother');
    expect(normalise('Café-Mid')).toBe('cafe mid');
  });
  it('treats spaced, hyphenated and joined words as one answer', () => {
    expect(compact('Top Mid')).toBe('topmid');
    expect(compact('top-mid')).toBe('topmid');
    expect(compact('TOPMID')).toBe('topmid');
  });
});

describe('editDistance', () => {
  it('counts insert, delete, substitute and one adjacent swap as one edit each', () => {
    expect(editDistance('ramp', 'ramps')).toBe(1);
    expect(editDistance('ramp', 'rap')).toBe(1);
    expect(editDistance('ramp', 'rump')).toBe(1);
    expect(editDistance('ramp', 'rmap')).toBe(1);
    expect(editDistance('ramp', 'rmpa')).toBe(2);
    expect(editDistance('', 'abc')).toBe(3);
    expect(editDistance('same', 'same')).toBe(0);
  });
  it('scales tolerance with length', () => {
    expect(toleranceFor(3)).toBe(0);
    expect(toleranceFor(4)).toBe(1);
    expect(toleranceFor(20)).toBe(1);
  });
});

describe('gradeTyped', () => {
  it('accepts the name and every alias exactly', () => {
    expect(gradeTyped('palace', target('mirage.palace'), entries)).toMatchObject({ correct: true, fuzzy: false });
    expect(gradeTyped('PAL', target('mirage.palace'), entries)).toMatchObject({ correct: true, fuzzy: false });
    expect(gradeTyped('palace-balcony', target('mirage.palace'), entries)).toMatchObject({ correct: true, fuzzy: false });
    expect(gradeTyped('topmid', target('mirage.top-mid'), entries)).toMatchObject({ correct: true, fuzzy: false });
  });
  it('forgives one typo and says so', () => {
    const g = gradeTyped('conector', target('mirage.connector'), entries);
    expect(g).toMatchObject({ correct: true, fuzzy: true, spelling: 'Connector' });
  });
  it('rejects two typos', () => {
    expect(gradeTyped('conecter', target('mirage.connector'), entries).correct).toBe(false);
  });
  it('does not forgive typos in names of three letters or fewer', () => {
    expect(gradeTyped('ctt', target('mirage.ct'), entries).correct).toBe(false);
    expect(gradeTyped('ca', target('mirage.cat'), entries).correct).toBe(false);
  });
  it('reports which callout was named when the answer is another real callout', () => {
    const g = gradeTyped('jungle', target('mirage.connector'), entries);
    expect(g).toMatchObject({ correct: false, chosen: 'mirage.jungle' });
  });
  it('treats an exact match as winning over a nearby fuzzy one', () => {
    expect(gradeTyped('cat', target('mirage.cat'), entries)).toMatchObject({ correct: true, fuzzy: false });
  });
  it('is wrong and ambiguous when a typo is equally near two callouts', () => {
    const two = nameEntries([
      { id: 'a', name: 'Ramps', aliases: [] },
      { id: 'b', name: 'Camps', aliases: [] },
    ]);
    const m = matchTyped('Xamps', two);
    expect(m).toEqual({ outcome: 'none', ambiguous: true });
  });
  it('is wrong on empty or unrelated input', () => {
    expect(gradeTyped('', target('mirage.ramp'), entries)).toMatchObject({ correct: false, chosen: null });
    expect(gradeTyped('zzzzzz', target('mirage.ramp'), entries)).toMatchObject({ correct: false, chosen: null });
  });
});

describe('suggest', () => {
  it('lists prefix matches first, one row per callout showing its name, at most five', () => {
    const s = suggest('pal', entries);
    expect(s).toEqual([{ calloutId: 'mirage.palace', text: 'Palace' }]);
    expect(suggest('c', entries, 5).length).toBeLessThanOrEqual(5);
  });
  it('matches the second word and substrings', () => {
    expect(suggest('mid', entries).map((x) => x.calloutId)).toContain('mirage.top-mid');
    expect(suggest('onnec', entries).map((x) => x.calloutId)).toContain('mirage.connector');
  });
  it('forgives a typo at the start of a longer entry', () => {
    expect(suggest('conmec', entries).map((x) => x.calloutId)).toContain('mirage.connector');
  });
  it('offers nothing for empty input', () => {
    expect(suggest('   ', entries)).toEqual([]);
  });
});

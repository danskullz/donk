import { describe, expect, it } from 'vitest';
import { ArtFileSchema, firstLevelArt } from './artfile';

const file = { map: 'de_nuke', gameBuild: '26144732', levels: { default: 'M1 2l3 4 5 6z', lower: 'M0 0l1 1 1 -1z' } };
const map = (levels: string[]) => ({ id: 'de_nuke', levels: levels.map((id) => ({ id })) });

describe('ArtFileSchema', () => {
  it('accepts what the generator writes', () => {
    expect(ArtFileSchema.safeParse(file).success).toBe(true);
    expect(ArtFileSchema.safeParse({ ...file, levels: { default: 'M-.5 .5l1.5 -.5 -1 2z' } }).success).toBe(true);
  });
  it('rejects anything that is not path data, an unknown field and a bad map id', () => {
    expect(ArtFileSchema.safeParse({ ...file, levels: { default: '<script>' } }).success).toBe(false);
    expect(ArtFileSchema.safeParse({ ...file, levels: { default: 'l1 2z' } }).success).toBe(false);
    expect(ArtFileSchema.safeParse({ ...file, extra: 1 }).success).toBe(false);
    expect(ArtFileSchema.safeParse({ ...file, map: 'mirage' }).success).toBe(false);
    expect(ArtFileSchema.safeParse({ ...file, levels: { 'Not A Slug': 'M0 0z' } }).success).toBe(false);
  });
});

describe('firstLevelArt', () => {
  it("is the map record's first level", () => {
    expect(firstLevelArt(file, map(['default', 'lower']))).toBe('M1 2l3 4 5 6z');
    expect(firstLevelArt(file, map(['lower', 'default']))).toBe('M0 0l1 1 1 -1z');
  });
  it("falls back to the file's own first level when the record's first level has no art", () => {
    expect(firstLevelArt({ ...file, levels: { lower: 'M0 0l1 1 1 -1z' } }, map(['default', 'lower']))).toBe('M0 0l1 1 1 -1z');
  });
  it('is null for another map or an empty file', () => {
    expect(firstLevelArt({ ...file, map: 'de_mirage' }, map(['default']))).toBeNull();
    expect(firstLevelArt({ ...file, levels: {} }, map(['default']))).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { acceptedNames, displayName, otherName } from './naming';

const palace = { name: 'Palace', gameplaceName: 'PalaceBalcony', aliases: ['Pal'] };
const plain = { name: 'Mid', gameplaceName: null, aliases: ['Middle'] };
const same = { name: 'Connector', gameplaceName: 'connector', aliases: [] };

describe('displayName', () => {
  it('shows the community name, or the game name with "game names only"', () => {
    expect(displayName(palace, 'both')).toBe('Palace');
    expect(displayName(palace, 'community')).toBe('Palace');
    expect(displayName(palace, 'game')).toBe('PalaceBalcony');
    expect(displayName(plain, 'game')).toBe('Mid');
  });
});

describe('otherName', () => {
  it('offers the game name beside the community name only when they differ and both are shown', () => {
    expect(otherName(palace, 'both')).toBe('PalaceBalcony');
    expect(otherName(palace, 'community')).toBeNull();
    expect(otherName(plain, 'both')).toBeNull();
    expect(otherName(same, 'both')).toBeNull();
  });
});

describe('acceptedNames', () => {
  it('accepts everything by default, only community names and aliases, or only the game name', () => {
    expect(acceptedNames(palace, 'both')).toEqual(['Palace', 'Pal', 'PalaceBalcony']);
    expect(acceptedNames(palace, 'community')).toEqual(['Palace', 'Pal']);
    expect(acceptedNames(palace, 'game')).toEqual(['PalaceBalcony']);
  });
  it('falls back to the community names for a callout the game does not name', () => {
    expect(acceptedNames(plain, 'game')).toEqual(['Mid', 'Middle']);
    expect(acceptedNames(plain, 'both')).toEqual(['Mid', 'Middle']);
  });
  it('does not list a name twice', () => {
    expect(acceptedNames(same, 'both')).toEqual(['Connector']);
  });
});

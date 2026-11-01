import { describe, expect, it } from 'vitest';
import { entriesFor, gradeAnswer, makePrompt } from './quiz';
import { createDerived } from './log';
import { mulberry32 } from './rng';
import { presentCallout, presentCallouts } from './present';
import { makeCallouts } from './test-fixtures';
import { itemKey } from './types';

const palace = { ...makeCallouts().find((c) => c.id === 'test.palace')!, gameplaceName: 'PalaceBalcony' };

describe('presentCallout', () => {
  it('shows the community name with the game name beside it, and accepts both', () => {
    const p = presentCallout(palace, 'both');
    expect(p).toMatchObject({ name: 'Palace', gameplaceName: 'PalaceBalcony' });
    expect(p.aliases).toEqual(['Pal', 'PalaceBalcony']);
  });
  it('hides the game name with "community only", and does not accept it', () => {
    const p = presentCallout(palace, 'community');
    expect(p).toMatchObject({ name: 'Palace', gameplaceName: null, aliases: ['Pal'] });
  });
  it('shows only the game name with "game names only"', () => {
    const p = presentCallout(palace, 'game');
    expect(p).toMatchObject({ name: 'PalaceBalcony', gameplaceName: null, aliases: [] });
  });
  it('falls back to the community name for a place the game does not name', () => {
    const mid = makeCallouts().find((c) => c.id === 'test.mid')!;
    expect(presentCallout(mid, 'game')).toMatchObject({ name: 'Mid', aliases: ['Middle'], gameplaceName: null });
  });
  it('changes nothing but the names: ids, regions and shots stay', () => {
    const p = presentCallout(palace, 'game');
    expect({ ...p, name: palace.name, aliases: palace.aliases, gameplaceName: palace.gameplaceName }).toEqual(palace);
  });
  it('does not touch the original', () => {
    presentCallout(palace, 'game');
    expect(palace.name).toBe('Palace');
  });
});

describe('a typed question over presented callouts', () => {
  const grade = (naming: 'both' | 'community' | 'game', text: string) => {
    const shown = presentCallouts(
      makeCallouts().filter((c) => c.tier !== 3).map((c) => (c.id === 'test.palace' ? palace : c)),
      naming,
    );
    const card = { type: 'quiz' as const, calloutId: 'test.palace', mode: 'name-typed' as const, key: itemKey('test.palace', 'name-typed'), reason: 'due' as const, options: null };
    const prompt = makePrompt(card, { callouts: shown, derived: createDerived(), levels: ['default'], rng: mulberry32(1) });
    return gradeAnswer(prompt, { kind: 'typed', text }, { callouts: shown, entries: entriesFor(shown) });
  };
  it('accepts the game name unless the setting is community only', () => {
    expect(grade('both', 'PalaceBalcony').correct).toBe(true);
    expect(grade('community', 'PalaceBalcony').correct).toBe(false);
  });
  it('with game names only, the community name is no longer an answer', () => {
    expect(grade('game', 'PalaceBalcony').correct).toBe(true);
    expect(grade('game', 'Palace').correct).toBe(false);
  });
});

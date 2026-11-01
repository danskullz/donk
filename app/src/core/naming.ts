// Which of a callout's names are shown and accepted (SCOPE.md §3.3, §5.8). The community name is the canonical one; the
// game's own place name is recorded beside it. By default both are shown and both are accepted as typed answers.

import type { Callout } from './schema';

export type Naming = 'both' | 'community' | 'game';
type Named = Pick<Callout, 'name' | 'gameplaceName' | 'aliases'>;

/** The name to show as the callout's name. With "game names only" it is the game's name when there is one. */
export function displayName(c: Pick<Named, 'name' | 'gameplaceName'>, naming: Naming): string {
  return naming === 'game' && c.gameplaceName ? c.gameplaceName : c.name;
}

/**
 * The other name, when it differs: "the game calls it X" next to a community name. Null when there is nothing to add
 * or the setting hides it.
 */
export function otherName(c: Pick<Named, 'name' | 'gameplaceName'>, naming: Naming): string | null {
  if (!c.gameplaceName || c.gameplaceName.toLowerCase() === c.name.toLowerCase()) return null;
  return naming === 'both' ? c.gameplaceName : null;
}

/** Every text accepted as a typed answer for this callout under the setting, the displayed name first. */
export function acceptedNames(c: Named, naming: Naming): string[] {
  const out = [displayName(c, naming)];
  const add = (t: string | null | undefined) => {
    if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  };
  if (naming !== 'game') {
    add(c.name);
    c.aliases.forEach(add);
  }
  if (naming !== 'community') add(c.gameplaceName);
  if (naming === 'game' && !c.gameplaceName) {
    add(c.name);
    c.aliases.forEach(add);
  }
  return out;
}

// The callouts as the learner's naming setting shows them (SCOPE.md §3.3, §5.8). A session works on this presentation
// copy: `name` is the displayed name, `aliases` is every other text accepted as a typed answer, and `gameplaceName`
// is the second name to show beside it (or null). Every screen of the session then shows names without knowing about
// the setting, and the typed-answer matcher needs no change. Ids, regions and shots are untouched, so the review log
// (which stores ids only) is the same whatever the setting.

import { acceptedNames, displayName, otherName, type Naming } from './naming';
import type { Callout } from './schema';

export function presentCallout(c: Callout, naming: Naming): Callout {
  const accepted = acceptedNames(c, naming);
  const shown = displayName(c, naming);
  return {
    ...c,
    name: shown,
    // The displayed name is first in `accepted`; the rest are the other spellings that count as right.
    aliases: accepted.filter((t) => t.toLowerCase() !== shown.toLowerCase()),
    gameplaceName: otherName(c, naming),
  };
}

export function presentCallouts(list: readonly Callout[], naming: Naming): Callout[] {
  return list.map((c) => presentCallout(c, naming));
}

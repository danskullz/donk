// Small view helpers shared by the session screens. No Svelte here.

import type { Mode } from '../../core/types';

export const MODE_LABEL: Readonly<Record<Mode, string>> = {
  'name-mc': 'Name it',
  'read-map': 'Read the map',
  'which-view': 'Which view?',
  pin: 'Pin it',
  'name-typed': 'Name it · typed',
  'where-am-i': 'Where am I?',
  speed: 'Speed call',
};

export const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** Alt text for a screenshot while it is still the question: it must not describe, and so give away, the place. */
export const QUESTION_ALT = 'A first-person view from the game';

/**
 * Whether motion should be left out: the learner's own switch in Settings wins, "system" follows the browser. The CSS
 * reads the same setting through `data-motion` (styles/global.css); a screen that draws its own countdown needs the
 * answer in script as well.
 */
export function motionReduced(setting: 'system' | 'on' | 'off', systemPrefersReduced: boolean): boolean {
  return setting === 'on' || (setting === 'system' && systemPrefersReduced);
}

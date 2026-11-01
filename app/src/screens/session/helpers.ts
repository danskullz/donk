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

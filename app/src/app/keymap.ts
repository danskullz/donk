// Every key the app answers to, as the Keyboard tab of Settings shows them (SCOPE.md §5.4, §5.8). Plain data. The
// rows were written from the code that handles the keys (screens/Session.svelte, screens/session/AskTyped.svelte,
// components/RegionMap.svelte, screens/Settings.svelte); when a handler changes, this list is the place to say so.

export interface KeyRow {
  /** Each key on its own; shown as [key]. */
  keys: readonly string[];
  /** What it does, short enough for one line on a 360 px phone. */
  does: string;
}

export interface KeyGroup {
  id: 'session' | 'map' | 'settings';
  title: string;
  rows: readonly KeyRow[];
}

export const KEYMAP: readonly KeyGroup[] = [
  {
    id: 'session',
    title: 'In a session',
    rows: [
      { keys: ['1–4'], does: 'Choose that answer' },
      { keys: ['Enter'], does: 'Send a typed answer' },
      { keys: ['↑', '↓'], does: 'Move through suggestions' },
      { keys: ['Tab'], does: 'Fill in the suggestion' },
      { keys: ['Space', 'Enter'], does: 'Continue' },
      { keys: ['H'], does: 'Hint (Alt+H when typing)' },
      { keys: ['S'], does: 'Skip (Alt+S when typing)' },
      { keys: ['Esc'], does: 'End the session, all saved' },
    ],
  },
  {
    id: 'map',
    title: 'On a map',
    rows: [
      { keys: ['+', '-'], does: 'Zoom in, zoom out' },
      { keys: ['0'], does: 'Fit the whole map' },
      { keys: ['Tab', 'Enter'], does: 'Choose a region' },
    ],
  },
  {
    id: 'settings',
    title: 'In settings',
    rows: [
      { keys: ['←', '→'], does: 'Switch tabs' },
      { keys: ['Space'], does: 'Flip a switch' },
      { keys: ['Esc'], does: 'Leave settings' },
    ],
  },
];

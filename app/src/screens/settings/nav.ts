// Which settings tab (and which part of the Data tab) is open lives in the address, `#/settings?tab=data&part=offline`,
// so a reload or a shared link comes back to the same place. It is written with replaceState: changing tabs adds no
// history entries and does not fire `hashchange`, so the route does not reload.

import { DB_NAME, DEMO_DB_NAME } from '../../storage/idb-store';

export const TABS = ['session', 'hard', 'naming', 'display', 'keys', 'data'] as const;
export type TabId = (typeof TABS)[number];

export const PARTS = ['backup', 'progress', 'offline'] as const;
export type PartId = (typeof PARTS)[number];

export interface Nav {
  tab: TabId;
  part: PartId;
}

function params(): URLSearchParams {
  return new URLSearchParams(location.hash.split('?')[1] ?? '');
}

export function readNav(): Nav {
  const p = params();
  const tab = TABS.find((t) => t === p.get('tab')) ?? 'session';
  const part = PARTS.find((t) => t === p.get('part')) ?? 'backup';
  return { tab, part };
}

export function writeNav(nav: Nav): void {
  const q = new URLSearchParams({ tab: nav.tab });
  if (nav.tab === 'data' && nav.part !== 'backup') q.set('part', nav.part);
  history.replaceState(history.state, '', `${location.pathname}${location.search}#/settings?${q.toString()}`);
}

/** A question the screen asks before something that cannot be undone. Shown over the panel, one at a time. */
export interface ConfirmSpec {
  title: string;
  body: string;
  /** The button that does it, named for what it does: "Delete Mirage progress". */
  action: string;
  cancel: string;
  run: () => void | Promise<void>;
}

/** Where the review log lives for this page: the real one, or in development and e2e builds the synthetic map's. */
export function exportLogDb(): { name: string; demo: boolean } {
  const demoBuild = import.meta.env.DEV || import.meta.env.VITE_DEMO === '1';
  const demo = demoBuild && new URLSearchParams(location.search).get('log') === 'demo';
  return { name: demo ? DEMO_DB_NAME : DB_NAME, demo };
}

// Hand-off from the Session screen to the Summary screen (SCOPE.md §4.3 step 5). The summary is not stored in the
// review log (the answers are; the summary is derived), so it is kept here for the page's life. Reloading the Summary
// screen without a session shows "nothing to summarise".

import type { SessionSummary } from '../core/runner';
import type { SessionPlan } from '../core/session';

export interface LastSession {
  mapId: string;
  /** When the session ended, ms since the epoch. */
  at: number;
  summary: SessionSummary;
  /** Why a session was empty or short, if it was. */
  note: SessionPlan['note'];
  /** Callout id to display name, for the ids that appear in the summary. */
  names: Record<string, string>;
  /** How many callouts the map had that could be taught (0 means "no callouts yet"). */
  playable: number;
}

let last: LastSession | null = null;

export function setLastSession(session: LastSession): void {
  last = session;
}

/** The most recent session, or the most recent one for `mapId` when given (null if that map has none). */
export function getLastSession(mapId?: string): LastSession | null {
  return last && (mapId === undefined || last.mapId === mapId) ? last : null;
}

export function clearLastSession(): void {
  last = null;
}

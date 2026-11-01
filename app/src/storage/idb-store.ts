// The review log in IndexedDB (SCOPE.md §7.6): one append-only object store of immutable events, keyed by event
// id. Everything else the app knows about the learner is derived from it. This is the one file that touches
// the browser's storage API; the contract and the write queue are in core/store.ts.
//
// Beyond the session's store (`openReviewStore`) there are the Settings screen's operations on a whole log: read it
// without creating it, merge an import into it, and delete one map's events. Those open and close their own
// connection, so a finished import never leaves one open to block a later change.

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { ReviewEventSchema, type ReviewEvent } from '../core/log';
import type { LoadedLog, ReviewStore } from '../core/store';

export const DB_NAME = 'callouts';
/** The synthetic development map keeps its own log, so trying things out never touches real progress. */
export const DEMO_DB_NAME = 'callouts-demo';
const DB_VERSION = 1;

/** Which database holds the log of a map. */
export const logDbName = (demo: boolean): string => (demo ? DEMO_DB_NAME : DB_NAME);

interface CalloutsDB extends DBSchema {
  events: { key: string; value: ReviewEvent; indexes: { ts: number } };
}

function open(name: string): Promise<IDBPDatabase<CalloutsDB>> {
  return openDB<CalloutsDB>(name, DB_VERSION, {
    upgrade(upgrading) {
      const events = upgrading.createObjectStore('events', { keyPath: 'id' });
      events.createIndex('ts', 'ts');
    },
  });
}

/** Open a database only if it exists: reading a log must not create an empty one. */
async function openExisting(name: string): Promise<IDBPDatabase<CalloutsDB> | null> {
  try {
    const db = await openDB<CalloutsDB>(name, DB_VERSION, {
      upgrade(_db, _old, _new, tx) {
        tx.abort(); // it did not exist: stop the creation
      },
    });
    return db.objectStoreNames.contains('events') ? db : (db.close(), null);
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return null;
    throw e;
  }
}

function checkRows(rows: readonly unknown[]): LoadedLog {
  const events: ReviewEvent[] = [];
  let invalid = 0;
  for (const row of rows) {
    const parsed = ReviewEventSchema.safeParse(row);
    if (parsed.success) events.push(parsed.data);
    else invalid += 1;
  }
  return { events, invalid };
}

export async function openReviewStore(name: string = DB_NAME): Promise<ReviewStore> {
  const db = await open(name);

  // Ask the browser not to evict the log under storage pressure. It may say no; the log still works.
  try {
    void navigator.storage?.persist?.().catch(() => undefined);
  } catch {
    // no storage manager (private window, old browser): nothing to do
  }

  async function appendMany(list: readonly ReviewEvent[]): Promise<void> {
    if (list.length === 0) return;
    const tx = db.transaction('events', 'readwrite');
    await Promise.all([...list.map((e) => tx.store.put(e)), tx.done]);
  }

  return {
    async load(): Promise<LoadedLog> {
      const rows: unknown[] = await db.getAllFromIndex('events', 'ts');
      const loaded = checkRows(rows);
      if (loaded.invalid > 0) console.warn(`${loaded.invalid} stored review event(s) did not match the schema and were left out of this session`);
      return loaded;
    },
    append: (event) => appendMany([event]),
    appendMany,
    async clear() {
      await db.clear('events');
    },
  };
}

/** The whole log of a database, read without creating it. An unknown database is an empty log. */
export async function readEvents(name: string = DB_NAME): Promise<LoadedLog> {
  const db = await openExisting(name);
  if (!db) return { events: [], invalid: 0 };
  try {
    return checkRows(await db.getAllFromIndex('events', 'ts'));
  } finally {
    db.close();
  }
}

/**
 * Write the events whose id is not stored yet and return how many that was. A stored event is never replaced, so an
 * import can be repeated and cannot change history. Everything happens in one transaction: all of it or none.
 */
export async function addEventsIfNew(events: readonly ReviewEvent[], name: string = DB_NAME): Promise<number> {
  if (events.length === 0) return 0;
  const db = await open(name);
  try {
    const tx = db.transaction('events', 'readwrite');
    let written = 0;
    for (const event of events) {
      if ((await tx.store.getKey(event.id)) === undefined) {
        await tx.store.put(event);
        written += 1;
      }
    }
    await tx.done;
    return written;
  } finally {
    db.close();
  }
}

/**
 * Delete every event of one map, answers and intro cards alike, and return how many were removed. `prefix` is what
 * its callout ids start with, `mirage.` for Mirage (`calloutPrefix` in core/exportfile.ts). The match is on the whole
 * prefix including the dot, so `mirage.` never takes `mirage2.` with it. Rows that are not readable as events have no
 * callout id to match and stay, as everywhere else.
 */
export async function deleteEventsForMap(prefix: string, name: string = DB_NAME): Promise<number> {
  // An empty or partial prefix would delete other maps' progress; refuse it rather than trust the caller.
  if (!/^[a-z0-9_]+\.$/.test(prefix)) throw new Error(`not a callout prefix: "${prefix}"`);
  const db = await openExisting(name);
  if (!db) return 0;
  try {
    const tx = db.transaction('events', 'readwrite');
    let removed = 0;
    for (let cursor = await tx.store.openCursor(); cursor; cursor = await cursor.continue()) {
      const callout: unknown = (cursor.value as { callout?: unknown }).callout;
      if (typeof callout === 'string' && callout.startsWith(prefix)) {
        await cursor.delete();
        removed += 1;
      }
    }
    await tx.done;
    return removed;
  } finally {
    db.close();
  }
}

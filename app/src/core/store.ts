// Where the review log lives (SCOPE.md §7.6). The log is the only thing persisted for learning: scheduler state,
// mastery and confusions are rebuilt from it on every start. The browser implementation (IndexedDB) is in
// src/storage; this file holds the contract, an in-memory version for tests, and the write queue.

import type { ReviewEvent } from './log';

export interface LoadedLog {
  events: ReviewEvent[];
  /** Stored rows that no longer pass the schema. They are left in place, not deleted. */
  invalid: number;
}

export interface ReviewStore {
  load(): Promise<LoadedLog>;
  /** Writing an event whose id is already stored changes nothing, so imports can be repeated. */
  append(event: ReviewEvent): Promise<void>;
  appendMany(events: readonly ReviewEvent[]): Promise<void>;
  /** Forget everything (Settings → reset). */
  clear(): Promise<void>;
}

export function createMemoryStore(initial: readonly ReviewEvent[] = []): ReviewStore & { readonly events: ReviewEvent[] } {
  const events: ReviewEvent[] = [];
  const put = (e: ReviewEvent) => {
    if (!events.some((x) => x.id === e.id)) events.push(e);
  };
  initial.forEach(put);
  return {
    events,
    load: async () => ({ events: events.slice(), invalid: 0 }),
    append: async (e) => put(e),
    appendMany: async (list) => list.forEach(put),
    clear: async () => {
      events.length = 0;
    },
  };
}

export interface SaveStatus {
  /** Events handed over and not yet confirmed written. */
  pending: number;
  /** The last write failed; the events are kept and tried again with the next save or `retry`. */
  failing: boolean;
}

export interface Saver {
  save(event: ReviewEvent): void;
  /** Try again now. Resolves when the queue is empty or the attempt failed. */
  retry(): Promise<void>;
  /** Resolves when everything handed over so far has been written, or the write failed. */
  flush(): Promise<void>;
  readonly status: SaveStatus;
}

/**
 * Writes events in order without making the screen wait. A failed write is not lost: the events stay queued
 * and go out with the next attempt, and `status.failing` lets the screen say so.
 */
export function createSaver(store: ReviewStore, onStatus?: (status: SaveStatus) => void): Saver {
  const queue: ReviewEvent[] = [];
  const status: SaveStatus = { pending: 0, failing: false };
  let running: Promise<void> | null = null;

  const publish = () => {
    status.pending = queue.length;
    onStatus?.({ ...status });
  };

  async function drain(): Promise<void> {
    while (queue.length > 0) {
      const batch = queue.slice();
      try {
        await store.appendMany(batch);
      } catch {
        status.failing = true;
        publish();
        return;
      }
      queue.splice(0, batch.length);
      status.failing = false;
      publish();
    }
  }

  function kick(): Promise<void> {
    running ??= drain().finally(() => {
      running = null;
    });
    return running;
  }

  return {
    status,
    save(event) {
      queue.push(event);
      publish();
      void kick();
    },
    retry: () => kick(),
    flush: async () => {
      await kick();
    },
  };
}

import { describe, expect, it } from 'vitest';
import type { ReviewEvent } from './log';
import { createMemoryStore, createSaver, type ReviewStore } from './store';
import { answer, intro } from './test-helpers';
import { Grade } from './types';

const e1: ReviewEvent = answer('test.mid', 'name-mc', 1000, Grade.Good);
const e2: ReviewEvent = answer('test.mid', 'pin', 2000, Grade.Again);
const e3: ReviewEvent = intro('test.palace', 3000);

describe('the in-memory store', () => {
  it('keeps events in the order written and ignores an id it already has', async () => {
    const store = createMemoryStore();
    await store.append(e1);
    await store.appendMany([e2, e1, e3]);
    expect((await store.load()).events.map((e) => e.id)).toEqual([e1.id, e2.id, e3.id]);
  });

  it('starts from what it is given, and clears', async () => {
    const store = createMemoryStore([e1, e2]);
    expect((await store.load()).events).toHaveLength(2);
    await store.clear();
    expect((await store.load()).events).toEqual([]);
  });
});

/** A store whose writes fail until told otherwise. */
function flaky() {
  const inner = createMemoryStore();
  let broken = true;
  const store: ReviewStore = {
    ...inner,
    appendMany: async (list) => {
      if (broken) throw new Error('disk full');
      await inner.appendMany(list);
    },
  };
  return { store, inner, fix: () => (broken = false) };
}

describe('the saver', () => {
  it('writes saved events in order', async () => {
    const store = createMemoryStore();
    const saver = createSaver(store);
    saver.save(e1);
    saver.save(e2);
    saver.save(e3);
    await saver.flush();
    expect(store.events.map((e) => e.id)).toEqual([e1.id, e2.id, e3.id]);
    expect(saver.status).toEqual({ pending: 0, failing: false });
  });

  it('keeps events when a write fails, says so, and sends them with the next attempt', async () => {
    const { store, inner, fix } = flaky();
    const seen: { pending: number; failing: boolean }[] = [];
    const saver = createSaver(store, (s) => seen.push(s));
    saver.save(e1);
    await saver.flush();
    expect(saver.status).toEqual({ pending: 1, failing: true });
    expect(inner.events).toHaveLength(0);

    saver.save(e2);
    await saver.flush();
    expect(saver.status.failing).toBe(true);
    expect(saver.status.pending).toBe(2);

    fix();
    await saver.retry();
    expect(inner.events.map((e) => e.id)).toEqual([e1.id, e2.id]);
    expect(saver.status).toEqual({ pending: 0, failing: false });
    expect(seen.some((s) => s.failing)).toBe(true);
    expect(seen.at(-1)).toEqual({ pending: 0, failing: false });
  });

  it('recovers on the next save once the store works again', async () => {
    const { store, inner, fix } = flaky();
    const saver = createSaver(store);
    saver.save(e1);
    await saver.flush();
    fix();
    saver.save(e2);
    await saver.flush();
    expect(inner.events.map((e) => e.id)).toEqual([e1.id, e2.id]);
  });

  it('does not write the same batch twice when saves arrive while a write is running', async () => {
    const written: string[][] = [];
    const slow: ReviewStore = {
      ...createMemoryStore(),
      appendMany: async (list) => {
        await new Promise((r) => setTimeout(r, 5));
        written.push(list.map((e) => e.id));
      },
    };
    const saver = createSaver(slow);
    saver.save(e1);
    saver.save(e2);
    saver.save(e3);
    await saver.flush();
    expect(written.flat()).toEqual([e1.id, e2.id, e3.id]);
  });
});

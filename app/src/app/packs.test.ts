// Map packs (app/packs.ts) in plain Node: the Cache API and the network are replaced by a small in-memory cache and a
// fetch that answers from a table, so the rules are tested, not the browser: what a pack holds, what a stop, a failure
// or a repeat leaves behind, and that the sizes shown are the sizes saved.

import { describe, expect, it } from 'vitest';
import { downloadInto, formatBytes, packCacheName, packUrls, readStatus, PACK_PREFIX, type CacheLike, type Progress } from './packs';

const BASE = 'http://localhost:4173/';
const abs = (u: string) => new URL(u, BASE).href;

class FakeCache implements CacheLike {
  readonly rows = new Map<string, { body: Blob; type: string }>();
  async put(request: string, response: Response) {
    this.rows.set(abs(request), { body: await response.blob(), type: response.headers.get('content-type') ?? '' });
  }
  async match(request: string) {
    const row = this.rows.get(abs(request));
    return row ? new Response(row.body, { headers: { 'content-type': row.type } }) : undefined;
  }
  async keys() {
    return [...this.rows.keys()].map((url) => ({ url }));
  }
  async delete(request: string) {
    return this.rows.delete(abs(request));
  }
  /** The pictures, without the pack's own record. */
  pictures() {
    return [...this.rows.keys()].filter((u) => !u.endsWith('/pack-meta.json')).sort();
  }
}

const shot = (n: number) => abs(`/shots/de_mirage/a-${n}.avif`);
const urls = (count: number) => Array.from({ length: count }, (_, i) => shot(i + 1));

interface Network {
  fetcher: typeof fetch;
  calls: string[];
  /** The most requests in flight at once. */
  peak(): number;
}

/** Answers every address from `table` (size in bytes), 404 for others, or whatever `special` says. */
function network(table: Record<string, number>, special: Record<string, () => Response | Promise<Response>> = {}): Network {
  const calls: string[] = [];
  let live = 0;
  let peak = 0;
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    live += 1;
    peak = Math.max(peak, live);
    try {
      await new Promise((r) => setTimeout(r, 1));
      if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
      const make = special[url];
      if (make) return await make();
      const size = table[url];
      if (size === undefined) return new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } });
      return new Response(new Uint8Array(size), { headers: { 'content-type': 'image/avif' } });
    } finally {
      live -= 1;
    }
  }) as typeof fetch;
  return { fetcher, calls, peak: () => peak };
}

const sizes = (list: string[], each = 1000) => Object.fromEntries(list.map((u, i) => [u, each + i]));

describe('what a pack is', () => {
  const callout = (id: string, files: string[], status = 'verified') => ({ id, status, shots: files.map((file) => ({ file })) }) as never;
  const data = (callouts: unknown[], shotUrl = (f: string) => `/shots/${f}`) => ({ callouts, shotUrl }) as never;

  it('is the pictures of every callout that can be shown, once each and in a fixed order', () => {
    const d = data([callout('m.a', ['b.avif', 'a.avif']), callout('m.b', ['a.avif', 'c.avif'])]);
    expect(packUrls(d, BASE)).toEqual({ urls: [abs('/shots/a.avif'), abs('/shots/b.avif'), abs('/shots/c.avif')], inline: 0 });
  });

  it('leaves out the pictures of a stale callout: they are never asked for', () => {
    const d = data([callout('m.a', ['a.avif']), callout('m.old', ['old.avif'], 'stale')]);
    expect(packUrls(d, BASE).urls).toEqual([abs('/shots/a.avif')]);
  });

  it('counts built-in pictures (the development map) as nothing to download', () => {
    const d = data([callout('t.a', ['a.png', 'b.png'])], (f) => `data:image/svg+xml;utf8,${f}`);
    expect(packUrls(d, BASE)).toEqual({ urls: [], inline: 2 });
  });

  it('resolves a relative base the way the page does', () => {
    expect(packUrls(data([callout('m.a', ['a.avif'])], (f) => `shots/${f}`), 'https://callouts.test/app/').urls).toEqual(['https://callouts.test/app/shots/a.avif']);
  });

  it('has no pictures for a map with no callouts, which is not an error', () => {
    expect(packUrls(data([]), BASE)).toEqual({ urls: [], inline: 0 });
  });

  it('is named after the format, once per map', () => {
    expect(PACK_PREFIX).toBe('callouts-pack-v1-');
    expect(packCacheName('de_mirage')).toBe('callouts-pack-v1-de_mirage');
  });
});

describe('downloading', () => {
  it('saves every picture and records how big each is', async () => {
    const cache = new FakeCache();
    const list = urls(5);
    const net = network(sizes(list));
    const result = await downloadInto(cache, list, { fetcher: net.fetcher, now: () => 1234 });
    expect(result).toEqual({ done: 5, failed: 0, total: 5, bytes: 1000 + 1001 + 1002 + 1003 + 1004 });
    expect(cache.pictures()).toEqual(list);
    const status = await readStatus(cache, list, 0);
    expect(status).toMatchObject({ state: 'ready', total: 5, cached: 5, bytes: 5010, updatedAt: 1234 });
  });

  it('shows the saved size, not an estimate: the status bytes equal the bytes that arrived', async () => {
    const cache = new FakeCache();
    const list = urls(3);
    const result = await downloadInto(cache, list, { fetcher: network({ [list[0] as string]: 100_000, [list[1] as string]: 250_000, [list[2] as string]: 40_000 }).fetcher });
    expect((await readStatus(cache, list, 0)).bytes).toBe(390_000);
    expect(result.bytes).toBe(390_000);
  });

  it('reports progress as it goes, ending where the result ends', async () => {
    const seen: Progress[] = [];
    const list = urls(4);
    const result = await downloadInto(new FakeCache(), list, { fetcher: network(sizes(list)).fetcher, onProgress: (p) => seen.push(p) });
    expect(seen[0]).toEqual({ done: 0, failed: 0, total: 4, bytes: 0 });
    expect(seen.map((p) => p.done)).toEqual([...seen.map((p) => p.done)].sort((a, b) => a - b));
    expect(seen.at(-1)).toEqual(result);
  });

  it('fetches a few at a time, never more than asked', async () => {
    const list = urls(12);
    const net = network(sizes(list));
    await downloadInto(new FakeCache(), list, { fetcher: net.fetcher, concurrency: 3 });
    expect(net.peak()).toBeLessThanOrEqual(3);
    expect(net.peak()).toBeGreaterThan(1);
    const solo = network(sizes(list));
    await downloadInto(new FakeCache(), list, { fetcher: solo.fetcher, concurrency: 1 });
    expect(solo.peak()).toBe(1);
  });

  it('counts a failed picture and keeps the rest, so a bad connection costs only what did not arrive', async () => {
    const cache = new FakeCache();
    const list = urls(4);
    const table = sizes(list);
    delete table[list[2] as string]; // 404
    const net = network(table, { [list[3] as string]: () => { throw new TypeError('network error'); } });
    const result = await downloadInto(cache, list, { fetcher: net.fetcher });
    expect(result).toMatchObject({ done: 2, failed: 2, total: 4 });
    const status = await readStatus(cache, list, 0);
    expect(status).toMatchObject({ state: 'partial', cached: 2, total: 4 });
    expect(status.bytes).toBe(1000 + 1001);
  });

  it('does not keep a page where a picture should be: an answer that is not an image is a failure', async () => {
    const cache = new FakeCache();
    const list = urls(2);
    const html = () => new Response('<!doctype html><title>callouts_</title>', { status: 200, headers: { 'content-type': 'text/html' } });
    const result = await downloadInto(cache, list, { fetcher: network({ [list[0] as string]: 500 }, { [list[1] as string]: html }).fetcher });
    expect(result).toMatchObject({ done: 1, failed: 1 });
    expect(cache.pictures()).toEqual([list[0]]);
  });

  it('refuses an error status even when it says it is an image', async () => {
    const cache = new FakeCache();
    const list = urls(1);
    const broken = () => new Response('x', { status: 500, headers: { 'content-type': 'image/avif' } });
    expect(await downloadInto(cache, list, { fetcher: network({}, { [list[0] as string]: broken }).fetcher })).toMatchObject({ done: 0, failed: 1 });
    expect(cache.pictures()).toEqual([]);
  });

  it('writes no record when nothing arrived', async () => {
    const cache = new FakeCache();
    await downloadInto(cache, urls(2), { fetcher: network({}).fetcher });
    expect(cache.rows.size).toBe(0);
  });

  it('finishes a partial pack by fetching only what is missing, and the size covers all of it', async () => {
    const cache = new FakeCache();
    const list = urls(4);
    const table = sizes(list);
    const flaky = { ...table };
    delete flaky[list[3] as string];
    await downloadInto(cache, list, { fetcher: network(flaky).fetcher });
    expect((await readStatus(cache, list, 0)).state).toBe('partial');

    const second = network(table);
    const result = await downloadInto(cache, list, { fetcher: second.fetcher });
    expect(second.calls).toEqual([list[3]]);
    expect(result).toMatchObject({ done: 4, failed: 0 });
    const status = await readStatus(cache, list, 0);
    expect(status).toMatchObject({ state: 'ready', cached: 4, bytes: 1000 + 1001 + 1002 + 1003 });
  });

  it('fetches nothing for a pack that is complete, unless asked to refresh', async () => {
    const cache = new FakeCache();
    const list = urls(3);
    await downloadInto(cache, list, { fetcher: network(sizes(list)).fetcher });
    const again = network(sizes(list));
    await downloadInto(cache, list, { fetcher: again.fetcher });
    expect(again.calls).toEqual([]);

    const refreshed = network(sizes(list, 2000));
    const result = await downloadInto(cache, list, { fetcher: refreshed.fetcher, refresh: true });
    expect([...refreshed.calls].sort()).toEqual(list);
    expect(result.bytes).toBe(2000 + 2001 + 2002);
    expect((await readStatus(cache, list, 0)).bytes).toBe(6003);
  });

  it('drops pictures the map no longer has, so the pack and its size stay true', async () => {
    const cache = new FakeCache();
    const before = urls(4);
    await downloadInto(cache, before, { fetcher: network(sizes(before)).fetcher });
    const after = before.slice(0, 3); // one callout was removed
    await downloadInto(cache, after, { fetcher: network(sizes(after)).fetcher });
    expect(cache.pictures()).toEqual(after);
    expect((await readStatus(cache, after, 0)).bytes).toBe(1000 + 1001 + 1002);
  });

  it('does not tidy up after a stop: the learner interrupted it, nothing else changed', async () => {
    const cache = new FakeCache();
    const before = urls(3);
    await downloadInto(cache, before, { fetcher: network(sizes(before)).fetcher });
    const stop = new AbortController();
    stop.abort();
    await downloadInto(cache, before.slice(0, 1), { fetcher: network({}).fetcher, signal: stop.signal });
    expect(cache.pictures()).toEqual(before);
  });

  it('stops when told to, keeps what arrived, and does not count a stop as a failure', async () => {
    const cache = new FakeCache();
    const list = urls(10);
    const stop = new AbortController();
    const net = network(sizes(list));
    const result = await downloadInto(cache, list, {
      fetcher: net.fetcher,
      signal: stop.signal,
      concurrency: 1,
      onProgress: (p) => {
        if (p.done === 3) stop.abort();
      },
    });
    expect(result.done).toBeGreaterThanOrEqual(3);
    expect(result.done).toBeLessThan(10);
    expect(result.failed).toBe(0);
    expect(cache.pictures()).toHaveLength(result.done);
    const status = await readStatus(cache, list, 0);
    expect(status.state).toBe('partial');
    expect(status.cached).toBe(result.done);
  });

  it('does not start when the signal is already aborted', async () => {
    const stop = new AbortController();
    stop.abort();
    const net = network(sizes(urls(3)));
    const result = await downloadInto(new FakeCache(), urls(3), { fetcher: net.fetcher, signal: stop.signal });
    expect(net.calls).toEqual([]);
    expect(result).toMatchObject({ done: 0, failed: 0 });
  });

  it('has nothing to do for an empty list', async () => {
    const net = network({});
    expect(await downloadInto(new FakeCache(), [], { fetcher: net.fetcher })).toEqual({ done: 0, failed: 0, total: 0, bytes: 0 });
    expect(net.calls).toEqual([]);
  });
});

describe('what a pack reports', () => {
  it('says "empty" for a map with no pictures, "inline" when they are built in', async () => {
    expect(await readStatus(null, [], 0)).toMatchObject({ state: 'empty', total: 0 });
    expect(await readStatus(null, [], 7)).toMatchObject({ state: 'inline', inline: 7 });
  });

  it('says "none" without a cache, with an empty one, or with only the record', async () => {
    const list = urls(3);
    expect(await readStatus(null, list, 0)).toMatchObject({ state: 'none', total: 3, cached: 0, bytes: 0, updatedAt: null });
    expect(await readStatus(new FakeCache(), list, 0)).toMatchObject({ state: 'none', cached: 0 });
  });

  it('counts only pictures that are in the pack now, and only their sizes', async () => {
    const cache = new FakeCache();
    const list = urls(3);
    await downloadInto(cache, list, { fetcher: network(sizes(list)).fetcher });
    const wider = [...list, shot(9)];
    expect(await readStatus(cache, wider, 0)).toMatchObject({ state: 'partial', cached: 3, total: 4, bytes: 3003 });
    expect(await readStatus(cache, list.slice(0, 1), 0)).toMatchObject({ state: 'ready', cached: 1, bytes: 1000 });
  });

  it('copes with a record that is missing or damaged: the pictures count, the size is "unknown" (0)', async () => {
    const cache = new FakeCache();
    const list = urls(2);
    await downloadInto(cache, list, { fetcher: network(sizes(list)).fetcher });
    await cache.put('pack-meta.json', new Response('{"not":', { headers: { 'content-type': 'application/json' } }));
    expect(await readStatus(cache, list, 0)).toMatchObject({ state: 'ready', cached: 2, bytes: 0, updatedAt: null });
    await cache.put('pack-meta.json', new Response(JSON.stringify({ at: 'yesterday', sizes: 5 }), { headers: { 'content-type': 'application/json' } }));
    expect(await readStatus(cache, list, 0)).toMatchObject({ state: 'ready', bytes: 0 });
    await cache.delete('pack-meta.json');
    expect(await readStatus(cache, list, 0)).toMatchObject({ state: 'ready', bytes: 0 });
  });

  it('ignores sizes that are not plain numbers', async () => {
    const cache = new FakeCache();
    const list = urls(2);
    await cache.put(list[0] as string, new Response('x', { headers: { 'content-type': 'image/avif' } }));
    await cache.put(list[1] as string, new Response('x', { headers: { 'content-type': 'image/avif' } }));
    await cache.put('pack-meta.json', new Response(JSON.stringify({ at: 5, sizes: { [list[0] as string]: 300, [list[1] as string]: 'big' } }), { headers: { 'content-type': 'application/json' } }));
    expect(await readStatus(cache, list, 0)).toMatchObject({ bytes: 300, updatedAt: 5 });
  });
});

describe('sizes as people read them', () => {
  it('reads like 0 B, 312 KB, 1.4 MB, 12 MB, 2.0 GB', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(312 * 1024)).toBe('312 KB');
    expect(formatBytes(1.4 * 1024 * 1024)).toBe('1.4 MB');
    expect(formatBytes(9.96 * 1024 * 1024)).toBe('10 MB');
    expect(formatBytes(12 * 1024 * 1024)).toBe('12 MB');
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe('2.0 GB');
  });
});

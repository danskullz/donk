// Offline map packs (SCOPE.md §5.6): a map's screenshots, downloaded on request into a Cache of their own so the
// service worker (public/sw.js) can serve them with no connection. One pack per map, named by `packCacheName`; the
// worker never deletes a pack on an update, only the learner does (Settings → Data → Offline).
//
// The download logic takes the cache and the fetch function as arguments, so it runs in plain Node tests; the
// functions below it bind it to the browser's CacheStorage and to the app's maps. Pictures are fetched a few at a
// time and each is checked to be an image: a server that answers a missing file with its page (a single-page app's
// fallback) must not leave HTML in the pack as if it were a screenshot.

import { loadAvailableMaps, type MapData } from './data';

/** Must equal PACK_CURRENT in public/sw-caches.js (a test compares them): the worker keeps caches with this prefix. */
export const PACK_PREFIX = 'callouts-pack-v1-';
export const packCacheName = (mapId: string): string => `${PACK_PREFIX}${mapId}`;

/** A record kept inside the pack's own cache, so deleting the cache deletes the numbers with it. */
const META_URL = 'pack-meta.json';

export interface PackTarget {
  mapId: string;
  name: string;
  /** Absolute http(s) addresses of the map's pictures. */
  urls: string[];
  /** Pictures whose address is not a web address (the development map's are built into the page): nothing to download. */
  inline: number;
}

/** What a pack is: the screenshots of every callout that can be shown (stale ones are never asked for). */
export function packUrls(data: Pick<MapData, 'callouts' | 'shotUrl'>, base: string): Pick<PackTarget, 'urls' | 'inline'> {
  const urls = new Set<string>();
  let inline = 0;
  const files = new Set<string>();
  for (const callout of data.callouts) {
    if (callout.status === 'stale') continue;
    for (const shot of callout.shots) files.add(shot.file);
  }
  for (const file of [...files].sort()) {
    let url: URL;
    try {
      url = new URL(data.shotUrl(file), base);
    } catch {
      inline += 1;
      continue;
    }
    if (url.protocol === 'http:' || url.protocol === 'https:') urls.add(url.href);
    else inline += 1;
  }
  return { urls: [...urls], inline };
}

export type PackState = 'empty' | 'inline' | 'none' | 'partial' | 'ready';

export interface PackStatus {
  /** empty: the map has no pictures; inline: they are built in; none, partial, ready: how much is downloaded. */
  state: PackState;
  total: number;
  cached: number;
  /** Bytes the downloaded pictures take, as measured when they were saved. 0 when nothing is downloaded. */
  bytes: number;
  /** When the last download finished, or null. */
  updatedAt: number | null;
  inline: number;
}

/** The part of the Cache API this file uses. The real `Cache` fits it. */
export interface CacheLike {
  put(request: string, response: Response): Promise<void>;
  match(request: string): Promise<Response | undefined>;
  keys(): Promise<readonly { url: string }[]>;
}

interface Meta {
  version: 1;
  at: number;
  bytes: number;
}

async function readMeta(cache: CacheLike): Promise<Meta | null> {
  try {
    const hit = await cache.match(META_URL);
    const raw: unknown = hit ? await hit.json() : null;
    if (typeof raw === 'object' && raw !== null && typeof (raw as Meta).bytes === 'number' && typeof (raw as Meta).at === 'number') return raw as Meta;
  } catch {
    // unreadable record: the pictures still count, their size is just not known
  }
  return null;
}

export async function readStatus(cache: CacheLike | null, urls: readonly string[], inline: number): Promise<PackStatus> {
  const total = urls.length;
  if (total === 0) return { state: inline > 0 ? 'inline' : 'empty', total: 0, cached: 0, bytes: 0, updatedAt: null, inline };
  if (!cache) return { state: 'none', total, cached: 0, bytes: 0, updatedAt: null, inline };
  const have = new Set((await cache.keys()).map((r) => r.url));
  const cached = urls.filter((u) => have.has(u)).length;
  const meta = cached > 0 ? await readMeta(cache) : null;
  return {
    state: cached === 0 ? 'none' : cached < total ? 'partial' : 'ready',
    total,
    cached,
    bytes: meta?.bytes ?? 0,
    updatedAt: meta?.at ?? null,
    inline,
  };
}

export interface Progress {
  done: number;
  failed: number;
  total: number;
  bytes: number;
}

export interface DownloadOptions {
  fetcher?: typeof fetch;
  onProgress?: (p: Progress) => void;
  signal?: AbortSignal | undefined;
  /** Fetch every picture again instead of only the ones that are missing. */
  refresh?: boolean;
  concurrency?: number;
  now?: () => number;
}

/**
 * Download pictures into a cache. Returns what happened; a picture that fails is counted and left out, and the others
 * stay, so a dropped connection costs only what had not arrived. Stops early when `signal` aborts.
 */
export async function downloadInto(cache: CacheLike, urls: readonly string[], options: DownloadOptions = {}): Promise<Progress> {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const have = options.refresh ? new Set<string>() : new Set((await cache.keys()).map((r) => r.url));
  const previous = options.refresh ? null : await readMeta(cache);
  const skipped = urls.filter((u) => have.has(u));
  // Pictures kept from an earlier run count as done, with the size recorded for them.
  const progress: Progress = { done: skipped.length, failed: 0, total: urls.length, bytes: skipped.length > 0 ? (previous?.bytes ?? 0) : 0 };
  options.onProgress?.({ ...progress });

  const queue = urls.filter((u) => !have.has(u));
  async function worker(): Promise<void> {
    for (let url = queue.shift(); url !== undefined; url = queue.shift()) {
      if (options.signal?.aborted) return;
      try {
        const response = await fetcher(url, { cache: 'reload', ...(options.signal ? { signal: options.signal } : {}) });
        const type = response.headers.get('content-type') ?? '';
        if (!response.ok || !type.startsWith('image/')) throw new Error(`not a picture (${response.status} ${type})`);
        const body = await response.blob();
        await cache.put(url, new Response(body, { headers: { 'content-type': type } }));
        progress.bytes += body.size;
        progress.done += 1;
      } catch {
        if (options.signal?.aborted) return;
        progress.failed += 1;
      }
      options.onProgress?.({ ...progress });
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(options.concurrency ?? 4, queue.length)) }, worker));

  if (progress.done > 0) {
    const meta: Meta = { version: 1, at: now(), bytes: progress.bytes };
    await cache.put(META_URL, new Response(JSON.stringify(meta), { headers: { 'content-type': 'application/json' } }));
  }
  return progress;
}

// ---- the browser side ----

const hasCaches = (): boolean => typeof caches !== 'undefined';

/** Pictures can only be stored where the Cache API exists (a secure context: https or localhost). */
export const packsSupported = (): boolean => hasCaches();

const extraTargets: PackTarget[] = [];

/** Every map the app can play, with the pictures its pack would hold. */
export async function packTargets(): Promise<PackTarget[]> {
  const maps = await loadAvailableMaps();
  const base = typeof location === 'undefined' ? 'http://localhost/' : location.href;
  return [...maps.map((m) => ({ mapId: m.map.id, name: m.map.displayName, ...packUrls(m, base) })), ...extraTargets];
}

async function targetFor(mapId: string): Promise<PackTarget | undefined> {
  return (await packTargets()).find((t) => t.mapId === mapId);
}

export async function packStatus(mapId: string): Promise<PackStatus> {
  const target = await targetFor(mapId);
  if (!target) return { state: 'empty', total: 0, cached: 0, bytes: 0, updatedAt: null, inline: 0 };
  const cache = hasCaches() && (await caches.has(packCacheName(mapId))) ? await caches.open(packCacheName(mapId)) : null;
  return readStatus(cache, target.urls, target.inline);
}

/** Download (or finish, or refresh) a map's pack. Resolves with its status afterwards. */
export async function cacheMapPack(mapId: string, options: Omit<DownloadOptions, 'fetcher'> = {}): Promise<PackStatus> {
  const target = await targetFor(mapId);
  if (!target) throw new Error(`no map called ${mapId}`);
  if (!hasCaches()) throw new Error('this browser cannot keep files offline here (it needs https or localhost)');
  if (target.urls.length > 0) await downloadInto(await caches.open(packCacheName(mapId)), target.urls, options);
  return packStatus(mapId);
}

/** Delete a map's downloaded pictures. */
export async function removeMapPack(mapId: string): Promise<void> {
  if (hasCaches()) await caches.delete(packCacheName(mapId));
}

export interface StorageReport {
  usage: number | null;
  quota: number | null;
  /** The browser has promised not to clear this site's data when space runs low. Null when it cannot say. */
  persisted: boolean | null;
}

export async function storageReport(): Promise<StorageReport> {
  try {
    const [estimate, persisted] = await Promise.all([navigator.storage?.estimate?.(), navigator.storage?.persisted?.()]);
    return { usage: estimate?.usage ?? null, quota: estimate?.quota ?? null, persisted: persisted ?? null };
  } catch {
    return { usage: null, quota: null, persisted: null };
  }
}

/**
 * The service worker that makes the app open offline. `development`: this is not a production build, which never
 * registers one. `unavailable`: the browser has none here (it needs https or localhost). `installing`: registered, not
 * yet in control of this page. `ready`: in control, so a reload with no connection works.
 */
export type WorkerState = 'development' | 'unavailable' | 'installing' | 'ready';

export async function workerState(): Promise<WorkerState> {
  if (!import.meta.env.PROD) return 'development';
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return 'unavailable';
  const registration = await navigator.serviceWorker.getRegistration();
  return registration?.active && navigator.serviceWorker.controller ? 'ready' : 'installing';
}

/** 1.4 MB, 312 KB, 0 B: sizes as people read them. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

// A way for the browser tests to download a pack of known files: the real maps have no pictures on the web yet (the
// development map's are built into the page). Development and e2e builds only; written inline so the bundler drops it.
if (typeof window !== 'undefined' && (import.meta.env.DEV || import.meta.env.VITE_DEMO === '1')) {
  (window as unknown as Record<string, unknown>)['__calloutsPacks'] = {
    addTarget: (target: PackTarget) => extraTargets.push(target),
    packCacheName,
  };
}

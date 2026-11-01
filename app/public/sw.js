// The Callouts service worker (SCOPE.md §5.6, §7.8). Hand-written, no library. It makes the app open and run with no
// connection after one visit: the page and its hashed build files are kept, and a map's screenshots are kept when the
// learner downloads that map's pack (Settings → Data → Offline). Progress needs no help: it is in IndexedDB.
//
// Strategy
//  - the page (navigations): network first, so a new build shows up on the next visit; when the network fails or takes
//    more than a few seconds, the copy from the last visit is used (and refreshed if the slow answer still arrives)
//  - /assets/*: hashed file names never change their content, so cache first
//  - /shots/*: from any cache (a downloaded pack), else the network; never stored here, only a pack stores pictures
//  - anything else of ours (manifest, icons): network first, falling back to the copy
//
// The build id comes from the address this script was registered with (`sw.js?build=...`, see src/app/register-sw.ts):
// a new build registers a new address, which is a new worker, which installs its own cache and deletes the old ones
// when it takes over (skipWaiting + clients.claim: it does not wait for every tab to close).

importScripts('sw-caches.js');

const C = self.CalloutsCaches;
const BUILD = C.buildOf(self.location.href);
const SHELL = C.shellCacheName(BUILD);
const SCOPE = self.registration.scope;
/** A slow network is treated as no network when there is a copy to show instead. */
const NAVIGATION_TIMEOUT_MS = 4000;

/**
 * Look-ups ignore `Vary`. These are static files that never differ by request header, but a server may still send
 * `Vary: Origin` (Vite's preview server does): a copy saved by the install, which has no Origin header, would then
 * never match the page's own module-script requests, which have one, and the app would not start offline.
 */
const MATCH = { ignoreVary: true };

const isHtml = (response) => (response.headers.get('content-type') || '').indexOf('text/html') !== -1;

/** The file addresses inside a piece of text: `src="..."` and `href="..."` in the page, `url(...)` in a style sheet. */
function referencesIn(text, base, pattern) {
  const found = new Set();
  for (const match of text.matchAll(pattern)) {
    const raw = match[1];
    if (!raw || raw.indexOf('data:') === 0 || raw.charAt(0) === '#') continue;
    let url;
    try {
      url = new URL(raw, base);
    } catch (e) {
      continue;
    }
    url.hash = '';
    if (url.origin === new URL(SCOPE).origin && url.pathname.indexOf(new URL(SCOPE).pathname) === 0 && url.href !== SCOPE) found.add(url.href);
  }
  return [...found];
}

const PAGE_REFS = /(?:src|href)\s*=\s*["']([^"']+)["']/g;
const CSS_REFS = /url\(\s*["']?([^"')]+?)["']?\s*\)/g;

/** Keep the page, the files it names, and the fonts its style sheets name, so the first visit is enough. */
async function precache() {
  const cache = await caches.open(SHELL);
  const page = await fetch(SCOPE, { cache: 'reload' });
  if (!page.ok) throw new Error('the page answered ' + page.status);
  const html = await page.clone().text();
  await cache.put(SCOPE, page);

  const files = referencesIn(html, SCOPE, PAGE_REFS);
  // All of these must arrive, or the install fails and is tried again on the next visit.
  await Promise.all(files.map((url) => cache.add(new Request(url, { cache: 'reload' }))));

  // The page names only the entry. Follow the names inside it to the lazy chunks (the scheduler, a map's data), so the
  // first visit is enough even when the learner has only opened the home screen. A chunk that does not arrive is not
  // fatal: it is kept the first time it is used (cacheFirst) or when the page reports it (keep-loaded).
  const seen = new Set(files);
  const queue = files.filter((url) => new URL(url).pathname.endsWith('.js'));
  for (let url = queue.shift(); url !== undefined; url = queue.shift()) {
    const hit = await cache.match(url, MATCH);
    if (!hit) continue;
    const fresh = C.chunkRefs(await hit.text(), url, SCOPE).filter((ref) => !seen.has(ref));
    fresh.forEach((ref) => seen.add(ref));
    const added = await Promise.allSettled(fresh.map((ref) => cache.add(new Request(ref, { cache: 'reload' }))));
    fresh.forEach((ref, i) => {
      if (added[i].status === 'fulfilled' && new URL(ref).pathname.endsWith('.js')) queue.push(ref);
    });
  }

  // Fonts come with the style sheets. Only woff2: every browser that has service workers reads it.
  const sheets = [...seen].filter((url) => new URL(url).pathname.endsWith('.css'));
  for (const sheet of sheets) {
    const css = await (await cache.match(sheet, MATCH)).text();
    const fonts = referencesIn(css, sheet, CSS_REFS).filter((url) => !new URL(url).pathname.endsWith('.woff'));
    await Promise.allSettled(fonts.map((url) => cache.add(new Request(url, { cache: 'reload' }))));
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(C.staleCaches(names, BUILD).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

async function navigation(event) {
  const request = event.request;
  const cache = await caches.open(SHELL);
  const copy = await cache.match(SCOPE, MATCH);
  const isRoot = new URL(request.url).pathname === new URL(SCOPE).pathname;
  // Only the page itself is kept as the copy, never an error page or some other address that fell back to it.
  const attempt = fetch(request).then(async (response) => {
    if (response.ok && isRoot && isHtml(response)) await cache.put(SCOPE, response.clone());
    return response;
  });
  if (!copy) return attempt.catch(() => Response.error());
  try {
    const first = await Promise.race([attempt, new Promise((resolve) => setTimeout(() => resolve(null), NAVIGATION_TIMEOUT_MS))]);
    if (first) return first;
  } catch (e) {
    return copy; // no connection at all
  }
  // Too slow: show the copy now, and let the answer refresh it whenever it does arrive.
  event.waitUntil(attempt.catch(() => undefined));
  return copy;
}

async function remember(cache, request, response) {
  if (response.ok && !isHtml(response)) await cache.put(request, response.clone());
}

async function cacheFirst(request) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(request, MATCH);
  if (hit) return hit;
  const response = await fetch(request);
  await remember(cache, request, response);
  return response;
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    await remember(await caches.open(SHELL), request, response);
    return response;
  } catch (e) {
    return (await caches.match(request, MATCH)) || Response.error();
  }
}

async function fromPackThenNetwork(request) {
  return (await caches.match(request, MATCH)) || fetch(request);
}

self.addEventListener('fetch', (event) => {
  const kind = C.kindOf(event.request, SCOPE);
  if (kind === 'navigate') event.respondWith(navigation(event));
  else if (kind === 'asset') event.respondWith(cacheFirst(event.request));
  else if (kind === 'shot') event.respondWith(fromPackThenNetwork(event.request));
  else if (kind === 'other') event.respondWith(networkFirst(event.request));
});

/**
 * The page tells the worker which build files it loaded (`performance.getEntriesByType('resource')`). The first visit
 * loads them before this worker controls the page, so this is how lazy chunks, which the page names only when it runs,
 * get kept too.
 */
async function keepLoaded(urls) {
  const cache = await caches.open(SHELL);
  for (const raw of urls) {
    let request;
    try {
      request = new Request(raw);
    } catch (e) {
      continue;
    }
    if (C.kindOf(request, SCOPE) !== 'asset' || (await cache.match(request, MATCH))) continue;
    try {
      await remember(cache, request, await fetch(request));
    } catch (e) {
      // offline right now: the next visit sends the list again
    }
  }
}

self.addEventListener('message', (event) => {
  const data = event.data;
  if (data && data.type === 'keep-loaded' && Array.isArray(data.urls)) event.waitUntil(keepLoaded(data.urls.filter((u) => typeof u === 'string')));
});

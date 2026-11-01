// Registers the service worker (public/sw.js) so the app opens offline after one visit (SCOPE.md §5.6, §7.8).
// Imported once from main.ts. Production builds only: in development the worker would serve stale files and hide
// the changes being made.
//
// The worker is registered at an address that carries a build id (`sw.js?build=ab12cd`). A new build changes the id,
// which makes the browser treat it as a new worker; that worker installs its own cache and deletes the old ones. The id
// is made from the names of the hashed build files this page loaded, which change whenever their content does, so
// nobody has to remember to bump a version number.

/** A short, plain id (lowercase letters and digits, as the worker's cache names need) from the build files' names. */
export function buildIdFrom(urls: readonly string[]): string {
  const paths = urls
    .map((u) => {
      try {
        return new URL(u, 'http://x/').pathname;
      } catch {
        return u;
      }
    })
    .filter((p) => p.includes('/assets/'));
  // Each file once: the same file named by a script tag and a preload link is still one file of the build.
  const names = [...new Set(paths)].sort();
  if (names.length === 0) return 'dev';
  // FNV-1a over the joined names; two 32-bit passes with different seeds give 12 characters, ample for a handful of builds
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (const ch of names.join('\n')) {
    a = Math.imul(a ^ ch.charCodeAt(0), 0x01000193) >>> 0;
    b = Math.imul(b ^ ch.charCodeAt(0), 0x85ebca6b) >>> 0;
  }
  return a.toString(36).padStart(7, '0') + b.toString(36).padStart(7, '0');
}

/** The addresses of the build files the page loaded: scripts, style sheets and, from the resource timeline, lazy chunks and fonts. */
function loadedAssetUrls(): string[] {
  const own = location.origin;
  const out = new Set<string>();
  for (const e of performance.getEntriesByType('resource')) {
    if (e.name.startsWith(own) && new URL(e.name).pathname.includes('/assets/')) out.add(e.name);
  }
  return [...out];
}

/** Addresses named in the page itself: they identify the build even before the timeline has everything. */
function pageAssetUrls(): string[] {
  const nodes = document.querySelectorAll<HTMLScriptElement | HTMLLinkElement>('script[src], link[rel="stylesheet"][href], link[rel="modulepreload"][href]');
  return [...nodes].map((n) => ('src' in n && n.src ? n.src : (n as HTMLLinkElement).href));
}

// Read when this file first runs, which is before the app has opened any screen: later, Vite adds a link for the style
// sheet of each lazy chunk it loads, and an id that depended on which screens were visited would change from visit to
// visit and install a new worker every time.
const entryAssets = typeof document === 'undefined' ? [] : pageAssetUrls();

async function register(): Promise<void> {
  const base = import.meta.env.BASE_URL;
  const build = buildIdFrom(entryAssets);
  const registration = await navigator.serviceWorker.register(`${base}sw.js?build=${build}`, { scope: base, updateViaCache: 'none' });

  // The first visit loads every file before the worker controls the page, so tell it what was loaded (it keeps the
  // lazy chunks that way). Again when a new worker takes over, for the same reason after an update.
  const tell = () => {
    const worker = navigator.serviceWorker.controller ?? registration.active;
    worker?.postMessage({ type: 'keep-loaded', urls: loadedAssetUrls() });
  };
  await navigator.serviceWorker.ready;
  tell();
  navigator.serviceWorker.addEventListener('controllerchange', tell);
}

function start(): void {
  if (!import.meta.env.PROD || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const go = () => void register().catch((e) => console.warn('The app could not be made available offline', e));
  if (document.readyState === 'complete') go();
  else window.addEventListener('load', go, { once: true });
}

start();

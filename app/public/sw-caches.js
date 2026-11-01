// The service worker's cache rules, kept apart from sw.js so they can be tested in plain Node (src/app/sw-caches.test.ts
// reads this file as text and runs it). Classic script: it puts one object on the global scope and imports nothing.
//
// Two kinds of cache:
//  - the shell cache, one per build, holding the page, its hashed assets, the manifest and icons. A new build gets a
//    new name and the old one is deleted when the new worker takes over.
//  - a pack cache per map, holding that map's screenshots. The learner chose to download it, so an update never
//    deletes it; only a pack in a format this worker does not know (an older prefix) is removed.

(function (root) {
  var SHELL_PREFIX = 'callouts-shell-';
  var PACK_PREFIX = 'callouts-pack-';
  /** The pack format. Bump it (callouts-pack-v2-) to make every worker discard packs of the old format. */
  var PACK_CURRENT = PACK_PREFIX + 'v1-';

  /** Build ids are short and plain, because they end up in a cache name. */
  function cleanBuild(value) {
    return typeof value === 'string' && /^[a-z0-9]{1,24}$/.test(value) ? value : 'dev';
  }

  /** The build a worker script belongs to: `sw.js?build=ab12cd` gives `ab12cd`. */
  function buildOf(scriptUrl) {
    try {
      return cleanBuild(new URL(scriptUrl).searchParams.get('build'));
    } catch (e) {
      return 'dev';
    }
  }

  function shellCacheName(build) {
    return SHELL_PREFIX + cleanBuild(build);
  }

  function packCacheName(mapId) {
    return PACK_CURRENT + mapId;
  }

  /** Caches to delete when the worker for `build` takes over: other builds' shells and packs in an old format. */
  function staleCaches(names, build) {
    var keep = shellCacheName(build);
    return names.filter(function (n) {
      if (n.indexOf(SHELL_PREFIX) === 0) return n !== keep;
      if (n.indexOf(PACK_PREFIX) === 0) return n.indexOf(PACK_CURRENT) !== 0;
      return false;
    });
  }

  /**
   * How the worker treats a request, from its path inside the app's scope:
   *  'navigate' the page itself, 'asset' a hashed build file, 'shot' a screenshot, 'other' anything else of ours.
   */
  function kindOf(request, scopeUrl) {
    var url = new URL(request.url);
    var scope = new URL(scopeUrl);
    if (request.method !== 'GET' || url.origin !== scope.origin || url.pathname.indexOf(scope.pathname) !== 0) return 'skip';
    if (request.headers && request.headers.has && request.headers.has('range')) return 'skip';
    if (request.mode === 'navigate') return 'navigate';
    var path = url.pathname.slice(scope.pathname.length);
    if (path.indexOf('assets/') === 0) return 'asset';
    if (path.indexOf('shots/') === 0) return 'shot';
    return 'other';
  }

  root.CalloutsCaches = {
    SHELL_PREFIX: SHELL_PREFIX,
    PACK_PREFIX: PACK_PREFIX,
    PACK_CURRENT: PACK_CURRENT,
    cleanBuild: cleanBuild,
    buildOf: buildOf,
    shellCacheName: shellCacheName,
    packCacheName: packCacheName,
    staleCaches: staleCaches,
    kindOf: kindOf,
  };
})(self);

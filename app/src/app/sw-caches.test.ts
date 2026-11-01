// The service worker's cache rules (public/sw-caches.js) run in plain Node here: the file is a classic script that
// puts one object on `self`, so it is read as text and evaluated against a stand-in `self`. What the worker does with
// the network is not tested here (that needs a browser: e2e/settings-offline.spec.ts); what is decided by these rules is.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { packCacheName, PACK_PREFIX } from './packs';

interface Caches {
  SHELL_PREFIX: string;
  PACK_PREFIX: string;
  PACK_CURRENT: string;
  cleanBuild(value: unknown): string;
  buildOf(url: string): string;
  shellCacheName(build: string): string;
  packCacheName(mapId: string): string;
  staleCaches(names: string[], build: string): string[];
  kindOf(request: { url: string; method: string; mode?: string; headers?: Headers }, scope: string): string;
  chunkRefs(text: string, fileUrl: string, scopeUrl: string): string[];
}

const source = readFileSync(new URL('../../public/sw-caches.js', import.meta.url), 'utf8');
const host: { CalloutsCaches?: Caches } = {};
new Function('self', source)(host);
const C = host.CalloutsCaches as Caches;

const SCOPE = 'https://callouts.test/';
const req = (path: string, init: { method?: string; mode?: string; range?: boolean } = {}) => ({
  url: new URL(path, SCOPE).href,
  method: init.method ?? 'GET',
  mode: init.mode ?? 'no-cors',
  headers: new Headers(init.range ? { range: 'bytes=0-9' } : {}),
});

describe('the worker file', () => {
  it('is valid script and imports the rules from a file that exists', () => {
    const worker = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');
    expect(() => new Function(worker)).not.toThrow();
    const imported = /importScripts\('([^']+)'\)/.exec(worker)?.[1];
    expect(imported).toBe('sw-caches.js');
  });

  it('names its pack caches the way the app does, so the worker never deletes a pack the app made', () => {
    expect(C.PACK_CURRENT).toBe(PACK_PREFIX);
    expect(C.packCacheName('de_mirage')).toBe(packCacheName('de_mirage'));
  });
});

describe('build ids and cache names', () => {
  it('takes the id from the address the worker was registered with', () => {
    expect(C.buildOf('https://callouts.test/sw.js?build=ab12cd')).toBe('ab12cd');
    expect(C.shellCacheName('ab12cd')).toBe('callouts-shell-ab12cd');
  });

  it('falls back to "dev" for a missing, odd or unparsable id, so a cache name is always plain', () => {
    for (const url of ['https://callouts.test/sw.js', 'https://callouts.test/sw.js?build=', 'https://callouts.test/sw.js?build=AB12', 'https://callouts.test/sw.js?build=a/b', 'not a url']) {
      expect(C.buildOf(url), url).toBe('dev');
    }
    expect(C.cleanBuild('x'.repeat(25))).toBe('dev');
    expect(C.cleanBuild('x'.repeat(24))).toBe('x'.repeat(24));
    expect(C.cleanBuild(undefined)).toBe('dev');
  });

  it('gives each map its own pack, named after the pack format', () => {
    expect(C.packCacheName('de_mirage')).toBe('callouts-pack-v1-de_mirage');
    expect(C.packCacheName('de_mirage')).not.toBe(C.packCacheName('de_nuke'));
  });
});

describe('which caches an update deletes', () => {
  const names = [
    'callouts-shell-old111',
    'callouts-shell-new222',
    'callouts-shell-dev',
    'callouts-pack-v1-de_mirage',
    'callouts-pack-v1-de_nuke',
    'callouts-pack-de_mirage', // a format from before versions
    'callouts-pack-v0-de_mirage',
    'someone-elses-cache',
    'workbox-precache-v2',
  ];

  it('removes every other build’s shell and keeps the one of the build taking over', () => {
    const stale = C.staleCaches(names, 'new222');
    expect(stale).toContain('callouts-shell-old111');
    expect(stale).toContain('callouts-shell-dev');
    expect(stale).not.toContain('callouts-shell-new222');
  });

  it('keeps downloaded packs of the current format whichever build runs: an update never costs a download', () => {
    for (const build of ['old111', 'new222', 'zzz']) {
      const stale = C.staleCaches(names, build);
      expect(stale).not.toContain('callouts-pack-v1-de_mirage');
      expect(stale).not.toContain('callouts-pack-v1-de_nuke');
    }
  });

  it('removes packs of an older format, which this worker cannot use', () => {
    const stale = C.staleCaches(names, 'new222');
    expect(stale).toContain('callouts-pack-de_mirage');
    expect(stale).toContain('callouts-pack-v0-de_mirage');
  });

  it('leaves caches that are not its own alone', () => {
    const stale = C.staleCaches(names, 'new222');
    expect(stale).not.toContain('someone-elses-cache');
    expect(stale).not.toContain('workbox-precache-v2');
  });

  it('has nothing to do on a clean start, and on a repeat', () => {
    expect(C.staleCaches([], 'a1')).toEqual([]);
    expect(C.staleCaches(['callouts-shell-a1', 'callouts-pack-v1-de_mirage'], 'a1')).toEqual([]);
  });

  it('treats an unusable build id as "dev", so it never deletes the shell it just made', () => {
    const build = C.buildOf('https://callouts.test/sw.js?build=BAD ID');
    expect(C.staleCaches([C.shellCacheName(build)], build)).toEqual([]);
  });
});

describe('how a request is handled', () => {
  it('answers the page, build files, pictures and everything else of ours', () => {
    expect(C.kindOf(req('/', { mode: 'navigate' }), SCOPE)).toBe('navigate');
    expect(C.kindOf(req('/?seed=1', { mode: 'navigate' }), SCOPE)).toBe('navigate');
    expect(C.kindOf(req('/assets/index-AbC123.js'), SCOPE)).toBe('asset');
    expect(C.kindOf(req('/shots/de_mirage/a-ramp-1.avif'), SCOPE)).toBe('shot');
    expect(C.kindOf(req('/manifest.webmanifest'), SCOPE)).toBe('other');
    expect(C.kindOf(req('/icons/icon-192.png'), SCOPE)).toBe('other');
  });

  it('leaves alone what is not a plain GET of ours', () => {
    expect(C.kindOf(req('/assets/x.js', { method: 'POST' }), SCOPE)).toBe('skip');
    expect(C.kindOf(req('/assets/x.js', { method: 'HEAD' }), SCOPE)).toBe('skip');
    expect(C.kindOf({ ...req('/'), url: 'https://elsewhere.test/assets/x.js' }, SCOPE)).toBe('skip');
    expect(C.kindOf(req('/shots/a.avif', { range: true }), SCOPE)).toBe('skip');
  });

  it('works for an app served from a folder', () => {
    const scope = 'https://callouts.test/app/';
    const at = (path: string, mode = 'no-cors') => ({ url: `https://callouts.test${path}`, method: 'GET', mode, headers: new Headers() });
    expect(C.kindOf(at('/app/assets/x.js'), scope)).toBe('asset');
    expect(C.kindOf(at('/app/shots/a.avif'), scope)).toBe('shot');
    expect(C.kindOf(at('/app/', 'navigate'), scope)).toBe('navigate');
    expect(C.kindOf(at('/assets/x.js'), scope)).toBe('skip'); // outside the scope
  });
});

describe('the lazy chunks a build file names', () => {
  const entry = `${SCOPE}assets/index-KooWkMzw.js`;

  it('finds a chunk beside the file, in every quote style Vite writes', () => {
    const text = `a=()=>import("./fsrs-6-BgfqS-NX.js");b=()=>import('./demo-data-Bc-TQX9B.js');c=\`./de_mirage-CdWYeTT5.js\``;
    expect(C.chunkRefs(text, entry, SCOPE)).toEqual([`${SCOPE}assets/fsrs-6-BgfqS-NX.js`, `${SCOPE}assets/demo-data-Bc-TQX9B.js`, `${SCOPE}assets/de_mirage-CdWYeTT5.js`]);
  });

  it('reads the preload list, which names files from the app root and not from the file', () => {
    const text = `m.f=["assets/error-DwLpsZPe.js","assets/Editor-1a2b3c.css"]`;
    expect(C.chunkRefs(text, entry, SCOPE)).toEqual([`${SCOPE}assets/error-DwLpsZPe.js`, `${SCOPE}assets/Editor-1a2b3c.css`]);
    expect(C.chunkRefs('"/assets/x-12.js"', entry, SCOPE)).toEqual([`${SCOPE}assets/x-12.js`]);
  });

  it('lists a file once however often it is named', () => {
    const text = `"./a-1.js";"./a-1.js";"assets/a-1.js"`;
    expect(C.chunkRefs(text, entry, SCOPE)).toEqual([`${SCOPE}assets/a-1.js`]);
  });

  it('ignores what is not a build file of this app', () => {
    const text = [
      `"https://cdn.test/x.js"`, // another site
      `"../outside-1.js"`, // up out of /assets/
      `"./data.json"`, // not script, style or font
      `"./notes.txt"`,
      `"./has space.js"`,
      `"#/session/de_mirage.js"`,
      `"./"`,
    ].join(';');
    expect(C.chunkRefs(text, entry, SCOPE)).toEqual([]);
  });

  it('follows a chunk that sits in a sub-folder of assets, and a font named by a script', () => {
    const text = `"./chunks/map-9f.js";"./ibm-plex-mono-latin-400-normal-DMJ8VG8y.woff2"`;
    expect(C.chunkRefs(text, entry, SCOPE)).toEqual([`${SCOPE}assets/chunks/map-9f.js`, `${SCOPE}assets/ibm-plex-mono-latin-400-normal-DMJ8VG8y.woff2`]);
  });

  it('resolves "../" from the file, and drops the query string', () => {
    const inFolder = `${SCOPE}assets/chunks/map-9f.js`;
    expect(C.chunkRefs(`"../fsrs-6-1.js?v=2"`, inFolder, SCOPE)).toEqual([]); // the pattern takes names without a query
    expect(C.chunkRefs(`"../fsrs-6-1.js"`, inFolder, SCOPE)).toEqual([`${SCOPE}assets/fsrs-6-1.js`]);
  });

  it('can be called again and again: no state is kept between texts', () => {
    const text = `"./a-1.js"`;
    expect(C.chunkRefs(text, entry, SCOPE)).toEqual(C.chunkRefs(text, entry, SCOPE));
  });

  it('works under a folder scope, where only files inside it count', () => {
    const scope = 'https://callouts.test/app/';
    const file = `${scope}assets/index-1.js`;
    expect(C.chunkRefs(`"./b-2.js";"assets/c-3.js"`, file, scope)).toEqual([`${scope}assets/b-2.js`, `${scope}assets/c-3.js`]);
  });
});

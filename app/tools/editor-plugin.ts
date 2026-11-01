// The Editor's file access (SCOPE.md §8.3): a Vite dev-server plugin, so the Editor can read and write /data and
// read the generated nav meshes and radars from /assets. It exists only under `vite dev` (`apply: 'serve'`): a
// production build has no way to reach these files.
//
// Every save is checked with the same schemas as `pnpm content:validate`, the previous files are copied to
// data/.backups first (the folder is not under version control), and an etag stops a stale tab overwriting newer work.

import { createHash } from 'node:crypto';
import { copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { Plugin } from 'vite';
import { WorkFileSchema } from '../src/core/editor/doc';
import { stableJson } from '../src/core/editor/json';
import { CalloutsFileSchema, MapIndexSchema, MapSchema } from '../src/core/schema';

export interface EditorPaths {
  /** The content folder: index.json, maps/, callouts/. */
  data: string;
  /** The generated Valve folder: nav/, radars/. */
  assets: string;
}

const MAP_ID = /^de_[a-z0-9]+$/;
const FILE_NAME = /^[a-z0-9_]+$/;
const KEEP_BACKUPS = 30;
const MAX_BODY = 40 * 1024 * 1024;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(text);
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'body too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'body is not JSON'));
      }
    });
    req.on('error', reject);
  });
}

const readText = (file: string): string => (existsSync(file) ? readFileSync(file, 'utf8') : '');
const readJson = (file: string): unknown => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null);

export function editorPlugin(paths: EditorPaths): Plugin {
  const files = (id: string) => ({
    map: path.join(paths.data, 'maps', `${id}.json`),
    callouts: path.join(paths.data, 'callouts', `${id}.json`),
    work: path.join(paths.data, 'editor', `${id}.work.json`),
    manifest: path.join(paths.data, 'editor', `${id}.capture-manifest.json`),
    nav: path.join(paths.assets, 'nav', `${id}.json`),
  });

  /** A fingerprint of what is on disk for a map, so a save can tell that someone else changed it. */
  const etagOf = (id: string): string => {
    const f = files(id);
    return createHash('sha1').update(readText(f.map)).update('\0').update(readText(f.callouts)).update('\0').update(readText(f.work)).digest('hex').slice(0, 16);
  };

  const radars = (id: string): string[] => {
    const dir = path.join(paths.assets, 'radars');
    return existsSync(dir) ? readdirSync(dir).filter((f) => f.startsWith(`${id}`) && f.endsWith('.png')).map((f) => f.slice(0, -4)) : [];
  };

  function list(): unknown {
    const index = MapIndexSchema.parse(readJson(path.join(paths.data, 'index.json')));
    return index.map((m) => ({ ...m, hasNav: existsSync(files(m.id).nav), hasData: existsSync(files(m.id).map) }));
  }

  function load(id: string): unknown {
    const f = files(id);
    if (!existsSync(f.map)) throw new HttpError(404, `${id} has no map record in data/maps`);
    return {
      etag: etagOf(id),
      map: readJson(f.map),
      callouts: readJson(f.callouts) ?? [],
      work: readJson(f.work),
      hasNav: existsSync(f.nav),
      radars: radars(id),
    };
  }

  function backup(id: string, changed: ('map' | 'callouts' | 'work')[]): void {
    const f = files(id);
    const dir = path.join(paths.data, '.backups', id, new Date().toISOString().replace(/[:.]/g, '-'));
    mkdirSync(dir, { recursive: true });
    for (const k of changed) if (existsSync(f[k])) copyFileSync(f[k], path.join(dir, `${k}.json`));
    const root = path.join(paths.data, '.backups', id);
    const old = readdirSync(root).sort().slice(0, -KEEP_BACKUPS);
    for (const d of old) rmSync(path.join(root, d), { recursive: true, force: true });
  }

  function write(file: string, text: string): void {
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, text, 'utf8');
    renameSync(tmp, file);
  }

  async function save(id: string, req: IncomingMessage): Promise<unknown> {
    if (req.headers['x-editor'] !== '1') throw new HttpError(403, 'missing X-Editor header');
    const body = (await readBody(req)) as { etag?: unknown; map?: unknown; callouts?: unknown; work?: unknown; manifest?: unknown };
    if (body.etag !== etagOf(id)) throw new HttpError(409, 'the files changed on disk since they were loaded');
    const map = MapSchema.parse(body.map);
    if (map.id !== id) throw new HttpError(400, `the map record says ${map.id}`);
    const callouts = CalloutsFileSchema.parse(body.callouts);
    const work = WorkFileSchema.parse(body.work);
    for (const c of callouts) if (c.map !== id) throw new HttpError(400, `${c.id} belongs to ${c.map}`);

    const f = files(id);
    const next = { map: stableJson(map), callouts: stableJson(callouts), work: stableJson(work) };
    const same = (file: string, text: string) => existsSync(file) && isDeepStrictEqual(JSON.parse(readText(file)), JSON.parse(text));
    const changed = (['map', 'callouts', 'work'] as const).filter((k) => !same(f[k], next[k]));
    if (changed.length > 0) {
      backup(id, changed);
      for (const k of changed) write(f[k], next[k]);
    }
    const manifest = body.manifest as { shots?: unknown[] } | null | undefined;
    if (manifest && Array.isArray(manifest.shots) && manifest.shots.length > 0) write(f.manifest, stableJson(manifest));
    else if (existsSync(f.manifest)) rmSync(f.manifest);
    return { etag: etagOf(id), wrote: changed };
  }

  function sendFile(res: ServerResponse, file: string, type: string): void {
    if (!existsSync(file) || !statSync(file).isFile()) throw new HttpError(404, 'no such file');
    res.writeHead(200, { 'content-type': type, 'content-length': statSync(file).size, 'cache-control': 'no-cache' });
    createReadStream(file).pipe(res);
  }

  return {
    name: 'callouts-editor',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__editor', (req, res, next) => {
        void (async () => {
          try {
            // only the local machine: the dev server can be reached by name, and files must not follow
            const host = (req.headers.host ?? '').replace(/:\d+$/, '');
            if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) throw new HttpError(403, 'the editor only answers on localhost');
            const url = new URL(req.url ?? '/', 'http://localhost');
            const parts = url.pathname.split('/').filter(Boolean);
            const [what, name] = parts;
            if (req.method === 'GET' && what === 'maps' && parts.length === 1) return send(res, 200, list());
            if (what === 'map' && name && MAP_ID.test(name) && parts.length === 2) {
              if (req.method === 'GET') return send(res, 200, load(name));
              if (req.method === 'PUT') return send(res, 200, await save(name, req));
            }
            if (req.method === 'GET' && what === 'nav' && name && MAP_ID.test(name)) return sendFile(res, files(name).nav, 'application/json');
            if (req.method === 'GET' && what === 'radar' && name && FILE_NAME.test(name)) return sendFile(res, path.join(paths.assets, 'radars', `${name}.png`), 'image/png');
            next();
          } catch (e) {
            if (e instanceof HttpError) return send(res, e.status, { error: e.message });
            if (e instanceof Error && e.name === 'ZodError') return send(res, 422, { error: 'the data failed validation', detail: e.message });
            console.error('[editor]', e);
            send(res, 500, { error: e instanceof Error ? e.message : 'unexpected error' });
          }
        })();
      });
    },
  };
}

// Serves the processed screenshots at /shots/<map>/<callout>-<n>.avif in `vite dev` and `vite preview`, and copies
// them into the production build (SCOPE.md §3.5, §7.8). The files are generated from the user's own game install and
// are never committed (§9), so the folder may not exist: requests then get a plain 404 and the build copies nothing.
//
// Everything under /shots/ is answered here, 404 included. Letting a missing file fall through would hand the browser
// the app's index.html with status 200, and a broken screenshot would look like a loaded one.

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import type { IncomingHttpHeaders } from 'node:http';
import path from 'node:path';
import type { Plugin } from 'vite';

export interface ShotsPaths {
  /** The processed screenshots: <assets>/shots/<map>/<callout>-<n>.avif (SCOPE §9: generated, never committed). */
  shots: string;
}

export interface ShotsOptions {
  /**
   * `revalidate` (default): the browser keeps a copy but asks the server whether it is still current, which costs a
   * 304 on localhost. The file for a shot is named by callout and number, not by its content, so a recapture
   * replaces it under the same name and must show up. `immutable` is for the day the names carry a content hash.
   */
  cache?: 'revalidate' | 'immutable';
}

/** The image types a shots folder holds; anything else in it is not served or copied. */
export const SHOT_TYPES: Readonly<Record<string, string>> = {
  '.avif': 'image/avif',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

const CACHE_CONTROL = {
  revalidate: 'public, no-cache',
  immutable: 'public, max-age=31536000, immutable',
} as const;

/** The parts of a Node request and response the handler touches, so a test can pass plain objects. */
export interface ShotsRequest {
  url?: string | undefined;
  method?: string | undefined;
  headers: IncomingHttpHeaders;
}
export interface ShotsResponse {
  statusCode: number;
  setHeader(name: string, value: string | number): unknown;
  end(body?: Buffer | string): unknown;
}
export type ShotsHandler = (req: ShotsRequest, res: ShotsResponse, next: (err?: unknown) => void) => Promise<void>;

function reply(res: ShotsResponse, status: number, text: string, extra: Record<string, string> = {}): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
  res.end(text);
}

/** Does an `If-None-Match` header (a list of validators, or `*`) match this ETag? Weak and strong compare the same here. */
function matches(header: string | string[] | undefined, etag: string): boolean {
  if (!header) return false;
  const wanted = etag.replace(/^W\//, '');
  return String(header)
    .split(',')
    .map((v) => v.trim().replace(/^W\//, ''))
    .some((v) => v === '*' || v === wanted);
}

/**
 * A Connect-style middleware for requests under `<prefix>` (default `/shots/`). `root` is the shots folder. Only GET
 * and HEAD; only the image types above; no dot-files; nothing that leaves `root`, by path or by symbolic link.
 */
export function createShotsHandler(root: string, options: ShotsOptions & { prefix?: string } = {}): ShotsHandler {
  const prefix = options.prefix ?? '/shots/';
  const cacheControl = CACHE_CONTROL[options.cache ?? 'revalidate'];
  const base = path.resolve(root);

  return async (req, res, next) => {
    const pathname = (req.url ?? '').split(/[?#]/, 1)[0] ?? '';
    if (!pathname.startsWith(prefix)) return next();

    const method = req.method ?? 'GET';
    if (method !== 'GET' && method !== 'HEAD') return reply(res, 405, 'method not allowed', { Allow: 'GET, HEAD' });

    let relative: string;
    try {
      relative = decodeURIComponent(pathname.slice(prefix.length));
    } catch {
      return reply(res, 400, 'bad request');
    }
    // Anything that could name a place outside the folder, or a hidden file, is the same 404 as a file that is not there.
    const parts = relative.split('/');
    const unsafe = relative.includes('\0') || relative.includes('\\') || parts.some((p) => p === '' || p.startsWith('.'));
    const type = SHOT_TYPES[path.extname(relative).toLowerCase()];
    if (unsafe || !type) return reply(res, 404, 'not found');

    const file = path.join(base, ...parts);
    const inside = path.relative(base, file);
    if (inside === '' || inside.startsWith('..') || path.isAbsolute(inside)) return reply(res, 404, 'not found');

    try {
      // a link inside the folder that points outside it is outside too
      const [real, realBase] = await Promise.all([realpath(file), realpath(base)]);
      const within = path.relative(realBase, real);
      if (within.startsWith('..') || path.isAbsolute(within)) return reply(res, 404, 'not found');
      const info = await stat(real);
      if (!info.isFile()) return reply(res, 404, 'not found');

      const etag = `W/"${info.size.toString(16)}-${Math.round(info.mtimeMs).toString(16)}"`;
      res.setHeader('ETag', etag);
      res.setHeader('Last-Modified', info.mtime.toUTCString());
      res.setHeader('Cache-Control', cacheControl);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (matches(req.headers['if-none-match'], etag)) {
        res.statusCode = 304;
        res.end();
        return;
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', type);
      res.setHeader('Content-Length', info.size);
      if (method === 'HEAD') {
        res.end();
        return;
      }
      res.end(await readFile(real));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT' || (e as NodeJS.ErrnoException).code === 'ENOTDIR') return reply(res, 404, 'not found');
      reply(res, 500, 'could not read the file');
    }
  };
}

/** Copies the images under `from` (recursively, same layout) to `to`. Returns what was copied; nothing if `from` is missing. */
export function copyShots(from: string, to: string): { files: number; bytes: number } {
  const out = { files: 0, bytes: 0 };
  if (!existsSync(from) || !statSync(from).isDirectory()) return out;
  const walk = (dir: string, rel: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const source = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(source, path.join(rel, entry.name));
      else if (entry.isFile() && SHOT_TYPES[path.extname(entry.name).toLowerCase()]) {
        mkdirSync(path.join(to, rel), { recursive: true });
        copyFileSync(source, path.join(to, rel, entry.name));
        out.files += 1;
        out.bytes += statSync(source).size;
      }
    }
  };
  walk(from, '');
  return out;
}

export function shotsPlugin(paths: ShotsPaths, options: ShotsOptions = {}): Plugin {
  let base = '/';
  let resolved: { command: string; root: string; outDir: string; ssr: boolean; info(msg: string): void } | null = null;
  const handler = () => createShotsHandler(paths.shots, { ...options, prefix: `${base}shots/` });

  return {
    name: 'callouts-shots',
    configResolved(config) {
      base = config.base.endsWith('/') ? config.base : `${config.base}/`;
      resolved = { command: config.command, root: config.root, outDir: config.build.outDir, ssr: Boolean(config.build.ssr), info: (m) => config.logger.info(m) };
    },
    configureServer(server) {
      server.middlewares.use(handler());
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler());
    },
    closeBundle() {
      if (!resolved || resolved.command !== 'build' || resolved.ssr) return;
      const to = path.resolve(resolved.root, resolved.outDir, 'shots');
      const { files, bytes } = copyShots(paths.shots, to);
      if (files > 0) resolved.info(`callouts-shots: copied ${files} screenshot${files === 1 ? '' : 's'} (${(bytes / 1024).toFixed(0)} KB) to ${path.relative(resolved.root, to)}`);
    },
  };
}

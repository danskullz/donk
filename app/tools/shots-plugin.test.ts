// The /shots middleware with plain request and response objects, the copy into the build, and a real `vite build`
// of a tiny project to prove the plugin puts the screenshots in the output folder. The dev and preview servers
// themselves are exercised over HTTP, in a browser, by e2e/shots.spec.ts.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { copyShots, createShotsHandler, shotsPlugin, SHOT_TYPES, type ShotsHandler } from './shots-plugin';

const root = mkdtempSync(path.join(tmpdir(), 'callouts-shots-test-'));
const shots = path.join(root, 'assets', 'shots');
const AVIF = Buffer.from('not really an avif, but bytes are bytes');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

beforeAll(() => {
  mkdirSync(path.join(shots, 'mirage'), { recursive: true });
  writeFileSync(path.join(shots, 'mirage', 'palace-1.avif'), AVIF);
  writeFileSync(path.join(shots, 'mirage', 'palace-2.WEBP'), 'webp');
  writeFileSync(path.join(shots, 'mirage', 'shot_01.png'), PNG);
  writeFileSync(path.join(shots, 'mirage', 'notes.txt'), 'not an image');
  writeFileSync(path.join(shots, 'mirage', '.hidden.avif'), 'hidden');
  mkdirSync(path.join(shots, 'mirage', 'folder.avif'));
  writeFileSync(path.join(root, 'secret.png'), 'outside the shots folder');
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

interface Result {
  status: number;
  headers: Record<string, string | number>;
  body: Buffer | string | undefined;
  nexted: boolean;
}

async function call(handler: ShotsHandler, url: string, init: { method?: string; headers?: Record<string, string> } = {}): Promise<Result> {
  const headers: Record<string, string | number> = {};
  const out: Result = { status: 200, headers, body: undefined, nexted: false };
  const res = {
    statusCode: 200,
    setHeader(name: string, value: string | number) {
      headers[name.toLowerCase()] = value;
    },
    end(body?: Buffer | string) {
      out.status = res.statusCode;
      out.body = body;
    },
  };
  await handler({ url, method: init.method ?? 'GET', headers: init.headers ?? {} }, res, () => {
    out.nexted = true;
  });
  return out;
}

describe('the /shots handler', () => {
  const handler = createShotsHandler(shots);

  it('serves a file with its content type, length and a revalidating cache policy', async () => {
    const r = await call(handler, '/shots/mirage/palace-1.avif');
    expect(r.status).toBe(200);
    expect(r.body).toEqual(AVIF);
    expect(r.headers['content-type']).toBe('image/avif');
    expect(r.headers['content-length']).toBe(AVIF.length);
    expect(r.headers['cache-control']).toBe('public, no-cache');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(String(r.headers['etag'])).toMatch(/^W\/"[0-9a-f]+-[0-9a-f]+"$/);
    expect(r.headers['last-modified']).toBeTruthy();
  });

  it('knows the other image types and ignores the case of the extension', async () => {
    expect((await call(handler, '/shots/mirage/palace-2.WEBP')).headers['content-type']).toBe('image/webp');
    expect((await call(handler, '/shots/mirage/shot_01.png')).headers['content-type']).toBe('image/png');
    expect(Object.values(SHOT_TYPES)).toEqual(['image/avif', 'image/webp', 'image/png', 'image/jpeg', 'image/jpeg']);
  });

  it('ignores a query string and a fragment', async () => {
    expect((await call(handler, '/shots/mirage/palace-1.avif?v=3')).status).toBe(200);
    expect((await call(handler, '/shots/mirage/palace-1.avif#x')).status).toBe(200);
  });

  it('answers 304 with no body when the validator still matches, and 200 when it does not', async () => {
    const first = await call(handler, '/shots/mirage/palace-1.avif');
    const etag = String(first.headers['etag']);
    const same = await call(handler, '/shots/mirage/palace-1.avif', { headers: { 'if-none-match': etag } });
    expect(same.status).toBe(304);
    expect(same.body).toBeUndefined();
    expect((await call(handler, '/shots/mirage/palace-1.avif', { headers: { 'if-none-match': `"other", ${etag}` } })).status).toBe(304);
    expect((await call(handler, '/shots/mirage/palace-1.avif', { headers: { 'if-none-match': '*' } })).status).toBe(304);
    expect((await call(handler, '/shots/mirage/palace-1.avif', { headers: { 'if-none-match': 'W/"0-0"' } })).status).toBe(200);
  });

  it('answers HEAD with the headers and no body', async () => {
    const r = await call(handler, '/shots/mirage/palace-1.avif', { method: 'HEAD' });
    expect(r.status).toBe(200);
    expect(r.body).toBeUndefined();
    expect(r.headers['content-length']).toBe(AVIF.length);
  });

  it('is 404 for a file that is not there, not the app page', async () => {
    for (const url of ['/shots/mirage/missing.avif', '/shots/nomap/palace-1.avif', '/shots/', '/shots/mirage/', '/shots/mirage//palace-1.avif']) {
      const r = await call(handler, url);
      expect({ url, status: r.status, nexted: r.nexted }).toEqual({ url, status: 404, nexted: false });
    }
  });

  it('is 404 for a folder, a hidden file, and a file that is not an image', async () => {
    for (const url of ['/shots/mirage/folder.avif', '/shots/mirage/.hidden.avif', '/shots/mirage/notes.txt', '/shots/mirage']) {
      expect((await call(handler, url)).status).toBe(404);
    }
  });

  it('refuses every way of climbing out of the folder', async () => {
    const attempts = [
      '/shots/../secret.png',
      '/shots/%2e%2e/secret.png',
      '/shots/%2E%2E/%2E%2E/secret.png',
      '/shots/mirage/../../secret.png',
      '/shots/mirage/..%2f..%2fsecret.png',
      '/shots/..%2f..%2f..%2fsecret.png',
      '/shots/mirage/..%5c..%5csecret.png',
      '/shots/mirage%5c..%5c..%5csecret.png',
      `/shots/${encodeURIComponent(path.join(root, 'secret.png'))}`,
      `/shots//${root.replace(/\\/g, '/')}/secret.png`,
      '/shots/mirage/palace-1.avif%00.png',
      '/shots/%00.png',
      '/shots/C:/Windows/win.ini',
      '/shots/mirage/..%252f..%252fsecret.png',
    ];
    for (const url of attempts) {
      const r = await call(handler, url);
      expect({ url, status: r.status }).toEqual({ url, status: 404 });
      expect(String(r.body)).not.toContain('outside the shots folder');
    }
  });

  it('is 400 for a malformed percent escape', async () => {
    expect((await call(handler, '/shots/mirage/%E0%A4%A.avif')).status).toBe(400);
  });

  it('refuses a link inside the folder that points outside it (when the system lets the test make one)', async (ctx) => {
    try {
      symlinkSync(path.join(root, 'secret.png'), path.join(shots, 'mirage', 'link.png'));
    } catch {
      ctx.skip();
      return;
    }
    const r = await call(handler, '/shots/mirage/link.png');
    expect(r.status).toBe(404);
    expect(String(r.body)).not.toContain('outside the shots folder');
  });

  it('allows only GET and HEAD, and says so', async () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const r = await call(handler, '/shots/mirage/palace-1.avif', { method });
      expect(r.status).toBe(405);
      expect(r.headers['allow']).toBe('GET, HEAD');
    }
  });

  it('leaves every other address to the next handler', async () => {
    for (const url of ['/', '/index.html', '/assets/app.js', '/shot', '/shotsx/a.avif', '/data/shots/a.avif', '/@vite/client']) {
      expect((await call(handler, url)).nexted).toBe(true);
    }
  });

  it('answers 404, not an error, when the whole folder does not exist', async () => {
    const none = createShotsHandler(path.join(root, 'no-such-folder'));
    const r = await call(none, '/shots/mirage/palace-1.avif');
    expect(r.status).toBe(404);
  });

  it('can be told to cache for good, and to serve under a base path', async () => {
    const strong = createShotsHandler(shots, { cache: 'immutable', prefix: '/callouts/shots/' });
    expect((await call(strong, '/callouts/shots/mirage/palace-1.avif')).headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect((await call(strong, '/shots/mirage/palace-1.avif')).nexted).toBe(true);
  });
});

describe('copyShots', () => {
  it('copies the images with their folders and leaves out everything else', () => {
    const to = path.join(root, 'copy-a');
    const done = copyShots(shots, to);
    expect(readdirSync(path.join(to, 'mirage')).sort()).toEqual(['palace-1.avif', 'palace-2.WEBP', 'shot_01.png']);
    expect(done.files).toBe(3);
    expect(done.bytes).toBe(AVIF.length + 'webp'.length + PNG.length);
    expect(readFileSync(path.join(to, 'mirage', 'palace-1.avif'))).toEqual(AVIF);
  });

  it('does nothing, and does not create the destination, when there is no source folder', () => {
    const to = path.join(root, 'copy-b');
    expect(copyShots(path.join(root, 'nope'), to)).toEqual({ files: 0, bytes: 0 });
    expect(existsSync(to)).toBe(false);
  });
});

describe('the production build', () => {
  /** A one-page project, built with only the shots plugin. */
  async function buildProject(name: string, shotsDir: string): Promise<string> {
    const project = path.join(root, name);
    mkdirSync(project, { recursive: true });
    writeFileSync(path.join(project, 'index.html'), '<!doctype html><title>t</title><script type="module" src="/main.js"></script>');
    writeFileSync(path.join(project, 'main.js'), 'console.log("hi");');
    await build({ root: project, configFile: false, logLevel: 'silent', plugins: [shotsPlugin({ shots: shotsDir })] });
    return path.join(project, 'dist');
  }

  it('copies the screenshots into <outDir>/shots, after the output folder is emptied', async () => {
    const dist = await buildProject('project-a', shots);
    expect(existsSync(path.join(dist, 'index.html'))).toBe(true);
    expect(readFileSync(path.join(dist, 'shots', 'mirage', 'palace-1.avif'))).toEqual(AVIF);
    expect(readFileSync(path.join(dist, 'shots', 'mirage', 'shot_01.png'))).toEqual(PNG);
    expect(existsSync(path.join(dist, 'shots', 'mirage', 'notes.txt'))).toBe(false);
    expect(existsSync(path.join(dist, 'shots', 'mirage', '.hidden.avif'))).toBe(false);
  }, 60_000);

  it('builds without complaint, and without a shots folder in the output, when there are no screenshots', async () => {
    const dist = await buildProject('project-b', path.join(root, 'assets', 'not-built'));
    expect(existsSync(path.join(dist, 'index.html'))).toBe(true);
    expect(existsSync(path.join(dist, 'shots'))).toBe(false);
  }, 60_000);
});

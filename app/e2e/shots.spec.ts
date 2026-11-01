// /shots serving (tools/shots-plugin.ts), proved against real servers: the app's own vite.config.ts started inside the
// test on a free port with CALLOUTS_SHOTS_DIR pointing at a temp folder, once as the dev server and once as the preview
// server of a production build. The pictures are tiny AVIFs made with sharp; the real ones are generated from Dan's
// own game install and are not in the repository. The synthetic map draws its pictures inline (src/dev/demo-data.ts)
// and never asks /shots for anything, so these tests ask for it directly, the way Study and the session will for Mirage.
//
// Not part of the shared preview server in playwright.config.ts: this spec starts its own, so it uses absolute URLs.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test as base, type Page } from '@playwright/test';
import sharp from 'sharp';
import { build, createServer, preview } from 'vite';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configFile = path.join(appRoot, 'vite.config.ts');

interface Served {
  /** http://127.0.0.1:<port> */
  origin: string;
  close(): Promise<void>;
}

interface World {
  /** The temp folder CALLOUTS_SHOTS_DIR points at. */
  shots: string;
  /** A file next to it that must never be served. */
  secret: string;
  dev: Served;
  prod: Served & { outDir: string };
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

async function avif(color: string, width = 1280, height = 720): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: color } }).avif({ quality: 40, effort: 0 }).toBuffer();
}

/** One server pair per worker: the build takes a few seconds, and nothing in these tests changes the app. */
const test = base.extend<object, { world: World }>({
  world: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const root = mkdtempSync(path.join(tmpdir(), 'callouts-shots-e2e-'));
      const shots = path.join(root, 'shots');
      const secret = path.join(root, 'secret.png');
      mkdirSync(path.join(shots, 'test'), { recursive: true });
      writeFileSync(path.join(shots, 'test', 'palace-1.avif'), await avif('#335577'));
      writeFileSync(path.join(shots, 'test', 'palace-2.avif'), await avif('#775533'));
      writeFileSync(path.join(shots, 'test', 'notes.txt'), 'not an image');
      writeFileSync(secret, 'SECRET outside the shots folder');

      // vite.config.ts reads this when it loads, so it is set before either server is created
      const before = process.env.CALLOUTS_SHOTS_DIR;
      process.env.CALLOUTS_SHOTS_DIR = shots;

      const devPort = await freePort();
      const devServer = await createServer({ root: appRoot, configFile, logLevel: 'error', server: { host: '127.0.0.1', port: devPort, strictPort: true, hmr: false, watch: null } });
      await devServer.listen();

      // the e2e build, as playwright.config.ts makes it, but into a temp folder of its own
      const outDir = path.join(root, 'dist');
      await build({ root: appRoot, configFile, mode: 'e2e', logLevel: 'error', build: { outDir, emptyOutDir: true } });
      const prodPort = await freePort();
      const prodServer = await preview({ root: appRoot, configFile, mode: 'e2e', logLevel: 'error', build: { outDir }, preview: { host: '127.0.0.1', port: prodPort, strictPort: true } });

      await use({
        shots,
        secret,
        dev: { origin: `http://127.0.0.1:${devPort}`, close: () => devServer.close() },
        prod: { origin: `http://127.0.0.1:${prodPort}`, outDir, close: () => prodServer.close() },
      });

      await Promise.all([devServer.close(), prodServer.close()]);
      if (before === undefined) delete process.env.CALLOUTS_SHOTS_DIR;
      else process.env.CALLOUTS_SHOTS_DIR = before;
      rmSync(root, { recursive: true, force: true });
    },
    { scope: 'worker', timeout: 240_000 },
  ],
});

/** A GET with the path sent exactly as written: no client normalises `..` or `%2e` away before the server sees it. */
function rawGet(origin: string, rawPath: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  const url = new URL(origin);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: url.hostname, port: url.port, path: rawPath, method: 'GET', headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

/** Does the browser decode the picture at this address? Its size if so, null if the load fails. */
async function decode(page: Page, src: string): Promise<{ width: number; height: number } | null> {
  return page.evaluate(
    (url) =>
      new Promise<{ width: number; height: number } | null>((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => resolve(null);
        img.src = url;
      }),
    src,
  );
}

// one worker, in order: the servers and the build are made once, and the tests that change files do not race the others
test.describe.configure({ mode: 'serial' });

for (const which of ['dev', 'prod'] as const) {
  test.describe(`${which === 'dev' ? 'the dev server' : 'the preview server of a production build'}`, () => {
    test('serves a screenshot as AVIF, with a validator and a cache policy that always asks', async ({ world }) => {
      const r = await rawGet(world[which].origin, '/shots/test/palace-1.avif');
      expect(r.status).toBe(200);
      expect(r.headers['content-type']).toBe('image/avif');
      expect(r.headers['cache-control']).toBe('public, no-cache');
      expect(r.headers['x-content-type-options']).toBe('nosniff');
      expect(r.headers['etag']).toMatch(/^W\/"[0-9a-f]+-[0-9a-f]+"$/);
      expect(Number(r.headers['content-length'])).toBe(r.body.length);
      expect(r.body.equals(readFileSync(path.join(world.shots, 'test', 'palace-1.avif')))).toBe(true);
    });

    test('answers a repeat request with 304 and nothing in the body', async ({ world }) => {
      const first = await rawGet(world[which].origin, '/shots/test/palace-2.avif');
      const again = await rawGet(world[which].origin, '/shots/test/palace-2.avif', { 'if-none-match': String(first.headers['etag']) });
      expect(again.status).toBe(304);
      expect(again.body).toHaveLength(0);
    });

    test('a missing screenshot is a 404 in plain text, never the app page with status 200', async ({ world }) => {
      const app = await rawGet(world[which].origin, '/');
      expect(app.status).toBe(200);
      expect(String(app.headers['content-type'])).toContain('text/html');
      for (const missing of ['/shots/test/nothing-9.avif', '/shots/nomap/palace-1.avif', '/shots/test/', '/shots/', '/shots/test/notes.txt']) {
        const r = await rawGet(world[which].origin, missing);
        expect({ missing, status: r.status, type: String(r.headers['content-type']).split(';')[0] }).toEqual({ missing, status: 404, type: 'text/plain' });
        expect(r.body.toString()).not.toContain('<!doctype');
      }
    });

    test('does not serve anything from outside the shots folder', async ({ world }) => {
      const attempts = [
        '/shots/../secret.png',
        '/shots/%2e%2e/secret.png',
        '/shots/test/..%2f..%2fsecret.png',
        '/shots/..%2fsecret.png',
        '/shots/test/..%5c..%5csecret.png',
        `/shots/${encodeURIComponent(world.secret)}`,
        '/shots/test/palace-1.avif%00.png',
      ];
      for (const rawPath of attempts) {
        const r = await rawGet(world[which].origin, rawPath);
        expect(r.body.toString()).not.toContain('SECRET');
        expect({ rawPath, ok: r.status === 200 && String(r.headers['content-type']).startsWith('image/') }).toEqual({ rawPath, ok: false });
      }
    });

    test('a browser decodes the screenshot, and gets an error rather than a picture for a missing one', async ({ page, world }) => {
      await page.goto(world[which].origin);
      expect(await decode(page, '/shots/test/palace-1.avif')).toEqual({ width: 1280, height: 720 });
      expect(await decode(page, '/shots/test/nothing-9.avif')).toBeNull();
    });
  });
}

test.describe('the dev server', () => {
  test('shows a recapture under the same name: the browser asks again and gets the new picture', async ({ world, page }) => {
    const file = path.join(world.shots, 'test', 'recapture-1.avif');
    writeFileSync(file, await avif('#223344', 1280, 720));
    const before = await rawGet(world.dev.origin, '/shots/test/recapture-1.avif');
    expect(before.status).toBe(200);

    // different size and a later time, so the validator changes whatever the file system's clock resolution
    writeFileSync(file, await avif('#aa4433', 1280, 720));
    const later = new Date(Date.now() + 5000);
    utimesSync(file, later, later);
    const after = await rawGet(world.dev.origin, '/shots/test/recapture-1.avif', { 'if-none-match': String(before.headers['etag']) });
    expect(after.status).toBe(200);
    expect(after.body.equals(readFileSync(file))).toBe(true);
    expect(after.headers['etag']).not.toBe(before.headers['etag']);

    // and a browser that has the old picture cached still ends up with a decodable one
    await page.goto(world.dev.origin);
    expect(await decode(page, '/shots/test/recapture-1.avif')).toEqual({ width: 1280, height: 720 });
  });

  test('answers 404, not an error page, once a file has been deleted', async ({ world }) => {
    const gone = path.join(world.shots, 'test', 'soon-gone.avif');
    writeFileSync(gone, await avif('#445566'));
    expect((await rawGet(world.dev.origin, '/shots/test/soon-gone.avif')).status).toBe(200);
    rmSync(gone);
    expect((await rawGet(world.dev.origin, '/shots/test/soon-gone.avif')).status).toBe(404);
  });
});

test.describe('the production build', () => {
  test('carries the screenshots in its output folder, images only, with the same layout', async ({ world }) => {
    const copied = path.join(world.prod.outDir, 'shots', 'test');
    // the files that exist when the build runs: the two pictures made in the fixture, not the note
    expect(readFileSync(path.join(copied, 'palace-1.avif')).equals(readFileSync(path.join(world.shots, 'test', 'palace-1.avif')))).toBe(true);
    expect(statSync(path.join(copied, 'palace-2.avif')).size).toBeGreaterThan(0);
    expect(() => statSync(path.join(copied, 'notes.txt'))).toThrow();
  });
});

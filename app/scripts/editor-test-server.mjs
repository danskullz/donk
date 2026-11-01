// A dev server for the Editor's browser tests (`pnpm e2e:editor`): the normal Vite dev server, with the editor plugin
// pointed at a throw-away fixture copy in the temp directory (scripts/editor-fixture.mjs) instead of /data.
//
//   node scripts/editor-test-server.mjs [port]      (default 5174)

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { FIXTURE_ASSETS, FIXTURE_DATA, writeFixture } from './editor-fixture.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] ?? process.env.EDITOR_E2E_PORT ?? 5174);

// vite.config.ts reads these when the server is created
process.env.CALLOUTS_DATA_DIR = FIXTURE_DATA;
process.env.CALLOUTS_ASSETS_DIR = FIXTURE_ASSETS;

const server = await createServer({ root: appRoot, logLevel: 'warn', server: { port, strictPort: true, host: 'localhost' } });
const { makeGridMesh, makeGridMap } = await server.ssrLoadModule('/src/core/editor/test-fixtures.ts');
// the same mesh the tests build, with a band of half-height areas so the T-junction code is exercised too
writeFixture(makeGridMesh({ cols: 8, rows: 4, halfFrom: 4, halfCols: 1 }).mesh, makeGridMap());
await server.listen();
server.printUrls();

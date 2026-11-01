// The Editor's browser tests run against a throw-away copy of the data folders in the system temp directory, so a test
// can write files without touching /data. This writes that copy: a map index, one small map ("de_grid") with a flat grid
// nav mesh, and no callouts. Shared by the test server (scripts/editor-test-server.mjs) and the tests (e2e-editor/).

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const FIXTURE_ROOT = path.join(os.tmpdir(), 'callouts-editor-e2e');
export const FIXTURE_DATA = path.join(FIXTURE_ROOT, 'data');
export const FIXTURE_ASSETS = path.join(FIXTURE_ROOT, 'assets');

const json = (file, value) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};

/** Start from nothing: wipe the folders and write the map, an empty callout list and the mesh. */
export function writeFixture(mesh, map) {
  rmSync(FIXTURE_ROOT, { recursive: true, force: true });
  json(path.join(FIXTURE_DATA, 'index.json'), [{ id: map.id, displayName: map.displayName, pool: map.pool, available: true }]);
  json(path.join(FIXTURE_DATA, 'maps', `${map.id}.json`), map);
  json(path.join(FIXTURE_DATA, 'callouts', `${map.id}.json`), []);
  json(path.join(FIXTURE_ASSETS, 'nav', `${map.id}.json`), mesh);
}

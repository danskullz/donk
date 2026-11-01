// `pnpm content:init-map de_nuke --zones "T Spawn, Mid, ..."`: creates data/maps/<id>.json and an empty
// data/callouts/<id>.json for a map that has none, from Valve's overview data, so the Editor can open the map.
// The rules live in src/core/mapinit.ts (unit tested); this file only reads and writes. Usage and the commands for the
// other nine maps: docs/notes/init-map.md.
//
//   --zones "<a>, <b>, ..."   required. The zones are Dan's choice, so there is no default; ids are made from the names
//   --overviews <path>        default ../assets/valve/overviews/overviews.json (relative to app/ unless you give a path)
//   --data <dir>              default ../data
//   --force                   replace existing files (copies them to <data>/.backups/<id>/<time>/ first)
//
// data/index.json is read, never written: `available` stays as it is. Exits 1, having written nothing, on any problem.
//
// The core is TypeScript, so it is loaded through Vite's module runner, as in validate-content.mjs.

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createServer } from 'vite';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const USAGE = `usage: node scripts/init-map.mjs <map id> --zones "<zone>, <zone>, ..." [--overviews <file>] [--data <dir>] [--force]
   or: pnpm content:init-map <map id> --zones "..."   (PowerShell: pnpm.cmd)

  <map id>     a map listed in data/index.json that has no record yet, like de_nuke
  --zones      the map's zones, comma separated, in the order you want them. Required: you choose them.
  --overviews  Valve's overview file (default: ../assets/valve/overviews/overviews.json)
  --data       the content folder (default: ../data)
  --force      replace the map's existing files; the old ones are copied to <data>/.backups first`;

/** A problem with the input or the files that the owner can fix: printed as one line, without a stack. */
class Problem extends Error {}

// A leading `--` is what people type after `pnpm content:art`; node passes it through, parseArgs would stop at it.
const args = process.argv.slice(2);
if (args[0] === '--') args.shift();

let parsed;
try {
  parsed = parseArgs({
    args,
    allowPositionals: true,
    options: {
      zones: { type: 'string' },
      overviews: { type: 'string' },
      data: { type: 'string' },
      force: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
} catch (e) {
  console.error(`error: ${e.message}\n\n${USAGE}`);
  process.exit(1);
}
const { values, positionals } = parsed;
if (values.help) {
  console.log(USAGE);
  process.exit(0);
}
if (positionals.length !== 1) {
  console.error(`error: give exactly one map id, like de_nuke\n\n${USAGE}`);
  process.exit(1);
}
const mapId = positionals[0];

const dataDir = path.resolve(values.data ?? path.join(appRoot, '..', 'data'));
const overviewsFile = path.resolve(values.overviews ?? path.join(appRoot, '..', 'assets', 'valve', 'overviews', 'overviews.json'));
// Paths as the docs write them (data/maps/de_nuke.json) when inside the repository, absolute otherwise.
const repoRoot = path.resolve(appRoot, '..');
const here = (file) => {
  const rel = path.relative(repoRoot, file);
  return rel === '' || rel.startsWith('..') || path.isAbsolute(rel) ? file : rel.split(path.sep).join('/');
};

function readJson(file, what, hint) {
  if (!existsSync(file)) throw new Problem(`${what} was not found at ${file}${hint ? `\n${hint}` : ''}`);
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Problem(`${what} (${file}) is not valid JSON: ${e.message}`);
  }
}

const heights = (l) => {
  if (l.altitudeMin === undefined && l.altitudeMax === undefined) return 'any height';
  if (l.altitudeMax === undefined) return `z ${l.altitudeMin} and above`;
  if (l.altitudeMin === undefined) return `z below ${l.altitudeMax}`;
  return `z ${l.altitudeMin} up to ${l.altitudeMax}`;
};

const server = await createServer({
  root: appRoot,
  configFile: false,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true },
});

let failed = false;
try {
  const { findOverview, MapInitError, mapRecordFromOverview, overviewWarnings, parseZoneList, zonesFromNames } = await server.ssrLoadModule('/src/core/mapinit.ts');
  const { stableJson } = await server.ssrLoadModule('/src/core/editor/json.ts');
  const { MapIndexSchema } = await server.ssrLoadModule('/src/core/schema.ts');
  const { parseMapData } = await server.ssrLoadModule('/src/core/validate.ts');

  try {
    // Zones first: with none given there is nothing to do, whatever else is wrong.
    const zoneNames = parseZoneList(values.zones ?? '');
    zonesFromNames(zoneNames);

    const index = MapIndexSchema.safeParse(readJson(path.join(dataDir, 'index.json'), 'data/index.json'));
    if (!index.success) {
      throw new Problem(`${here(path.join(dataDir, 'index.json'))} is not valid: ${index.error.issues.map((i) => `${i.path.join('.') || '(index)'}: ${i.message}`).join('; ')}`);
    }
    const overviews = readJson(
      overviewsFile,
      'the overview file',
      'It is made from your CS2 install: content-tools/spike/radar.py extract <out_root> writes <out_root>/overviews/overviews.json (<out_root> is assets/valve here).\nIf it is somewhere else, pass --overviews <path>.',
    );

    const { gameBuildId, entry } = findOverview(overviews, mapId);
    const record = mapRecordFromOverview(mapId, entry, gameBuildId, { zones: zoneNames, index: index.data });
    const warnings = overviewWarnings(mapId, entry);

    // Check the exact text that will be written, with the rules the app and `pnpm content:validate` use.
    const mapText = stableJson(record);
    const calloutsText = stableJson([]);
    const checked = parseMapData(JSON.parse(mapText), JSON.parse(calloutsText));
    const errors = checked.issues.filter((i) => i.severity === 'error');
    if (errors.length > 0) throw new Problem(`the new record does not validate (nothing written):\n${errors.map((i) => `  [${i.rule}] ${i.message}`).join('\n')}`);

    const mapFile = path.join(dataDir, 'maps', `${mapId}.json`);
    const calloutsFile = path.join(dataDir, 'callouts', `${mapId}.json`);
    const existing = [mapFile, calloutsFile].filter((f) => existsSync(f));
    if (existing.length > 0 && !values.force) {
      throw new Problem(`${existing.map(here).join(' and ')} already exist${existing.length === 1 ? 's' : ''}; nothing was written. --force replaces ${existing.length === 1 ? 'it' : 'them'} (the old ${existing.length === 1 ? 'file is' : 'files are'} copied to ${here(path.join(dataDir, '.backups', mapId))} first).`);
    }

    let backedUp = null;
    if (existing.length > 0) {
      // The callouts file may hold real work, so --force must be undoable. Same folder layout as the Editor's backups.
      backedUp = path.join(dataDir, '.backups', mapId, new Date().toISOString().replace(/[:.]/g, '-'));
      mkdirSync(backedUp, { recursive: true });
      if (existsSync(mapFile)) copyFileSync(mapFile, path.join(backedUp, 'map.json'));
      if (existsSync(calloutsFile)) copyFileSync(calloutsFile, path.join(backedUp, 'callouts.json'));
    }
    mkdirSync(path.dirname(mapFile), { recursive: true });
    mkdirSync(path.dirname(calloutsFile), { recursive: true });
    writeFileSync(mapFile, mapText, 'utf8');
    writeFileSync(calloutsFile, calloutsText, 'utf8');

    const say = (line = '') => console.log(line);
    say(`${record.id}: ${record.displayName} (${record.pool}), game build ${record.gameBuild}`);
    say(`  projection  posX ${record.projection.posX}, posY ${record.projection.posY}, scale ${record.projection.scale}; radar ${record.radarSize} px`);
    say(`  levels      ${record.levels.map((l) => `${l.id} (${heights(l)})`).join(', ')}`);
    say(`  zones       ${record.zones.map((z) => `${z.name} [${z.id}]`).join(', ')}`);
    say();
    if (backedUp) say(`replaced files were copied to ${here(backedUp)}`);
    say(`wrote ${here(mapFile)}`);
    say(`wrote ${here(calloutsFile)} (empty list)`);
    const empty = checked.issues.filter((i) => i.rule === 'zone-empty').length;
    const other = checked.issues.filter((i) => i.rule !== 'zone-empty');
    say(`checked with the content rules: 0 errors, ${checked.issues.length} warning${checked.issues.length === 1 ? '' : 's'}${empty ? ` (${empty} zone-empty: no callouts yet)` : ''}`);
    for (const i of other) say(`  ${i.severity} [${i.rule}] ${i.message}`);
    for (const w of warnings) say(`warning: ${w}`);
    say();
    say(`${here(path.join(dataDir, 'index.json'))} was not changed; ${mapId} is still "available": ${index.data.find((m) => m.id === mapId)?.available}.`);
    say(`The Editor opens ${mapId} once assets/valve/nav/${mapId}.json (the nav mesh) exists too.`);
  } catch (e) {
    if (e instanceof Problem || e instanceof MapInitError) {
      console.error(`error: ${e.message}`);
      failed = true;
    } else throw e;
  }
} catch (e) {
  console.error(e instanceof Error ? (e.stack ?? e.message) : e);
  failed = true;
} finally {
  await server.close();
}
process.exit(failed ? 1 : 0);

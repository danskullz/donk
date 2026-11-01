// `pnpm content:validate`: checks everything under /data (SCOPE.md §7.7) with the same schemas and rules the
// app uses. Exits 1 on any error, or on any warning with --strict. Run it before committing content.
//
// The core is TypeScript, so it is loaded through Vite's module runner rather than compiled first.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.resolve(appRoot, '..', 'data');
const shotsDir = path.resolve(appRoot, '..', 'assets', 'shots');
const strict = process.argv.includes('--strict');

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

const server = await createServer({
  root: appRoot,
  configFile: false,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true },
});

let errors = 0;
let warnings = 0;
const say = (line = '') => console.log(line);
const report = (severity, rule, callout, message) => {
  if (severity === 'error') errors += 1;
  else warnings += 1;
  say(`  ${severity === 'error' ? 'error  ' : 'warning'} [${rule}]${callout ? ` ${callout}:` : ''} ${message}`);
};

try {
  const { parseMapData } = await server.ssrLoadModule('/src/core/validate.ts');
  const { MapIndexSchema } = await server.ssrLoadModule('/src/core/schema.ts');

  const indexFile = path.join(dataDir, 'index.json');
  if (!existsSync(indexFile)) throw new Error(`missing ${indexFile}`);
  const parsedIndex = MapIndexSchema.safeParse(readJson(indexFile));
  say('index.json');
  if (!parsedIndex.success) {
    for (const i of parsedIndex.error.issues) report('error', 'index-schema', '', `${i.path.join('.') || '(index)'}: ${i.message}`);
    throw new Error('index.json is not valid; fix it first');
  }
  const index = parsedIndex.data;
  say(`  ${index.length} maps, ${index.filter((m) => m.available).length} available`);

  const mapFiles = existsSync(path.join(dataDir, 'maps')) ? readdirSync(path.join(dataDir, 'maps')).filter((f) => f.endsWith('.json')) : [];
  for (const f of mapFiles) {
    const id = f.replace(/\.json$/, '');
    if (!index.some((m) => m.id === id)) report('error', 'index-missing', id, 'has a map file but is not listed in index.json');
  }

  const haveShots = existsSync(shotsDir);
  if (!haveShots) say('\n(assets/shots is not built here, so shot files are not checked for existence)');

  for (const entry of index) {
    const mapFile = path.join(dataDir, 'maps', `${entry.id}.json`);
    const calloutsFile = path.join(dataDir, 'callouts', `${entry.id}.json`);
    const present = existsSync(mapFile) && existsSync(calloutsFile);
    if (!entry.available) {
      if (present) say(`\n${entry.id}\n  data exists but the map is marked not available in index.json`);
      continue;
    }
    say(`\n${entry.id}`);
    if (!present) {
      const missing = [mapFile, calloutsFile].filter((f) => !existsSync(f)).map((f) => path.relative(dataDir, f));
      report('error', 'data-missing', '', `index.json says available, but ${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} missing`);
      continue;
    }
    const parsed = parseMapData(readJson(mapFile), readJson(calloutsFile));
    if (parsed.map) {
      if (parsed.map.id !== entry.id) report('error', 'map-id', '', `file says ${parsed.map.id}`);
      if (parsed.map.displayName !== entry.displayName || parsed.map.pool !== entry.pool) {
        report('error', 'index-mismatch', '', 'name or pool differs from index.json');
      }
    }
    if (parsed.callouts) {
      const tiers = [1, 2, 3].map((t) => parsed.callouts.filter((c) => c.tier === t).length);
      const verified = parsed.callouts.filter((c) => c.status === 'verified').length;
      say(`  ${parsed.map?.status ?? '?'} map, revision ${parsed.map?.revision ?? '?'}: ${parsed.callouts.length} callouts (Core ${tiers[0]}, Standard ${tiers[1]}, Hard ${tiers[2]}), ${verified} verified`);
      if (haveShots) {
        for (const c of parsed.callouts) {
          for (const s of c.shots) {
            if (!existsSync(path.join(shotsDir, s.file))) report('error', 'shot-file', c.id, `${s.file} is not in assets/shots`);
          }
        }
      }
    }
    for (const i of parsed.issues) report(i.severity, i.rule, i.callout, i.message);
  }
} catch (e) {
  errors += 1;
  console.error(`\n${e instanceof Error ? e.message : e}`);
} finally {
  await server.close();
}

say(`\n${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}${strict && warnings ? ' (strict: warnings fail)' : ''}`);
process.exit(errors > 0 || (strict && warnings > 0) ? 1 : 0);

// `pnpm content:validate`: checks everything under /data (SCOPE.md §7.7) with the same schemas and rules the
// app uses. Exits 1 on any error, or on any warning with --strict. Run it before committing content.
//
// Also checks the generated files when they exist: every screenshot a callout lists is in assets/shots (and files there
// that no callout lists are reported), and each map's art (data/art/<map>.json, `pnpm content:art`) is valid, current
// and inside the radar. The folders can be moved with CALLOUTS_DATA_DIR, CALLOUTS_SHOTS_DIR and CALLOUTS_ART_DIR.
//
// The core is TypeScript, so it is loaded through Vite's module runner rather than compiled first.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.resolve(process.env.CALLOUTS_DATA_DIR ?? path.join(appRoot, '..', 'data'));
const shotsDir = path.resolve(process.env.CALLOUTS_SHOTS_DIR ?? path.join(appRoot, '..', 'assets', 'shots'));
const artDir = path.resolve(process.env.CALLOUTS_ART_DIR ?? path.join(dataDir, 'art'));
const strict = process.argv.includes('--strict');
const ART_BUDGET = 150 * 1024;

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

const artSummary = (file) => {
  try {
    const art = JSON.parse(readFileSync(file, 'utf8'));
    return `${Object.keys(art.levels ?? {}).length} level${Object.keys(art.levels ?? {}).length === 1 ? '' : 's'}, ${(statSync(file).size / 1024).toFixed(1)} KB`;
  } catch {
    return 'unreadable';
  }
};

try {
  const { parseMapData } = await server.ssrLoadModule('/src/core/validate.ts');
  const { MapIndexSchema, mapSlug } = await server.ssrLoadModule('/src/core/schema.ts');
  const { ArtFileSchema } = await server.ssrLoadModule('/src/core/artfile.ts');
  const { pathBounds } = await server.ssrLoadModule('/scripts/lib/art.ts');

  /** Art is optional (the app draws without it), so a map with none is only listed; one that exists must be sound. */
  const checkArt = (id, map) => {
    const file = path.join(artDir, `${id}.json`);
    if (!existsSync(file)) {
      say('  art: none (pnpm content:art makes it)');
      return;
    }
    let raw;
    try {
      raw = readJson(file);
    } catch {
      report('error', 'art-json', '', `art/${id}.json is not valid JSON`);
      return;
    }
    const parsed = ArtFileSchema.safeParse(raw);
    if (!parsed.success) {
      const i = parsed.error.issues[0];
      report('error', 'art-schema', '', `art/${id}.json: ${i?.path.join('.') || '(file)'}: ${i?.message}`);
      return;
    }
    const art = parsed.data;
    const size = statSync(file).size;
    const levels = Object.keys(art.levels);
    say(`  art: ${levels.length} level${levels.length === 1 ? '' : 's'}, ${(size / 1024).toFixed(1)} KB`);
    if (art.map !== id) report('error', 'art-map', '', `art/${id}.json is for ${art.map}`);
    if (size > ART_BUDGET) report('warning', 'art-size', '', `art/${id}.json is ${(size / 1024).toFixed(0)} KB, over the ${ART_BUDGET / 1024} KB budget`);
    if (!map) return;
    if (art.gameBuild !== map.gameBuild) report('warning', 'art-stale', '', `art was made from game build ${art.gameBuild}, the map record says ${map.gameBuild}; run pnpm content:art`);
    for (const level of map.levels) if (!art.levels[level.id]) report('warning', 'art-level', '', `no art for level ${level.id}`);
    for (const levelId of levels) {
      if (!map.levels.some((l) => l.id === levelId)) report('warning', 'art-level', '', `art has level ${levelId}, which the map record does not`);
      const b = pathBounds(art.levels[levelId]);
      if (!Number.isFinite(b.minX)) report('error', 'art-empty', '', `art level ${levelId} has no shape`);
      else if (b.minX < 0 || b.minY < 0 || b.maxX > map.radarSize || b.maxY > map.radarSize) {
        report('error', 'art-bounds', '', `art level ${levelId} runs outside the ${map.radarSize} px radar (x ${b.minX} to ${b.maxX}, y ${b.minY} to ${b.maxY})`);
      }
    }
  };

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
      const listed = parsed.callouts.flatMap((c) => c.shots.map((s) => ({ callout: c.id, file: s.file })));
      if (haveShots) {
        let present = 0;
        for (const { callout, file } of listed) {
          if (existsSync(path.join(shotsDir, file))) present += 1;
          else report('error', 'shot-file', callout, `${file} is not in assets/shots`);
        }
        const folder = path.join(shotsDir, mapSlug(entry.id));
        const files = existsSync(folder) ? readdirSync(folder).filter((f) => /\.(avif|webp|png)$/.test(f)) : [];
        say(`  shots: ${listed.length} listed, ${present} on disk${files.length ? `, ${files.length} files in assets/shots/${mapSlug(entry.id)}` : ''}`);
        // a .webp or .png beside an .avif is its fallback, not a stray
        const wanted = new Set(listed.map((l) => l.file.replace(/\.(avif|webp|png)$/, '')));
        for (const f of files) {
          if (!wanted.has(`${mapSlug(entry.id)}/${f.replace(/\.(avif|webp|png)$/, '')}`)) report('warning', 'shot-orphan', '', `${mapSlug(entry.id)}/${f} is in assets/shots but no callout lists it`);
        }
      } else if (listed.length > 0) say(`  shots: ${listed.length} listed (not checked against disk)`);
    }
    for (const i of parsed.issues) report(i.severity, i.rule, i.callout, i.message);
    checkArt(entry.id, parsed.map);
  }

  // Art is generated, so every map is listed with whether it has any, available or not.
  say('\nmap art (data/art, from pnpm content:art)');
  for (const entry of index) {
    const file = path.join(artDir, `${entry.id}.json`);
    say(`  ${entry.id.padEnd(12)} ${existsSync(file) ? artSummary(file) : 'none'}`);
  }
} catch (e) {
  errors += 1;
  console.error(`\n${e instanceof Error ? e.message : e}`);
} finally {
  await server.close();
}

say(`\n${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}${strict && warnings ? ' (strict: warnings fail)' : ''}`);
process.exit(errors > 0 || (strict && warnings > 0) ? 1 : 0);

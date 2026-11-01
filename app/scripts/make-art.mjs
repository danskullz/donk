// `pnpm content:art`: draws each map's walkable surface as one SVG path per level, in radar pixels, from the decoded
// nav mesh (SCOPE.md §3.6, §6.8), and writes data/art/<map>.json. The art is derived from Valve's map geometry, so
// data/art is gitignored and rebuilt with this command (SCOPE §9).
//
//   pnpm content:art                      every map that has assets/valve/nav/<id>.json
//   pnpm content:art -- --map de_mirage   one map (repeat the flag for more)
//   options: --no-check (skip the comparison with the radar image), --tolerance <radar px>, --budget <bytes>,
//            --data <dir>, --assets <dir>, --out <dir>
//
// Exits 1 if any map fails.

import path from 'node:path';
import { parseArgs } from 'node:util';
import { folders, startCore } from './lib/boot.mjs';

const { values } = parseArgs({
  options: {
    map: { type: 'string', multiple: true },
    'no-check': { type: 'boolean' },
    tolerance: { type: 'string' },
    budget: { type: 'string' },
    data: { type: 'string' },
    assets: { type: 'string' },
    out: { type: 'string' },
  },
  allowPositionals: false,
});
const dirs = folders();
const dataDir = values.data ?? dirs.data;
const job = {
  dataDir,
  assetsDir: values.assets ?? dirs.assets,
  outDir: values.out ?? (values.data ? path.join(values.data, 'art') : dirs.art),
  maps: (values.map ?? []).flatMap((m) => m.split(',')),
  check: !values['no-check'],
  ...(values.tolerance ? { tolerance: Number(values.tolerance) } : {}),
  ...(values.budget ? { budget: Number(values.budget) } : {}),
  log: (line) => console.log(line),
};

const server = await startCore();
let failed = false;
try {
  const { runArt } = await server.ssrLoadModule('/scripts/lib/art-run.ts');
  const t0 = performance.now();
  const { reports, problems } = await runArt(job);
  for (const p of problems) console.error(`error: ${p}`);
  const total = reports.reduce((s, r) => s + r.bytes, 0);
  console.log(`\n${reports.length} map${reports.length === 1 ? '' : 's'}, ${(total / 1024).toFixed(1)} KB, ${((performance.now() - t0) / 1000).toFixed(1)} s${problems.length ? `, ${problems.length} failed` : ''}`);
  if (reports.length === 0 && problems.length === 0) console.error(`error: no nav meshes under ${job.assetsDir}/nav (run the extraction first: content-tools/README.md)`);
  failed = problems.length > 0 || reports.length === 0;
} catch (e) {
  console.error(e instanceof Error ? e.stack ?? e.message : e);
  failed = true;
} finally {
  await server.close();
}
process.exit(failed ? 1 : 0);

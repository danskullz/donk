// `pnpm content:process`: turns the capture driver's PNGs into the app's screenshots (SCOPE.md §3.5, §8.2).
//
//   pnpm content:process -- --map de_mirage [--captures <dir>] [--manifest <file>] [--force] [--dry-run]
//
// For each shot in the Editor's capture manifest whose PNG exists, it writes assets/shots/<map>/<callout>-<n>.avif
// (1280x720) and adds the matching entry (file, pos, yaw, pitch, stance, kind, captured, build) to the callout's `shots`
// in data/callouts/<map>.json. Run it again after more captures: what is already there is left alone.
//
//   --captures <dir>   the capture driver's output folder          (default assets/valve/capture/<map>)
//   --manifest <file>  the Editor's capture manifest               (default data/editor/<map>.capture-manifest.json)
//   --force            replace entries that differ from the ones already in the file
//   --dry-run          say what would happen, write nothing
//   --quality <1-100>  AVIF quality to start from (default 60); --max-kb <n> size budget (default 90), --min-quality <n> (default 40)
//   --effort <0-9>     AVIF encoder effort: higher is slower and smaller (default 4)
//   --webp             also write a WebP beside each AVIF
//   --date <YYYY-MM-DD>  `captured` for every entry (default: the date of each PNG);  --build <id>  `build` (default: the map's gameBuild)
//   --data <dir> --shots <dir>   other content and shots folders
//
// Exits 1 if any shot could not be processed.

import path from 'node:path';
import { parseArgs } from 'node:util';
import { cliArgs, folders, startCore } from './lib/boot.mjs';

const { values } = parseArgs({
  args: cliArgs(),
  options: {
    map: { type: 'string' },
    captures: { type: 'string' },
    manifest: { type: 'string' },
    force: { type: 'boolean' },
    'dry-run': { type: 'boolean' },
    quality: { type: 'string' },
    'max-kb': { type: 'string' },
    'min-quality': { type: 'string' },
    effort: { type: 'string' },
    webp: { type: 'boolean' },
    date: { type: 'string' },
    build: { type: 'string' },
    data: { type: 'string' },
    shots: { type: 'string' },
  },
  allowPositionals: false,
});
if (!values.map || !/^de_[a-z0-9]+$/.test(values.map)) {
  console.error('usage: pnpm content:process -- --map de_mirage [--captures <dir>] [--manifest <file>] [--force] [--dry-run]');
  process.exit(2);
}
if (values.date && !/^\d{4}-\d{2}-\d{2}$/.test(values.date)) {
  console.error('--date must look like 2026-11-02');
  process.exit(2);
}

// A number that is not one would reach the encoder as NaN and fail with a message about sharp, not about the flag.
const RANGES = { quality: [1, 100], 'min-quality': [1, 100], 'max-kb': [1, 100000], effort: [0, 9] };
const badFlags = Object.entries(RANGES).filter(([name, [lo, hi]]) => values[name] !== undefined && !(Number.isInteger(Number(values[name])) && Number(values[name]) >= lo && Number(values[name]) <= hi));
if (badFlags.length > 0) {
  for (const [name, [lo, hi]] of badFlags) console.error(`--${name} must be a whole number from ${lo} to ${hi}, not "${values[name]}"`);
  process.exit(2);
}

const dirs = folders();
const dataDir = values.data ?? dirs.data;
const number = (name) => (values[name] === undefined ? {} : { [name === 'max-kb' ? 'maxKb' : name === 'min-quality' ? 'minQuality' : name]: Number(values[name]) });
const job = {
  map: values.map,
  dataDir,
  shotsDir: values.shots ?? dirs.shots,
  capturesDir: values.captures ?? path.join(dirs.assets, 'capture', values.map),
  manifestFile: values.manifest ?? path.join(dataDir, 'editor', `${values.map}.capture-manifest.json`),
  force: Boolean(values.force),
  dryRun: Boolean(values['dry-run']),
  webp: Boolean(values.webp),
  ...(values.date ? { date: values.date } : {}),
  ...(values.build ? { build: values.build } : {}),
  ...number('quality'),
  ...number('max-kb'),
  ...number('min-quality'),
  ...number('effort'),
  log: (line) => console.log(line),
};

const server = await startCore();
let failed = false;
try {
  const { processShots } = await server.ssrLoadModule('/scripts/lib/process-run.ts');
  console.log(`${job.map}: captures ${job.capturesDir}, manifest ${job.manifestFile}${job.dryRun ? ' (dry run)' : ''}`);
  const t0 = performance.now();
  const report = await processShots(job);
  const count = (s) => report.rows.filter((r) => r.status === s).length;
  const bytes = report.converted.reduce((s, c) => s + c.bytes, 0);
  console.log(
    `\n${report.converted.length} converted (${(bytes / 1024).toFixed(0)} KB${report.converted.length ? `, ${(bytes / report.converted.length / 1024).toFixed(0)} KB each` : ''}), ` +
      `${count('added')} added, ${count('replaced')} replaced, ${count('unchanged')} unchanged, ${count('conflict')} conflicts, ${count('no-callout')} for callouts not in the file, ` +
      `${report.problems.length} problems, ${((performance.now() - t0) / 1000).toFixed(1)} s${report.wroteCallouts ? `; callouts/${job.map}.json updated (previous copy in data/.backups)` : ''}`,
  );
  failed = report.problems.length > 0;
} catch (e) {
  console.error(e instanceof Error ? e.stack ?? e.message : e);
  failed = true;
} finally {
  await server.close();
}
process.exit(failed ? 1 : 0);

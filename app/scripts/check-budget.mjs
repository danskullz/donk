// `pnpm check:budget`: fails if the JavaScript needed to start the app is over the budget in SCOPE.md §5.6
// (150 KB gzipped). Run it after `pnpm build`; it reads dist/index.html, follows the entry script's static imports and
// prints a table. All the logic is in src/tooling/budget.ts (with tests); this file only reads the disk.
//
//   node scripts/check-budget.mjs                 check against the real budget
//   node scripts/check-budget.mjs --limit-kb=60   pretend the budget is 60 KB (to see the failure path; not for CI)
//
// Exit 0 within budget, 1 over budget or not measurable. Like validate-content.mjs it loads the TypeScript through
// Vite's module runner instead of compiling it first.

import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { appRoot, startCore } from './lib/boot.mjs';

const dist = path.join(appRoot, 'dist');
const indexFile = path.join(dist, 'index.html');

let limit;
const limitArg = process.argv.slice(2).find((a) => a.startsWith('--limit-kb='));
if (limitArg) {
  const kb = Number(limitArg.slice('--limit-kb='.length));
  if (!(kb > 0)) {
    console.error(`${limitArg}: expected a positive number of KB`);
    process.exit(2);
  }
  limit = Math.round(kb * 1000);
}

if (!existsSync(indexFile)) {
  console.error(`${path.relative(appRoot, indexFile)} not found. Run \`pnpm build\` first.`);
  process.exit(1);
}

const read = (rel) => {
  const file = path.join(dist, rel);
  return existsSync(file) && statSync(file).isFile() ? readFileSync(file, 'utf8') : undefined;
};

const server = await startCore();
let ok = false;
try {
  const { measureInitialLoad, formatReport } = await server.ssrLoadModule('/src/tooling/budget.ts');
  const report = measureInitialLoad(
    readFileSync(indexFile, 'utf8'),
    // zlib's default level. Close to, but not identical to, the "gzip:" column of `vite build` (see budget.ts).
    { read, gzipBytes: (text) => gzipSync(Buffer.from(text, 'utf8')).length },
    limit,
  );
  console.log(formatReport(report));
  ok = report.ok;
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
} finally {
  await server.close();
}
process.exit(ok ? 0 : 1);

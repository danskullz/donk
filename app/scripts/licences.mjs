// Keeps the dependency table in ../THIRD-PARTY.md (SCOPE.md §9) in step with what is installed.
//
//   node scripts/licences.mjs --check   fail if a direct dependency is missing from the file, or its version or
//                                       licence differs from the installed package, or it has no "Used for" text.
//                                       This is `pnpm check:licences`, run in CI.
//   node scripts/licences.mjs --write   rebuild the table. Versions and licences are read from each package's own
//                                       package.json in node_modules, never typed by hand; the "Used for" column that a
//                                       person wrote is kept, and a new package gets a TODO to fill in.
//
// Only the direct dependencies and devDependencies of app/package.json are covered, not what they pull in. The logic
// and its tests are in src/tooling/licences.ts. Exit 0 ok, 1 problems found, 2 bad arguments.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { appRoot, repoRoot, startCore } from './lib/boot.mjs';

const args = process.argv.slice(2);
const mode = args.includes('--check') ? 'check' : args.includes('--write') ? 'write' : null;
if (mode === null || args.includes('--check') === args.includes('--write')) {
  console.error('usage: node scripts/licences.mjs --check | --write');
  process.exit(2);
}

const file = path.join(repoRoot, 'THIRD-PARTY.md');
if (!existsSync(file)) {
  console.error(`${path.relative(repoRoot, file)} not found`);
  process.exit(1);
}

const server = await startCore();
let exitCode = 1;
try {
  const { checkTable, licenceOf, TODO_USE, updateTable } = await server.ssrLoadModule('/src/tooling/licences.ts');

  const manifest = JSON.parse(readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
  const deps = [];
  const notInstalled = [];
  for (const group of ['dependencies', 'devDependencies']) {
    for (const name of Object.keys(manifest[group] ?? {})) {
      const metaFile = path.join(appRoot, 'node_modules', name, 'package.json');
      if (!existsSync(metaFile)) {
        notInstalled.push(name);
        continue;
      }
      const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
      deps.push({ name, group, version: String(meta.version), licence: licenceOf(meta) });
    }
  }
  if (notInstalled.length > 0) {
    throw new Error(`not installed: ${notInstalled.join(', ')}. Run \`pnpm install\` first, so licences and versions can be read.`);
  }

  const text = readFileSync(file, 'utf8');
  if (mode === 'check') {
    const problems = checkTable(text, deps);
    for (const p of problems) console.log(`  ${p}`);
    if (problems.length > 0) console.log(`\nTHIRD-PARTY.md is out of date. Run \`node scripts/licences.mjs --write\`, then fill in any "Used for" marked TODO.`);
    else console.log(`THIRD-PARTY.md lists all ${deps.length} direct dependencies; versions and licences match what is installed`);
    exitCode = problems.length > 0 ? 1 : 0;
  } else {
    const next = updateTable(text, deps);
    if (next !== text) writeFileSync(file, next);
    console.log(next === text ? 'THIRD-PARTY.md is already up to date' : `wrote ${path.relative(repoRoot, file)} (${deps.length} direct dependencies)`);
    const todo = next.split(/\r?\n/).filter((l) => l.includes(TODO_USE)).length;
    if (todo > 0) console.log(`${todo} row${todo === 1 ? '' : 's'} still say "${TODO_USE}": write what each is used for`);
    exitCode = 0;
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
} finally {
  await server.close();
}
process.exit(exitCode);

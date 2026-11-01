// `pnpm check:runes`: fails if any .svelte file under src/ uses Svelte 4 syntax (ADR 0001, rule 2: runes only).
// The rules and their limits are in src/tooling/runes-guard.ts (with tests); this file only walks the folder and
// prints. Exit 0 when clean, 1 when it found something.
//
// Like validate-content.mjs it loads the TypeScript through Vite's module runner instead of compiling it first.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { appRoot, startCore } from './lib/boot.mjs';

const srcDir = path.join(appRoot, 'src');
const files = readdirSync(srcDir, { recursive: true })
  .map(String)
  .filter((f) => f.endsWith('.svelte'))
  .sort()
  .map((f) => path.join('src', f).split(path.sep).join('/')); // forward slashes on Windows too, so output is the same everywhere

const server = await startCore();
let findings = 0;
let failed = false;
try {
  const { findSvelte4Syntax, formatFinding } = await server.ssrLoadModule('/src/tooling/runes-guard.ts');
  for (const file of files) {
    for (const finding of findSvelte4Syntax(readFileSync(path.join(appRoot, file), 'utf8'))) {
      findings += 1;
      console.log(formatFinding(file, finding));
    }
  }
} catch (e) {
  failed = true;
  console.error(e instanceof Error ? e.message : e);
} finally {
  await server.close();
}

if (failed) process.exit(1);
console.log(`${files.length} .svelte files checked, ${findings} use${findings === 1 ? 's' : ''} of Svelte 4 syntax`);
process.exit(findings > 0 ? 1 : 0);

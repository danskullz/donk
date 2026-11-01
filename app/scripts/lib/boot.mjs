// Starts a Vite server in middleware mode so the content scripts can load the TypeScript core and its schemas
// without compiling anything first (the same trick scripts/validate-content.mjs uses). Nothing listens on a port.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

export const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const repoRoot = path.resolve(appRoot, '..');

/** Where the content lives; the same environment variables as vite.config.ts, so tests can point elsewhere. */
export function folders() {
  const data = process.env.CALLOUTS_DATA_DIR ?? path.join(repoRoot, 'data');
  return {
    data,
    assets: process.env.CALLOUTS_ASSETS_DIR ?? path.join(repoRoot, 'assets', 'valve'),
    art: process.env.CALLOUTS_ART_DIR ?? path.join(data, 'art'),
    shots: process.env.CALLOUTS_SHOTS_DIR ?? path.join(repoRoot, 'assets', 'shots'),
  };
}

/**
 * The command-line arguments after the script name, minus one leading `--`. `pnpm content:process -- --map x` hands
 * that `--` on to the script, and Node's parseArgs reads everything after it as positional, so without this the
 * documented form fails. Both `pnpm content:process --map x` and `pnpm content:process -- --map x` work.
 */
export function cliArgs(argv = process.argv.slice(2)) {
  return argv[0] === '--' ? argv.slice(1) : argv;
}

export function startCore() {
  return createServer({
    root: appRoot,
    configFile: false,
    appType: 'custom',
    logLevel: 'error',
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true },
  });
}

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { editorPlugin } from './tools/editor-plugin';
import { shotsPlugin } from './tools/shots-plugin';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export default defineConfig({
  plugins: [
    svelte(),
    // The Callout Editor's file access (SCOPE §8.3). Dev server only; the folders can be pointed elsewhere for tests.
    editorPlugin({
      data: process.env.CALLOUTS_DATA_DIR ?? path.join(repo, 'data'),
      assets: process.env.CALLOUTS_ASSETS_DIR ?? path.join(repo, 'assets', 'valve'),
    }),
    shotsPlugin({ shots: process.env.CALLOUTS_SHOTS_DIR ?? path.join(repo, 'assets', 'shots') }),
  ],
  server: {
    // The content lives in /data, beside this folder, and is bundled into the app.
    fs: { allow: ['..'] },
  },
  test: {
    // The core is framework-free (ADR 0001, rule 1), so tests run in plain Node.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});

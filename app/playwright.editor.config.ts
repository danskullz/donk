import { defineConfig } from '@playwright/test';

// The Editor's browser tests (`pnpm e2e:editor`). The Editor exists only under `vite dev`, so they run against a dev
// server whose editor plugin points at a throw-away copy of the data (scripts/editor-test-server.mjs), never /data.
// One worker: the tests share that copy and reset it themselves.
const port = Number(process.env.EDITOR_E2E_PORT ?? 5174);

export default defineConfig({
  testDir: 'e2e-editor',
  workers: 1,
  fullyParallel: false,
  reporter: 'list',
  outputDir: `test-results/editor-${port}`,
  use: {
    baseURL: `http://localhost:${port}`,
    channel: 'msedge',
    viewport: { width: 1600, height: 900 },
  },
  webServer: {
    command: `node scripts/editor-test-server.mjs ${port}`,
    url: `http://localhost:${port}/`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});

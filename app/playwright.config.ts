import { defineConfig } from '@playwright/test';

// Drives the Edge that ships with Windows, so no separate browser download is needed.
// The e2e build includes the synthetic development map (.env.e2e); the normal build does not.
//
// Several people or agents can run this at once: set E2E_PORT to a free port (default 4173). Each port builds into
// its own folder (dist-e2e-<port>), so runs do not overwrite each other's build.
const port = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  reporter: 'list',
  // each run keeps its own results, so a concurrent run does not empty them
  outputDir: `test-results/port-${port}`,
  use: {
    baseURL: `http://localhost:${port}`,
    channel: 'msedge',
  },
  webServer: {
    command: `pnpm build --mode e2e --outDir dist-e2e-${port} && pnpm preview --outDir dist-e2e-${port} --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});

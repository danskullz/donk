// Unit tests for the content tooling under scripts/ and tools/ (the main config only looks in src/). Run with
// `pnpm test:scripts`; the tests that start Vite or the scripts take a few seconds each.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['scripts/**/*.test.ts', 'tools/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});

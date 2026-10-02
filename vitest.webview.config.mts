import { defineConfig } from 'vitest/config';

// Browser tests for the built webview bundles (requires `npm run build` and Playwright Chromium).
export default defineConfig({
  test: {
    include: ['test/webview/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});

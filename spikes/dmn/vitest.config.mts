import { defineConfig } from 'vitest/config';

// DMN prototype checks (ADR 0014): the webview bundle in Chromium under the production CSP.
export default defineConfig({
  test: {
    include: ['spikes/dmn/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60000,
    hookTimeout: 60000,
    fileParallelism: false,
  },
});

import { defineConfig } from 'vitest/config';

// Probe for #18: dropped keystrokes in webview text fields in real VS Code.
export default defineConfig({
  test: {
    include: ['spikes/keys/**/*.probe.ts'],
    environment: 'node',
    testTimeout: 300_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});

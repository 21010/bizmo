import { defineConfig } from 'vitest/config';

// DMN prototype checks (ADR 0014) in real VS Code; requires `npm run build`.
export default defineConfig({
  test: {
    include: ['spikes/dmn/**/*.e2e.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});

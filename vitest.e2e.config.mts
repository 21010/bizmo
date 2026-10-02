import { defineConfig } from 'vitest/config';

// End-to-end tests in real VS Code (requires `npm run build`; downloads VS Code on first run).
export default defineConfig({
  test: {
    include: ['test/e2e/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 180_000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});

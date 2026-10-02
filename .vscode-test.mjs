import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  files: 'out/test/integration/**/*.test.js',
  // CI runs both the minimum supported version (engines.vscode) and stable.
  version: process.env.VSCODE_TEST_VERSION ?? 'stable',
  workspaceFolder: './test/fixtures/workspace',
  launchArgs: ['--disable-extensions'],
  mocha: { ui: 'bdd', timeout: 20_000 },
});

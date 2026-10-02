// Bundles the VS Code integration tests so @vscode/test-cli can load them as CommonJS.
import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['test/integration/**/*.test.ts'],
  outdir: 'out/test/integration',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: 'inline',
  external: ['vscode', 'mocha'],
  logLevel: 'info',
});

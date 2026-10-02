// Bundles the extension host (Node, CommonJS) and the webview (browser) separately.
// Usage: node scripts/build.mjs [--production] [--watch]
import { rmSync } from 'node:fs';
import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {esbuild.BuildOptions} */
const common = {
  bundle: true,
  minify: production,
  sourcemap: production ? false : 'linked',
  legalComments: 'linked',
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': JSON.stringify(production ? 'production' : 'development') },
};

/** @type {esbuild.BuildOptions} */
const extension = {
  ...common,
  entryPoints: ['src/extension/extension.ts'],
  outdir: 'dist/extension',
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['vscode'],
};

/** @type {esbuild.BuildOptions} */
const webview = {
  ...common,
  entryPoints: ['src/webview/main.ts'],
  outdir: 'dist/webview',
  platform: 'browser',
  format: 'iife',
  target: 'chrome130',
};

rmSync('dist', { recursive: true, force: true });

if (watch) {
  const contexts = await Promise.all([esbuild.context(extension), esbuild.context(webview)]);
  await Promise.all(contexts.map((context) => context.watch()));
} else {
  await Promise.all([esbuild.build(extension), esbuild.build(webview)]);
}

// Bundles the extension host and the webviews (definitions in bundles.mjs).
// Usage: node scripts/build.mjs [--production] [--watch]
import { rmSync } from 'node:fs';
import * as esbuild from 'esbuild';
import { bundles } from './bundles.mjs';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
const options = bundles({ production });

rmSync('dist', { recursive: true, force: true });

if (watch) {
  const contexts = await Promise.all(options.map((o) => esbuild.context(o)));
  await Promise.all(contexts.map((context) => context.watch()));
} else {
  await Promise.all(options.map((o) => esbuild.build(o)));
}

// Fails if the packaged extension would contain anything outside the allowlist, or exceed the size
// budget. Reports the size of every packaged file (per-notation bundle sizes). Run after build:prod.
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';

const allowed = [
  /^package\.json$/,
  /^README\.md$/,
  /^CHANGELOG\.md$/,
  /^LICENSE(\.txt)?$/,
  /^THIRD_PARTY_NOTICES\.md$/,
  /^media\/[\w.-]+\.(png|svg)$/,
  /^dist\/(extension|webview)\/[\w.-]+\.(js|css|ttf|woff2?|LEGAL\.txt)$/,
];

/** Size budget (uncompressed bytes): per webview bundle, and for all packaged files together. */
const MAX_BUNDLE = 4 * 1024 * 1024;
const MAX_TOTAL = 6 * 1024 * 1024;

// Run vsce's entry point with the current Node binary: no shell, no argument concatenation.
const output = execFileSync(
  process.execPath,
  ['node_modules/@vscode/vsce/vsce', 'ls', '--no-dependencies'],
  { encoding: 'utf8' },
);
const files = output
  .split(/\r?\n/)
  .map((line) => line.trim().replaceAll('\\', '/'))
  .filter(Boolean);

const unexpected = files.filter((file) => !allowed.some((pattern) => pattern.test(file)));

const kib = (bytes) => `${(bytes / 1024).toFixed(0).padStart(6)} KiB`;
const sizes = files.map((file) => ({ file, size: statSync(file).size }));
const total = sizes.reduce((sum, { size }) => sum + size, 0);
console.log(sizes.map(({ file, size }) => `${kib(size)}  ${file}`).join('\n'));
console.log(`${kib(total)}  total`);

if (unexpected.length > 0) {
  console.error(`\nUnexpected files in package:\n${unexpected.map((f) => `  ${f}`).join('\n')}`);
  process.exit(1);
}

const oversized = sizes.filter(
  ({ file, size }) => /^dist\/webview\/[\w-]+\.js$/.test(file) && size > MAX_BUNDLE,
);
if (oversized.length > 0 || total > MAX_TOTAL) {
  console.error(
    `\nOver the size budget (${kib(MAX_BUNDLE).trim()} per bundle, ${kib(MAX_TOTAL).trim()} in total):\n` +
      oversized.map(({ file, size }) => `  ${file} ${kib(size).trim()}`).join('\n'),
  );
  process.exit(1);
}
console.log(`\n${files.length} files, all allowed, within the size budget.`);

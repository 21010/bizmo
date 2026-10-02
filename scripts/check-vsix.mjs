// Fails if the packaged extension would contain anything outside the allowlist.
import { execFileSync } from 'node:child_process';

const allowed = [
  /^package\.json$/,
  /^README\.md$/,
  /^CHANGELOG\.md$/,
  /^LICENSE(\.txt)?$/,
  /^THIRD_PARTY_NOTICES\.md$/,
  /^media\/[\w.-]+\.(png|svg)$/,
  /^dist\/(extension|webview)\/[\w.-]+\.(js|css|ttf|woff2?|LEGAL\.txt)$/,
];

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

console.log(files.map((file) => `  ${file}`).join('\n'));
if (unexpected.length > 0) {
  console.error(`\nUnexpected files in package:\n${unexpected.map((f) => `  ${f}`).join('\n')}`);
  process.exit(1);
}
console.log(`\n${files.length} files, all allowed.`);

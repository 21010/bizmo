// Prints the CHANGELOG.md section of a version (`## 1.0.0 …` up to the next `## `), for the GitHub
// release. Fails when the section is missing or empty, so a tag cannot be released without notes.
//   node scripts/release-notes.mjs 1.0.0
import { readFileSync } from 'node:fs';

const version = process.argv[2]?.replace(/^v/, '');
if (!version) {
  console.error('usage: release-notes.mjs <version>');
  process.exit(2);
}

const lines = readFileSync('CHANGELOG.md', 'utf8').split(/\r?\n/);
const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const heading = new RegExp(`^## \\[?${escaped}\\]?(\\s|$)`);
const start = lines.findIndex((line) => heading.test(line));
if (start === -1) {
  console.error(`CHANGELOG.md has no "## ${version}" section`);
  process.exit(1);
}
const end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
const notes = lines
  .slice(start + 1, end === -1 ? undefined : end)
  .join('\n')
  .trim();
if (!notes) {
  console.error(`The "## ${version}" section of CHANGELOG.md is empty`);
  process.exit(1);
}
console.log(notes);

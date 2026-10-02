// Builds the spike webview, prepares a fixture workspace, and runs the spike tests in VS Code.
// Usage: node spikes/vscode-ext/run-tests.mjs   (VSCODE_TEST_VERSION=1.134.0 to test the minimum)
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as esbuild from 'esbuild';
import { runTests } from '@vscode/test-electron';

const EXT = resolve('spikes/vscode-ext');
const MEDIA = join(EXT, 'media');
const WS = join(EXT, '.ws');

rmSync(MEDIA, { recursive: true, force: true });
await esbuild.build({
  entryPoints: { webview: join(EXT, 'webview.js') },
  outdir: MEDIA,
  bundle: true,
  format: 'iife',
  target: 'chrome130',
  minify: true,
  loader: { '.woff': 'file', '.woff2': 'file', '.ttf': 'file', '.eot': 'file', '.svg': 'file' },
  logLevel: 'warning',
});
writeFileSync(
  join(MEDIA, 'violations.js'),
  `window.__violations = [];
document.addEventListener('securitypolicyviolation', (e) => {
  const v = { directive: e.effectiveDirective, blockedURI: e.blockedURI, source: e.sourceFile, line: e.lineNumber };
  if (window.__reportViolation) window.__reportViolation(v); else window.__violations.push(v);
});`,
);
// Flush violations raised before the bridge existed.
const bundle = readFileSync(join(MEDIA, 'webview.js'), 'utf8');
writeFileSync(join(MEDIA, 'webview.js'), `${bundle}\n(window.__violations||[]).forEach((v)=>window.__reportViolation&&window.__reportViolation(v));`);
writeFileSync(
  join(MEDIA, 'webview.css'),
  'html,body{margin:0;padding:0;height:100%}body{display:flex}#canvas{flex:1;height:100%}#properties{width:300px;height:100%;overflow:auto}',
);

// Fixture workspace (third-party corpus files stay local; see spikes/corpus/SOURCES.tsv).
rmSync(WS, { recursive: true, force: true });
mkdirSync(WS, { recursive: true });
const pick = (platform) =>
  readdirSync(`spikes/corpus/${platform}`).find((f) => {
    const x = readFileSync(`spikes/corpus/${platform}/${f}`, 'utf8');
    return x.includes('<bpmn:startEvent') && !x.includes('collaboration') && x.length > 2500 && !x.includes('\r\n');
  });
const c8 = pick('c8');
const c7 = pick('c7');
copyFileSync(`spikes/corpus/c8/${c8}`, join(WS, 'c8.bpmn'));
copyFileSync(`spikes/corpus/c7/${c7}`, join(WS, 'c7.bpmn'));
writeFileSync(join(WS, 'crlf.bpmn'), readFileSync(`spikes/corpus/c8/${c8}`, 'utf8').replace(/\r?\n/g, '\r\n'));
const { generate } = await import('../generate.mjs');
writeFileSync(join(WS, 'big500.bpmn'), generate(500));
console.log(`fixtures: c8=${c8}, c7=${c7}`);

await runTests({
  version: process.env.VSCODE_TEST_VERSION ?? 'stable',
  extensionDevelopmentPath: EXT,
  extensionTestsPath: join(EXT, 'test', 'index.js'),
  launchArgs: [WS, '--disable-extensions', '--disable-workspace-trust'],
});

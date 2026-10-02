// Runs the reproduction against the published package and against a bundle with the proposed fix
// (skip implicit roots in the properties panel's `import.done` handler).
// Usage: node spikes/upstream-repro/verify-fix.mjs
import { readFileSync } from 'node:fs';
import * as esbuild from 'esbuild';
import { chromium } from 'playwright';
import { simple, unresolvablePlane } from './diagrams.mjs';

const ORIGINAL = `    const onImportDone = () => {
      const rootElement = canvas.getRootElement();
      _update(rootElement);`;
const FIXED = `    const onImportDone = () => {
      const rootElement = canvas.getRootElement();
      if (isImplicitRoot$1(rootElement)) {
        return;
      }
      _update(rootElement);`;

const patchPlugin = {
  name: 'patch-properties-panel',
  setup(build) {
    build.onLoad({ filter: /bpmn-js-properties-panel[\\/]dist[\\/]index\.esm\.js$/ }, (args) => {
      const source = readFileSync(args.path, 'utf8');
      if (!source.includes(ORIGINAL)) throw new Error('patch target not found');
      return { contents: source.replace(ORIGINAL, FIXED), loader: 'js' };
    });
  },
};

async function bundle(outdir, plugins) {
  await esbuild.build({
    entryPoints: { c8: 'spikes/harness/c8.js' },
    outdir,
    bundle: true,
    format: 'iife',
    loader: { '.woff': 'file', '.woff2': 'file', '.ttf': 'file', '.eot': 'file', '.svg': 'file' },
    plugins,
    logLevel: 'warning',
  });
}

await bundle('spikes/out/repro-original', []);
await bundle('spikes/out/repro-fixed', [patchPlugin]);

const ORIGIN = 'http://repro.local';
const browser = await chromium.launch();
const docs = { A: simple('A'), B: simple('B'), C: simple('C'), N: unresolvablePlane() };

async function run(dir, sequence) {
  const page = await browser.newPage();
  await page.route(`${ORIGIN}/**`, (route) => {
    const path = new URL(route.request().url()).pathname.slice(1);
    if (path === 'index.html') {
      return route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html><head><link rel="stylesheet" href="${ORIGIN}/c8.css"></head><body><div id="canvas" style="height:600px"></div><div id="properties"></div><script src="${ORIGIN}/c8.js"></script></body></html>`,
      });
    }
    try {
      return route.fulfill({ body: readFileSync(`${dir}/${path}`), contentType: path.endsWith('.js') ? 'text/javascript' : 'text/css' });
    } catch {
      return route.fulfill({ status: 404 });
    }
  });
  await page.goto(`${ORIGIN}/index.html`);
  await page.waitForFunction(() => window.spikeReady);
  const result = await page.evaluate(
    async ({ sequence, docs }) => {
      const out = [];
      for (const step of sequence) {
        if (step === 'wait') {
          await new Promise((r) => setTimeout(r, 300));
          continue;
        }
        try {
          await window.spike.importXML(docs[step]);
          out.push(`${step}:ok`);
        } catch (e) {
          out.push(`${step}:ERR(${String(e.message).slice(0, 34)})`);
        }
      }
      return out.join(' ');
    },
    { sequence, docs },
  );
  await page.close();
  return result;
}

const sequences = [
  ['A', 'A', 'N', 'C'],
  ['A', 'wait', 'N', 'C'],
  ['A', 'wait', 'N', 'C', 'C', 'B'],
  ['A', 'B', 'N', 'N', 'C'],
];
for (const [label, dir] of [['published 5.65.1', 'spikes/out/repro-original'], ['with fix', 'spikes/out/repro-fixed']]) {
  console.log(`== ${label}`);
  for (const sequence of sequences) console.log(`  ${sequence.join(' → ').padEnd(30)} ${await run(dir, sequence)}`);
}
await browser.close();

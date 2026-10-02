// Tries import sequences with self-written diagrams in the C8 spike harness (camunda-bpmn-js
// Modeler with properties panel). Usage: node spikes/upstream-repro/probe.mjs
import { readFileSync } from 'node:fs';
import * as esbuild from 'esbuild';
import { chromium } from 'playwright';
import { simple, unresolvablePlane } from './diagrams.mjs';

await esbuild.build({
  entryPoints: { c8: 'spikes/harness/c8.js' },
  outdir: 'spikes/out',
  bundle: true,
  format: 'iife',
  loader: { '.woff': 'file', '.woff2': 'file', '.ttf': 'file', '.eot': 'file', '.svg': 'file' },
  logLevel: 'warning',
});

const ORIGIN = 'http://repro.local';
const browser = await chromium.launch();
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
    return route.fulfill({ body: readFileSync(`spikes/out/${path}`), contentType: path.endsWith('.js') ? 'text/javascript' : 'text/css' });
  } catch {
    return route.fulfill({ status: 404 });
  }
});

const docs = { A: simple('A'), B: simple('B'), C: simple('C'), N: unresolvablePlane() };

async function run(sequence) {
  await page.goto(`${ORIGIN}/index.html`);
  await page.waitForFunction(() => window.spikeReady);
  return page.evaluate(
    async ({ sequence, docs }) => {
      const out = [];
      for (const step of sequence) {
        try {
          await window.spike.importXML(docs[step]);
          out.push(`${step}:ok`);
        } catch (e) {
          out.push(`${step}:ERR(${String(e.message).slice(0, 40)})`);
        }
      }
      return out.join(' ');
    },
    { sequence, docs },
  );
}

for (const sequence of [
  ['N', 'C'],
  ['A', 'N', 'C'],
  ['A', 'B', 'N', 'C'],
  ['A', 'B', 'C', 'N', 'C'],
  ['A', 'A', 'N', 'C'],
]) {
  console.log(sequence.join(' → ').padEnd(24), await run(sequence));
}

// Event timeline for the failing sequence: which element does the panel render?
await page.goto(`${ORIGIN}/index.html`);
await page.waitForFunction(() => window.spikeReady);
const timeline = await page.evaluate(async (docs) => {
  const log = [];
  const describe = (element) => {
    if (!element) return String(element);
    const bo = element.businessObject;
    return `${element.id} [${element.type}] bo=${bo ? (typeof bo.get === 'function' ? bo.$type : `NOT-MODDLE(${Object.keys(bo).join(',')})`) : 'none'}`;
  };
  const bus = window.spike.modeler.get('eventBus');
  for (const name of ['diagram.clear', 'import.parse.start', 'import.render.start', 'import.done', 'root.added', 'root.set', 'propertiesPanel.updated', 'selection.changed']) {
    bus.on(name, 5000, (event) => {
      const element = event.element ?? event.newSelection?.[0];
      log.push(`  ${name.padEnd(24)} ${event.error ? 'error=' + String(event.error.message).slice(0, 40) : describe(element)}`);
    });
  }
  for (const step of ['A', 'A', 'N', 'C']) {
    log.push(`import ${step}`);
    try {
      await window.spike.importXML(docs[step]);
    } catch (e) {
      log.push(`  -> FAILED: ${String(e.message).slice(0, 60)}`);
    }
  }
  return log;
}, docs);
console.log(timeline.join('\n'));
await browser.close();

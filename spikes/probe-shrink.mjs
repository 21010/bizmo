// Minimise the import sequence that breaks later imports (delta debugging, greedy).
import { readFileSync, readdirSync } from 'node:fs';
import { chromium } from 'playwright';
const ORIGIN = 'http://bizmo-spike.local';
const b = await chromium.launch(); const p = await b.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.stack.split('\n').slice(0,6).join(' <- ')));
await p.route(`${ORIGIN}/**`, r => { const path = new URL(r.request().url()).pathname.slice(1);
  if (path==='index.html') return r.fulfill({contentType:'text/html', body:`<!doctype html><html><head><link rel="stylesheet" href="${ORIGIN}/c8.css"></head><body><div id="canvas" style="height:800px"></div><div id="properties"></div><script src="${ORIGIN}/c8.js"></script></body></html>`});
  try { return r.fulfill({ body: readFileSync('spikes/out/'+path), contentType: path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'application/octet-stream' }); } catch { return r.fulfill({status:404}); } });
const files = readdirSync('spikes/corpus/c8'); const xml = f => readFileSync('spikes/corpus/c8/'+f,'utf8');
const target = files.findIndex(f => f.includes('send-email'));
const fails = async (seq) => {
  await p.goto(`${ORIGIN}/index.html`); await p.waitForFunction(() => window.spikeReady);
  return p.evaluate(async ({ docs, last }) => {
    for (const d of docs) { try { await window.spike.importXML(d); } catch {} }
    try { await window.spike.importXML(last); return false; } catch { return true; }
  }, { docs: seq.map(i => xml(files[i])), last: xml(files[target]) });
};
let seq = [...Array(target).keys()];
console.log('full prefix fails:', await fails(seq));
for (let i = seq.length - 1; i >= 0; i--) { const trial = seq.filter((_, k) => k !== i); if (await fails(trial)) seq = trial; }
console.log('minimal sequence before target:', seq.map(i => files[i]));
errs.length = 0; await fails(seq); console.log('stack:', errs[0]);
await b.close();

// Find which earlier file breaks later imports.
import { readFileSync, readdirSync } from 'node:fs';
import { chromium } from 'playwright';
const ORIGIN = 'http://bizmo-spike.local';
const b = await chromium.launch(); const p = await b.newPage();
await p.route(`${ORIGIN}/**`, r => { const path = new URL(r.request().url()).pathname.slice(1);
  if (path==='index.html') return r.fulfill({contentType:'text/html', body:`<!doctype html><html><head><link rel="stylesheet" href="${ORIGIN}/c8.css"></head><body><div id="canvas" style="height:800px"></div><div id="properties"></div><script src="${ORIGIN}/c8.js"></script></body></html>`});
  try { return r.fulfill({ body: readFileSync('spikes/out/'+path), contentType: path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'application/octet-stream' }); } catch { return r.fulfill({status:404}); } });
const reset = async () => { await p.goto(`${ORIGIN}/index.html`); await p.waitForFunction(() => window.spikeReady); };
const files = readdirSync('spikes/corpus/c8'); const xml = f => readFileSync('spikes/corpus/c8/'+f,'utf8');
const imp = x => p.evaluate(async x => { try { await window.spike.importXML(x); return 'ok'; } catch (e) { return String(e.message||e).slice(0,50); } }, x);
await reset(); let first = -1; const results = [];
for (let i = 0; i < files.length; i++) { const r = await imp(xml(files[i])); results.push(r); if (r !== 'ok' && first < 0 && !r.includes('no diagram')) first = i; }
console.log('first real failure at', first, files[first]);
console.log('sequence:', results.map((r,i)=> r==='ok'?'.':(r.includes('no diagram')?'N':'X')).join(''));
const culprits = [];
for (let j = 0; j < first; j++) { await reset(); await imp(xml(files[j])); if (await imp(xml(files[first])) !== 'ok') culprits.push(files[j]); }
console.log('culprits (j then first fails):', culprits);
await b.close();

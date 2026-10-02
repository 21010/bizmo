// Which import sequences fail, and do clear() or a fresh modeler instance avoid it?
import { readFileSync, readdirSync } from 'node:fs';
import { chromium } from 'playwright';
const ORIGIN = 'http://bizmo-spike.local';
const b = await chromium.launch(); const p = await b.newPage();
await p.route(`${ORIGIN}/**`, r => { const path = new URL(r.request().url()).pathname.slice(1);
  if (path==='index.html') return r.fulfill({contentType:'text/html', body:`<!doctype html><html><head><link rel="stylesheet" href="${ORIGIN}/c8.css"></head><body><div id="canvas" style="height:800px"></div><div id="properties"></div><script src="${ORIGIN}/c8.js"></script></body></html>`});
  try { return r.fulfill({ body: readFileSync('spikes/out/'+path), contentType: path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'application/octet-stream' }); } catch { return r.fulfill({status:404}); } });
const reset = async () => { await p.goto(`${ORIGIN}/index.html`); await p.waitForFunction(() => window.spikeReady); };
const files = readdirSync('spikes/corpus/c8').filter(f => !f.includes('cloud-bpmn_diagram'));
const xml = f => readFileSync('spikes/corpus/c8/'+f,'utf8');
const imp = x => p.evaluate(async x => { try { await window.spike.importXML(x); return 'ok'; } catch (e) { return String(e.message||e).slice(0,60); } }, x);
let plain = 0, withClear = 0, sameAgain = 0, pairs = 0; const culprits = {};
for (let i = 1; i < files.length; i++) {
  const prev = files[i-1], cur = files[i]; pairs++;
  await reset(); await imp(xml(prev)); if (await imp(xml(cur)) !== 'ok') { plain++; culprits[prev.slice(0,45)] = (culprits[prev.slice(0,45)]||0)+1; }
  await reset(); await imp(xml(prev)); await p.evaluate(() => window.spike.modeler.clear()); if (await imp(xml(cur)) !== 'ok') withClear++;
  await reset(); await imp(xml(cur)); if (await imp(xml(cur)) !== 'ok') sameAgain++;
}
console.log({ pairs, failPlainReimport: plain, failAfterClear: withClear, failReimportSameFile: sameAgain });
console.log('previous file in failing pairs:', culprits);
// What does the previous file contain?
for (const f of Object.keys(culprits)) { const full = files.find(x => x.startsWith(f)); const s = xml(full); console.log(f, { timers: (s.match(/timerEventDefinition/g)||[]).length, collab: s.includes('bpmn:collaboration'), subproc: s.includes('subProcess') }); }
await b.close();

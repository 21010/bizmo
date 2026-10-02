// Reproduce: A imports OK → B fails ("no diagram") → C fails forever? Test recoveries.
import { readFileSync, readdirSync } from 'node:fs';
import { chromium } from 'playwright';
const ORIGIN = 'http://bizmo-spike.local';
const b = await chromium.launch(); const p = await b.newPage();
await p.route(`${ORIGIN}/**`, r => { const path = new URL(r.request().url()).pathname.slice(1);
  if (path==='index.html') return r.fulfill({contentType:'text/html', body:`<!doctype html><html><head><link rel="stylesheet" href="${ORIGIN}/c8.css"></head><body><div id="canvas" style="height:800px"></div><div id="properties"></div><script src="${ORIGIN}/c8.js"></script></body></html>`});
  try { return r.fulfill({ body: readFileSync('spikes/out/'+path), contentType: path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'application/octet-stream' }); } catch { return r.fulfill({status:404}); } });
const files = readdirSync('spikes/corpus/c8'); const xml = f => readFileSync('spikes/corpus/c8/'+f,'utf8');
const N = files.findIndex(f => f.includes('cloud-bpmn_diagram'));
const A = xml(files[N-1]), B = xml(files[N]), C = xml(files[N+1]);
const run = async (label, steps) => {
  await p.goto(`${ORIGIN}/index.html`); await p.waitForFunction(() => window.spikeReady);
  const out = await p.evaluate(async ({ steps, A, B, C }) => {
    const s = window.spike; const X = { A, B, C }; const r = [];
    for (const st of steps) {
      if (st === 'clear') { s.modeler.clear(); r.push('clear'); continue; }
      try { await s.importXML(X[st]); r.push(st + ':ok'); } catch (e) { r.push(st + ':ERR ' + String(e.message||e).slice(0,40)); }
    }
    return r;
  }, { steps, A, B, C });
  console.log(label.padEnd(28), out.join('  |  '));
};
console.log('A =', files[N-1].slice(0,60)); console.log('B =', files[N].slice(0,60)); console.log('C =', files[N+1].slice(0,60));
await run('A, B(fail), C', ['A','B','C','C']);
await run('B(fail), C', ['B','C']);
await run('A, B(fail), clear, C', ['A','B','clear','C']);
await run('A, B(fail), A, C', ['A','B','A','C']);
await run('A, C (control)', ['A','C']);
// What is in A that matters? timer events?
console.log('A timers:', (A.match(/timerEventDefinition/gi)||[]).length, ' C timers:', (C.match(/timerEventDefinition/gi)||[]).length);
await b.close();

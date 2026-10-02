import { readFileSync, readdirSync } from 'node:fs';
import { chromium } from 'playwright';
const ORIGIN = 'http://bizmo-spike.local';
const b = await chromium.launch(); const p = await b.newPage();
await p.route(`${ORIGIN}/**`, r => { const path = new URL(r.request().url()).pathname.slice(1);
  if (path==='index.html') return r.fulfill({contentType:'text/html', body:`<!doctype html><html><head><link rel="stylesheet" href="${ORIGIN}/c7.css"></head><body><div id="canvas" style="height:800px"></div><div id="properties"></div><script src="${ORIGIN}/c7.js"></script></body></html>`});
  try { return r.fulfill({ body: readFileSync('spikes/out/'+path), contentType: path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'application/octet-stream' }); } catch { return r.fulfill({status:404}); } });
await p.goto(`${ORIGIN}/index.html?noAlign`); await p.waitForFunction(() => window.spikeReady);
const attrs = s => new Set((s.match(/<(\w+:)?definitions\b[^>]*>/)?.[0].match(/[\w:-]+="[^"]*"/g)) || []);
const tally = {};
for (const f of readdirSync('spikes/corpus/c7')) {
  const x = readFileSync('spikes/corpus/c7/'+f,'utf8');
  const out = await p.evaluate(async x => { try { await window.spike.importXML(x); return await window.spike.saveXML(); } catch { window.spike.recreate(); return null; } }, x);
  if (!out) continue; const a = attrs(x), o = attrs(out);
  for (const v of o) if (!a.has(v)) { const k = '+ ' + v.replace(/="[^"]*"/, '=…'); tally[k] = (tally[k]||0)+1; }
  { const va=[...a].find(v=>v.startsWith('modeler:executionPlatformVersion')), vo=[...o].find(v=>v.startsWith('modeler:executionPlatformVersion')); if (va!==vo) console.log('CHANGED', f.slice(0,48), va, '->', vo); }
  for (const v of a) if (!o.has(v)) { if (v.startsWith('modeler:')) console.log('MISSING', f.slice(0,40), JSON.stringify(v), 'out has', JSON.stringify([...o].filter(x=>x.startsWith('modeler:')))); const k = '- ' + v.replace(/="[^"]*"/, '=…'); tally[k] = (tally[k]||0)+1; }
}
const crlf = readFileSync('spikes/corpus/c7/' + readdirSync('spikes/corpus/c7')[0], 'utf8').replace(/\r?\n/g, '\r\n') + '\r\n';
const o2 = await p.evaluate(async (x) => { await window.spike.importXML(x); return window.spike.saveXML(); }, crlf);
console.log('saveXML endsWithNewline:', o2.endsWith('\n'), ' containsCR:', o2.includes('\r'), ' (input had CRLF + final newline)');
await b.close();

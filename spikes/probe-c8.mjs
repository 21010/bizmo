// Re-run C8 imports individually to capture errors (diagnostic for S1/S3).
import { readFileSync, readdirSync } from 'node:fs';
import { chromium } from 'playwright';
const ORIGIN = 'http://bizmo-spike.local';
const b = await chromium.launch(); const p = await b.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.stack)); p.on('console', m => { if (m.type()==='error' && !m.text().includes('font')) errs.push(m.text().slice(0,300)); });
await p.route(`${ORIGIN}/**`, r => { const path = new URL(r.request().url()).pathname.slice(1);
  if (path==='index.html') return r.fulfill({contentType:'text/html', body:`<!doctype html><html><head><link rel="stylesheet" href="${ORIGIN}/c8.css"></head><body><div id="canvas" style="height:800px"></div><div id="properties"></div><script src="${ORIGIN}/c8.js"></script></body></html>`});
  try { return r.fulfill({ body: readFileSync('spikes/out/'+path), contentType: path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'application/octet-stream' }); } catch { return r.fulfill({status:404}); } });
await p.goto(`${ORIGIN}/index.html`); await p.waitForFunction(() => window.spikeReady);
const files = readdirSync('spikes/corpus/c8');
const fresh = { ok: 0, fail: {} }; const sequential = { ok: 0, fail: {} };
const run = async (xml) => p.evaluate(async x => { try { await window.spike.importXML(x); return null; } catch (e) { return String(e.message||e).slice(0,80); } }, xml);
for (const f of files) { const xml = readFileSync('spikes/corpus/c8/'+f,'utf8');
  const seq = await run(xml); if (seq) (sequential.fail[seq] ??= []).push(f.slice(0,40)); else sequential.ok++;
  await p.reload(); await p.waitForFunction(() => window.spikeReady);
  const fr = await run(xml); if (fr) (fresh.fail[fr] ??= []).push(f.slice(0,40)); else fresh.ok++;
  await p.reload(); await p.waitForFunction(() => window.spikeReady); }
console.log('FRESH modeler per file:', fresh.ok, 'ok', JSON.stringify(Object.fromEntries(Object.entries(fresh.fail).map(([k,v])=>[k,v.length]))));
console.log('SEQUENTIAL (fresh, then same file once more? no: first import after reload):', sequential.ok, 'ok'); console.log('other console/page errors:', [...new Set(errs)].slice(0,8));
await b.close();

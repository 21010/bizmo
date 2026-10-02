// Does one failed import leave the modeler unable to import valid diagrams? Which recovery works?
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
const ORIGIN = 'http://bizmo-spike.local';
const b = await chromium.launch(); const p = await b.newPage();
await p.route(`${ORIGIN}/**`, r => { const path = new URL(r.request().url()).pathname.slice(1);
  if (path==='index.html') return r.fulfill({contentType:'text/html', body:`<!doctype html><html><head><link rel="stylesheet" href="${ORIGIN}/c8.css"></head><body><div id="canvas" style="height:800px"></div><div id="properties"></div><script src="${ORIGIN}/c8.js"></script></body></html>`});
  try { return r.fulfill({ body: readFileSync('spikes/out/'+path), contentType: path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'application/octet-stream' }); } catch { return r.fulfill({status:404}); } });
const good = readFileSync('spikes/corpus/c8/camunda_camunda-platform-get-started-process_send-email.bpmn','utf8');
const bad = {
  noDiagram: readFileSync('spikes/corpus/c8/camunda_camunda-modeler-client_src_app_tabs_cloud-bpmn_diagram.bpmn','utf8'),
  malformedXml: good.slice(0, 600),
  notBpmn: '<?xml version="1.0"?><foo/>',
};
const scenario = async (badXml, recovery) => {
  await p.goto(`${ORIGIN}/index.html`); await p.waitForFunction(() => window.spikeReady);
  return p.evaluate(async ({ good, badXml, recovery }) => {
    const s = window.spike; const r = {};
    const imp = async x => { try { await s.importXML(x); return 'ok'; } catch (e) { return 'ERR ' + String(e.message||e).slice(0,50); } };
    r.goodFirst = await imp(good);
    r.bad = await imp(badXml);
    if (recovery === 'clear') s.modeler.clear();
    r.goodAfter = await imp(good);
    r.goodAfterAgain = await imp(good);
    return r;
  }, { good, badXml, recovery });
};
for (const [name, xml] of Object.entries(bad)) for (const recovery of ['none', 'clear']) console.log(name.padEnd(12), recovery.padEnd(5), JSON.stringify(await scenario(xml, recovery)));
await b.close();

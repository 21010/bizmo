import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
const ORIGIN = 'http://bizmo-spike.local';
const b = await chromium.launch(); const p = await b.newPage();
await p.route(`${ORIGIN}/**`, r => { const path = new URL(r.request().url()).pathname.slice(1);
  if (path==='index.html') return r.fulfill({contentType:'text/html', body:`<!doctype html><html><head><link rel="stylesheet" href="${ORIGIN}/c8.css"></head><body><div id="canvas" style="height:800px"></div><div id="properties"></div><script src="${ORIGIN}/c8.js"></script></body></html>`});
  try { return r.fulfill({ body: readFileSync('spikes/out/'+path), contentType: path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'application/octet-stream' }); } catch { return r.fulfill({status:404}); } });
const d = f => readFileSync('spikes/corpus/c8/'+f,'utf8');
const X = d('asc-lab_camunda-modeler-plugin-documentation-generator-docs_example.bpmn'), Y = d('berndruecker_camunda-cloud-clients-parallel-job-execution-rest.bpmn'),
      N = d('camunda_camunda-modeler-client_src_app_tabs_cloud-bpmn_diagram.bpmn'), C = d('camunda_camunda-platform-get-started-process_send-email.bpmn');
const run = async (label, steps) => {
  await p.goto(`${ORIGIN}/index.html`); await p.waitForFunction(() => window.spikeReady);
  const out = await p.evaluate(async ({ steps, docs }) => {
    const s = window.spike; const r = []; let stack;
    for (const st of steps) {
      if (st === 'clear') { s.modeler.clear(); r.push('clear'); continue; }
      if (st === 'recreate') { s.recreate(); r.push('recreate'); continue; }
      if (st === 'deselect') { s.get('selection').select(null); r.push('deselect'); continue; }
      try { await s.importXML(docs[st]); r.push(st+':ok'); } catch (e) { r.push(st+':ERR'); if (st === 'C') stack = String(e.stack).split('\n').slice(0,12).join('\n'); }
    }
    return { r: r.join(' '), stack };
  }, { steps, docs: { X, Y, N, C } });
  console.log(label.padEnd(26), out.r); if (out.stack && label === 'X Y N C') console.log(out.stack);
};
await run('X Y N C', ['X','Y','N','C']);
await run('X Y C (no failure)', ['X','Y','C']);
await run('Y N C', ['Y','N','C']);
await run('X Y N clear C', ['X','Y','N','clear','C']);
await run('X Y N C C C', ['X','Y','N','C','C','C']);
await run('X Y deselect N C', ['X','Y','deselect','N','C']);
await run('X Y N recreate C C', ['X','Y','N','recreate','C','C']);
console.log('Y features:', { timers: (Y.match(/timerEventDefinition/g)||[]).length, boundary: (Y.match(/boundaryEvent/g)||[]).length, multiInstance: (Y.match(/multiInstanceLoopCharacteristics/g)||[]).length, subprocess: (Y.match(/subProcess/g)||[]).length });
console.log('N root:', N.match(/<bpmn:(process|collaboration)[^>]*>/)?.[0], ' has BPMNDiagram:', N.includes('BPMNDiagram'));
await b.close();

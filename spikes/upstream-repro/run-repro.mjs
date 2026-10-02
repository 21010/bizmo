// Runs repro.html in Chromium with unpkg URLs served from local node_modules (same published files).
// Usage: node spikes/upstream-repro/run-repro.mjs
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const local = {
  'bpmn-js@18.31.0': 'node_modules/bpmn-js',
  'bpmn-js-properties-panel@5.65.1': 'node_modules/bpmn-js-properties-panel',
  '@bpmn-io/properties-panel@3.56.1': 'node_modules/@bpmn-io/properties-panel',
  'zeebe-bpmn-moddle@2.0.0': 'node_modules/zeebe-bpmn-moddle',
};

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (error) => console.log('pageerror:', error.message));
await page.route('https://unpkg.com/**', (route) => {
  const path = decodeURIComponent(new URL(route.request().url()).pathname.slice(1));
  const entry = Object.keys(local).find((pkg) => path.startsWith(`${pkg}/`));
  if (!entry) return route.fulfill({ status: 404, body: `not mapped: ${path}` });
  const file = `${local[entry]}/${path.slice(entry.length + 1)}`;
  const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'application/json';
  return route.fulfill({ body: readFileSync(file), contentType: type });
});
await page.route('http://repro.local/repro.html', (route) =>
  route.fulfill({ contentType: 'text/html', body: readFileSync('spikes/upstream-repro/repro.html') }),
);
await page.goto('http://repro.local/repro.html');
await page.waitForFunction(() => document.getElementById('log').textContent.includes('4. valid'), null, { timeout: 30000 });
console.log(await page.locator('#log').textContent());
await browser.close();

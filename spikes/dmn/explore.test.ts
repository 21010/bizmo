// Exploration: what each fixture renders, and the DOM hooks for driving each view.
import { appendFileSync, readFileSync } from 'node:fs';
import { afterAll, beforeAll, it } from 'vitest';
import type { Browser } from 'playwright';
import { launchBrowser, openWebview } from '../../test/webview/harness';

const dmn = (name: string) => readFileSync(`test/fixtures/dmn/${name}`, 'utf8');
let browser: Browser;
beforeAll(async () => (browser = await launchBrowser()));
afterAll(async () => browser.close());

it.each([
  ['c8-dish.dmn', 'c8'],
  ['c7-dish.dmn', 'c7'],
  ['c7-dmn11.dmn', 'c7'],
  ['c7-dmn12.dmn', 'c7'],
] as const)('%s', async (name, platform) => {
  const w = await openWebview(browser, 'dmn');
  await w.send({ type: 'init', content: dmn(name), version: 1, platform });
  const result = await w.waitForImport(1);
  await w.page.waitForTimeout(500);
  const dom = await w.page.evaluate(() => ({
    containers: [...document.querySelectorAll('[class*="dmn-"][class*="container"]')].map(
      (e) => e.className,
    ),
    drillDowns: document.querySelectorAll('.drill-down-overlay').length,
    shapes: document.querySelectorAll('.djs-shape').length,
    panel: document.querySelector('.bio-properties-panel-header-label')?.textContent ?? null,
    tableCells: document.querySelectorAll('td[contenteditable], td [contenteditable]').length,
  }));
  appendFileSync(process.env.OUT ?? 'spikes/dmn/out.jsonl', `${JSON.stringify({
      name,
      result,
      dom,
      violations: await w.violations(),
      errors: w.errors,
      logs: (await w.posted()).filter((m) => m.type === 'log'),
    })}\n`);
  await w.close();
});

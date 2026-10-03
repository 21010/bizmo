import type { Browser } from 'playwright';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fixture, launchBrowser, openWebview, type WebviewPage } from './harness';

let browser: Browser;
let webview: WebviewPage | undefined;

beforeAll(async () => {
  browser = await launchBrowser();
});

afterAll(async () => {
  await browser.close();
});

afterEach(async () => {
  if (webview) {
    // Every test also asserts the security baseline: no CSP violations, no errors.
    expect(await webview.violations()).toEqual([]);
    expect(webview.errors).toEqual([]);
    await webview.close();
    webview = undefined;
  }
});

const open = async (initialState?: unknown) =>
  (webview = await openWebview(browser, 'bpmn', initialState));

describe('BPMN viewer webview', () => {
  it.each([
    ['c8-order.bpmn', 'c8'],
    ['c7-invoice.bpmn', 'c7'],
    ['no-platform.bpmn', 'c8'],
  ] as const)('renders %s', async (name, platform) => {
    const w = await open();
    await w.send({ type: 'init', content: fixture(name), version: 1, platform });
    const result = await w.waitForImport(1);
    expect(result).toMatchObject({ ok: true, warnings: [] });
    expect(result.ok && result.elementCount).toBeGreaterThan(3);
    expect(await w.page.locator('.djs-container svg').count()).toBeGreaterThan(0);
    // bpmn.io license: the watermark stays visible.
    expect(await w.page.locator('.bjs-powered-by').isVisible()).toBe(true);
  });

  it('renders hostile names and documentation as text, without executing anything', async () => {
    const w = await open();
    await w.send({
      type: 'init',
      content: fixture('hostile-labels.bpmn'),
      version: 1,
      platform: 'c8',
    });
    expect(await w.waitForImport(1)).toMatchObject({ ok: true });
    expect(await w.page.evaluate(() => window.__pwned)).toBeUndefined();
    // (CodeMirror renders src-less <img class="cm-widgetBuffer"> placeholders; those are inert.)
    const active = 'img[src], iframe, a[href^="command:"], [onload], [onerror], [onclick]';
    expect(await w.page.locator(active).count()).toBe(0);
    expect(await w.page.locator('.djs-container').textContent()).toContain('<img src=x');
  });

  it.each(['truncated.bpmn', 'not-bpmn.bpmn'])(
    'shows an error overlay for %s and offers "Open as Text"',
    async (name) => {
      const w = await open();
      await w.send({ type: 'init', content: fixture(name), version: 1, platform: 'c8' });
      expect(await w.waitForImport(1)).toMatchObject({ ok: false });
      const overlay = w.page.locator('.bizmo-overlay');
      await expect.poll(() => overlay.isVisible()).toBe(true);
      expect(await overlay.locator('h2').textContent()).toBe('This diagram cannot be displayed');
      await overlay.getByRole('button', { name: 'Open as Text' }).click();
      expect(await w.posted()).toContainEqual({ type: 'openAsText' });
    },
  );

  it('recovers after a failed import when a valid update arrives (ADR 0008)', async () => {
    const w = await open();
    await w.send({ type: 'init', content: fixture('c8-order.bpmn'), version: 1, platform: 'c8' });
    await w.waitForImport(1);
    await w.send({
      type: 'update',
      content: fixture('truncated.bpmn'),
      version: 2,
      platform: 'c8',
    });
    expect(await w.waitForImport(2)).toMatchObject({ ok: false });
    await w.send({ type: 'update', content: fixture('c8-order.bpmn'), version: 3, platform: 'c8' });
    expect(await w.waitForImport(3)).toMatchObject({ ok: true });
    expect(await w.page.locator('.bizmo-overlay').count()).toBe(0);
  });

  it('switches between Camunda 7 and Camunda 8 viewers on update', async () => {
    const w = await open();
    await w.send({ type: 'init', content: fixture('c8-order.bpmn'), version: 1, platform: 'c8' });
    await w.waitForImport(1);
    await w.send({
      type: 'update',
      content: fixture('c7-invoice.bpmn'),
      version: 2,
      platform: 'c7',
    });
    expect(await w.waitForImport(2)).toMatchObject({ ok: true });
    expect(await w.page.locator('.djs-container').count()).toBe(1);
  });

  it('shows the host rejection without importing', async () => {
    const w = await open();
    await w.send({
      type: 'loadRejected',
      version: 1,
      reason: 'doctype',
      message: 'DOCTYPE blocked',
    });
    const overlay = w.page.locator('.bizmo-overlay');
    await expect.poll(() => overlay.isVisible()).toBe(true);
    expect(await overlay.locator('pre').textContent()).toBe('DOCTYPE blocked');
    expect((await w.posted()).some((m) => m.type === 'importResult')).toBe(false);
  });

  it.each([0, 200, 400])(
    'imports in a %ipx-wide editor and shows the diagram once there is room',
    async (width) => {
      const w = await open();
      await w.page.setViewportSize({ width: Math.max(width, 1), height: 600 });
      await w.send({ type: 'init', content: fixture('c8-order.bpmn'), version: 1, platform: 'c8' });
      expect(await w.waitForImport(1)).toMatchObject({ ok: true });

      await w.page.setViewportSize({ width: 1200, height: 800 });
      await expect
        .poll(() =>
          w.page
            .locator('[data-element-id="Task_Check"]')
            .first()
            .evaluate((e) => {
              const box = e.getBoundingClientRect();
              return box.width > 0 && box.left >= 0 && box.right <= window.innerWidth;
            }),
        )
        .toBe(true);
    },
  );

  it('keeps the viewport on update and restores it from saved state', async () => {
    const w = await open();
    await w.send({ type: 'init', content: fixture('c8-order.bpmn'), version: 1, platform: 'c8' });
    await w.waitForImport(1);
    await w.page.mouse.move(400, 300);
    await w.page.keyboard.down('Control');
    await w.page.mouse.wheel(0, -300);
    await w.page.keyboard.up('Control');
    await expect.poll(() => w.state(), { timeout: 3000 }).toHaveProperty('viewbox');
    const zoomed = (await w.state()) as { viewbox: { width: number } };

    const renamed = fixture('c8-order.bpmn').replace('Check stock', 'Check inventory');
    await w.send({ type: 'update', content: renamed, version: 2, platform: 'c8' });
    await w.waitForImport(2);
    await w.page.waitForTimeout(400);
    expect(((await w.state()) as { viewbox: { width: number } }).viewbox.width).toBeCloseTo(
      zoomed.viewbox.width,
      0,
    );
    await w.close();

    // A recreated webview (tab switch) starts from the persisted viewport.
    webview = await openWebview(browser, 'bpmn', zoomed);
    await webview.send({
      type: 'init',
      content: fixture('c8-order.bpmn'),
      version: 1,
      platform: 'c8',
    });
    await webview.waitForImport(1);
    await webview.page.waitForTimeout(400);
    expect(((await webview.state()) as { viewbox: { width: number } }).viewbox.width).toBeCloseTo(
      zoomed.viewbox.width,
      0,
    );
  });

  it('drops invalid host messages and reports them', async () => {
    const w = await open();
    await w.send({ type: 'init', content: 42, version: 1, platform: 'c8' });
    await w.send({ type: 'runScript', code: 'window.__pwned = 1' });
    await expect
      .poll(async () => (await w.posted()).filter((m) => m.type === 'log').length)
      .toBe(2);
    expect((await w.posted()).some((m) => m.type === 'importResult')).toBe(false);
  });
});

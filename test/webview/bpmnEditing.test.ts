// Editing and sync behaviour of the BPMN webview (ADR 0007), driven with trusted input.
import type { Browser } from 'playwright';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { WebviewToHostMessage } from '../../src/shared/protocol';
import { fixture, launchBrowser, openWebview, type WebviewPage } from './harness';

type Edit = Extract<WebviewToHostMessage, { type: 'edit' }>;

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
    expect(await webview.violations()).toEqual([]);
    expect(webview.errors).toEqual([]);
    await webview.close();
    webview = undefined;
  }
});

async function openOrder(): Promise<WebviewPage> {
  webview = await openWebview(browser, 'bpmn');
  await webview.send({
    type: 'init',
    content: fixture('c8-order.bpmn'),
    version: 1,
    platform: 'c8',
  });
  expect(await webview.waitForImport(1)).toMatchObject({ ok: true });
  return webview;
}

const edits = async (w: WebviewPage): Promise<Edit[]> =>
  (await w.posted()).filter((m): m is Edit => m.type === 'edit');

/** Selects an element with a trusted click and deletes it with the keyboard. */
async function deleteElement(w: WebviewPage, id: string): Promise<void> {
  await w.page.locator(`[data-element-id="${id}"]`).first().click({ force: true });
  await w.page.keyboard.press('Delete');
}

describe('BPMN editing', () => {
  it('sends a debounced full-document edit based on the rendered version', async () => {
    const w = await openOrder();
    await deleteElement(w, 'Task_Ship');
    expect(await edits(w)).toEqual([]); // debounced, not sent yet
    await expect.poll(async () => (await edits(w)).length).toBe(1);
    const [edit] = await edits(w);
    expect(edit?.baseVersion).toBe(1);
    expect(edit?.content).not.toContain('id="Task_Ship"');
    expect(edit?.content).toContain('id="Task_Check"');
    expect(edit?.content).toContain('modeler:executionPlatform="Camunda Cloud"');
  });

  it('batches quick changes into one edit', async () => {
    const w = await openOrder();
    await deleteElement(w, 'Task_Ship');
    await deleteElement(w, 'EndEvent_Rejected');
    await expect.poll(async () => (await edits(w)).length).toBe(1);
    await w.page.waitForTimeout(500);
    expect(await edits(w)).toHaveLength(1);
  });

  it('keeps one edit in flight and bases the next one on the reported version', async () => {
    const w = await openOrder();
    await deleteElement(w, 'Task_Ship');
    await expect.poll(async () => (await edits(w)).length).toBe(1);

    await deleteElement(w, 'EndEvent_Rejected');
    await w.page.waitForTimeout(600);
    expect(await edits(w)).toHaveLength(1); // waiting for the host's answer

    await w.send({ type: 'editResult', outcome: 'applied', version: 2 });
    await expect.poll(async () => (await edits(w)).length).toBe(2);
    expect((await edits(w))[1]?.baseVersion).toBe(2);
  });

  it('routes undo and redo to VS Code (no local undo, no extra edit) — ADR 0012', async () => {
    const w = await openOrder();
    await deleteElement(w, 'Task_Ship');
    await expect.poll(async () => (await edits(w)).length).toBe(1);
    await w.send({ type: 'editResult', outcome: 'applied', version: 2 });

    await w.page.keyboard.press('Control+Z');
    await w.page.keyboard.press('Control+Y');
    await w.page.keyboard.press('Control+Shift+Z');
    await expect
      .poll(async () => (await w.posted()).filter((m) => m.type === 'undo' || m.type === 'redo'))
      .toEqual([{ type: 'undo' }, { type: 'redo' }, { type: 'redo' }]);
    await w.page.waitForTimeout(400);
    expect(await edits(w)).toHaveLength(1);
    expect(await w.page.locator('[data-element-id="Task_Ship"]').count()).toBe(0);
  });

  it('sends a pending change before the undo, so that change is what gets undone', async () => {
    const w = await openOrder();
    await deleteElement(w, 'Task_Ship');
    await w.page.keyboard.press('Control+Z'); // well within the debounce
    await expect
      .poll(async () =>
        (await w.posted()).map((m) => m.type).filter((t) => t === 'edit' || t === 'undo'),
      )
      .toEqual(['edit', 'undo']);
  });

  it('still handles other shortcuts (select all)', async () => {
    const w = await openOrder();
    await w.page.locator('[data-element-id="Task_Check"]').first().click({ force: true });
    await w.page.keyboard.press('Control+A');
    await expect.poll(() => w.page.locator('.djs-element.selected').count()).toBeGreaterThan(5);
  });

  it('answers a flush immediately with the pending edit', async () => {
    const w = await openOrder();
    await deleteElement(w, 'Task_Ship');
    await w.send({ type: 'flush', requestId: 7 });
    await expect.poll(async () => (await edits(w)).length, { timeout: 200, interval: 20 }).toBe(1);
    expect((await edits(w))[0]?.requestId).toBe(7);
  });

  it('answers a flush with `flushed` when nothing is pending', async () => {
    const w = await openOrder();
    await w.send({ type: 'flush', requestId: 3 });
    await expect.poll(() => w.posted()).toContainEqual({ type: 'flushed', requestId: 3 });
  });

  it('answers a flush that arrives while an edit is in flight after that edit', async () => {
    const w = await openOrder();
    await deleteElement(w, 'Task_Ship');
    await expect.poll(async () => (await edits(w)).length).toBe(1);
    await w.send({ type: 'flush', requestId: 4 });
    await w.page.waitForTimeout(100);
    expect(await w.posted()).not.toContainEqual({ type: 'flushed', requestId: 4 });
    await w.send({ type: 'editResult', outcome: 'applied', version: 2 });
    await expect.poll(() => w.posted()).toContainEqual({ type: 'flushed', requestId: 4 });
  });

  it('drops local changes when the document changed meanwhile, then follows the document', async () => {
    const w = await openOrder();
    await deleteElement(w, 'Task_Ship');
    await expect.poll(async () => (await edits(w)).length).toBe(1);
    await w.send({ type: 'editResult', outcome: 'stale', version: 2 });
    const external = fixture('c8-order.bpmn').replace('Check stock', 'Check inventory');
    await w.send({ type: 'update', content: external, version: 2, platform: 'c8' });
    await w.waitForImport(2);
    expect(await w.page.locator('[data-element-id="Task_Ship"]').count()).toBeGreaterThan(0);

    await deleteElement(w, 'EndEvent_Rejected');
    await expect.poll(async () => (await edits(w)).length).toBe(2);
    const second = (await edits(w))[1];
    expect(second?.baseVersion).toBe(2);
    expect(second?.content).toContain('Check inventory');
  });

  it('discards a pending change when an external update arrives first', async () => {
    const w = await openOrder();
    await deleteElement(w, 'Task_Ship');
    await w.send({ type: 'update', content: fixture('c8-order.bpmn'), version: 2, platform: 'c8' });
    await w.waitForImport(2);
    await w.page.waitForTimeout(600);
    expect(await edits(w)).toEqual([]);
  });

  it('keeps the selection across an external update', async () => {
    const w = await openOrder();
    await w.page.locator('[data-element-id="Task_Check"]').first().click({ force: true });
    const renamed = fixture('c8-order.bpmn').replace('Ship order', 'Ship it');
    await w.send({ type: 'update', content: renamed, version: 2, platform: 'c8' });
    await w.waitForImport(2);
    expect(
      await w.page.locator('.djs-element.selected[data-element-id="Task_Check"]').count(),
    ).toBe(1);
  });

  it('sends pending changes when the editor loses focus', async () => {
    const w = await openOrder();
    await deleteElement(w, 'Task_Ship');
    await w.page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect.poll(async () => (await edits(w)).length, { timeout: 200, interval: 20 }).toBe(1);
  });

  it('serialises markup in labels safely', async () => {
    webview = await openWebview(browser, 'bpmn');
    const w = webview;
    await w.send({
      type: 'init',
      content: fixture('hostile-labels.bpmn'),
      version: 1,
      platform: 'c8',
    });
    await w.waitForImport(1);
    await deleteElement(w, 'Note');
    await expect.poll(async () => (await edits(w)).length).toBe(1);
    const content = (await edits(w))[0]?.content ?? '';
    expect(content).not.toMatch(/<img|<svg onload|<script/);
    expect(await w.page.evaluate(() => window.__pwned)).toBeUndefined();
  });
});

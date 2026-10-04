// Properties panel (M4): Camunda 7/8 properties, edits through the document, layout, undo.
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

async function open(
  name: string,
  platform: 'c7' | 'c8',
  initialState?: unknown,
): Promise<WebviewPage> {
  webview = await openWebview(browser, 'bpmn', initialState);
  await webview.send({ type: 'init', content: fixture(name), version: 1, platform });
  expect(await webview.waitForImport(1)).toMatchObject({ ok: true });
  return webview;
}

const edits = async (w: WebviewPage): Promise<Edit[]> =>
  (await w.posted()).filter((m): m is Edit => m.type === 'edit');

async function select(w: WebviewPage, id: string): Promise<void> {
  await w.page.locator(`[data-element-id="${id}"]`).first().click({ force: true });
  await expect
    .poll(() => w.page.locator('.bio-properties-panel-header-label').textContent())
    .toBeTruthy();
}

/** Opens a panel group (if collapsed) and returns a locator for one of its inputs. */
async function field(w: WebviewPage, groupId: string, inputId: string) {
  const input = w.page.locator(`#bio-properties-panel-${inputId}`);
  if (!(await input.isVisible())) {
    await w.page.locator(`[data-group-id="${groupId}"] .bio-properties-panel-group-header`).click();
  }
  await expect.poll(() => input.isVisible()).toBe(true);
  return input;
}

describe('properties panel', () => {
  it('shows Camunda 8 properties for a Camunda 8 service task and writes changes to the document', async () => {
    const w = await open('c8-order.bpmn', 'c8');
    await select(w, 'Task_Check');
    expect(await w.page.locator('[data-group-id="group-taskDefinition"]').count()).toBe(1);
    expect(await w.page.locator('[data-group-id^="group-CamundaPlatform__"]').count()).toBe(0);

    const type = await field(w, 'group-taskDefinition', 'taskDefinitionType');
    expect(await type.inputValue()).toBe('check-stock');
    await type.fill('check-inventory');

    await expect.poll(async () => (await edits(w)).length, { timeout: 5000 }).toBeGreaterThan(0);
    const content = (await edits(w)).at(-1)?.content ?? '';
    expect(content).toContain('<zeebe:taskDefinition type="check-inventory" retries="3" />');
  });

  it('shows Camunda 7 properties for a Camunda 7 service task and writes changes to the document', async () => {
    const w = await open('c7-invoice.bpmn', 'c7');
    await select(w, 'Task_Book');
    expect(
      await w.page.locator('[data-group-id="group-CamundaPlatform__Implementation"]').count(),
    ).toBe(1);
    expect(await w.page.locator('[data-group-id="group-taskDefinition"]').count()).toBe(0);

    const javaClass = await field(w, 'group-CamundaPlatform__Implementation', 'javaClass');
    expect(await javaClass.inputValue()).toBe('org.example.BookInvoiceDelegate');
    await javaClass.fill('org.example.PostInvoiceDelegate');

    await expect.poll(async () => (await edits(w)).length, { timeout: 5000 }).toBeGreaterThan(0);
    expect((await edits(w)).at(-1)?.content).toContain(
      'camunda:class="org.example.PostInvoiceDelegate"',
    );
  });

  it('keeps unknown extension elements and attributes when a property is edited', async () => {
    const w = await open('unknown-extensions.bpmn', 'c8');
    await select(w, 'Task');
    const type = await field(w, 'group-taskDefinition', 'taskDefinitionType');
    await type.fill('notify-v2');

    await expect.poll(async () => (await edits(w)).length, { timeout: 5000 }).toBeGreaterThan(0);
    const content = (await edits(w)).at(-1)?.content ?? '';
    expect(content).toContain('<zeebe:taskDefinition type="notify-v2" />');
    for (const fragment of [
      'acme:owner="team-orders"',
      'acme:sla="PT4H"',
      'acme:costCenter="4711"',
      '<acme:retryPolicy maxAttempts="5" backoff="exponential" />',
      '<acme:tag key="domain" value="sales" />',
      '<zeebe:header key="channel" value="email" />',
    ]) {
      expect(content).toContain(fragment);
    }
  });

  it('routes undo typed in a panel field to VS Code instead of undoing locally', async () => {
    const w = await open('c8-order.bpmn', 'c8');
    await select(w, 'Task_Check');
    const type = await field(w, 'group-taskDefinition', 'taskDefinitionType');
    await type.fill('check-inventory');
    await type.press('Control+Z');

    await expect.poll(async () => (await w.posted()).some((m) => m.type === 'undo')).toBe(true);
    const types = (await w.posted()).map((m) => m.type).filter((t) => t === 'edit' || t === 'undo');
    expect(types.indexOf('edit')).toBeLessThan(types.indexOf('undo')); // pending change sent first
    await w.page.waitForTimeout(500);
    expect(await type.inputValue()).toBe('check-inventory'); // no local undo in the panel
  });

  it('refreshes the panel after an external change', async () => {
    const w = await open('c8-order.bpmn', 'c8');
    await select(w, 'Task_Check');
    const type = await field(w, 'group-taskDefinition', 'taskDefinitionType');
    const changed = fixture('c8-order.bpmn').replace('type="check-stock"', 'type="stock-check-v2"');
    await w.send({ type: 'update', content: changed, version: 2, platform: 'c8' });
    await w.waitForImport(2);
    await expect.poll(() => type.inputValue()).toBe('stock-check-v2');
  });
});

describe('colors', () => {
  it("keeps Bizmo's own colors on the canvas whatever the VS Code theme; the panel follows it", async () => {
    const w = await open('c8-order.bpmn', 'c8');
    // A high-contrast-like theme: white foreground, unusual font.
    await w.page.evaluate(() => {
      document.documentElement.style.setProperty('--vscode-foreground', '#ffffff');
      document.documentElement.style.setProperty('--vscode-sideBar-foreground', '#ffffff');
      document.documentElement.style.setProperty('--vscode-font-family', 'Courier New');
    });
    await select(w, 'Task_Check');
    const style = (selector: string) =>
      w.page
        .locator(selector)
        .first()
        .evaluate((e) => {
          const computed = getComputedStyle(e);
          return { color: computed.color, font: computed.fontFamily };
        });

    const canvasText = { color: 'rgb(34, 36, 42)', font: 'Arial, sans-serif' };
    expect(await style('.djs-minimap .toggle')).toEqual(canvasText);
    expect(await style('.djs-context-pad .entry')).toMatchObject({ color: canvasText.color });
    expect((await style('.bio-properties-panel-header-label')).color).toBe('rgb(255, 255, 255)');
  });
});

describe('panel layout', () => {
  it.each([1200, 700, 460])(
    'never covers the bpmn.io watermark (license requirement) at %ipx',
    async (width) => {
      const w = await open('c8-order.bpmn', 'c8');
      await w.page.setViewportSize({ width, height: 700 });
      await w.page.waitForTimeout(200);
      const uncovered = await w.page.locator('.bjs-powered-by').evaluate((watermark) => {
        const box = watermark.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return box.width > 0 && hit !== null && watermark.contains(hit);
      });
      expect(uncovered).toBe(true);
    },
  );

  const panelWidth = (w: WebviewPage) =>
    w.page.locator('#bizmo-panel').evaluate((e) => e.getBoundingClientRect().width);

  it('is resizable with the mouse and the keyboard, and remembers its width', async () => {
    const w = await open('c8-order.bpmn', 'c8');
    const before = await panelWidth(w);
    const splitter = w.page.locator('.bizmo-splitter');
    const box = await splitter.boundingBox();
    if (!box) throw new Error('no splitter');
    await w.page.mouse.move(box.x + 2, box.y + 200);
    await w.page.mouse.down();
    await w.page.mouse.move(box.x - 98, box.y + 200, { steps: 5 });
    await w.page.mouse.up();
    expect(await panelWidth(w)).toBeCloseTo(before + 100, -1);

    await splitter.focus();
    await w.page.keyboard.press('ArrowRight');
    expect(await panelWidth(w)).toBeCloseTo(before + 80, -1);
    expect(await splitter.getAttribute('aria-valuenow')).toBe(String(Math.round(before + 80)));

    expect(await w.state()).toMatchObject({
      panel: { width: Math.round(before + 80), collapsed: false },
    });
  });

  it('collapses and expands, and restores the layout in a recreated webview', async () => {
    const w = await open('c8-order.bpmn', 'c8');
    const toggle = w.page.locator('.bizmo-panel-toggle');
    expect(await toggle.getAttribute('aria-expanded')).toBe('true');
    await toggle.click();
    expect(await toggle.getAttribute('aria-expanded')).toBe('false');
    expect(await w.page.locator('#bizmo-panel').isVisible()).toBe(false);
    const saved = await w.state();
    await w.close();

    webview = await openWebview(browser, 'bpmn', saved);
    const restored = webview;
    await restored.send({
      type: 'init',
      content: fixture('c8-order.bpmn'),
      version: 1,
      platform: 'c8',
    });
    await restored.waitForImport(1);
    expect(await restored.page.locator('#bizmo-panel').isVisible()).toBe(false);
    await restored.page.locator('.bizmo-panel-toggle').click();
    expect(await restored.page.locator('#bizmo-panel').isVisible()).toBe(true);
  });
});

// DMN prototype checks (ADR 0014, "Spike before implementation"), driven with trusted input in
// Chromium under the production CSP. Measurements are appended to $OUT as JSON lines.
import { appendFileSync, readFileSync } from 'node:fs';
import type { Browser } from 'playwright';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { checkExportedImage } from '../../src/extension/core/imageExport';
import type { WebviewToHostMessage } from '../../src/shared/protocol';
import { launchBrowser, openWebview, type WebviewPage } from '../../test/webview/harness';

type Edit = Extract<WebviewToHostMessage, { type: 'edit' }>;
const dmn = (name: string) => readFileSync(`test/fixtures/dmn/${name}`, 'utf8');
const record = (check: string, data: unknown) =>
  appendFileSync(process.env.OUT ?? 'spikes/dmn/out.jsonl', `${JSON.stringify({ check, data })}\n`);

let browser: Browser;
let w: WebviewPage | undefined;

beforeAll(async () => {
  browser = await launchBrowser();
});
afterAll(async () => {
  await browser.close();
});
afterEach(async () => {
  if (!w) return;
  expect(await w.violations()).toEqual([]);
  expect(w.errors).toEqual([]);
  await w.close();
  w = undefined;
});

/** Opens a fixture with a stand-in host that answers every edit with `applied`. */
async function open(name: string, platform: 'c7' | 'c8', state?: unknown): Promise<WebviewPage> {
  w = await openWebview(browser, 'dmn', state);
  await w.page.evaluate(() => {
    let version = 1;
    const push = window.__posted.push.bind(window.__posted);
    window.__posted.push = (...messages) => {
      for (const m of messages) {
        if (m.type === 'edit') {
          version += 1;
          const answer = { type: 'editResult', outcome: 'applied', version };
          setTimeout(() => window.postMessage(answer, '*'), 5);
        }
      }
      return push(...messages);
    };
  });
  await w.send({ type: 'init', content: dmn(name), version: 1, platform });
  expect(await w.waitForImport(1)).toMatchObject({ ok: true });
  return w;
}

const edits = async (page: WebviewPage) =>
  (await page.posted()).filter((m): m is Edit => m.type === 'edit');
const activeContainer = (page: WebviewPage) =>
  page.page.evaluate(() => {
    const visible = [...document.querySelectorAll<HTMLElement>('[class*="dmn-"][class*="-container"]')]
      .filter((e) => e.offsetParent !== null)
      .map((e) => e.classList[0]);
    return visible[0] ?? null;
  });

/** Opens a decision's view from the DRD (the drill-down buttons carry no element id). */
async function drillDown(page: WebviewPage, kind: 'decision table' | 'literal expression') {
  await page.page.click(`.drill-down-overlay button[title="Open ${kind}"]`);
  await page.page.waitForTimeout(300);
}

const cell = (id: string) => `[data-element-id="${id}"]`;
const focusedId = (page: WebviewPage) =>
  page.page.evaluate(
    () =>
      document.activeElement?.closest('[data-element-id]')?.getAttribute('data-element-id') ??
      document.activeElement?.tagName ??
      null,
  );

describe('decision table', () => {
  it('commits typing: how often, and how many edits reach the host', async () => {
    const page = await open('c8-dish.dmn', 'c8');
    await drillDown(page, 'decision table');
    expect(await activeContainer(page)).toBe('dmn-decision-table-container');

    await page.page.click(cell('OutputEntry_Winter'));
    await page.page.keyboard.press('End');
    // Slower than the 300 ms edit debounce: each commit by dmn-js becomes its own edit.
    for (const key of ['X', 'Y', 'Z']) {
      await page.page.keyboard.type(key);
      await page.page.waitForTimeout(450);
    }
    const slow = await edits(page);
    // Fast typing: commits are combined by the debounce.
    await page.page.keyboard.type('abcdef', { delay: 30 });
    await page.page.waitForTimeout(700);
    const fast = (await edits(page)).length - slow.length;
    const last = (await edits(page)).at(-1)?.content ?? '';
    record('typing', {
      slowKeys: 3,
      slowEdits: slow.length,
      fastKeys: 6,
      fastEdits: fast,
      lastHasText: last.includes('SpareribsXYZabcdef') || last.includes('XYZabcdef'),
    });
    expect(last).toContain('XYZabcdef');
  });

  it('routes Ctrl+Z / Ctrl+Y in a cell to the host and leaves the cell unchanged', async () => {
    const page = await open('c8-dish.dmn', 'c8');
    await drillDown(page, 'decision table');
    await page.page.click(cell('OutputEntry_Winter'));
    await page.page.keyboard.press('End');
    await page.page.keyboard.type('Q');
    await page.page.waitForTimeout(500);
    const before = await page.page.textContent(cell('OutputEntry_Winter'));
    await page.page.keyboard.press('Control+z');
    await page.page.keyboard.press('Control+y');
    await page.page.keyboard.press('Control+Shift+z');
    await page.page.waitForTimeout(300);
    const after = await page.page.textContent(cell('OutputEntry_Winter'));
    const routed = (await page.posted())
      .filter((m) => m.type === 'undo' || m.type === 'redo')
      .map((m) => m.type);
    record('undoKeys', { routed, cellBefore: before, cellAfter: after });
    expect(routed).toEqual(['undo', 'redo', 'redo']);
    expect(after).toBe(before);
  });

  it('keyboard navigation in the table', async () => {
    const page = await open('c8-dish.dmn', 'c8');
    await drillDown(page, 'decision table');
    await page.page.click(cell('InputEntry_Winter_Season'));
    const moves: Record<string, string | null> = {
      start: await focusedId(page),
    };
    for (const key of ['Tab', 'Tab', 'Shift+Tab', 'Enter', 'Shift+Enter', 'ArrowDown']) {
      await page.page.keyboard.press(key);
      await page.page.waitForTimeout(100);
      moves[`${Object.keys(moves).length}:${key}`] = await focusedId(page);
    }
    const routed = (await page.posted()).filter((m) => m.type === 'undo' || m.type === 'redo');
    record('tableKeys', { moves, routedUndoRedo: routed.length });
    expect(routed).toEqual([]);
  });

  it('keeps the table on re-import (update) and shows the new content', async () => {
    const page = await open('c8-dish.dmn', 'c8');
    await drillDown(page, 'decision table');
    await page.send({
      type: 'update',
      content: dmn('c8-dish.dmn').replace('"Salad"', '"Soup"'),
      version: 7,
      platform: 'c8',
    });
    expect(await page.waitForImport(7)).toMatchObject({ ok: true });
    const view = await activeContainer(page);
    const text = await page.page.textContent(cell('OutputEntry_Summer'));
    record('reimport', { view, text });
    expect(view).toBe('dmn-decision-table-container');
    expect(text).toContain('Soup');
  });

  it('restores the saved view when the webview is recreated', async () => {
    const first = await open('c8-dish.dmn', 'c8');
    await drillDown(first, 'decision table');
    const state = await first.state();
    expect(await first.violations()).toEqual([]);
    await first.close();
    w = undefined;
    const second = await open('c8-dish.dmn', 'c8', state);
    const view = await activeContainer(second);
    record('restoreView', { state, view });
    expect(view).toBe('dmn-decision-table-container');
  });
});

describe('other views', () => {
  it('literal expression: editing reaches the host', async () => {
    const page = await open('c8-dish.dmn', 'c8');
    await drillDown(page, 'literal expression');
    const view = await activeContainer(page);
    const editable = await page.page.evaluate(() =>
      [...document.querySelectorAll('[contenteditable="true"], .cm-content, textarea, input')]
        .filter((e) => (e as HTMLElement).offsetParent !== null)
        .map((e) => `${e.tagName}.${e.className}`),
    );
    // The first editable is the decision name in the header; the expression is CodeMirror.
    const target = page.page.locator('.literal-expression .cm-content');
    await target.click();
    await page.page.keyboard.press('End');
    await page.page.keyboard.type(' + ""', { delay: 30 });
    await page.page.waitForTimeout(700);
    const last = (await edits(page)).at(-1)?.content ?? '';
    record('literalExpression', {
      view,
      editable,
      edits: (await edits(page)).length,
      changed: last.includes('"Summer" + ""'),
    });
    expect(last).toContain('"Summer" + ""');
  });

  it('DRD: the properties panel edits the decision name', async () => {
    const page = await open('c8-dish.dmn', 'c8');
    await page.page.click('.djs-element[data-element-id="Decision_Dish"] .djs-hit', { force: true });
    const name = page.page.locator('.bio-properties-panel [name="name"]').first();
    // The DMN panel opens with its groups collapsed.
    const openedGroup = !(await name.isVisible());
    if (openedGroup) await page.page.click('.bio-properties-panel-group-header:has-text("General")');
    await name.click();
    await page.page.keyboard.press('End');
    await page.page.keyboard.type(' plan', { delay: 30 });
    await page.page.waitForTimeout(700);
    const fieldValue = await name.inputValue();
    const editsWhileFocused = (await edits(page)).length;
    const shapeWhileFocused = await page.page.textContent(
      '.djs-element[data-element-id="Decision_Dish"]',
    );
    await page.page.waitForTimeout(2000);
    const editsAfter2s = (await edits(page)).length;
    // Leaving the field (blur) may be what commits.
    await page.page.click('.djs-element[data-element-id="Decision_Season"] .djs-hit', { force: true });
    await page.page.waitForTimeout(700);
    const shapeLabel = await page.page.textContent('.djs-element[data-element-id="Decision_Dish"]');
    const last = (await edits(page)).at(-1)?.content ?? '';
    record('propertiesPanel', { fieldValue, editsWhileFocused, shapeWhileFocused, editsAfter2s, shapeLabel, openedGroup, edits: (await edits(page)).length, renamed: last.includes('Dish plan') });
    expect(last).toContain('name="Dish plan"');
  });

  it('exports the DRD; other views explain why not', async () => {
    const page = await open('c8-dish.dmn', 'c8');
    await page.send({ type: 'export', requestId: 1, format: 'svg' });
    await page.send({ type: 'export', requestId: 2, format: 'png' });
    await page.page.waitForTimeout(1500);
    await drillDown(page, 'decision table');
    await page.send({ type: 'export', requestId: 3, format: 'svg' });
    await page.page.waitForTimeout(500);
    const exported = (await page.posted()).filter(
      (m): m is Extract<WebviewToHostMessage, { type: 'exported' }> => m.type === 'exported',
    );
    const summary = exported.map((m) =>
      m.ok
        ? { id: m.requestId, ok: true, hostCheck: checkExportedImage(m.format, m.data).ok }
        : { id: m.requestId, ok: false, error: m.error },
    );
    record('export', summary);
    expect(summary).toEqual([
      { id: 1, ok: true, hostCheck: true },
      { id: 2, ok: true, hostCheck: true },
      { id: 3, ok: false, error: expect.stringContaining('decision requirements diagram') },
    ]);
  });
});

describe('DMN 1.1 / 1.2', () => {
  it.each([
    ['c7-dmn11.dmn', 'outputEntry_winter'],
    ['c7-dmn12.dmn', 'outputEntry_winter12'],
  ])('%s: opening sends no edit; the first change saves DMN 1.3', async (name, entry) => {
    const page = await open(name, 'c7');
    await page.page.waitForTimeout(800);
    const editsAfterOpen = (await edits(page)).length;
    if ((await activeContainer(page)) !== 'dmn-decision-table-container') {
      await drillDown(page, 'decision table');
    }
    await page.page.click(cell(entry));
    await page.page.keyboard.press('End');
    await page.page.keyboard.type('!');
    await page.page.waitForTimeout(700);
    const last = (await edits(page)).at(-1)?.content ?? '';
    record('migration', {
      name,
      editsAfterOpen,
      dmn13: last.includes('https://www.omg.org/spec/DMN/20191111/MODEL/'),
      oldNamespaceLeft: /20151101|20180521\/MODEL/.test(last),
      keptIds: last.includes(`id="${entry}"`),
    });
    expect(editsAfterOpen).toBe(0);
    expect(last).toContain('https://www.omg.org/spec/DMN/20191111/MODEL/');
  });
});

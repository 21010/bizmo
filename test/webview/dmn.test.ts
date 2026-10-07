// DMN webview (ADR 0014) under the production CSP, driven with trusted input: every view, change
// sync, undo routing, view and viewport persistence, DMN 1.1/1.2 migration, and image export.
import type { Browser } from 'playwright';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { checkExportedImage } from '../../src/extension/core/imageExport';
import type { WebviewToHostMessage } from '../../src/shared/protocol';
import {
  applyEditsLikeTheHost,
  dmnFixture,
  launchBrowser,
  openWebview,
  type WebviewPage,
} from './harness';

type Edit = Extract<WebviewToHostMessage, { type: 'edit' }>;
type Exported = Extract<WebviewToHostMessage, { type: 'exported' }>;

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

async function open(name: string, platform: 'c7' | 'c8', state?: unknown): Promise<WebviewPage> {
  webview = await openWebview(browser, 'dmn', state);
  await applyEditsLikeTheHost(webview);
  await webview.send({ type: 'init', content: dmnFixture(name), version: 1, platform });
  expect(await webview.waitForImport(1)).toMatchObject({ ok: true });
  return webview;
}

const edits = async (w: WebviewPage) =>
  (await w.posted()).filter((m): m is Edit => m.type === 'edit');
const lastEdit = async (w: WebviewPage) => (await edits(w)).at(-1)?.content ?? '';

/** The view on screen: the DRD, a decision table, or a literal expression. */
const activeView = (w: WebviewPage) =>
  w.page.evaluate(
    () =>
      [...document.querySelectorAll<HTMLElement>('[class*="dmn-"][class*="-container"]')]
        .filter((e) => e.offsetParent !== null)
        .map((e) => e.classList[0])[0] ?? null,
  );

/** Opens a decision's view from the DRD (the drill-down buttons carry no element id). */
async function drillDown(w: WebviewPage, kind: 'decision table' | 'literal expression') {
  await w.page.click(`.drill-down-overlay button[title="Open ${kind}"]`);
  await expect.poll(() => activeView(w)).not.toBe('dmn-drd-container');
}

const cell = (id: string) => `td[data-element-id="${id}"]`;
const cellText = (w: WebviewPage, id: string) =>
  w.page
    .locator(`${cell(id)} .content-editable`)
    .first()
    .textContent();
const panelVisible = (w: WebviewPage) => w.page.locator('#bizmo-panel').isVisible();

async function exportAs(w: WebviewPage, format: 'svg' | 'png', requestId: number) {
  await w.send({ type: 'export', requestId, format });
  let answer: Exported | undefined;
  await expect
    .poll(
      async () => {
        answer = (await w.posted()).find(
          (m): m is Exported => m.type === 'exported' && m.requestId === requestId,
        );
        return answer !== undefined;
      },
      { timeout: 10000 },
    )
    .toBe(true);
  if (!answer) throw new Error('no answer');
  return answer;
}

describe('opening', () => {
  it.each([
    ['c8-dish.dmn', 'c8'],
    ['c7-dish.dmn', 'c7'],
  ] as const)('%s opens in the DRD with the properties panel', async (name, platform) => {
    const w = await open(name, platform);
    expect(await w.waitForImport(1)).toMatchObject({ ok: true, elementCount: 2 });
    expect(await activeView(w)).toBe('dmn-drd-container');
    expect(await w.page.locator('.djs-shape').count()).toBe(2);
    expect(await panelVisible(w)).toBe(true);
    expect(await w.page.locator('#bizmo-notice').count()).toBe(0);
    // Opening never changes the document.
    await w.page.waitForTimeout(500);
    expect(await edits(w)).toEqual([]);
  });

  it('shows invalid XML as an error with "Open as Text"', async () => {
    webview = await openWebview(browser, 'dmn');
    const w = webview;
    await w.send({ type: 'init', content: '<definitions', version: 1, platform: 'c8' });
    expect(await w.waitForImport(1)).toMatchObject({ ok: false });
    await w.page.getByRole('button', { name: 'Open as Text' }).click();
    expect((await w.posted()).some((m) => m.type === 'openAsText')).toBe(true);
    // The editor recovers: a valid document renders afterwards.
    await w.send({
      type: 'update',
      content: dmnFixture('c8-dish.dmn'),
      version: 2,
      platform: 'c8',
    });
    expect(await w.waitForImport(2)).toMatchObject({ ok: true });
  });
});

describe('decision table', () => {
  it('hides the properties panel (DRD only) and brings it back in the DRD', async () => {
    const w = await open('c8-dish.dmn', 'c8');
    await drillDown(w, 'decision table');
    expect(await activeView(w)).toBe('dmn-decision-table-container');
    expect(await panelVisible(w)).toBe(false);
    await w.page.click('.view-drd-button');
    await expect.poll(() => activeView(w)).toBe('dmn-drd-container');
    expect(await panelVisible(w)).toBe(true);
  });

  it('typing commits each keystroke; the edit debounce combines fast typing', async () => {
    const w = await open('c8-dish.dmn', 'c8');
    await drillDown(w, 'decision table');
    await w.page.click(cell('OutputEntry_Winter'));
    await w.page.keyboard.press('End');
    // Slower than the 300 ms debounce: each keystroke becomes its own edit (one undo step).
    for (const key of ['X', 'Y']) {
      await w.page.keyboard.type(key);
      await w.page.waitForTimeout(450);
    }
    expect(await edits(w)).toHaveLength(2);
    // Fast typing: one edit.
    await w.page.keyboard.type('abc', { delay: 30 });
    await expect.poll(async () => (await edits(w)).length).toBe(3);
    await w.page.waitForTimeout(400);
    expect(await edits(w)).toHaveLength(3);
    expect(await lastEdit(w)).toContain('"Spareribs"XYabc');
  });

  it('routes undo/redo keys in a cell to VS Code; the cell does not undo locally', async () => {
    const w = await open('c8-dish.dmn', 'c8');
    await drillDown(w, 'decision table');
    await w.page.click(cell('OutputEntry_Winter'));
    await w.page.keyboard.press('End');
    await w.page.keyboard.type('Q');
    await expect.poll(async () => (await edits(w)).length).toBe(1);
    await w.page.keyboard.press('Control+z');
    await w.page.keyboard.press('Control+y');
    await w.page.keyboard.press('Control+Shift+z');
    await expect
      .poll(async () =>
        (await w.posted()).filter((m) => m.type === 'undo' || m.type === 'redo').map((m) => m.type),
      )
      .toEqual(['undo', 'redo', 'redo']);
    expect(await cellText(w, 'OutputEntry_Winter')).toBe('"Spareribs"Q');
  });

  it('keeps table keyboard navigation (Tab, Enter) working', async () => {
    const w = await open('c8-dish.dmn', 'c8');
    await drillDown(w, 'decision table');
    await w.page.click(cell('InputEntry_Winter_Season'));
    const focused = () =>
      w.page.evaluate(
        () =>
          document.activeElement?.closest('[data-element-id]')?.getAttribute('data-element-id') ??
          null,
      );
    await w.page.keyboard.press('Tab');
    expect(await focused()).toBe('InputEntry_Winter_Guests');
    await w.page.keyboard.press('Enter');
    expect(await focused()).toBe('InputEntry_Summer_Guests');
    await w.page.keyboard.press('Shift+Tab');
    expect(await focused()).toBe('InputEntry_Summer_Season');
  });

  it('stays in the table on re-import and shows the new content', async () => {
    const w = await open('c8-dish.dmn', 'c8');
    await drillDown(w, 'decision table');
    const changed = dmnFixture('c8-dish.dmn').replace('"Salad"', '"Soup"');
    await w.send({ type: 'update', content: changed, version: 7, platform: 'c8' });
    expect(await w.waitForImport(7)).toMatchObject({ ok: true });
    expect(await activeView(w)).toBe('dmn-decision-table-container');
    expect(await cellText(w, 'OutputEntry_Summer')).toBe('"Soup"');
  });

  it('keeps editing the same cell after a re-import (undo/redo from a cell)', async () => {
    const w = await open('c8-dish.dmn', 'c8');
    await drillDown(w, 'decision table');
    await w.page.click(cell('OutputEntry_Summer'));
    const changed = dmnFixture('c8-dish.dmn').replace('"Salad"', '"Soup"');
    await w.send({ type: 'update', content: changed, version: 7, platform: 'c8' });
    expect(await w.waitForImport(7)).toMatchObject({ ok: true });
    await w.page.keyboard.type('!');
    expect(await cellText(w, 'OutputEntry_Summer')).toBe('"Soup"!');
  });

  it('reopens the saved view when the webview is recreated', async () => {
    const first = await open('c8-dish.dmn', 'c8');
    await drillDown(first, 'decision table');
    const state = await first.state();
    expect(state).toMatchObject({ view: { type: 'decisionTable', id: 'Decision_Dish' } });
    expect(await first.violations()).toEqual([]);
    await first.close();
    const second = await open('c8-dish.dmn', 'c8', state);
    expect(await activeView(second)).toBe('dmn-decision-table-container');
    expect(await panelVisible(second)).toBe(false);
  });
});

describe('other views', () => {
  it('literal expression: editing reaches the document', async () => {
    const w = await open('c8-dish.dmn', 'c8');
    await drillDown(w, 'literal expression');
    expect(await activeView(w)).toBe('dmn-literal-expression-container');
    // The first editable in this view is the decision name; the expression is CodeMirror.
    await w.page.locator('.literal-expression .cm-content').click();
    await w.page.keyboard.press('End');
    await w.page.keyboard.type(' + ""', { delay: 30 });
    await expect.poll(() => lastEdit(w)).toContain('"Summer" + ""');
  });

  it('DRD: the properties panel edits the selected decision', async () => {
    const w = await open('c8-dish.dmn', 'c8');
    await w.page.click('.djs-element[data-element-id="Decision_Dish"] .djs-hit', { force: true });
    // The DMN panel opens with its groups collapsed.
    await w.page.click('.bio-properties-panel-group-header:has-text("General")');
    const name = w.page.locator('.bio-properties-panel [name="name"]');
    await name.click();
    await w.page.keyboard.press('End');
    await w.page.keyboard.type(' plan', { delay: 30 });
    await expect.poll(() => lastEdit(w)).toContain('name="Dish plan"');
  });

  it('keeps the DRD viewport across a re-import and when recreated', async () => {
    const w = await open('c8-dish.dmn', 'c8');
    await w.page.mouse.move(600, 400);
    await w.page.mouse.wheel(0, 300);
    await expect
      .poll(async () => (await w.state()) as { drdViewbox?: { y: number } })
      .toMatchObject({ drdViewbox: { y: expect.any(Number) } });
    const { drdViewbox } = (await w.state()) as { drdViewbox: { x: number; y: number } };
    expect(drdViewbox.y).not.toBe(0);

    await w.send({
      type: 'update',
      content: dmnFixture('c8-dish.dmn'),
      version: 5,
      platform: 'c8',
    });
    expect(await w.waitForImport(5)).toMatchObject({ ok: true });
    await w.page.waitForTimeout(400);
    expect(await w.state()).toMatchObject({ drdViewbox });

    const state = await w.state();
    expect(await w.violations()).toEqual([]);
    await w.close();
    const second = await open('c8-dish.dmn', 'c8', state);
    await second.page.waitForTimeout(400);
    expect(await second.state()).toMatchObject({ drdViewbox });
  });
});

describe('DMN 1.1 and 1.2', () => {
  it.each([
    ['c7-dmn11.dmn', '1.1', 'outputEntry_winter'],
    ['c7-dmn12.dmn', '1.2', 'outputEntry_winter12'],
  ])('%s: shown with a notice; the first change saves DMN 1.3', async (name, version, entry) => {
    const w = await open(name, 'c7');
    await expect
      .poll(() => w.page.locator('#bizmo-notice').textContent())
      .toContain(`DMN ${version}`);
    await w.page.waitForTimeout(500);
    expect(await edits(w)).toEqual([]);

    if ((await activeView(w)) === 'dmn-drd-container') await drillDown(w, 'decision table');
    await w.page.click(cell(entry));
    await w.page.keyboard.press('End');
    await w.page.keyboard.type('!');
    await expect
      .poll(() => lastEdit(w))
      .toContain('xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/"');
    const saved = await lastEdit(w);
    expect(saved).not.toMatch(/20151101|20180521\/MODEL/);
    expect(saved).toContain(`id="${entry}"`);
  });

  it('the notice can be dismissed and leaves with a DMN 1.3 document', async () => {
    const w = await open('c7-dmn11.dmn', 'c7');
    await w.page.getByRole('button', { name: 'Dismiss' }).click();
    expect(await w.page.locator('#bizmo-notice').count()).toBe(0);
    await w.send({
      type: 'update',
      content: dmnFixture('c7-dmn11.dmn'),
      version: 2,
      platform: 'c7',
    });
    expect(await w.waitForImport(2)).toMatchObject({ ok: true });
    expect(await w.page.locator('#bizmo-notice').count()).toBe(1);
    await w.send({
      type: 'update',
      content: dmnFixture('c7-dish.dmn'),
      version: 3,
      platform: 'c7',
    });
    expect(await w.waitForImport(3)).toMatchObject({ ok: true });
    expect(await w.page.locator('#bizmo-notice').count()).toBe(0);
  });
});

describe('export', () => {
  it('exports the DRD as SVG and PNG that pass the host check', async () => {
    const w = await open('c8-dish.dmn', 'c8');
    for (const [id, format] of [
      [1, 'svg'],
      [2, 'png'],
    ] as const) {
      const answer = await exportAs(w, format, id);
      if (!answer.ok) throw new Error(answer.error);
      expect(checkExportedImage(format, answer.data).ok).toBe(true);
    }
  });

  it('explains that only the DRD can be exported', async () => {
    const w = await open('c8-dish.dmn', 'c8');
    await drillDown(w, 'decision table');
    expect(await exportAs(w, 'svg', 1)).toMatchObject({
      ok: false,
      error: 'Switch to the decision requirements diagram to export an image.',
    });
  });

  it('explains when the file has no DRD (DMN 1.1 without diagram interchange)', async () => {
    const w = await open('c7-dmn11.dmn', 'c7');
    expect(await activeView(w)).toBe('dmn-decision-table-container');
    expect(await exportAs(w, 'png', 1)).toMatchObject({
      ok: false,
      error: 'This file has no decision requirements diagram to export.',
    });
  });
});

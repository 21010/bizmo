// DMN prototype in real VS Code with trusted input (ADR 0014): one document change and one VS Code
// undo step per committed change, undo from inside a table cell, the view kept across re-imports,
// and DMN 1.1 files not changed by opening them.
import { appendFileSync, copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Frame, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dirtyTabs as dirtyTabsIn, keys, launchVsCode, type VsCode } from '../../test/e2e/vscode';

const record = (check: string, data: unknown) =>
  appendFileSync(process.env.OUT ?? 'spikes/dmn/out.jsonl', `${JSON.stringify({ check, data })}\n`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let vscode: VsCode;
let win: Page;
let workspace: string;
const dirtyTabs = () => dirtyTabsIn(win);

beforeAll(async () => {
  workspace = mkdtempSync(join(tmpdir(), 'bizmo-dmn-spike-'));
  copyFileSync('test/fixtures/dmn/c8-dish.dmn', join(workspace, 'dish.dmn'));
  copyFileSync('test/fixtures/dmn/c7-dmn11.dmn', join(workspace, 'old.dmn'));
  vscode = await launchVsCode({ workspace });
  win = vscode.win;
});

afterAll(async () => {
  await vscode.app.close();
});

/** Opens a file from the Explorer and returns the DMN webview frame. */
async function open(name: string, ready: string): Promise<Frame> {
  const item = win.getByRole('treeitem', { name });
  await item.waitFor();
  for (let attempt = 0; attempt < 20; attempt++) {
    await item.click();
    for (let i = 0; i < 20; i++) {
      for (const frame of win.frames()) {
        if (await frame.locator(ready).count().catch(() => 0)) return frame;
      }
      await sleep(250);
    }
    await win.keyboard.press(keys.close);
    await win.mouse.move(0, 0);
  }
  throw new Error(`${name} did not open in the DMN editor`);
}

const cellText = (frame: Frame, id: string) =>
  frame.locator(`td[data-element-id="${id}"] .content-editable`).first().textContent();

describe('decision table in VS Code', () => {
  let frame: Frame;

  it('opens in the DRD, not dirty', async () => {
    frame = await open('dish.dmn', '.dmn-drd-container .djs-container');
    expect(await dirtyTabs()).toBe(0);
  });

  it('typing with pauses makes one document change per commit', async () => {
    await frame.click('.drill-down-overlay button[title="Open decision table"]');
    await frame.locator('td[data-element-id="OutputEntry_Winter"]').click();
    await win.keyboard.press('End');
    await win.keyboard.type('X');
    await expect.poll(dirtyTabs, { timeout: 5000 }).toBe(1);
    await sleep(600);
    await win.keyboard.type('Y');
    await sleep(600);
    expect(await cellText(frame, 'OutputEntry_Winter')).toBe('"Spareribs"XY');
  });

  it('Ctrl+Z in the cell undoes one step through VS Code and stays in the table', async () => {
    await win.keyboard.press(keys.undo);
    await expect.poll(() => cellText(frame, 'OutputEntry_Winter'), { timeout: 5000 }).toBe(
      '"Spareribs"X',
    );
    expect(await frame.locator('.dmn-decision-table-container').isVisible()).toBe(true);
    expect(await dirtyTabs()).toBe(1);
    await win.keyboard.press(keys.undo);
    await expect.poll(() => cellText(frame, 'OutputEntry_Winter'), { timeout: 5000 }).toBe(
      '"Spareribs"',
    );
    await expect.poll(dirtyTabs, { timeout: 5000 }).toBe(0);
    record('vscodeUndo', { stepsPerCommit: 1, viewKept: true, cleanAfterUndo: true });
  });

  it('redo re-applies one step', async () => {
    await win.keyboard.press(keys.redo);
    await expect.poll(() => cellText(frame, 'OutputEntry_Winter'), { timeout: 5000 }).toBe(
      '"Spareribs"X',
    );
    await expect.poll(dirtyTabs, { timeout: 5000 }).toBe(1);
    await win.keyboard.press(keys.undo);
    await expect.poll(dirtyTabs, { timeout: 5000 }).toBe(0);
  });
});

describe('DMN 1.1 file in VS Code', () => {
  it('opening does not change it; the first change converts; one undo restores it', async () => {
    await win.keyboard.press(keys.close);
    const frame = await open('old.dmn', '.dmn-decision-table-container');
    await sleep(1000);
    const dirtyAfterOpen = await dirtyTabs();
    await frame.locator('td[data-element-id="outputEntry_winter"]').click();
    await win.keyboard.press('End');
    await win.keyboard.type('!');
    await expect.poll(dirtyTabs, { timeout: 5000 }).toBe(1);
    await sleep(600);
    await win.keyboard.press(keys.undo);
    await expect.poll(dirtyTabs, { timeout: 5000 }).toBe(0);
    const onDisk = readFileSync(join(workspace, 'old.dmn'), 'utf8');
    record('vscodeMigration', {
      dirtyAfterOpen,
      cleanAfterOneUndo: true,
      diskStillDmn11: onDisk.includes('20151101/dmn.xsd'),
    });
    expect(dirtyAfterOpen).toBe(0);
  });
});

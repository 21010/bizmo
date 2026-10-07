// End-to-end DMN editing (ADR 0014): real VS Code driven with trusted mouse and keyboard input.
// Covers typing in a decision table, undo/redo from inside a cell through VS Code's document
// history, and save. DMN 1.1 files: dmnMigration.test.ts.
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Frame, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  dirtyTabs as dirtyTabsIn,
  keys,
  launchVsCode,
  openFromExplorer,
  type VsCode,
} from './vscode';

let vscode: VsCode;
let win: Page;
let workspace: string;

const dirtyTabs = () => dirtyTabsIn(win);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const onDisk = (name: string) => readFileSync(join(workspace, name), 'utf8');
const cellText = (frame: Frame, id: string) =>
  frame.locator(`td[data-element-id="${id}"] .content-editable`).first().textContent();

beforeAll(async () => {
  workspace = mkdtempSync(join(tmpdir(), 'bizmo-e2e-dmn-'));
  copyFileSync('test/fixtures/dmn/c8-dish.dmn', join(workspace, 'dish.dmn'));
  vscode = await launchVsCode({ workspace });
  win = vscode.win;
});

afterAll(async () => {
  await vscode.app.close();
});

describe('DMN decision table in VS Code', () => {
  let frame: Frame;

  it('opens in the DRD, not dirty', async () => {
    frame = await openFromExplorer(win, 'dish.dmn', '.dmn-drd-container .djs-container');
    expect(await dirtyTabs()).toBe(0);
  });

  it('typing in a cell changes the document; each pause is one change', async () => {
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

  it('Ctrl+S right after typing saves that change too (pre-save flush)', async () => {
    await win.keyboard.type('Z');
    await win.keyboard.press(keys.save); // well within the 300 ms debounce
    await expect.poll(dirtyTabs, { timeout: 5000 }).toBe(0);
    expect(onDisk('dish.dmn')).toContain('"Spareribs"XYZ');
  });

  // Typing right after an undo/redo is not covered: those keys can be dropped (#18).
  it('Ctrl+Z in the cell undoes one change through VS Code and stays in the table', async () => {
    await win.keyboard.press(keys.undo);
    await expect
      .poll(() => cellText(frame, 'OutputEntry_Winter'), { timeout: 5000 })
      .toBe('"Spareribs"XY');
    expect(await frame.locator('.dmn-decision-table-container').isVisible()).toBe(true);
    await expect.poll(dirtyTabs, { timeout: 5000 }).toBe(1);
    await win.keyboard.press(keys.undo);
    await expect
      .poll(() => cellText(frame, 'OutputEntry_Winter'), { timeout: 5000 })
      .toBe('"Spareribs"X');
  });

  it('redo re-applies one change; back at the saved version the tab is clean', async () => {
    await win.keyboard.press(keys.redo);
    await expect
      .poll(() => cellText(frame, 'OutputEntry_Winter'), { timeout: 5000 })
      .toBe('"Spareribs"XY');
    await win.keyboard.press(keys.redo);
    await expect
      .poll(() => cellText(frame, 'OutputEntry_Winter'), { timeout: 5000 })
      .toBe('"Spareribs"XYZ');
    await expect.poll(dirtyTabs, { timeout: 5000 }).toBe(0);
  });
});

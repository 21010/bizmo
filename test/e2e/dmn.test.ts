// End-to-end DMN editing (ADR 0014): real VS Code driven with trusted mouse and keyboard input.
// Covers typing in a decision table, undo/redo from inside a cell through VS Code's document
// history, save, and DMN 1.1 files that must not change until the user changes them.
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
  copyFileSync('test/fixtures/dmn/c7-dmn11.dmn', join(workspace, 'old.dmn'));
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

  it('Ctrl+Z in the cell undoes one change through VS Code and stays in the table', async () => {
    await win.keyboard.press(keys.undo);
    await expect
      .poll(() => cellText(frame, 'OutputEntry_Winter'), { timeout: 5000 })
      .toBe('"Spareribs"X');
    expect(await frame.locator('.dmn-decision-table-container').isVisible()).toBe(true);
    expect(await dirtyTabs()).toBe(1);
    await win.keyboard.press(keys.undo);
    await expect
      .poll(() => cellText(frame, 'OutputEntry_Winter'), { timeout: 5000 })
      .toBe('"Spareribs"');
    await expect.poll(dirtyTabs, { timeout: 5000 }).toBe(0);
  });

  it('redo re-applies one change', async () => {
    await win.keyboard.press(keys.redo);
    await expect
      .poll(() => cellText(frame, 'OutputEntry_Winter'), { timeout: 5000 })
      .toBe('"Spareribs"X');
    await expect.poll(dirtyTabs, { timeout: 5000 }).toBe(1);
  });

  it('Ctrl+S right after typing saves that change too (pre-save flush)', async () => {
    // Keys typed within about a second of a VS Code undo/redo are dropped (#18).
    await sleep(1200);
    await win.keyboard.type('Z');
    await win.keyboard.press(keys.save); // well within the 300 ms debounce
    await expect.poll(dirtyTabs, { timeout: 5000 }).toBe(0);
    expect(onDisk('dish.dmn')).toContain('"Spareribs"XZ');
  });
});

describe('DMN 1.1 file in VS Code', () => {
  it('opening does not change it; the first change converts; one undo restores it', async () => {
    await win.keyboard.press(keys.close);
    const frame = await openFromExplorer(win, 'old.dmn', '.dmn-decision-table-container');
    await sleep(1000);
    expect(await dirtyTabs()).toBe(0);
    await frame.locator('td[data-element-id="outputEntry_winter"]').click();
    await win.keyboard.press('End');
    await win.keyboard.type('!');
    await expect.poll(dirtyTabs, { timeout: 5000 }).toBe(1);
    await sleep(600);
    await win.keyboard.press(keys.undo);
    await expect.poll(dirtyTabs, { timeout: 5000 }).toBe(0);
    expect(onDisk('old.dmn')).toContain('http://www.omg.org/spec/DMN/20151101/dmn.xsd');
  });
});

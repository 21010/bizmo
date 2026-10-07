// End-to-end: a DMN 1.1 file (ADR 0014, decision 4) in its own VS Code instance. Opening must not
// change the file; the first change converts it to DMN 1.3; one undo restores the original.
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright';
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

beforeAll(async () => {
  workspace = mkdtempSync(join(tmpdir(), 'bizmo-e2e-dmn11-'));
  copyFileSync('test/fixtures/dmn/c7-dmn11.dmn', join(workspace, 'old.dmn'));
  vscode = await launchVsCode({ workspace });
  win = vscode.win;
});

afterAll(async () => {
  await vscode.app.close();
});

describe('DMN 1.1 file in VS Code', () => {
  it('opening does not change it; the first change converts; one undo restores it', async () => {
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
    expect(readFileSync(join(workspace, 'old.dmn'), 'utf8')).toContain(
      'http://www.omg.org/spec/DMN/20151101/dmn.xsd',
    );
  });
});

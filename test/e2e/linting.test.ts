// End-to-end: a lint problem in VS Code's Problems view links to its element in the diagram.
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launchVsCode, mod, openFromExplorer, type VsCode } from './vscode';

let vscode: VsCode;

beforeAll(async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'bizmo-e2e-lint-'));
  copyFileSync('test/fixtures/bpmn/c8-lint.bpmn', join(workspace, 'payment.bpmn'));
  vscode = await launchVsCode({ workspace });
});

afterAll(async () => {
  await vscode.app.close();
});

describe('BPMN linting in VS Code', () => {
  it('lists the problem in the Problems view; its link selects the element', async () => {
    const { win } = vscode;
    const frame = await openFromExplorer(win, 'payment.bpmn');
    await win.keyboard.press(`${mod}+Shift+M`);
    const problem = win.locator('.markers-panel .monaco-list-row', {
      hasText: 'A <Service Task> must have a <Task definition type> (Task_NoType)',
    });
    await expect.poll(() => problem.count(), { timeout: 15000 }).toBe(1);
    expect(
      await frame.locator('.djs-element.selected[data-element-id="Task_NoType"]').count(),
    ).toBe(0);

    // The rule name is a link to Bizmo's command, which selects the element.
    await problem.locator('a.monaco-link[href^="command:bizmo.bpmn.showProblem"]').click();
    await expect
      .poll(() => frame.locator('.djs-element.selected[data-element-id="Task_NoType"]').count(), {
        timeout: 5000,
      })
      .toBe(1);
  });
});

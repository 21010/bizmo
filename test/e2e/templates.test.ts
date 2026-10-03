// End-to-end: workspace element templates in a trusted workspace and in Restricted Mode
// (ADR 0010, D4). Restricted Mode can only be exercised in a real VS Code window.
import { copyFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Frame } from 'playwright';
import { afterEach, describe, expect, it } from 'vitest';
import { bizmoLog, clickElement, launchVsCode, openFromExplorer, type VsCode } from './vscode';

let vscode: VsCode | undefined;

afterEach(async () => {
  await vscode?.app.close();
  vscode = undefined;
});

/** A workspace with a templated diagram and its template in `.camunda/element-templates`. */
function templatedWorkspace(): string {
  const workspace = mkdtempSync(join(tmpdir(), 'bizmo-e2e-tpl-'));
  copyFileSync('test/fixtures/bpmn/c8-templated.bpmn', join(workspace, 'notify.bpmn'));
  const templates = join(workspace, '.camunda', 'element-templates');
  mkdirSync(templates, { recursive: true });
  copyFileSync('test/fixtures/templates/notify.c8.json', join(templates, 'notify.json'));
  return workspace;
}

const panelText = (frame: Frame) => frame.locator('#bizmo-panel').textContent();

describe('element templates in VS Code', () => {
  it('applies workspace templates in a trusted workspace', async () => {
    vscode = await launchVsCode({ workspace: templatedWorkspace() });
    const frame = await openFromExplorer(vscode.win, 'notify.bpmn');
    await clickElement(vscode.win, frame, 'Task_Notify');
    await expect.poll(() => panelText(frame), { timeout: 10000 }).toContain('Send notification');
  });

  it('does not load them in Restricted Mode, and says so', async (context) => {
    vscode = await launchVsCode({
      workspace: templatedWorkspace(),
      workspaceTrust: true,
      // Open an untrusted folder in Restricted Mode without the start-up trust dialog.
      settings: { 'security.workspace.trust.startupPrompt': 'never' },
    });
    const launched = vscode;
    const { win } = launched;
    const frame = await openFromExplorer(win, 'notify.bpmn');
    const restricted = 'Restricted Mode: element templates in this workspace are not loaded';
    const loaded = 'Element templates: 1 Camunda 8';
    await expect
      .poll(() => [restricted, loaded].some((line) => bizmoLog(launched).includes(line)), {
        timeout: 15000,
      })
      .toBe(true);
    if (bizmoLog(launched).includes(loaded)) {
      // VS Code's trusted-folder list is per machine (it is not in the test profile). A developer
      // machine may trust the temp folder; CI runners do not.
      console.warn('Skipped: this machine already trusts the temporary workspace folder.');
      context.skip();
    }

    const notice = win.locator('.notification-toast', {
      hasText: 'Element templates in this workspace are not loaded in Restricted Mode.',
    });
    await expect.poll(() => notice.count(), { timeout: 15000 }).toBe(1);
    expect(await notice.getByRole('button', { name: 'Manage Workspace Trust' }).count()).toBe(1);

    await clickElement(win, frame, 'Task_Notify');
    await expect.poll(() => panelText(frame)).toContain('Notify customer');
    expect(await panelText(frame)).not.toContain('Send notification');
  });
});

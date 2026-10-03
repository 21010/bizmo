// BPMN linting (M6): Camunda Modeler's linter in the webview, problems on the canvas and sent to
// the host; the user setting turns it off; the host can reveal a problem's element.
import type { Browser } from 'playwright';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { LintProblem, WebviewToHostMessage } from '../../src/shared/protocol';
import { fixture, launchBrowser, openWebview, type WebviewPage } from './harness';

type Lint = Extract<WebviewToHostMessage, { type: 'lint' }>;

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

async function open(name: string, platform: 'c7' | 'c8'): Promise<WebviewPage> {
  webview = await openWebview(browser, 'bpmn');
  await webview.send({ type: 'init', content: fixture(name), version: 1, platform });
  expect(await webview.waitForImport(1)).toMatchObject({ ok: true });
  return webview;
}

const lintMessages = async (w: WebviewPage): Promise<Lint[]> =>
  (await w.posted()).filter((m): m is Lint => m.type === 'lint');

/** The problems of the latest `lint` message, once there is one. */
async function latestProblems(w: WebviewPage): Promise<LintProblem[] | undefined> {
  return (await lintMessages(w)).at(-1)?.problems;
}

const markers = (w: WebviewPage) => w.page.locator('.cl-icon').count();

describe('BPMN linting', () => {
  it('reports Camunda 8 problems to the host and marks the element on the canvas', async () => {
    const w = await open('c8-lint.bpmn', 'c8');
    await expect
      .poll(() => latestProblems(w), { timeout: 5000 })
      .toEqual([
        {
          elementId: 'Task_NoType',
          message: 'A <Service Task> must have a <Task definition type>',
          severity: 'error',
          rule: 'camunda-compat/implementation',
        },
      ]);
    await expect.poll(() => markers(w)).toBeGreaterThan(0);
  });

  it('uses the Camunda 7 rules for Camunda 7 diagrams', async () => {
    const w = await open('c7-lint.bpmn', 'c7');
    await expect
      .poll(() => latestProblems(w), { timeout: 5000 })
      .toEqual([
        expect.objectContaining({
          elementId: 'Process_Lint',
          severity: 'info',
          rule: 'camunda-compat/history-time-to-live',
        }),
      ]);
  });

  it('re-lints after a change: fixing the problem clears it', async () => {
    const w = await open('c8-lint.bpmn', 'c8');
    await expect.poll(async () => (await latestProblems(w))?.length, { timeout: 5000 }).toBe(1);
    await w.page.locator('[data-element-id="Task_NoType"]').first().click({ force: true });
    const type = w.page.locator('#bio-properties-panel-taskDefinitionType');
    if (!(await type.isVisible())) {
      await w.page
        .locator('[data-group-id="group-taskDefinition"] .bio-properties-panel-group-header')
        .click();
    }
    await type.fill('charge-card');
    await expect.poll(() => latestProblems(w), { timeout: 5000 }).toEqual([]);
    await expect.poll(() => markers(w)).toBe(0);
  });

  it('reports nothing for diagrams without a platform version (as Camunda Modeler)', async () => {
    const w = await open('no-platform.bpmn', 'c8');
    await expect.poll(() => latestProblems(w), { timeout: 5000 }).toEqual([]);
  });

  it('can be turned off and on again (user setting)', async () => {
    const w = await open('c8-lint.bpmn', 'c8');
    await expect.poll(async () => (await latestProblems(w))?.length, { timeout: 5000 }).toBe(1);

    await w.send({ type: 'settings', linting: false });
    await expect.poll(() => latestProblems(w)).toEqual([]);
    await expect.poll(() => markers(w)).toBe(0);
    // Changes no longer lint.
    const count = (await lintMessages(w)).length;
    await w.page.locator('[data-element-id="Task_NoType"]').first().click({ force: true });
    await w.page.keyboard.press('Delete');
    await w.page.waitForTimeout(800);
    expect((await lintMessages(w)).length).toBe(count);

    await w.send({ type: 'settings', linting: true });
    await expect.poll(async () => (await latestProblems(w))?.length, { timeout: 5000 }).toBe(0);
  });

  it("reveals a problem's element: selects it and shows it in the panel", async () => {
    const w = await open('c8-lint.bpmn', 'c8');
    await expect.poll(async () => (await latestProblems(w))?.length, { timeout: 5000 }).toBe(1);
    await w.send({ type: 'reveal', elementId: 'Task_NoType' });
    await expect
      .poll(() => w.page.locator('.djs-element.selected[data-element-id="Task_NoType"]').count())
      .toBe(1);
    await expect
      .poll(() => w.page.locator('.bio-properties-panel-header-label').textContent())
      .toBe('Charge card');
    // Unknown ids are ignored.
    await w.send({ type: 'reveal', elementId: 'Nope' });
    await w.page.waitForTimeout(200);
  });
});

// Element templates (M5): applied from the host, validated in the webview, never fetching remotely.
import { readFileSync } from 'node:fs';
import type { Browser } from 'playwright';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { WebviewToHostMessage } from '../../src/shared/protocol';
import { fixture, launchBrowser, openWebview, type WebviewPage } from './harness';

const template = (name: string): object =>
  JSON.parse(readFileSync(`test/fixtures/templates/${name}`, 'utf8')) as object;

let browser: Browser;
let webview: WebviewPage | undefined;
/** Violations a test expects (blocked on purpose); everything else fails the test. */
let expectedViolations: RegExp | undefined;

beforeAll(async () => {
  browser = await launchBrowser();
});

afterAll(async () => {
  await browser.close();
});

afterEach(async () => {
  if (webview) {
    const violations = await webview.violations();
    expect(violations.filter((v) => !expectedViolations?.test(v))).toEqual([]);
    expect(webview.errors.filter((e) => !expectedViolations?.test(e))).toEqual([]);
    await webview.close();
    webview = undefined;
  }
  expectedViolations = undefined;
});

async function open(
  diagram: string,
  platform: 'c7' | 'c8',
  templates: { c7?: object[]; c8?: object[] },
  order: 'templatesFirst' | 'templatesLast' = 'templatesFirst',
): Promise<WebviewPage> {
  webview = await openWebview(browser, 'bpmn');
  const sendTemplates = () =>
    webview?.send({ type: 'templates', c7: templates.c7 ?? [], c8: templates.c8 ?? [] });
  if (order === 'templatesFirst') await sendTemplates();
  await webview.send({ type: 'init', content: fixture(diagram), version: 1, platform });
  expect(await webview.waitForImport(1)).toMatchObject({ ok: true });
  if (order === 'templatesLast') await sendTemplates();
  return webview;
}

async function panelTextFor(w: WebviewPage, elementId: string): Promise<string> {
  await w.page.locator(`[data-element-id="${elementId}"]`).first().click({ force: true });
  await w.page.waitForTimeout(300);
  return (await w.page.locator('#bizmo-panel').textContent()) ?? '';
}

describe('element templates', () => {
  it('recognises a Camunda 8 template applied to an element', async () => {
    const w = await open('c8-templated.bpmn', 'c8', { c8: [template('notify.c8.json')] });
    await expect.poll(() => panelTextFor(w, 'Task_Notify')).toContain('Send notification');
  });

  it('applies templates that arrive after the diagram', async () => {
    const w = await open(
      'c8-templated.bpmn',
      'c8',
      { c8: [template('notify.c8.json')] },
      'templatesLast',
    );
    await expect.poll(() => panelTextFor(w, 'Task_Notify')).toContain('Send notification');
  });

  it('applies a template chosen in the panel, as a document edit', async () => {
    const w = await open('c8-order.bpmn', 'c8', { c8: [template('notify.c8.json')] });
    await w.page.locator('[data-element-id="Task_Check"]').first().click({ force: true });
    await w.page.locator('#bizmo-panel .bio-properties-panel-select-template-button').click();
    await w.page.getByText('Send notification', { exact: true }).first().click();

    const editOf = async () => (await w.posted()).filter((m) => m.type === 'edit').at(-1);
    await expect
      .poll(async () => (await editOf())?.content ?? '', { timeout: 5000 })
      .toContain('zeebe:modelerTemplate="io.bizmo.test.notify"');
    expect((await editOf())?.content).toContain('<zeebe:taskDefinition type="notify"');
  });

  it('does not know the template when none are loaded (e.g. Restricted Mode)', async () => {
    const w = await open('c8-templated.bpmn', 'c8', {});
    expect(await panelTextFor(w, 'Task_Notify')).not.toContain('Send notification');
  });

  it('uses only the templates of the diagram platform', async () => {
    const w = await open('c7-templated.bpmn', 'c7', {
      c7: [template('book.c7.json')],
      c8: [template('notify.c8.json')],
    });
    await expect.poll(() => panelTextFor(w, 'Task_Book')).toContain('Book invoice');
    const posted = await w.posted();
    expect(posted.some((m) => m.type === 'templateErrors')).toBe(false);
  });

  it('reports invalid templates and keeps the valid ones', async () => {
    const w = await open('c8-templated.bpmn', 'c8', {
      c8: [template('notify.c8.json'), template('invalid.c8.json')],
    });
    const reports = async () =>
      (await w.posted()).filter(
        (m): m is Extract<WebviewToHostMessage, { type: 'templateErrors' }> =>
          m.type === 'templateErrors',
      );
    await expect.poll(async () => (await reports()).length).toBe(1);
    const [report] = await reports();
    // The validator reports several schema findings for one broken template; all name it.
    expect(report?.messages.length).toBeGreaterThan(0);
    expect(report?.messages.every((m) => m.includes('Broken template'))).toBe(true);
    expect(report?.messages.some((m) => m.includes('must be array'))).toBe(true);
    // The valid template is still loaded.
    await expect.poll(() => panelTextFor(w, 'Task_Notify')).toContain('Send notification');
  });

  it('never loads a template icon from the network', async () => {
    expectedViolations = /attacker\.example/;
    const requests: string[] = [];
    webview = await openWebview(browser, 'bpmn');
    const w = webview;
    w.page.on('request', (request) => requests.push(request.url()));
    const remote = template('remote-icon.c8.json');
    const diagram = fixture('c8-templated.bpmn')
      .replace('io.bizmo.test.notify', 'io.bizmo.test.remoteicon')
      .replace('type="notify"', 'type="remote"');
    await w.send({ type: 'templates', c7: [], c8: [remote] });
    await w.send({ type: 'init', content: diagram, version: 1, platform: 'c8' });
    expect(await w.waitForImport(1)).toMatchObject({ ok: true });
    await w.page.waitForTimeout(500);
    expect(requests.filter((url) => url.includes('attacker.example'))).toEqual([]);
  });
});

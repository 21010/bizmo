// Image export (M7): SVG and PNG produced in the webview under the production CSP, accepted by the
// host's check.
import type { Browser } from 'playwright';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { checkExportedImage } from '../../src/extension/core/imageExport';
import type { ImageFormat, WebviewToHostMessage } from '../../src/shared/protocol';
import { fixture, launchBrowser, openWebview, type WebviewPage } from './harness';

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

async function open(name: string): Promise<WebviewPage> {
  webview = await openWebview(browser, 'bpmn');
  await webview.send({ type: 'init', content: fixture(name), version: 1, platform: 'c8' });
  expect(await webview.waitForImport(1)).toMatchObject({ ok: true });
  return webview;
}

async function exportAs(w: WebviewPage, format: ImageFormat, requestId: number): Promise<Exported> {
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

/** Width and height from a PNG's IHDR chunk. */
const pngSize = (bytes: Uint8Array) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
};

describe('image export', () => {
  it('exports the diagram as SVG that the host accepts', async () => {
    const w = await open('c8-order.bpmn');
    const answer = await exportAs(w, 'svg', 1);
    expect(answer).toMatchObject({ ok: true, format: 'svg' });
    if (!answer.ok) return;
    expect(answer.data).toContain('Check stock');
    expect(checkExportedImage('svg', answer.data).ok).toBe(true);
  });

  it('exports the diagram as a PNG at twice its size that the host accepts', async () => {
    const w = await open('c8-order.bpmn');
    const svg = await exportAs(w, 'svg', 1);
    const png = await exportAs(w, 'png', 2);
    expect(png).toMatchObject({ ok: true, format: 'png' });
    if (!png.ok || !svg.ok) return;
    const checked = checkExportedImage('png', png.data);
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    const width = Number(/<svg[^>]*\swidth="([\d.]+)"/.exec(svg.data)?.[1]);
    const size = pngSize(checked.bytes);
    expect(size.width).toBe(Math.floor(width * 2));
    expect(size.height).toBeGreaterThan(0);
  });

  it('exports diagrams with hostile labels as inert SVG', async () => {
    const w = await open('hostile-labels.bpmn');
    const answer = await exportAs(w, 'svg', 1);
    expect(answer.ok && checkExportedImage('svg', answer.data).ok).toBe(true);
  });

  it('answers with an error when no diagram is shown', async () => {
    webview = await openWebview(browser, 'bpmn');
    const answer = await exportAs(webview, 'svg', 7);
    expect(answer).toEqual({
      type: 'exported',
      requestId: 7,
      ok: false,
      error: 'No diagram is shown',
    });
  });
});

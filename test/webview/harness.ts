// Runs a built webview bundle (dist/webview) in Chromium under the production CSP, with a stubbed
// VS Code webview API. Records posted messages, persisted state, CSP violations, and errors.
import { existsSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { renderWebviewHtml } from '../../src/extension/core/webviewHtml';
import type { HostToWebviewMessage, WebviewToHostMessage } from '../../src/shared/protocol';

const ORIGIN = 'http://bizmo-webview.test';
const DIST = 'dist/webview';
const MIME: Record<string, string> = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

declare global {
  interface Window {
    __posted: WebviewToHostMessage[];
    __state: unknown;
    __violations: string[];
    __pwned?: string;
  }
}

export interface WebviewPage {
  page: Page;
  errors: string[];
  send(message: HostToWebviewMessage | Record<string, unknown>): Promise<void>;
  posted(): Promise<WebviewToHostMessage[]>;
  waitForImport(version: number): Promise<Extract<WebviewToHostMessage, { type: 'importResult' }>>;
  violations(): Promise<string[]>;
  state(): Promise<unknown>;
  close(): Promise<void>;
}

export async function launchBrowser(): Promise<Browser> {
  if (!existsSync(join(DIST, 'bpmn.js'))) throw new Error('Run `npm run build` first.');
  return chromium.launch();
}

export async function openWebview(
  browser: Browser,
  notation: string,
  initialState?: unknown,
): Promise<WebviewPage> {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.addInitScript((state) => {
    window.__posted = [];
    window.__state = state;
    window.__violations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      window.__violations.push(`${event.effectiveDirective} ${event.blockedURI}`);
    });
    Object.assign(window, {
      acquireVsCodeApi: () => ({
        postMessage: (message: WebviewToHostMessage) => window.__posted.push(message),
        getState: () => window.__state,
        setState: (next: unknown) => {
          window.__state = next;
        },
      }),
    });
  }, initialState);

  const html = renderWebviewHtml({
    cspSource: ORIGIN,
    nonce: 'dGVzdC1ub25jZS0xMjM0NQ==',
    scriptUri: `${ORIGIN}/${notation}.js`,
    styleUri: `${ORIGIN}/${notation}.css`,
    title: 'test',
  });
  await page.route(`${ORIGIN}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname.slice(1);
    if (path === 'index.html') return route.fulfill({ contentType: 'text/html', body: html });
    const file = join(DIST, path);
    if (!existsSync(file)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({
      contentType: MIME[extname(file)] ?? 'application/octet-stream',
      body: readFileSync(file),
    });
  });
  await page.goto(`${ORIGIN}/index.html`);
  await page.waitForFunction(() => window.__posted.some((m) => m.type === 'ready'));

  return {
    page,
    errors,
    send: (message) =>
      page.evaluate((m) => {
        window.postMessage(m, '*');
      }, message),
    posted: () => page.evaluate(() => window.__posted),
    waitForImport: async (version) => {
      const handle = await page.waitForFunction(
        (v) => window.__posted.find((m) => m.type === 'importResult' && m.version === v),
        version,
        { timeout: 15000 },
      );
      return (await handle.jsonValue()) as Extract<WebviewToHostMessage, { type: 'importResult' }>;
    },
    violations: () => page.evaluate(() => window.__violations),
    state: () => page.evaluate(() => window.__state),
    close: () => page.close(),
  };
}

export const fixture = (name: string): string => readFileSync(`test/fixtures/bpmn/${name}`, 'utf8');

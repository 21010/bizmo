import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, renderWebviewHtml } from '../../../src/extension/core/webviewHtml';

const options = {
  cspSource: 'https://file+.vscode-resource.vscode-cdn.net',
  nonce: 'bm9uY2Utbm9uY2Utbm9uY2U=',
  scriptUri: 'https://file+.vscode-resource.vscode-cdn.net/ext/dist/webview/bpmn.js',
  styleUri: 'https://file+.vscode-resource.vscode-cdn.net/ext/dist/webview/bpmn.css',
  title: 'BPMN diagram',
};

describe('contentSecurityPolicy (ADR 0008)', () => {
  it('is exactly the approved policy', () => {
    expect(contentSecurityPolicy(options.cspSource, options.nonce)).toBe(
      "default-src 'none'; " +
        `script-src 'nonce-${options.nonce}'; ` +
        `style-src ${options.cspSource} 'unsafe-inline'; ` +
        `img-src ${options.cspSource} data:; ` +
        `font-src ${options.cspSource}`,
    );
  });

  it('never allows eval or inline scripts', () => {
    const scriptSrc = /script-src ([^;]*)/.exec(
      contentSecurityPolicy(options.cspSource, options.nonce),
    )?.[1];
    expect(scriptSrc).toBe(`'nonce-${options.nonce}'`);
  });
});

describe('renderWebviewHtml', () => {
  const html = renderWebviewHtml(options);

  it('puts the CSP in a meta tag before any resource', () => {
    const meta = html.indexOf('http-equiv="Content-Security-Policy"');
    expect(meta).toBeGreaterThan(-1);
    expect(meta).toBeLessThan(html.indexOf('<link'));
    expect(meta).toBeLessThan(html.indexOf('<script'));
  });

  it('gives every script the nonce and loads no inline script', () => {
    const scripts = html.match(/<script\b[^>]*>/g) ?? [];
    expect(scripts).toHaveLength(1);
    for (const script of scripts) {
      expect(script).toContain(`nonce="${options.nonce}"`);
      expect(script).toContain('src="');
    }
    expect(html).not.toMatch(/<script\b[^>]*>[^<]+<\/script>/);
  });

  it('references only the webview resource origin', () => {
    const urls = html.match(/(?:src|href)="([^"]*)"/g) ?? [];
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(url).toContain(options.cspSource);
  });

  it('escapes attribute values', () => {
    const hostile = renderWebviewHtml({
      ...options,
      title: '"><script>alert(1)</script>',
      styleUri: 'x" onload="alert(1)',
    });
    expect(hostile).not.toContain('<script>alert(1)</script>');
    expect(hostile).not.toContain('" onload="');
  });
});

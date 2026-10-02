// Builds webview HTML. Pure (no `vscode` import) so the exact CSP can be unit-tested and reused by
// the browser tests. The policy is ADR 0008; changing it is a security review trigger.

export interface WebviewHtmlOptions {
  /** `webview.cspSource`. */
  cspSource: string;
  /** Fresh per render, from `createNonce()`. */
  nonce: string;
  /** `webview.asWebviewUri(...)` strings for the notation bundle. */
  scriptUri: string;
  styleUri: string;
  title: string;
}

export function contentSecurityPolicy(cspSource: string, nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src ${cspSource} 'unsafe-inline'`,
    `img-src ${cspSource} data:`,
    `font-src ${cspSource}`,
  ].join('; ');
}

const escapeAttribute = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function renderWebviewHtml(options: WebviewHtmlOptions): string {
  const csp = escapeAttribute(contentSecurityPolicy(options.cspSource, options.nonce));
  const nonce = escapeAttribute(options.nonce);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeAttribute(options.title)}</title>
<link rel="stylesheet" href="${escapeAttribute(options.styleUri)}">
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}" src="${escapeAttribute(options.scriptUri)}"></script>
</body>
</html>`;
}

// M1 spike: text-backed custom editor (CustomTextEditorProvider) hosting camunda-bpmn-js.
// Throwaway prototype for S2 (undo/sync model) and S4 (keyboard). Not shipped.
const vscode = require('vscode');
const { randomBytes } = require('node:crypto');

/** Observable state for the integration test (via the bizmoSpike.state command). */
const state = { violations: [], imports: [], edits: 0, rejectedEdits: 0, echoesSuppressed: 0, errors: [], keys: [], panels: new Map() };

function activate(context) {
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider('bizmoSpike.bpmn', new Provider(context), {
      webviewOptions: { retainContextWhenHidden: false },
      supportsMultipleEditorsPerDocument: true,
    }),
    vscode.commands.registerCommand('bizmoSpike.state', () => ({
      violations: state.violations,
      imports: state.imports,
      edits: state.edits,
      rejectedEdits: state.rejectedEdits,
      echoesSuppressed: state.echoesSuppressed,
      errors: state.errors,
      keys: state.keys,
    })),
    vscode.commands.registerCommand('bizmoSpike.noop', () => undefined),
    vscode.commands.registerCommand('bizmoSpike.op', async (op) => {
      for (const panel of state.panels.values()) await panel.webview.postMessage({ type: 'op', op });
    }),
  );
}

class Provider {
  constructor(context) {
    this.context = context;
  }

  resolveCustomTextEditor(document, panel) {
    const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    panel.webview.options = { enableScripts: true, enableCommandUris: false, enableForms: false, localResourceRoots: [media] };
    const nonce = randomBytes(16).toString('base64');
    const uri = (f) => panel.webview.asWebviewUri(vscode.Uri.joinPath(media, f));
    const csp = [
      "default-src 'none'",
      `script-src 'nonce-${nonce}'`,
      `style-src ${panel.webview.cspSource} 'unsafe-inline'`,
      `img-src ${panel.webview.cspSource} data:`,
      `font-src ${panel.webview.cspSource}`,
    ].join('; ');
    panel.webview.html = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<link rel="stylesheet" href="${uri('webview.css')}">
<script nonce="${nonce}" src="${uri('violations.js')}"></script>
</head><body><div id="canvas"></div><div id="properties"></div>
<script nonce="${nonce}" src="${uri('webview.js')}"></script></body></html>`;

    const key = `${document.uri.toString()}#${Math.random()}`;
    state.panels.set(key, panel);
    const ownVersions = new Set();

    const post = (type) =>
      panel.webview.postMessage({ type, xml: document.getText(), version: document.version, swallowUndo: process.env.BIZMO_SPIKE_NO_SWALLOW !== '1' });

    const sub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() !== document.uri.toString() || e.contentChanges.length === 0) return;
      if (ownVersions.delete(e.document.version)) {
        state.echoesSuppressed += 1;
        return;
      }
      post('update');
    });

    panel.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case 'ready':
          post('init');
          break;
        case 'edit': {
          if (typeof msg.xml !== 'string' || msg.xml.length > 20_000_000) return;
          if (msg.baseVersion !== document.version) {
            state.rejectedEdits += 1;
            post('update');
            return;
          }
          // Keep the document's line endings (saveXML always writes LF).
          const text = document.eol === vscode.EndOfLine.CRLF ? msg.xml.replace(/\r?\n/g, '\r\n') : msg.xml;
          const edit = new vscode.WorkspaceEdit();
          edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), text);
          ownVersions.add(document.version + 1);
          const ok = await vscode.workspace.applyEdit(edit);
          if (ok) state.edits += 1;
          else ownVersions.delete(document.version + 1);
          break;
        }
        case 'undo':
        case 'redo':
          await vscode.commands.executeCommand(msg.type);
          break;
        case 'imported':
          state.imports.push({ uri: document.uri.path.split('/').pop(), reason: msg.reason, version: msg.version, ms: msg.ms, elements: msg.elements, viewRestored: msg.viewRestored, error: msg.error });
          break;
        case 'violation':
          state.violations.push(msg.violation);
          break;
        case 'key':
          state.keys.push(msg.key);
          break;
        case 'error':
          state.errors.push(String(msg.message).slice(0, 500));
          break;
      }
    });

    panel.onDidDispose(() => {
      sub.dispose();
      state.panels.delete(key);
    });
  }
}

// S4 keyboard spike: open a file in the custom editor at startup when driven by Playwright.
function autoOpen() {
  const target = process.env.BIZMO_SPIKE_OPEN;
  if (target) void vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(target), 'bizmoSpike.bpmn');
}

module.exports = { activate: (c) => { activate(c); autoOpen(); }, deactivate() {} };

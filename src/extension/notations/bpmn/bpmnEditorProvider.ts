import * as vscode from 'vscode';
import { detectExecutionPlatform } from '../../../shared/bpmn/platform';
import {
  isWebviewToHostMessage,
  type HostToWebviewMessage,
  type ImportResult,
  type LoadRejection,
} from '../../../shared/protocol';
import { checkXmlDocument } from '../../core/guards';
import { reopenWith, TEXT_EDITOR } from '../../core/reopen';
import { renderWebviewHtml } from '../../core/webviewHtml';
import { createNonce } from '../../security/nonce';

export const BPMN_VIEW_TYPE = 'bizmo.bpmn';

/** Last known state of an open editor; read by integration tests through the testing API. */
export interface BpmnEditorState {
  uri: string;
  lastImport?: ImportResult;
  rejected?: LoadRejection;
  cspViolations: number;
  droppedMessages: number;
}

/**
 * Read-only BPMN viewer (M2). The TextDocument is the source of truth (ADR 0007); the webview
 * renders it and reports import results. Editing arrives in M3.
 */
export class BpmnEditorProvider implements vscode.CustomTextEditorProvider {
  readonly states = new Map<string, BpmnEditorState>();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly log: vscode.LogOutputChannel,
  ) {}

  resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): void {
    const webviewRoot = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview');
    const asset = (file: string) =>
      panel.webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, file)).toString();

    panel.webview.options = {
      enableScripts: true,
      enableCommandUris: false,
      enableForms: false,
      localResourceRoots: [webviewRoot],
    };
    panel.webview.html = renderWebviewHtml({
      cspSource: panel.webview.cspSource,
      nonce: createNonce(),
      scriptUri: asset('bpmn.js'),
      styleUri: asset('bpmn.css'),
      title: 'BPMN diagram',
    });

    const key = document.uri.toString();
    const name = vscode.workspace.asRelativePath(document.uri);
    const state: BpmnEditorState = { uri: key, cspViolations: 0, droppedMessages: 0 };
    this.states.set(key, state);
    let ready = false;

    const send = (kind: 'init' | 'update') => {
      if (!ready) return;
      const message = this.documentMessage(document, kind);
      state.rejected = message.type === 'loadRejected' ? message.reason : undefined;
      if (message.type === 'loadRejected') this.log.warn(`${name}: not loaded (${message.reason})`);
      void panel.webview.postMessage(message);
    };

    const subscriptions = [
      panel.webview.onDidReceiveMessage((message: unknown) => {
        if (!isWebviewToHostMessage(message)) {
          state.droppedMessages += 1;
          this.log.warn(`${name}: dropped an invalid message from the webview`);
          return;
        }
        switch (message.type) {
          case 'ready':
            ready = true;
            send('init');
            break;
          case 'importResult':
            state.lastImport = message;
            if (message.ok) {
              this.log.info(
                `${name}: rendered ${message.elementCount} elements (v${message.version})`,
              );
              for (const warning of message.warnings) this.log.warn(`${name}: ${warning}`);
            } else {
              this.log.error(`${name}: import failed: ${message.error}`);
            }
            break;
          case 'log':
            this.log[message.level](`${name}: ${message.message}`);
            break;
          case 'cspViolation':
            state.cspViolations += 1;
            this.log.error(`${name}: CSP violation ${message.directive} ${message.blockedURI}`);
            break;
          case 'openAsText':
            void reopenWith(document.uri, TEXT_EDITOR);
            break;
        }
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.uri.toString() === key && event.contentChanges.length > 0)
          send('update');
      }),
    ];

    panel.onDidDispose(() => {
      for (const subscription of subscriptions) subscription.dispose();
      this.states.delete(key);
    });
  }

  private documentMessage(
    document: vscode.TextDocument,
    kind: 'init' | 'update',
  ): HostToWebviewMessage {
    const maxMegabytes = vscode.workspace
      .getConfiguration('bizmo')
      .get<number>('maxFileSizeMB', 10);
    const guard = checkXmlDocument(document.getText(), maxMegabytes * 1024 * 1024);
    if (!guard.ok) {
      return {
        type: 'loadRejected',
        version: document.version,
        reason: guard.reason,
        message: guard.message,
      };
    }
    return {
      type: kind,
      content: guard.content,
      version: document.version,
      platform: detectExecutionPlatform(guard.content),
    };
  }
}

import * as vscode from 'vscode';
import { detectExecutionPlatform } from '../../../shared/bpmn/platform';
import {
  isWebviewToHostMessage,
  type EditOutcome,
  type HostToWebviewMessage,
  type ImportResult,
  type LoadRejection,
} from '../../../shared/protocol';
import { DocumentSync, type SyncTarget } from '../../core/documentSync';
import { checkXmlDocument } from '../../core/guards';
import { reopenWith, TEXT_EDITOR } from '../../core/reopen';
import { renderWebviewHtml } from '../../core/webviewHtml';
import { createNonce } from '../../security/nonce';

export const BPMN_VIEW_TYPE = 'bizmo.bpmn';

/** How long a save waits for the webview to hand over pending changes. */
const FLUSH_TIMEOUT_MS = 2000;

/** Last known state of an open editor; read by integration tests through the testing API. */
export interface BpmnEditorState {
  uri: string;
  lastImport?: ImportResult;
  rejected?: LoadRejection;
  edits: Record<EditOutcome, number>;
  cspViolations: number;
  droppedMessages: number;
}

/**
 * BPMN modeler as a text-backed custom editor (ADR 0007). The TextDocument is the source of
 * truth: the webview proposes full-document edits, VS Code owns undo/redo, save, and backup.
 */
export class BpmnEditorProvider implements vscode.CustomTextEditorProvider {
  readonly states = new Set<BpmnEditorState>();

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

    const name = vscode.workspace.asRelativePath(document.uri);
    const state: BpmnEditorState = {
      uri: document.uri.toString(),
      edits: { applied: 0, unchanged: 0, stale: 0, failed: 0 },
      cspViolations: 0,
      droppedMessages: 0,
    };
    this.states.add(state);

    const sync = new DocumentSync(textDocumentTarget(document));
    const post = (message: HostToWebviewMessage) => void panel.webview.postMessage(message);
    let ready = false;
    /** Edits are applied one at a time, in arrival order. */
    let editQueue = Promise.resolve();
    let nextFlushId = 0;
    const pendingFlushes = new Map<number, () => void>();

    const sendDocument = (kind: 'init' | 'update') => {
      if (!ready) return;
      const message = this.documentMessage(document, kind);
      state.rejected = message.type === 'loadRejected' ? message.reason : undefined;
      if (message.type === 'loadRejected') this.log.warn(`${name}: not loaded (${message.reason})`);
      post(message);
    };

    const handleEdit = async (content: string, baseVersion: number, requestId?: number) => {
      const outcome = await sync.applyEdit(content, baseVersion);
      state.edits[outcome] += 1;
      post({ type: 'editResult', outcome, version: document.version });
      if (outcome === 'stale') {
        this.log.info(`${name}: diagram change superseded by a newer document change`);
        sendDocument('update');
      } else if (outcome === 'failed') {
        this.log.error(`${name}: VS Code rejected the diagram change`);
        void vscode.window.showWarningMessage(
          `Bizmo could not apply the last diagram change to ${name}. The diagram was reloaded from the file.`,
        );
        sendDocument('update');
      }
      if (requestId !== undefined) pendingFlushes.get(requestId)?.();
    };

    /** Asks the webview for pending changes and waits until they are in the document. */
    const flush = (): Promise<void> => {
      if (!ready) return Promise.resolve();
      const requestId = nextFlushId++;
      return new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          pendingFlushes.delete(requestId);
          resolve();
        };
        const timer = setTimeout(() => {
          this.log.warn(`${name}: the diagram did not confirm pending changes before saving`);
          done();
        }, FLUSH_TIMEOUT_MS);
        pendingFlushes.set(requestId, done);
        post({ type: 'flush', requestId });
      });
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
            sendDocument('init');
            break;
          case 'edit':
            editQueue = editQueue
              .then(() => handleEdit(message.content, message.baseVersion, message.requestId))
              .catch((error: unknown) => {
                this.log.error(`${name}: ${String(error)}`);
              });
            break;
          case 'flushed':
            pendingFlushes.get(message.requestId)?.();
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
        if (event.document !== document || event.contentChanges.length === 0) return;
        if (!sync.isOwnChange(document.version, document.getText())) sendDocument('update');
      }),
      vscode.workspace.onWillSaveTextDocument((event) => {
        if (event.document === document) event.waitUntil(flush());
      }),
    ];

    panel.onDidDispose(() => {
      for (const subscription of subscriptions) subscription.dispose();
      for (const done of pendingFlushes.values()) done();
      this.states.delete(state);
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

function textDocumentTarget(document: vscode.TextDocument): SyncTarget {
  return {
    version: () => document.version,
    text: () => document.getText(),
    eol: () => (document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n'),
    replaceAll: (text) => {
      const edit = new vscode.WorkspaceEdit();
      const end = document.lineAt(document.lineCount - 1).range.end;
      edit.replace(document.uri, new vscode.Range(new vscode.Position(0, 0), end), text);
      return Promise.resolve(vscode.workspace.applyEdit(edit));
    },
  };
}

// One open diagram editor, independent of the notation (ADR 0004, 0007, 0011, 0012): the webview,
// the document sync, saving pending changes, undo/redo routing, image export, and the message
// loop. Notations add their own behaviour through `SessionHooks`.
import * as vscode from 'vscode';
import { detectExecutionPlatform } from '../../shared/camunda/platform';
import {
  isWebviewToHostMessage,
  type EditOutcome,
  type HostToWebviewMessage,
  type ImageFormat,
  type ImportResult,
  type LoadRejection,
  type WebviewToHostMessage,
} from '../../shared/protocol';
import { DocumentSync, type SyncTarget } from './documentSync';
import { checkXmlDocument } from './guards';
import { checkExportedImage } from './imageExport';
import { reopenWith, TEXT_EDITOR } from './reopen';
import { renderWebviewHtml } from './webviewHtml';
import { createNonce } from '../security/nonce';

/** How long a save waits for the webview to hand over pending changes. */
const FLUSH_TIMEOUT_MS = 2000;
/** How long an export waits for the image (large PNGs take a few seconds). */
const EXPORT_TIMEOUT_MS = 30000;

const FORMAT_NAME: Record<ImageFormat, string> = { svg: 'SVG image', png: 'PNG image' };

/** Last known state of an open editor; read by integration tests through the testing API. */
export interface EditorState {
  uri: string;
  lastImport?: ImportResult;
  rejected?: LoadRejection;
  edits: Record<EditOutcome, number>;
  cspViolations: number;
  droppedMessages: number;
}

export function initialEditorState(uri: vscode.Uri): EditorState {
  return {
    uri: uri.toString(),
    edits: { applied: 0, unchanged: 0, stale: 0, failed: 0 },
    cspViolations: 0,
    droppedMessages: 0,
  };
}

/** Notation behaviour around the shared session. Every hook is optional. */
export interface SessionHooks {
  /** The webview is ready; called before the document is sent. */
  beforeDocument?(): void;
  /** The webview is ready and the document was sent. */
  afterDocument?(): void;
  /** The webview reported the result of showing a document version. */
  imported?(result: ImportResult): void;
  /** The document was not sent to the webview (too large, DOCTYPE). */
  rejected?(reason: LoadRejection): void;
  /** Messages the session does not handle itself (already validated). */
  message?(message: WebviewToHostMessage): void;
  /** The editor was closed. */
  disposed?(): void;
}

export interface EditorSessionOptions<S extends EditorState> {
  document: vscode.TextDocument;
  panel: vscode.WebviewPanel;
  extensionUri: vscode.Uri;
  log: vscode.LogOutputChannel;
  /** Webview bundle: `dist/webview/<bundle>.js` and `.css`. */
  bundle: string;
  title: string;
  state: S;
  /** Builds the message that carries the document (or the reason it is not sent). */
  load: (document: vscode.TextDocument, kind: 'init' | 'update') => HostToWebviewMessage;
  hooks: SessionHooks;
}

export class EditorSession<S extends EditorState = EditorState> {
  readonly document: vscode.TextDocument;
  readonly panel: vscode.WebviewPanel;
  readonly state: S;
  /** The document's workspace-relative path, for log lines and messages. */
  readonly name: string;
  private readonly log: vscode.LogOutputChannel;
  private readonly hooks: SessionHooks;
  private readonly load: EditorSessionOptions<S>['load'];
  private readonly sync: DocumentSync;
  private ready = false;
  /** Edits (and undo/redo after them) are handled one at a time, in arrival order. */
  private editQueue = Promise.resolve();
  private nextFlushId = 0;
  private readonly pendingFlushes = new Map<number, () => void>();
  private nextExportId = 0;
  private readonly pendingExports = new Map<
    number,
    { resolve: (data: string) => void; reject: (error: Error) => void }
  >();

  constructor(options: EditorSessionOptions<S>) {
    const { document, panel, log } = options;
    this.document = document;
    this.panel = panel;
    this.state = options.state;
    this.log = log;
    this.hooks = options.hooks;
    this.load = options.load;
    this.name = vscode.workspace.asRelativePath(document.uri);
    this.sync = new DocumentSync(textDocumentTarget(document));

    const webviewRoot = vscode.Uri.joinPath(options.extensionUri, 'dist', 'webview');
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
      scriptUri: asset(`${options.bundle}.js`),
      styleUri: asset(`${options.bundle}.css`),
      title: options.title,
    });

    const subscriptions = [
      panel.webview.onDidReceiveMessage((message: unknown) => {
        this.receive(message);
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document !== document || event.contentChanges.length === 0) return;
        if (!this.sync.isOwnChange(document.version, document.getText())) {
          this.sendDocument('update');
        }
      }),
      vscode.workspace.onWillSaveTextDocument((event) => {
        if (event.document === document) event.waitUntil(this.flush());
      }),
    ];
    panel.onDidDispose(() => {
      for (const subscription of subscriptions) subscription.dispose();
      for (const done of this.pendingFlushes.values()) done();
      for (const pending of this.pendingExports.values()) {
        pending.reject(new Error('the diagram was closed'));
      }
      this.hooks.disposed?.();
    });
  }

  /** Whether the webview has started; messages before that are not sent. */
  get isReady(): boolean {
    return this.ready;
  }

  /** Sends a message once the webview is ready; earlier messages are dropped. */
  post(message: HostToWebviewMessage): void {
    if (this.ready) void this.panel.webview.postMessage(message);
  }

  /** Sends the current document (or the reason it cannot be shown). */
  sendDocument(kind: 'init' | 'update'): void {
    if (!this.ready) return;
    const message = this.load(this.document, kind);
    this.state.rejected = message.type === 'loadRejected' ? message.reason : undefined;
    if (message.type === 'loadRejected') {
      this.log.warn(`${this.name}: not loaded (${message.reason})`);
      this.hooks.rejected?.(message.reason);
    }
    this.post(message);
  }

  /**
   * Exports the diagram as an image. Asks where to save it unless `target` is given (tests, other
   * commands). Returns the written file.
   */
  async exportImage(format: ImageFormat, target?: vscode.Uri): Promise<vscode.Uri | undefined> {
    const destination =
      target ??
      (await vscode.window.showSaveDialog({
        defaultUri: defaultExportUri(this.document.uri, format),
        filters: { [FORMAT_NAME[format]]: [format] },
        saveLabel: 'Export',
        title: `Export Diagram as ${format.toUpperCase()}`,
      }));
    if (!destination) return undefined;
    try {
      const checked = checkExportedImage(format, await this.requestImage(format));
      if (!checked.ok) throw new Error(`invalid image data (${checked.reason})`);
      await vscode.workspace.fs.writeFile(destination, checked.bytes);
      this.log.info(`${this.name}: exported ${format.toUpperCase()} to ${destination.fsPath}`);
      return destination;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log.error(`${this.name}: export failed: ${message}`);
      void vscode.window.showErrorMessage(`Bizmo could not export the diagram: ${message}`);
      return undefined;
    }
  }

  /** SVG markup or PNG base64 from the webview (not yet checked). */
  private requestImage(format: ImageFormat): Promise<string> {
    if (!this.ready) return Promise.reject(new Error('the diagram is not ready'));
    const requestId = this.nextExportId++;
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingExports.delete(requestId);
        reject(new Error('the diagram did not provide the image in time'));
      }, EXPORT_TIMEOUT_MS);
      this.pendingExports.set(requestId, {
        resolve: (data) => {
          clearTimeout(timer);
          resolve(data);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.post({ type: 'export', requestId, format });
    });
  }

  /** Asks the webview for pending changes and waits until they are in the document. */
  private flush(): Promise<void> {
    if (!this.ready) return Promise.resolve();
    const requestId = this.nextFlushId++;
    return new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.pendingFlushes.delete(requestId);
        resolve();
      };
      const timer = setTimeout(() => {
        this.log.warn(`${this.name}: the diagram did not confirm pending changes before saving`);
        done();
      }, FLUSH_TIMEOUT_MS);
      this.pendingFlushes.set(requestId, done);
      this.post({ type: 'flush', requestId });
    });
  }

  private async handleEdit(content: string, baseVersion: number, requestId?: number) {
    const outcome = await this.sync.applyEdit(content, baseVersion);
    this.state.edits[outcome] += 1;
    this.post({ type: 'editResult', outcome, version: this.document.version });
    if (outcome === 'stale') {
      this.log.info(`${this.name}: diagram change superseded by a newer document change`);
      this.sendDocument('update');
    } else if (outcome === 'failed') {
      this.log.error(`${this.name}: VS Code rejected the diagram change`);
      void vscode.window.showWarningMessage(
        `Bizmo could not apply the last diagram change to ${this.name}. The diagram was reloaded from the file.`,
      );
      this.sendDocument('update');
    }
    if (requestId !== undefined) this.pendingFlushes.get(requestId)?.();
  }

  private receive(message: unknown): void {
    if (!isWebviewToHostMessage(message)) {
      this.state.droppedMessages += 1;
      this.log.warn(`${this.name}: dropped an invalid message from the webview`);
      return;
    }
    switch (message.type) {
      case 'ready':
        this.ready = true;
        this.hooks.beforeDocument?.();
        this.sendDocument('init');
        this.hooks.afterDocument?.();
        break;
      case 'exported': {
        const pending = this.pendingExports.get(message.requestId);
        this.pendingExports.delete(message.requestId);
        if (message.ok) pending?.resolve(message.data);
        else pending?.reject(new Error(message.error));
        break;
      }
      case 'edit':
        this.editQueue = this.editQueue
          .then(() => this.handleEdit(message.content, message.baseVersion, message.requestId))
          .catch((error: unknown) => {
            this.log.error(`${this.name}: ${String(error)}`);
            // Every edit is answered, or the webview would hold back all later changes.
            this.post({ type: 'editResult', outcome: 'failed', version: this.document.version });
            this.sendDocument('update');
            if (message.requestId !== undefined) this.pendingFlushes.get(message.requestId)?.();
          });
        break;
      case 'flushed':
        this.pendingFlushes.get(message.requestId)?.();
        break;
      case 'importResult':
        this.state.lastImport = message;
        if (message.ok) {
          this.log.info(
            `${this.name}: rendered ${message.elementCount} elements (v${message.version})`,
          );
          for (const warning of message.warnings) this.log.warn(`${this.name}: ${warning}`);
        } else {
          this.log.error(`${this.name}: import failed: ${message.error}`);
        }
        this.hooks.imported?.(message);
        break;
      case 'log':
        this.log[message.level](`${this.name}: ${message.message}`);
        break;
      case 'cspViolation':
        this.state.cspViolations += 1;
        this.log.error(`${this.name}: CSP violation ${message.directive} ${message.blockedURI}`);
        break;
      case 'openAsText':
        void reopenWith(this.document.uri, TEXT_EDITOR);
        break;
      case 'undo':
      case 'redo': {
        // Queued behind edits received earlier: the change made just before is undone.
        // VS Code's undo/redo act on the active editor, which is this one (it has focus).
        const command = message.type;
        this.editQueue = this.editQueue
          .then(async () => {
            await vscode.commands.executeCommand(command);
          })
          .catch((error: unknown) => {
            this.log.error(`${this.name}: ${command} failed: ${String(error)}`);
          });
        break;
      }
      default:
        this.hooks.message?.(message);
    }
  }
}

/**
 * The message for an XML notation (BPMN, DMN): the host's checks (size, DOCTYPE) first, then the
 * content with the execution platform the file declares.
 */
export function xmlDocumentMessage(
  document: vscode.TextDocument,
  kind: 'init' | 'update',
): HostToWebviewMessage {
  const maxMegabytes = vscode.workspace.getConfiguration('bizmo').get<number>('maxFileSizeMB', 10);
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

/** Next to the model file, same name, image extension; the workspace folder for untitled files. */
function defaultExportUri(documentUri: vscode.Uri, format: ImageFormat): vscode.Uri | undefined {
  if (documentUri.scheme === 'untitled') {
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
    return folder ? vscode.Uri.joinPath(folder, `diagram.${format}`) : undefined;
  }
  return documentUri.with({ path: `${documentUri.path.replace(/\.[^./]+$/, '')}.${format}` });
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

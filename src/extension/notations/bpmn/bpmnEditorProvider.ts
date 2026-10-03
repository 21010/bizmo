import * as vscode from 'vscode';
import { detectExecutionPlatform } from '../../../shared/bpmn/platform';
import {
  isWebviewToHostMessage,
  LIMITS,
  type EditOutcome,
  type HostToWebviewMessage,
  type ImportResult,
  type LintProblem,
  type LintSeverity,
  type LoadRejection,
} from '../../../shared/protocol';
import { DocumentSync, type SyncTarget } from '../../core/documentSync';
import { checkXmlDocument } from '../../core/guards';
import type { ElementTemplateService } from './elementTemplateService';
import { locateElementIds } from './lintLocations';
import { reopenWith, TEXT_EDITOR } from '../../core/reopen';
import { renderWebviewHtml } from '../../core/webviewHtml';
import { createNonce } from '../../security/nonce';

export const BPMN_VIEW_TYPE = 'bizmo.bpmn';
/** Selects a lint problem's element in the diagram; the link on each Bizmo diagnostic. */
export const SHOW_PROBLEM_COMMAND = 'bizmo.bpmn.showProblem';
const LINTING_SETTING = 'bizmo.bpmn.linting.enabled';

const SEVERITY: Record<LintSeverity, vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
};

/** An open diagram editor, as far as other editors and commands need it. */
interface EditorHandle {
  panel: vscode.WebviewPanel;
  reveal(elementId: string): void;
}

/** How long a save waits for the webview to hand over pending changes. */
const FLUSH_TIMEOUT_MS = 2000;

/** Last known state of an open editor; read by integration tests through the testing API. */
export interface BpmnEditorState {
  uri: string;
  lastImport?: ImportResult;
  rejected?: LoadRejection;
  edits: Record<EditOutcome, number>;
  /** Number of element templates last sent to the webview, per platform. */
  templatesSent?: { c7: number; c8: number };
  templateErrors: number;
  /** Lint problems last reported by this editor's webview. */
  lintProblems?: LintProblem[];
  /** Element last revealed from a lint problem's link. */
  lastReveal?: string;
  cspViolations: number;
  droppedMessages: number;
}

/**
 * BPMN modeler as a text-backed custom editor (ADR 0007). The TextDocument is the source of
 * truth: the webview proposes full-document edits, VS Code owns undo/redo, save, and backup.
 */
export class BpmnEditorProvider implements vscode.CustomTextEditorProvider, vscode.Disposable {
  readonly states = new Set<BpmnEditorState>();
  private readonly diagnostics = vscode.languages.createDiagnosticCollection('bizmo');
  /** Open diagram editors per document URI (several editors per document are possible). */
  private readonly editors = new Map<string, Set<EditorHandle>>();
  /** Elements to reveal once a diagram opened by `showProblem` has rendered. */
  private readonly pendingReveals = new Map<string, string>();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly log: vscode.LogOutputChannel,
    private readonly templates: ElementTemplateService,
  ) {}

  dispose(): void {
    this.diagnostics.dispose();
  }

  /**
   * Shows a lint problem's element in a diagram editor of the document, opening one if needed.
   * Reachable through command links, so it only acts on documents that have Bizmo diagnostics.
   */
  async showProblem(uriText: unknown, elementId: unknown): Promise<void> {
    if (typeof uriText !== 'string' || typeof elementId !== 'string') return;
    if (elementId.length === 0 || elementId.length > LIMITS.shortText) return;
    let uri: vscode.Uri;
    try {
      uri = vscode.Uri.parse(uriText, true);
    } catch {
      return;
    }
    if (!this.diagnostics.has(uri)) return;
    const editor = this.editors.get(uri.toString())?.values().next().value;
    if (editor) {
      editor.panel.reveal();
      editor.reveal(elementId);
      return;
    }
    this.pendingReveals.set(uri.toString(), elementId);
    await vscode.commands.executeCommand('vscode.openWith', uri, BPMN_VIEW_TYPE);
  }

  private lintingEnabled(): boolean {
    return vscode.workspace.getConfiguration().get<boolean>(LINTING_SETTING, true);
  }

  private publishDiagnostics(document: vscode.TextDocument, problems: LintProblem[]): void {
    if (problems.length === 0 || !this.lintingEnabled()) {
      this.diagnostics.delete(document.uri);
      return;
    }
    const spans = locateElementIds(
      document.getText(),
      problems.map((p) => p.elementId),
    );
    this.diagnostics.set(
      document.uri,
      problems.map((problem) => {
        const span = spans.get(problem.elementId) ?? { start: 0, end: 0 };
        const range = new vscode.Range(
          document.positionAt(span.start),
          document.positionAt(span.end),
        );
        const diagnostic = new vscode.Diagnostic(
          range,
          `${problem.message} (${problem.elementId})`,
          SEVERITY[problem.severity],
        );
        diagnostic.source = 'Bizmo';
        const args = encodeURIComponent(
          JSON.stringify([document.uri.toString(), problem.elementId]),
        );
        diagnostic.code = {
          value: problem.rule,
          target: vscode.Uri.parse(`command:${SHOW_PROBLEM_COMMAND}?${args}`),
        };
        return diagnostic;
      }),
    );
  }

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
      templateErrors: 0,
      cspViolations: 0,
      droppedMessages: 0,
    };
    this.states.add(state);

    const sync = new DocumentSync(textDocumentTarget(document));
    const post = (message: HostToWebviewMessage) => void panel.webview.postMessage(message);
    const key = document.uri.toString();
    const handle: EditorHandle = {
      panel,
      reveal: (elementId) => {
        state.lastReveal = elementId;
        post({ type: 'reveal', elementId });
      },
    };
    const handles = this.editors.get(key) ?? new Set<EditorHandle>();
    handles.add(handle);
    this.editors.set(key, handles);
    let ready = false;
    /** Edits are applied one at a time, in arrival order. */
    let editQueue = Promise.resolve();
    let nextFlushId = 0;
    const pendingFlushes = new Map<number, () => void>();

    const sendDocument = (kind: 'init' | 'update') => {
      if (!ready) return;
      const message = this.documentMessage(document, kind);
      state.rejected = message.type === 'loadRejected' ? message.reason : undefined;
      if (message.type === 'loadRejected') {
        this.log.warn(`${name}: not loaded (${message.reason})`);
        this.diagnostics.delete(document.uri);
      }
      post(message);
    };

    const sendSettings = () => {
      if (!ready) return;
      post({ type: 'settings', linting: this.lintingEnabled() });
    };

    /** Element templates for both platforms; the webview applies the ones for the diagram. */
    const sendTemplates = () => {
      if (!ready) return;
      const { c7, c8 } = this.templates.current();
      state.templatesSent = { c7: c7.length, c8: c8.length };
      post({ type: 'templates', c7, c8 });
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
            sendSettings();
            sendDocument('init');
            sendTemplates();
            break;
          case 'templateErrors':
            state.templateErrors += message.messages.length;
            for (const error of message.messages) this.log.warn(`Element template: ${error}`);
            break;
          case 'lint':
            state.lintProblems = message.problems;
            this.publishDiagnostics(document, message.problems);
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
              const pending = this.pendingReveals.get(key);
              if (pending !== undefined) {
                this.pendingReveals.delete(key);
                handle.reveal(pending);
              }
            } else {
              this.log.error(`${name}: import failed: ${message.error}`);
              this.diagnostics.delete(document.uri);
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
          case 'undo':
          case 'redo': {
            // Queued behind edits received earlier: the change made just before is undone.
            // VS Code's undo/redo act on the active editor, which is this one (it has focus).
            const command = message.type;
            editQueue = editQueue
              .then(async () => {
                await vscode.commands.executeCommand(command);
              })
              .catch((error: unknown) => {
                this.log.error(`${name}: ${command} failed: ${String(error)}`);
              });
            break;
          }
        }
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document !== document || event.contentChanges.length === 0) return;
        if (!sync.isOwnChange(document.version, document.getText())) sendDocument('update');
      }),
      vscode.workspace.onWillSaveTextDocument((event) => {
        if (event.document === document) event.waitUntil(flush());
      }),
      this.templates.onDidChange(sendTemplates),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (!event.affectsConfiguration(LINTING_SETTING)) return;
        if (!this.lintingEnabled()) this.diagnostics.delete(document.uri);
        sendSettings();
      }),
    ];
    void this.templates.noticeRestrictedMode();

    panel.onDidDispose(() => {
      for (const subscription of subscriptions) subscription.dispose();
      for (const done of pendingFlushes.values()) done();
      this.states.delete(state);
      handles.delete(handle);
      if (handles.size === 0) {
        // Problems are only kept up to date while a diagram editor is open.
        this.editors.delete(key);
        this.diagnostics.delete(document.uri);
      }
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

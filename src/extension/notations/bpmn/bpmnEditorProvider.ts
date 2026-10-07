import * as vscode from 'vscode';
import {
  LIMITS,
  type ImageFormat,
  type LintProblem,
  type LintSeverity,
} from '../../../shared/protocol';
import {
  EditorSession,
  initialEditorState,
  xmlDocumentMessage,
  type EditorState,
} from '../../core/editorSession';
import type { ElementTemplateService } from './elementTemplateService';
import { locateElementIds } from './lintLocations';

export const BPMN_VIEW_TYPE = 'bizmo.bpmn';
/** Selects a lint problem's element in the diagram; the link on each Bizmo diagnostic. */
export const SHOW_PROBLEM_COMMAND = 'bizmo.bpmn.showProblem';
const LINTING_SETTING = 'bizmo.bpmn.linting.enabled';

const SEVERITY: Record<LintSeverity, vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
};

/** Last known state of an open BPMN editor; read by integration tests through the testing API. */
export interface BpmnEditorState extends EditorState {
  /** Number of element templates last sent to the webview, per platform. */
  templatesSent?: { c7: number; c8: number };
  templateErrors: number;
  /** Lint problems last reported by this editor's webview. */
  lintProblems?: LintProblem[];
  /** Element last revealed from a lint problem's link. */
  lastReveal?: string;
}

type BpmnSession = EditorSession<BpmnEditorState>;

/**
 * BPMN modeler as a text-backed custom editor (ADR 0007) on the shared editor session, plus
 * element templates (ADR 0010) and linting with VS Code diagnostics (ADR 0013).
 */
export class BpmnEditorProvider implements vscode.CustomTextEditorProvider, vscode.Disposable {
  readonly states = new Set<BpmnEditorState>();
  private readonly diagnostics = vscode.languages.createDiagnosticCollection('bizmo');
  /** Open diagram editors per document URI (several editors per document are possible). */
  private readonly editors = new Map<string, Set<BpmnSession>>();
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
    const session = this.editors.get(uri.toString())?.values().next().value;
    if (session) {
      session.panel.reveal();
      reveal(session, elementId);
      return;
    }
    this.pendingReveals.set(uri.toString(), elementId);
    try {
      await vscode.commands.executeCommand('vscode.openWith', uri, BPMN_VIEW_TYPE);
    } catch (error) {
      this.pendingReveals.delete(uri.toString());
      this.log.warn(`Could not open ${uri.toString()} to show ${elementId}: ${String(error)}`);
    }
  }

  /**
   * Exports the diagram shown for `documentUri` as an image. Asks where to save it unless
   * `target` is given (tests, other commands). Returns the written file.
   */
  async exportImage(
    format: ImageFormat,
    documentUri: vscode.Uri,
    target?: vscode.Uri,
  ): Promise<vscode.Uri | undefined> {
    const session = this.editors.get(documentUri.toString())?.values().next().value;
    if (!session) {
      void vscode.window.showWarningMessage('Open the diagram in Bizmo to export it.');
      return undefined;
    }
    return session.exportImage(format, target);
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
    const key = document.uri.toString();
    const state: BpmnEditorState = { ...initialEditorState(document.uri), templateErrors: 0 };
    this.states.add(state);

    const sendSettings = () => {
      session.post({ type: 'settings', linting: this.lintingEnabled() });
    };
    /** Element templates for both platforms; the webview applies the ones for the diagram. */
    const sendTemplates = () => {
      if (!session.isReady) return;
      const { c7, c8 } = this.templates.current();
      state.templatesSent = { c7: c7.length, c8: c8.length };
      session.post({ type: 'templates', c7, c8 });
    };
    /** Problems and pending reveals belong to a rendered diagram. */
    const forgetDiagram = () => {
      this.diagnostics.delete(document.uri);
      this.pendingReveals.delete(key);
    };

    const subscriptions = [
      this.templates.onDidChange(sendTemplates),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (!event.affectsConfiguration(LINTING_SETTING)) return;
        if (!this.lintingEnabled()) this.diagnostics.delete(document.uri);
        sendSettings();
      }),
    ];

    const session: BpmnSession = new EditorSession({
      document,
      panel,
      extensionUri: this.extensionUri,
      log: this.log,
      bundle: 'bpmn',
      title: 'BPMN diagram',
      state,
      load: xmlDocumentMessage,
      hooks: {
        beforeDocument: sendSettings,
        afterDocument: sendTemplates,
        rejected: forgetDiagram,
        imported: (result) => {
          if (!result.ok) {
            forgetDiagram();
            return;
          }
          const pending = this.pendingReveals.get(key);
          if (pending !== undefined) {
            this.pendingReveals.delete(key);
            reveal(session, pending);
          }
        },
        message: (message) => {
          switch (message.type) {
            case 'templateErrors':
              state.templateErrors += message.messages.length;
              for (const error of message.messages) this.log.warn(`Element template: ${error}`);
              break;
            case 'lint':
              state.lintProblems = message.problems;
              this.publishDiagnostics(document, message.problems);
              break;
          }
        },
        disposed: () => {
          for (const subscription of subscriptions) subscription.dispose();
          this.states.delete(state);
          handles.delete(session);
          if (handles.size === 0) {
            // Problems are only kept up to date while a diagram editor is open.
            this.editors.delete(key);
            forgetDiagram();
          }
        },
      },
    });
    const handles = this.editors.get(key) ?? new Set<BpmnSession>();
    handles.add(session);
    this.editors.set(key, handles);
    void this.templates.noticeRestrictedMode();
  }
}

function reveal(session: BpmnSession, elementId: string): void {
  session.state.lastReveal = elementId;
  session.post({ type: 'reveal', elementId });
}

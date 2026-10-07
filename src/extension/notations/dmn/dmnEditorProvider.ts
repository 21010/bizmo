import type * as vscode from 'vscode';
import { EditorRegistry } from '../../core/editorRegistry';
import { EditorSession, initialEditorState, xmlDocumentMessage } from '../../core/editorSession';

export const DMN_VIEW_TYPE = 'bizmo.dmn';

/**
 * DMN modeler (ADR 0014) as a text-backed custom editor on the shared editor session. Unlike
 * BPMN, it has no element templates and no linting (#17).
 */
export class DmnEditorProvider implements vscode.CustomTextEditorProvider {
  readonly editors = new EditorRegistry();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly log: vscode.LogOutputChannel,
  ) {}

  resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): void {
    const session: EditorSession = new EditorSession({
      document,
      panel,
      extensionUri: this.extensionUri,
      log: this.log,
      bundle: 'dmn',
      title: 'DMN diagram',
      state: initialEditorState(document.uri),
      load: xmlDocumentMessage,
      hooks: {
        disposed: () => {
          this.editors.remove(session);
        },
      },
    });
    this.editors.add(session);
  }
}

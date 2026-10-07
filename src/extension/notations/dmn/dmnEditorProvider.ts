import type * as vscode from 'vscode';
import {
  EditorSession,
  initialEditorState,
  xmlDocumentMessage,
  type EditorState,
} from '../../core/editorSession';

export const DMN_VIEW_TYPE = 'bizmo.dmn';

/** DMN modeler (ADR 0014, prototype) on the shared editor session. */
export class DmnEditorProvider implements vscode.CustomTextEditorProvider {
  readonly states = new Set<EditorState>();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly log: vscode.LogOutputChannel,
  ) {}

  resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): void {
    const state = initialEditorState(document.uri);
    this.states.add(state);
    new EditorSession({
      document,
      panel,
      extensionUri: this.extensionUri,
      log: this.log,
      bundle: 'dmn',
      title: 'DMN diagram',
      state,
      load: xmlDocumentMessage,
      hooks: {
        disposed: () => this.states.delete(state),
      },
    });
  }
}

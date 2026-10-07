// Open editors of one notation, per document (several editors per document are possible). Used by
// commands that act on "the diagram of this file": export, reveal, and the testing API.
import * as vscode from 'vscode';
import type { ImageFormat } from '../../shared/protocol';
import type { EditorSession, EditorState } from './editorSession';

export class EditorRegistry<S extends EditorState = EditorState> {
  private readonly byDocument = new Map<string, Set<EditorSession<S>>>();

  add(session: EditorSession<S>): void {
    const key = session.document.uri.toString();
    const sessions = this.byDocument.get(key) ?? new Set<EditorSession<S>>();
    sessions.add(session);
    this.byDocument.set(key, sessions);
  }

  /** Forgets a closed editor; true if it was the last editor of its document. */
  remove(session: EditorSession<S>): boolean {
    const key = session.document.uri.toString();
    const sessions = this.byDocument.get(key);
    sessions?.delete(session);
    if (sessions && sessions.size > 0) return false;
    this.byDocument.delete(key);
    return true;
  }

  /** An open editor of the document, if any. */
  first(uri: vscode.Uri): EditorSession<S> | undefined {
    return this.byDocument.get(uri.toString())?.values().next().value;
  }

  /** Last known state of every open editor (testing API). */
  states(): S[] {
    return [...this.byDocument.values()].flatMap((sessions) =>
      [...sessions].map((session) => session.state),
    );
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
    const session = this.first(documentUri);
    if (!session) {
      void vscode.window.showWarningMessage('Open the diagram in Bizmo to export it.');
      return undefined;
    }
    return session.exportImage(format, target);
  }
}

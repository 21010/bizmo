// Host side of the document ↔ webview sync (ADR 0007, content.md → document_sync.md).
// Pure: VS Code access is injected through `SyncTarget`, so the rules are unit-tested.
import type { EditOutcome } from '../../shared/protocol';

export type LineEnding = '\n' | '\r\n';

/** The document as the sync logic sees it. */
export interface SyncTarget {
  version(): number;
  text(): string;
  eol(): LineEnding;
  /** Replaces the whole document; resolves to whether VS Code applied the edit. */
  replaceAll(text: string): Promise<boolean>;
}

/** Converts any line endings to the document's (`saveXML` always emits LF; ADR 0009). */
export function withLineEnding(text: string, eol: LineEnding): string {
  const lf = text.replace(/\r\n/g, '\n');
  return eol === '\n' ? lf : lf.replace(/\n/g, '\r\n');
}

/**
 * Applies webview edits to one document and recognises the resulting change events as our own,
 * so they are not echoed back to the webview that produced them. One instance per webview panel:
 * an edit from panel A is an external change for panel B.
 */
export class DocumentSync {
  /**
   * Expected document version → text of our own edits whose change event has not been seen yet.
   * Both must match: a concurrent external change can take the version we expected.
   */
  private readonly ownEdits = new Map<number, string>();

  constructor(private readonly target: SyncTarget) {}

  async applyEdit(content: string, baseVersion: number): Promise<EditOutcome> {
    // The webview edited an older version: someone else changed the document meanwhile.
    // Never overwrite their change; the caller re-sends the current document instead.
    if (baseVersion !== this.target.version()) return 'stale';

    const text = withLineEnding(content, this.target.eol());
    // No-op edits produce no version and no change event; recording one would later swallow
    // a real external change with that version.
    if (text === this.target.text()) return 'unchanged';

    const expected = this.target.version() + 1;
    this.ownEdits.set(expected, text);
    // VS Code rejects the edit if the document changed after it was issued (applyEdit is
    // version-checked), so a concurrent external change is never overwritten.
    const applied = await this.target.replaceAll(text);
    if (!applied) this.ownEdits.delete(expected);
    return applied ? 'applied' : 'failed';
  }

  /**
   * Called for every content change of the document. Returns true only for the change produced
   * by `applyEdit` (do not echo it); false for changes the webview must render.
   */
  isOwnChange(version: number, text: string): boolean {
    for (const own of this.ownEdits.keys()) {
      // An own edit expected at an older version can no longer arrive.
      if (own < version) this.ownEdits.delete(own);
    }
    const expectedText = this.ownEdits.get(version);
    this.ownEdits.delete(version);
    return expectedText === text;
  }
}

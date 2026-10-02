import { describe, expect, it } from 'vitest';
import {
  DocumentSync,
  withLineEnding,
  type LineEnding,
  type SyncTarget,
} from '../../../src/extension/core/documentSync';

/**
 * In-memory document with VS Code's rules: every change bumps the version, and `applyEdit`
 * fails if the document changed after the edit was issued.
 */
class FakeDocument implements SyncTarget {
  private version_ = 1;
  applyResult = true;
  /** Lets a test interleave another change while an edit is in flight. */
  duringApply?: () => void;

  constructor(
    private text_: string,
    private readonly eol_: LineEnding = '\n',
  ) {}

  version = () => this.version_;
  text = () => this.text_;
  eol = () => this.eol_;

  replaceAll = async (text: string): Promise<boolean> => {
    const issuedAt = this.version_;
    await Promise.resolve();
    this.duringApply?.();
    if (!this.applyResult || this.version_ !== issuedAt) return false;
    this.change(text);
    return true;
  };

  /** A change from anywhere: our edit, the text editor, git, undo. */
  change(text: string): void {
    this.text_ = text;
    this.version_ += 1;
  }
}

describe('withLineEnding', () => {
  it('converts to CRLF and back', () => {
    expect(withLineEnding('a\nb\r\nc', '\r\n')).toBe('a\r\nb\r\nc');
    expect(withLineEnding('a\r\nb\nc', '\n')).toBe('a\nb\nc');
  });
});

describe('DocumentSync', () => {
  it('applies an edit and recognises its change event as own', async () => {
    const doc = new FakeDocument('<a/>');
    const sync = new DocumentSync(doc);

    expect(await sync.applyEdit('<b/>', 1)).toBe('applied');
    expect(doc.text()).toBe('<b/>');
    expect(sync.isOwnChange(2, '<b/>')).toBe(true);
  });

  it('treats an own change event as own only once', async () => {
    const doc = new FakeDocument('<a/>');
    const sync = new DocumentSync(doc);
    await sync.applyEdit('<b/>', 1);
    expect(sync.isOwnChange(2, '<b/>')).toBe(true);
    expect(sync.isOwnChange(2, '<b/>')).toBe(false);
  });

  it('rejects edits based on an older version and leaves the document untouched', async () => {
    const doc = new FakeDocument('<a/>');
    const sync = new DocumentSync(doc);
    doc.change('<typed in the text editor/>');

    expect(await sync.applyEdit('<from webview/>', 1)).toBe('stale');
    expect(doc.text()).toBe('<typed in the text editor/>');
  });

  it('does not record no-op edits (they would swallow a later external change)', async () => {
    const doc = new FakeDocument('<a/>');
    const sync = new DocumentSync(doc);

    expect(await sync.applyEdit('<a/>', 1)).toBe('unchanged');
    expect(doc.version()).toBe(1);
    doc.change('<external/>');
    expect(sync.isOwnChange(2, '<external/>')).toBe(false);
  });

  it('keeps the document line endings', async () => {
    const doc = new FakeDocument('<a>\r\n</a>\r\n', '\r\n');
    const sync = new DocumentSync(doc);

    expect(await sync.applyEdit('<b>\n</b>\n', 1)).toBe('applied');
    expect(doc.text()).toBe('<b>\r\n</b>\r\n');
  });

  it('treats an edit equal to the CRLF document as unchanged', async () => {
    const doc = new FakeDocument('<a>\r\n</a>', '\r\n');
    const sync = new DocumentSync(doc);
    expect(await sync.applyEdit('<a>\n</a>', 1)).toBe('unchanged');
  });

  it('reports failed edits and forgets them', async () => {
    const doc = new FakeDocument('<a/>');
    const sync = new DocumentSync(doc);
    doc.applyResult = false;

    expect(await sync.applyEdit('<b/>', 1)).toBe('failed');
    doc.change('<b/>'); // even identical text from elsewhere is external now
    expect(sync.isOwnChange(2, '<b/>')).toBe(false);
  });

  it('never treats a concurrent external change as own, and never overwrites it', async () => {
    const doc = new FakeDocument('<a/>');
    const sync = new DocumentSync(doc);
    let externalWasOwn: boolean | undefined;
    doc.duringApply = () => {
      doc.change('<external/>'); // takes version 2, the version our edit expected
      externalWasOwn = sync.isOwnChange(2, doc.text());
    };

    expect(await sync.applyEdit('<b/>', 1)).toBe('failed');
    expect(externalWasOwn).toBe(false);
    expect(doc.text()).toBe('<external/>');
  });

  it('drops own edits that can no longer arrive', async () => {
    const doc = new FakeDocument('<a/>');
    const sync = new DocumentSync(doc);
    await sync.applyEdit('<b/>', 1); // version 2, event not consumed
    doc.change('<c/>'); // version 3
    expect(sync.isOwnChange(3, '<c/>')).toBe(false);
    expect(sync.isOwnChange(2, '<b/>')).toBe(false);
  });

  it('keeps panels independent: an edit from one panel is external for another', async () => {
    const doc = new FakeDocument('<a/>');
    const panelA = new DocumentSync(doc);
    const panelB = new DocumentSync(doc);

    await panelA.applyEdit('<b/>', 1);
    expect(panelA.isOwnChange(2, '<b/>')).toBe(true);
    expect(panelB.isOwnChange(2, '<b/>')).toBe(false);
  });
});

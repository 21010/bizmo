// Webview side of the document sync (ADR 0007). Local changes are debounced into full-document
// edits; at most one edit is in flight, and the next one is based on the version the host
// reports back, so continuous modeling never produces stale edits.
import type { EditOutcome } from '../../shared/protocol';
import { post } from './bridge';

export class EditSync {
  private baseVersion = -1;
  private dirty = false;
  private inFlight = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** Flush requests that arrived while an edit was in flight. */
  private readonly waitingFlushes: number[] = [];
  /** `sendNow` callers waiting for changes held back by the edit in flight. */
  private waitingSends: (() => void)[] = [];

  constructor(
    private readonly serialize: () => Promise<string>,
    private readonly delayMs = 300,
  ) {}

  /** A document version was rendered; local changes are now based on it. */
  rendered(version: number): void {
    clearTimeout(this.timer);
    this.baseVersion = version;
    this.dirty = false;
  }

  /** The diagram changed locally. */
  changed(): void {
    this.dirty = true;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.send(), this.delayMs);
  }

  /**
   * Sends pending changes immediately (focus left the editor, or an undo is about to run).
   * Resolves once every local change has been posted, including changes held back while an
   * earlier edit was in flight; dropped changes (stale/failed) also resolve it.
   */
  sendNow(): Promise<void> {
    clearTimeout(this.timer);
    if (!this.inFlight) return this.send();
    // The edit in flight is already posted; the host handles it before anything posted later.
    if (!this.dirty) return Promise.resolve();
    return new Promise((resolve) => this.waitingSends.push(resolve));
  }

  /** The host is about to save and asks for pending changes. */
  flush(requestId: number): void {
    clearTimeout(this.timer);
    void this.send(requestId);
  }

  /** The host's answer to our last edit. */
  result(outcome: EditOutcome, version: number): void {
    this.inFlight = false;
    if (outcome === 'applied' || outcome === 'unchanged') {
      this.baseVersion = version;
    } else {
      // stale/failed: the host follows up with the current document; local changes are dropped.
      this.dirty = false;
    }
    const waitingSends = this.waitingSends.splice(0);
    const release = () => {
      for (const resolve of waitingSends) resolve();
    };
    if (this.dirty) {
      void this.send(this.waitingFlushes.shift()).finally(release);
    } else {
      for (const requestId of this.waitingFlushes.splice(0)) post({ type: 'flushed', requestId });
      release();
    }
  }

  private async send(requestId?: number): Promise<void> {
    if (this.inFlight) {
      if (requestId !== undefined) this.waitingFlushes.push(requestId);
      return;
    }
    if (!this.dirty) {
      if (requestId !== undefined) post({ type: 'flushed', requestId });
      return;
    }
    this.dirty = false;
    this.inFlight = true;
    const baseVersion = this.baseVersion;
    try {
      const content = await this.serialize();
      post(
        requestId === undefined
          ? { type: 'edit', content, baseVersion }
          : { type: 'edit', content, baseVersion, requestId },
      );
    } catch (error) {
      this.inFlight = false;
      post({
        type: 'log',
        level: 'error',
        message: `Could not save the diagram: ${String(error)}`,
      });
      if (requestId !== undefined) post({ type: 'flushed', requestId });
    }
  }
}

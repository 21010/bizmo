import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebviewToHostMessage } from '../../../src/shared/protocol';

const posted: WebviewToHostMessage[] = [];
vi.mock('../../../src/webview/core/bridge', () => ({
  post: (message: WebviewToHostMessage) => posted.push(message),
}));

const { EditSync } = await import('../../../src/webview/core/editSync');

let content = '';
const serialize = () => Promise.resolve(content);
const edits = () => posted.filter((m) => m.type === 'edit');

beforeEach(() => {
  vi.useFakeTimers();
  posted.length = 0;
  content = 'v1';
});

afterEach(() => {
  vi.useRealTimers();
});

describe('EditSync', () => {
  it('debounces changes into one edit based on the rendered version', async () => {
    const sync = new EditSync(serialize, 300);
    sync.rendered(1);
    sync.changed();
    sync.changed();
    await vi.advanceTimersByTimeAsync(300);
    expect(edits()).toEqual([{ type: 'edit', content: 'v1', baseVersion: 1 }]);
  });

  it('bases the next edit on the version the host reports', async () => {
    const sync = new EditSync(serialize, 300);
    sync.rendered(1);
    sync.changed();
    await sync.sendNow();
    sync.result('applied', 2);
    content = 'v2';
    sync.changed();
    await sync.sendNow();
    expect(edits().map((m) => m.baseVersion)).toEqual([1, 2]);
  });

  it('keeps one edit in flight and sends held-back changes after the answer', async () => {
    const sync = new EditSync(serialize, 300);
    sync.rendered(1);
    sync.changed();
    await sync.sendNow();
    content = 'v2';
    sync.changed();
    await vi.advanceTimersByTimeAsync(300);
    expect(edits()).toHaveLength(1);
    sync.result('applied', 2);
    await vi.advanceTimersByTimeAsync(0);
    expect(edits()).toHaveLength(2);
    expect(edits()[1]).toMatchObject({ content: 'v2', baseVersion: 2 });
  });

  it('sendNow waits until changes held back by an edit in flight are posted', async () => {
    const sync = new EditSync(serialize, 300);
    sync.rendered(1);
    sync.changed();
    await sync.sendNow();
    content = 'v2';
    sync.changed();

    let done = false;
    const sent = sync.sendNow().then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(done).toBe(false);

    sync.result('applied', 2);
    await sent;
    // The held-back change was posted before sendNow resolved (an undo posted next follows it).
    expect(edits().map((m) => m.content)).toEqual(['v1', 'v2']);
  });

  it('sendNow resolves at once when the edit in flight holds everything', async () => {
    const sync = new EditSync(serialize, 300);
    sync.rendered(1);
    sync.changed();
    await sync.sendNow();
    await expect(sync.sendNow()).resolves.toBeUndefined();
    expect(edits()).toHaveLength(1);
  });

  it('sendNow resolves when held-back changes are dropped by a stale answer', async () => {
    const sync = new EditSync(serialize, 300);
    sync.rendered(1);
    sync.changed();
    await sync.sendNow();
    sync.changed();
    const sent = sync.sendNow();
    sync.result('stale', 3);
    await sent;
    expect(edits()).toHaveLength(1);
  });

  it('answers a flush with "flushed" when nothing is pending', async () => {
    const sync = new EditSync(serialize, 300);
    sync.rendered(1);
    sync.flush(7);
    await vi.advanceTimersByTimeAsync(0);
    expect(posted).toEqual([{ type: 'flushed', requestId: 7 }]);
  });

  it('answers a flush that arrives during an edit once that edit is answered', async () => {
    const sync = new EditSync(serialize, 300);
    sync.rendered(1);
    sync.changed();
    await sync.sendNow();
    sync.flush(4);
    await vi.advanceTimersByTimeAsync(0);
    expect(posted.some((m) => m.type === 'flushed')).toBe(false);
    sync.result('applied', 2);
    expect(posted.at(-1)).toEqual({ type: 'flushed', requestId: 4 });
  });

  it('sends pending changes with the flush request id', async () => {
    const sync = new EditSync(serialize, 300);
    sync.rendered(1);
    sync.changed();
    sync.flush(9);
    await vi.advanceTimersByTimeAsync(0);
    expect(edits()).toEqual([{ type: 'edit', content: 'v1', baseVersion: 1, requestId: 9 }]);
  });
});

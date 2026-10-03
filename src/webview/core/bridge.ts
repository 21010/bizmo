// The only channel between webview and host. Host messages are validated and handled one at a
// time, in order, so an update can never overtake the import before it.
import {
  isHostToWebviewMessage,
  type HostToWebviewMessage,
  type WebviewToHostMessage,
} from '../../shared/protocol';

const api = acquireVsCodeApi();

export function post(message: WebviewToHostMessage): void {
  api.postMessage(message);
}

export function onHostMessage(handler: (message: HostToWebviewMessage) => Promise<void>): void {
  let queue = Promise.resolve();
  window.addEventListener('message', (event: MessageEvent<unknown>) => {
    const message = event.data;
    if (!isHostToWebviewMessage(message)) {
      post({ type: 'log', level: 'warn', message: 'Dropped an invalid message from the host' });
      return;
    }
    queue = queue
      .then(() => handler(message))
      .catch((error: unknown) => {
        post({ type: 'log', level: 'error', message: String(error).slice(0, 500) });
      });
  });
}

/** Webview state survives the webview being hidden and recreated (tab switches). */
export function getState(): unknown {
  return api.getState();
}

/** Merges into the persisted state (viewport, panel layout, … are kept side by side). */
export function updateState(patch: Record<string, unknown>): void {
  const current = api.getState();
  const base = typeof current === 'object' && current !== null ? current : {};
  api.setState({ ...base, ...patch });
}

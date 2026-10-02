// Ambient declarations for webview bundles.

declare module '*.css';

interface VsCodeWebviewApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeWebviewApi;

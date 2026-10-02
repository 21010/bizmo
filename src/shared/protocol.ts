// Messages between the extension host and a webview, and their runtime validators.
// Every message crossing the boundary is untrusted input (security_guidelines.md): both sides
// validate shape and bounds before acting. Unknown or invalid messages are dropped.

export type ExecutionPlatform = 'c7' | 'c8';

/** Why the host refused to send a document to the webview. */
export type LoadRejection = 'tooLarge' | 'doctype';

export type HostToWebviewMessage =
  | { type: 'init'; content: string; version: number; platform: ExecutionPlatform }
  | { type: 'update'; content: string; version: number; platform: ExecutionPlatform }
  | { type: 'loadRejected'; version: number; reason: LoadRejection; message: string };

export type ImportResult =
  | { type: 'importResult'; version: number; ok: true; elementCount: number; warnings: string[] }
  | { type: 'importResult'; version: number; ok: false; error: string };

export type WebviewToHostMessage =
  | { type: 'ready' }
  | ImportResult
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string }
  | { type: 'cspViolation'; directive: string; blockedURI: string }
  | { type: 'openAsText' };

export const LIMITS = {
  /** Upper bound for document content in a message; the host's file size limit is lower. */
  contentChars: 100 * 1024 * 1024,
  text: 2000,
  warnings: 50,
  shortText: 200,
} as const;

type Fields = Record<string, unknown>;

const isObject = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isString = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length <= max;

const isVersion = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const isPlatform = (value: unknown): value is ExecutionPlatform => value === 'c7' || value === 'c8';

/** Rejects objects carrying keys other than the expected ones. */
const hasOnlyKeys = (message: Fields, keys: readonly string[]): boolean =>
  Object.keys(message).every((key) => keys.includes(key));

export function isWebviewToHostMessage(value: unknown): value is WebviewToHostMessage {
  if (!isObject(value)) return false;
  switch (value['type']) {
    case 'ready':
    case 'openAsText':
      return hasOnlyKeys(value, ['type']);
    case 'importResult':
      if (!isVersion(value['version'])) return false;
      if (value['ok'] === true) {
        const warnings = value['warnings'];
        return (
          hasOnlyKeys(value, ['type', 'version', 'ok', 'elementCount', 'warnings']) &&
          isVersion(value['elementCount']) &&
          Array.isArray(warnings) &&
          warnings.length <= LIMITS.warnings &&
          warnings.every((warning) => isString(warning, LIMITS.text))
        );
      }
      return (
        value['ok'] === false &&
        hasOnlyKeys(value, ['type', 'version', 'ok', 'error']) &&
        isString(value['error'], LIMITS.text)
      );
    case 'log':
      return (
        hasOnlyKeys(value, ['type', 'level', 'message']) &&
        (value['level'] === 'info' || value['level'] === 'warn' || value['level'] === 'error') &&
        isString(value['message'], LIMITS.text)
      );
    case 'cspViolation':
      return (
        hasOnlyKeys(value, ['type', 'directive', 'blockedURI']) &&
        isString(value['directive'], LIMITS.shortText) &&
        isString(value['blockedURI'], LIMITS.text)
      );
    default:
      return false;
  }
}

export function isHostToWebviewMessage(value: unknown): value is HostToWebviewMessage {
  if (!isObject(value)) return false;
  switch (value['type']) {
    case 'init':
    case 'update':
      return (
        hasOnlyKeys(value, ['type', 'content', 'version', 'platform']) &&
        isString(value['content'], LIMITS.contentChars) &&
        isVersion(value['version']) &&
        isPlatform(value['platform'])
      );
    case 'loadRejected':
      return (
        hasOnlyKeys(value, ['type', 'version', 'reason', 'message']) &&
        isVersion(value['version']) &&
        (value['reason'] === 'tooLarge' || value['reason'] === 'doctype') &&
        isString(value['message'], LIMITS.text)
      );
    default:
      return false;
  }
}

/** Truncates text to a protocol bound so a valid message can always be built from it. */
export function bounded(text: string, max: number = LIMITS.text): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

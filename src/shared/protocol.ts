// Messages between the extension host and a webview, and their runtime validators.
// Every message crossing the boundary is untrusted input (security_guidelines.md): both sides
// validate shape and bounds before acting. Unknown or invalid messages are dropped.

export type ExecutionPlatform = 'c7' | 'c8';

/** Why the host refused to send a document to the webview. */
export type LoadRejection = 'tooLarge' | 'doctype';

export type HostToWebviewMessage =
  | { type: 'init'; content: string; version: number; platform: ExecutionPlatform }
  | { type: 'update'; content: string; version: number; platform: ExecutionPlatform }
  | { type: 'loadRejected'; version: number; reason: LoadRejection; message: string }
  /** Asks the webview to send pending changes now (before a save). Answered by `edit` or `flushed`. */
  | { type: 'flush'; requestId: number }
  /**
   * Answer to every `edit`. `version` is the document version after it; the webview bases its next
   * edit on it. `stale` and `failed` are followed by an `update` with the current document.
   */
  | { type: 'editResult'; outcome: EditOutcome; version: number }
  /**
   * Element templates from the workspace, per platform (ADR 0010, D4). Empty in Restricted Mode.
   * Template content is workspace data: the webview validates it with the official validator.
   */
  | { type: 'templates'; c7: object[]; c8: object[] }
  /** User settings the webview acts on. Sent after `ready` and whenever they change. */
  | { type: 'settings'; linting: boolean }
  /** Selects an element and shows its lint problem, if any (from a diagnostic's link). */
  | { type: 'reveal'; elementId: string }
  /** Asks for an image of the diagram; answered by `exported`. */
  | { type: 'export'; requestId: number; format: ImageFormat };

/** Image formats the diagram can be exported to. */
export type ImageFormat = 'svg' | 'png';

/** Severity of a lint problem, as shown in VS Code's Problems view. */
export type LintSeverity = 'error' | 'warning' | 'info';

/** One lint finding (M6): the element it is about, a readable message, and the rule's name. */
export interface LintProblem {
  elementId: string;
  message: string;
  severity: LintSeverity;
  rule: string;
}

/** What the host did with an `edit` (ADR 0007). */
export type EditOutcome = 'applied' | 'unchanged' | 'stale' | 'failed';

export type ImportResult =
  | { type: 'importResult'; version: number; ok: true; elementCount: number; warnings: string[] }
  | { type: 'importResult'; version: number; ok: false; error: string };

export type WebviewToHostMessage =
  | { type: 'ready' }
  | ImportResult
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string }
  | { type: 'cspViolation'; directive: string; blockedURI: string }
  | { type: 'openAsText' }
  /**
   * Undo/redo keystroke in the webview (ADR 0012). The host runs VS Code's undo/redo after any
   * edit already received, so a change made just before the keystroke is what gets undone.
   */
  | { type: 'undo' }
  | { type: 'redo' }
  /**
   * The full new document content, based on the document version the webview last rendered.
   * `requestId` is set when the edit answers a `flush`.
   */
  | { type: 'edit'; content: string; baseVersion: number; requestId?: number }
  /** Answer to `flush` when nothing was pending. */
  | { type: 'flushed'; requestId: number }
  /** Element templates rejected by the validator (schema errors), for the host log. */
  | { type: 'templateErrors'; messages: string[] }
  /** All current lint problems of the diagram (replaces the previous ones); empty when off. */
  | { type: 'lint'; problems: LintProblem[] }
  /**
   * Answer to `export`: SVG markup, or a PNG as base64. Only image data; the host chooses where
   * it goes (save dialog) and checks the format before writing.
   */
  | { type: 'exported'; requestId: number; ok: true; format: ImageFormat; data: string }
  | { type: 'exported'; requestId: number; ok: false; error: string };

export const LIMITS = {
  /** Upper bound for document content in a message; the host's file size limit is lower. */
  contentChars: 100 * 1024 * 1024,
  text: 2000,
  warnings: 50,
  shortText: 200,
  /** Same as the host's template count limit (templateFiles.ts). */
  templates: 2000,
  /** Lint problems per message; Camunda Desktop Modeler shows far fewer in practice. */
  lintProblems: 1000,
  /** Exported image data (SVG text or PNG base64); PNGs are also capped in pixels. */
  exportChars: 64 * 1024 * 1024,
} as const;

type Fields = Record<string, unknown>;

const isObject = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isString = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length <= max;

const isVersion = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const isImageFormat = (value: unknown): value is ImageFormat => value === 'svg' || value === 'png';

const isPlatform = (value: unknown): value is ExecutionPlatform => value === 'c7' || value === 'c8';

/** Rejects objects carrying keys other than the expected ones. */
const hasOnlyKeys = (message: Fields, keys: readonly string[]): boolean =>
  Object.keys(message).every((key) => keys.includes(key));

export function isWebviewToHostMessage(value: unknown): value is WebviewToHostMessage {
  if (!isObject(value)) return false;
  switch (value['type']) {
    case 'ready':
    case 'openAsText':
    case 'undo':
    case 'redo':
      return hasOnlyKeys(value, ['type']);
    case 'edit':
      return (
        hasOnlyKeys(value, ['type', 'content', 'baseVersion', 'requestId']) &&
        isString(value['content'], LIMITS.contentChars) &&
        isVersion(value['baseVersion']) &&
        (value['requestId'] === undefined || isVersion(value['requestId']))
      );
    case 'flushed':
      return hasOnlyKeys(value, ['type', 'requestId']) && isVersion(value['requestId']);
    case 'templateErrors': {
      const messages = value['messages'];
      return (
        hasOnlyKeys(value, ['type', 'messages']) &&
        Array.isArray(messages) &&
        messages.length <= LIMITS.warnings &&
        messages.every((message) => isString(message, LIMITS.text))
      );
    }
    case 'lint': {
      const problems = value['problems'];
      return (
        hasOnlyKeys(value, ['type', 'problems']) &&
        Array.isArray(problems) &&
        problems.length <= LIMITS.lintProblems &&
        problems.every(isLintProblem)
      );
    }
    case 'exported':
      if (!isVersion(value['requestId'])) return false;
      if (value['ok'] === true) {
        return (
          hasOnlyKeys(value, ['type', 'requestId', 'ok', 'format', 'data']) &&
          isImageFormat(value['format']) &&
          isString(value['data'], LIMITS.exportChars)
        );
      }
      return (
        value['ok'] === false &&
        hasOnlyKeys(value, ['type', 'requestId', 'ok', 'error']) &&
        isString(value['error'], LIMITS.text)
      );
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
    case 'flush':
      return hasOnlyKeys(value, ['type', 'requestId']) && isVersion(value['requestId']);
    case 'editResult':
      return (
        hasOnlyKeys(value, ['type', 'outcome', 'version']) &&
        (value['outcome'] === 'applied' ||
          value['outcome'] === 'unchanged' ||
          value['outcome'] === 'stale' ||
          value['outcome'] === 'failed') &&
        isVersion(value['version'])
      );
    case 'templates':
      return (
        hasOnlyKeys(value, ['type', 'c7', 'c8']) &&
        isTemplateList(value['c7']) &&
        isTemplateList(value['c8'])
      );
    case 'settings':
      return hasOnlyKeys(value, ['type', 'linting']) && typeof value['linting'] === 'boolean';
    case 'export':
      return (
        hasOnlyKeys(value, ['type', 'requestId', 'format']) &&
        isVersion(value['requestId']) &&
        isImageFormat(value['format'])
      );
    case 'reveal':
      return (
        hasOnlyKeys(value, ['type', 'elementId']) && isString(value['elementId'], LIMITS.shortText)
      );
    default:
      return false;
  }
}

function isLintProblem(value: unknown): value is LintProblem {
  return (
    isObject(value) &&
    hasOnlyKeys(value, ['elementId', 'message', 'severity', 'rule']) &&
    isString(value['elementId'], LIMITS.shortText) &&
    isString(value['message'], LIMITS.text) &&
    (value['severity'] === 'error' ||
      value['severity'] === 'warning' ||
      value['severity'] === 'info') &&
    isString(value['rule'], LIMITS.shortText)
  );
}

const isTemplateList = (value: unknown): value is object[] =>
  Array.isArray(value) && value.length <= LIMITS.templates && value.every(isObject);

/** Truncates text to a protocol bound so a valid message can always be built from it. */
export function bounded(text: string, max: number = LIMITS.text): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

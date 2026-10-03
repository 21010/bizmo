import { describe, expect, it } from 'vitest';
import {
  bounded,
  isHostToWebviewMessage,
  isWebviewToHostMessage,
  LIMITS,
} from '../../../src/shared/protocol';

const problem = {
  elementId: 'Task_1',
  message: 'A <Service Task> must have a <Task definition type>',
  severity: 'error',
  rule: 'camunda-compat/implementation',
};

describe('isWebviewToHostMessage', () => {
  it.each([
    { type: 'ready' },
    { type: 'openAsText' },
    {
      type: 'importResult',
      version: 3,
      ok: true,
      elementCount: 12,
      warnings: ['unresolved reference'],
    },
    { type: 'importResult', version: 3, ok: false, error: 'unparsable content' },
    { type: 'log', level: 'warn', message: 'something' },
    { type: 'cspViolation', directive: 'style-src-attr', blockedURI: 'inline' },
    { type: 'undo' },
    { type: 'redo' },
    { type: 'edit', content: '<x/>', baseVersion: 2 },
    { type: 'edit', content: '<x/>', baseVersion: 2, requestId: 5 },
    { type: 'flushed', requestId: 5 },
    { type: 'lint', problems: [] },
    { type: 'lint', problems: [problem] },
    { type: 'exported', requestId: 1, ok: true, format: 'svg', data: '<svg/>' },
    { type: 'exported', requestId: 1, ok: true, format: 'png', data: 'iVBORw0KGgo=' },
    { type: 'exported', requestId: 1, ok: false, error: 'no diagram' },
  ])('accepts %j', (message) => {
    expect(isWebviewToHostMessage(message)).toBe(true);
  });

  it.each([
    ['null', null],
    ['a string', 'ready'],
    ['an array', [{ type: 'ready' }]],
    ['an unknown type', { type: 'runCommand', command: 'workbench.action.terminal.new' }],
    ['an extra key', { type: 'openAsText', uri: 'file:///etc/passwd' }],
    ['undo with a command', { type: 'undo', command: 'workbench.action.terminal.new' }],
    ['redo with an argument', { type: 'redo', steps: 100 }],
    ['an edit without base version', { type: 'edit', content: '<x/>' }],
    [
      'an edit with a string request id',
      { type: 'edit', content: '', baseVersion: 1, requestId: 'a' },
    ],
    ['a negative version', { type: 'importResult', version: -1, ok: false, error: 'x' }],
    ['a non-integer version', { type: 'importResult', version: 1.5, ok: false, error: 'x' }],
    ['a string version', { type: 'importResult', version: '1', ok: false, error: 'x' }],
    ['ok not boolean', { type: 'importResult', version: 1, ok: 'yes', error: 'x' }],
    [
      'too many warnings',
      {
        type: 'importResult',
        version: 1,
        ok: true,
        elementCount: 1,
        warnings: Array.from({ length: LIMITS.warnings + 1 }, () => 'w'),
      },
    ],
    [
      'an oversized warning',
      {
        type: 'importResult',
        version: 1,
        ok: true,
        elementCount: 1,
        warnings: ['x'.repeat(LIMITS.text + 1)],
      },
    ],
    [
      'a non-string warning',
      { type: 'importResult', version: 1, ok: true, elementCount: 1, warnings: [{}] },
    ],
    [
      'an oversized error',
      { type: 'importResult', version: 1, ok: false, error: 'x'.repeat(LIMITS.text + 1) },
    ],
    ['an unknown log level', { type: 'log', level: 'debug', message: 'x' }],
    [
      'an oversized log message',
      { type: 'log', level: 'info', message: 'x'.repeat(LIMITS.text + 1) },
    ],
    [
      'an oversized directive',
      { type: 'cspViolation', directive: 'x'.repeat(LIMITS.shortText + 1), blockedURI: '' },
    ],
    ['lint without problems', { type: 'lint' }],
    [
      'an unknown image format',
      { type: 'exported', requestId: 1, ok: true, format: 'pdf', data: '' },
    ],
    ['an export without request id', { type: 'exported', ok: true, format: 'svg', data: '' }],
    [
      'an export with a file name',
      { type: 'exported', requestId: 1, ok: true, format: 'svg', data: '', path: '/etc/x' },
    ],
    [
      'oversized image data',
      {
        type: 'exported',
        requestId: 1,
        ok: true,
        format: 'svg',
        data: 'x'.repeat(LIMITS.exportChars + 1),
      },
    ],
    ['an unknown severity', { type: 'lint', problems: [{ ...problem, severity: 'fatal' }] }],
    ['a problem with an extra key', { type: 'lint', problems: [{ ...problem, html: '<b>' }] }],
    ['a problem without a rule', { type: 'lint', problems: [{ ...problem, rule: undefined }] }],
    [
      'an oversized element id',
      { type: 'lint', problems: [{ ...problem, elementId: 'x'.repeat(LIMITS.shortText + 1) }] },
    ],
    [
      'an oversized lint message',
      { type: 'lint', problems: [{ ...problem, message: 'x'.repeat(LIMITS.text + 1) }] },
    ],
    [
      'too many problems',
      { type: 'lint', problems: Array.from({ length: LIMITS.lintProblems + 1 }, () => problem) },
    ],
  ])('rejects %s', (_label, message) => {
    expect(isWebviewToHostMessage(message)).toBe(false);
  });

  it('rejects host messages sent back to the host', () => {
    expect(isWebviewToHostMessage({ type: 'init', content: '', version: 1, platform: 'c8' })).toBe(
      false,
    );
  });
});

describe('isHostToWebviewMessage', () => {
  it.each([
    { type: 'init', content: '<xml/>', version: 1, platform: 'c8' },
    { type: 'update', content: '<xml/>', version: 2, platform: 'c7' },
    { type: 'loadRejected', version: 1, reason: 'doctype', message: 'blocked' },
    { type: 'settings', linting: false },
    { type: 'reveal', elementId: 'Task_1' },
    { type: 'export', requestId: 3, format: 'png' },
  ])('accepts %j', (message) => {
    expect(isHostToWebviewMessage(message)).toBe(true);
  });

  it.each([
    ['an unknown platform', { type: 'init', content: '', version: 1, platform: 'c9' }],
    ['a non-string content', { type: 'init', content: 42, version: 1, platform: 'c8' }],
    [
      'an unknown rejection reason',
      { type: 'loadRejected', version: 1, reason: 'other', message: '' },
    ],
    ['an extra key', { type: 'update', content: '', version: 1, platform: 'c8', script: 'x' }],
    ['a webview message', { type: 'ready' }],
    ['a non-boolean setting', { type: 'settings', linting: 'yes' }],
    ['an unknown setting', { type: 'settings', linting: true, telemetry: true }],
    ['a non-string element id', { type: 'reveal', elementId: 3 }],
    ['an unknown export format', { type: 'export', requestId: 3, format: 'gif' }],
    ['an oversized element id', { type: 'reveal', elementId: 'x'.repeat(LIMITS.shortText + 1) }],
  ])('rejects %s', (_label, message) => {
    expect(isHostToWebviewMessage(message)).toBe(false);
  });
});

describe('bounded', () => {
  it('keeps short text unchanged', () => {
    expect(bounded('short', 10)).toBe('short');
  });

  it('truncates to exactly the limit', () => {
    const result = bounded('x'.repeat(50), 10);
    expect(result).toHaveLength(10);
    expect(result.endsWith('…')).toBe(true);
  });
});

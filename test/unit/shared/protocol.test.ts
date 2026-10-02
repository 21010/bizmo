import { describe, expect, it } from 'vitest';
import {
  bounded,
  isHostToWebviewMessage,
  isWebviewToHostMessage,
  LIMITS,
} from '../../../src/shared/protocol';

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
  ])('accepts %j', (message) => {
    expect(isWebviewToHostMessage(message)).toBe(true);
  });

  it.each([
    ['null', null],
    ['a string', 'ready'],
    ['an array', [{ type: 'ready' }]],
    ['an unknown type', { type: 'runCommand', command: 'workbench.action.terminal.new' }],
    ['an extra key', { type: 'openAsText', uri: 'file:///etc/passwd' }],
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

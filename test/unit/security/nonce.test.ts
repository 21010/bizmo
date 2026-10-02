import { describe, expect, it } from 'vitest';
import { createNonce } from '../../../src/extension/security/nonce';

describe('createNonce', () => {
  it('returns 16 random bytes encoded as base64', () => {
    const nonce = createNonce();

    expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(Buffer.from(nonce, 'base64')).toHaveLength(16);
  });

  it('returns a different value on every call', () => {
    const nonces = new Set(Array.from({ length: 100 }, () => createNonce()));

    expect(nonces.size).toBe(100);
  });
});

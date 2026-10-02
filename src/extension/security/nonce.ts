import { randomBytes } from 'node:crypto';

/**
 * Creates a CSP nonce for a single webview render.
 *
 * 16 bytes from the CSPRNG, base64-encoded (the CSP grammar accepts base64).
 */
export function createNonce(): string {
  return randomBytes(16).toString('base64');
}

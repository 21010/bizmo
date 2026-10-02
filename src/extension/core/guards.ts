// Checks run on the host before an XML document is sent to a webview (security_guidelines.md).
// Pure (no `vscode` import) for unit testing.
import type { LoadRejection } from '../../shared/protocol';

export type GuardResult =
  { ok: true; content: string } | { ok: false; reason: LoadRejection; message: string };

/** DTDs and entity declarations are never needed for BPMN/DMN and enable XXE / entity expansion. */
const DTD = /<!DOCTYPE|<!ENTITY/i;

export const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

export function checkXmlDocument(text: string, maxBytes: number): GuardResult {
  const content = text.startsWith(BYTE_ORDER_MARK) ? text.slice(1) : text;
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > maxBytes) {
    return {
      ok: false,
      reason: 'tooLarge',
      message: `The file is ${formatMegabytes(bytes)}, above the limit of ${formatMegabytes(maxBytes)} (setting "bizmo.maxFileSizeMB").`,
    };
  }
  if (DTD.test(content)) {
    return {
      ok: false,
      reason: 'doctype',
      message:
        'The file contains a DOCTYPE or ENTITY declaration. These are not used by BPMN and are blocked for security reasons.',
    };
  }
  return { ok: true, content };
}

const formatMegabytes = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

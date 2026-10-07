// Checks run on the host before an XML document is sent to a webview (security_guidelines.md).
// Pure (no `vscode` import) for unit testing.
import type { LoadRejection } from '../../shared/protocol';

export type GuardResult =
  { ok: true; content: string } | { ok: false; reason: LoadRejection; message: string };

/** DTDs and entity declarations are never needed for BPMN/DMN and enable XXE / entity expansion. */
const DTD = /<!DOCTYPE|<!ENTITY/i;

/** Where each markup construct ends, as an XML parser reads it. */
const SKIPPED_UNTIL: readonly (readonly [start: string, end: string])[] = [
  ['<!--', '-->'],
  ['<![CDATA[', ']]>'],
  ['<?', '?>'],
];

/**
 * Whether the document declares a DTD or entity. Comments, CDATA sections, processing
 * instructions and attribute values are skipped, so text like `<!DOCTYPE` inside them does not
 * block a file. Anything unterminated falls back to searching the rest of the text: the scan never
 * accepts what a lenient parser might read differently.
 */
export function declaresDtd(text: string): boolean {
  let index = 0;
  while ((index = text.indexOf('<', index)) !== -1) {
    const skipped = SKIPPED_UNTIL.find(([start]) => text.startsWith(start, index));
    let end: number;
    if (skipped) {
      const close = text.indexOf(skipped[1], index + skipped[0].length);
      end = close === -1 ? -1 : close + skipped[1].length;
    } else {
      if (DTD.test(text.slice(index, index + 9))) return true;
      end = tagEnd(text, index + 1);
    }
    if (end === -1) return DTD.test(text.slice(index));
    index = end;
  }
  return false;
}

/**
 * Index after the `>` closing a tag, skipping quoted attribute values. -1 if unterminated or if a
 * `<` appears before the end (not well-formed, also inside attribute values).
 */
function tagEnd(text: string, from: number): number {
  let quote: string | undefined;
  for (let i = from; i < text.length; i++) {
    const char = text[i];
    if (char === '<') return -1;
    if (quote) {
      if (char === quote) quote = undefined;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '>') {
      return i + 1;
    }
  }
  return -1;
}

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
  if (declaresDtd(content)) {
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

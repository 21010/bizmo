// Checks image data exported by a webview before it is written to disk. The webview is untrusted:
// only well-formed SVG markup or PNG bytes are accepted. Pure, so it is unit-tested.
import type { ImageFormat } from '../../shared/protocol';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
/**
 * SVG markup: an optional XML declaration, comments, and the SVG 1.1 DOCTYPE (as bpmn-js writes
 * it; no internal subset, so no entities), then the <svg> root element.
 */
const SVG_START =
  /^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^[>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/;

export type ImageCheck = { ok: true; bytes: Uint8Array } | { ok: false; reason: string };

export function checkExportedImage(format: ImageFormat, data: string): ImageCheck {
  if (format === 'svg') {
    if (!SVG_START.test(data)) return { ok: false, reason: 'not SVG markup' };
    // Active content has no place in an exported diagram image.
    // Event handlers only inside tags: label text may contain "on…=", and its "<" is escaped.
    if (/<script[\s>]|<foreignObject[\s>]|<[^>]*\son[a-z]+\s*=/i.test(data)) {
      return { ok: false, reason: 'SVG contains active content' };
    }
    return { ok: true, bytes: new TextEncoder().encode(data) };
  }
  if (data.length % 4 !== 0 || !BASE64.test(data)) return { ok: false, reason: 'not base64' };
  const bytes = Buffer.from(data, 'base64');
  if (!PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    return { ok: false, reason: 'not a PNG image' };
  }
  return { ok: true, bytes: new Uint8Array(bytes) };
}

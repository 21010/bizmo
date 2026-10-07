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

/** Elements that run code or embed documents; none belong in a diagram image. */
const ACTIVE_ELEMENT = /<(?:script|foreignObject|iframe|embed|object|set|animate\w*)[\s>/]/i;
/** Event handler attributes, only inside tags: label text may contain "on…=", and its "<" is escaped. */
const EVENT_HANDLER = /<[^>]*\son[a-z]+\s*=/i;
/**
 * A link or reference to anything but a fragment (`#id`, markers) or an inline image: remote
 * content, `javascript:` URLs, other files. Checked inside tags, like event handlers.
 */
const EXTERNAL_HREF = /<[^>]*\s(?:[\w-]+:)?href\s*=(?!\s*["']?\s*(?:#|data:image\/))/i;
const EXTERNAL_URL = /<[^>]*url\((?!\s*["']?\s*(?:#|data:image\/))/i;
/** Style sheets could load remote resources; bpmn-js styles elements with attributes only. */
const STYLE_ELEMENT = /<style[\s>/]/i;

export type ImageCheck = { ok: true; bytes: Uint8Array } | { ok: false; reason: string };

export function checkExportedImage(format: ImageFormat, data: string): ImageCheck {
  if (format === 'svg') {
    if (!SVG_START.test(data)) return { ok: false, reason: 'not SVG markup' };
    // Active content has no place in an exported diagram image.
    if (ACTIVE_ELEMENT.test(data) || EVENT_HANDLER.test(data)) {
      return { ok: false, reason: 'SVG contains active content' };
    }
    if (EXTERNAL_HREF.test(data) || EXTERNAL_URL.test(data) || STYLE_ELEMENT.test(data)) {
      return { ok: false, reason: 'SVG references external content' };
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

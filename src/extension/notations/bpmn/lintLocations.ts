// Where a lint problem sits in the XML text (M6): the element's `id` attribute value. Pure, so it is
// unit-tested without VS Code; the provider turns offsets into positions.

/** Character offsets of the id value in the text, or the start of the text if it is not found. */
export interface TextSpan {
  start: number;
  end: number;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Offsets of each element id's value (the first `id="…"` with that value), for many ids at once. */
export function locateElementIds(text: string, ids: Iterable<string>): Map<string, TextSpan> {
  const spans = new Map<string, TextSpan>();
  for (const id of new Set(ids)) {
    // `id` as a whole attribute name (not `processId`, `bpmnElement`, or `xml:id`).
    const pattern = new RegExp(`(?<![\\w:.-])id\\s*=\\s*(["'])${escapeRegExp(id)}\\1`);
    const match = pattern.exec(text);
    if (!match) {
      spans.set(id, { start: 0, end: 0 });
      continue;
    }
    const start = match.index + match[0].length - 1 - id.length;
    spans.set(id, { start, end: start + id.length });
  }
  return spans;
}

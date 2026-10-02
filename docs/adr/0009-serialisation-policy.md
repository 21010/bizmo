# 0009. BPMN serialisation and write policy

- Status: accepted
- Date: 2026-10-02
- Evidence: spike S3 (`spikes/README.md`)

## Context

`saveXML({ format: true })` re-serialises the whole document. On 80 real Desktop Modeler files, output is idempotent (stable after the first save), but the first save often differs from the original — mostly diagram-interchange (DI) element reordering, plus dropped unused namespace declarations, self-closed empty elements, and normalised attribute order.

## Decision

1. **Never write on open, import, or re-import.** Only a user's modeling change produces an edit.
2. Serialise with `saveXML({ format: true })` (same formatting as Camunda Desktop Modeler, which uses the same libraries).
3. Before applying an edit, convert line endings to the document's EOL (`saveXML` always emits LF) and keep the final newline.
4. Apply edits as a full-document replacement in v1. Minimal-range edits are not needed for correctness; reconsider only if users report noisy diffs beyond the one-time reorder.
5. Do not set or change `exporter` / `exporterVersion` on `bpmn:definitions` in v1 (keeps diffs small and avoids misleading Desktop Modeler).

## Consequences

- The first edit of a file last saved by an older Modeler may reorder DI elements in the diff; afterwards diffs are minimal.
- Files that are not well-formed (e.g. duplicate attributes) are silently normalised by the parser; linting may flag such cases later.

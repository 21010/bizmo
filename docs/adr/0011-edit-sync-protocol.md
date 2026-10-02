# 0011. Edit sync protocol details

- Status: accepted
- Date: 2026-10-02
- Builds on: ADR 0007 (text-backed editor, VS Code-owned undo), ADR 0009 (write policy)

## Context

M3 implemented editing. Testing the M1 prototype design against concurrency cases showed gaps:
the webview could send edits based on an outdated version during continuous modeling, a change
made under 300 ms before Ctrl+S could miss the save, and a concurrent external change could be
mistaken for the echo of our own edit.

## Decision

1. **Every `edit` is answered with `editResult { outcome, version }`.** `outcome` is `applied`,
   `unchanged` (no-op), `stale` (document changed since the webview rendered it), or `failed`
   (VS Code rejected the edit). `stale` and `failed` are followed by an `update` with the current
   document; the webview's unsent local changes are dropped. A document change made elsewhere
   always wins over the diagram.
2. **At most one edit in flight per webview.** Changes made meanwhile are batched into the next
   edit, based on the version from `editResult`. Continuous modeling never produces stale edits.
3. **Echo detection by version and text.** The host records the expected version _and_ text of
   each own edit and treats a change event as its own only if both match. No-op edits are not
   recorded. VS Code's `applyEdit` is version-checked (`bulkTextEdits.ts`: "has changed in the
   meantime"), so a concurrent external change is never overwritten.
4. **Flush before save.** `onWillSaveTextDocument` sends `flush { requestId }`; the webview answers
   with an immediate `edit` (carrying the `requestId`) or `flushed`. Saving waits up to 2 s. The
   webview also sends pending changes when it loses focus.
5. **Multiple diagram editors per document** are supported; each panel has its own sync state, so
   one panel's edit is an external change for the other.
6. **Undo/redo keys** (Ctrl/Cmd+Z, Ctrl+Y, Ctrl/Cmd+Shift+Z) are swallowed by the modeler and
   handled by VS Code (ADR 0007), verified with trusted keystrokes in end-to-end tests.

## Consequences

- Unit tests cover the host rules (`documentSync.test.ts`), browser tests the webview rules
  (`bpmnEditing.test.ts`), and end-to-end tests the full loop in real VS Code (`test/e2e`).
- Copy/paste uses the system clipboard (`bpmn-js-native-copy-paste`); VS Code grants webviews
  `clipboard-read`/`clipboard-write`. A keyboard paste attaches the elements to the mouse; a click
  places them (diagram-js behaviour).
- The full Camunda modeler bundle is 2.8 MB (properties panel, element templates and their
  validator, FEEL editor). A size budget and lazy loading are evaluated in M7.

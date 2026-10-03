# 0007. Text-backed custom editor with VS Code-owned undo

- Status: accepted (decision 3 refined by ADR 0012)
- Date: 2026-10-02
- Decision ID: D2
- Evidence: spikes S2 and S4 (`spikes/README.md`)

## Context

VS Code offers `CustomTextEditorProvider` (document is a `TextDocument`) and `CustomEditorProvider` (extension-managed document, save, backup, and undo). bpmn-js has its own command stack, so a text-backed editor has two undo stacks.

## Decision

Use **`CustomTextEditorProvider`** for every notation, with **VS Code's document undo stack as the only undo stack**:

1. The `TextDocument` is the source of truth. The webview proposes full-document edits (`{ content, baseVersion }`); the host rejects stale `baseVersion`s and re-sends the current content.
2. The host records the version produced by its own edit and ignores that change event (echo suppression); every other change triggers a re-import that preserves viewport and selection.
3. The webview swallows the modeler's own undo/redo keys (Ctrl/Cmd+Z, Ctrl/Cmd+Y, Ctrl/Cmd+Shift+Z) with a high-priority keyboard listener. VS Code's forwarded keystroke then runs the document undo/redo, and the diagram re-imports.
4. Keyboard listeners return `undefined` for keys they do not handle (returning `false` cancels the event in diagram-js).

## Evidence

- Trusted-keystroke control experiment: without step 3, one Ctrl+Z undoes twice (bpmn-js and document).
- Prototype integration tests pass on VS Code 1.140.0 and 1.134.0: undo restores the original text exactly; redo re-applies; echo suppressed; external and invalid changes handled.
- Re-import costs ~0.3 s for 1,000 elements in VS Code; typical diagrams are far smaller.

## Consequences

- Save, revert, hot exit, auto-save, git diff, and side-by-side text editing come from VS Code for free.
- Undo granularity is one debounced edit (≈300 ms of modeling), not one bpmn-js command. Acceptable; revisit if users report it.
- Undo of very large diagrams (> 2,000 elements) takes about a second. Acceptable for v1; measure again in M7.
- `CustomEditorProvider` remains the fallback if this proves insufficient.

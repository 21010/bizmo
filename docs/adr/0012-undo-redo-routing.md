# 0012. Undo/redo keystrokes are routed to VS Code through the host

- Status: accepted
- Date: 2026-10-03
- Supersedes in part: ADR 0007 decision 3 and ADR 0011 decision 6 (how the keystroke reaches VS Code)

## Context

ADR 0007 makes VS Code's document undo stack the only one. In M3, the canvas swallowed its own
undo/redo bindings and relied on VS Code's webview keystroke forwarding to run the document undo.

M4 adds the properties panel, which binds undo/redo on its container, calls the modeler's
command stack, and **stops propagation** — VS Code never sees the keystroke, and the panel undoes
locally, producing a forward edit out of step with VS Code's undo history. CodeMirror (FEEL
fields) has its own history as well. A second gap existed already: a change made within the
300 ms debounce before Ctrl+Z was not yet in the document, so VS Code undid the previous change
and the pending one was dropped with it.

## Decision

1. One capture-phase `keydown` listener on `window` in every webview catches undo (Ctrl/Cmd+Z) and
   redo (Ctrl+Y, Ctrl/Cmd+Shift+Z) before any component and before VS Code's forwarding, and stops
   the event.
2. It hands over pending changes (`EditSync.sendNow`), then posts `{ type: 'undo' | 'redo' }`.
3. The host runs `vscode.commands.executeCommand('undo' | 'redo')` in the same queue as edits, so
   the change made just before the keystroke is applied first and is what gets undone.

## Consequences

- Undo/redo behave the same on the canvas, in panel fields, and in FEEL editors: one step of the
  document's history, verified end-to-end in VS Code with trusted keystrokes.
- Native in-field text undo is not available (it was not before either: VS Code's webview host
  prevents the browser default for these keys).
- Inside the webview the keys are fixed (Ctrl/Cmd+Z, Ctrl+Y, Ctrl/Cmd+Shift+Z); custom VS Code
  keybindings for undo/redo apply outside the webview only.
- The message carries no arguments and acts on the active editor (the one with focus).

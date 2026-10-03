// Routes undo/redo keystrokes to VS Code (ADR 0012).
//
// Several components inside the webview handle these keys themselves: diagram-js keyboard
// bindings, the properties panel (which also stops propagation), and CodeMirror in FEEL fields.
// Each would undo locally, out of step with the document's undo stack. A single capture-phase
// listener on `window` runs before all of them and before VS Code's own keystroke forwarding,
// hands over pending changes, and asks the host to run VS Code's undo/redo.
import { post } from './bridge';

export type UndoRedo = 'undo' | 'redo';

export function undoRedoOf(event: KeyboardEvent): UndoRedo | undefined {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return undefined;
  const key = event.key.toLowerCase();
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && !event.shiftKey) return 'redo';
  return undefined;
}

export function routeUndoRedoToHost(flushPending: () => Promise<void>): void {
  window.addEventListener(
    'keydown',
    (event) => {
      const action = undoRedoOf(event);
      if (!action) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      // Pending changes first, so the change made just before the keystroke is what gets undone.
      void flushPending().then(() => {
        post({ type: action });
      });
    },
    { capture: true },
  );
}

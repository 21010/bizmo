// Webview side of an editor, independent of the notation (ADR 0004, 0007, 0011, 0012): the host
// message loop, document sync, undo/redo routing, error overlays, and image export. A notation
// renders documents, serialises its model, and handles its own messages.
import {
  bounded,
  LIMITS,
  type HostToWebviewMessage,
  type ImageFormat,
} from '../../shared/protocol';
import { onHostMessage, post } from './bridge';
import { EditSync } from './editSync';
import { hideOverlay, showOverlay } from './overlay';
import { routeUndoRedoToHost } from './undoRouting';

export type DocumentMessage = Extract<HostToWebviewMessage, { type: 'init' | 'update' }>;

/** Messages the notation handles; everything else is handled by the core. */
export type NotationMessage = Exclude<
  HostToWebviewMessage,
  { type: 'init' | 'update' | 'loadRejected' | 'editResult' | 'flush' | 'export' }
>;

export interface Rendered {
  elementCount: number;
  warnings: string[];
}

export interface Notation {
  /**
   * Shows a document version. Throws if it cannot be shown; the core then calls `renderFailed`
   * and shows the error.
   */
  render(message: DocumentMessage): Promise<Rendered>;
  /** Restores a usable editor after a failed render (e.g. a fresh modeler). */
  renderFailed(message: DocumentMessage): void;
  /** The current model as the full document text. */
  serialize(): Promise<string>;
  /** SVG markup, or a PNG as base64. */
  exportImage(format: ImageFormat): Promise<string>;
  handle(message: NotationMessage): void | Promise<void>;
}

/** What the core offers the notation. */
export interface EditorApp {
  /** The model changed locally (not during `render`). */
  changed(): void;
}

/**
 * Starts the editor: `create` builds the notation, which reports local changes through the app.
 * Tells the host the webview is ready.
 */
export function startEditor(create: (app: EditorApp) => Notation): void {
  const editSync = new EditSync(() => notation.serialize());
  const notation = create({
    changed: () => {
      editSync.changed();
    },
  });

  const openAsText = {
    label: 'Open as Text',
    run: () => {
      post({ type: 'openAsText' });
    },
  };

  async function render(message: DocumentMessage): Promise<void> {
    try {
      const { elementCount, warnings } = await notation.render(message);
      editSync.rendered(message.version);
      hideOverlay();
      post({
        type: 'importResult',
        version: message.version,
        ok: true,
        elementCount,
        warnings: warnings.slice(0, LIMITS.warnings).map((warning) => bounded(warning)),
      });
    } catch (error) {
      notation.renderFailed(message);
      editSync.rendered(message.version);
      const detail = bounded(error instanceof Error ? error.message : String(error));
      showOverlay('This diagram cannot be displayed', detail, [openAsText]);
      post({ type: 'importResult', version: message.version, ok: false, error: detail });
    }
  }

  onHostMessage(async (message) => {
    switch (message.type) {
      case 'init':
      case 'update':
        await render(message);
        break;
      case 'loadRejected':
        showOverlay(
          message.reason === 'tooLarge'
            ? 'This file is too large to display'
            : 'This file was blocked',
          message.message,
          [openAsText],
        );
        break;
      case 'editResult':
        editSync.result(message.outcome, message.version);
        break;
      case 'flush':
        editSync.flush(message.requestId);
        break;
      case 'export': {
        const { requestId, format } = message;
        try {
          const data = await notation.exportImage(format);
          if (data.length > LIMITS.exportChars) throw new Error('The image is too large to export');
          post({ type: 'exported', requestId, ok: true, format, data });
        } catch (error) {
          const detail = bounded(error instanceof Error ? error.message : String(error));
          post({ type: 'exported', requestId, ok: false, error: detail });
        }
        break;
      }
      default:
        await notation.handle(message);
    }
  });

  // Leaving the editor (another tab, the text editor, the sidebar) hands over pending changes.
  window.addEventListener('blur', () => {
    void editSync.sendNow();
  });

  routeUndoRedoToHost(() => editSync.sendNow());

  post({ type: 'ready' });
}

// BPMN webview: Camunda 7 and Camunda 8 modeler with properties panel (M4), synced with the
// TextDocument (ADR 0007, 0011); undo/redo through VS Code (ADR 0012).
import '../../core/cspReport';
import './styles.css';
import C7Modeler from 'camunda-bpmn-js/lib/camunda-platform/Modeler';
import C8Modeler from 'camunda-bpmn-js/lib/camunda-cloud/Modeler';
import type Canvas from 'diagram-js/lib/core/Canvas';
import type ElementRegistry from 'diagram-js/lib/core/ElementRegistry';
import type Selection from 'diagram-js/lib/features/selection/Selection';
import type { Element as DiagramElement } from 'diagram-js/lib/model/Types';
import {
  bounded,
  LIMITS,
  type ExecutionPlatform,
  type HostToWebviewMessage,
} from '../../../shared/protocol';
import { getState, onHostMessage, post, updateState } from '../../core/bridge';
import { EditSync } from '../../core/editSync';
import { hideOverlay, showOverlay } from '../../core/overlay';
import { createSplitPane } from '../../core/splitPane';
import { routeUndoRedoToHost } from '../../core/undoRouting';

type Modeler = C8Modeler | C7Modeler;
interface Viewbox {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface PersistedState {
  viewbox?: Viewbox;
}

const app = document.getElementById('app');
if (!app) throw new Error('missing #app');
const { canvasHost, panelHost } = createSplitPane(app, 'Properties');

let modeler: Modeler | undefined;
let platform: ExecutionPlatform | undefined;
let importing = false;
let persistTimer: ReturnType<typeof setTimeout> | undefined;

const editSync = new EditSync(async () => {
  if (!modeler) throw new Error('no diagram');
  const { xml } = await modeler.saveXML({ format: true });
  if (xml === undefined) throw new Error('empty diagram');
  return xml;
});

/**
 * Creates a fresh modeler with the properties panel of the given platform. Also the recovery
 * path after a failed import (ADR 0008). Undo/redo keys never reach it (ADR 0012).
 */
function createModeler(target: ExecutionPlatform): Modeler {
  modeler?.destroy();
  const container = document.createElement('div');
  container.className = 'bizmo-canvas';
  canvasHost.replaceChildren(container);
  panelHost.replaceChildren();
  const options = {
    container,
    propertiesPanel: { parent: panelHost },
    // align-to-origin would move elements during saveXML (ADR 0008).
    disableAdjustOrigin: true,
  };
  const instance = target === 'c7' ? new C7Modeler(options) : new C8Modeler(options);
  modeler = instance;
  platform = target;

  // Copy/paste uses the system clipboard (bpmn-js-native-copy-paste); report its failures.
  instance.on('native-copy-paste:error', ({ message }: { message: string }) => {
    post({ type: 'log', level: 'warn', message: bounded(`Clipboard: ${message}`) });
  });
  instance.on('commandStack.changed', ({ trigger }: { trigger?: string }) => {
    if (!importing && trigger !== 'clear') editSync.changed();
  });
  instance.on('canvas.viewbox.changed', () => {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(persistViewbox, 250);
  });
  return instance;
}

function canvasOf(instance: Modeler): Canvas {
  return instance.get<Canvas>('canvas', true);
}

function persistViewbox(): void {
  if (!modeler) return;
  const { x, y, width, height } = canvasOf(modeler).viewbox();
  updateState({ viewbox: { x, y, width, height } } satisfies PersistedState);
}

function savedViewbox(): Viewbox | undefined {
  const state = getState() as PersistedState | undefined;
  return state?.viewbox;
}

/** Typed as strings, but bpmn-js reports import warnings as Error objects at runtime. */
function warningText(warning: unknown): string {
  return warning instanceof Error ? warning.message : String(warning);
}

async function render(
  message: Extract<HostToWebviewMessage, { type: 'init' | 'update' }>,
): Promise<void> {
  const instance =
    !modeler || platform !== message.platform ? createModeler(message.platform) : modeler;
  const previous = message.type === 'update' ? canvasOf(instance).viewbox() : savedViewbox();
  const selected =
    message.type === 'update'
      ? (instance.get<Selection>('selection', true).get() as DiagramElement[]).map((e) => e.id)
      : [];
  importing = true;
  try {
    const { warnings } = await instance.importXML(message.content);
    const canvas = canvasOf(instance);
    if (previous) {
      canvas.viewbox({
        x: previous.x,
        y: previous.y,
        width: previous.width,
        height: previous.height,
      });
    } else {
      canvas.zoom('fit-viewport');
    }
    const registry = instance.get<ElementRegistry>('elementRegistry', true);
    const stillThere = selected.flatMap((id) => {
      const element = registry.get(id) as DiagramElement | undefined;
      return element ? [element] : [];
    });
    instance.get<Selection>('selection', true).select(stillThere);
    editSync.rendered(message.version);
    hideOverlay();
    post({
      type: 'importResult',
      version: message.version,
      ok: true,
      elementCount: registry.getAll().length,
      warnings: warnings.slice(0, LIMITS.warnings).map((warning) => bounded(warningText(warning))),
    });
  } catch (error) {
    // A failed import can leave the instance unable to import later diagrams (ADR 0008).
    createModeler(message.platform);
    editSync.rendered(message.version);
    const detail = bounded(error instanceof Error ? error.message : String(error));
    showOverlay('This diagram cannot be displayed', detail, [
      {
        label: 'Open as Text',
        run: () => {
          post({ type: 'openAsText' });
        },
      },
    ]);
    post({ type: 'importResult', version: message.version, ok: false, error: detail });
  } finally {
    importing = false;
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
        [
          {
            label: 'Open as Text',
            run: () => {
              post({ type: 'openAsText' });
            },
          },
        ],
      );
      break;
    case 'editResult':
      editSync.result(message.outcome, message.version);
      break;
    case 'flush':
      editSync.flush(message.requestId);
      break;
  }
});

// Leaving the editor (another tab, the text editor, the sidebar) hands over pending changes.
window.addEventListener('blur', () => {
  void editSync.sendNow();
});

routeUndoRedoToHost(() => editSync.sendNow());

post({ type: 'ready' });

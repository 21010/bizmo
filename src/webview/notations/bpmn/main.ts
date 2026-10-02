// BPMN webview (M2: read-only viewer for Camunda 7 and Camunda 8 diagrams).
import '../../core/cspReport';
import './styles.css';
import C7Viewer from 'camunda-bpmn-js/lib/camunda-platform/NavigatedViewer';
import C8Viewer from 'camunda-bpmn-js/lib/camunda-cloud/NavigatedViewer';
import type Canvas from 'diagram-js/lib/core/Canvas';
import type ElementRegistry from 'diagram-js/lib/core/ElementRegistry';
import {
  bounded,
  LIMITS,
  type ExecutionPlatform,
  type HostToWebviewMessage,
} from '../../../shared/protocol';
import { getState, onHostMessage, post, setState } from '../../core/bridge';
import { hideOverlay, showOverlay } from '../../core/overlay';

type Viewer = C8Viewer | C7Viewer;
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

let viewer: Viewer | undefined;
let platform: ExecutionPlatform | undefined;
let persistTimer: ReturnType<typeof setTimeout> | undefined;

/** Creates a fresh viewer. Also the recovery path after a failed import (ADR 0008). */
function createViewer(target: ExecutionPlatform): Viewer {
  viewer?.destroy();
  const container = document.createElement('div');
  container.className = 'bizmo-canvas';
  app?.replaceChildren(container);
  viewer = target === 'c7' ? new C7Viewer({ container }) : new C8Viewer({ container });
  platform = target;
  viewer.on('canvas.viewbox.changed', () => {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(persistViewbox, 250);
  });
  return viewer;
}

function canvasOf(instance: Viewer): Canvas {
  return instance.get<Canvas>('canvas', true);
}

function persistViewbox(): void {
  if (!viewer) return;
  const { x, y, width, height } = canvasOf(viewer).viewbox();
  setState({ viewbox: { x, y, width, height } } satisfies PersistedState);
}

/** Typed as strings, but bpmn-js reports import warnings as Error objects at runtime. */
function warningText(warning: unknown): string {
  return warning instanceof Error ? warning.message : String(warning);
}

function savedViewbox(): Viewbox | undefined {
  const state = getState() as PersistedState | undefined;
  return state?.viewbox;
}

async function render(
  message: Extract<HostToWebviewMessage, { type: 'init' | 'update' }>,
): Promise<void> {
  const instance =
    !viewer || platform !== message.platform ? createViewer(message.platform) : viewer;
  const previous = message.type === 'update' ? canvasOf(instance).viewbox() : savedViewbox();
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
    hideOverlay();
    post({
      type: 'importResult',
      version: message.version,
      ok: true,
      elementCount: instance.get<ElementRegistry>('elementRegistry', true).getAll().length,
      warnings: warnings.slice(0, LIMITS.warnings).map((warning) => bounded(warningText(warning))),
    });
  } catch (error) {
    // A failed import can leave the instance unable to import later diagrams (ADR 0008).
    createViewer(message.platform);
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
  }
});

post({ type: 'ready' });

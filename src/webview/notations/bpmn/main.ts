// BPMN webview: Camunda 7 and Camunda 8 modeler with properties panel (M4), synced with the
// TextDocument (ADR 0007, 0011); undo/redo through VS Code (ADR 0012).
import '../../core/cspReport';
import './styles.css';
import C7Modeler from 'camunda-bpmn-js/lib/camunda-platform/Modeler';
import C8Modeler from 'camunda-bpmn-js/lib/camunda-cloud/Modeler';
import lintingModule from '@camunda/linting/modeler';
import type Canvas from 'diagram-js/lib/core/Canvas';
import type ElementRegistry from 'diagram-js/lib/core/ElementRegistry';
import type Selection from 'diagram-js/lib/features/selection/Selection';
import type { Element as DiagramElement } from 'diagram-js/lib/model/Types';
import { bounded, LIMITS, type ExecutionPlatform } from '../../../shared/protocol';
import { getState, post, updateState } from '../../core/bridge';
import {
  startEditor,
  type DocumentMessage,
  type EditorApp,
  type Rendered,
} from '../../core/editorApp';
import { createSplitPane } from '../../core/splitPane';
import { exportImage } from './imageExport';
import { DiagramLinter } from './lint';

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
/** Latest workspace element templates from the host (ADR 0010, D4); empty in Restricted Mode. */
let templates: Record<ExecutionPlatform, object[]> = { c7: [], c8: [] };

interface ElementTemplatesLoader {
  setTemplates(templates: object[]): void;
}

/** Hands the templates for the modeler's platform to its loader, which validates them. */
function applyTemplates(instance: Modeler, target: ExecutionPlatform): void {
  instance
    .get<ElementTemplatesLoader>('elementTemplatesLoader', true)
    .setTemplates(templates[target]);
}

/** The validator's messages already name the template (`template(id: <…>, name: <…>): …`). */
const describeTemplateProblem = (problem: unknown): string =>
  bounded(problem instanceof Error ? problem.message : String(problem));

const linter = new DiagramLinter(
  (problems) => {
    post({ type: 'lint', problems });
  },
  (message) => {
    post({ type: 'log', level: 'warn', message: bounded(message) });
  },
);

let editor: EditorApp | undefined;

/**
 * Creates a fresh modeler with the properties panel of the given platform. Also the recovery
 * path after a failed import (ADR 0008). Undo/redo keys never reach it (ADR 0012).
 */
function createModeler(target: ExecutionPlatform): Modeler {
  // A lint scheduled for the old modeler must not run on the destroyed instance.
  linter.cancel();
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
    additionalModules: [lintingModule],
  };
  const instance = target === 'c7' ? new C7Modeler(options) : new C8Modeler(options);
  modeler = instance;
  platform = target;

  // Invalid templates are skipped by the loader; report why.
  instance.on('elementTemplates.errors', ({ errors }: { errors: unknown[] }) => {
    post({
      type: 'templateErrors',
      messages: errors.slice(0, LIMITS.warnings).map(describeTemplateProblem),
    });
  });
  applyTemplates(instance, target);

  // Copy/paste uses the system clipboard (bpmn-js-native-copy-paste); report its failures.
  instance.on('native-copy-paste:error', ({ message }: { message: string }) => {
    post({ type: 'log', level: 'warn', message: bounded(`Clipboard: ${message}`) });
  });
  instance.on('commandStack.changed', ({ trigger }: { trigger?: string }) => {
    if (importing || trigger === 'clear') return;
    editor?.changed();
    linter.schedule(instance, target);
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
  const viewbox = { x, y, width, height };
  // A hidden canvas reports a meaningless viewbox; keep the last good one.
  if (isUsableViewbox(viewbox)) updateState({ viewbox } satisfies PersistedState);
}

function savedViewbox(): Viewbox | undefined {
  const state = getState() as PersistedState | undefined;
  return state?.viewbox;
}

const isUsableViewbox = (box: Viewbox | undefined): box is Viewbox =>
  box !== undefined &&
  [box.x, box.y, box.width, box.height].every(Number.isFinite) &&
  box.width > 0 &&
  box.height > 0;

let pendingFit: ResizeObserver | undefined;

const FIT_MARGIN = 16;

/**
 * Like `zoom('fit-viewport')`, but keeps the diagram clear of what the modeler draws over the
 * canvas: the palette (left) and the minimap toggle (top). In small editors fit-viewport would put
 * the first elements underneath them. Never zooms in beyond 100%.
 */
function fitClearOfOverlays(canvas: Canvas, container: Element): void {
  const { inner } = canvas.viewbox();
  const area = container.getBoundingClientRect();
  const palette = container.querySelector('.djs-palette')?.getBoundingClientRect();
  const minimap = container.querySelector('.djs-minimap')?.getBoundingClientRect();
  const left = (palette ? Math.max(0, palette.right - area.left) : 0) + FIT_MARGIN;
  const top = (minimap ? Math.max(0, minimap.bottom - area.top) : 0) + FIT_MARGIN;
  const width = area.width - left - FIT_MARGIN;
  const height = area.height - top - FIT_MARGIN;
  if (inner.width <= 0 || inner.height <= 0 || width < 80 || height < 80) {
    canvas.zoom('fit-viewport');
    return;
  }
  const scale = Math.min(1, width / inner.width, height / inner.height);
  canvas.viewbox({
    x: inner.x - left / scale,
    y: inner.y - top / scale,
    width: area.width / scale,
    height: area.height / scale,
  });
}

/**
 * Restores the previous viewport or fits the diagram. Never fails the import: a zero-sized canvas
 * (hidden or very narrow editor) makes diagram-js compute non-finite scales, so fitting waits
 * until the canvas has a size.
 */
function showViewport(instance: Modeler, previous: Viewbox | undefined): void {
  pendingFit?.disconnect();
  pendingFit = undefined;
  const canvas = canvasOf(instance);
  const container = canvasHost.firstElementChild ?? canvasHost;
  const apply = () => {
    try {
      if (isUsableViewbox(previous)) {
        canvas.viewbox({
          x: previous.x,
          y: previous.y,
          width: previous.width,
          height: previous.height,
        });
      } else {
        fitClearOfOverlays(canvas, container);
      }
    } catch (error) {
      post({ type: 'log', level: 'warn', message: bounded(`Viewport: ${String(error)}`) });
    }
  };
  const hasSize = () => container.clientWidth > 0 && container.clientHeight > 0;
  if (hasSize()) {
    apply();
    return;
  }
  pendingFit = new ResizeObserver(() => {
    if (!hasSize()) return;
    pendingFit?.disconnect();
    pendingFit = undefined;
    instance.get<Canvas>('canvas', true).resized();
    apply();
  });
  pendingFit.observe(container);
}

/** Typed as strings, but bpmn-js reports import warnings as Error objects at runtime. */
function warningText(warning: unknown): string {
  return warning instanceof Error ? warning.message : String(warning);
}

async function render(message: DocumentMessage): Promise<Rendered> {
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
    showViewport(instance, previous);
    const registry = instance.get<ElementRegistry>('elementRegistry', true);
    const stillThere = selected.flatMap((id) => {
      const element = registry.get(id) as DiagramElement | undefined;
      return element ? [element] : [];
    });
    instance.get<Selection>('selection', true).select(stillThere);
    linter.schedule(instance, message.platform);
    return { elementCount: registry.getAll().length, warnings: warnings.map(warningText) };
  } finally {
    importing = false;
  }
}

startEditor((editorApp) => {
  editor = editorApp;
  return {
    render,
    // A failed import can leave the instance unable to import later diagrams (ADR 0008).
    renderFailed: (message) => {
      linter.clear(createModeler(message.platform));
    },
    serialize: async () => {
      if (!modeler) throw new Error('no diagram');
      const { xml } = await modeler.saveXML({ format: true });
      if (xml === undefined) throw new Error('empty diagram');
      return xml;
    },
    exportImage: (format) => {
      if (!modeler) throw new Error('No diagram is shown');
      return exportImage(modeler, format);
    },
    handle: (message) => {
      switch (message.type) {
        case 'settings':
          linter.setEnabled(message.linting, modeler, platform);
          break;
        case 'reveal':
          if (modeler) linter.reveal(modeler, message.elementId);
          break;
        case 'templates':
          templates = { c7: message.c7, c8: message.c8 };
          if (modeler && platform) applyTemplates(modeler, platform);
          break;
      }
    },
  };
});

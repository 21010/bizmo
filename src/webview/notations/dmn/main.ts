// DMN webview (ADR 0014): Camunda 7 and Camunda 8 DMN modeler (camunda-dmn-js) on the shared editor
// core, synced with the TextDocument (ADR 0007, 0011); undo/redo through VS Code (ADR 0012).
import '../../core/cspReport';
import './styles.css';
import { migrateDiagram } from '@bpmn-io/dmn-migrate';
import {
  CamundaCloudModeler,
  CamundaPlatformModeler,
  type DmnView,
  type DmnViewer,
} from 'camunda-dmn-js';
import type BaseViewer from 'bpmn-js/lib/BaseViewer';
import type Canvas from 'diagram-js/lib/core/Canvas';
import { oldDmnVersion } from '../../../shared/dmn/version';
import { bounded, type ExecutionPlatform } from '../../../shared/protocol';
import { getState, post, updateState } from '../../core/bridge';
import {
  startEditor,
  type DocumentMessage,
  type EditorApp,
  type Rendered,
} from '../../core/editorApp';
import { hideNotice, showNotice } from '../../core/notice';
import { createSplitPane } from '../../core/splitPane';
import { exportImage } from '../bpmn/imageExport';

type Modeler = CamundaCloudModeler | CamundaPlatformModeler;

interface Viewbox {
  x: number;
  y: number;
  width: number;
  height: number;
}
/** What survives the webview being hidden and recreated (tab switches). */
interface PersistedState {
  /** The active view: the DRD, or a decision's table or expression. */
  view?: { type: string; id: string };
  drdViewbox?: Viewbox;
}

const app = document.getElementById('app');
if (!app) throw new Error('missing #app');
const { canvasHost, panelHost, setPanelAvailable } = createSplitPane(app, 'Properties');

let modeler: Modeler | undefined;
let platform: ExecutionPlatform | undefined;
let importing = false;
let editor: EditorApp | undefined;
let persistTimer: ReturnType<typeof setTimeout> | undefined;

const isUsableViewbox = (box: Viewbox | undefined): box is Viewbox =>
  box !== undefined &&
  [box.x, box.y, box.width, box.height].every(Number.isFinite) &&
  box.width > 0 &&
  box.height > 0;

/** The DRD's canvas, while the DRD is the active view. */
function drdCanvas(instance: Modeler): Canvas | undefined {
  if (instance.getActiveView()?.type !== 'drd') return undefined;
  return instance.getActiveViewer()?.get('canvas');
}

function persistDrdViewbox(): void {
  const canvas = modeler && drdCanvas(modeler);
  if (!canvas) return;
  const { x, y, width, height } = canvas.viewbox();
  const drdViewbox = { x, y, width, height };
  // A hidden canvas reports a meaningless viewbox; keep the last good one.
  if (isUsableViewbox(drdViewbox)) updateState({ drdViewbox } satisfies PersistedState);
}

function restoreDrdViewbox(instance: Modeler, viewbox: Viewbox | undefined): void {
  const canvas = drdCanvas(instance);
  if (!canvas || !isUsableViewbox(viewbox)) return;
  try {
    canvas.viewbox(viewbox);
  } catch (error) {
    post({ type: 'log', level: 'warn', message: bounded(`Viewport: ${String(error)}`) });
  }
}

/** Only the DRD has a properties panel (camunda-dmn-js); other views use the full width. */
function viewChanged(view: DmnView | undefined): void {
  setPanelAvailable(view?.type === 'drd');
  if (!importing && view) {
    updateState({ view: { type: view.type, id: view.element.id } } satisfies PersistedState);
  }
}

/**
 * Creates a fresh modeler for the platform. Also the recovery path after a failed import, as for
 * BPMN (ADR 0008).
 */
function createModeler(target: ExecutionPlatform): Modeler {
  modeler?.destroy();
  const container = document.createElement('div');
  container.className = 'bizmo-canvas';
  canvasHost.replaceChildren(container);
  panelHost.replaceChildren();
  const options = {
    container,
    // align-to-origin would move elements during saveXML (ADR 0008).
    drd: { propertiesPanel: { parent: panelHost }, disableAdjustOrigin: true },
  };
  const instance =
    target === 'c7' ? new CamundaPlatformModeler(options) : new CamundaCloudModeler(options);
  modeler = instance;
  platform = target;

  // Each view type has its own viewer and command stack (ADR 0014, decision 5).
  instance.on('viewer.created', ({ viewer }: { viewer: DmnViewer }) => {
    viewer.on('commandStack.changed', ({ trigger }: { trigger?: string }) => {
      if (importing || trigger === 'clear') return;
      editor?.changed();
    });
    viewer.on('canvas.viewbox.changed', () => {
      clearTimeout(persistTimer);
      persistTimer = setTimeout(persistDrdViewbox, 250);
    });
  });
  instance.on('views.changed', ({ activeView }: { activeView?: DmnView }) => {
    viewChanged(activeView);
  });
  return instance;
}

/** The table cell or expression being edited, by element id (cells are re-rendered on import). */
function focusedCellId(): string | undefined {
  const cell = document.activeElement?.closest('td[data-element-id]');
  return cell?.getAttribute('data-element-id') ?? undefined;
}

/**
 * Puts the caret back at the end of the cell edited before a re-import, so undo/redo from a cell
 * (ADR 0012) does not leave the keyboard without a target.
 */
function refocusCell(id: string | undefined): void {
  if (!id) return;
  const cell = [...document.querySelectorAll('td[data-element-id]')].find(
    (candidate) => candidate.getAttribute('data-element-id') === id,
  );
  const editable = cell?.querySelector<HTMLElement>('[contenteditable="true"]');
  if (!editable) return;
  editable.focus();
  const selection = window.getSelection();
  selection?.selectAllChildren(editable);
  selection?.collapseToEnd();
}

function savedState(): PersistedState {
  return (getState() as PersistedState | undefined) ?? {};
}

function findView(instance: Modeler, saved: PersistedState['view']): DmnView | undefined {
  if (!saved) return undefined;
  return instance.getViews().find((v) => v.type === saved.type && v.element.id === saved.id);
}

async function render(message: DocumentMessage): Promise<Rendered> {
  const instance =
    !modeler || platform !== message.platform ? createModeler(message.platform) : modeler;
  const previousViewbox =
    message.type === 'update' ? drdCanvas(instance)?.viewbox() : savedState().drdViewbox;
  const editedCell = message.type === 'update' ? focusedCellId() : undefined;
  importing = true;
  try {
    // dmn-js opens only DMN 1.3. Older files are migrated for display; the document changes only
    // with the user's first change (ADR 0014, decision 4).
    const version = oldDmnVersion(message.content);
    const xml = version ? await migrateDiagram(message.content) : message.content;
    // dmn-js reopens the previously active view on re-import; on init, restore the saved one.
    const { warnings } = await instance.importXML(xml);
    const restore = message.type === 'init' ? findView(instance, savedState().view) : undefined;
    if (restore) await instance.open(restore);
    restoreDrdViewbox(instance, previousViewbox);
    viewChanged(instance.getActiveView());
    refocusCell(editedCell);
    if (version) {
      showNotice(
        `This file uses DMN ${version}. Bizmo shows it as DMN 1.3; your first change saves it as DMN 1.3.`,
      );
    } else {
      hideNotice();
    }
    return {
      elementCount: instance.getDefinitions()?.drgElement?.length ?? 0,
      warnings: warnings.map((w) => (w instanceof Error ? w.message : String(w))),
    };
  } finally {
    importing = false;
  }
}

startEditor((editorApp) => {
  editor = editorApp;
  return {
    render,
    renderFailed: (message) => {
      hideNotice();
      createModeler(message.platform);
    },
    serialize: async () => {
      if (!modeler) throw new Error('no diagram');
      const { xml } = await modeler.saveXML({ format: true });
      if (xml === undefined) throw new Error('empty diagram');
      return xml;
    },
    // Only the DRD is a diagram; tables and expressions have no image (ADR 0014, decision 7).
    exportImage: (format) => {
      if (!modeler) throw new Error('No diagram is shown');
      // dmn-js always has a DRD view; without diagram interchange it has nothing to draw.
      if (!modeler.getDefinitions()?.dmnDI?.diagrams?.length) {
        throw new Error('This file has no decision requirements diagram to export.');
      }
      const viewer = modeler.getActiveViewer();
      if (modeler.getActiveView()?.type !== 'drd' || !viewer?.saveSVG) {
        throw new Error('Switch to the decision requirements diagram to export an image.');
      }
      return exportImage(viewer as unknown as BaseViewer, format);
    },
    // DMN has no settings, templates, or lint problems to reveal (yet: #17).
    handle: () => undefined,
  };
});

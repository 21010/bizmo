// DMN webview (ADR 0014, prototype): Camunda 7 and Camunda 8 DMN modeler on the shared editor core.
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
import { bounded, type ExecutionPlatform } from '../../../shared/protocol';
import { getState, post, updateState } from '../../core/bridge';
import {
  startEditor,
  type DocumentMessage,
  type EditorApp,
  type Rendered,
} from '../../core/editorApp';
import { createSplitPane } from '../../core/splitPane';
import { exportImage } from '../bpmn/imageExport';

type Modeler = CamundaCloudModeler | CamundaPlatformModeler;

interface SavedView {
  type: string;
  id: string;
}
interface PersistedState {
  view?: SavedView;
}

/** Namespaces of the DMN versions dmn-js cannot open; migrated to DMN 1.3 before import. */
const OLD_DMN =
  /xmlns(?::\w+)?\s*=\s*["']http:\/\/www\.omg\.org\/spec\/DMN\/(20151101\/dmn\.xsd|20180521\/MODEL\/)["']/;

const app = document.getElementById('app');
if (!app) throw new Error('missing #app');
const { canvasHost, panelHost } = createSplitPane(app, 'Properties');

let modeler: Modeler | undefined;
let platform: ExecutionPlatform | undefined;
let importing = false;
let editor: EditorApp | undefined;

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
  });
  instance.on('views.changed', ({ activeView }: { activeView?: DmnView }) => {
    if (importing || !activeView) return;
    updateState({
      view: { type: activeView.type, id: activeView.element.id },
    } satisfies PersistedState);
  });
  return instance;
}

function savedView(instance: Modeler): DmnView | undefined {
  const saved = (getState() as PersistedState | undefined)?.view;
  if (!saved) return undefined;
  return instance.getViews().find((v) => v.type === saved.type && v.element.id === saved.id);
}

async function render(message: DocumentMessage): Promise<Rendered> {
  const instance =
    !modeler || platform !== message.platform ? createModeler(message.platform) : modeler;
  importing = true;
  try {
    let xml = message.content;
    const old = OLD_DMN.exec(xml);
    if (old) {
      xml = await migrateDiagram(xml);
      post({
        type: 'log',
        level: 'info',
        message: `Migrated DMN ${old[1]?.startsWith('2015') ? '1.1' : '1.2'} to DMN 1.3 for display`,
      });
    }
    // dmn-js reopens the previously active view on re-import; on init, restore the saved one.
    const { warnings } = await instance.importXML(xml);
    const restore = message.type === 'init' ? savedView(instance) : undefined;
    if (restore) await instance.open(restore);
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
      createModeler(message.platform);
    },
    serialize: async () => {
      if (!modeler) throw new Error('no diagram');
      const { xml } = await modeler.saveXML({ format: true });
      if (xml === undefined) throw new Error('empty diagram');
      return xml;
    },
    exportImage: (format) => {
      const viewer = modeler?.getActiveViewer();
      if (modeler?.getActiveView()?.type !== 'drd' || !viewer?.saveSVG) {
        throw new Error('Switch to the decision requirements diagram to export an image.');
      }
      return exportImage(viewer as unknown as BaseViewer, format);
    },
    handle: (message) => {
      if (message.type === 'settings' || message.type === 'templates') return;
      post({ type: 'log', level: 'warn', message: bounded(`Unexpected message ${message.type}`) });
    },
  };
});

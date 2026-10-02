// M1 spike webview: camunda-bpmn-js modeler synced with a VS Code TextDocument.
import C8Modeler from 'camunda-bpmn-js/lib/camunda-cloud/Modeler';
import C7Modeler from 'camunda-bpmn-js/lib/camunda-platform/Modeler';
import '../harness/c8-styles.css';

const vscode = acquireVsCodeApi();
let modeler = null;
let platform = null;
let version = -1;
let importing = false;
let debounce = null;
let swallowUndo = true;
// Observable from Playwright (S4).
window.__spikeStats = { editsPosted: 0, imports: 0, swallowed: 0, bpmnUndos: 0, errors: [] };

const isC7 = (xml) => /executionPlatform="Camunda Platform"/.test(xml);

function create(forC7) {
  if (modeler) modeler.destroy();
  const Modeler = forC7 ? C7Modeler : C8Modeler;
  modeler = new Modeler({
    container: '#canvas',
    propertiesPanel: { parent: '#properties' },
    disableAdjustOrigin: true, // align-to-origin mutates the diagram on saveXML (spike S3)
  });
  platform = forC7 ? 'c7' : 'c8';

  // S4: VS Code owns undo/redo. Swallow bpmn-js' own Ctrl/Cmd+Z/Y bindings so one keystroke
  // does not undo twice; the forwarded keydown makes VS Code undo the document instead.
  modeler.get('keyboard').addListener(10000, ({ keyEvent }) => {
    const mod = keyEvent.ctrlKey || keyEvent.metaKey;
    const k = keyEvent.key.toLowerCase();
    if (swallowUndo && mod && (k === 'z' || k === 'y')) {
      window.__spikeStats.swallowed += 1;
      vscode.postMessage({ type: 'key', key: `${keyEvent.shiftKey ? 'shift+' : ''}mod+${k} swallowed` });
      return true;
    }
    // Return undefined (not false): in diagram-js' EventBus, returning false cancels the event
    // and would block every other keyboard binding.
    return undefined;
  });

  modeler.on('native-copy-paste:error', ({ message, error }) => {
    window.__spikeStats.errors.push(`${message}: ${error && error.message ? error.message : error}`);
  });

  modeler.on('commandStack.changed', ({ trigger }) => {
    if (trigger === 'undo') window.__spikeStats.bpmnUndos += 1;
    if (importing || trigger === 'clear') return;
    clearTimeout(debounce);
    debounce = setTimeout(async () => {
      const { xml } = await modeler.saveXML({ format: true });
      window.__spikeStats.editsPosted += 1;
      vscode.postMessage({ type: 'edit', xml, baseVersion: version });
    }, 300);
  });
}

async function load(xml, newVersion, preserveView, reason) {
  const wantC7 = isC7(xml);
  if (!modeler || (wantC7 ? 'c7' : 'c8') !== platform) create(wantC7);
  clearTimeout(debounce);
  importing = true;
  const view = preserveView ? modeler.get('canvas').viewbox() : null;
  const start = performance.now();
  try {
    await modeler.importXML(xml);
    if (view) modeler.get('canvas').viewbox({ x: view.x, y: view.y, width: view.width, height: view.height });
    version = newVersion;
    window.__spikeStats.imports += 1;
    vscode.postMessage({
      type: 'imported',
      reason,
      version: newVersion,
      ms: Math.round(performance.now() - start),
      elements: modeler.get('elementRegistry').getAll().length,
      viewRestored: view ? Math.abs(modeler.get('canvas').viewbox().scale - view.scale) < 0.001 : null,
    });
  } catch (error) {
    create(wantC7); // a failed import can poison the instance (spike S1)
    version = newVersion;
    vscode.postMessage({ type: 'imported', reason, version: newVersion, error: String(error.message || error) });
  } finally {
    importing = false;
  }
}

window.addEventListener('message', async ({ data }) => {
  if (typeof data.swallowUndo === 'boolean') swallowUndo = data.swallowUndo;
  if (data.type === 'init') await load(data.xml, data.version, false, 'init');
  if (data.type === 'update') await load(data.xml, data.version, true, 'update');
  if (data.type === 'op' && data.op === 'appendTask') {
    const registry = modeler.get('elementRegistry');
    const source = registry.filter((e) => e.type === 'bpmn:StartEvent')[0];
    modeler.get('autoPlace').append(source, modeler.get('elementFactory').createShape({ type: 'bpmn:Task' }));
  }
  if (data.type === 'op' && data.op === 'zoom') modeler.get('canvas').zoom(0.6);
});

window.__spike = { get modeler() { return modeler; } };
window.addEventListener('error', (e) => vscode.postMessage({ type: 'error', message: e.message }));
window.addEventListener('unhandledrejection', (e) => vscode.postMessage({ type: 'error', message: String(e.reason) }));
window.__reportViolation = (violation) => vscode.postMessage({ type: 'violation', violation });
vscode.postMessage({ type: 'ready' });

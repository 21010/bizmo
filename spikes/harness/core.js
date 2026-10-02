// Spike harness: exposes window.spike for Playwright to drive a camunda-bpmn-js modeler.
// Throwaway spike code (M1); not shipped.

export function createSpike(Modeler, platform) {
  const create = () => new Modeler({
    container: '#canvas',
    propertiesPanel: { parent: '#properties' },
    disableAdjustOrigin: new URLSearchParams(location.search).has('noAlign'),
  });
  let modeler = create();

  const get = (name) => {
    try {
      return modeler.get(name);
    } catch {
      return null;
    }
  };

  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  const spike = {
    platform,
    get modeler() {
      return modeler;
    },
    get,

    // Recovery path: destroy the instance and build a new one in the same containers.
    recreate() {
      modeler.destroy();
      modeler = create();
    },

    async importXML(xml) {
      const start = performance.now();
      const result = await modeler.importXML(xml);
      return { ms: performance.now() - start, warnings: result.warnings.map((w) => String(w.message)) };
    },

    async saveXML() {
      return (await modeler.saveXML({ format: true })).xml;
    },

    async saveSVG() {
      return (await modeler.saveSVG()).svg.length;
    },

    elementCount() {
      return get('elementRegistry').getAll().length;
    },

    // Re-import as a text-backed editor would after an external change or a document undo.
    async reimportPreservingView(xml) {
      const canvas = get('canvas');
      const selection = get('selection');
      const viewbox = canvas.viewbox();
      const selectedIds = selection.get().map((e) => e.id);
      const start = performance.now();
      await modeler.importXML(xml);
      canvas.viewbox({ x: viewbox.x, y: viewbox.y, width: viewbox.width, height: viewbox.height });
      const registry = get('elementRegistry');
      selection.select(selectedIds.map((id) => registry.get(id)).filter(Boolean));
      const ms = performance.now() - start;
      const after = canvas.viewbox();
      return {
        ms,
        viewboxRestored: Math.abs(after.x - viewbox.x) < 1 && Math.abs(after.scale - viewbox.scale) < 0.001,
        selectionRestored: selection.get().length === selectedIds.length,
      };
    },

    // Exercise UI code paths that may inject styles, use eval, or touch browser APIs.
    async exercise() {
      const log = [];
      const step = async (name, fn) => {
        try {
          await fn();
          await tick();
          log.push({ name, ok: true });
        } catch (error) {
          log.push({ name, ok: false, error: String(error && error.message ? error.message : error) });
        }
      };

      const registry = get('elementRegistry');
      const elements = registry.filter((e) => !e.labelTarget && e.type !== 'bpmn:Process' && e.parent);
      const first = elements.find((e) => e.type.endsWith('Task')) || elements[0];

      await step('select elements (properties panel renders)', async () => {
        for (const element of elements.slice(0, 40)) {
          get('selection').select(element);
          await tick();
        }
      });
      await step('context pad', () => get('contextPad').open(first));
      await step('replace popup menu', () => get('popupMenu').open(first, 'bpmn-replace', { x: 100, y: 100 }));
      await step('close popup', () => get('popupMenu').close());
      await step('color picker popup', () => {
        get('popupMenu').open(first, 'color-picker', { x: 100, y: 100 });
        get('popupMenu').close();
      });
      await step('create + append + connect', () => {
        const modeling = get('modeling');
        const elementFactory = get('elementFactory');
        const root = get('canvas').getRootElement();
        const task = modeling.createShape(elementFactory.createShape({ type: 'bpmn:ServiceTask' }), { x: 50, y: 50 }, root);
        get('autoPlace').append(task, elementFactory.createShape({ type: 'bpmn:UserTask' }));
      });
      await step('direct editing (contenteditable)', () => {
        get('directEditing').activate(first);
        get('directEditing').complete();
      });
      await step('search', () => {
        const search = get('searchPad');
        if (search) {
          search.toggle();
          search.toggle();
        }
      });
      await step('create-append-anything popup', () => {
        get('popupMenu').open(first, 'bpmn-append', { x: 100, y: 100 });
        get('popupMenu').close();
      });
      await step('element template chooser', () => {
        const templates = get('elementTemplates');
        const chooser = get('elementTemplateChooser');
        if (templates && chooser) {
          void chooser.open(first);
        }
      });
      await step('undo / redo (command stack)', () => {
        get('commandStack').undo();
        get('commandStack').redo();
      });
      await step('copy / paste (API)', () => {
        get('copyPaste').copy([first]);
        get('copyPaste').paste({ element: get('canvas').getRootElement(), point: { x: 300, y: 300 } });
      });
      await step('zoom', () => get('canvas').zoom('fit-viewport'));
      await step('saveSVG', async () => {
        await spike.saveSVG();
      });
      return log;
    },
  };

  window.spike = spike;
  window.spikeReady = true;
}

# Upstream report draft: failed import breaks all later imports (bpmn-js-properties-panel)

- Target repository: https://github.com/bpmn-io/bpmn-js-properties-panel
- Status: **filed 2026-10-03** as [bpmn-js-properties-panel#1256](https://github.com/bpmn-io/bpmn-js-properties-panel/issues/1256); fix and regression test in [PR #1257](https://github.com/bpmn-io/bpmn-js-properties-panel/pull/1257) (awaiting CLA signature and maintainer review).
- Found by: Bizmo M1 spike S1; reproduced with self-written diagrams (`spikes/upstream-repro/`).
- Bizmo workaround (stays in place either way): recreate the modeler after a failed import (ADR 0008).

---

## Issue title

Failed `importXML` leaves the properties panel holding the implicit root; every later import fails with "businessObject.get is not a function"

## Issue body

### Describe the Bug

After one `importXML` call fails (for example, a diagram whose plane references the process by an unresolvable ID), every following `importXML` on the same modeler fails with:

```
TypeError: businessObject.get is not a function
```

even for valid diagrams. `modeler.clear()` does not help; only destroying and recreating the modeler recovers.

### Steps to Reproduce

Self-contained page (published packages only, no Camunda modeler distribution): bpmn-js 18.31.0, bpmn-js-properties-panel 5.65.1 with `BpmnPropertiesPanelModule` + `BpmnPropertiesProviderModule` (+ optionally `ZeebePropertiesProviderModule`).

1. Import a valid diagram.
2. Wait a moment (the panel's `import.done` listener is registered after its first render).
3. Import an invalid diagram — fails as expected (`no diagram to display`).
4. Import a valid diagram — **fails** with `businessObject.get is not a function`, and so does every later import.

<details>
<summary>repro.html</summary>

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="https://unpkg.com/bpmn-js@18.31.0/dist/assets/diagram-js.css" />
    <link rel="stylesheet" href="https://unpkg.com/bpmn-js@18.31.0/dist/assets/bpmn-js.css" />
    <link
      rel="stylesheet"
      href="https://unpkg.com/@bpmn-io/properties-panel@3.56.1/dist/assets/properties-panel.css"
    />
    <style>
      body {
        display: flex;
        margin: 0;
        font-family: sans-serif;
      }
      #canvas {
        flex: 1;
        height: 400px;
      }
      #properties {
        width: 300px;
      }
      #log {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        padding: 8px;
        background: #eee;
        white-space: pre;
      }
    </style>
  </head>
  <body>
    <div id="canvas"></div>
    <div id="properties"></div>
    <pre id="log"></pre>
    <script src="https://unpkg.com/bpmn-js@18.31.0/dist/bpmn-modeler.development.js"></script>
    <script src="https://unpkg.com/bpmn-js-properties-panel@5.65.1/dist/bpmn-js-properties-panel.umd.js"></script>
    <script>
      const { BpmnPropertiesPanelModule, BpmnPropertiesProviderModule } =
        window.BpmnJSPropertiesPanel;

      const NS =
        'xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"';

      const valid = (id) => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${NS} id="Definitions_${id}" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="${id}" isExecutable="true"><bpmn:startEvent id="Start_${id}" /></bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram_${id}">
    <bpmndi:BPMNPlane id="Plane_${id}" bpmnElement="${id}">
      <bpmndi:BPMNShape id="Start_${id}_di" bpmnElement="Start_${id}"><dc:Bounds x="100" y="100" width="36" height="36" /></bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

      // The plane references the process by an ID with spaces, so the import fails (expected).
      const invalid = valid('Process_{{ ID:process }}');

      const log = (line) => {
        console.log(line);
        document.getElementById('log').textContent += line + '\n';
      };

      async function main() {
        const modeler = new BpmnJS({
          container: '#canvas',
          propertiesPanel: { parent: '#properties' },
          additionalModules: [BpmnPropertiesPanelModule, BpmnPropertiesProviderModule],
        });

        const importXML = async (label, xml) => {
          try {
            await modeler.importXML(xml);
            log(`${label}: ok`);
          } catch (error) {
            log(`${label}: FAILED - ${error.message}`);
          }
        };

        await importXML('1. valid diagram A', valid('A'));
        await new Promise((resolve) => setTimeout(resolve, 300));
        await importXML('2. invalid diagram (expected to fail)', invalid);
        await importXML('3. valid diagram B', valid('B'));
        await importXML('4. valid diagram C', valid('C'));
      }

      main();
    </script>
  </body>
</html>
```

</details>

Output:

```
1. valid diagram A: ok
2. invalid diagram (expected to fail): FAILED - no diagram to display
3. valid diagram B: FAILED - businessObject.get is not a function
4. valid diagram C: FAILED - businessObject.get is not a function
```

The same happens with `ZeebePropertiesProviderModule` added (stack through the Zeebe `TimerProps` → `getTimerEventDefinition`) and in the Camunda 8 modeler distribution (`camunda-bpmn-js` 5.36.0).

### Expected Behavior

A failed import does not affect later imports: step 3 and 4 import successfully.

### Root cause

`src/render/BpmnPropertiesPanel.js` (at `19b6ff8`), effect `(2c) import done`:

```js
const onImportDone = () => {
  const rootElement = canvas.getRootElement();

  _update(rootElement);
};
```

`import.done` is also fired when the import **failed**. The canvas then has no root, so `canvas.getRootElement()` creates an implicit root (`__implicitroot_*`, no `businessObject`), and `_update` stores it as `selectedElement`.

On the next import, `root.added` → `BpmnPropertiesPanelRenderer#_render(newRoot)` re-renders the mounted component, which still holds the implicit root as `selectedElement`. Providers then call `getBusinessObject(element).get(...)` on it (e.g. timer props), which throws inside the import, so the import fails — and `import.done` stores the implicit root again, so the state never recovers.

The other handlers already guard against this: `onSelectionChanged` (effect `2a`) returns early for `isImplicitRoot(rootElement)`, and `_render` does the same.

### Proposed fix

```diff
     const onImportDone = () => {
       const rootElement = canvas.getRootElement();

+      if (isImplicitRoot(rootElement)) {
+        return;
+      }
+
       _update(rootElement);
     };
```

Verified:

- Patched into the published 5.65.1 bundle: all sequences above (including repeated failures and the Camunda 8 distribution) import correctly afterwards.
- In this repository (`main` at `aefd162`, unchanged since 5.65.1): a new test `should recover after failed import` in `test/spec/BpmnPropertiesPanelRenderer.spec.js` fails without the fix (`TypeError: businessObject.get is not a function`) and passes with it.

A pull request with the fix and the test follows.

### Environment

- Browser: Chromium 153 (headless, Playwright 1.63); also in VS Code 1.140 webviews (Electron)
- OS: Windows 11
- Libraries: bpmn-js 18.31.0, bpmn-js-properties-panel 5.65.1, diagram-js 15.28.0; also camunda-bpmn-js 5.36.0

---

## Notes for filing

- Check once more for an existing issue right before filing (searched 2026-10-02: none for "businessObject.get is not a function", "getTimerEventDefinition", "TimerProps import").
- Fix and regression test live on branch `fix-failed-import-implicit-root` of the fork `21010/bpmn-js-properties-panel` (local clone: `~/projects/bpmn-js-properties-panel`). Red/green verified with their Karma suite (system Chrome; the Playwright Chrome for Testing build does not connect to Karma on this machine).
- The test needs `act(async () => createModeler(...))`: the panel's `import.done` listener is a Preact effect registered after paint; without flushing it the bug does not trigger.
- An unresolvable plane reference alone (`bpmnElement="unknown"`) imports successfully; the failing variant gives the process an ID with whitespace (`Process 1`), which fails at render time after the canvas was cleared.

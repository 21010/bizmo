# 0014. DMN editor: scope and design for version 1

- Status: proposed
- Date: 2026-10-07

## Context

DMN is the next notation after BPMN (ADR 0004). BPMN 1.0 is released, and the editor core is now notation-agnostic (`EditorSession` on the host, `startEditor` in the webview; PR #15). ADR 0004 starts a notation only when the previous one meets the definition of done. That definition is not written down. This ADR assumes the BPMN 1.0 release meets it.

What DMN brings that BPMN did not:

- **Several views in one file.** A DMN file has a decision requirements diagram (DRD) and, per decision, a decision table, a literal expression, or a boxed expression. dmn-js shows one view at a time. Only the DRD is a diagram (diagram-js). The other views are HTML tables and text editors.
- **One command stack per view.** dmn-js creates a viewer per view type and announces it (`viewer.created`). Each viewer has its own command stack and change events.
- **Re-import keeps the view.** `importXML` reopens the previously active view if it still exists (`_getInitialView(views, previousActiveView)`), so a re-import after undo or an external change does not jump back to the DRD.
- **Only DMN 1.3 opens.** dmn-js 17 refuses DMN 1.1 and 1.2 files ("only DMN 1.3 files can be opened"). `@bpmn-io/dmn-migrate` converts them. Camunda 7 projects still have DMN 1.1 files.
- **Camunda distributions exist.** `camunda-dmn-js` 3.8.3 (MIT) provides Camunda 7 (`CamundaPlatformModeler`) and Camunda 8 (`CamundaCloudModeler`) modelers. Their DRD has `dmn-js-properties-panel` with Camunda properties. Camunda Desktop Modeler is built on the same packages.
- **No DMN linting in Camunda Modeler.** Its client depends on `camunda-dmn-js` and `dmn-js-properties-panel` but on no DMN linter. `dmnlint` 1.0.0 exists, with generic DMN rules only.

## Options

### Modeler

1. **`camunda-dmn-js` distributions.** The same experience as Camunda Modeler, properties panel included, and the same split as BPMN (`camunda-bpmn-js`). Cons: tied to Camunda's release pace.
2. **Plain `dmn-js` plus our own Camunda modules.** Full control, but we would rebuild what option 1 ships.

### Older DMN versions

1. **Refuse them** (dmn-js's behaviour) with "Open as Text". Users must convert elsewhere.
2. **Migrate in the webview, show, and write DMN 1.3 on the first change.** Opening does not change the file. The first diagram change saves the whole file as DMN 1.3, and the user is told beforehand.
3. **Migrate on open** and mark the document changed. Opening a file would make it dirty, which surprises users and conflicts with other editors of the same file.

### Image export

1. **DRD only.** Export the DRD as SVG or PNG. With a table or expression view active, the commands explain that only the DRD can be exported.
2. **Always export the DRD**, switching views in the background. Visible flicker, and a surprise when a table is on screen.
3. **Tables as images.** This needs `foreignObject` or HTML-to-canvas rendering. Both conflict with the export check (no `foreignObject`, ADR 0008) and taint the canvas.

## Decision

1. **Modeler: `camunda-dmn-js`.** Camunda 7 or 8 is chosen from `modeler:executionPlatform` on `dmn:definitions`, with the shared detection (`shared/camunda/platform.ts`). Files without it are treated as Camunda 8, as for BPMN. As in BPMN, `disableAdjustOrigin` is set, so saving never moves elements (ADR 0008).
2. **Properties panel: included**, in the DRD view only, in the same split pane as BPMN. In table and expression views the panel area is hidden. It costs no extra work: it ships with the distribution.
3. **No DMN linting in version 1**, as in Camunda Modeler. To revisit when Camunda adds DMN checks, or on demand with `dmnlint`. ADR 0013's design (lint in the webview, diagnostics on the host) applies unchanged.
4. **Older DMN versions: option 2.** The webview migrates DMN 1.1/1.2 with `@bpmn-io/dmn-migrate` before import and shows a notice: "This file uses DMN 1.x. Your first change saves it as DMN 1.3." The text document is not touched until the user changes the model. Undo then restores the original file in one step.
5. **Change sync.** The notation subscribes to `commandStack.changed` of every viewer from `viewer.created`. Changes made during an import do not count. The core's edit sync, undo routing and pre-save flush (ADR 0007, 0011, 0012) apply unchanged. Typing in a table cell is a model change like any other. Ctrl+Z inside a cell is VS Code's undo, as in BPMN's FEEL fields.
6. **Views.**
   - The active view is kept across re-imports (dmn-js does this).
   - The active view and the DRD viewport are saved in webview state, so they survive a hidden tab like BPMN's viewport.
   - If the active view's decision is deleted, dmn-js opens the first view, normally the DRD.
7. **Export: option 1, DRD only.**
   - The commands `bizmo.dmn.exportSvg`/`exportPng` call the DRD viewer's `saveSVG` and go through the same host check as BPMN.
   - With another view active, the webview answers `exported { ok: false }` with the message "Switch to the decision requirements diagram to export an image."
8. **Contributions**, mirroring BPMN:
   - custom editor `bizmo.dmn` for `*.dmn` (priority `default`);
   - **Open as Text** and **Open Diagram**;
   - **New DMN Diagram (Camunda 8)** and **(Camunda 7)** with a starter decision table;
   - export commands;
   - the existing `bizmo.maxFileSizeMB` limit.
9. **Bundles.** The new webview bundle is `dist/webview/dmn.js` and `.css`, loaded only by DMN editors (ADR 0004). diagram-js and the properties panel core are duplicated across the BPMN and DMN bundles. That is accepted for isolation, and `check:vsix` gets a new size budget.
10. **Security.** The CSP and message validation are unchanged (ADR 0008). Before adoption, the spike checks that the DMN bundle evaluates no code at runtime (no `eval`/`new Function`; `camunda-dmn-js`'s own bundle has none). The tables need no more than `style-src 'unsafe-inline'`, which BPMN already allows. Like BPMN, DMN files are checked for size and DOCTYPE on the host before import (`xmlDocumentMessage`).

## Spike before implementation

Each item below is a check. If one fails, this ADR is revised before implementation starts.

- Opening, editing a cell, undo and redo, and an external change in each view type, under the production CSP. Each change must produce exactly one document change and one VS Code undo step.
- Cell editing: how often dmn-js commits while typing, and whether debounced sync (300 ms) keeps undo steps sensible.
- Keyboard: dmn-js table navigation (Tab, Enter, arrows) does not clash with the capture-phase undo routing or VS Code keybindings (as in ADR 0012).
- Migration: DMN 1.1 and 1.2 fixtures from Camunda 7 projects import correctly after migration and save as valid DMN 1.3.
- Bundle size and the absence of runtime code evaluation (decision 10).

## Consequences

- DMN reaches parity with Camunda Modeler for editing. It lacks linting, as Camunda Modeler does, and exports only the DRD as an image.
- Opening a DMN 1.1/1.2 file is safe: the file changes only after the user edits it, and they are told first.
- `core/` stays unchanged except for possible small additions (for example a notice banner next to the error overlay). BPMN code is not touched.
- Test suites gain DMN coverage: unit tests for migration detection, browser tests for each view, integration tests for open, edit, undo and external changes, and e2e tests for typing in a table cell and Ctrl+Z.
- Cross-links from BPMN business rule tasks to DMN decisions are left to the cross-links milestone (ADR 0004).

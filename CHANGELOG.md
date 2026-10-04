# Changelog

## 1.0.1 — 2026-10-04

- The diagram keeps its own colors in every VS Code theme: the minimap button, context pad icons, and menus on the canvas no longer take the theme's text color and font (they were invisible in high-contrast themes and faint in dark ones).

## 1.0.0 — 2026-10-03

First release: the BPMN editor for Camunda 7 and Camunda 8.

- Export (M7): **Export as SVG…** and **Export as PNG…**; the image data is checked before it is written.
- Releases (M7): `.vsix` on GitHub releases with an SBOM, checksums, and a build provenance attestation; package size budget checked in CI.
- BPMN linting (M6): Camunda Modeler's checks for the diagram's Camunda 7/8 version, shown on the diagram, in the properties panel, and in the Problems view; the rule link selects the element; setting `bizmo.bpmn.linting.enabled`.
- Element templates (M5): Camunda 7 and 8 templates from `.camunda/element-templates/` in the workspace, applied from the properties panel or the change-type menu; reloaded when the files change; invalid templates reported in the Bizmo log while valid ones still load. Not loaded in Restricted Mode (with a one-time notice). Size limits per file and in total; remote template icons are blocked by the CSP.
- The initial view fits the diagram clear of the palette and minimap button; the panel toggle sits on the divider so nothing covers the canvas or the bpmn.io watermark.
- Camunda properties panel (M4): Camunda 8 or Camunda 7 properties of the selected element, edited straight into the document; follows the VS Code color theme; resizable (mouse or keyboard) and collapsible, with the layout remembered per editor.
- Undo/redo in panel fields and FEEL editors now act on the document like on the diagram (one step of VS Code's history); a change made just before Ctrl+Z is the one that gets undone.
- BPMN editing (M3): Camunda 7/8 modeler with changes synced to the document; undo/redo, save, revert, and auto-save through VS Code; copy/paste via the system clipboard; side-by-side text and diagram editors; several diagram editors on one file.
- New BPMN diagrams for Camunda 7 and Camunda 8 (File → New File…, or the Command Palette).
- Changes made just before saving are included in the save; a change made elsewhere always wins over a concurrent diagram change.
- BPMN viewer (M2): `.bpmn` files open as diagrams (Camunda 7 and 8, detected from the file), as the default editor, with "Open as Text" / "Open Diagram" switching in place.
- Security: hardened webview (CSP per ADR 0008), validated messages in both directions, DOCTYPE/ENTITY files and files above `bizmo.maxFileSizeMB` are blocked before reaching the webview.
- Error states for invalid files, with the parser message and "Open as Text".
- External changes to an open file re-render the diagram, keeping the zoom and scroll position.
- Third-party notices generated from the packages in the bundles.
- Spikes and decisions for the editor model, CSP, serialisation, and keyboard handling (M1, ADRs 0007–0010).
- Product named Bizmo (package `bizmo`).
- Project foundation: build, lint, tests, CI, packaging (M0).

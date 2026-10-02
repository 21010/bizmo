# Changelog

## Unreleased

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

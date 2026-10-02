# Changelog

## Unreleased

- BPMN viewer (M2): `.bpmn` files open as diagrams (Camunda 7 and 8, detected from the file), as the default editor, with "Open as Text" / "Open Diagram" switching in place.
- Security: hardened webview (CSP per ADR 0008), validated messages in both directions, DOCTYPE/ENTITY files and files above `bizmo.maxFileSizeMB` are blocked before reaching the webview.
- Error states for invalid files, with the parser message and "Open as Text".
- External changes to an open file re-render the diagram, keeping the zoom and scroll position.
- Third-party notices generated from the packages in the bundles.
- Spikes and decisions for the editor model, CSP, serialisation, and keyboard handling (M1, ADRs 0007–0010).
- Product named Bizmo (package `bizmo`).
- Project foundation: build, lint, tests, CI, packaging (M0).

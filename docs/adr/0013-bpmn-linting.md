# 0013. BPMN linting runs in the webview; the host publishes diagnostics

- Status: accepted
- Date: 2026-10-03

## Context

M6 adds Camunda Modeler's checks (`@camunda/linting`: bpmnlint with `bpmnlint-plugin-camunda-compat`,
configured by the diagram's `modeler:executionPlatform` and `modeler:executionPlatformVersion`).
Users should see problems both on the diagram (as in Camunda Modeler) and in VS Code's Problems
view, and get from a problem to its element. It must be possible to turn linting off.

The linter accepts XML or an already imported model. The webview holds the imported model; the
host only has text. A custom editor is not told which position a Problems view entry pointed at,
so clicking an entry can open the diagram but not select an element.

## Decision

1. **Linting runs in the webview** on the modeler's model (`modeler.getDefinitions()`), 300 ms after
   each import or change, with one `Linter` per platform (Camunda 8 → `cloud`, Camunda 7 →
   `platform` rules). Results of an outdated run are dropped. No second XML parser runs on the
   host, and the canvas markers and properties panel errors (`@camunda/linting/modeler`) use the same
   reports.
2. The webview posts **`lint { problems }`** (element id, message, severity, rule; bounded and
   validated like every message) with the complete current list; an empty list clears.
3. The **host publishes diagnostics** (`DiagnosticCollection` "bizmo", source "Bizmo") on the range
   of the element's `id="…"` value in the document text, found by a pure function
   (`lintLocations.ts`); the file start if the id is not found.
4. Diagnostics live **while a diagram editor of the document is open**: cleared when the last one
   closes, when an import fails or the file is rejected, and when linting is turned off. They are
   not recomputed for text-only editing.
5. **Navigation**: each diagnostic's `code` is the rule name, linked to
   `command:bizmo.bpmn.showProblem?[uri, elementId]`. The command reveals (or opens) the diagram and
   posts `reveal { elementId }`; the webview selects the element, scrolls to it, and opens the
   affected properties panel entry. Command links can be invoked by anything that renders links, so
   the command validates its arguments and acts only on documents that currently have Bizmo
   diagnostics; it never edits.
6. **Setting** `bizmo.bpmn.linting.enabled` (default on), sent to the webview as
   `settings { linting }` after `ready` and on change.
7. Diagrams **without a platform version** are not linted (the linter's own behaviour, as in Camunda
   Modeler). New diagrams from Bizmo always carry one.

## Consequences

- Problems appear only for open diagrams; there is no workspace-wide lint (could be added on the
  host later with the same reports).
- The webview bundle grows by about 260 KB; the linter and its rules evaluate no code at runtime
  (checked: no `eval`/`new Function`), so the CSP (ADR 0008) is unchanged.
- Clicking a Problems entry itself opens the diagram; the rule link selects the element.

# DMN prototype checks (ADR 0014)

Checks run on a prototype on the shared editor core (2026-10-07). Results feed ADR 0014. The prototype became the DMN editor (`src/webview/notations/dmn/`, `src/extension/notations/dmn/`), and its checks became `test/webview/dmn.test.ts` and `test/e2e/dmn.test.ts`.

Versions: camunda-dmn-js 3.8.3, dmn-js 17.12.3, dmn-js-properties-panel 3.12.0, @bpmn-io/dmn-migrate 0.7.1, Chromium (Playwright 1.63), VS Code stable.

## How to run

```sh
npm run build
npx vitest run --config spikes/dmn/vitest.config.mts       # browser: explore + checks (production CSP)
npx vitest run --config spikes/dmn/vitest.e2e.config.mts   # real VS Code, trusted mouse and keyboard
```

Measurements are appended as JSON lines to `$OUT` (default `spikes/dmn/out.jsonl`, not committed).

## Results

| Check | Result |
|---|---|
| CSP, all fixtures and views | **0 violations, 0 page errors.** `dmn.js` contains one `new Function` (dom-iterator's selector compiler), the same code already in `bpmn.js`. It was never reached. |
| Opening | DMN 1.3 for Camunda 7 and 8 opens in the DRD, with the properties panel. DMN 1.1 without DI opens straight in the decision table (it has no DRD). |
| Typing in a cell | dmn-js commits **every keystroke**. 3 keys typed 450 ms apart gave 3 edits; 6 fast keys gave 1 edit (300 ms debounce). In VS Code, each commit is **one undo step**. |
| Undo keys in a cell | Ctrl+Z, Ctrl+Y and Ctrl+Shift+Z are routed to the host (`undo`, `redo`, `redo`) and the cell is not changed locally. In VS Code, Ctrl+Z in a cell undoes one step, stays in the table, and the last undo leaves the document clean. Redo re-applies one step. |
| Table keyboard | Tab and Shift+Tab move along the row; Enter and Shift+Enter move to the next and previous row; arrows move the caret. No clash with undo routing. |
| Re-import | An external `update` keeps the decision table and shows the new content. The saved view (`{type, id}`) is restored when the webview is recreated. |
| Literal expression | CodeMirror FEEL editor. Typing reaches the document. (The first editable in that view is the decision name header.) |
| Properties panel | The DRD panel edits the decision name while the field has focus, after its own input debounce. Groups start **collapsed**. |
| DMN 1.1 / 1.2 | Opening sends no edit, and VS Code shows the file as **not dirty**. The first change saves DMN 1.3, with no old namespace left and IDs kept. One undo makes the document clean again, and the file on disk is unchanged. |
| Export | The DRD exports as SVG and PNG, and both pass the host's check. With the table view active: "Switch to the decision requirements diagram to export an image." |
| Size | `dmn.js` is 1.3 MB minified (`bpmn.js` is 3.0 MB). The `.vsix` contents total 4.9 MB, inside the current budget. `THIRD_PARTY_NOTICES.md` must be regenerated. |

## Not covered

- Boxed expressions (no fixture) and DRD keyboard shortcuts (Delete, copy and paste in the DRD).
- Real-world DMN 1.1 files from Camunda Modeler < 4, whose layout is in `biodi:bounds`. Does migration keep the DRD layout? This needs a corpus, as for BPMN in M1.
- Several editors on one DMN file, and Revert. They are expected to work like BPMN through `EditorSession`; implementation tests should confirm it.

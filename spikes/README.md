# M1 spikes

Throwaway code that answered the M1 questions (2026-10-02). Not shipped, not linted. Decisions derived from it are in `docs/adr/0007`–`0009`.

Versions: camunda-bpmn-js 5.36.0, bpmn-js 18.31.0, bpmn-js-properties-panel 5.65.1, diagram-js 15.28.0, Chromium 153 (Playwright 1.63), VS Code 1.140.0 and 1.134.0.

## How to run

```sh
# Corpus: real Camunda Desktop Modeler files from public GitHub repos (licenses unknown → not committed).
# Sources are listed in spikes/corpus/SOURCES.tsv; re-download with the GitHub code-search loop in the M1 session notes.
node spikes/run.mjs [s1] [s2] [s3]           # browser spikes → spikes/results/browser-spikes.json
node spikes/vscode-ext/run-tests.mjs         # prototype integration tests in VS Code (VSCODE_TEST_VERSION=1.134.0 for minimum)
node spikes/vscode-ext/keyboard.mjs          # trusted keystrokes via Playwright/Electron → spikes/results/keyboard.json
node spikes/probe-*.mjs                      # focused diagnostics referenced below
```

## Corpus

80 BPMN files saved by Camunda Desktop Modeler (40 Camunda 8, 40 Camunda 7) from 35 public repositories, plus generated diagrams of 50/500/2000 service tasks (`generate.mjs`).

## S1 — Does camunda-bpmn-js run under a strict CSP?

**Yes, with inline styles allowed and the icon font loaded from files.**

| CSP (`script-src 'nonce-…'` in all variants) | C8 violations | C7 violations |
|---|---|---|
| `style-src <origin>` (no inline styles) | 567 (`style-src-attr` 238, `style-src-elem` 329) | 242 (`style-src-attr`) |
| `style-src <origin> 'unsafe-inline'` + `font-src <origin>` + file-based icon font | **0** | **0** |

- `script-src` was **never** violated: no `eval`/`new Function` anywhere in either modeler, including properties panel, popup menus, direct editing, search, element template chooser, copy/paste API, SVG export.
- `style-src-attr`: diagram-js and the properties panel set inline `style` attributes.
- `style-src-elem`: CodeMirror's `style-mod` (FEEL editor in the C8 properties panel) injects `<style>` elements. CodeMirror supports `cspNonce`, but `@bpmn-io/feel-editor` / properties panel do not pass one through.
- `bpmn-embedded.css` embeds the icon font as a `data:` URI → blocked by `font-src <origin>` (palette/context pad icons missing). Building our own CSS entry with `bpmn-font/css/bpmn.css` (font files) fixes it without allowing `data:` fonts (`harness/c8-styles.css`).
- Confirmed in a **real VS Code webview** (1.140.0 and 1.134.0): zero violations for C7 and C8 files.

### Finding: a failed import can permanently break the modeler instance

After certain import sequences, one failed import (e.g. a file whose diagram references don't resolve) leaves the instance unable to import **any** later diagram: `TypeError: businessObject.get is not a function` in the C8 properties panel (`TimerProps` → `getTimerEventDefinition`). Minimal repro: 3 corpus files (`probe-minimal.mjs`).

| Recovery | Result |
|---|---|
| import again | still fails |
| `modeler.clear()` | still fails |
| `modeler.destroy()` + new instance | **recovers** |

→ Rule: after any failed import, recreate the modeler before the next import. Worth an upstream report (bpmn-js-properties-panel).

Also: 79/80 corpus files import with a fresh instance; the one failure is a template file with placeholder IDs (`Process_{{ ID:process }}`) and no resolvable diagram.

## S2 — Is VS Code document undo + re-import acceptable?

**Yes.** Import/re-import cost in headless Chromium (median of 5):

| Diagram | Elements | XML | Import | Re-import (view + selection restored) | `saveXML` |
|---|---|---|---|---|---|
| 50 tasks | 104 | 25 KB | 39 ms | 31 ms | 27 ms |
| 500 tasks | 1,004 | 246 KB | 228 ms | 224 ms | 282 ms |
| 2,000 tasks | 4,004 | 996 KB | 864 ms | 932 ms | 1,908 ms |

Inside VS Code (prototype, 500 tasks): initial import 329 ms / re-import 289 ms on 1.140.0; 416 / 459 ms on 1.134.0. Real-world corpus diagrams are far smaller (typically < 200 elements).

Prototype (`vscode-ext/`, `CustomTextEditorProvider`) integration tests — **7/7 pass on 1.140.0 and 1.134.0**:

- C8 and C7 render with zero CSP violations; opening never writes or dirties the document.
- Edit → `WorkspaceEdit`; the resulting change event is recognised as our own (echo suppressed, no re-import).
- VS Code `undo` restores the original text **exactly**; `redo` re-applies; the webview re-imports each time.
- External change → re-import with viewport preserved.
- Invalid external change → error reported; the next valid change recovers (with instance recreation).
- CRLF documents stay CRLF after edits.

## S3 — Does saving cause diff churn?

Each corpus file: import → `saveXML({ format: true })` → import → `saveXML`.

- **Idempotent: 79/79** — after the first save, output is stable.
- First save vs original:

| | Identical | Whitespace only | Changed |
|---|---|---|---|
| C8 (39) | 14 | 1 | 24 |
| C7 (40) | 3 → 5 with `disableAdjustOrigin` | 0 | 37 → 35 |

- What changes (with `disableAdjustOrigin: true`): **DI element reordering** is by far the most common (C8 19, C7 12 files reorder-only); unused namespace declarations dropped (`xmlns:camunda`, 17 C7 files); empty elements self-closed; attribute order normalised; duplicate attributes (not well-formed XML, 7 files from one repo) silently de-duplicated.
- **`align-to-origin`** (enabled by default in camunda-bpmn-js) **moves elements on every `saveXML`, through the command stack**. In a sync loop that saves on `commandStack.changed`, this creates extra commands and phantom undo steps. Disabling it (`disableAdjustOrigin: true`) removed most "other" changes (C8 3 → 1, C7 10 → 7).
- `saveXML` always writes LF and a final newline; the document's EOL must be applied before writing (prototype converts to CRLF when needed — tested).

Churn is a **one-time** cost on the first edit of a file last saved by an older Modeler version; files saved by a current Modeler mostly round-trip byte-identical.

## S4 — Keyboard

From VS Code 1.134 source (`webview/browser/pre/index.html`, `webviewElement.ts`, `customEditors.ts`):

- The webview host forwards **every** keydown to the workbench (after page handlers, on `window`), and calls `preventDefault()` for Ctrl/Cmd + Z, Y, P, F, S (and C/V/X on Electron).
- The workbench ignores untrusted (synthetic) events → keyboard behaviour cannot be tested with synthetic events; `keyboard.mjs` uses Playwright on VS Code's Electron binary for **trusted** input.
- With a custom editor focused, VS Code's `undo`/`redo` call the custom editor's undo → for a text-backed editor, the document's undo stack.

Control experiment with trusted keystrokes (Ctrl+Z after one edit):

| bpmn-js Ctrl+Z/Y binding | bpmn-js undos | VS Code document undos | Result |
|---|---|---|---|
| active (default) | 1 | 1 | **double undo** |
| swallowed by a high-priority keyboard listener | 0 | 1 | correct: one undo, diagram re-imported |

Keybinding table (swallow active):

| Key | Behaviour |
|---|---|
| Ctrl+Z / Ctrl+Y | VS Code document undo/redo → re-import ✔ |
| Delete | removes selection → edit ✔ |
| Ctrl+A | selects all elements ✔ |
| Ctrl+S | saves the document ✔ |
| Ctrl+P | VS Code Quick Open ✔ |
| Ctrl+F | bpmn-js search pad opens (VS Code find widget not enabled) ✔ (to verify visually) |
| Ctrl+C / Ctrl+V | **not verified** — no paste in Chromium baseline or VS Code under automation; copy/paste API works; `bpmn-js-native-copy-paste` uses the async Clipboard API. Manual check in M3. |

Trap found on the way: in diagram-js' EventBus, a listener **returning `false` cancels the event**. A keyboard listener that returns `false` for keys it does not handle blocks every other binding. Return `undefined` instead.

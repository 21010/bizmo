# 0008. Webview CSP and modeler configuration

- Status: accepted
- Date: 2026-10-02
- Evidence: spikes S1 and S3 (`spikes/README.md`)

## Decision

### Content Security Policy (all notations)

```text
default-src 'none';
script-src 'nonce-{NONCE}';
style-src {webview.cspSource} 'unsafe-inline';
img-src {webview.cspSource} data:;
font-src {webview.cspSource};
```

- No `unsafe-eval`, ever: neither camunda-bpmn-js modeler needs it (zero `script-src` violations across 80 real diagrams and all exercised UI paths).
- `'unsafe-inline'` for styles is required: diagram-js and the properties panel set inline `style` attributes, and CodeMirror (FEEL editor) injects `<style>` elements without a nonce. Risk is low: scripts stay nonce-only, and `default-src 'none'` with origin-restricted `img-src`/`font-src` blocks CSS-based exfiltration to remote hosts.
- `data:` fonts are **not** allowed. The webview CSS entry uses `bpmn-font/css/bpmn.css` (font files) instead of `bpmn-embedded.css`.

### Modeler configuration

- `disableAdjustOrigin: true`: align-to-origin moves elements during every `saveXML` via the command stack, causing extra commands, phantom undo steps, and diff churn.
- After **any** failed import, destroy the modeler and create a new instance before the next import: a failed import can leave the instance unable to import valid diagrams, and `clear()` does not recover it.
- Never configure `keyboard.bindTo` (removed in diagram-js 15; the keyboard binds to the canvas, which must have focus).

## Consequences

- The CSP is asserted by tests (generated HTML) and by webview tests that fail on any `securitypolicyviolation`.
- If a future library version needs a CSP relaxation, that is a security review trigger, not a silent change.
- Root cause of the failed-import corruption: the properties panel stores the implicit root on a failed `import.done` (analysis, reproduction, and proposed fix: `docs/upstream/bpmn-js-properties-panel-failed-import.md`). The workaround stays even after an upstream fix.

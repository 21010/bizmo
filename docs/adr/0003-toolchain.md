# 0003. Build and test toolchain

- Status: accepted
- Date: 2026-10-02
- Decision ID: D3 (minimum VS Code version, provisional)

## Decision

- **TypeScript 6.0** (not 7.x): typescript-eslint 8.71 supports `>=4.8.4 <6.1.0`. Revisit when typescript-eslint supports TS 7.
- **esbuild** bundles two targets: `dist/extension` (Node, CJS) and `dist/webview` (browser, IIFE). `tsc` only type-checks (`noEmit`), with separate configs so webview code compiles without Node types and host code without DOM types.
- **ESLint** with `strictTypeChecked`, import boundaries between `src/extension` and `src/webview`, and bans on `innerHTML`/`outerHTML` assignment, `insertAdjacentHTML`, `document.write`, `eval`, and `new Function`.
- **Vitest** for unit tests, **@vscode/test-cli** (mocha) for integration tests. Browser tests for the webview bundle are added in M2, when there is a webview to test.
- **Minimum VS Code**: `^1.134.0` (about six months behind stable 1.140 at the time of writing). CI tests both the minimum and stable. Confirmed in M1: the custom editor prototype passes the same tests on 1.134.0 and 1.140.0.
- **Playwright** (Chromium, and VS Code's Electron binary for trusted keystrokes) for webview tests from M2.
- **Exact version pins** for dev dependencies; `npm ci` in CI.
- **Dependabot ignores** TypeScript >=6.1, all `@types/vscode` updates (bumped together with `engines.vscode`), and `@types/node` majors (extension host runs Node 22).
- **npm overrides**: `diff@9.0.0` and `serialize-javascript@7.1.2` replace vulnerable versions pulled in through `@vscode/test-cli` → `mocha@11`. Dev-only. Remove once `@vscode/test-cli` depends on a patched mocha.

## Consequences

- Packaging uses `vsce package --no-dependencies`; everything ships bundled in `dist/`.
- `scripts/check-vsix.mjs` enforces an allowlist of packaged files.

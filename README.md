# Bizmo — Business Process Modeler for VS Code

> Work in progress. BPMN files can be **viewed** (Camunda 7 and 8); editing arrives next. See `CHANGELOG.md`.

Model business processes next to your code, with a secure graphical editor for each notation:

| Notation                                                 | Files                             | Status  |
| -------------------------------------------------------- | --------------------------------- | ------- |
| BPMN 2.0 — Camunda 7 and Camunda 8                       | `*.bpmn`                          | Viewer  |
| DMN — Camunda 7 and Camunda 8                            | `*.dmn`                           | Planned |
| Camunda Forms                                            | `*.form`                          | Planned |
| Value Stream Mapping (Lean)                              | `*.vsm.json`                      | Planned |
| SIPOC and swimlane flowcharts                            | `*.sipoc.json`, `*.swimlane.json` | Planned |
| Event Storming                                           | `*.eventstorm.json`               | Planned |
| UML — activity, state machine, class, use case, sequence | `*.uml.json`                      | Planned |

## Using the BPMN viewer

- Open a `.bpmn` file: it shows as a diagram (pan and zoom with the mouse; Ctrl+scroll to zoom).
- **Open as Text** (editor title bar, or right-click the file in the Explorer) switches to the XML; **Open Diagram** switches back. Both replace the current tab.
- The execution platform (Camunda 7 or 8) is read from the file; files without that information are treated as Camunda 8.
- Files that cannot be displayed (invalid XML, not BPMN, too large, or containing a `DOCTYPE`) show the reason and an **Open as Text** button. The size limit is the `bizmo.maxFileSizeMB` setting (default 10).
- The diagram canvas is light in every color theme for now.
- Known limitation: a file opened in the first moments after VS Code starts may open as text, before VS Code has registered Bizmo's editor. Use **Open Diagram**.

## Security

- Every editor runs in a locked-down webview: strict Content Security Policy, no remote content, validated messages.
- The extension makes no network requests and collects no telemetry.
- In untrusted (restricted mode) workspaces, editing works but workspace configuration such as element templates is not loaded.

## Development

```sh
npm ci
npm run build              # bundle extension + webviews into dist/
npm run lint
npm run typecheck
npm test                   # unit tests (Vitest)
npx playwright install chromium   # once, for the webview tests
npm run test:webview       # webview bundles in Chromium under the production CSP
npm run test:integration   # VS Code integration tests (downloads VS Code)
npm run notices            # regenerate THIRD_PARTY_NOTICES.md from the bundled packages
npm run check:vsix         # verify package contents against the allowlist
npm run package            # build .vsix
```

Press `F5` in VS Code to launch an Extension Development Host.

Architecture decisions are in `docs/adr/`.

## License

MIT. Includes [bpmn.io](https://bpmn.io) components under their own licenses; see `THIRD_PARTY_NOTICES.md`.

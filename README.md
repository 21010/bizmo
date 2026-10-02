# Bizmo — Business Process Modeler for VS Code

> Work in progress — not yet usable. See `CHANGELOG.md` for status.

Model business processes next to your code, with a secure graphical editor for each notation:

| Notation                                                 | Files                             | Status         |
| -------------------------------------------------------- | --------------------------------- | -------------- |
| BPMN 2.0 — Camunda 7 and Camunda 8                       | `*.bpmn`                          | In development |
| DMN — Camunda 7 and Camunda 8                            | `*.dmn`                           | Planned        |
| Camunda Forms                                            | `*.form`                          | Planned        |
| Value Stream Mapping (Lean)                              | `*.vsm.json`                      | Planned        |
| SIPOC and swimlane flowcharts                            | `*.sipoc.json`, `*.swimlane.json` | Planned        |
| Event Storming                                           | `*.eventstorm.json`               | Planned        |
| UML — activity, state machine, class, use case, sequence | `*.uml.json`                      | Planned        |

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
npm run test:integration   # VS Code integration tests (downloads VS Code)
npm run check:vsix         # verify package contents against the allowlist
npm run package            # build .vsix
```

Press `F5` in VS Code to launch an Extension Development Host.

Architecture decisions are in `docs/adr/`.

## License

MIT. Includes [bpmn.io](https://bpmn.io) components under their own licenses; see `THIRD_PARTY_NOTICES.md`.

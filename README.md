# Bizmo — Business Process Modeler for VS Code

> BPMN for Camunda 7 and Camunda 8 is ready: diagrams, Camunda properties, element templates, Camunda Modeler's checks, and image export. The other notations are planned. See `CHANGELOG.md`.

Model business processes next to your code, with a secure graphical editor for each notation:

| Notation                                                 | Files                             | Status      |
| -------------------------------------------------------- | --------------------------------- | ----------- |
| BPMN 2.0 — Camunda 7 and Camunda 8                       | `*.bpmn`                          | Ready (1.0) |
| DMN — Camunda 7 and Camunda 8                            | `*.dmn`                           | Planned     |
| Camunda Forms                                            | `*.form`                          | Planned     |
| Value Stream Mapping (Lean)                              | `*.vsm.json`                      | Planned     |
| SIPOC and swimlane flowcharts                            | `*.sipoc.json`, `*.swimlane.json` | Planned     |
| Event Storming                                           | `*.eventstorm.json`               | Planned     |
| UML — activity, state machine, class, use case, sequence | `*.uml.json`                      | Planned     |

## Installing

Bizmo is distributed as a `.vsix` file on the [GitHub releases page](https://github.com/21010/bizmo/releases) (not on the VS Code Marketplace).

1. Download `bizmo-<version>.vsix` from the latest release.
2. In VS Code: Extensions view → `…` → **Install from VSIX…**, or run `code --install-extension bizmo-<version>.vsix`.

Requires VS Code 1.134 or later. There are no automatic updates: install a newer `.vsix` the same way to update.

Each release also carries an SBOM (`bizmo-<version>.cdx.json`, CycloneDX), SHA-256 checksums, and a signed build provenance attestation. To check that a `.vsix` was built from this repository by its release workflow:

```sh
gh attestation verify bizmo-<version>.vsix --repo 21010/bizmo
```

## Using the BPMN editor

- **New diagram:** File → New File… → "BPMN Diagram (Camunda 8)" or "(Camunda 7)", or the commands **Bizmo: New BPMN Diagram**.
- Open a `.bpmn` file: it shows as a diagram. Model with the palette, the context pad, and keyboard shortcuts.
- **Properties panel** (right): Camunda 8 or Camunda 7 properties of the selected element — task definitions, input/output mappings, headers, implementations, listeners, and more. Drag the divider (or focus it and use the arrow keys) to resize it; the **» / «** button above the divider collapses and expands it. The layout is remembered per editor.
- **Element templates:** put Camunda element template files (`.json`) in `.camunda/element-templates/` anywhere in the workspace, as for Camunda Desktop Modeler. Camunda 8 templates (Zeebe schema) apply to Camunda 8 diagrams, all others to Camunda 7 diagrams. Apply one from the properties panel (**Template**) or the element's change-type menu; changes to the files take effect without reopening. Templates are loaded only in trusted workspaces; problems with a template file are listed in the **Bizmo** output channel (**Bizmo: Show Log**).
- **Problems:** diagrams are checked with Camunda Modeler's linter for the diagram's platform and version (`modeler:executionPlatformVersion`; diagrams without a version are not checked). Problems are marked on the diagram and in the properties panel, and listed in VS Code's **Problems** view while the diagram is open; the rule name next to a problem selects its element. Turn checking off with the `bizmo.bpmn.linting.enabled` setting.
- **Export:** **Export as SVG…** and **Export as PNG…** in the editor's `…` menu (or the Command Palette) save an image of the whole diagram. PNGs are rendered at twice the diagram size, up to 16384 pixels per side.
- Changes go straight into the file's document: the tab shows unsaved changes, **Ctrl+S** saves, **Undo/Redo** (Ctrl+Z / Ctrl+Y, Cmd+Z / Cmd+Shift+Z on macOS) work through VS Code — on the diagram and in panel fields alike — and **Revert File** restores the saved version.
- **Copy/paste** (Ctrl+C / Ctrl+V) uses the system clipboard; after pasting, click where the elements should go.
- The XML and the diagram can be open side by side; changes in one appear in the other. If the file changes elsewhere while you are modeling, the file wins and the diagram reloads.
- **Open as Text** (editor title bar, or right-click the file in the Explorer) switches to the XML; **Open Diagram** switches back. Both replace the current tab.
- The execution platform (Camunda 7 or 8) is read from the file; files without that information are treated as Camunda 8.
- Files that cannot be displayed (invalid XML, not BPMN, too large, or containing a `DOCTYPE`) show the reason and an **Open as Text** button. The size limit is the `bizmo.maxFileSizeMB` setting (default 10).
- The diagram canvas is light in every color theme for now; the properties panel follows the VS Code theme.
- Known limitation: a file opened in the first moments after VS Code starts may open as text, before VS Code has registered Bizmo's editor. Use **Open Diagram**.

## Security

- Every editor runs in a locked-down webview: strict Content Security Policy, no remote content, validated messages.
- The extension makes no network requests and collects no telemetry.
- Exported images are checked before they are written (plain SVG or PNG only).
- Report vulnerabilities privately; see `SECURITY.md`.
- In untrusted (restricted mode) workspaces, editing works but workspace element templates are not loaded (Bizmo says so once, with a link to manage trust). Template files are size-limited, parsed as plain JSON, and their icons may only be inline images.

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
npm run test:e2e           # real VS Code driven with mouse and keyboard (Playwright over Electron)
npm run notices            # regenerate THIRD_PARTY_NOTICES.md from the bundled packages
npm run check:vsix         # verify package contents (allowlist) and sizes (budget); run after build:prod
npm run package            # build .vsix
```

Press `F5` in VS Code to launch an Extension Development Host.

**Releasing:** set the version in `package.json`, add a `## <version>` section to `CHANGELOG.md`, merge to `main`, then push the tag `v<version>`. The release workflow checks the tag against the version, builds and checks the `.vsix`, creates the SBOM, checksums, and provenance attestation, and publishes the GitHub release with the changelog section as notes. Run the workflow manually for a dry run (no release, files kept as a workflow artifact).

Architecture decisions are in `docs/adr/`.

## License

MIT. Includes [bpmn.io](https://bpmn.io) components under their own licenses; see `THIRD_PARTY_NOTICES.md`.

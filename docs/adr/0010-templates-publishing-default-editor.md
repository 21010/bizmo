# 0010. Element template sources, publishing, and default editor

- Status: accepted
- Date: 2026-10-02
- Decision IDs: D4, D5, D6

## D4 — Element template sources

Load Camunda element templates only from the workspace: `.camunda/element-templates/**/*.json`, the same convention as Camunda Desktop Modeler, and only in trusted workspaces. No user-profile folder and no extra paths from settings.

- Keeps templates versioned with the project and reviewable in pull requests.
- One trust rule: workspace content is used only when the workspace is trusted.

## D5 — Publishing

Distribute releases as `.vsix` files attached to GitHub releases on `github.com/21010/bizmo`. No VS Code Marketplace or Open VSX publishing for now.

- The tag-triggered release workflow (M7) builds, checks (`check:vsix`), creates the SBOM and provenance attestation, and attaches the `.vsix` to the release.
- Users install with `code --install-extension bizmo-<version>.vsix` or "Install from VSIX…".
- No marketplace publisher account or tokens are needed; revisit before a public 1.0 announcement.
- Consequence: no automatic updates for users; the README documents manual updates.

## D6 — Default editor

Register the BPMN custom editor with `priority: "default"`: opening a `.bpmn` file shows the diagram. "Open as Text" is available from the editor title and the Explorer context menu, and users can change the association with `workbench.editorAssociations`. The same applies to the other notations as they are added.

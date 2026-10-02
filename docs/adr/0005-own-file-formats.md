# 0005. Own file formats for non-standardised notations

- Status: proposed (confirm at start of M11)
- Date: 2026-10-02
- Decision ID: D8

## Context

VSM, SIPOC, swimlane flowcharts, and Event Storming have no standard file format. UML has XMI, but its interoperability is poor and it is verbose. These notations need a durable, diffable, safe format.

## Decision (proposed)

- JSON files with a double extension: `*.vsm.json`, `*.sipoc.json`, `*.swimlane.json`, `*.eventstorm.json`, `*.uml.json`.
- Common envelope: `format`, integer `formatVersion`, `meta`, semantic `model`, separate `layout`.
- A bundled JSON Schema per format, used for host-side validation and contributed through `contributes.jsonValidation` for text-mode editing.
- Deterministic serialisation; unknown properties preserved.
- Forward migrations per version step, with fixture tests; files with a newer version open read-only.

## Consequences

- Small, reviewable diffs in pull requests (layout changes do not touch semantic content).
- The format is a public contract once released; breaking changes require a version bump and a migration.
- JSON Schema validation must not require runtime code generation inside the webview (CSP); validate on the host or precompile.

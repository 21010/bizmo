# 0001. Support both Camunda 7 and Camunda 8

- Status: accepted
- Date: 2026-10-02
- Decision ID: D1

## Context

Camunda 8 (Zeebe) is Camunda's strategic platform, but many teams still maintain Camunda 7 processes. Their BPMN files use different extension namespaces (`zeebe:` vs `camunda:`), properties panels, element template schemas, and lint rules.

## Options

1. Camunda 8 only — smaller scope, but excludes existing Camunda 7 users.
2. Camunda 7 and Camunda 8 — full coverage, more configuration and testing.

## Decision

Support both. The execution platform is detected from `modeler:executionPlatform` on `bpmn:definitions`. Files without that attribute use a configurable default (Camunda 8). New diagrams ask for, or default to, a platform. The extension never converts between platforms implicitly.

The same applies to DMN and Camunda Forms (ADR 0004): `camunda-dmn-js` and form-js are configured per platform, detected from each file's metadata.

## Consequences

- The webview creates a platform-specific modeler (`camunda-bpmn-js` provides both variants; confirmed in spike S1).
- Fixture corpus, round-trip tests, element template validation, and linting run for both platforms.
- Both moddle extensions must round-trip unknown attributes of the other platform without loss.

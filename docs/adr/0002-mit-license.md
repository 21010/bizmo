# 0002. License the project under MIT

- Status: accepted
- Date: 2026-10-02

## Context

The extension bundles bpmn.io components (bpmn.io license, which requires the watermark to remain visible) and MIT-licensed Camunda packages.

## Decision

Release the extension's own code under the MIT license. Keep third-party license texts in `THIRD_PARTY_NOTICES.md` and never remove or hide the bpmn.io watermark.

## Consequences

- Every new runtime dependency's license must be compatible with MIT distribution and listed in the notices.

# 0004. Multi-notation product scope, packaging, and delivery order

- Status: accepted
- Date: 2026-10-02
- Decision IDs: D7 (packaging), D9 (UML approach), D11 (delivery order)

## Context

The project started as a Camunda BPMN modeler (`vs-camunda-bpmn`) and is evolving into **business-process-modeler**, covering BPMN (Camunda 7 and 8), DMN, Camunda Forms, Value Stream Mapping, SIPOC and swimlane flowcharts, Event Storming, and a UML subset.

## Options considered

- Packaging: single extension vs extension pack (core + one extension per notation).
- UML: text-first (Mermaid), graphical subset, both, or PlantUML.
- Order: BPMN to v1 first vs minimal editors for all notations first.

## Decision

- **Single extension** with a shared, notation-agnostic core and one webview bundle per notation, loaded only for that notation's editor. Module boundaries allow splitting into an extension pack later.
- **Graphical UML subset** (activity, state machine, class, use case, sequence) built on diagram-js, in our own JSON format.
- **BPMN first to v1.0**, then DMN → Forms → cross-links → VSM → SIPOC/swimlane → Event Storming → UML. A notation starts only when the previous one meets the definition of done.
- Own notations (VSM, SIPOC/swimlane, Event Storming, UML) use **diagram-js**, the MIT-licensed canvas underlying bpmn-js and dmn-js, for a consistent interaction model and command stack.
- Excluded: CMMN (removed from Camunda 8; `cmmn-js` archived), EPC, IDEF0, Petri nets. ArchiMate and service design notations are future candidates.

## Consequences

- The core contract (`NotationDefinition`) is extracted when DMN is implemented, not before.
- Security, document sync, and testing requirements apply equally to every notation.
- UML is the largest effort; sequence diagrams come last and need a layout spike.

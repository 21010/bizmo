# 0006. Product name: Bizmo

- Status: accepted
- Date: 2026-10-02

## Context

The working names `vs-camunda-bpmn` and `business-process-modeler` were descriptive but not brandable. Two rounds of naming proposals were reviewed.

## Decision

The product is named **Bizmo** (from **biz**ness **mo**deler).

- Marketplace display name: _Bizmo — Business Process Modeler_ (keeps search terms in the name).
- Package / extension name: `bizmo`; extension ID `<publisher>.bizmo`.
- Identifier prefix: `bizmo.` for commands, custom editor view types (`bizmo.bpmn`, `bizmo.vsm`, …), and own file format IDs (`bizmo.vsm`, …).

Quick availability check (2026-10-02): npm package `bizmo` free; no `bizmo` extension on Open VSX or the VS Code Marketplace; no related GitHub project. `bizmo.io` and `bizmo.app` are in use.

## Consequences

- A trademark search (EUIPO, USPTO) must be done before the first public release.
- Possible confusion with _Bizagi Modeler_ (an established BPMN tool) is a known risk; the descriptive display name and distinct visual identity mitigate it.
- A domain other than `bizmo.io` / `bizmo.app` is needed if a website is created.
- Once released, the `bizmo.` identifiers and format IDs are a public contract.

---
id: zero.frontend.hooks.roadmap
type: reference
audience: [developer, agent]
owner: frontend-hooks
status: draft
visibility: internal
system: frontend-components
feature: generic-roadmap
maturity: supported
applies_to: ["2.1.1 source with audited corrections; package qualification pending"]
modes: [browser, SSR]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Generic Hook Roadmap

[Hooks index](./index.md) · [Documentation index](../../index.md)

Known future directions include reusable non-disruptive autosave and stronger
agent/developer UI onboarding. The current scheduling/draft/local-state primitives
are building blocks, not a universal autosave engine.

Confirmed accepted-action, controlled-value and SSR-snapshot defects are corrected
with focused tests before documenting those contracts. Further browser/lifecycle/
accessibility qualification remains an evidence gate, not an invented API.

## Related Guides And Next Steps

- [State/actions](./state-and-actions.md) documents existing local state.
- [Form drafts](../state/form-drafts.md) owns current persistence helpers.
- [Configuration](./configuration.md) owns present arguments/read time.

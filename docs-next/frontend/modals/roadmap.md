---
id: zero.frontend.modals.roadmap
type: roadmap
audience: [developer, agent]
owner: modals
status: draft
visibility: internal
system: modals
feature: roadmap
maturity: supported
applies_to: ["2.1.1 source with audited corrections; package qualification pending"]
modes: [browser, Guardian single, Guardian multi, single-database, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Modal Manager Roadmap

[Modals index](./index.md) · [Documentation index](../../index.md)

Known requested direction: improve main modal section/header/body/footer structure
and close-button/content spacing, with any app compatibility implications assessed
before rollout. This is evolution of the existing manager, not a shipped new API.

The current stack, exact IDs, confirmation promises, scope discard, keyboard hold
and close callback isolation have their own contracts. Confirmed lifecycle defects
are fixed/tested rather than renamed planned limitations.

## Related Guides And Next Steps

- [Host](./modal-manager.md) describes current structure.
- [Configuration](./configuration.md) describes existing props.
- [Lifecycle](./lifecycle.md) describes corrected close ownership.

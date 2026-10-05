---
id: zero.frontend.components.primitives.roadmap
type: roadmap
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: primitive-roadmap
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

# Primitive Roadmap

[Primitive index](./index.md) · [Frontend index](../../index.md) · [Documentation index](../../../index.md)

Known user direction favors coherent compact controls, smooth inline editing,
optional table controls and design tokens shared across all platform organisms.
Current source APIs live in the feature guides; future ideas are separate:

- [ ] Evaluate small in-table graph/sparkline components with accessible exact-data
  companions, not a replacement for the table's query/action contracts.
- [ ] Expand reusable admin blocks when a real app establishes a shared interaction.
- [ ] Improve richer editor/document-reading plugins with their own persistence
  boundaries and autosave acceptance semantics.

These are not implemented exports in this pass. Confirmed contract defects are
corrected with focused regressions, not put on this roadmap as tolerated limits.
Whole-browser/device/accessibility and exact-package qualification remain distinct
review gates; a complete symbol catalog alone does not pass them.

## Related Guides And Next Steps

- [Primitive index](./index.md) locates current feature contracts.
- [Data controls](../../data-controls/index.md) owns existing advanced tables/editing.
- [Design system](../../design-system/index.md) owns token/motion evolution.

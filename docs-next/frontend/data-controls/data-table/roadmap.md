---
id: zero.frontend.data-controls.data-table.roadmap
type: roadmap
audience: [developer, agent, maintainer]
owner: frontend-data-controls
status: draft
visibility: internal
system: frontend-data-controls
feature: data-table-roadmap
maturity: planned
applies_to: [future proposals]
---

# Table Direction

[DataTable index](./index.md) · [Documentation index](../../../index.md)

DataTable already has shared controls, server-query integration, exact/unknown
pagination metadata, sizing and accepted action/edit lifecycle. Further work
should preserve that coherent foundation rather than ask each app to rebuild it.

- [ ] Evaluate the user's proposed in-cell mini graph/summary presentation with
  typed data, design tokens and appropriate aggregate/permission semantics.
- [ ] Continue app-driven layout/interaction polish using existing slots/column
  overrides before introducing new framework props or hidden query behavior.

These are ideas, not current graph column types or newly promised backend query
modes. Confirmed correctness/security defects are fixed and tested separately;
they are not roadmap limitations or a reason to bypass the normal source contract.

## Related Guides And Next Steps

- [Data control direction](../roadmap.md) owns broader editor/control proposals.
- [Configuration](./configuration.md) lists current public options.
- [Server sources](./server-sources.md) owns existing query/pagination behavior.

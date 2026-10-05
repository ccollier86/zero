---
id: zero.frontend.data-controls.roadmap
type: roadmap
audience: [developer, agent, maintainer]
owner: frontend-data-controls
status: draft
visibility: internal
system: frontend-data-controls
feature: roadmap
maturity: planned
applies_to: [future proposals]
---

# Data Control Direction

[Data controls index](./index.md) · [Documentation index](../../index.md)

Current tables already have optional toolbar slots, shared compact search,
source-aware server queries, controlled state, sizing and awaited actions/edits.
Future plans should build on them rather than require app-owned duplicate controls.

- [ ] Evaluate small in-cell graph/summary components, a user-requested future
  UI idea. This is not an existing automatic graph column or data aggregation API.
- [ ] Continue editor/file/content-organism polish with design-token primitives
  and explicit permission/readiness modes, as recorded platform product direction.
- [ ] Consider later GUI form/editor building and non-disruptive autosave alongside
  the form roadmap, preserving server policy and accepted-write semantics.

The audit's query/receipt/nullable/notification fixes are actual corrections,
not documented limitations or proposed future features. Final app/package/visual
qualification remains separate from having these draft guides.

## Related Guides And Next Steps

- [DataTable](./data-table/index.md) owns current control/query composition.
- [Forms direction](../forms/roadmap.md) owns editor/autosave proposals.
- [Configuration](./configuration.md) links supported settings.

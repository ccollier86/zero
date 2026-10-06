---
id: zero.frontend.data-studio.toolbar
type: reference
audience: [developer, agent]
owner: data-studio
status: draft
visibility: internal
system: data-studio
feature: toolbar
maturity: supported
applies_to: ["2.2.1 development source with temporal-editor changes; package qualification pending"]
modes: [browser, SSR, Guardian multi, Fabric tenant-database]
reviewed_against:
  package: "@zero/framework"
  version: "2.2.1"
  commit: "95ba0578f6625fc4597a9ec6786ee1d3353f29cd"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Shared Search And Logical Table Filters

[Data Studio index](./index.md) · [Documentation index](../../index.md)

DataStudioToolbar reuses DataTableControls/DataTableSearch. Search is first, then
logical table/status selectors and filterControl; list actions and counts occupy
the trailing outlet. It does not introduce a second search styling or query engine.

Required props: tables, selectedTableId, tableStatus, search, loadedCount, totalRows,
canManage, onTableChange/onStatusChange/onSearchChange/onCreateTable/onRefresh.
Optional filterControl, loading/busy (both false), className.
Search label/placeholder are "Search records"/"Search records…", maxLength200,
collapsedWidth112, expandedWidth216. tableStatus accepts active/archived/all.
Counts reflect the controller, not inferred totals. Creation is manage-gated.

DataStudioFilterControl takes columns, filters, onChange and optional disabled
(default false). It stages scalar filters in a popover and applies them through
onChange. Operators are eq/ne/contains/gt/gte/lt/lte; JSON columns are excluded.
Each filter uses immutable columnKey, operator and string/number/boolean/null.
At most8 filters and8192 serialized characters are admitted by transport.
Null supports equality/inequality, not range comparisons; values must match
column types. The server validates again.

Controls are optional composition pieces, not automatic endpoint provision.
Changing a custom filter requires changing the actual controller query.
Busy state narrows interactions; it does not cancel an accepted write.
Visibility defaults and source-dependent behavior remain controller contracts.

Date/datetime operands reuse the same Zero calendar/time editor as record and
schema-default forms. Choosing an operand changes the filter draft; it does not
apply a record mutation. Invalid typed values remain visible until corrected;
the filter validator still decides which predicates can be sent to the server.
See [logical values](./values.md) for calendar/time precision and admission.

## Related Guides And Next Steps

- [Controller](./controller.md) owns actual search/filter/page queries.
- [Table controls](../data-controls/data-table/controls.md) owns shared styling/slots.
- [SDK](./sdk.md) owns typed request validation and scope cache keys.
- [Workspace](./workspace.md) places the full control plane.

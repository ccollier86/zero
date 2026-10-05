---
id: zero.frontend.data-studio.inspector
type: reference
audience: [developer, agent]
owner: data-studio
status: draft
visibility: internal
system: data-studio
feature: inspector
maturity: supported
applies_to: ["2.1.1 source; package qualification pending"]
modes: [browser, SSR, Guardian multi, Fabric tenant-database]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Record, Table And Code Inspector

[Data Studio index](./index.md) · [Documentation index](../../index.md)

DataStudioInspector is the selected-table/right-panel companion. Required props
are table (or null), row (or null), canManage, onEditSchema and onChangeStatus;
busy defaults false and className is optional. It is exported by the Studio
subpath and browser-safe root/React barrel.

No selected table shows a contextual empty state. Tabs group Record, Table and
Code. Selecting a new record opens Record; clearing selection returns to Table.
Record shows full untruncated values (including long text/JSON), row ID, revision,
schema revision and timestamp. Values wrap inside the pane's own bounded scroll
area. Table shows description, stable ID/API key, table/schema revision, columns,
rows, lifecycle and created/updated timestamps. It does **not** duplicate the
schema as a vertical card wall; headers and the full schema editor own that task.
Code renders a generated browser SDK usage example, not executable raw SQL.

canManage enables schema/status commands with busy guards; archived schemas are
read-only until restored. Server capability/
revision checks still enforce management; true cannot make an unauthorized
mutation succeed. The inspector does not fetch rows or own an operation runner.
Use controller-backed callbacks and exact current context.

Generated code is orientation, not a fully import-complete application. A JSON
column type can reference DataStudioValue; add the appropriate public type import
and actual client composition before using it. Data displayed here is already
browser-admitted: tabs/masking/hidden buttons do not protect leaked values.

## Related Guides And Next Steps

- [Values](./values.md) owns formatting and code generation.
- [Dialogs](./dialogs.md) owns schema/status workflows.
- [Grid](./grid.md) owns table selection.
- [Workspace](./workspace.md) owns complete panel/action placement.

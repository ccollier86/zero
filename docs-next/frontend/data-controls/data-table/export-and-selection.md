---
id: zero.frontend.data-controls.data-table-export-and-selection
type: reference
audience: [developer, agent]
owner: frontend-data-controls
status: draft
visibility: internal
system: frontend-data-controls
feature: data-table-export-and-selection
maturity: supported
applies_to: ["2.1.1 source with audited corrections; package qualification pending"]
modes: [browser, SSR, array, collection, lazy, server query]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Page Selection And CSV Export

[DataTable index](./index.md) · [Documentation index](../../../index.md)

Selection and export are related UI conveniences with different scopes. Selection
targets current rendered-page rows. CSV serializes visible columns from the table's
filtered row model. Neither implies every matching backend record is available.

## Selection

Set selectable=true to enable row checkboxes. onSelectionChange receives string
UI IDs; schema keys or source.getRowId supply stable identity.
state.rowSelection can be controlled and initialState.rowSelection seeded, but
toolbar selectedRows/selectedRowIds/count, built-in bulk targets and footer counts
project only rows present in the current table.getRowModel() page.

Query criteria, page or page-size changes clear page selection. Authorization/
source replacement clears it before a replacement scope is usable. An unchanged
controlled old selection is blocked rather than resurrecting stale targets.
Do not treat selection as a server-side authorization filter.

```tsx
<DataTable
  schema={tasks.schema}
  data={rows}
  paginated={{ pageSize: 20 }}
  selectable
  onSelectionChange={(ids) => setSelectedIds(ids)}
/>
```

This fragment assumes caller-owned tasks/rows/setSelectedIds. The built-in page
action path cannot execute against IDs absent from that rendered page. Advanced
all-matching bulk actions require explicit backend-supported selection/target
contracts, described in [actions](./actions.md).

## CSV Scope And Value Rules

showExport defaults true when a toolbar is shown; exportFilename defaults
"export.csv". The export button uses visible columns and filtered rows. With a
local complete dataset, the filtered model can include rows across local pages.
With an isolated server source, only its returned accepted rows exist in that
model, so export is the loaded server page—not every matching result.

Column headers use string definitions or their ID. Cell values use table accessor
values, so schema codecs affect serialization; arbitrary rendered JSX does not
become CSV text. Null/undefined render as empty text. Commas, quotes, LF and CR are
quoted correctly, and embedded quotes are doubled.

Formula-looking textual values are escaped as literal spreadsheet content, including
leading whitespace/control characters and supported full-width formula-prefix
variants. Actual number/bigint cells remain numeric. This changes exported text
representation for spreadsheet safety; do not rely on exact round-trip raw string
bytes from a human-oriented CSV export. A spreadsheet import policy is still an
app responsibility.

CSV download uses a browser Blob/object URL. There is no PDF export in this table
contract. The serializer is internal; use the supported toolbar rather than
inventing an @zero/framework CSV helper import. Serverwide exports require an
authorized app endpoint/job with its own result bounds and data-handling policy.

## Security And Verification

Only export records/fields already authorized into the table. Hiding columns is
presentation, not a secret boundary, and CSV escaping does not sanitize arbitrary
HTML. Confirm exported visible columns, CR/LF/quotes, dangerous string formulas,
numeric negatives, local multi-page filtering and server loaded-page boundaries.

Tests for export serialization and current-page projection cover dirty-source
corrections. They do not certify every spreadsheet application's behavior or a
published artifact. Custom bulk actions must recheck permissions on the server.

## Related Guides And Next Steps

- [Actions](./actions.md) owns page/all-matching execution.
- [State and columns](./state-and-columns.md) owns selection and visible facets.
- [Server sources](./server-sources.md) owns accepted page membership.
- [Configuration](./configuration.md) owns toolbar/export switches.

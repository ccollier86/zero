---
id: zero.frontend.data-controls.data-table-state-and-columns
type: reference
audience: [developer, agent]
owner: frontend-data-controls
status: verified
visibility: internal
system: frontend-data-controls
feature: data-table-state-and-columns
maturity: supported
applies_to: ["2.6.0"]
modes: [browser, SSR, array, collection, lazy, server query]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "c5656b306051b04ec6adc641b7057a0672fd7a3e"
  snapshot: clean
  date: "2026-10-07"
  evidence_level: implementation-verified
---

# Headless State, Columns And Stable Sizing

[DataTable index](./index.md) · [Documentation index](../../../index.md)

Use DataTable's built-in state for ordinary screens. Control selected facets when
a URL, saved view or adjacent panel must coordinate them. The headless useDataTable
hook builds a TanStack instance from a SchemaDescriptor and row array; it does not
fetch records, authenticate requests or persist edits.

## Public Hook

```tsx
import { useDataTable } from '@zero/framework/components/data-table';

const controls = useDataTable({
  schema: tasks.schema,
  data: rows,
  columns: ['title', 'done'],
  paginated: false,
});
```

This hook fragment assumes app-owned tasks/rows inside a React component.
controls.table is the TanStack instance; controls.columnDefs is the generated
definition list. The returned sorting, columnFilters, columnVisibility,
rowSelection and globalFilter each have corresponding set* setters.
editingCell/setEditingCell describe the active { rowId, columnId } or null.
The returned object does not expose a separate pagination setter: use
table.setPageIndex/setPageSize.

UseDataTableOptions includes schema, data, columns, editable, selectable,
pageSize, globalFilter, primaryKey, getRowId, columnOverrides, initialState,
state, onStateChange, paginated, manualQuery, paginationMode, rowCount, pageCount, boundaryKey,
sortable and searchableFields. In corrected development source, globalFilter
is an initial-search shorthand. Explicit initialState.globalFilter takes
precedence (including an intentional empty string), and controlled
state.globalFilter takes precedence over both. Local setGlobalFilter remains
usable; changing the shorthand on a later render does not reseed state.
Use state.globalFilter/onStateChange for controlled search. The original
baseline declared the shorthand but never applied it; focused public-hook
regressions now verify initialization, precedence and unchanged server-page
behavior.

## State And Pagination Resets

DataTableState contains globalFilter, columnFilters, sorting, pagination
({ pageIndex, pageSize }), rowSelection and columnVisibility. initialState
initializes local facets once; its pagination can be partial. state controls only
provided, defined facets; an undefined facet is uncontrolled and retains its
local/default value rather than erasing pagination or initial search.
An intentional empty string/array/object is still a provided value.
onStateChange receives the complete next state. A controlled
parent must accept those changes if it wants the UI to move.

Search, filters and sorting reset pageIndex to zero and clear page-local selection.
Authorization/source replacement resets selection and page admission. Retaining a parent's old
controlled selection/page object must not silently reinstate old-scope rows;
a deliberate new controlled value or user interaction is needed.

Changing **Rows per page** preserves the page containing the old first row for
arrays, complete reactive collections and offset server sources. The new index
is `floor(oldPageIndex * oldPageSize / newPageSize)`: moving from index3 with20
rows per page (first offset60) to50 selects index1 (offset50). The former first
row stays on that page; it need not remain the first displayed row. A larger
page may legitimately have index0. Increasing or decreasing the size uses the
same rule and does not restart a server search at offset0 unnecessarily.

Opaque cursor sources instead reset index/cursor history to the beginning when
batch size changes; the table cannot invent a cursor for an offset it has not
visited. The organism derives this mode from `source.pagination`. A standalone
manual `useDataTable` cursor composition must set `paginationMode: 'cursor'`;
the hook defaults to offset semantics.

Every page/size change clears page-local selection, including a parent-driven
controlled pagination replacement. Adopt the complete pagination pair from
onStateChange to retain the built-in anchor. An explicitly supplied controlled
`{ pageIndex, pageSize }` pair describes the parent's intended position; the
table does not reinterpret it as a page-size button click.

If a complete local result or an offset response with an exact total shrinks,
an out-of-range page is clamped to the last remaining page (index0 for no rows).
An unknown-total server batch does not supply such evidence: an empty batch
does not become a fabricated total or an automatic first-page jump. These
rules do not change search/filter/sort/source/authorization resets.

```tsx
<DataTable
  schema={tasks.schema}
  data={rows}
  state={{ globalFilter: search }}
  onStateChange={(next) => setSearch(next.globalFilter)}
  searchable
/>
```

This controlled fragment assumes app-owned search/setSearch. State is not stored
in a server table or URL automatically. Do not retain scope-specific selections
in a shared saved view.

Local pagination defaults on in the standalone hook, page size 20; DataTable
organism instead enables pagination by default only for explicit server sources.
paginated=false removes the local pagination row model and renders all rows.
manualQuery bypasses browser sorting/filtering/pagination, so an accepted server
page is not processed twice. That flag alone does not create a server adapter.

## Column Generation And Overrides

Omitting columns selects schema fields except tableVisible=false. Explicit columns
select/order exact names. Labels prefer override.header, then schema label, then
a formatted field name. Accessors decode field values; a custom cell receives
{ row, value, columnId, fieldMeta } with the original row and decoded value.

DataTableColumnOverride supports header, cell, width, minWidth, maxWidth, flex,
wrap, truncate, sortable, filterable and editable. width overrides schema
columnWidth. Sorting is disabled by global sortable=false; otherwise per-column
override wins schema sortable. Editable overrides win the editable list. These
are presentation/interaction settings, not server validation or permissions.

```tsx
<DataTable
  schema={secrets.schema}
  data={rows}
  columns={['name', 'value']}
  tableLayout="fixed"
  columnOverrides={{
    name: { width: 180, minWidth: 120 },
    value: { flex: true, truncate: true, minWidth: 120 },
  }}
/>
```

The fixed-layout fragment gives Value remaining space without expanding adjacent
columns when a long secret is revealed. wrap and truncate choose presentation;
do not reach into private CSS selectors for normal sizing. Revealing browser-held
values still requires prior authorization; sizing does not protect secrets.

Row IDs use getRowId when supplied to the hook, then schema/explicit primaryKey,
then an index fallback. Server sources expose their own getRowId. Prefer stable
schema identities; indexes are unsafe for reorderable editable records.
string/number identities are canonicalized to strings for UI selection.

## Verification

Check controlled and uncontrolled facets together, query/page resets, a changed
authorization/source boundary, custom numeric primary keys, disabled pagination,
manual server mode and long wrapping/truncated cells. Focused state/selection
regressions cover the Zero 2.6 state behavior. Application-specific authority,
styling and device qualification remain separate from those shared checks.

## Related Guides And Next Steps

- [Sources](./sources.md) connects the headless row model to execution owners.
- [Controls](./controls.md) connects TanStack state to shared search/filter slots.
- [Selection and export](./export-and-selection.md) defines current-page targets.
- [Schema UI metadata](../../../backend/schema/ui-metadata.md) owns shared hints.

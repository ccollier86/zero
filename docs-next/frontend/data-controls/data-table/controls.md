---
id: zero.frontend.data-controls.data-table-controls
type: reference
audience: [developer, agent]
owner: frontend-data-controls
status: draft
visibility: internal
system: frontend-data-controls
feature: data-table-controls
maturity: supported
applies_to: ["2.5.0 working source; page-size correction qualification pending"]
modes: [browser, SSR, array, collection, lazy, server query]
reviewed_against:
  package: "@zero/framework"
  version: "2.5.0"
  commit: "ae85a4b6efe11eeb74ab89b15ed02a23e982c59f"
  snapshot: dirty
  date: "2026-10-07"
  evidence_level: source-observed
---

# Search-First Toolbars And Pagination

[DataTable index](./index.md) · [Documentation index](../../../index.md)

DataTableControls provides the compact shared layout used by tables and other
directories. DataTableToolbar adds TanStack-aware search, filters, visibility,
export and slots. Choose the layout primitive when an app owns the query state;
choose Toolbar when a TanStack instance owns it.

## Search And Layout Without A Table

```tsx
import {
  DataTableControls,
  DataTableSearch,
} from '@zero/framework/components/data-table';

<DataTableControls
  search={<DataTableSearch value={search} onValueChange={setSearch} label="Find drives" />}
  controls={statusSelector}
  actions={refreshButton}
/>;
```

This fragment assumes React search state and caller-supplied controls/actions.
Search is always first; controls follow it, actions occupy the trailing outlet,
and supplemental content occupies the full-width row underneath. The layout
inherits normal div attributes/className and defaults to role=group,
aria-label="Table controls". It neither queries nor filters anything.

DataTableSearch is a controlled, forwarded-ref input. Required value and
onValueChange describe search text. label defaults "Search table"; placeholder
"Search…"; collapsedWidth 116 and expandedWidth 208 are pixel widths.
onOpenChange reports focus/value-driven expansion. It inherits input attributes
except defaultValue/onChange/size/type/value. Use disabled normally.
Focus expands; non-empty text keeps it expanded. Escape first clears populated
text, then collapses an empty input. Motion respects reduced-motion preference.
Its tokenized presentation belongs to table/directory controls, not every app input.

## Organism Toolbar Slots

```tsx
<DataTable
  schema={tasks.schema}
  data={rows}
  searchable={{ placeholder: 'Find tasks…', ariaLabel: 'Find tasks' }}
  toolbarSlots={{
    controls: statusSelector,
    actions: ({ selectedRowCount }) => <span>{selectedRowCount} selected</span>,
    supplemental: viewDescription,
  }}
/>
```

A slot is ReactNode or a function of DataTableToolbarContext<T>. Context exposes
table, query, setQuery, columnFilters, activeFilterCount, hasActiveFilters,
hasActiveSearch, clearAll, selectedRowIds, selectedRows and selectedRowCount.
The selected values are projected from the current rendered page, never every
controlled ID or cached result. clearAll clears global search and column filters.

toolbarActions is the legacy trailing outlet and remains supported alongside
slots.actions. slots.controls precedes the built-in action group; slots.actions
precedes Columns/Export; supplemental precedes active-filter chips. Prefer those
slots to replacing routine controls.

DataTableToolbar takes required table/globalFilter/onGlobalFilterChange and
optional searchable, filterable, filterColumns, showColumnVisibility, showExport,
exportFilename, actions, slots, ariaLabel and className. Standalone defaults:
searchable=true, filterable=false, visibility/export=true,
filename="export.csv", ariaLabel="Table controls".
DataTable itself defaults searchable=false; do not infer the toolbar default.

Generated filters follow schema metadata and filterColumns. Active chips allow
individual clearing. Column controls toggle presentation, not field authorization.
DataTableColumnHeader composes a column's sortable label; server sources translate
that interaction into a query, local sources execute it in the browser.

Generated date/datetime column filters compose Zero's DatePicker instead of a
browser-native date input, retaining their existing calendar-date filter
semantics. A valid choice sets a canonical date; clearing removes the filter.
Invalid typed text remains visible and does not emit a new filter, so an
already-applied valid filter remains until explicitly changed or cleared.
This picker is not a new range/timestamp query API and does not change a
source's local/server filtering behavior. See [date primitives](../../components/primitives/dates-and-time.md)
and [server sources](./server-sources.md) for those separate boundaries.

## Accurate Pagination

DataTablePagination takes table, optional pageSizes/className/serverPage/loading.
pageSizes defaults [10, 20, 50, 100]. Omit serverPage for local data; null means
a server page has not yet loaded. Accepted server metadata governs ranges and
hasMore; optional total controls known totals and last-page admission.

Rows per page calls the TanStack table's setPageSize. For local and offset
sources, it selects the new page containing the former first row instead of
always returning to page one. Cursor batch-size changes intentionally start
a new cursor history. Page/size changes retire page-local selection; controlled
parents must accept the full pagination pair from onStateChange. See
[state and columns](./state-and-columns.md#state-and-pagination-resets) for the
anchor formula and shrinking-result behavior.

An unknown total shows "Showing 21-40" rather than inventing a total from page
length. Cursor mode requires an admitted nextCursor and hasMore for Next and
does not offer Last. Previous follows retained visited-page cursor state. Loading
disables page-size/navigation actions; the toolbar remains usable during refresh.
See [server sources](./server-sources.md) for exact result/query shapes.

Record actions in a master-detail/control plane may belong in its bottom
navigation/action bar; use the organism's navigation actions, not a separate
large card per operation. The toolbar is for list/query controls and contextual
list actions, not a requirement to move every account action into its header.

## Verification

Test search/clear/Escape with keyboard, narrow widths, reduced motion, optional
slots, no toolbar, schema filters, unknown totals and cursor navigation. A custom
selector must update its actual source/query state; appearance alone does not
connect it. Scope replacement must clear page targets before actions execute.

## Related Guides And Next Steps

- [Configuration](./configuration.md) owns organism defaults/toolbar visibility.
- [Server sources](./server-sources.md) connects controls to authenticated queries.
- [Selection/export](./export-and-selection.md) explains footer/CSV boundaries.
- [Actions](./actions.md) owns complete asynchronous operation behavior.

---
id: zero.frontend.data-studio.grid
type: reference
audience: [developer, agent]
owner: data-studio
status: draft
visibility: internal
system: data-studio
feature: grid
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

# Ordered Logical Record Grid

[Data Studio index](./index.md) · [Documentation index](../../index.md)

DataStudioGrid renders an ordered, progressively loaded logical table using schema column IDs.
It is a controlled presentation component, not a query source. Import it from
@zero/framework/components/data-studio or the browser-safe root/React barrel.

Required props: table (or null), rows, selectedRowId (or null), editable,
onSelectRow(rowId), onCommit(row, column, value):Promise<unknown> and
onReload():Promise<unknown>. Optional loading, sortColumnId, sortDirection
(default asc), onSort(columnId, direction) and className complete the basic composition.
Optional `onInspectRow(rowId)` separates inspection intent from selection.
Writable cell/input interactions select the record without leaving the editor;
read-only/refresh-boundary or non-cell row clicks may request inspection.
The connected mobile workspace opens its details pane from that intent or the
explicit Inspect action, not from every ordinary selection.

```tsx
<DataStudioGrid
  table={studio.selectedTable}
  rows={studio.rows}
  selectedRowId={studio.selectedRowId}
  editable={studio.access.canWrite}
  onSelectRow={studio.selectRow}
  onCommit={(row, column, value) => studio.updateCell(row, column.columnId, value)}
  onReload={studio.reloadRows}
/>
```

This fragment assumes the imported Grid and a ready controller. For real app
editing also require an active table and no competing controller mutation, as
the packaged workspace does.

## Schema Headers And Actions

The schema header remains visible when there are no matching records or initial
loading is in progress. Each heading includes its type icon, display label and
required marker. `schemaEditable` defaults false and is independent of `editable`
record writes. Supply it from current management capability, never by assuming
that a record writer can alter the schema.

| Optional callback | Contract |
| --- | --- |
| onAddColumn() | Opens the caller's schema authoring flow; shown as a compact header-end plus. |
| onUpdateColumn(next, expectedRevision?) | Awaits a normalized replacement with its existing stable column ID. Captures the table revision and writer when the editor opens. |
| onMoveColumn(columnId, left\|right, expectedRevision?) | Awaits an ordered schema change; captures the selection-time revision. |
| onRemoveColumn(columnId, expectedRevision?) | Runs only after explicit destructive confirmation, retaining its original revision rather than silently adopting a live update. |

Header click opens the shared column editor in a Zero Popover. The visible
options button and header right-click open the same Zero DropdownMenu. Edit and
remove wait for the menu's close-autofocus lifecycle before opening another
focus scope; the exiting menu cannot steal the editor's input focus. Actions
include Edit, ascending/descending sort, Move left/right and Remove. JSON sorting
is disabled. Sort actions call `onSort` rather than sorting a partial page locally.

Changing a display label or moving a column never implicitly changes its API
key. The editor labels this identifier **Field key**; it is the column's `key`,
not a Guardian authentication API key. Deliberate persisted field-key edits
remain supported with an explicit rename warning/acknowledgement; the stable `columnId` remains intact.
Table keys are immutable. Removing the last column is not artificially blocked
by the grid; the authoritative backend decides whether the proposed schema and
stored records permit that change.

Every async schema action admits one pending call, awaits acceptance and keeps
safe failure feedback. Revision conflicts require reloading/review. An unknown
mutation outcome requires reconciliation of the retained operation, not a blind
new-key retry. Unmount/permission changes cannot admit stale actions. The caller
still owns the revisioned mutation and server permission checks.
The anchored editor has a viewport-bounded scrolling surface, keeping fields
and Apply/Cancel actions reachable on short screens without expanding the grid.

## Geometry, Virtual Rows And Keyboard Editing

The grid fills its parent's available flex track. Give standalone compositions
a bounded height/min-height layout; it does not impose an arbitrary fixed pixel
cap on the workspace. One root scroller owns both axes. The reused Zero `Table`
sets `containerClassName="overflow-visible"` so its normal inner wrapper does not
become a competing scroll container. Headers remain sticky vertically, while
wide schemas scroll horizontally inside the grid.

TanStack Table owns per-column sizing and mouse/touch resize handlers. Local
presentation widths default to208px, with128–640px bounds. The focusable resize
separator also supports left/right arrows (8px), Shift+arrow (40px), Home/End for
the bounds. Width changes do not modify schema, keys or row values.

TanStack Virtual renders36px rows with six overscan rows rather than mounting
every loaded record. Selected and focused rows remain in the rendered range;
external selection scrolls the row into view. Semantic row indices preserve the
logical position, and an unknown continuation uses an unknown ARIA row count.
Spacers are presentation-only.

Inline cells use table-fixed geometry and inherited typography. Grid keyboard
navigation moves across loaded logical cells and scrolls the target into the
virtual viewport; it does not itself request another server batch.
Selection/read/write authority stays with the scoped controller and server.
A disabled editable flag hides editing, not data access.

## Progressive Loading And Query Boundaries

`hasMore` and `loadingMore` default false. When `hasMore` and `onLoadMore` are
supplied, a near-end sentinel requests another bounded batch and an explicit
Load more action remains available. `loadMoreError` or a rejected callback
shows a Retry action without an automatic retry loop. Concurrent sentinel/click
attempts are single-flight. The root controller owns actual batching, response
ordering and consistent query results; the grid does not merge arbitrary caches.
With `onLoadMore` supplied, a nonempty settled window and `hasMore: false`
shows “All X matching records loaded.” Loading or refresh-required state never
claims that the result is complete.

`refreshRequired` defaults false. When true it stops continuation and disables
record edits, showing `refreshMessage` or the standard consistent-view message
with a Refresh action through `onReload`. It is not permission to append a
shifted server page. See the [controller](./controller.md) for sequence fencing.

`queryKey` defaults an empty string. Change it when search/filter/sort identity
changes: query-specific header/cell editors and focus are retired, scrolling
resets, and an old load error cannot replace the new query's state. Local widths
remain for the same table. A changed table clears sizing. Authorization boundaries
must also retire the connected controller/workspace; a query key is not an auth
credential or organization selector.
The progressive controller's window identity also includes the actual SDK
surface instance, so a replacement source cannot retain another source's rows
merely because its scope/table/query strings happen to match.

## Related Guides And Next Steps

- [Inline cells](./inline-cell.md) owns keyboard/save/conflict behavior.
- [Controller](./controller.md) owns ordered rows and queries.
- [Inspector](./inspector.md) owns right-panel row information.
- [Workspace](./workspace.md) gives complete composition.
- [Semantic Table](../components/primitives/tables-and-pagination.md) owns the
  additive wrapper-class option and unchanged default behavior.

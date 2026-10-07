---
id: zero.frontend.data-controls.data-table.configuration
type: reference
audience: [developer, agent]
owner: frontend-data-controls
status: draft
visibility: internal
system: frontend-data-controls
feature: data-table-configuration
maturity: supported
applies_to: ["2.6.0 baseline with unreleased working-tree additions"]
modes: [browser, SSR, array, collection, lazy, server query]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "5aa2a34a47c7bc05b0c6f01849fdbf477dc01ea8"
  snapshot: dirty
  date: "2026-10-07"
  evidence_level: source-observed
---

# DataTable Configuration

[DataTable index](./index.md) · [Documentation index](../../../index.md)

Props configure this table's data/control/presentation state. They do not enable
server resources, change schema migrations or select privileged data planes.
Column metadata is shared with [schema](../../../backend/schema/ui-metadata.md).

## Sources And Fields

| Prop | Shape / behavior | Default |
| --- | --- | --- |
| schema | required SchemaDescriptor | field order/meta/codecs/key |
| source | DataTableSource<T> | explicit source wins all legacy data/collection props |
| data | caller row array | empty array when no source/collection/data |
| collection | table name | normal reactive source unless lazy=true |
| lazy | boolean | false; only affects legacy collection resolution |
| filters | simple field primitive map | optional legacy lazy query filters |
| lazyOptions | LazyCollectionOptions | optional legacy lazy order/dir/limit/offset |
| columns | field-name list | schema fields except tableVisible=false |
| primaryKey | field name override | descriptor key, then supported fallback behavior |
| editable | field-name list | [] |
| columnOverrides | field-to-column override map | optional header/cell/width/minWidth/maxWidth/flex/wrap/truncate/sortable/filterable/editable/sortDescFirst/sortingFn |
| tableLayout | auto or fixed | auto |

See [sources](./sources.md) for the full discriminated shapes. In server mode
row identity can use source.getRowId (string/number); the schema key is preferred
when no override exists. Width override wins field columnWidth. A custom column
cell receives original row, decoded value, columnId and fieldMeta.

## Interaction Controls

| Prop | Shape | Default |
| --- | --- | --- |
| searchable | boolean or search options | false for DataTable |
| sortable | boolean | true |
| filterable | boolean | false |
| filterColumns | field-name list | all filterable columns when generated filters enabled |
| paginated | boolean or `{ pageSize? }` | true for explicit server source, false otherwise |
| selectable | boolean | false |
| initialState | partial initial DataTableState | empty criteria/selection/visibility, pageIndex0/pageSize20 |
| state | partial controlled DataTableState | other facets remain internal |
| onStateChange | receives full next state | optional |
| motion | boolean table row/page/counter presentation | true in current working tree; reduced motion respected |
| cellMotion | `'typewriter'`, `'highlight'`, or `false` | typewriter for eligible existing plain-text cells; other values keep their typed presentation |
| liveUpdates | boolean held-arrival presentation | true for supported complete/server sources; does not stop transport updates |

Search options are fields, placeholder, ariaLabel, collapsedWidth, expandedWidth
and disabled. Built-in server search uses declared fields with OR semantics;
if omitted, string/text-family candidates are derived from visible/schema fields.
Standalone DataTableToolbar defaults searchable=true; MasterDetail also has its
own default. Do not merge those defaults into DataTable's false default.
In the working organism toolbar, nonempty input is published after 90ms;
input display and clearing remain immediate. Standalone DataTableSearch retains
its immediate controlled callback. This is not a global form-input debounce.

Changing search, filters or sort resets pagination. Rows per page preserves the
page containing the old first row for local/offset sources, while cursor sources
start a new history. All page/size changes clear page-local selection; see
[state and columns](./state-and-columns.md#state-and-pagination-resets).
Disabling local pagination renders all supplied rows, not a hidden first page. A server result
remains the page returned by its source; hiding pagination does not fetch every
backend row or remove server budgets automatically.

## Actions And Events

actions contains RowAction definitions; bulkActions contains explicit-selection
definitions. Both support pending/disabled reason, confirmation and complete
async execution. selectable/onSelectionChange operate current table rows.

onCellCommit is an authoritative custom writer replacing the normal source update.
Legacy onCellEdit acts as a writer only without source actions; after a source
update it is an accepted follow-up notification and cannot cause repeating that
write if it fails. Both receive rowId, columnId, encoded value and optional mutation
context. Keep ownership in the server policy, not the editable list.

onRowClick/onRowDoubleClick receive the original row. highlightedRowId marks an
explicit selection/display identity. onSelectionChange receives selected IDs;
it does not select every server match. getRowClassName can customize per-row
presentation and className customizes the outer component.

## Toolbar And Presentation

toolbarActions is the legacy table-aware action outlet; toolbarSlots supplies
controls, actions and supplemental outlets. Slots are ReactNode or a function
of toolbar context. toolbarLabel and toolbarClassName control the toolbar label/
style. showToolbar overrides automatic visibility; otherwise search/filter/slots/
actions/bulk-action presence determines whether the toolbar appears.

showExport and showColumnVisibility default true when the toolbar is rendered.
They do not force an otherwise hidden toolbar to appear. exportFilename defaults
export.csv. emptyState/loadingState are ReactNode overrides; errorState receives
the source error and retry function. Keep supplied error text safe; source errors
are not a generic secret-redaction UI.

Server controls stay mounted during refresh. Pending/loading feedback and page
buttons reflect the accepted source state; old responses/results are fenced
instead of replacing newer queries or organizations. Exact unknown/known page
semantics are in [server sources](./server-sources.md).

## Working Motion And Live Options

The current development additions use existing Zero visuals, with table-scoped
motion rather than a global theme change. `motion: false` disables that
presentation, not source requests, acknowledgment or pending-authority guards.
`liveUpdates: false` disables holding/fresh-arrival presentation, not automatic
refetch. Server `source.live: false` separately disables automatic invalidation/
subscriptions, while `source.prefetch: false` disables speculative requests.
These are ordinary React options, not new app-config settings or backend grants.

Holding needs stable unique IDs and a baseline. Complete arrays must represent
the caller's complete accepted dataset; collection/server arrival evidence uses
admitted genuine INSERTs rather than snapshots or arbitrary result joins.
Server counts include genuine INSERTs confirmed by accepted pages or supported
bounded, authorized membership lookups; off-page totals are not inferred from
count differences. [Motion and live updates](./motion-and-live-updates.md)
owns the timing, reading-window, reduced-motion and keyboard contract.

This section and the new options describe the working tree against the stated
baseline, not the already-published 2.6.0 archive.

## Read Time And Verification

Props are ordinary React/query inputs. Controlled state is not persisted unless
the app deliberately stores it, and source mode/authority replacement resets
relevant rows/selection/edit requests. Table props have no automatic env bindings
or Doctor browser simulation. Use the normal [provider](../../runtime/app-provider.md)
for integrated sources and qualify every custom writer/adapter's own contract.

## Related Guides And Next Steps

- [Sources](./sources.md) owns resolution/execution semantics.
- [Server sources](./server-sources.md) owns query/results and pagination.
- [Motion and live updates](./motion-and-live-updates.md) owns presentation timing and genuine-arrival evidence.
- [Schema UI metadata](../../../backend/schema/ui-metadata.md) owns column hints.
- [SDK receipts](../../sdk/acknowledged-mutations.md) owns accepted realtime writes.

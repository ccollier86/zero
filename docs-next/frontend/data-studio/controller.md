---
id: zero.frontend.data-studio.controller
type: reference
audience: [developer, agent]
owner: data-studio
status: draft
visibility: internal
system: data-studio
feature: controller
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

# Organization-Scoped Data Studio Controller

[Data Studio index](./index.md) · [Documentation index](../../index.md)

useDataStudio(options) is the public React controller from the root/React or
/react/hooks barrel. It reads the integrated client and live authorization scope;
no privileged browser principal or raw database is required.

```tsx
import { useDataStudio } from '@zero/framework/react';

const studio = useDataStudio({ tableStatus: 'active', pageSize: 25 });
```

This fragment belongs in React under the normal provider. See
[configuration](./configuration.md) for exact initial options/defaults.
status is idle/loading/ready/disabled/denied/error. capabilities contains server
enablement/permissions/limits; access is canRead/canWrite/canManage.

## Read State And Controls

The result exposes tables, selectedTableId/selectedTable, rows/totalRows,
selectedRowId/selectedRow/selectedRowIndex, tableStatus, search, filters,
sortColumnId/sortDirection, offset/previousOffset/nextOffset/pageSize,
isLoading/isLoadingRows/isMutating, error and mutationError.

selectTable/selectRow choose admitted catalog/row identities. selectPreviousRow/
selectNextRow traverse the accepted page (or loaded progressive window). setTableStatus/setSearch/setFilters/
setSort/setOffset update queries; goToPreviousPage/goToNextPage use recorded
continuations. reload() refreshes catalog/detail; reloadRows() refreshes the
active row page/window and can return a page or void if unavailable.

## Progressive Windows

`rowLoading: 'progressive'` enables `loadMoreRows`, `hasMoreRows`,
`isLoadingMore`, `loadMoreError`, `rowsNeedRefresh` and `rowWindowKey`.
The connected DataStudio chooses this mode by default; the standalone hook keeps
`'paged'` as its compatibility default. Page controls remain useful for other
screens, not the progressive Studio grid. `scopeKey` is a presentation boundary
identity, never a client-controlled database selector.

Each continuation is bounded by the server page-size and byte limits. Returned
`readSequence` belongs to the **same strong Fabric query** that read the rows.
Offsets may shift during concurrent inserts/deletes, so only contiguous,
unique-ID pages with equal sequences/totals are joined. A mismatch keeps the
previous accepted window, disables continuation/editing and asks for a refresh;
it never silently deduplicates a shifted page. A refresh reconstructs the already
loaded prefix in bounded batches and publishes it atomically. Drift permits one
restart, not an unbounded retry loop. An unrelated write in the same physical
database may conservatively require refresh too.

Query/scope/schema changes synchronously hide old membership and cancel/ignore
superseded requests. Each query owns its ordered IDs separately from the shared
record cache. Reactive changes and accepted writes refresh the loaded prefix;
selection survives by row ID when it remains in the same query. Legacy response
payloads still parse without the additive token, but progressive continuations
require a token; use the matching updated server or paged mode.

Search/filters/sort run server-side, not over a shared cache's arbitrary membership.
Schema/table changes reset incompatible filters/sort/paging. Search is debounced.
Rows/queries are scope-partitioned, obsolete responses are fenced and live Sync
signals reconcile catalog/rows through authenticated reads.

## Mutation Methods

createTable(input), updateTable(input without expectedRevision), updateSchema(schema)
and changeTableStatus(status) return accepted table promises. All three update
methods accept optional `{ expectedRevision }` as their second argument. Dialogs
and anchored column editors supply the revision captured at opening, rather than
substituting the newest revision after a live refresh.
createRow(values), replaceRow(row, values), updateCell(row, columnId, value) return
accepted rows; deleteRow(optionalRow) returns Promise<void>.
The controller captures selected table/row revisions and retained operation IDs;
it does not overwrite newer revisions simply because a stale cell is visible.

Error state distinguishes a failed read from a mutation failure. Unknown-outcome
retries retain the same logical operation identity; fresh IDs can duplicate work.
Read the [SDK](./sdk.md) before implementing custom retry controls.

Scope changes clear selection/paging/mutation tracking and suppress old outcomes.
Unmount/cancellation cannot roll back a completed server write. UI narrowing is
not permission escalation. The controller's SSR fallback does not start a real
browser transport from server rendering.

## Related Guides And Next Steps

- [SDK](./sdk.md) owns transport/idempotency errors.
- [Inline cells](./inline-cell.md) owns draft conflict UX.
- [Workspace](./workspace.md) owns packaged layout/actions.
- [Configuration](./configuration.md) owns options and readiness.

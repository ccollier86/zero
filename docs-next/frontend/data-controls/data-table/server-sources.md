---
id: zero.frontend.data-controls.data-table.server-sources
type: reference
audience: [developer, agent]
owner: frontend-data-controls
status: draft
visibility: internal
system: frontend-data-controls
feature: data-table-server-sources
maturity: supported
applies_to: ["2.6.0 baseline with unreleased working-tree additions"]
modes: [browser, server offset, custom cursor, single-database, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "054941b23544c9320d7ff739ae3ae1a927c67996"
  snapshot: dirty
  date: "2026-10-25"
  evidence_level: source-observed
---

# Server-Driven Table Queries

[DataTable index](./index.md) · [Documentation index](../../../index.md)

Server sources make existing search, filters, sort headings and page controls
describe a server query. Accepted server rows are not filtered/sorted/paged a
second time in the browser. While a new query loads, the preceding same-scope
page can remain presentation-only; it is not the new query's accepted response. Use this mode for large
tables, server policy/query budgets or strict query membership.

The bounded cache/prefetch, exact filtered totals, previous-page metadata and live-INSERT evidence below
describe current working-tree additions. Their presence in this draft is not a
claim that the published 2.6.0 archive contains the new behavior.

## Built-In Offset Source

```tsx
import { DataTable } from '@zero/framework/react';

<DataTable
  schema={tasks.schema}
  source={{ type: 'server', table: 'tasks' }}
  columns={['title', 'done']}
  searchable={{ fields: ['title'], placeholder: 'Find tasks…' }}
  sortable
  paginated={{ pageSize: 20 }}
/>;
```

This fragment requires the normal configured client, an admitted /api/data table
and appropriate server policy. The default adapter calls client.fetch with the
normal authentication/refresh/scope transport. Choosing table/pagination in the
browser never grants another organization's authority or changes Fabric placement.

createDataTableApiAdapter and buildDataTableServerQuery are public from the
data-table subpath for explicit composition. The generated built-in API supports
offset, not opaque cursor pagination; cursor requires a custom adapter.

Built-in offset sources request `includeTotal=true` by default. The response's
`page.total` is the exact number of authorized rows matching the current search
and filters, not the current batch size or the shared client cache's size. Set
`source.includeTotal: false` to use the cheaper lookahead-only query when exact
counts are unnecessary. This option controls the built-in request; it does not
discard a valid total supplied by a custom adapter or manufacture cursor progress.

Lower-level, browser-safe query helpers are available from
`@zero/framework/react/query-params`: `appendDataFilter`, `appendDataFilters`,
`buildDataPageQuery`, `buildResourceListQuery`, `normalizePage`,
`normalizePageSize`, `normalizeResourcePrefix` and `stableValueKey`, with the
data-filter/page types. These are pure encoders/state helpers, not transport or
authorization. Ordinary tables should keep using the built-in adapter rather
than rebuilding it. [Source-copy](../../../cli/tooling/source-copy.md) retains
this focused package dependency when an application owns a copied DataTable.

## Query Contract

DataTableServerQuery contains:

| Member | Shape |
| --- | --- |
| search | string global query |
| filters | TanStack column filter entries `{ id, value }` |
| sorting | ordered `{ id, desc }` entries |
| pagination | mode offset/cursor, nonnegative pageIndex, positive pageSize and optional cursor |
| searchFields | optional explicit column names for built-in OR search |

The built-in encoder accepts `buildDataTableServerQuery(table, query,
{ includeTotal?: boolean })`; explicit adapters accept
`createDataTableApiAdapter(client, table, primaryKey?, { includeTotal?: boolean })`.
The default is true. Aggregate preference belongs to the source/transport, not
the custom adapter's search/filter query snapshot.

Built-in fields/table IDs must be safe column identifiers. Query snapshots validate
criteria before async work: search length at most1024, filters at most64, sort
fields at most8 and search fields at most16. Duplicate sort IDs/invalid pagination/
nested filter expressions reject. These client bounds do not replace server
field/query permission or request budgets.

Filter values can be a primitive, primitive array or `{ op?, value }` expression.
Supported explicit operators are eq/ne/gt/gte/lt/lte/like/contains/in. Plain string
filters on declared search-text fields use contains; other ordinary values use
the shared data-query contract. The built-in encoder trims search and requires
search fields for nonempty search. Applications do not submit raw SQL.

Changing search/filter/sort resets paging and cursor history. Changing page size
for an offset source instead requests the new page containing the former first
row: `floor(oldPageIndex * oldPageSize / newPageSize)`. Cursor batch-size changes
reset index0/cursor:null and clear visited history, because an opaque cursor
cannot be reconstructed from that offset. Both retire page-local selection.
A custom adapter receives the normalized query and `{ signal: AbortSignal }`, and must
return its complete promise, not mutate shared rows behind the source.

## Custom Cursor Fragment

```ts
import type {
  DataTableServerAdapter, DataTableServerResult,
} from '@zero/framework/components/data-table';

// Fragment: Task is the app's stored row; endpoint is app-owned and scoped.
const adapter: DataTableServerAdapter<Task> = {
  query(query, { signal }) {
    return client.fetch<DataTableServerResult<Task>>('/api/task-page', {
      method: 'POST', body: query, signal,
    });
  },
};
// Use source={{type:'server',table:'tasks',pagination:'cursor',adapter}}.
```

The app endpoint interprets the cursor, enforces authority and returns the declared
result; this example does not create such a route. Retain a stable adapter identity
(module constant or deliberate memo). Replacing it means a different source and
retires old requests/cursors/selection even when table name is unchanged.

## Refresh Stable Server Sources

DataTable, its DataTableView alias and MasterDetailPage/MasterDetailView accept
`refreshKey?: string | number`. Change this value after an accepted external
create, edit or claim to invalidate cached/speculative pages and refetch the
current search, filters, sorting, page size and page/cursor. This is an ordinary
React prop, not a new backend permission, source identity or component key.
Its initial value does not add another initial fetch, and an unchanged value
does not refetch. Non-server sources ignore this key.

```tsx
import { useMemo, useState } from 'react';
import { DataTableView, type DataTableServerAdapter } from '@zero/framework/components/data-table';

// Fragment inside a configured application. client, schema and claimRecord are app-owned.
const [revision, setRevision] = useState(0);
const adapter = useMemo<DataTableServerAdapter<Task>>(() => ({
  query: (query, { signal }) => client.fetch('/api/joined-task-page', {
    method: 'POST', body: query, signal,
  }),
}), [client]);

<DataTableView schema={schema}
  source={{ type: 'server', table: 'tasks', adapter }}
  refreshKey={revision}
  toolbarSlots={{ actions: ({ selectedRowIds, refresh }) => (
    <button type="button" disabled={!selectedRowIds.length} onClick={async () => {
      await claimRecord(selectedRowIds); // Resolve only after the server accepts the change.
      await refresh();
    }}>Claim selected</button>
  ) }}
/>;

// A separate dialog/action can instead call setRevision(value => value + 1)
// after its accepted write. Use one invalidation path per action, not both.
```

Toolbar `refresh(): Promise<void>` and the public `useDataTableSource().refresh`
wait for the owned foreground query to settle. Normalized query failures appear
through the source's existing error/retry presentation; they do not reject an
already accepted write or automatically execute it again. Superseded/retired
requests settle without admitting stale data. A callback retained from a replaced
source or authorization partition cannot refetch the replacement partition.

Same-partition refresh retains accepted rows and mounted controls while pending,
preserves interaction state and selection for surviving identities, and marks
the accepted result as `changeReason: 'refresh'`. Normal changed-result membership
and pagination rules still apply: it cannot keep a deleted selected row alive or
invent an opaque cursor if a server invalidates one. Current authority fencing,
abort handling and last-query-wins behavior remain in force. Refresh does not
manufacture live INSERT evidence or a new-record count.

Do not replace the adapter, add a React `key`, unmount/remount, or publish fake
INSERT/UPDATE events just to refresh a joined query. MasterDetail's generated
server detail-update path already refreshes after acceptance; its context and
list toolbar also expose refresh for other actions.

## Result And Pagination

DataTableServerResult is `{ rows, page }`. Offset page includes mode:'offset',
offset, hasMore and optional total. Cursor page includes mode:'cursor', hasMore,
optional nextCursor/previousCursor and optional total. The source validates row
records, requested mode and page metadata before admitting the result.

Each accepted row needs a nonempty primary-key/custom identity and must be unique
within the page. getRowId can return a string/number; UI identity is normalized
consistently. Missing/duplicate row identity is not quietly substituted with an
index in server mode.

An exact total is optional. Without it the UI displays a visible range and next/
previous behavior, not an invented count or last-page jump. Cursor Next requires
an available nextCursor; previous-page navigation uses retained query cursor
history. Even with an exact total, cursor mode does not invent a last-page cursor.
Hiding pagination does not remove server limits or fetch all records.

With an accepted exact offset total, the footer derives
`pageCount = ceil(total / pageSize)` and fills its progress track to
`min(pageIndex + 1, pageCount) / pageCount`. The accepted total rolls per digit;
the fill animates with the shared 700ms motion. Live INSERT, UPDATE and DELETE
invalidation re-queries the same filters and returns rows and total together. An
arrival that adds another page automatically changes the denominator; deletion
can reduce it. There is no separate polling loop or guessed count increment.
The held-new-record pill counts confirmed received INSERTs, not all matching rows.

The built-in `/api/data` handler reads COUNT and the bounded page inside one
ReactiveDB transaction, or one Fabric `findPage` actor snapshot for tenant files.
Both use the same validated row-policy/search/filter predicates; field projection,
current authority and delivery fences still apply. No additional schema or
migration is needed. Exact COUNT can cost more than lookahead on large or complex
filtered datasets; use appropriate existing indexes or the explicit opt-out.

If an accepted offset response supplies an exact total and the current index
is no longer in range, the table requests the last remaining page. It does not
infer a total or clamp from a short/empty unknown-total batch. Search, filter,
sort and source/authorization changes still reset to the start, independently
of the page-size anchor.

## Requests, Live Updates And Scope

Superseded requests are aborted; generation/signature/authority fences prevent
late results/errors from replacing a new query. Fetches start immediately, not
after a presentation animation. Toolbars and navigation stay usable while loading.
Previous rows/page metadata can remain visible only inside the exact readable
authorization/source partition; different-query rows are presentation-only and
their row/bulk mutation interactions are unavailable.
Source/organization replacement clears old visible rows and relevant selection,
pending edit/cursor state.

Server records and their order remain separate from the shared collection.
When a registered reactive collection changes and live is not false, the table
refetches its own query; it does not blindly append every cached row to this page.
Custom external backends gain no automatic event subscription merely from this
flag or from sharing a table name with a Sync table; opt into the adapter contract
below.

Mutations need an acknowledged source writer or an authoritative custom callback.
For unsynchronized logical server tables there may be no collection action to
reuse; supply the normal scoped app/resource writer rather than raw SQL/browser
service handles. Query authority and write authority remain distinct.

## Bounded Prefetch And Cache

`source.prefetch` defaults to true. The source speculatively requests known
neighboring pages after accepting a page, and footer hover/focus intent calls the
same `prefetchPage(pageIndex)` owner. Foreground navigation promotes/joins a
matching speculative request instead of downloading it twice. Offset targets
must be within a supplied total, or an already-supported previous/known next
range. Cursor targets require a returned or bounded captured opaque cursor.
There is no fabricated cursor or unbounded full-table prefetch.

The active partition retains at most five cached pages, at most 1000 rows per
cached page, with a 30-second freshness window and at most two speculative
transports. Larger custom batches remain valid foreground results but are not
cached/speculatively downloaded. These are page/row bounds, not a guarantee
about arbitrary custom row byte sizes. Identity includes table, adapter/client,
row identity, authorization boundary and the complete normalized search/filter/
sort/page/cursor query. Built-in source identity also includes its aggregate
request preference. Refresh and live invalidation discard stale cached pages.
Authorization/source replacement discards the whole old partition.

Abort is advisory to the endpoint, but retired promises settle and late ignored-
abort receipts cannot enter the cache or visible page. Set `prefetch: false` to
stop/retire speculative work without disabling an admitted foreground query.
Speculative failures use the normal content-free data-page observation and do
not replace a successful foreground page with an error.

`useDataTableSource` exposes these additive server metadata fields:

| Member | Meaning |
| --- | --- |
| `prefetchPage(pageIndex)` | Complete promise for an admitted known-page speculative read; unavailable/retired targets do nothing. |
| `isPreviousData` | Rows belong to a preceding query in the same exact readable partition. |
| `requestKey` / `resolvedRequestKey` | Opaque current target / currently presented accepted result identities; do not parse them as authority. |
| `resultRevision` | Monotonic local accepted-result revision, not a database revision or proof of INSERT. |
| `changeReason` | `query`, `refresh` or `live`; live means invalidation, not a new-record count. |
| `liveInsertedRowIds` | Genuine INSERT IDs confirmed by the exact accepted current response. |
| `confirmedLiveInsertedRowIds` | Genuine INSERT IDs confirmed against the current criteria separately from page membership; lookup rows are not merged into the page. |
| `liveLeadingRowId` | Current authorized first sorted identity (`null` for no result, `undefined` for unknown); qualifies the new-record jump, not the count. |
| `clearLiveInsertions()` | Retire pending/confirmed insertion evidence on reveal; normal table composition calls this automatically. |

## Live Insert Evidence And Custom Subscriptions

The built-in data API source can observe admitted SDK `sync.change` operations
for its exact table. The SDK has already enforced current socket/stream authority;
the table additionally fences the current query/source/browser authorization
boundary. Snapshots, catchup, optimistic dispatch, cache hits and ordinary result
joins are never INSERT evidence. Existing IDs do not become new merely because
their values update or a neighboring page is loaded.

A custom `DataTableServerAdapter<T>` can add this optional synchronous subscription:

`subscribeChanges(query, listener, { signal }): () => void`

The captured query is a normalized snapshot. The listener receives
`DataTableServerChange` with `op: 'INSERT' | 'UPDATE' | 'DELETE'` and a nonempty
stable string `rowId`, using the same result identity as the adapter's rows.
Return an unsubscribe function and retire the stream on `signal` abort. This is
an app-owned authoritative server-change stream, not an instruction to call the
listener for snapshots, optimistic writes or every object added to a cache.
Both types are available from `@zero/framework/components/data-table` and the
normal React facade.

Each event invalidates/refetches the current query. A bounded ledger stages only
genuine INSERT IDs; a rapid status UPDATE retains their insertion provenance and
a DELETE retires it. The next accepted response establishes current server
search/filter/page membership. Only matching staged IDs are emitted in
`liveInsertedRowIds`, once; no local approximation of SQL/search semantics is
used. Changes during initial baseline loading are ordinary initial data, not
new-record notifications. Query/source/authority replacement retires evidence,
and `source.live: false` retires automatic subscriptions/invalidation.

The separate membership ledger can confirm an off-page INSERT without downloading
the table. The built-in adapter uses the known schema primary key and the same
authenticated query API: it retains search, search fields, filters and sorting,
adds an `IN` filter for the candidate IDs, and requests a bounded first batch.
Only exact candidate IDs returned by this authorized query are admitted. These
lookup records do not enter the current page, its cache or the shared collection.
Membership probes explicitly omit exact counts; totals come from the normal page
request, not these bounded candidate checks.

For an app-owned transport, optionally implement:

`confirmInsertedRows(query, rowIds, { signal }): Promise<readonly string[]>`

Return only IDs from `rowIds` that currently match the captured query and the
caller’s live read/resource authority. The identity must agree with the adapter's
result identity, including any custom `getRowId`. A local text/filter approximation,
unfiltered ID lookup, aggregate count difference or optimistic cache is not a
valid implementation. Without this method a custom adapter still confirms
current-page INSERTs through its ordinary result; it does not fabricate off-page
membership. A built-in source with a custom row-identity mapping, no usable key,
or a policy denying key filtering also retains the conservative page-only behavior.

The lookup work is bounded and cancellable: at most 1000 candidate identities,
bounded batches of at most 50 IDs, and one active membership request. Overlong
IDs/filter expressions or queries with no room for the additional filter do not
bypass backend validation. Confirmations survive page navigation within the same
criteria, but search/filter/sort/page-size/source/authority replacement and reveal
retire them. UPDATE rechecks a tracked ID's membership; DELETE removes it, and
stale receipts cannot restore it. Errors use content-free observations without
replacing a successful displayed page. `liveUpdates={false}` skips these extra
membership reads in normal DataTable composition while leaving refetch enabled.

This is **not** an authoritative total of every unseen matching record: it covers
only genuine received INSERTs admitted after the loading baseline. Normal offset
revalidation may shift page membership after concurrent writes; the lookup does
not imply snapshot isolation or discover an inserted row's global rank. Use a
custom cursor/snapshot API when stronger consistency is required.
[Motion and live updates](./motion-and-live-updates.md) explains how confirmed IDs
participate in held presentation without being selected/exported as loaded rows.

### Sort-Aware New-Record Navigation

The centered `N new` indicator is clickable only when a counted genuine arrival
is the first result of the active sort. Otherwise it remains a passive rolling
count. A membership match or increasing total alone does not prove that page one
contains the new record at its beginning.

An accepted current first page supplies its first identity directly. Away from
page one, the built-in adapter performs a bounded, authenticated `limit=1`,
`offset=0` read with the same search/filter/sort and no count request. Its receipt
does not populate the visible page, page cache or shared collection. Reads are
demand-driven only while genuine candidates exist, coalesce invalidations and
abort/retire across criteria, source, authority, later mutations and reveal.
Failures use the existing content-free observation; they leave the count passive.

Custom adapters can optionally implement:

`getLeadingRowId(query, { signal }): Promise<string | null>`

Return the first identity under those exact authorized criteria and stable result
identity, or null for an empty result. The captured query is a first-page,
one-record request; adapters still enforce their own query/tenant policy and
cancellation. Without this capability, later-page counts remain passive unless
position can be established by a current accepted first page. Do not return an
INSERT ID, the newest timestamp or a cache's first row as a ranking approximation.
The ordinary authoritative page total and progress fraction remain independent.

## Errors And Verification

DataTableServerSourceError uses stable, content-free boundary codes:
DATA_TABLE_SERVER_CLIENT_REQUIRED, DATA_TABLE_SERVER_CURSOR_ADAPTER_REQUIRED,
DATA_TABLE_SERVER_QUERY_INVALID, DATA_TABLE_SERVER_QUERY_FAILED and
DATA_TABLE_SERVER_RESPONSE_INVALID. Failure observation uses the standard frontend
data-page event with table/mode/code metadata, not raw query payloads/credentials.

Test search/sort/page requests, unknown totals, cursor history, out-of-order
responses, adapter/tenant replacement, duplicate IDs and no double browser
filter/pagination. Focused cache/event and actual hook browser checks cover the
working additions using synthetic deferred adapters/provider boundaries. Actual
table/MasterDetail browser regressions cover their integrated paths; custom
adapter and installed-package qualification remain
the app/release's own gates.

## Related Guides And Next Steps

- [Sources](./sources.md) compares local/lazy/server contracts.
- [Configuration](./configuration.md) owns table props/defaults.
- [Motion and live updates](./motion-and-live-updates.md) preserves the reading window without inventing server counts.
- [SDK HTTP](../../sdk/http.md) owns authenticated custom adapter transport.
- [Scope boundary](../../runtime/authorization-scope-boundary.md) protects custom state.

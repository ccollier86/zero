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
applies_to: ["2.6.0 working source; release qualification pending"]
modes: [browser, server offset, custom cursor, single-database, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "ae85a4b6efe11eeb74ab89b15ed02a23e982c59f"
  snapshot: dirty
  date: "2026-10-07"
  evidence_level: source-observed
---

# Server-Driven Table Queries

[DataTable index](./index.md) · [Documentation index](../../../index.md)

Server sources make existing search, filters, sort headings and page controls
describe a server query. Only the accepted response is rendered; the browser
does not filter/sort/page an already-filtered page again. Use this mode for large
tables, server policy/query budgets or strict query membership.

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

If an accepted offset response supplies an exact total and the current index
is no longer in range, the table requests the last remaining page. It does not
infer a total or clamp from a short/empty unknown-total batch. Search, filter,
sort and source/authorization changes still reset to the start, independently
of the page-size anchor.

## Requests, Live Updates And Scope

Superseded requests are aborted; generation/signature/authority fences prevent
late results/errors from replacing a new query. Toolbars stay mounted during
refresh, while accepted rows/page metadata belong only to their query/source scope.
Source/organization replacement clears old visible rows and relevant selection,
pending edit/cursor state.

Accepted by-ID records and ordered IDs remain separate from the shared collection.
When a registered reactive collection changes and live is not false, the table
refetches its own query; it does not blindly append every cached row to this page.
Custom external backends gain no automatic event subscription from this flag.

Mutations need an acknowledged source writer or an authoritative custom callback.
For unsynchronized logical server tables there may be no collection action to
reuse; supply the normal scoped app/resource writer rather than raw SQL/browser
service handles. Query authority and write authority remain distinct.

## Errors And Verification

DataTableServerSourceError uses stable, content-free boundary codes:
DATA_TABLE_SERVER_CLIENT_REQUIRED, DATA_TABLE_SERVER_CURSOR_ADAPTER_REQUIRED,
DATA_TABLE_SERVER_QUERY_INVALID, DATA_TABLE_SERVER_QUERY_FAILED and
DATA_TABLE_SERVER_RESPONSE_INVALID. Failure observation uses the standard frontend
data-page event with table/mode/code metadata, not raw query payloads/credentials.

Test search/sort/page requests, unknown totals, cursor history, out-of-order
responses, adapter/tenant replacement, duplicate IDs and no double browser
filter/pagination. Actual table/MasterDetail browser regressions cover those
corrected source paths; custom adapter and installed-package qualification remain
the app/release's own gates.

## Related Guides And Next Steps

- [Sources](./sources.md) compares local/lazy/server contracts.
- [Configuration](./configuration.md) owns table props/defaults.
- [SDK HTTP](../../sdk/http.md) owns authenticated custom adapter transport.
- [Scope boundary](../../runtime/authorization-scope-boundary.md) protects custom state.

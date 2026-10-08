---
id: zero.sync.lazy-data
type: reference
audience: [developer, agent, operator]
owner: sync
status: draft
visibility: internal
system: sync
feature: lazy-data
maturity: supported
applies_to: ["2.6.0 baseline with unreleased authorized exact-total queries"]
modes: [single, multi, default-plane, system-plane, tenant-database]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "b3b17b48af079ed56ebfd94f0d76889ee7d91267"
  snapshot: dirty
  date: "2026-10-08"
  evidence_level: source-observed
---

# Query Lazy Data Without Confusing The Cache

[Sync index](./index.md) · [Documentation index](../../index.md)

Managed composition installs GET /api/data. Apps use the authenticated SDK and
server-query table source; createDataQueryPlugin is not a named public package
export to copy into app code.

## Query Contract

Requests name an admitted table and may include repeated filter (field:value),
search plus searchField, repeated sort (field:asc|desc), legacy order/dir,
limit, offset and optional `includeTotal=true|false`. Columns are checked against the server catalog and values
remain parameterized. Resource HTTP exposure and current read/row/field policy
still apply.

The internal endpoint defaults to 500 rows, caps limit at 1000 and returns rows
plus page metadata: limit, offset, count, hasMore and nextOffset. count describes
the returned page, not an exact global total. The endpoint requests one extra
row to determine hasMore. Exact counting is opt-in at the HTTP boundary; omitted
or false `includeTotal` preserves the existing lookahead-only response without
`page.total`. Other flag values are rejected, not interpreted as truthy strings.

With `includeTotal=true`, `page.total` counts all rows matching the same admitted
search/filter and row-policy predicates, excluding pagination. COUNT and the
bounded page share one ReactiveDB transaction or one tenant-bound Fabric
`findPage` snapshot and sequence. Read authority is checked again before either
rows or count can be delivered. A caller-selected table or flag grants no new
tenant/field authority; counts never include unauthorized rows.

Built-in offset DataTable sources request exact totals by default and revalidate
them through existing Sync invalidation. Set `source.includeTotal: false` for
lookahead-only navigation when count cost is undesirable. Ordinary lazy reads
remain unchanged. Exact counting downloads no full dataset and requires no new
table/migration, but complex unindexed predicates can still be expensive.

## Page Ownership

A reactive collection is a shared record cache, not the membership/order of
every query. Each accepted server page must retain its own ordered IDs. A row
cached by another table/query must not appear in this result merely because it
is in the collection.

The corrected useDataPage contract owns accepted page IDs and retained visible
snapshots. Visible record updates can use the cache; authoritative server
changes trigger a scoped query reconciliation. Local cache replacement is not
a server deletion. Superseded responses and old authorization scopes cannot
overwrite the current result.

Use [data pages](../../frontend/sdk/data-composition.md) and
[server table sources](../../frontend/data-controls/index.md) to keep the same
search/sort/pagination controls while letting the server query. Do not apply
browser filtering or pagination a second time to an already paged result.

See [resource queries](../resources/queries.md), [snapshots](./snapshots.md),
[Data Studio queries](../data-studio/queries.md) and [configuration](./configuration.md).

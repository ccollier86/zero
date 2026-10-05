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
applies_to: ["2.1.1 baseline with unreleased paged-query ownership correction"]
modes: [single, multi, default-plane, system-plane, tenant-database]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
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
limit and offset. Columns are checked against the server catalog and values
remain parameterized. Resource HTTP exposure and current read/row/field policy
still apply.

The internal endpoint defaults to 500 rows, caps limit at 1000 and returns rows
plus page metadata: limit, offset, count, hasMore and nextOffset. count describes
the returned page, not an exact global total. The endpoint requests one extra
row to determine hasMore instead of requiring an expensive total-count query.

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

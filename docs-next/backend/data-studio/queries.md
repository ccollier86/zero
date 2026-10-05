---
id: zero.data-studio.queries
type: how-to
audience: [developer, agent]
owner: data-studio
status: draft
visibility: internal
system: data-studio
feature: queries
maturity: supported
applies_to: ["2.1.1 baseline with unreleased datetime calendar correction"]
modes: [multi, advanced-RBAC, tenant-database]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Server Search, Typed Filters And Ordered Pages

[Data Studio index](./index.md) · [Documentation index](../../index.md)

listRows is a server-evaluated logical query. It accepts bounded limit/offset,
search, filters, sortColumnId and sortDirection with a request signal.

## Browser Example

```ts
import type { Client } from '@zero/framework';
export function listOpenRecords(client: Client, tableId: string) {
  return client.dataStudio.listRows(tableId, {
    limit: 20,
    filters: [{ columnKey: 'done', operator: 'eq', value: false }],
    sortColumnId: 'title_col',
    sortDirection: 'asc',
  });
}
```

Filters use the current schema's columnKey vocabulary; sorting uses the stable
columnId. Column keys can change only through an admitted new schema revision, so
app-defined saved queries should reconcile schema changes.

## Operators And Types

eq/ne/gt/gte/lt/lte/contains have schema-typed scalar operands.
Contains is literal text substring, not SQL wildcard injection.
Null supports equality/inequality over physically present cells; absence and
stored null are not the same match.
Boolean/JSON support their admitted equality forms, not numeric range coercion.

Search uses escaped LIKE over typed text projections.
Parameterization, closed field/operator admission and stable primary record
tie-breakers prevent arbitrary SQL fragments.

## Pagination

Default/maximum limit25. The response includes rows,total,limit,offset,nextOffset
and additive `readSequence`, captured from the same strong Fabric query result.
The768KiB response budget can shorten a page; follow actual nextOffset, not
offset+requested limit blindly.

Progressive clients compare snapshot sequences and totals before joining offsets.
Concurrent inserts/deletes can shift offset membership, even with stable sorting;
changed sequences require a coherent refresh rather than silently skipping or
deduplicating records. The packaged Studio rebuilds its loaded prefix in bounded
batches and publishes it atomically. It permits one drift restart, then presents
Refresh instead of looping under continuous writes. This is a refresh boundary,
not a long-lived SQLite snapshot or a new cursor capability. Writes to another
table in the same database can conservatively invalidate a continuation.

Query membership/ordered IDs are separate from the shared record cache.
Do not append cached rows from another query/table or apply browser filtering/
paging again. Scope changes retire old pages/pending responses.

See [values](./values.md), [limits](./limits.md),
[realtime](./realtime.md), [HTTP API](./http-api.md) and
[frontend queries](../../frontend/data-studio/index.md).

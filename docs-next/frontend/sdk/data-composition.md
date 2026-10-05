---
id: zero.frontend.sdk.data-composition
type: reference
audience: [developer, agent]
owner: frontend-sdk
status: draft
visibility: internal
system: frontend-sdk
feature: data-composition
maturity: supported
applies_to: ["2.1.1 source with audited corrections; package qualification pending"]
modes: [browser, SSR, Guardian single, Guardian multi, single-database, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Accepted Pages, Records And Selection

[SDK index](./index.md) · [Documentation index](../../index.md)

Use integrated data composition hooks from @zero/framework/react for common
query/record screens. Backend Resources/Sync/Fabric/Guardian enforce access;
hook filters and selected IDs do not grant it.

## One Ordered Server Page

```tsx
import { useDataPage } from '@zero/framework/react';

const page = useDataPage<Task>('tasks', {
  filters: { done: false },
  sort: { field: 'updated_at', dir: 'desc' },
  pageSize: 20,
});
```

This fragment assumes a Task declaration and an admitted /api/data table.
DataPageOptions contains filters/sort/pageSize/initialPage/autoLoad/replaceCollection.
Defaults: empty filters, no sort, pageSize50, initialPage1, automatic loading,
replaceCollection=true. Manual refresh remains available when autoLoad=false.

The result exposes rows/page/pageSize/filters/sort/loading/error/pageInfo/hasMore,
refresh, setPage/nextPage/previousPage, setPageSize/setSort/setFilter/setFilters/
clearFilters. Search/filter/sort/page changes send server queries; page numbers
are1-based. Filters and sort/page size reset the page. pageInfo is
{ limit, offset, count, hasMore, nextOffset }, not an exact total.
Legacy responses without metadata use a bounded page-length continuation heuristic.

The corrected hook owns accepted ordered IDs and record snapshots independently
of shared collection membership. Another consumer's merged or replacing cache
load cannot expand/erase this page. Declared custom/string/numeric keys preserve
server order. Visible cache updates replace matching records; absent cache rows
remain in the accepted snapshot until authoritative delete/query reconciliation.
Server changes/catch-up/snapshots trigger coalesced table-scoped refetch; actual
deletes remove affected visible membership. Other tables do not refetch this page.

replaceCollection controls legacy shared-cache hydration, not this hook's result
ownership. Authorization/query partition changes hide old result membership,
abort superseded work and reject late replies. Unmount releases reconciliation.
A browser query/cache key is not an authority token. Query failure telemetry
carries stable safe surface/stage metadata, not filter values/raw errors.

## Typed Query Values

DataPageFilters maps field names to primitives, primitive arrays or
{ op?, value }. Operators are eq/ne/gt/gte/lt/lte/like/contains/in.
Null/undefined operands are omitted by the generic query builder; do not assume
they encode SQL IS NULL. Arrays use comma-separated in transport semantics.
DataPageSort is { field, dir? }; direction defaults desc in builders.
buildDataPageQuery(table,filters,sort,page,pageSize) returns /api/data query text.
buildResourceListQuery(resource,options) uses the generated-resource prefix.
Builders validate/encode transport but do not authorize table/field names.

## Record Composition

useRecord(table,id|null) returns row/exists/update/remove. Its writes are optimistic
void helpers. useRecordByIdentity(table,identity|null) returns row/id/exists/upsert/
update/remove using the table's ordered immutable natural identity.
These hooks observe loaded collection data; they do not fetch absent records.
Use resource record hooks when a server read is required.

useDataSelection(items,options) is local selection state with mode(single|multiple),
initialIds/getId/onChange. Default mode multiple; default getId requires string id
or _id. Custom keys need getId. Result includes selectedIds/selectedId/selectedItems/
count/hasSelection/isSelected/select/selectOnly/deselect/toggle/clear/setSelectedIds.
selectedItems projects current items, while selectedIds can retain absent IDs;
this is not DataTable's explicit current-page bulk target. Scope changes fence
callbacks/reset selection.

## Verification And Compatibility

Working-source regressions reproduce/fix shared-cache leakage of page membership/
server order and manual-refresh suppression. Test concurrent same-table pages,
custom numeric keys, live changes/deletes, failed/superseded reads and scope/unmount.
Existing optimistic record methods retain their signatures; no migration is
implied by page-local state correction.

## Related Guides And Next Steps

- [Data hooks](./data-hooks.md) owns shared-cache reads.
- [Resource hooks](./resource-hooks.md) owns policy-aware HTTP records/lists.
- [DataTable server sources](../data-controls/data-table/server-sources.md) connects
  full built-in table interaction state.
- [Acknowledged mutations](./acknowledged-mutations.md) owns accepted writes.

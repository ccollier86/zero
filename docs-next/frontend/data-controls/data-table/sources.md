---
id: zero.frontend.data-controls.data-table.sources
type: reference
audience: [developer, agent]
owner: frontend-data-controls
status: draft
visibility: internal
system: frontend-data-controls
feature: data-table-sources
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

# Table Sources And Execution Owners

[DataTable index](./index.md) · [Documentation index](../../../index.md)

Choose a source for where rows come from and where search/sort/pagination execute.
The same built-in controls remain available. This is a data/presentation contract,
not a server permission or an alternative tenant/database selector.

## Resolution And Modes

Explicit source wins. Otherwise collection resolves to full collection or lazy
collection when lazy=true; otherwise caller data/empty rows becomes array source.

| Source | Shape | Query execution / row ownership |
| --- | --- | --- |
| data | `{ type:'data', data, actions?, isLoading?, error?, refresh? }` | caller owns rows; browser row models handle controls |
| collection | `{ type:'collection', table }` | SDK reactive local rows; browser handles controls |
| lazy | `{ type:'lazy', table, filters?, options?, replaceOnLoad? }` | HTTP hydrates shared collection; browser controls operate loaded local rows |
| server | `{ type:'server', table, pagination?, adapter?, live?, prefetch?, getRowId? }` | server adapter owns search/filter/sort/page; isolated accepted results |

For ordinary complete arrays/collections, the browser filters/sorts/pages locally.
A lazy collection remains a shared local cache, not a strict server-page membership
view. Use [server source](./server-sources.md) when controls must query the server
and each query needs isolated ordered rows.

The motion/prefetch/live-evidence additions in this draft describe the current
working tree, not an already-published 2.6.0 archive change.

## Caller-Owned Data

Array sources can be standalone. Optional actions supply insert/update/remove
(void or complete promise), load and clear. Loading/error/refresh remain caller
inputs; supply safe errors and a meaningful complete writer, not optimistic
void dispatch pretending to be accepted server work.

Without a source action, inline editing needs an authoritative custom callback.
onCellCommit replaces the source writer; onCellEdit is the legacy writer only
when source actions are absent. Server policy remains final even when an array
renders locally without a provider.

## Collection And Lazy Hydration

Collection sources require the normal [client provider](../../runtime/app-provider.md).
They reuse acknowledged SDK collection actions rather than a second transport.
The table's count/search/export refer to local rows; lazy/partial state is not
an exact database total.

Lazy source filters are a primitive field map; options carry order, dir, limit
and offset through the ordinary /api/data query. replaceOnLoad defaults true
when filters were supplied, false otherwise. Accepted HTTP rows are loaded into
the shared collection. Concurrent/superseded loads use request/abort/scope fences.

Lazy mode is deliberately a hydration contract: authorized subsequent Sync
changes can affect local rows beyond the initial demand-loaded set. Do not treat
an HTTP filter as an authorization rule or sum cached rows into server pagination.
Full/lazy table loading is chosen by server declaration/defaults; the browser's
source mode does not move the table to Fabric.

## Public Hook And Helpers

The data-table subpath exports useDataTableSource, its option/state/action types
and buildDataTableLazyQuery. The hook resolves data, sourceType, table, isLoading,
error, page, refresh and actions. It owns source wiring, not column rendering.
Do not add a second server query under a DataTable that already owns that source.
Server metadata additionally exposes prefetchPage, isPreviousData, opaque
requestKey/resolvedRequestKey, resultRevision, changeReason, liveInsertedRowIds,
confirmedLiveInsertedRowIds and clearLiveInsertions;
see [server cache/evidence](./server-sources.md#bounded-prefetch-and-cache).

buildDataTableLazyQuery encodes primitive filters in sorted field order and
optional legacy order/dir/limit/offset. It is not a SQL compiler or authority
check. Client construction still requires admitted table metadata.

## Server Queries And Reactivity

Server sources keep their accepted by-ID rows and ordered IDs isolated from the
shared collection. Collection state can signal relevant table invalidation and
refetch when live is not false, but another table's cached records do not enter
the accepted page. A custom adapter/unsynchronized logical table must not infer
an automatic external event subscription merely from live=true. An adapter can
explicitly supply the query-bound subscribeChanges contract; the built-in data
source observes admitted SDK Sync changes. Both confirm INSERT membership using
their accepted query result or a supported authoritative membership lookup, not
a local approximation of server filters.

Replacing server table, adapter, pagination mode or row-identity configuration
retires relevant query/selection/cursor state. Auth/tenant/data-authority boundary
replacement additionally masks rows and blocks stale operations. Use stable
custom adapter references rather than allocating a different adapter every render.

## Genuine Arrivals Versus Hydration

Complete caller-owned arrays can classify a new stable ID after their supplied
loading baseline. The owner must not present an arbitrary remote page/hydration
replacement as a complete live dataset. Registered collections use admitted Sync
INSERT evidence, so snapshots/catchup/cache load additions do not become new
record notifications. Lazy partial hydration is not treated as a complete
dataset for automatic holding/count inference.

Server arrivals require genuine stream INSERT IDs confirmed in an accepted page
or by a bounded query-matching lookup. A shifted page can gain old rows without
generating a new-record count, and total differences never manufacture arrivals.
Lookup rows are not merged into the page or global cache. Ordinary offset
revalidation can still shift page membership; stronger cursor/snapshot semantics
belong to the source. [Motion and live updates](./motion-and-live-updates.md)
describes holding, existing-record updates and the effective action/selection
model; [server sources](./server-sources.md#live-insert-evidence-and-custom-subscriptions)
documents unsupported/conservative modes.

## Verification And Compatibility

Test the actual source's owner: arrays update their caller data, collections
wait for receipts, lazy loads do not masquerade as exact pages, and server queries
never apply browser filtering/paging a second time. Exercise failed/old requests
and identity/tenant replacement with synthetic data.

Existing data/collection/lazy props remain supported. Explicit source is additive
precedence, not a requirement to rewrite ordinary array screens. The corrected
MasterDetail composition uses the same query/result controller without inventing
new public source types.

## Related Guides And Next Steps

- [Configuration](./configuration.md) owns table props/defaults.
- [Server sources](./server-sources.md) owns query/result/page metadata.
- [SDK collections](../../sdk/collections.md) owns local cache and receipt actions.
- [Scope boundary](../../runtime/authorization-scope-boundary.md) owns retained custom state.
- [Motion and live updates](./motion-and-live-updates.md) owns source-specific arrival evidence and opt-outs.

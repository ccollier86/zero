---
id: zero.frontend.sdk.data-hooks
type: reference
audience: [developer, agent]
owner: frontend-sdk
status: draft
visibility: internal
system: frontend-sdk
feature: data-hooks
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

# Reactive Collection Read Hooks

[SDK index](./index.md) · [Documentation index](../../index.md)

The integrated hooks come from @zero/framework/react (also root or /react/hooks).
They consume the normal client/provider and live authorization boundary.
They are distinct from similarly named hooks at @zero/framework/sync/client.

```tsx
import { useCollection, useRow, useQuery } from '@zero/framework/react';

const tasks = useCollection<Task>('tasks');
const selected = useRow<Task>('tasks', selectedId);
const openTasks = useQuery<Task>('tasks', (row) => !row.done);
```

This React fragment assumes app Task type and selectedId string. useCollection
returns data/byId/count plus optimistic insert/update/remove, load and clear.
load merges by default or accepts { replace:true }; clear affects the local store,
not server records. Those void mutations are not acceptance receipts; use
[acknowledged collection methods](./acknowledged-mutations.md) for completion.

useRow returns a row or null when missing/not loaded. useQuery applies a local
predicate to already cached rows; it is not a server query or permission filter.
Full-sync collections receive admitted snapshots/live changes. Lazy collections
need a demand-load path before a missing row is meaningful.

## Demand Loading

useLazyCollection(table, optionalStringEqualityFilters, optionalOptions) returns
the collection shape plus isLoading/error/refresh. LazyCollectionOptions is
order/dir/limit/offset; backend default sort direction is desc when ordering applies.
Authenticated /api/data populates the shared collection; superseded requests and
old authorization scopes cannot replace current data.

This is a collection-hydration convenience, not an isolated ordered server page.
A shared store may include rows loaded by other consumers. For query-specific
server order/membership use [useDataPage](./data-composition.md) or the first-class
[DataTable server source](../data-controls/data-table/server-sources.md).
Do not add browser pagination/filtering to a returned server page inadvertently.

useStatus() returns { connected }; connection means accepted SDK Sync state, not
that every query/credential/external provider is healthy.
SSR reads empty collections/null rows/false connection without opening transport.
Missing browser providers throw wiring errors instead of silently creating clients.

Callbacks are authorization-scope bound. Login/logout/tenant/authority replacement
hides old projections and fences retained writes/load/clear. UI fences do not
authorize server operations or undo accepted effects.

## Verification And Upgrade

Check full vs lazy loading, rejected/superseded requests, custom primary keys,
logical codecs, disconnect and scope replacement. Hook source observed in the
dirty development tree is not proof of a shipped package. Keep array/cache
membership distinct from a query's server result.

## Related Guides And Next Steps

- [Collections](./collections.md) owns underlying methods/identity.
- [Data composition](./data-composition.md) owns ordered page/record selection.
- [Scope boundary](../runtime/authorization-scope-boundary.md) owns UI fencing.
- [Low-level Sync](./low-level-sync.md) distinguishes alternate hooks.

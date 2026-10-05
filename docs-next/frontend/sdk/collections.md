---
id: zero.frontend.sdk.collections
type: reference
audience: [developer, agent]
owner: frontend-sdk
status: draft
visibility: internal
system: frontend-sdk
feature: collections
maturity: supported
applies_to: ["2.1.1 source; package qualification pending"]
modes: [browser, full Sync, lazy Sync, single-database, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Reactive Table Collections

[SDK index](./index.md) · [Documentation index](../../index.md)

`client.collection<RowType>(name)` exposes rows in the client's synchronized or
demand-loaded local table store. It is not an implicit server query, an exhaustive
database count or permission to access any named table. The table must be
registered in the configured client and admitted by the running server.

## Obtain A Typed Collection

```ts
import type { InferRow } from '@zero/framework/schema';
import { tasks } from './db/schema';

type Task = InferRow<typeof tasks>;
// Fragment: client is the existing configured application Client.
const collection = client.collection<Task>('tasks');
const byId = collection.getAll();
```

An unknown table throws rather than manufacturing a store. Collection instances
are cached by the integrated client. [Register aliases](../../backend/schema/registry.md)
can supply an explicit row generic but do not bind a table string automatically.

## Reads And Subscriptions

| Method | Result |
| --- | --- |
| name | readonly table name |
| primaryKey | optional readonly declared sync key metadata; provided by Zero collections, legacy app adapters may omit it |
| getAll() | local ID-to-row map |
| getOne(id) | local row or null |
| getMany(predicate) | matching local rows as an array |
| count() | number of locally loaded rows |
| subscribe(callback) | calls on changed local table snapshot; returns unsubscribe |
| subscribeOne(id, callback) | calls on changed local row/null; returns unsubscribe |

Subscriptions observe subsequent changes; they are not a replacement for the
initial synchronous read or an HTTP baseline query. In a lazy table the local
store can be incomplete and can receive authorized rows not originally loaded;
count/getAll are therefore not a server total or a page-membership contract.

Declared booleans are decoded to booleans by the client table metadata. Structured
TEXT fields do not all become logical arrays/objects automatically. Use the
descriptor [codecs](../../backend/schema/codecs.md) at the appropriate boundary.

## Writes

| Method | Completion contract |
| --- | --- |
| insert(row) | optimistic local submission; returns void |
| update(id, partial) | optimistic local submission; returns void |
| remove(id) | optimistic local submission; returns void |
| insertAsync(row, options?) | optimistic submission, then exact accepted/rejected server receipt |
| updateAsync(id, partial, options?) | same receipt contract for the update |
| removeAsync(id, options?) | same receipt contract for delete |

```ts
await collection.updateAsync('synthetic-task', { done: true });
// Only now announce accepted success or close the editor.
```

A void method's immediate return is not authoritative success. Awaiting a void
method adds no receipt guarantee. Async methods return Promise<void>, not the
created row/key; use the accepted collection/read path if the UI needs a record.
The generated primary key is optional in the inferred insert boundary, while
other row fields retain their declared stored types. See
[types](../../backend/schema/types.md#stored-rows-and-insert-inputs).

Boolean values are encoded for transport. Other structured logical values need
the descriptor's encoding, normally supplied by generated forms/tables. Server
logical validation, resource stamping, FK readiness and live authority still
own acceptance. Client-side type annotation cannot grant assignment rights.

## Natural Identity

When the table declares identity fields, additional local/optimistic methods are:
identityKey(key), getByIdentity(key), upsertByIdentity(row), updateByIdentity(key,
partial) and deleteByIdentity(key). Their keys use the table's ordered natural
identity; these methods reject when the table has none. Identity fields cannot
be changed through updateByIdentity.

getByIdentity checks the deterministic key and can find a matching local legacy
row under another ID. upsertByIdentity chooses insert/update from currently loaded
data; it is not an authoritative global existence query. The ByIdentity write
helpers return void and do not add Async receipt aliases. When acceptance matters,
use the actual primary key/ordinary Async method under the application's correct
identity flow. See [natural identity](../../backend/schema/natural-identity.md).

## Demand-Loaded Cache Operations

`load(rows, { replace? })` installs rows in local state without writing them to the
server. replace defaults false; true replaces the local table snapshot. Missing
keys are generated using the table's normal row identity rules. clear() empties
local rows without deleting server records.

These operations support lazy HTTP loading and reactive rendering. They do not
make a server page equal to every record in a shared cache. A server-paginated
control must keep its ordered accepted IDs/page metadata separate from collection
contents, so another query's cached rows do not appear in its result.

## Errors, Scope And Verification

The server can reject optimistic writes and roll them back; use Async receipts
or onMutationRejected for the appropriate lifecycle feedback. [Acknowledged
mutations](./acknowledged-mutations.md) specifies safe errors, waits and uncertain
outcomes. Do not retry a non-idempotent write merely because a wait timed out.

Normal SDK scope transitions fence/reset local data. Custom retained callbacks
need the [scope boundary](../runtime/authorization-scope-boundary.md), particularly
when deriving local selections/drafts outside framework hooks. Verify reads,
subscriptions/unsubscribe, boolean/structured encodings, optimistic rejection,
accepted writes and clear/load with synthetic data before app integration.

## Related Guides And Next Steps

- [Acknowledged mutations](./acknowledged-mutations.md) owns exact write completion.
- [Resources](./resources.md) performs policy-aware server queries/HTTP CRUD.
- [Schema codecs](../../backend/schema/codecs.md) owns logical/wire conversion.
- [Configuration](./configuration.md) owns client table registration.

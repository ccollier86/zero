---
id: zero.fabric.application-client
type: how-to
audience: [developer, agent, operator]
owner: fabric
status: in-review
visibility: internal
system: fabric
feature: application-data-client
maturity: preview
applies_to: ["2.6.0 application-client extension; exact archive qualification required"]
modes: [single-tenant, ephemeral, file, hot, tenant-database]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "73022b37deacfdd33cbefb24f329d2656eaf4b76"
  snapshot: clean
  date: "2026-10-25"
  evidence_level: implementation-verified
---

# Use One Async Application Data API

[Fabric index](./index.md) · [Documentation index](../../index.md)

Request `zero.data` supplies the same bounded reads, tracked mutations, atomic
batches and named commands for a single-tenant primary database and a committed
tenant-file Fabric database. Do not introduce artificial organizations or build
another ORM to obtain this interface. Pin an archive containing this extension;
an older 2.6.0 archive does not gain it from the version string.

## Availability and Authorization

| Request boundary | Client |
| --- | --- |
| Single tenant, primary memory/file/hot database | Primary app client; CRUD uses declared app tables without extra configuration. |
| Single tenant with additional named Fabric databases | Primary app client. Named databases remain a privileged setup capability, not a request selector. |
| Authorized tenant with tenant-database isolation | That tenant's existing actor-backed client. |
| Shared-row multi-tenant request | `null`. Use Resource policies/generated routes; an unfiltered primary client would bypass row isolation. |
| Multi-tenant selection/anonymous session without an admitted scope | `null`. Authentication alone is not tenant admission. |

Check nullable `zero.data`. It binds storage and rechecks live authority, not
arbitrary row/field/domain permissions. Enforce those in [Resource policies](../resources/policies.md)
or the custom service before the operation. Public routes still require their
intended signed-token, webhook or other proof. Do not fall back to `unsafe`.
System authority, workflows and logging retain their [service/data-plane owners](../runtime/data-planes.md).

## Basic Reads and Writes

The [operation reference](./operations.md) owns the methods and payloads.
`get`, cursor `list`, structured `find`, and exact-total `findPage` return
`{ value, sequence }`. Writes require `idempotencyKey` and return
`{ value, sequence, idempotencyKey, replayed }`.
This service fragment assumes the caller has authorized the record and fields:

```ts
import type { AsyncDatabaseClient } from '@zero/framework/server';

export async function renameAuthorizedNote(
  data: AsyncDatabaseClient, id: string, title: string, requestKey: string,
) {
  return data.mutate(
    { type: 'update', table: 'notes', id, patch: { title } },
    { idempotencyKey: requestKey },
  );
}
```

Retain keys for the same logical action; namespace them by trusted actor/domain
identity and operation version when those distinguish actions. A key is not
authorization. Changed input with an existing key conflicts instead of becoming
a second action. See [durable receipts](./idempotency.md).

## Register Joined Queries and Atomic Commands

Optional `createApp({ dataRealm })` accepts a realm from `defineDatabaseRealm`.
Its tables must be a schema-identical subset of `createApp({ tables })`.
Omission derives primary CRUD admission but does not invent named handlers.
This server-only setting is read at app construction and requires restart when
changed. It has no environment-variable or runtime-admin override.

```ts
import { createApp, defineDatabaseRealm } from '@zero/framework/server';

const tables = { notes: { id: 'text primary key', title: 'text not null' } };
const dataRealm = defineDatabaseRealm({
  name: 'notes', version: '1', tables,
  queries: {
    'notes.count': ({ database }) => database
      .query<{ total: number }>('SELECT count(*) AS total FROM notes').get()!,
  },
  commands: {
    'notes.rename': ({ db }, input: { id: string; title: string }) => {
      db.update('notes', input.id, { title: input.title });
      return { id: input.id, title: input.title };
    },
  },
});
export const app = await createApp({ db: { mode: 'memory' }, tables, dataRealm });
```

An authorized handler calls `zero.data.query('notes.count', null)` or
`zero.data.command('notes.rename', { id, title }, { idempotencyKey })`.
The command's `value` is `{ kind: 'command', name, output }`, with the registered
handler's return value under `output`, in both modes.

Parameterized joined SQL, CTEs and aggregates belong in registered queries,
not N+1 calls or whole-table JavaScript filtering. Queries receive a revocable
read-only SQL capability. Commands receive tracked table operations and run
synchronously within one transaction. Preserve revision checks and multi-write
transitions there or in `batch`; separate awaited calls are not one transaction.
Only handler names and serializable inputs cross the facade, never SQL strings,
closures or raw handles.

`dataRealm` does not install migrations or automations on the primary database.
Keep its existing migration lifecycle and `databaseAutomations` configuration.
Fabric actors retain their realm migration/automation lifecycle. Tenant-file
apps use `databaseTopology.realm`; if `dataRealm` is also supplied, fingerprints
must match. Independent named databases may use a different realm.
Version handler behavior explicitly as described in [realms](./realms.md).

## Performance and Lifetime

Primary operations reuse the owned ReactiveDB handle. They do not start an
actor, copy the whole database for a named read, or install receipt tables merely
to read. A bounded FIFO belongs to each primary runtime, not all databases.
Existing Fabric reader routing and per-file execution are unchanged.

Primary SQLite still runs synchronously in the app process. The async API does
not offload a long report into a worker. Keep reads bounded and indexed; exact
totals can still require counting matching rows. Use a deliberate Fabric/worker
design for heavy work.

The primary FIFO permits 256 waiting operations. Queue timeout defaults to
30 seconds; `signal` cancels only before execution. Positive timeout values must
fit the runtime timer range. `operationTimeoutMs` accepts the common input but
cannot interrupt synchronous primary SQLite after dispatch; it is not a hard
execution deadline there. Actors retain their separate timeout/outcome rules.

Authority is checked before admission, at execution, inside primary write
transactions and before delivery. Existing Guardian revision/commit guards stay
active. A post-commit authority error without a commit assertion is not proof
of rollback or permission to retry under a fresh key. Shutdown rejects queued
work, waits for settlement and releases statements before closing the runtime.

## Adopt Without Rewriting Everything

`zero.db` compatibility remains. Default primary realm admission is lazy, so an
older app that does not use this API keeps its existing schema path. The async
facade uses the portable serializable realm contract; BLOB, bigint and custom
objects are not silently coerced. Use Storage for object bytes.

Tracked writes feed the same ReactiveDB change stream and configured hooks.
They do not add every clinical audit event or automatically attribute raw SQL
reads. Keep explicit [logging coverage](../logging/events-and-coverage.md).

## Related Guides and Next Steps

- [Operation methods](./operations.md) defines filters, pagination and batches.
- [Request services](../runtime/server-services.md) defines live service boundaries.
- [Realms](./realms.md) defines handler lifetimes and behavior versioning.
- [PracticeIQ conversion](../../guides/practiceiq-upgrade/conversion.md) applies
  these choices without changing tenancy or the public-site theme.

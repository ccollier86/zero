# ReactiveDB Fabric: Multi-Database Architecture

> **Status:** active, unreleased release-candidate implementation. The
> file/WAL actor foundation is now
> implemented with isolated Bun subprocesses, native IPC, bounded per-file
> writer queues, separate WAL readers, durable idempotency receipts, change
> replay, generation recovery, root ownership, app-local observability, and
> deterministic shutdown. `createApp()` validates and owns the topology, the
> shared application database and separate Zero-owned system database remain
> pinned, and tenant bindings are
> derived from trusted authorization scope with a cross-file commit fence.
> Real subprocess tests prove persistence, same-file read/write overlap, and
> concurrent writes to separate files. The ordinary request capability,
> generated Resource HTTP CRUD, lazy `/api/data` reads, and multiplexed
> WebSocket Sync route physical tenant resources through the actor-backed file
> without a redundant tenant predicate. Resource policy, field projection,
> conditional writes, durable mutation recovery, independent plane cursors,
> topology validation, browser routing, and Doctor diagnostics are integrated.
> Bounded file/hot placement is also integrated: placement is selected from a
> pseudonymous database reference, pinned while the coordinator entry is
> active, and backed by explicit on-write, periodic, or final-snapshot
> durability. Fleet
> migration and lifecycle operations, online placement changes, operator-grade
> backup/restore, and the full package/OS deployment matrix remain release
> work. Nothing in this document marks those unfinished slices as release-ready.
>
> A minimal two-Web-Worker `bun:sqlite` proof segfaulted on the installed Bun
> 1.3.14 runtime and later Worker runs showed nondeterministic corruption or
> failure before termination. Web Workers are not the production backend. The
> isolated Bun subprocess/native-IPC backend is the qualified production
> direction; the full application and release acceptance suite remains
> required before public release.

## Purpose

**ReactiveDB Fabric** is Zero's multi-database runtime: the bounded actor,
routing, isolation, and lifecycle layer around independently reactive
databases. `ReactiveDB` remains the name of each database engine; Fabric is
the layer that coordinates many of them. The existing typed configuration
name remains `databaseTopology`.

Zero needs more than the ability to open several SQLite files. It needs a
bounded runtime which can safely route work to those files while preserving
the parts of Zero that already make one database useful:

- ReactiveDB transactions and ordered change sequences.
- File/WAL durability and concurrent readers.
- Declarative schema and migrations.
- Authentication and authorization at the request and commit boundaries.
- Realtime snapshot, replay, and resynchronization behavior.
- App-local lifecycle, observability, and failure isolation.
- A package and deployment model which works outside the framework repository.

The initial use case is one application-data database per tenant. The same
foundation must also support explicitly named databases when isolation is
useful in a single-tenant application. A logical database identifier is never
a filesystem path, and ordinary request code must never select its tenant
database from caller-controlled input.

The implementation has two distinct storage forms:

1. File/WAL databases running on bounded writer and reader actor pools. This
   provides independent write lanes across files and optional same-file WAL
   readers.
2. Policy-driven hybrid placement in which appropriate databases can use
   Zero's bounded hot snapshot runtime while others remain file/WAL databases.
   This placement layer is implemented in the release candidate.

Hybrid placement does not mean online promotion or demotion. A coordinator
selects placement synchronously when it creates an entry, pins that decision
across the entry's actor generations, and may evaluate the policy again only
after a clean idle/requested eviction creates a new entry. Moving an
already-open database between file and hot placement remains an explicit
offline operator migration problem.

## Current Decision

The production direction is a compatibility-preserving database coordinator
over an explicit executor abstraction:

- The shared application database remains pinned to the app runtime; the
  separate pinned system database remains Guardian/Zero authority.
- Named and tenant files use asynchronous operations dispatched to isolated
  database actors.
- Each opened named/tenant database uses either file/WAL or bounded hot
  snapshot placement according to one validated declarative policy.
- Exactly one writer actor owned by one coordinator topology controls a
  physical database at a time.
- Different physical databases can write concurrently on different actor
  processes.
- File-placed entries can open separate read-only actors so WAL reads proceed
  while the file's writer is active; hot entries stay writer-only.
- One database's writes remain FIFO and transactional.
- The public API sends serializable operations; it never sends callbacks,
  SQLite handles, ReactiveDB instances, or arbitrary request-selected SQL to a
  remote actor.
- ReactiveDB remains the writer-side change-log and ordering engine.
- The manager derives tenant-file routing from trusted authorization scope and
  fences tenant commits against control-plane authority changes. Ordinary
  request code, generated Resource HTTP CRUD, `/api/data`, and actor-backed
  Sync consume that bound capability.
- One authenticated WebSocket multiplexes authorized system projections, the
  pinned default application plane, and the selected tenant plane. Each plane
  retains its own epoch, authorization
  scope, sequence cursor, snapshot/catch-up boundary, and reset behavior.
- The server derives a table's plane from the validated Resource topology.
  Browser-supplied plane fields are assertions only and never select storage.

Separate files provide separate SQLite lock domains, but that fact alone is
not concurrency. Opening several synchronous Bun SQLite handles on the main
JavaScript thread still makes a long operation on database A delay dispatch to
database B. An independently executing actor boundary is required to deliver
the cross-file parallelism promised by this feature.

### Runtime qualification finding

The installed Bun 1.3.14 runtime segfaulted during a minimal proof which ran
`bun:sqlite` in two Bun Web Workers. Follow-up Worker runs also exhibited
nondeterministic corruption or failure before termination was involved. Bun
documents its Worker API, and in particular termination, as experimental.
This is a failed qualification test; it does not establish the precise
runtime defect or prove that every future Bun version will fail. It does mean
Zero must not make Web Workers the production backend on the current evidence.

The production direction is therefore isolated Bun subprocess actors
communicating through Bun's native IPC. Subprocesses give each synchronous
SQLite lane an independent process boundary and prevent a JavaScript isolate
failure from being treated as ordinary in-process cleanup.

The initial subprocess proof passed:

- separate-file 600ms WAL transactions overlapped and completed in about
  605ms total;
- a read-only same-file WAL query completed in under 1ms while an approximately
  805ms writer transaction remained open;
- native-IPC graceful shutdown completed cleanly;
- a `bun build --compile` binary successfully self-spawned through
  `process.execPath --zero-db-child`.

Those measurements are proof observations, not performance guarantees. They
qualify the architecture and production-default backend direction. They do not
replace the full protocol, fault, soak, packaging, platform-matrix, and
application acceptance suite required before release.

The coordinator depends on `DatabaseExecutor`, not directly on `Worker` or
`Bun.spawn`. This keeps scheduling, ordering, errors, and public APIs stable if
a later pinned Bun release proves Web Workers safe enough to add as an
optional backend.

## Non-Negotiable Invariants

### Compatibility

1. Omitting multi-database configuration preserves the current application
   contract exactly.
2. `zero.db === zero.syncDB` remains true for the default ReactiveDB.
3. `zero.sql === zero.sqlite === zero.db.getSQLiteService()` remains true when
   the default platform SQLite service is available.
4. Existing default-database routes retain their synchronous API.
5. Multi-database support does not silently move the default database into a
   remote actor or turn existing methods into promises.

### File and ownership safety

1. Logical database identifiers are normalized opaque values, never paths.
2. A deterministic, domain-separated digest maps a logical identifier to a
   flat filename beneath one configured root.
3. A configured root or database file may not itself be a symlink. Existing
   ancestor aliases are canonicalized before Zero creates any missing root
   components, which supports platform paths such as macOS `/var` without
   allowing the owned root or file to be redirected.
4. The resolved database file must remain a direct child of the configured
   root.
5. POSIX roots and files are hardened to private permissions.
6. One Zero coordinator topology has at most one writer actor for a physical
   database, even though that actor runs in a child process.
7. Named and tenant databases open only in their coordinator-selected `file`
   or `hot` placement. `ephemeral` is not a Fabric placement.
8. Database paths and logical tenant identifiers never appear in public
   errors, request-visible diagnostics, or ordinary observability metadata.
9. The Fabric root may not overlap build output, any effective application or
   system database source, hot snapshot, or deterministic SQLite WAL/SHM/journal
   companion path, the object-storage root when Fabric would contain it, or
   the adapter-owned `storageDir/tmp` and
   `storageDir/blobs` namespaces. A dedicated unowned child such as
   `storageDir/databases` remains valid.
10. Config resolution checks those ownership boundaries lexically, and
    `createApp()` repeats the check through existing filesystem aliases before
    bundling, opening SQLite, or initializing object storage. Startup fails
    closed without including filesystem paths in the public error.
11. Object-storage crash cleanup removes only its own exact
    `upload_<UUID-v4>` regular files. It never sweeps unrelated files or
    directories from the temporary namespace.
12. Ownership paths are compared conservatively after Unicode normalization
    and case folding on every platform. Case- or normalization-only directory
    distinctions are unsupported even on a case-sensitive filesystem, keeping
    the same configuration safe when deployed to default macOS or Windows
    volumes.

### Concurrency and ordering

1. Writes for one physical file are ordered through one per-database FIFO.
2. A transaction callback never crosses an executor boundary.
3. With at least two writer slots, writes to two different files can be in
   SQLite transactions at the same time.
4. Same-file read/write concurrency requires a separate connection in a
   separate reader execution lane; WAL by itself does not make synchronous
   code on one lane concurrent.
5. A read sees a committed SQLite snapshot. It never observes another
   transaction's uncommitted state.
6. ReactiveDB sequence numbers are independent per physical database and
   remain strictly ordered within that database.
7. Actor loss never causes Zero to guess whether an in-flight write
   committed.

### Security

1. Multi-tenant request code receives an already-bound database capability.
2. URL parameters, request bodies, headers, websocket messages, and browser
   state cannot choose the physical database.
3. Raw coordinator access is unavailable in the safe multi-tenant request
   facade.
4. Resource and table policy checks remain server-side.
5. An authorization change at the commit boundary fails closed.
6. Multiple independent app coordinators/replicas sharing one local database
   root are rejected until Zero has a distributed writer and authority
   coordinator. Child actors owned by one coordinator are part of that one
   topology and are expected.

### Lifecycle and operations

1. Configuration validation performs no filesystem mutations.
2. Migrations finish before a writer runtime is published or readers are
   admitted.
3. New work is rejected before shutdown begins draining actors.
4. Readers close before a writer's final truncating checkpoint.
5. Missing actor bootstrap, server-entry resolution, or realm code fails
   startup; Zero never falls back to main-thread named-database execution or
   to a different executor backend.
6. All database observability is emitted through the owning app's
   observability runtime.

## Runtime Topology

The two pinned databases and multi-database data plane have deliberately
different contracts:

| Plane | Execution | Storage | API | Primary purpose |
| --- | --- | --- | --- | --- |
| System | App runtime | Independent `hot`, `file`, or `ephemeral` behavior; durable `file` is the production authority default | Privileged `zero.system.db` and `zero.system.sql`; platform service APIs | Guardian identity/authorization and Zero-owned state |
| Default/application | App runtime | Existing `hot`, `file`, or `ephemeral` behavior | Existing synchronous `zero.db` and `zero.sql` | Shared and compatibility application data |
| Named/tenant writer | Bounded subprocess writer actors through `DatabaseExecutor` | Policy-selected file/WAL or bounded hot snapshot | New asynchronous database client | Isolated application data and ordered mutations |
| Named/tenant reader | Bounded subprocess reader actors through `DatabaseExecutor` | Read-only connection for file/WAL placement only | New asynchronous reads | Snapshot reads concurrent with an active file writer |

The system database holds global identity, sessions, tenant membership, tenant
registry, platform-administrator state, and other mandatory Zero-owned tables.
The default database holds shared application data. Two operations that mutate
one physical file remain subject to SQLite's one-writer rule. Once
authentication has selected a tenant, application operations against tenant A
and tenant B use different writer actors and do not wait on one another.

Fabric placement moves neither pinned database. The application mode comes
from `db`; system authority comes from `systemDb`. The generic pinned-runtime
registry is the extension seam for future isolated logs, metrics, audit, or
plugin-owned service databases.

### Where tenant scope lives

Zero supports two explicit tenancy storage strategies; services never infer a
strategy from the presence or absence of a column:

| Strategy | Isolation authority | Application-table shape | Query behavior |
| --- | --- | --- | --- |
| `shared-row` | Verified tenant scope plus a trusted row predicate | Tenant-owned tables carry the configured tenant-scope column | Resource and service adapters inject and enforce that scope for every read and mutation |
| `tenant-database` | The already-bound physical database capability | Tenant-owned tables normally omit a redundant tenant-scope column | Resource and service adapters execute inside that tenant's file without adding a tenant predicate |

The separate Guardian system plane remains shared across tenants. Tenants,
memberships, invitations, sessions, role assignments, platform administration,
database placement, and other cross-tenant authority records therefore retain
explicit tenant references in `systemDb`. Application data which is
intentionally global or cross-tenant belongs in the pinned shared application
plane (`db`).

An application may retain a `tenant_id` value inside an isolated file for
business or export purposes, but that value is ordinary data and is not the
authorization boundary. Request-supplied values never override the database
capability selected from verified authority.

Changing an existing application from `shared-row` to `tenant-database` is an
operator-controlled data migration, not a config toggle which silently drops
columns. The migration tooling must enumerate tenants, create and migrate each
target file, copy only trusted-scope rows, verify counts/checksums and durable
change boundaries, establish routing, cut over with a bounded write fence, and
retain an explicit rollback/cleanup decision. Built-in services and resources
must select their storage adapter from the resolved topology so application
code keeps one declarative surface without runtime schema guessing.

Platform Doctor resolves the same declarative strategy and remains read-only.
Its current multi-database findings:

- confirm actor-backed mode plus the configured active-database and durable-file
  capacity limits;
- explain when disabled reader actors force reads onto a file's writer lane;
- report all-hot versus hybrid selection, configured hot durability, and the
  maximum configured hot image budget implied by `maxDatabases * maxBytes`;
- warn that hot placement has no separate reader actor and explain periodic or
  final durability loss contracts;
- report whether persistent tenant Sync leaves actor capacity reserved for
  ordinary requests and background work;
- confirm that physical-tenant Sync uses bounded atomic snapshot frames and
  adaptive actor pages, including the terminal oversized-row contract;
- explain the finite full-result budget and permanent idempotency-key capacity
  for physical-database receipts and generated default/shared Resource writes;
- reject unsupported `REAL`, `BLOB`, `NUMERIC`, or typeless sync primary-key
  declarations and point to the exact app table column;
- explain that a physical tenant resource needs no managed `tenant_id`
  discriminator;
- identify a retained realm field as ordinary business/export data rather than
  an authorization boundary;
- reject a database root which overlaps build output or reuses the object
  storage directory; and
- retain the existing shared-row resource validation and tenant-leading index
  guidance when physical isolation is not selected.

Run `bun run doctor -- --config ./zero.config.ts --strict` in CI and review
informational topology findings during deployment planning. Doctor never drops
a column, rewrites policy, creates tenant files, or moves data. Conversion from
`shared-row` to `tenant-database` remains an explicit operator-controlled
migration; automated tenant-fleet migration planning is still future work.

Later realm separation may move additional Zero subsystems into their own
databases. That work must use the same coordinator and authority rules rather
than opening ad hoc SQLite handles.

## Declarative Application Topology

Multi-database behavior is selected in `createApp()` configuration. Omitting
`databaseTopology` (or setting `{ mode: 'single' }`) preserves the historical
single-database contract. Physical tenant isolation requires multi-tenant auth,
an actor realm, and `tenantIsolation: 'tenant-database'`:

```ts
import {
  authenticatedOnly,
  createApp,
  defineDatabaseRealm,
  defineResource,
  defineZeroConfig,
  runDatabaseActorIfRequested,
  tenantRealm,
} from '@zero/framework/server';
import { documentTable, tables } from './lib/schemas';

const tenantServerTables = {
  documents: documentTable.serverTable,
};

export const tenantRealmDefinition = defineDatabaseRealm({
  name: 'application-tenant-data',
  version: '1',
  tables: tenantServerTables,
  migrations: [],
});

const config = defineZeroConfig({
  db: { mode: 'file', path: './data/control.db' },
  tables,
  auth: { tenancy: 'multi' },
  resources: [
    defineResource({
      table: 'documents',
      realm: tenantRealm(),
      exposure: 'all',
      policy: authenticatedOnly(),
    }),
  ],
  databaseTopology: {
    mode: 'multiple',
    rootDirectory: './data/tenant-databases',
    realm: tenantRealmDefinition,
    actors: {
      launch: { kind: 'source', entrypoint: import.meta.path },
    },
    tenantIsolation: 'tenant-database',
    placement: 'file',
    maxDatabases: 16,
    maxDatabaseFiles: 10_000,
    maxTenantSyncDatabases: 15,
    maxTenantSyncBindingsPerDatabase: 64,
    restart: {
      initialDelayMs: 10,
      maxDelayMs: 1_000,
      circuitFailureThreshold: 5,
      circuitCooldownMs: 5_000,
    },
  },
});

if (!await runDatabaseActorIfRequested({ realm: tenantRealmDefinition })) {
  const app = await createApp(config);
  app.listen(config.port);
}
```

The actor branch must run before normal server startup. The same entrypoint is
used by source deployments; bundled and deployment-specific launches can use
the validated `bundle` or `command-prefix` launch forms. Actor children receive
only the explicit `actors.env` allowlist, not the parent's ambient environment.

The actor realm must be a schema-identical subset of `createApp({ tables })`.
After Resource modules load, Zero requires its table set to match *exactly*
the registered tenant resources assigned to physical storage. This includes
`internal` and HTTP-only physical resources, not just Sync-visible tables.
Unknown realm tables, omitted physical resources, schema drift, or a physical
resource without multi-tenant authority fail startup.

Every realm table also declares exactly one single-column primary key with
SQLite `TEXT` or `INTEGER` affinity. `TEXT` is recommended. Stored integer keys
must remain JavaScript safe integers and are canonicalized to string row IDs at
the actor and Sync boundaries. `defineDatabaseRealm()` rejects `REAL`, `BLOB`,
`NUMERIC`, typeless, and composite primary keys with
`DATABASE_CONFIG_INVALID`; actor startup independently verifies the physical
SQLite affinity and fails closed on schema drift. This keeps mutations,
receipts, replay, snapshots, and browser identity on one lossless contract.

That lossless contract applies to every realm column. Non-primary columns may
use `TEXT`, `INTEGER`, `REAL`, or `NUMERIC` affinity, but not `BLOB` or typeless
storage. Generated columns are not writable managed columns, and mutating
foreign-key actions (`CASCADE`, `SET NULL`, or `SET DEFAULT`) cannot produce the
explicit tracked mutation Fabric requires, so realm definition rejects them.
It also reserves SQLite's `sqlite_` namespace, Zero's `_zero_` and `idx_zero_`
object namespaces, and the legacy `_changes`, `_change_sequence`, and
`_migrations` tables. Natural-identity index names are checked against both
those reservations and every realm table. All of these deterministic contract
violations fail as `DATABASE_CONFIG_INVALID` before an actor or file opens;
physical startup validation remains an independent defense against drift.

Resource declarations remain the authoritative application-data topology:

- `realm: tenantRealm()` declares logical tenant ownership.
- `tenantIsolation: 'tenant-database'` turns that logical realm into physical
  storage ownership; the realm field is no longer a managed row discriminator.
- `exposure: 'internal' | 'http' | 'sync' | 'all'` independently determines
  which managed transports may reach the resource.
- Only physical resources with `sync` or `all` exposure join the tenant Sync
  catalog. HTTP-only and internal tables remain in the actor realm but are not
  sent to the browser.
- Global and shared-row resources stay on the default application database and default
  Sync plane.

The bounded topology options are `maxDatabases`, `maxDatabaseFiles`,
`maxBlockedDatabases`, `maxTenantSyncDatabases`,
`maxTenantSyncBindingsPerDatabase`, `readers`, `maxQueuedPerDatabase`,
`maxQueuedTotal`, `queueTimeoutMs`, `operationTimeoutMs`, `restart`,
`idleTimeoutMs`, and `sweepIntervalMs`. Their defaults are part of the typed
`AppMultipleDatabaseTopologyConfig`; tune them from measured workload,
process/file-descriptor limits, storage/inode budgets, and shutdown budgets
rather than from tenant count alone. Values which feed JavaScript timers—including
queue, operation, sweep, actor lifecycle, and periodic snapshot timers—must not
exceed the portable signed 32-bit timer maximum, `2_147_483_647` milliseconds.
Per-operation queue/operation overrides are checked against the same maximum.
`idleTimeoutMs` is an elapsed-time comparison rather than a direct timer and
may be any non-negative safe integer.

`restart` is a per-database replacement policy. Its defaults are a 10 ms
initial delay, a 1,000 ms exponential-delay ceiling, a circuit threshold of
five consecutive replacement attempts, and a 5,000 ms cooldown between
half-open attempts after that threshold. A successful bind resets the count.
The pending delay is canceled when the last lease is released or the
coordinator drains, so an idle or shutting-down app never keeps a retry timer
alive. The initial delay and maximum delay must be positive bounded timers,
the threshold must be at least two, and the cooldown must be at least the
maximum delay.

Count limits represented in Fabric observability—`maxDatabaseFiles`,
`maxBlockedDatabases`, `maxTenantSyncBindingsPerDatabase`,
`maxQueuedPerDatabase`, and `maxQueuedTotal`—also have a maximum of
`2_147_483_647`. Direct coordinator construction and `createApp()` topology
normalization enforce the same ceiling, so configured and capacity events are
never silently dropped for an unrepresentable count.

### File, hot, and hybrid placement

`placement` accepts two shorthands and one explicit policy:

- `'file'` is the default. The writer owns a direct SQLite/WAL file and, when
  `readers: true`, a separate read-only actor can overlap committed reads with
  the active writer.
- `'hot'` is bounded shorthand for `{ default: 'hot', hot: { durability:
  'on-write', maxBytes: 64 * 1024 * 1024 } }`.
- `{ default, select?, hot? }` declares an all-file, all-hot, or hybrid policy.
  An explicit `hot.maxBytes` is required when `default` is `'hot'` or any
  selector is present, because a selector is allowed to return `'hot'`.

For example, keep every database on file/WAL except an intentional allowlist:

```ts
import {
  createTenantDatabaseRef,
  defineZeroConfig,
} from '@zero/framework/server';

const hotRefs = new Set([
  createTenantDatabaseRef('tenant_acme'),
  createTenantDatabaseRef('tenant_zenith'),
]);

const config = defineZeroConfig({
  // ...db, auth, tables, resources...
  databaseTopology: {
    mode: 'multiple',
    rootDirectory: './data/tenant-databases',
    realm: tenantRealmDefinition,
    actors: { launch: { kind: 'source', entrypoint: import.meta.path } },
    tenantIsolation: 'tenant-database',
    placement: {
      default: 'file',
      select: ({ databaseRef }) => hotRefs.has(databaseRef) ? 'hot' : 'file',
      hot: {
        durability: 'on-write',
        maxBytes: 32 * 1024 * 1024,
      },
    },
  },
});
```

The selector is synchronous. Zero passes it only a frozen, opaque,
pseudonymous `databaseRef`; it receives no tenant ID, database name, path,
request, user, or
mutable runtime object. Build allowlists with `createTenantDatabaseRef()` and
`createNamedDatabaseRef()` so they use the same domain-separated binding
identity as `DatabaseManager`. Do not compare the selector value with a raw
tenant/name or with `createDatabaseRef(rawId)`. A thrown selector or any result
other than `'file'`/`'hot'` fails closed with `DATABASE_CONFIG_INVALID`.

Placement is resolved once when the coordinator creates an entry. Crash
replacement actors for that entry inherit the pinned placement; the selector
does not move live ownership. After clean idle or requested eviction, the next
acquisition creates a new entry and may observe a changed allowlist.
There is no online file-to-hot promotion, hot-to-file demotion, spill, or
placement-migration API. Change policy only when reopening either placement
against the same verified durable image is operationally valid, and use an
offline migration procedure for deliberate moves.

## App-Local Coordinator

`createApp()` owns one coordinator through `ZeroAppRuntime`. The coordinator
owns scheduling and IPC, but not the pinned application database's compatibility API.

Its responsibilities are:

- Maintain internal database bindings and validated pseudonymous database
  references.
- Own writer and reader executor pools.
- Maintain one FIFO and lifecycle state machine per physical database.
- Enforce global and per-database queue bounds.
- Assign an idle writer slot to a database with ready work.
- Prevent concurrent writer ownership of the same file.
- Route read operations to reader actors according to consistency mode.
- Correlate requests and structured actor responses.
- Track actor generations, durable sequence cursors, and idempotency outcomes.
- Convert executor and actor failures into stable `DatabaseError` values.
- Relay safe actor telemetry through the app-local observability runtime.
- Drain and close executors during application shutdown.

The coordinator must not expose `DatabaseRuntime`, `ReactiveDB`,
`PlatformSQLiteService`, a raw `bun:sqlite` handle, or a database path to
ordinary application code.

## Executor and Actor Transport

The coordinator schedules logical work through a narrow transport-neutral
contract. The exact signatures may evolve, but the ownership boundary is:

```ts
interface DatabaseExecutor extends AsyncDisposable {
  setEventListener?(listener: DatabaseExecutorEventListener): void;
  start(): Promise<void>;
  execute<Result, Payload>(
    request: {
      operation: string;
      kind: 'read' | 'write';
      payload: Payload;
    },
    options?: { timeoutMs?: number },
  ): Promise<Result>;
  settled(): Promise<void>;
  close(): Promise<void>;
  diagnostics(): DatabaseExecutorDiagnostics;
}

type DatabaseExecutorFactory = (context: {
  role: 'writer' | 'reader';
  slot: number;
}) => DatabaseExecutor;
```

The production-default factory launches isolated Bun subprocesses and exchanges
versioned messages over native IPC. Its core concurrency, graceful-shutdown,
and compiled self-spawn proof has passed. Process-exit, IPC-disconnect,
malformed-message, backpressure, fault, soak, and orphan-cleanup behavior still
belong to the full acceptance gate before public release.

The subprocess implementation should use Bun-to-Bun IPC with an explicitly
configured serialization mode. Bun's advanced IPC serialization supports
structured-clone values but not transferable ownership, so protocol limits
must account for copied binary payloads. The parent observes both IPC
disconnect and process exit through one idempotent state machine because their
notification order is not guaranteed. It also:

- launches only the resolved build-manifest artifact, never a request path;
- supplies a minimal allowlisted environment rather than inheriting unrelated
  application secrets;
- launches actor children with stdout and stderr set to `ignore`; child output
  is discarded, while supported telemetry crosses the validated IPC/event
  boundary instead of being scraped from process output;
- owns graceful disconnect, signal escalation, process reaping, and orphan
  prevention;
- requires a child actor to stop accepting work and exit when its parent IPC
  channel closes or its parent-liveness contract expires;
- acquires an app-root ownership boundary which distinguishes its managed
  child actors from a second independent Zero app replica.

Executor selection is explicit and validated at startup:

| Backend | Current status | Allowed use |
| --- | --- | --- |
| `subprocess-ipc` | Proof-qualified production direction; full acceptance pending | Default implementation direction; public release requires the complete pinned-runtime and packaging suite |
| `web-worker` | Disqualified on installed Bun 1.3.14 by crashes and nondeterministic failures; Bun API remains experimental | Disabled in production; future opt-in only after pinned-version qualification |
| Main-thread/in-process | Does not provide the required concurrency | Unit-test helpers and the pinned application/system DBs only; never a named-database fallback |

A backend failure never triggers automatic transport substitution. In
particular, failure to launch a subprocess must not retry the operation in a
Web Worker or on the app thread. Silent fallback would change isolation,
failure, and concurrency semantics precisely when the system is already in a
fault state.

### Writer scheduling

Writer slots are bounded independently from the number of database files.
Each slot executes one database at a time:

1. A bound client submits a serializable mutation or strong read.
2. The coordinator appends it to that database's FIFO.
3. If no actor owns the database, the coordinator assigns a free slot or
   closes one eligible idle entry; if neither is possible, acquisition fails
   immediately with retryable `DATABASE_BACKPRESSURE`.
4. The writer actor prepares the file, imports the database realm, migrates and
   opens ReactiveDB, validates its binding, and reports ready. Committed
   sequence ranges return with operation results; the coordinator publishes
   data-free wakeups after the authority lease is released.
5. The coordinator sends one operation at a time for that database.
6. When the queue and in-flight count reach zero, an idle deadline permits a
   graceful close and slot reuse.

An implementation may cache only the runtime currently owned by a writer
slot. It must not hash many active tenant actors permanently onto one process;
that would make an unrelated long-running operation block every database on
that execution lane.

Each admitted database has its own FIFO, and different admitted databases can
run on different slots. There is no cross-database waiter or round-robin
admission queue: actor-capacity exhaustion does not leave an unbounded request
waiting for another database to become idle. Callers receive retryable
`DATABASE_BACKPRESSURE` and may retry under their own bounded policy.

### Bounded capacity and backpressure

Configuration needs separate controls for:

- writer concurrency;
- reader concurrency;
- total Zero-managed physical main database files;
- distinct databases held by persistent tenant Sync bindings;
- persistent tenant Sync bindings per database;
- maximum pending operations per database;
- maximum pending operations across the app;
- queue wait deadline;
- operation deadline;
- idle runtime deadline.

`maxDatabaseFiles` defaults to `10_000` and is a hard physical-file admission
limit, distinct from the active actor limit. At coordinator startup Zero counts
only canonical regular `db-<hint>-<digest>.sqlite` durable images directly
under the exclusively owned Fabric root. Both file/WAL databases and canonical
hot-placement snapshot images consume this budget. WAL/SHM/journal companions,
the `.zero-internal` ownership database, directories, symlinks, and unrelated
files do not. The catalog gate performs the capacity check
and O_EXCL main-file reservation in one serialized ownership boundary. Once
the limit is reached, an existing main file remains openable, while a new file
fails before creation with non-retryable `DATABASE_CAPACITY_EXHAUSTED`,
`outcome: 'not-started'`, and closed `capacityType: 'files'` / positive
`capacityLimit` details. Zero does not delete or recycle tenant data to recover
capacity; an operator must deliberately raise the limit or perform an offline
lifecycle operation. `DATABASE_BACKPRESSURE` remains reserved for transient
queue, actor-slot, and binding/session admission pressure.

Persistent tenant Sync receives its own admission bounds because one socket
binding holds an actor-backed capability. `maxTenantSyncDatabases` limits the
number of distinct databases with active or in-flight persistent bindings;
additional bindings to a database already in that set remain eligible.
`maxTenantSyncBindingsPerDatabase` (default `64`) bounds sockets/capabilities
for one database. Admission is serialized before entry creation or lease
pinning, and overflow returns retryable `DATABASE_BACKPRESSURE` without
creating a file or consuming an actor slot. By default the distinct limit is
`maxDatabases - 1`, reserving one actor slot for ordinary request/background
work. A one-slot topology defaults to one Sync database so Sync still works;
it cannot reserve separate transient capacity, and Doctor warns about that
tradeoff. An explicit `maxTenantSyncDatabases: 0` disables persistent physical
tenant Sync admission.

Queue overflow fails before dispatch with `DATABASE_BACKPRESSURE`. Exceeding a
queue deadline fails with `DATABASE_QUEUE_TIMEOUT`. An `AbortSignal` can remove
work which has not started. Once a synchronous SQLite operation begins, Zero
must not report cancellation as proof that the database operation stopped.
Actor-slot exhaustion also fails before admission and emits the closed
`database.queue.saturated` event with `operation: 'open'`; its metadata carries
only the requested opaque database reference and bounded pool counts.

A request timeout and a database outcome are separate facts. The HTTP caller
may stop waiting while the actor finishes the operation, records its receipt,
and emits its committed changes.

## Same-File Reader Model

WAL allows readers and one writer to coexist when they use different
connections. A Fabric entry placed on `file` therefore uses a separate bounded
reader-actor pool when `readers: true`. A hot entry never opens a reader actor;
its reads are scheduled on the RAM-active writer lane.

A reader actor:

- opens the prepared file with Bun SQLite `{ readonly: true, strict: true }`;
- enables `PRAGMA query_only = ON`;
- applies a bounded busy timeout;
- starts a deferred read transaction for each operation;
- reads the durable ReactiveDB sequence before application rows so all results
  belong to one SQLite snapshot;
- commits the read transaction after producing a structured-clone-safe result;
- never initializes schema, migrates, mutates `_changes`, or constructs a
  writable ReactiveDB;
- may cache read handles by LRU while tagging them with a schema generation.

Readers are admitted only after the writer has reported that the file's schema
is ready. A schema-generation change closes stale read handles before new work
uses them.

### Read consistency

The async database client exposes explicit consistency rather than an
ambiguous promise of a "latest" read:

| Mode | Execution | Guarantee | Tradeoff |
| --- | --- | --- | --- |
| `snapshot` | File reader actor when available; otherwise the writer lane | One committed SQLite snapshot at operation start | May not include a concurrent or not-yet-observed commit; hot reads do not overlap their writer lane |
| `read-your-writes` | File reader actor with `minSeq` when available; otherwise the writer lane | Snapshot sequence is at least the caller's prior commit token | May wait for a fresh read transaction or the writer FIFO |
| `strong` | Writer FIFO | Runs after previously queued writes for that database | Does not overlap that database's writer |

A writer may hold an uncommitted update while a snapshot reader completes and
returns the previous committed value. After commit, a read carrying the
returned sequence token must observe that commit or fail with a stable
deadline error.

## Public API Direction

Executor-backed database methods are asynchronous. They do not change the
existing synchronous default API.

The bound surface is:

```ts
interface AsyncDatabaseClient {
  get(
    table: string,
    id: string,
    options?: DatabaseReadOptions,
  ): Promise<DatabaseReadResult<DatabaseOperationRow | null>>;

  list(
    table: string,
    page: { limit: number; after?: string },
    options?: DatabaseReadOptions,
  ): Promise<DatabaseReadResult<DatabaseListPage>>;

  find(
    table: string,
    input: DatabaseFindInput,
    options?: DatabaseReadOptions,
  ): Promise<DatabaseReadResult<readonly DatabaseOperationRow[]>>;

  query(
    name: string,
    input: DatabaseSerializableValue,
    options?: DatabaseReadOptions,
  ): Promise<DatabaseReadResult<DatabaseSerializableValue>>;

  mutate(
    mutation: DatabaseMutation,
    options: DatabaseMutationOptions,
  ): Promise<DatabaseCommitResult>;

  batch(
    input: {
      assertions?: readonly DatabaseAssertion[];
      mutations: readonly DatabaseMutation[];
    },
    options: DatabaseMutationOptions,
  ): Promise<DatabaseCommitResult>;

  command(
    name: string,
    input: DatabaseSerializableValue,
    options: DatabaseMutationOptions,
  ): Promise<DatabaseCommitResult<DatabaseSerializableValue>>;
}
```

`batch()` is the atomic public primitive. A callback-shaped transaction API is
not compatible with a remote actor boundary and must not be simulated by
serializing function source.

Registered queries and commands live in an app-owned database realm imported
inside the actor. Public request code sends their registered name and
validated input. Ordinary bound clients cannot submit raw SQL.

Mutation options require an idempotency key and may override queue/operation
timeouts or supply an `AbortSignal`. Cancellation is honored only before actor
dispatch; after dispatch the outcome protocol and same-key recovery take over.
A commit result contains the database's durable sequence token. Values and
results must pass the canonical serialization and payload-size validation.

### Tenant-bound access

Ordinary authenticated route code receives the already-bound async client as
`zero.data`. It is projected only for a live tenant-bound authority when the
resolved topology uses physical tenant isolation:

```ts
handler: async ({ zero }) => {
  if (!zero.data) throw new Error('A tenant data scope is required');
  return zero.data.find('projects', {
    order: [{ field: 'created_at', direction: 'desc' }],
    limit: 50,
  });
}
```

There is no `tenantId` argument because the authorization middleware has
already bound the client. Each operation owns and releases a short-lived
coordinator lease, and read/write authority is checked at the actor boundary.
Explicit cross-database administration belongs to a privileged setup/admin
capability, not the normal request facade.

Registered tenant Resources reuse the same boundary. In
`tenant-database` mode generated list/get/create/update/delete routes and lazy
`/api/data` reads:

- derive the physical file only from the verified Resource tenant scope;
- apply the existing declarative Resource policy and advanced-RBAC context;
- revalidate the complete authority fingerprint around asynchronous policy
  work and actor reads/commits;
- translate query filters into schema-validated structured actor operations;
- use strict create and conditional row-equality batches for race-safe writes;
- persist actor idempotency receipts and return a normalized
  `Idempotency-Key` for generated HTTP mutations; and
- map stable database failures to privacy-safe HTTP responses while retaining
  database codes and outcomes only in server observability.

One generated Resource request owns one private short-lived tenant binding
across receipt lookup, row pre-read, asynchronous policy evaluation, commit,
and result authorization. It releases that binding in `finally`. The trusted
receipt writer is not present on the public `AsyncDatabaseClient`, `zero.data`,
or any API that accepts a tenant/database selector.

Shared-row and single-database Resources retain their existing synchronous
contract. Physical mode adds no implicit fallback to the default database.

Generated Resource receipts use two separate identities. The private receipt
namespace binds only the caller's public key, stable principal, and verified
tenant. Session IDs, token generations, and RBAC generation counters remain
part of live authority fencing but are intentionally excluded from that
durable namespace, so an exact retry survives token rotation. The separate
logical fingerprint binds the resource/table, action, client-supplied row
identity, and canonical request body. Reusing one public key for another
resource, action, row, or input therefore reaches the same private receipt and
fails as an idempotency conflict instead of executing a second mutation.
Different principals cannot consume each other's receipt even inside the same
tenant.

Physical and default/shared Resource mutation receipts carry the exact
canonical committed row and exact preimage. Resource CRUD re-evaluates
update/delete policy against that preimage; create policy receives the same
original input shape as the first attempt. It revalidates current authority and
projects a canonical receipt row through the current field policy when the
response contains one. It never
substitutes a later database read into the mutation response. Update/delete
receipt lookup also precedes the current row read, so an exact replay still
succeeds after the row is changed or deleted.
The browser SDK sends an explicit or generated key on every Resource mutation;
`ResourceMutationError.idempotencyKey` lets callers recover an automatically
generated key after transport failure without changing successful return
shapes.

A tenant resource using `tenant-database` isolation may declare `sync` or `all`
exposure when actor-backed tenant Sync is configured. The Resource policy
adapter classifies each managed table onto the `tenant` or `default` logical
data plane; physical realm scopes add no row discriminator, stamping, or
constraint. Sync startup must validate that this classification agrees exactly
with the actor realm/catalog before accepting connections, so a physical table
cannot silently fall through to a shadow table in the default ReactiveDB.

## Actor Protocol

IPC uses versioned discriminated unions validated at both ends. A request
envelope carries only internal routing and correlation data:

```ts
interface DatabaseExecutorOperationMessage {
  protocol: 'zero.database-executor';
  version: 3;
  nonce: string;
  role: string;
  slot: number;
  generation: number;
  type: 'request';
  requestId: number;
  operation: string;
  operationKind: 'read' | 'write';
  payload: DatabaseExecutorValue;
}
```

The transport envelope has no deadline, trace, database path, or public
authorization field. Operation deadlines remain parent-owned. A validated
`databaseRef` appears inside database-specific bind/execute/replay/snapshot/
receipt/unbind payloads, not as top-level transport routing. It is a
pseudonymous internal correlation digest which omits the raw tenant ID,
logical database name, and path, but its SHA-256 derivation is deterministic
and unkeyed: low-entropy logical IDs can be dictionary-correlated. Treat it as
operational metadata, never as a secret, credential, or authorization
capability. Only the trusted bind operation carries the prepared path required
to open SQLite, and that path is never copied into public results or ordinary
telemetry.

Parent-to-actor commands are handshake, validated operation request, and
transport shutdown. The closed database operation registry covers writer and
reader bind, execute, replay, tenant snapshot begin/page/abort, receipt lookup,
and unbind. Actor-to-parent messages are ready, success/failure response,
payload-free hot-periodic durability telemetry, and shutdown acknowledgement.
Durable-change wakeups are coordinator publications derived from validated
operation results; they are not actor push messages. The same logical
envelopes may travel over another explicitly qualified executor backend later.

The protocol must enforce:

- maximum message and result sizes;
- supported scalar, row, binary, and query shapes;
- protocol identity/version plus bind-time realm fingerprint and schema checksum;
- matching request, database, and actor generation;
- canonical error serialization;
- rejection of unknown message kinds and fields.

Arbitrary actor `Error` prototypes and stacks are not deserialized into the
application or returned to a client.

## Database Realm and Migrations

Functions cannot cross the actor IPC boundary. Migrations and registered
query/command handlers therefore live in a side-effect-free realm module which
the actor imports for itself; requests send only validated operation values and
registered handler names.

An app declares a side-effect-free database realm:

```ts
export default defineDatabaseRealm({
  name: 'application-tenant-data',
  version: '1',
  tables,
  migrations,
  queries: {
    'documents.summary': ({ database }) => {
      const row = database.query(`
        SELECT count(*) AS count
        FROM documents
        WHERE archived_at IS NULL
      `).get() as { count: number };
      return { count: row.count };
    },
  },
  commands,
});
```

Registered query handlers receive `DatabaseReadQueryContext`, not Bun's raw
SQLite `Database`. Its path-free `database` capability exposes only `query()`
and `prepare()`; prepared statements expose only `all()`, `get()`, `iterate()`,
`values()`, and `raw()`. There is no `run`, `exec`, transaction, filename,
native handle, extension-loading, or native-statement escape hatch.

Zero admits exactly one `SELECT` or read-only `WITH ... SELECT` statement per
prepared query. SQL comments, statement separators, non-read top-level
statements, every quoted or unquoted `pragma_*` token (including the literal
spelling), and invocations of dangerous extension/file functions fail with
`DATABASE_OPERATION_UNSUPPORTED`. Dangerous function names remain valid as
string literals, ordinary columns, or aliases when they are not invoked. The
SQL admission check
is defense in depth:
reader actors execute on their existing readonly SQLite connection; file-mode
writer actors execute on their already identity-verified writer handle while
the serialized read boundary enforces SQLite `query_only`; hot writer actors
execute against an isolated readonly serialized snapshot. Every
prepared statement and any owned connection is finalized when the synchronous
handler returns. A retained facade is closed and cannot outlive that call.

Registered command handlers receive `DatabaseWriteCommandContext`. Its frozen,
null-prototype `db` capability exposes only ReactiveDB's tracked CRUD, natural
identity lookup/mutation, tracked reads, nested `transaction()`, and
`afterCommit()` methods. It does not expose raw SQL (`exec`/`prepare`), the Bun
SQLite handle or persistence service, schema definition, change listeners,
lifecycle controls, or internal-change APIs. The writer creates this facade
itself and executes the handler inside the same transaction as result
validation, so callers cannot substitute a wider context and an invalid result
rolls back tracked writes. The capability is revoked after result validation
and before post-commit callbacks run; retained methods then fail with
`DATABASE_CLOSED` and cannot create work beyond the command
receipt/publication boundary.

Handler input and output still use the bounded database-serializable contract.
Invalid caller input remains `DATABASE_PAYLOAD_INVALID` or
`DATABASE_PAYLOAD_LIMIT`. Invalid or oversized registered query/command output
is producer-side failure and is consistently `DATABASE_RESULT_LIMIT` on both
reader and writer lanes.

Direct ReactiveDB schema definition, app configuration, realm admission, and
physical actor startup all require one `TEXT` or `INTEGER` affinity primary key
per application table. The actor protocol exposes either storage form as a
canonical string row ID, and an `INTEGER` key must fit JavaScript's safe-integer
range. Every schema value must remain one isolated column definition; a
top-level comma or semicolon, injected table constraint, unbalanced grouping,
ambiguous quoted multi-token declared type, or unterminated quote/comment fails
before SQL generation. Other affinities, typeless keys, and missing or multiple
primary-key declarations also fail before use.

The realm-only whole-row rules described above then reject non-primary
`BLOB`/typeless affinity, generated columns, mutating foreign-key actions, and
reserved or colliding SQLite object names before actor startup.

The app server entry imports the realm and branches through Zero's actor
bootstrap before normal startup:

```ts
import {
  createApp,
  runDatabaseActorIfRequested,
} from '@zero/framework/server';
import config from '../zero.config';
import realm from './tenant-database.realm';

const actorProcess = await runDatabaseActorIfRequested({ realm });

if (!actorProcess) {
  const app = await createApp(config);
  app.listen(config.port);
}
```

The realm is imported inside the actor process. Its tables and migrations are
not cloned from the app process. `runDatabaseActorIfRequested()` returns
`false` only when the private actor marker is absent. When the marker is
present, malformed actor arguments or a missing parent IPC channel fail closed
instead of starting the ordinary application server.

Opening a writer follows one ordered boundary:

1. Hold the private root-ownership lock and prove that no actor from an older
   parent generation still holds the rollback-journal liveness lease, then
   rotate the private liveness generation under that same EXCLUSIVE probe.
2. Resolve and prepare the encoded file safely, reject symlinks and hardlinks,
   and retain an `O_NOFOLLOW` descriptor for its exact device/inode.
3. Verify the file's immutable `_zero_database_binding_v1` singleton. A new
   binding is created transactionally only in the pristine file atomically
   reserved by this coordinator; a nonempty unbound image fails closed.
4. Send the validated pseudonymous database reference, immutable instance ID,
   opened-file proof, and private liveness generation through the trusted bind
   message. The
   actor verifies that generation while acquiring its SHARED liveness lease,
   before it opens the assigned database pathname.
5. Verify transport protocol identity/version and the bind-time realm
   fingerprint, then open SQLite and repeat
   the file proof immediately after the path-only Bun SQLite open.
6. Run the immutable migration registry. The stable realm name and database
   instance remain unchanged across ordinary realm-version migrations.
7. Construct ReactiveDB, initialize declared tables, and verify the durable
   binding again before reporting readiness.
8. Publish the schema checksum, actor generation, instance proof, sequence/
   Sync epoch, and safe readiness result. Later committed sequence ranges are
   returned by operations for coordinator-owned wakeup publication.
9. Admit queued operations and reader handles.

Separate files may migrate concurrently within the configured actor capacity.
A failed migration quarantines that database and returns
`DATABASE_MIGRATION_FAILED`; it does not enter an automatic open/fail loop.

Lazy migration on first use is acceptable for the initial actor slice. The
release path also needs a CLI which can list, plan, dry-run, migrate, resume,
and report progress across existing database files before an operator deploys
a schema which requires eager completion.

## ReactiveDB and Realtime

ReactiveDB remains the writer-side owner of tracked mutations and each
database's durable `_changes` order.

After a writer commit, the coordinator publishes the validated pseudonymous
database reference, actor generation, sync epoch, and committed sequence range
from the operation result. That data-free in-memory notification wakes the
parent dispatcher; the durable change log remains the recovery source.

Each socket bridge tracks a delivered cursor for its bound tenant database and
accepts only contiguous sequence batches. After reconnect or actor recovery it
requests durable changes after the last accepted sequence. If retention,
corruption, an actor identity change, or a format change makes that history
unavailable, the bridge invalidates that plane and requires an authoritative
baseline. It never advances a cursor past missing history.

Tenant baselines use one exact actor-owned snapshot session rather than
independent live list pages:

1. `database.tenant-sync.snapshot.begin` opens one SQLite read transaction,
   captures the writer epoch and durable sequence head `H`, and incrementally
   copies the selected rows in primary-key order into private bounded TEMP
   tables. The transaction commits before the actor replies, so no transaction
   or WAL read mark is held across IPC or WebSocket backpressure.
2. `database.tenant-sync.snapshot.page` reads only that immutable
   materialization. A page cursor is a global row ordinal across the exact table
   selection; repeating the same cursor returns the same rows. Concurrent app
   writes after `H` therefore cannot leak into later baseline pages.
3. The socket bridge applies Resource row filters and field projection and
   streams one `sync.snapshot.begin`, bounded `sync.snapshot.chunk` frames, and
   one matching `sync.snapshot.end`. Every frame is measured from its exact
   serialized UTF-8 bytes and capped at 900 KiB.
4. The browser stages those frames without exposing partial table state and
   applies the complete plane-local replacement atomically only at the matching
   end frame.
5. Only after the end frame drains does the bridge accept cursor `H`; it then
   replays the contiguous durable log strictly after `H`.
6. `database.tenant-sync.snapshot.abort` runs from `finally`. Binding release,
   authority reset, actor recovery, and actor close also invalidate or erase
   every outstanding session. An empty table selection still uses begin/abort,
   producing an exact epoch/head proof with zero rows.

The actor enforces all snapshot-session bounds before returning data:

| Bound | Hard value |
| --- | ---: |
| Active sessions per writer actor | 8 |
| Rows in one materialization | 50,000 |
| Encoded source bytes in one materialization | 64 MiB |
| Aggregate encoded source bytes across active sessions | 64 MiB |
| Encoded bytes in one source row | 1 MiB |
| Value-tree nodes in one source row | 10,000 |
| Rows in one actor page | 100 |
| Encoded source bytes in one actor page | 4 MiB |
| Value-tree nodes in one actor page | 18,000 |
| Monotonic elapsed session lifetime, including streaming/backpressure | 30 seconds |

The actor returns an epoch-shaped `expiresAt` value for correlation, but
enforces that lifetime with elapsed monotonic time anchored when the
actor-local session store opens. A backward system-clock correction therefore
cannot extend the 30-second authority window.

The socket bridge independently bounds the complete transfer, including
adaptive actor-page retries and Resource projection work:

| Bridge bound | Hard value |
| --- | ---: |
| Actor page attempts, including adaptive retries | 512 |
| Observed source rows | 50,000 |
| Combined encoded source and projected bytes | 64 MiB |
| Whole-transfer monotonic elapsed deadline | 30 seconds |

Source rows are counted before filtering, so hidden data cannot evade scan
bounds. The byte counter includes both each canonical source row and every
projected row; an unchanged/no-op projection therefore counts both
representations. This deliberately bounds projector expansion and the total
work retained across actor IPC and WebSocket framing.

Session, aggregate-byte, row, page, and deadline checks are repeated at the
SQLite/private-ledger boundary and at actor/coordinator/bridge protocol
boundaries. Session identity is bound to the opaque database reference, writer
generation, binding-owner capability, and ordered table selection. Actor and
coordinator errors preserve only the closed `snapshotReason` vocabulary; logs
and events never contain the session/owner token, database path, table names,
SQL, row data, or raw error text. Active-session or aggregate-byte contention is
retryable `DATABASE_BACKPRESSURE`; an intrinsically oversized snapshot/row is
non-retryable `DATABASE_PAYLOAD_LIMIT`; an expired, missing, or invalid cursor
is `DATABASE_TRANSACTION_EXPIRED`. A cleanup failure emits the dedicated
app-local `sync.tenant_snapshot_cleanup.failed` event with only
`plane: 'tenant-database'` and fixed reason `snapshot-cleanup-failed`, then
forces a fresh baseline. It never includes the caught value or snapshot
identity and never masks an earlier terminal snapshot failure.

No complete tenant baseline is returned as one actor result or one WebSocket
frame. Memory and transport work remain bounded by the materialization,
actor-page, aggregate bridge, deadline, and wire-frame limits. If one
policy-projected row cannot
fit in an otherwise empty chunk, or the staged transfer violates its table,
identity, plane, or frame contract, the server closes with terminal Sync code
`4004`. The browser reports the data/configuration failure and does not enter a
reconnect loop; the schema, projection, or row size must be corrected.
Malformed actor begin/page results and non-retryable actor response-size
violations use the same terminal snapshot-context behavior; they are not
treated as transient resnapshot failures.
Permanent managed-file exhaustion while establishing the tenant binding also
closes once with `4004` and the fixed safe reason
`Tenant Sync database capacity is exhausted`; it is not reported as a snapshot
transport failure. Permanent receipt capacity reached by a mutation instead
returns a negative `SYNC_MUTATION_CAPACITY_EXHAUSTED` acknowledgement and keeps the
socket open, so the client rolls back that optimistic mutation without a
reconnect loop.

The managed Sync implementation preserves one authenticated WebSocket while
multiplexing two logical data planes:

| Plane | Storage owner | Typical tables |
| --- | --- | --- |
| `system` | Pinned Zero-owned system ReactiveDB | Authorized Guardian/Zero client projections |
| `default` | Pinned application ReactiveDB | Global/shared application resources |
| `tenant` | Persistent authority-bound actor lease for the selected tenant file | Tenant Resources with physical storage and `sync`/`all` exposure |

The server splits one `sync.subscribe` request with its trusted Resource
catalog. Each plane independently chooses snapshot or catch-up and emits its
own `plane`, `seq`, `epoch`, and `scope`. Legacy messages without `plane` remain
default-plane messages. A tenant actor wakeup is only a hint: the socket bridge
pulls contiguous durable replay, applies Resource row filters and field
projection, then advances the tenant cursor. Actor generation/epoch changes,
history gaps, malformed continuity, or delivery failure close the connection
for an authoritative reconnect rather than guessing across a gap.

The browser receives a server-authored `tableSyncPlanes` catalog in
`window.__PLATFORM_CONFIG__`. `AppProvider` projects the app's local schemas
through that catalog, excludes known HTTP-only/internal resources, pins
SDK-owned platform tables to `system`, and configures the Sync client. The
client sends its active reconnect cursors in one handshake and maintains independent
epoch, scope, and sequence state for each non-empty plane. It reports the
connection baseline ready only after every expected non-empty plane has
accepted a snapshot or catch-up. Plane-local reset and stream validation cannot
purge or advance the other plane.

Mutation routing is also catalog-derived. The browser includes the resolved
plane as a protocol assertion, but the server independently classifies the
table and rejects a mismatch; neither the message nor browser state can select
a database. Tenant mutations run Resource and Sync policy, actor-side schema
validation, conditional row assertions, authority revalidation, and the
tenant writer FIFO. The origin socket consumes the complete ordered durable
prefix through its commit before receiving a canonical acknowledgement, so a
later acknowledgement cannot leap over unseen tenant changes. The client
always clears the matching optimistic mutation on a definitive acknowledgement,
but applies its canonical row only when the acknowledgement sequence is newer
than that plane's accepted cursor.

Read authorization is fenced at delivery, not only when a subscription starts.
When Resource or platform filters/projectors are installed, the policy adapter
must provide a comparable read-authority fingerprint and a synchronous live
validator; otherwise the socket fails closed. The fingerprint composes the
relevant Resource policy/user-property state with platform membership/reset
revisions. Zero rechecks it after asynchronous reads, drains, filters, and
projectors and immediately before sending snapshot chunks, catch-up/live rows,
deferred rows, or a row-bearing mutation acknowledgement. A change closes the
scope with `Sync read authority changed`; the client purges the affected
authorization scope instead of displaying a row authorized by stale state.
Unfiltered legacy Sync remains compatible, but a custom filtered/projected
adapter cannot opt out of comparable delivery authority.

Tenant selection changes remain authorization-scope replacements. The client
freezes writes, cancels scope-owned work, discards the old authorization data,
reconnects with the replacement credentials, and accepts purging baselines for
the new scope. The server never relabels a tenant A cursor as tenant B, and a
tenant database binding is created only from the verified socket authority.

## Authentication and Tenant Routing

The separate pinned system database owns Guardian identity, sessions, tenant
membership, role assignments, tenant lifecycle, and the authority revision.
The pinned shared application database and Fabric tenant databases never
become authorization truth. Middleware resolves live system authority before
binding an application-data database.

The binding source is the verified authority context:

- a selected tenant session supplies its trusted tenant scope;
- an application-level administrative session receives only explicitly
  authorized administrative capabilities;
- a session without a committed tenant selection receives no tenant database;
- native, browser, mobile, extension, HTTP, websocket, and background
  authority all use the same binding rules.

No caller-provided tenant value is authority, even when it happens to match the
selected tenant.

### Commit-boundary authority

With system authority and application data in separate files, a validation in
the app process is not atomically part of the application SQLite transaction.
A role, membership, or session could otherwise change between validation and
commit. Managed writes therefore use the authority commit fence:

1. The coordinator reaches the head of the database's mutation FIFO.
2. It acquires the process-local shared gate, captures the durable system
   authority revision, and resolves the request's captured authority again.
3. It dispatches the captured revision and trusted system-file binding to the
   already-bound writer; neither value comes from request data.
4. At the final tenant commit edge, the writer actor acquires a shared lease on
   `<systemDb.path>.authority-fence.sqlite`, rereads the authority revision
   directly from the identity-checked system database, and rolls back if the
   lease is busy or the revision differs. It holds that lease through commit or
   rollback.
5. A system-plane ReactiveDB transaction whose authority revision changed
   tries to acquire the exclusive gate at its final commit boundary. It never
   waits while holding SQLite locks: contention rolls that transaction back
   with a retryable conflict. Once acquired, the exclusive lease remains held
   until SQLite commit or rollback is known.

Tenant execution follows authority gate then tenant SQLite transaction. The
system-plane final-commit guard is deliberately non-blocking, which permits
it to discover an authority-table change through SQLite triggers without
creating an inverted-lock deadlock. Code must never begin a SQLite transaction
and then *await* a contended gate. The actor holds its sidecar lease through its
SQLite commit or rollback and releases it once that local outcome is known.
The parent retains the process-local lease until the actor confirms that
outcome; after an unknown response it retains the lease until the failed actor
has exited and SQLite has settled. A caller timeout does not release that
protection while work may still be running. The commit fence is released
before websocket fanout or response delivery. Those later actions do not
change whether the already-committed write was authorized and must not
unnecessarily block revocation.

Every system-plane write to an authority-revision-owning table takes the
exclusive side, including grants, role/status changes, session rotation or
scope switching, membership changes, generation bumps, and revocations.
Versioned SQLite triggers advance one shared authority revision inside the
same transaction, and the installed ReactiveDB commit guard fails closed if a
changed revision cannot obtain the exclusive fence. Managed auth writes must
therefore use a ReactiveDB transaction; privileged raw SQLite is outside this
contract and must not mutate auth-owned tables. The pinned application
ReactiveDB uses the same revision check at its final commit edge.

The resulting order is deterministic: either the tenant write committed while
the authority was current, or the authority change committed first and the
write is denied with `DATABASE_AUTHORITY_CHANGED`.

Within one app runtime, system, pinned-application, and tenant writes share one
process-local coordinator. A file-mode `systemDb` adds the derived
`<systemDb.path>.authority-fence.sqlite` sidecar. The pinned writer and Fabric
writer subprocesses take compatible shared leases, while Guardian takes the
exclusive lease; different tenant files therefore retain concurrent commits
without permitting an authority change to cross any final-commit boundary.
The zero-wait SQLite locks are released by the OS on crash. Fabric roots still
belong to one parent Zero app replica and its managed child actors.
A deployment which attempts to share one Fabric root between independent app
replicas must fail validation rather than silently weaken database ownership.
See [System and Application Database Planes](./system-database.md#authority-fence)
for the exact fence contract.

## Idempotency, Failure, and Restart

A database actor can commit a transaction and exit before its response reaches the
coordinator. The caller cannot infer the outcome from the missing response.

Mutation and command receipts are therefore persisted in the same database
transaction as their effects. Retrying the same idempotency key returns the
recorded result without applying the operation twice.

There are two internal implementations relevant to generated Resources:

- The actor operation ledger stores ordinary async `zero.data` mutation and
  command keys with realm/operation fingerprints. Physical tenant Resources
  use a private trusted wrapper around that ledger so the receipt commits in
  the same tenant database transaction as the actor effect. That wrapper is
  not exposed through `zero.data` or the public async client.
- Generated Resource mutations on the pinned default application database—including
  global and shared-row Resources—use a private default Resource receipt table.
  ReactiveDB applies the row effect and canonical receipt in one transaction.

For generated Resources, both implementations namespace the public key by
stable principal and verified realm, bind it to a separate canonical
fingerprint of resource/action/row/input, and perform lookup before a mutable
row pre-read. An exact hit returns the stored effect, not a later row read.
Current session/tenant authority and Resource policy are rechecked using the
original action's policy shape—update/delete use the immutable preimage; create
uses its original logical input—and current field projection is applied to the
canonical committed row before a row response is returned. Token/session
generations participate in live fencing but not the durable key namespace, so
a legitimate exact retry survives rotation. A direct `zero.data` caller still
owns its explicit actor idempotency key inside the already-bound database; it
does not gain the private Resource principal namespace.

The actor receipt ledger has four independent hard bounds:

| Bound | Export | Value |
| --- | --- | ---: |
| Permanent receipt identities per physical database | `DATABASE_WRITER_MAX_RECEIPT_KEYS` | 1,000,000 |
| Retained full results | `DATABASE_WRITER_MAX_RECEIPTS` | 10,000 |
| One encoded actor receipt result | `DATABASE_WRITER_MAX_RECEIPT_RESULT_BYTES` | 8 MiB |
| Aggregate encoded retained results | `DATABASE_WRITER_MAX_RETAINED_RECEIPT_BYTES` | 64 MiB |

Before inserting a result, the writer atomically converts the oldest retained
results, ordered by durable monotonic insertion ordinal, into compact permanent
tombstones until both the result-count and aggregate-byte bounds fit. A
tombstone keeps the key identity, realm/operation fingerprints, insertion
ordinal, timestamp, and schema version, but removes the result body and final
sequence. The 8 MiB individual bound applies to encoded receipt JSON; it is
large enough for the existing bounded actor result after worst-case JSON string
escaping, while the aggregate bound prevents 10,000 maximum-size results from
accumulating.

Tombstones are never silently deleted. Once the one-million-key bound is
reached, an unseen key fails before application mutation execution with
non-retryable `DATABASE_CAPACITY_EXHAUSTED`, `outcome: 'not-started'`, and
closed `capacityType: 'receipts'` / positive `capacityLimit` details. Exact full
receipt replay still succeeds at the bound, an exact tombstone still returns
the fixed expired-result outcome, and reuse with a different fingerprint still
conflicts. This preserves never-reexecute semantics while placing a hard ceiling
on receipt identity growth; operators must alert on `totalKeys / keyLimit` and
plan a deliberate database lifecycle before exhaustion.

Private validated aggregate statistics and exact SQLite triggers maintain key,
retained-result, and retained-byte counts in the same transaction as insertion
or compaction. Normal writes never scan the permanent tombstone population;
they read constant-size statistics and scan at most the bounded retained-result
window when compaction is necessary. Compaction telemetry reports aggregate
key/result/byte counts, all active limits, and the count/bytes pruned—never
receipt identities. Existing exact version-1 ledgers migrate transactionally to
the version-2 rows and initialize this private metadata. Valid replay results
receive deterministic legacy ordering by creation time and binary key;
malformed rows, missing/private-schema triggers, or incompatible statistics
fail startup without partially migrating the ledger. A legacy ledger already
above the hard permanent-key ceiling also fails migration atomically: Zero
cannot preserve every identity while claiming a smaller durable bound.

The private default/shared-row Resource ledger enforces the equivalent four
bounds in the pinned default ReactiveDB, with Resource-specific exports and its
existing 4 MiB canonical-effect limit:

| Bound | Export | Value |
| --- | --- | ---: |
| Permanent default Resource receipt identities | `RESOURCE_DEFAULT_RECEIPT_MAX_KEYS` | 1,000,000 |
| Retained full Resource results | `RESOURCE_DEFAULT_RECEIPT_RETAINED_LIMIT` | 10,000 |
| One canonical Resource effect | `RESOURCE_DEFAULT_RECEIPT_MAX_RESULT_BYTES` | 4 MiB |
| Aggregate encoded retained Resource results | `RESOURCE_DEFAULT_RECEIPT_MAX_RETAINED_BYTES` | 64 MiB |

Its validated private statistics row and exact insert/update/delete guards are
committed in the same ReactiveDB transaction as the application effect. Normal
admission is constant-time with respect to permanent tombstones; byte/count
compaction visits only the bounded retained-result window. If the permanent-key
ceiling is reached, an unseen generated Resource mutation fails before its
application callback with non-retryable HTTP `503`, code
`resource-idempotency-capacity-exhausted`, and a fixed safe message. Exact
replay, expired-result lookup, and changed-fingerprint conflict detection still
work at the ceiling. The app-local
`resource.receipt.capacity_exhausted` event carries only bounded declarative
Resource context and the aggregate limit—never the key, principal, SQL, row, or
caught error. Default-plane `database.receipt.compacted` events carry the same
aggregate key/result/byte counts, all four limits, and pruned count/bytes as
actor compaction, plus only bounded Resource/action/plane labels. Incompatible
metadata, accounting, or trigger definitions fail closed without deleting a
receipt identity.

Database failures report an explicit commit assertion when one is known:

| Outcome | Meaning |
| --- | --- |
| `not-started` | Work was rejected, canceled, or timed out while still queued. |
| `not-committed` | The actor confirmed rollback or rejected the operation before commit. |
| `unknown` | The actor disappeared or the response boundary failed after dispatch. Retry only with the same idempotency key. |
| `null` | The error class makes no commit assertion, such as a history gap. |

A successful `DatabaseCommitResult` or durable receipt—not an error outcome—is
the positive proof that a mutation committed.

An unknown outcome is not a failed mutation acknowledgement. For actor-backed
Sync, Zero closes the socket with a recoverable service-restart boundary and
leaves the optimistic mutation pending. After the new authoritative baseline,
the client retransmits the same mutation reference and operation fingerprint;
the server looks up the durable logical receipt before reading current row
state. A receipt hit is reauthorized against its immutable preimage/committed
row and returns the canonical acknowledgement without applying the write a
second time. A caller must never replace the reference or change the mutation
while recovering an unknown outcome.

If the matching result has aged out of the full-result window, its tombstone
still prevents re-execution. The database reports non-retryable
`DATABASE_OUTCOME_UNKNOWN` with `outcome: 'unknown'` and safe detail
`receiptState: 'expired'`; a different fingerprint remains a
`DATABASE_CONFLICT` with `idempotency-key-reused`. After a fresh actor-backed
Sync baseline, the same expired mutation receives a negative acknowledgement
with `SYNC_MUTATION_RECEIPT_EXPIRED`. The client then removes that old pending
optimistic mutation and treats the synchronized state as authoritative; it
does not reconnect or execute the mutation again.

Generated Resource HTTP mutations use the same rule through
`Idempotency-Key`. `ResourceMutationError.idempotencyKey` exposes the exact
generated or explicit key when a response is unavailable, allowing the caller
to retry the same logical action. Inside one stable principal-and-tenant
namespace, reusing a key for different canonical input, resource, action, or
row is a `409` conflict. Principal and tenant are namespace boundaries, so one
caller's private receipt cannot expose or conflict with another caller's
receipt.
An exact Resource retry whose full result has expired instead returns
non-retryable `409 resource-idempotency-result-expired`. The caller must read
the authoritative resource state before deciding whether to submit new work
under a new key; retrying the expired key can never re-execute the old write.

On process exit, IPC disconnect, protocol failure, or an unexpected actor
close, the coordinator:

1. Marks the actor generation failed.
2. Rejects undispatched work as `not-started`.
3. Rejects the executing write as `unknown` unless a durable receipt proves
   otherwise.
4. Removes the actor's ownership mapping.
5. Starts a replacement with bounded exponential backoff and circuit breaking.
6. Reopens, migrates, and verifies the database.
7. Publishes a new actor generation and sync epoch.
8. Replays contiguous durable changes or requires a new snapshot.

Replacement policy is scoped to the failed database entry, not the whole
coordinator. Attempts wait `initialDelayMs`, then double up to `maxDelayMs`.
On the `circuitFailureThreshold` attempt and every unsuccessful half-open
attempt after it, Fabric waits `circuitCooldownMs` before trying again. A
successful writer/read-side bind resets that entry's retry count to zero.
Another database continues to use its own actors and queues during this
cooldown. Per-entry diagnostics expose `restartRetryCount` and the derived
`restartCircuitOpen` boolean without exposing paths or process identities.

Operations which arrive while a leased entry is waiting for replacement use
the normal per-database and app-wide queue admission limits. Their individual
`queueTimeoutMs` and `AbortSignal` remain authoritative; they are never held
indefinitely by the restart loop. The operation which discovered an ambiguous
failure receives that original failure and does not silently execute again.
If a replacement attempt itself fails, waiters on that exact attempt receive
its retryable startup failure while the entry schedules the next bounded
attempt. Callers may retry according to the stable error contract.

SQLite rollback on connection loss protects an incomplete transaction, but it
does not tell the parent whether the commit completed immediately before the
loss. The receipt protocol resolves that ambiguity on retry.

Forced process termination is a last-resort shutdown action. Normal closure is
an IPC handshake which drains work, disposes ReactiveDB, closes read handles,
checkpoints the WAL, closes SQLite, and acknowledges completion. The parent
must reap child processes and must not leave orphan database actors after app
shutdown or failed startup.

Parent death is fenced independently from IPC cleanup. Every bound actor keeps
a SHARED transaction open on the private `.zero-internal` liveness database,
which is forced to rollback-journal mode. Before a replacement coordinator can
become ready it performs a zero-timeout EXCLUSIVE probe and transactionally
rotates a private generation token. A still-running orphan therefore produces
retryable `DATABASE_CONFLICT` with `outcome: 'not-started'`; new writer
authority is not admitted until every old actor process has exited or cleanly
released its lease. A bind buffered immediately before parent death also fails
if it arrives after replacement startup because its generation is stale. Root
paths, file proofs, logical references, generation or instance IDs, and inode
values are never attached to that public error or its telemetry.

Hot snapshots legitimately replace the canonical main-file inode. Fabric does
not weaken the logical binding to accommodate that: the database reference and
instance ID stay immutable. Only after the previous actor has exact process
settlement does the coordinator reopen the canonical image, verify that durable
binding, and refresh the physical device/inode proof for the replacement bind.
An ambiguous exit, proof, or instance comparison fails closed.

Within one hot actor's startup, migration and initial-durability snapshots can
also atomically republish the image. The actor retains the prior admitted file
descriptor until it has opened the new inode, verified both its physical proof
and immutable logical binding, and swapped to the new guard. It retains the
final guard through readiness validation and asserts it again immediately
before publishing the binding. Startup never leaves an image replacement
unproved between those boundaries.

## Stable Errors

Multi-database APIs use a stable `DatabaseError` type with a safe message,
machine-readable code, `retryable` flag, and operation outcome. The closed
`DatabaseErrorCode` union includes:

| Code | Meaning |
| --- | --- |
| `DATABASE_CONFIG_INVALID` | Topology or executor configuration is invalid. |
| `DATABASE_DISABLED` | The requested multi-database capability is not enabled. |
| `DATABASE_NOT_READY` | The selected database is opening, migrating, quarantined, or otherwise unavailable. |
| `DATABASE_CLOSED` | The coordinator or bound database capability is closed. |
| `DATABASE_BACKPRESSURE` | Transient queue, actor-slot, binding, or snapshot-session capacity is exhausted. |
| `DATABASE_CAPACITY_EXHAUSTED` | A permanent managed-file or durable-receipt ceiling is exhausted; closed details identify only `files` or `receipts` and the positive aggregate limit. |
| `DATABASE_QUEUE_TIMEOUT` | Work did not begin before its queue deadline. |
| `DATABASE_OPERATION_TIMEOUT` | The caller's operation deadline elapsed after dispatch; write outcome may be unknown. |
| `DATABASE_EXECUTOR_START_FAILED` | The configured actor process could not start or complete its handshake. |
| `DATABASE_EXECUTOR_FAILED` | The assigned executor, actor, or trusted registered-query execution boundary failed, including query preparation or execution failure. |
| `DATABASE_PROTOCOL_ERROR` | IPC validation, versioning, generation, or correlation failed. |
| `DATABASE_OPEN_FAILED` | The actor could not safely open the physical database. |
| `DATABASE_MIGRATION_FAILED` | The database could not reach the required schema. |
| `DATABASE_SCHEMA_MISMATCH` | Actor, realm, reader, or file schema generations disagree. |
| `DATABASE_AUTHORITY_CHANGED` | Live request authority no longer matches the captured authority. |
| `DATABASE_CONFLICT` | A declarative precondition/conditional mutation did not match, an idempotency key was reused for different work, or exclusive root/file/liveness ownership conflicts. |
| `DATABASE_HISTORY_GAP` | Durable incremental changes cannot cover the requested cursor. |
| `DATABASE_PAYLOAD_INVALID` | An operation is not part of the canonical serializable contract. |
| `DATABASE_PAYLOAD_LIMIT` | A valid-shaped operation exceeds a payload bound, or a hot database would exceed its configured logical-image `maxBytes`. |
| `DATABASE_RESULT_LIMIT` | A trusted read/query/command producer returns an invalid or oversized result, or an actor result exceeds its bounded result contract. |
| `DATABASE_OPERATION_UNSUPPORTED` | A table, query, command, or operation is not registered for the realm. |
| `DATABASE_TRANSACTION_EXPIRED` | A transaction-scoped operation crossed its allowed lifetime. |
| `DATABASE_TRANSACTION_STALE` | A transaction or generation token no longer names the active boundary. |
| `DATABASE_OUTCOME_UNKNOWN` | A dispatched write may have committed; retry with the same idempotency key. |

Filesystem-specific path errors may remain a more detailed internal cause.
They are normalized before crossing the public database boundary.

## Observability

Every coordinator is app-local, so database events must use that app's
`PlatformObservabilityRuntime` through `emitPlatformCodeTo`. Actor code sends
safe telemetry envelopes to the parent; it does not choose a process-global
sink.

The central `OBS_CODES` registry and closed `DatabaseObservabilityEvent` union
define the events emitted by the current runtime:

- coordinator configured, started, draining, stopped, and failure;
- writer and reader actor restart and failure;
- database runtime open, close, open failure, and eviction;
- queue saturation, queue timeout, and permanent-capacity exhaustion;
- operation failure and unknown operation outcome;
- change wakeup, replay failure, history gap, and tenant-snapshot failure;
- receipt lookup failure, expiry, and compaction accounting;
- selected runtime placement and configured aggregate file capacity;
- hot periodic dirty/clean state, snapshot start/finish, and fatal durability
  failure.

The event boundary accepts only its declared fields. Current metadata is the
opaque, pseudonymous, validated `databaseRef`; closed placement, durability,
role, phase, reason, operation, and capacity enums; bounded
slot/generation/count/limit,
duration, queue, sequence-range, and aggregate receipt-compaction numbers; and,
for failure variants, normalized `errorCode`, `retryable`, and `outcome`.
The only operation-specific failure classifier is the closed
`failureReason: 'hot-max-bytes'`, emitted for a hot write rejected before commit
with `DATABASE_PAYLOAD_LIMIT` / `outcome: 'not-committed'`. Its corresponding
safe error detail is only `reason: 'max-bytes'`; raw SQLite text, file paths,
SQL, row content, and measured byte values are discarded at actor egress.
There is no process identifier, backend label, SQLite error class, generic
metadata bag, or caller-provided message field.

Sanitization occurs at this producer-facing database event boundary, before an
event reaches the app sink. Unknown fields, accessors/exotic records, invalid
enums, unsafe references, and out-of-range numbers are rejected. A caught value
is normalized immediately and only its stable code/retry/outcome projection is
emitted; its message, stack, cause, and details are not forwarded. Producers
must never place logical tenant IDs, database names, paths, SQL strings, query
inputs, rows, credentials, tokens, invitation data, or raw authorization
references into declared metadata fields.

The coordinator protocol is a useful internal event boundary, but this phase
does not declare a general Zero event bus. A later logging, metrics, and event
bus review can consume these typed lifecycle events without redesigning the
database contract.

## Packaging and Deployment

Database actors must work in development, packed framework installations,
bundled app builds, and supported deployment targets. A source-relative actor
entry which works only inside the Zero repository is not sufficient.

The default packaging direction is same-entry self-spawn. It avoids depending
on a second loose actor artifact:

- In source and normal bundled execution, the parent launches `process.execPath`
  with the resolved server entry and a private `--zero-db-child` argument.
- In a compiled build, the binary launches `process.execPath
  --zero-db-child`, so the executable starts another copy of itself.
- The server entry imports the app configuration and database realm in both
  processes, but the private actor branch runs before normal `createApp()`,
  route loading, server listening, schedulers, or application background work.
- Actor mode requires the expected parent IPC channel and versioned handshake.
  Invoking the private argument without that channel fails closed and exits.
- Database IDs, paths, credentials, and handshake material are not placed in
  command-line arguments; trusted initialization arrives over native IPC.

The compiled self-spawn proof has already passed. The source, packed-package,
and bundled forms still require the complete package acceptance suite.

The package and build contract needs:

1. A framework bootstrap which detects and runs the private database-actor
   branch before ordinary app startup.
2. An app-owned, side-effect-free database realm reachable from the server
   build.
3. A deterministic way to resolve the current source or bundled server entry.
4. Compiled self-spawn through `process.execPath`.
5. An explicit actor-entrypoint override for tests and custom packaging, with
   the same protocol and qualification requirements.
6. Packed-package tests in a fresh consumer.
7. A bundled-app test which self-spawns the emitted server artifact and proves
   native IPC and realm loading.
8. Compiled-binary lifecycle, crash, and shutdown tests beyond the initial
   self-spawn proof.

Same-entry spawning reduces artifact drift, but it does not remove build
validation. The realm and actor bootstrap must be present in the source,
bundle, and binary, and their fingerprints must match the parent. If entry
resolution, IPC, bootstrap, or realm verification fails, startup returns a
stable error. It never executes named databases synchronously or switches
executor backend as a fallback.

File/WAL deployment requires:

- a persistent local volume containing the database files and their WAL/SHM
  companions;
- one parent Zero coordinator/app replica owning a configured database root,
  plus only the child actors it launched;
- a writable private root with sufficient file descriptors and disk space;
- a graceful termination window long enough to drain actors and checkpoint;
- local SQLite-compatible storage, not object storage or an unverified network
  filesystem;
- backup behavior which understands an active WAL database.

### Local filesystem trust boundary

Fabric defends its managed root against ordinary aliasing and handoff errors:
canonical direct-child filenames, private permissions, root ownership locking,
final-component no-follow opens, retained device/inode descriptors, mandatory
single-link files, pre/post-open path checks, immutable per-image logical
identity, and actor-generation liveness fencing. Copying one valid image under
another tenant filename, swapping a pathname during handoff, or hardlinking one
SQLite main file into two writer lanes fails closed.

Bun SQLite currently opens a pathname and does not expose an API for adopting
Fabric's already-verified descriptor. The retained descriptor plus immediate
after-open proof is therefore best-effort against the tiny interval inside the
native path open. The supported deployment boundary requires the Fabric root
and all of its ancestors to be writable only by the Zero service OS identity
and trusted operators. A hostile process with the same UID, root privileges,
or write access to those directories is outside this in-process check's threat
model; isolate such tenants at the OS/container/volume boundary. Do not place a
Fabric root on a filesystem with unstable inode identity, non-POSIX link/lock
semantics, or unqualified network-filesystem SQLite behavior.

Coolify documentation and templates must configure those requirements
explicitly. Native-IPC subprocess actors do not require externally exposed
network ports, but their process count, memory, file descriptors, signals, and
shutdown/reaping behavior must be included in capacity planning.

Tenant main files and their WAL, SHM, or rollback-journal companions are
runtime data and must never enter source control. Zero's scaffolder ignores the
default `data/` tree and common `.db`/`.sqlite` variants; an existing app which
chooses a custom Fabric root must add an equivalent project-specific ignore.

## Hybrid Hot/File Placement

Fabric can place each named or tenant database in direct file/WAL storage or in
Zero's RAM-active hot runtime. A hybrid selector makes that decision from the
opaque logical binding reference. It is a classification policy, not an
automatic heat detector: Fabric does not measure tenants and promote, demote,
or spill them on its own.

### File placement

File placement is the conservative default:

- SQLite commits directly to the database/WAL durability boundary.
- One FIFO writer actor owns the file.
- With `readers: true`, one separate read-only actor per active file can read a
  committed WAL snapshot while the writer is busy.
- Separate physical files have separate lock domains and can write
  concurrently when coordinator capacity is available.

Deployment and backup procedures must preserve the database plus active
WAL/SHM companions and respect the single-parent ownership boundary.

### Hot placement and `maxBytes`

Hot placement restores a durable SQLite image into a RAM-active connection and
uses the same writer-side ReactiveDB ordering, migrations, receipts, Sync log,
and schema validation as file placement. It intentionally has no separate
reader actor: all reads and writes use the hot writer lane. The top-level
`readers` switch affects only entries placed on file/WAL.

Every explicit hot policy requires a positive safe-integer `maxBytes`; the
`'hot'` shorthand uses 64 MiB per database. Zero enforces this as a hard
logical SQLite image/page budget during restore, migrations, ReactiveDB schema
initialization, runtime writes, and snapshot serialization. App migrations
cannot enlarge `PRAGMA max_page_count` past the captured budget. A crash-left
WAL is recovered/checkpointed before the restored logical image is measured,
so raw main-file-plus-WAL bytes do not falsely reject a valid image.

`maxBytes` is not a promise about process RSS. SQLite, Bun, actor state,
queries, result buffers, and snapshot I/O add memory overhead. The product of
`maxDatabases` and `hot.maxBytes` is a useful worst-case configured image
budget if every active entry can be hot, not a global byte-level admission
scheduler. Size both bounds from measured production behavior.

### Hot durability policies

Every hot entry writes an initial durable image after restore/migration before
the actor is published. Its configured durability then controls when later
commits become snapshots:

| Policy | Acknowledgement boundary | Crash contract |
| --- | --- | --- |
| `on-write` | Every non-replayed commit publishes and fsyncs an atomic snapshot before success is returned. | No acknowledged-write loss is accepted by the configured policy. A post-commit snapshot failure reports an unknown outcome and retires the unsafe generation. This default is the recommended hot policy when callers cannot accept rolled-back acknowledged state. |
| `periodic` | A commit may be acknowledged before its image publishes, within the strict configured `snapshotIntervalMs` window. | A crash or runtime durability failure may lose acknowledged writes not covered by the latest successful snapshot, but the oldest uncovered acknowledgement may not remain dirty beyond the configured interval. |
| `final` | Ordinary commits do not snapshot. A clean close must publish a final image before the actor acknowledges shutdown. | A crash can lose every acknowledged write since the last durable image. Use only when that explicit loss model is acceptable. |

Periodic mode defaults to a 30-second interval. The first commit not covered by
the published image marks the actor dirty *before* its response is exposed and
starts an asynchronous snapshot immediately. Later commits never extend the
oldest dirty deadline. A commit which lands during snapshot I/O stays dirty and
forces a follow-up capture. If the current image is already at the interval
boundary, the writer performs a synchronous snapshot fence before returning.
The parent coordinator independently tracks the oldest dirty deadline and
retires the generation if it reaches `snapshotIntervalMs`; a separate
`snapshotTimeoutMs` watchdog bounds one snapshot operation. The watchdog must
be at least the interval and defaults to twice the cadence with a two-minute
minimum, capped at the portable timer maximum.

A periodic runtime snapshot failure or missed dirty deadline retires and
settles that generation, then the coordinator automatically reopens the last
durable image under a new actor generation. Tenant Sync resets and resnapshots
from that authority. Any acknowledgements newer than the durable
image can disappear—up to the configured oldest-dirty window—and an ordinary
HTTP caller can later observe the rolled-back state. Periodic mode is therefore
bounded-loss, not lossless; choose the default `on-write` policy when an
acknowledged mutation must survive actor/process failure.

`On-write` already has a current durable commit image before each successful
mutation response. `periodic` and `final` require a final graceful-close
snapshot to treat release as cleanly durable. A periodic or final
graceful-close proof failure quarantines the entry
instead of reopening it as though clean shutdown succeeded. A forced actor exit
cannot manufacture this proof. That quarantine belongs to the live coordinator
process; it is not an on-disk poison marker. If the entire app process then
restarts, Fabric follows the configured crash contract and opens the last
durable image: periodic may lose only its documented uncovered window, while
`final` may lose every write since the generation opened. Applications that
cannot accept either crash contract must use `on-write`.

Placement remains pinned while an entry is owned. Consequently the current
implementation does not need to reconcile live sequence/epoch state across a
placement transition and cannot create simultaneous hot and file writers by
transitioning a live entry. Clean eviction may re-evaluate the selector on the
next open, but Fabric provides no online promotion/demotion workflow, data-copy
or cutover API, or operator fleet migration.

Hybrid does not mean every tenant should be hot. Strict disk-first workloads
can remain file/WAL; carefully bounded workloads can opt into a documented hot
durability policy. Zero-owned control, auth, logging, metrics, and plugin
realms do not move under this selector today.

### KV integration boundary

Zero's current [KV service](../kv.md) is an optional, app-local, memory-first
store with a journal/checkpoint durability path. It is mounted after the core
database composition, so neither the actor foundation nor the hybrid
placement selector may depend on KV being present. KV may later hold
non-authoritative heat/activity hints, compiled placement caches,
retry/backoff state, or diagnostic TTLs.

KV must never hold tenant rows, routing authority, database ownership or
leases, authorization fences, replay cursors, mutation/idempotency receipts,
or distributed locks. Placement selection and recovery state remain
deterministic outside KV. Losing or rebuilding KV may affect performance only;
it must not change ownership, authorization, durability, ordering, or
correctness.

## Rollout Phases

### Phase 0 — Foundations

Status: implemented and covered in the candidate test suite.

- Opaque ID normalization and safe deterministic file mapping.
- Root/file containment, symlink, type, and permission checks.
- One physical `DatabaseRuntime` abstraction.
- Immutable custom migration registries.
- Sync ownership injection for the pinned application ReactiveDB.
- Separate pinned system/application identity and lifecycle tests.

The foundations remain an unreleased contract until the applicable integration
and release gates are qualified.

### Phase 1 — Qualified actor data plane

Status: implemented and covered by unit plus real-subprocess integration tests;
deployment-matrix and package acceptance remain release gates.

- `DatabaseExecutor` and executor-factory boundaries.
- Bun subprocess/native-IPC concurrency and compiled self-spawn proof: passed.
- Writer-actor coordinator, per-database FIFO lanes, and bounded immediate
  actor-capacity admission.
- Separate read-only actor pool.
- Snapshot, read-your-writes, and strong consistency.
- Async CRUD, declarative batch, and registered query/command APIs.
- Actor realm and migration lifecycle.
- Durable idempotency receipts and unknown-outcome recovery.
- Stable database errors.
- App-local observability.
- Graceful drain, failure restart, and quarantine.
- Development, package, bundle, and deployment artifacts.
- Deterministic concurrency and crash tests.

The actor data plane now satisfies the in-repository architecture gate. It is
not yet independently releasable until package/bundle and supported deployment
matrix acceptance pass, and it does not by itself complete the tenant-file or
overall multi-database initiative.

### Phase 2 — Realtime execution boundary

Status: implemented with focused server, browser, policy, and actor integration
coverage; full release/package acceptance remains open.

- System, default application, and tenant data planes multiplexed on one
  authenticated WebSocket.
- Persistent per-socket tenant binding, actor snapshot, durable replay, wakeup,
  and release lifecycle.
- Independent per-plane epoch, scope, sequence, baseline, catch-up, reset, and
  browser stream guards.
- Server-authored table routing injected through `AppProvider`; browser plane
  values remain assertions rather than routing authority.
- Resource-policy-filtered reads, field projection, conditional mutations,
  commit-time authority checks, and canonical acknowledgements.
- Durable mutation receipt replay, origin handling, unknown-outcome reconnect,
  and actor-generation/history-gap resnapshot behavior.

### Phase 3 — Auth-derived tenant files

Status: core authenticated request, Resource, lazy-query, and realtime routing
are implemented in the release candidate. Tenant fleet lifecycle and
operational administration remain open.

- Bind databases only from verified tenant authority. Implemented in the
  manager, ordinary route `zero.data` projection, generated Resource HTTP CRUD,
  lazy `/api/data` reads, and actor-backed WebSocket Sync.
- Use the same bearer/session authority boundary for browser, native, mobile,
  extension, HTTP, WebSocket, and trusted background-service projections.
  Ordinary transports never accept a database or tenant selector.
- Add the authority mutation gate to every relevant control-plane mutation.
  The ReactiveDB final-commit fence and tenant actor commit fence are
  implemented; the complete managed-auth write-path audit remains a release
  gate.
- Adapt remaining built-in services which currently assume one synchronous
  ReactiveDB. Ordinary route data, generated Resource HTTP, lazy data-query,
  and WebSocket Sync are adapted; each additional service must use the trusted
  service-data scope instead of selecting a database directly.
- Add tenant lifecycle, suspension, deletion, export, backup, and restore
  behavior.
- Add admin/tenant diagnostics and operational controls.

### Phase 4 — Hybrid hot/file placement

Status: bounded placement and durability are implemented in the release
candidate; full release/package acceptance remains open.

- File, hot shorthand, and synchronous opaque-ref hybrid policy.
- Per-entry placement pinning with clean-eviction re-evaluation.
- Hard logical-image bounds and placement-aware reader scheduling.
- On-write, strict periodic-window, and final-close durability contracts.
- Restart/restore, WAL recovery, durability failure, observability, and Doctor
  coverage.

Online promotion/demotion and automatic heat/spill policy are not part of this
phase. Operator-grade migration, backup/restore, fleet administration, and the
supported package/OS matrix remain release gaps, so the broader initiative is
not yet a released platform claim.

### Phase 5 — Realm expansion

Status: future work.

- Keep the already-separated Guardian/Zero system plane pinned and optionally
  place logging, metrics, audit, plugin, or other service realms into further
  dedicated databases.
- Reuse the same database coordinator, placement, migration, authority, and
  observability contracts.
- Avoid subsystem-specific SQLite managers.

## Deterministic Acceptance Tests

Concurrency tests use explicit barriers, not timing guesses.
`SharedArrayBuffer`/`Atomics` are not the subprocess coordination mechanism:
they do not provide the shared in-process memory contract used by Web Workers.

A test actor reports `entered` over native IPC after it acquires the SQLite
transaction. It then waits on a harness-owned release mechanism which remains
usable while that actor's JavaScript lane is blocked, such as a unique
filesystem sentinel or native named pipe. An alternative test-only actor may
hold a manually opened transaction in a state machine while leaving its IPC
listener able to receive an explicit release command. The production
transaction API remains synchronous and must not acquire this test behavior.

### Executor qualification

The initial `subprocess-ipc` proof gate has passed on the installed Bun 1.3.14
runtime:

- two separate-file WAL writes held approximately 600ms transactions and
  completed together in approximately 605ms;
- a read-only same-file WAL query completed in under 1ms while an
  approximately 805ms writer remained open;
- graceful native-IPC shutdown completed cleanly;
- a compiled executable successfully self-spawned with the private actor
  argument.

Before public enablement, the pinned Bun version and every supported
operating-system/architecture combination must still pass:

- repeated and stressed versions of the separate-file and same-file proofs;
- repeated spawn, IPC handshake, graceful close, forced exit, and reap cycles;
- actor crash during an open transaction and immediately after commit;
- malformed, oversized, duplicated, late, and wrong-generation IPC messages;
- parent exit and actor exit without orphaned subprocesses;
- a sustained concurrency soak with database integrity checks;
- the packaged, bundled, and self-spawn acceptance tests below.

The current Web Worker backend remains disabled. A future pinned Bun release
may qualify it only by passing the same database, crash, lifecycle, packaging,
and soak suite without a segfault. Qualification makes it an explicit backend
option; it does not make it a silent fallback from subprocess failure.

### Cross-file writes overlap

1. Configure at least two writer slots.
2. Database A enters `BEGIN IMMEDIATE`, reports `entered`, and waits.
3. Database B does the same on another file.
4. Assert both subprocess actors reported `entered` before either barrier is
   released.
5. Release both and verify their independent commits and sequences.

The actor-backed coordinator passes this boundary with distinct writer
subprocesses; the assertion remains part of pinned-runtime qualification.

### Same-file reader overlaps a writer

1. Commit value `v1`.
2. The writer begins an immediate transaction, updates to `v2`, reports
   `entered`, and waits before commit.
3. A reader actor completes a snapshot read while the writer remains blocked
   and returns committed value `v1`.
4. Release the writer.
5. A read-your-writes read carrying the commit sequence returns `v2`.

### Same-file writes remain serialized

1. The first write enters its transaction and waits.
2. Submit a second write for the same database.
3. Assert the second write does not enter SQLite before the first releases.
4. Verify commit and change sequence order.

### Backpressure and admission

- Block every writer slot and fill bounded queues.
- Verify overflow and queue deadlines return their stable error codes.
- Verify cancellation removes only undispatched work.
- Verify an already-admitted database uses its own FIFO while a new database
  receives retryable backpressure when every slot is active and non-evictable.
- Verify no runtime with in-flight work is evicted.

### Failure and ambiguity

- Crash before commit and verify SQLite rollback and no emitted change.
- Commit, then crash before replying; verify `unknown` outcome.
- Retry the same idempotency key and receive the single durable result.
- Restart with a new actor generation and no stale response acceptance.
- Exercise restart backoff and database quarantine.

### Realtime ordering

- Deliver same-database changes in exact contiguous sequence order.
- Keep different databases' sequences and subscribers independent.
- Recover an actor by replaying the durable log after the delivered cursor.
- Force a retained-history gap and verify an authoritative resnapshot.
- Verify a tenant baseline captures head `H`, pages one immutable snapshot
  exactly at `H`, applies that snapshot atomically after its end frame, and
  then replays every contiguous durable change after `H`.
- Verify every serialized begin/chunk/end frame stays at or below 900 KiB and
  one untransportable projected row closes once with terminal code `4004`.

### Migrations and readers

- Race first opens of one database and prove one migration owner.
- Migrate two different files concurrently when actor capacity admits both
  database entries.
- Prevent readers from opening before schema readiness.
- Close or refresh reader handles on a schema-generation change.
- Quarantine a failed migration without retry spinning.

### Compatibility and packaging

- Run the complete existing single-database suite with topology omitted.
- Prove the default service identities and ownership rules remain unchanged.
- Run subprocess actor mode from the source checkout, a packed package in a
  fresh consumer, and a bundled application artifact.
- Fail clearly when actor bootstrap, entry resolution, IPC, or realm loading
  is unavailable.
- Exercise graceful application shutdown with active readers, writers, and
  queued work.
- Run deployment smoke tests against a persistent local volume.

### Hybrid placement acceptance

The release candidate must retain deterministic coverage for:

- shorthand and explicit policy normalization, invalid selector results, and
  opaque-ref helper matching;
- per-entry placement pinning across crash replacement and policy
  re-evaluation after clean eviction;
- hard hot image bounds during restore, migration, schema creation, writes,
  and snapshot serialization;
- on-write acknowledgement durability and unknown-outcome handling;
- the strict periodic oldest-dirty deadline, immediate/follow-up capture,
  separate I/O watchdog, crash loss window, and failure retirement;
- final-mode crash loss plus required clean-close snapshot;
- hot writer-only scheduling and file-only reader actors;
- sequence, receipt, authority, and realtime behavior in each placement; and
- placement-safe diagnostics and observability without logical IDs or paths.

Online file-to-hot promotion, hot-to-file demotion, automatic spill, and
placement-aware fleet backup/restore are explicit non-goals of the implemented
runtime. They require separate operator design and must not be inferred from a
selector changing after an entry has already opened.

## Implemented Candidate Surface and Remaining Work

The release candidate composes the following production-shaped boundaries:

- validated pseudonymous-reference file resolution, private root ownership,
  and one writer owner per physical database;
- bounded subprocess writer/reader actors behind `DatabaseCoordinator` and
  `DatabaseManager`;
- bounded file/hot placement selected synchronously from opaque binding refs,
  with per-entry pinning and explicit hot durability contracts;
- side-effect-free `defineDatabaseRealm()` schema, migration, query, and
  command registration;
- authority-derived short-lived request bindings plus persistent per-socket
  tenant Sync bindings;
- asynchronous `zero.data`, generated Resource CRUD, `/api/data`, and
  actor-backed Sync without exposing a manager, path, SQLite handle, or tenant
  selector to application requests;
- exact Resource-to-realm topology validation, exposure-aware Sync catalogs,
  server-injected browser plane routing, and legacy single/default-plane
  compatibility;
- app-local structured errors and observability, bounded queues, generation
  recovery, deterministic shutdown, and focused real-subprocess tests.

Publication still requires the complete supported-platform package/bundle/
deployment matrix, operator-grade tenant fleet migration and lifecycle tools,
backup/restore and suspension/deletion workflows, and production acceptance of
the implemented placement policies. Distributed root ownership, online
placement migration, automatic promotion/spill, and separation of additional
Zero-owned service realms beyond the system/application split are not
implemented. Those remaining gates do not make Resource, tenant Sync, or
bounded hybrid routing "pending"; they constrain the narrower release claims
that may be made about the candidate.

## Release Boundary

The following claims have different completion points and must not be
collapsed into one status:

| Claim | Required phase | Candidate status |
| --- | --- | --- |
| Multiple isolated SQLite files can be resolved and opened safely | Phase 0 | Implemented |
| Different files execute writes concurrently and the same file supports WAL readers | Phase 1 | Implemented; release matrix pending |
| A selected tenant file participates in Zero realtime snapshot, catch-up, mutation, and ordered change delivery | Phase 2 | Implemented; release acceptance pending |
| Authenticated tenant requests are automatically and safely routed to their file | Phase 3 | Core data paths implemented; fleet lifecycle pending |
| Multi-database mode supports bounded policy-driven hot and file placement | Phase 4 | Implemented; release acceptance pending |
| The overall multi-database initiative is a released platform contract | Phases 0–4, documentation, package/OS matrix, and operational acceptance | Not complete |

Until the relevant phase passes its tests, Zero's public documentation and
release notes must use the narrower completed claim.

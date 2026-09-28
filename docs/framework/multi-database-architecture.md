# Multi-Database Architecture

> **Status:** active implementation on the child multi-database feature
> branch; it is not merged or released. The file/WAL actor foundation is now
> implemented with isolated Bun subprocesses, native IPC, bounded per-file
> writer queues, separate WAL readers, durable idempotency receipts, change
> replay, generation recovery, root ownership, app-local observability, and
> deterministic shutdown. `createApp()` validates and owns the topology, the
> historical default/control database remains pinned, and tenant bindings are
> derived from trusted authorization scope with a cross-file commit fence.
> Real subprocess tests prove persistence, same-file read/write overlap, and
> concurrent writes to separate files. The ordinary request capability,
> generated resource/data transports, multi-database realtime, migration and
> doctor workflows, packaging acceptance, and hybrid hot/file placement still
> have integration work remaining. Nothing in this document marks those
> unfinished slices as release-ready.
>
> A minimal two-Web-Worker `bun:sqlite` proof segfaulted on the installed Bun
> 1.3.14 runtime and later Worker runs showed nondeterministic corruption or
> failure before termination. Web Workers are not the production backend. The
> isolated Bun subprocess/native-IPC backend is the qualified production
> direction; the full application and release acceptance suite remains
> required before this branch can merge.

## Purpose

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

The initiative has two distinct storage goals:

1. File/WAL databases running on bounded writer and reader actor pools. This
   is the current concurrency phase.
2. Policy-driven hybrid placement in which appropriate databases can use
   Zero's hot snapshot runtime while others remain file/WAL databases. This is
   a required later phase, not an optional idea and not part of the current
   actor implementation.

The overall multi-database initiative is not complete until the hybrid
hot/file placement phase has been implemented and tested. Current actor work
must not imply that multi-database hot placement already exists.

## Current Decision

The production direction is a compatibility-preserving database coordinator
over an explicit executor abstraction:

- The historical default database remains pinned to the app runtime.
- Named and tenant files use asynchronous operations dispatched to isolated
  database actors.
- Exactly one writer actor owned by one coordinator topology controls a
  physical database at a time.
- Different physical databases can write concurrently on different actor
  processes.
- Separate reader actors open read-only connections so WAL reads can proceed
  while the file's writer is active.
- One database's writes remain FIFO and transactional.
- The public API sends serializable operations; it never sends callbacks,
  SQLite handles, ReactiveDB instances, or arbitrary request-selected SQL to a
  remote actor.
- ReactiveDB remains the writer-side change-log and ordering engine.
- The manager already derives tenant-file routing from trusted authorization
  scope and fences tenant commits against control-plane authority changes.
  Request/resource projection and the multi-database Sync transport are the
  next integration slices on the same architecture, not exceptions to it.

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
7. No named or tenant file is opened in hot or ephemeral mode during the
   current file/WAL actor phase.
8. Database paths and logical tenant identifiers never appear in public
   errors, request-visible diagnostics, or ordinary observability metadata.

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

The default database and multi-database data plane have deliberately different
contracts:

| Plane | Execution | Storage in current phase | API | Primary purpose |
| --- | --- | --- | --- | --- |
| Default/control | App runtime | Existing `hot`, `file`, or `ephemeral` behavior | Existing synchronous `zero.db` and `zero.sql` | Zero control plane and compatibility application data |
| Named/tenant writer | Bounded subprocess writer actors through `DatabaseExecutor` | File/WAL only | New asynchronous database client | Isolated application data and ordered mutations |
| Named/tenant reader | Bounded subprocess reader actors through `DatabaseExecutor` | Read-only connections to file/WAL databases | New asynchronous reads | Snapshot reads concurrent with an active writer |

The default database initially continues to hold global identity, sessions,
tenant membership, tenant registry, platform-administrator state, and any
other mandatory Zero control-plane tables. Two operations that both mutate
that one physical file are still subject to SQLite's one-writer rule. Once
authentication has selected a tenant, application operations against tenant A
and tenant B use different writer actors and do not wait on one another.

### Where tenant scope lives

Zero supports two explicit tenancy storage strategies; services never infer a
strategy from the presence or absence of a column:

| Strategy | Isolation authority | Application-table shape | Query behavior |
| --- | --- | --- | --- |
| `shared-row` | Verified tenant scope plus a trusted row predicate | Tenant-owned tables carry the configured tenant-scope column | Resource and service adapters inject and enforce that scope for every read and mutation |
| `tenant-database` | The already-bound physical database capability | Tenant-owned tables normally omit a redundant tenant-scope column | Resource and service adapters execute inside that tenant's file without adding a tenant predicate |

The control plane remains shared in the first tenant-file release. Tenants,
memberships, invitations, sessions, role assignments, platform administration,
database placement, and other cross-tenant records therefore retain explicit
tenant references. Application data which is intentionally global or
cross-tenant belongs in a separately declared shared/control realm as well.

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

Database doctor and planning commands understand the same resolved strategy.
They remain read-only and may report stable findings such as:

- a tenant-owned realm in `tenant-database` mode still has a likely redundant
  tenant-scope column or automatic row-scope policy;
- a retained tenant reference is still used for business meaning, export,
  audit provenance, or migration compatibility and must not be treated as
  automatically removable;
- a `shared-row` table is missing its configured tenant column, scope policy,
  or supporting tenant-oriented index;
- a service/resource is wired to the shared-row adapter while its realm is
  configured for isolated files, or the inverse;
- a control/shared realm has incorrectly lost the tenant references required
  for cross-tenant administration.

Doctor never drops a column, rewrites a policy, creates a file, or moves data.
An explicit dry-run tenancy migration planner turns applicable findings into
ordered operator-reviewed steps.

Later realm separation may move additional Zero subsystems into their own
databases. That work must use the same coordinator and authority rules rather
than opening ad hoc SQLite handles.

## App-Local Coordinator

`createApp()` owns one coordinator through `ZeroAppRuntime`. The coordinator
owns scheduling and IPC, but not the default database's compatibility API.

Its responsibilities are:

- Maintain internal database bindings and safe database references.
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
interface DatabaseExecutor {
  readonly backend: 'subprocess-ipc' | 'web-worker';
  readonly slot: number;

  start(): Promise<DatabaseExecutorReady>;
  request(message: DatabaseActorRequest): Promise<DatabaseActorResponse>;
  close(options?: { deadlineMs?: number }): Promise<void>;
  terminate(): Promise<void>;
  diagnostics(): DatabaseExecutorDiagnostics;
}

interface DatabaseExecutorFactory {
  createWriter(slot: number): DatabaseExecutor;
  createReader(slot: number): DatabaseExecutor;
}
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
- captures or redirects child stdout/stderr through bounded, redacted
  observability handling;
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
| Main-thread/in-process | Does not provide the required concurrency | Unit-test helpers and the historical default DB only; never a named-database fallback |

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
3. If no actor owns the database, the fair scheduler assigns an idle slot.
4. The writer actor prepares the file, imports the database realm, migrates and
   opens ReactiveDB, registers change delivery, and reports ready.
5. The coordinator sends one operation at a time for that database.
6. When the queue and in-flight count reach zero, an idle deadline permits a
   graceful close and slot reuse.

An implementation may cache only the runtime currently owned by a writer
slot. It must not hash many active tenant actors permanently onto one process;
that would make an unrelated long-running operation block every database on
that execution lane.

The scheduler operates by database, not only by request. Round-robin or
equivalent fair selection prevents a hot tenant with a large FIFO from
starving a tenant with one waiting operation.

### Bounded backpressure

Configuration needs separate controls for:

- writer concurrency;
- reader concurrency;
- maximum pending operations per database;
- maximum pending operations across the app;
- queue wait deadline;
- operation deadline;
- idle runtime deadline;
- maximum concurrent migrations.

Queue overflow fails before dispatch with `DATABASE_BACKPRESSURE`. Exceeding a
queue deadline fails with `DATABASE_QUEUE_TIMEOUT`. An `AbortSignal` can remove
work which has not started. Once a synchronous SQLite operation begins, Zero
must not report cancellation as proof that the database operation stopped.

A request timeout and a database outcome are separate facts. The HTTP caller
may stop waiting while the actor finishes the operation, records its receipt,
and emits its committed changes.

## Same-File Reader Model

WAL allows readers and one writer to coexist when they use different
connections. Zero therefore uses a separate bounded reader-actor pool.

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
| `snapshot` | Reader actor | One committed WAL snapshot at operation start | May not include a concurrent or not-yet-observed commit |
| `read-your-writes` | Reader actor with `minSeq` | Snapshot sequence is at least the caller's prior commit token | May wait briefly for a fresh read transaction |
| `strong` | Writer FIFO | Runs after previously queued writes for that database | Does not overlap that database's writer |

A writer may hold an uncommitted update while a snapshot reader completes and
returns the previous committed value. After commit, a read carrying the
returned sequence token must observe that commit or fail with a stable
deadline error.

## Public API Direction

Executor-backed database methods are asynchronous. They do not change the
existing synchronous default API.

The intended bound surface is conceptually:

```ts
interface AsyncDatabaseClient {
  get<Table extends TableName>(
    table: Table,
    id: string,
    options?: ReadOptions,
  ): Promise<RowFor<Table> | null>;

  list<Table extends TableName>(
    table: Table,
    query?: SerializableQuery<RowFor<Table>>,
    options?: ReadOptions,
  ): Promise<readonly RowFor<Table>[]>;

  query<Name extends QueryName>(
    name: Name,
    input: QueryInput<Name>,
    options?: ReadOptions,
  ): Promise<QueryOutput<Name>>;

  mutate(
    mutation: SerializableMutation,
    options?: MutationOptions,
  ): Promise<CommitResult>;

  batch(
    input: {
      assertions?: readonly SerializableAssertion[];
      mutations: readonly SerializableMutation[];
    },
    options?: MutationOptions,
  ): Promise<BatchCommitResult>;

  command<Name extends CommandName>(
    name: Name,
    input: CommandInput<Name>,
    options?: MutationOptions,
  ): Promise<CommandOutput<Name>>;
}
```

`batch()` is the atomic public primitive. A callback-shaped transaction API is
not compatible with a remote actor boundary and must not be simulated by
serializing function source.

Registered queries and commands live in an app-owned database realm imported
inside the actor. Public request code sends their registered name and
validated input. Ordinary bound clients cannot submit raw SQL.

Mutation options include an idempotency key, deadline, and signal. A commit
result contains the database's durable sequence token. Values and results must
pass explicit structured-clone and payload-size validation.

### Tenant-bound access

Once automatic tenant routing lands, ordinary authenticated route code should
receive an already-bound async client, for example under a final name such as
`zero.data` or `zero.tenantDb`. The exact name remains an API decision; the
security shape does not:

```ts
handler: async ({ zero }) => {
  return zero.data.list('projects', { orderBy: ['created_at', 'desc'] });
}
```

There is no `tenantId` argument because the authorization middleware has
already bound the client. Explicit cross-database administration belongs to a
privileged setup/admin capability, not the normal request facade.

## Actor Protocol

IPC uses versioned discriminated unions validated at both ends. A request
envelope carries only internal routing and correlation data:

```ts
interface DatabaseActorRequest {
  protocolVersion: number;
  requestId: string;
  databaseRef: string;
  generation: number;
  operation: SerializableDatabaseOperation;
  deadlineAt: number;
  trace?: {
    requestId?: string;
    traceId?: string;
  };
}
```

`databaseRef` is a non-sensitive internal digest. It is not a tenant ID,
logical database name, or path. Only trusted actor initialization receives
the prepared path required to open SQLite, and that path is never copied into
public results or ordinary telemetry.

Parent-to-actor messages cover initialization, opening, execution, replay,
graceful close, and shutdown. Actor-to-parent messages cover readiness,
results, durable changes available, safe diagnostics, faults, and closure.
The same logical envelopes travel over Bun native subprocess IPC today and
may travel over another explicitly qualified executor backend later.

The protocol must enforce:

- maximum message and result sizes;
- supported scalar, row, binary, and query shapes;
- protocol/build/realm fingerprints;
- matching request, database, and actor generation;
- canonical error serialization;
- rejection of unknown message kinds and fields.

Arbitrary actor `Error` prototypes and stacks are not deserialized into the
application or returned to a client.

## Database Realm and Migrations

Functions cannot cross the actor IPC boundary. Inline migration functions,
mutation validators, and custom query handlers therefore cannot be the final
topology configuration.

An app declares a side-effect-free database realm:

```ts
export default defineDatabaseRealm({
  tables,
  migrations,
  queries,
  commands,
});
```

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
not cloned from the app process. The bootstrap name and final app-server shape
remain directional until implementation fixes the public package contract.

Opening a writer follows one ordered boundary:

1. Resolve and prepare the encoded file safely.
2. Confirm the coordinator-owned exclusive writer claim for the file.
3. Verify protocol, build, and realm fingerprints.
4. Open the file/WAL SQLite service.
5. Run the immutable migration registry.
6. Construct ReactiveDB and initialize declared tables.
7. Register change delivery.
8. Publish the schema generation and actor readiness.
9. Admit queued operations and reader handles.

Separate files may migrate concurrently, subject to a dedicated migration
limit. A failed migration quarantines that database and returns
`DATABASE_MIGRATION_FAILED`; it does not enter an automatic open/fail loop.

Lazy migration on first use is acceptable for the initial actor slice. The
release path also needs a CLI which can list, plan, dry-run, migrate, resume,
and report progress across existing database files before an operator deploys
a schema which requires eager completion.

## ReactiveDB and Realtime

ReactiveDB remains the writer-side owner of tracked mutations and each
database's durable `_changes` order.

The writer registers its change listener before accepting work. Change
notifications contain the safe database reference, actor generation, sync
epoch, and sequence range. An in-memory notification wakes the parent
dispatcher; the durable change log remains the recovery source.

The parent tracks one delivered cursor per database and accepts only
contiguous sequence batches. After an actor restart it requests durable
changes after the last delivered sequence. If retention, corruption, or a
format change makes that history unavailable, the dispatcher invalidates the
subscription and requires an authoritative snapshot. It never advances a
cursor past missing history.

A snapshot uses one reader transaction:

1. Read the durable current sequence to establish the WAL snapshot.
2. Read every table and row allowed by the subscriber's policy.
3. Return the rows and represented sequence together.
4. Replay later contiguous changes.

The current Sync plugin assumes one local synchronous ReactiveDB. Injecting a
ReactiveDB into that plugin is useful for composing the default runtime, but it
does not provide tenant-file routing. Multi-database Sync requires an async
storage-executor boundary beneath the existing wire, policy, receipt, and
projection logic.

The compatibility-preserving transport model is exactly one physical
application-data change stream per Sync socket. The current wire, client
store, and stream guard intentionally carry one scalar epoch, scope, and
sequence cursor; a socket must not silently merge the control database and a
tenant database into that cursor. Control-plane authority changes reach the
socket through internal invalidation/revalidation, while its table snapshot,
catch-up, changes, and mutations all belong to the one bound application-data
file.

Tenant selection changes are authorization-scope replacements. The client
enters its existing authorization transition barrier, freezes mutations,
closes the old socket, purges tenant-scoped XState store data, reconnects, and
accepts an explicit replacement snapshot for the new scope. The server never
relabels a live cursor from tenant A as tenant B. Web and native transports
must compare the full subject and active-tenant scope when deciding whether a
connection can be reused.

Realtime requirements before tenant-file mode is complete include:

- authenticate a socket against the control plane;
- bind it to the trusted tenant database capability;
- produce a policy-filtered snapshot from that file;
- route mutations through the writer actor;
- preserve mutation receipts and origin attribution;
- deliver only that file's ordered changes;
- revalidate live authority around policy work and commit;
- resnapshot on actor-generation or retained-history gaps.

The first qualified actor slice may expose a production-grade server-side
async data foundation while this transport extraction is still in progress.
Neither the failed Web Worker experiment nor the subprocess proof alone meets
that bar. The overall tenant-file feature must not be called
realtime-complete until these paths are tested end to end.

## Authentication and Tenant Routing

The control-plane database initially owns application identity, sessions,
tenant membership, role assignments, and tenant lifecycle. Middleware resolves
that state before binding an application-data database.

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

With control state and application data in separate files, a validation in the
app process is not atomically part of the actor's SQLite transaction. A role,
membership, or session could otherwise change between validation and commit.

Single-process tenant-file mode therefore requires an authority mutation gate:

1. The coordinator reaches the head of the database's mutation FIFO.
2. It acquires the relevant authority gate.
3. It resolves the captured durable authority reference again.
4. It dispatches the tenant transaction and holds the gate through commit or
   rollback.
5. A control-plane ReactiveDB transaction whose authority revision changed
   tries to acquire the exclusive gate at its final commit boundary. It never
   waits while holding SQLite locks: contention rolls that transaction back
   with a retryable conflict. Once acquired, the exclusive lease remains held
   until SQLite commit or rollback is known.

Tenant execution follows authority gate then tenant SQLite transaction. The
control-plane final-commit guard is deliberately non-blocking, which permits
it to discover an authority-table change through SQLite triggers without
creating an inverted-lock deadlock. Code must never begin a SQLite transaction
and then *await* the gate. A tenant operation holds its shared lease until the
actor has confirmed commit/rollback or the failed actor has exited and SQLite
has settled the transaction; the caller timing out does not release that
protection while work is still running. Once the commit boundary is known,
the lease is released before websocket fanout or response delivery. Those
later actions do not change whether the already-committed write was authorized
and must not unnecessarily block revocation.

Every control-plane write to an authority-revision-owning table takes the
exclusive side, including grants, role/status changes, session rotation or
scope switching, membership changes, generation bumps, and revocations.
Versioned SQLite triggers advance one shared authority revision inside the
same transaction, and the installed ReactiveDB commit guard fails closed if a
changed revision cannot obtain the exclusive fence. Managed auth writes must
therefore use a ReactiveDB transaction; privileged raw SQLite is outside this
contract and must not mutate auth-owned tables. Single-database mode retains
its existing synchronous in-transaction authority validation.

The resulting order is deterministic: either the tenant write committed while
the authority was current, or the authority change committed first and the
write is denied with `DATABASE_AUTHORITY_CHANGED`.

That gate belongs to one parent coordinator topology. Until Zero has a
distributed equivalent, multi-database roots must be owned by one parent Zero
app replica and its managed child actors. A deployment which attempts to share
one local root between independent app replicas must fail validation rather
than silently weaken the commit-boundary guarantee.

## Idempotency, Failure, and Restart

A database actor can commit a transaction and exit before its response reaches the
coordinator. The caller cannot infer the outcome from the missing response.

Mutation and command receipts are therefore persisted in the same database
transaction as their effects. Retrying the same idempotency key returns the
recorded result without applying the operation twice.

Database failures report an explicit outcome:

| Outcome | Meaning |
| --- | --- |
| `not-started` | Work was rejected, canceled, or timed out while still queued. |
| `not-committed` | The actor confirmed rollback or rejected the operation before commit. |
| `committed` | The durable receipt confirms commit. |
| `unknown` | The actor disappeared or the response boundary failed after dispatch. Retry only with the same idempotency key. |

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

SQLite rollback on connection loss protects an incomplete transaction, but it
does not tell the parent whether the commit completed immediately before the
loss. The receipt protocol resolves that ambiguity on retry.

Forced process termination is a last-resort shutdown action. Normal closure is
an IPC handshake which drains work, disposes ReactiveDB, closes read handles,
checkpoints the WAL, closes SQLite, and acknowledges completion. The parent
must reap child processes and must not leave orphan database actors after app
shutdown or failed startup.

## Stable Errors

Multi-database APIs use a stable `DatabaseError` type with a safe message,
machine-readable code, `retryable` flag, and operation outcome. Initial codes
should cover:

| Code | Meaning |
| --- | --- |
| `DATABASE_CONFIG_INVALID` | Topology or executor configuration is invalid. |
| `DATABASE_NOT_READY` | The selected database is opening, migrating, quarantined, or otherwise unavailable. |
| `DATABASE_BACKPRESSURE` | A bounded queue has reached capacity. |
| `DATABASE_QUEUE_TIMEOUT` | Work did not begin before its queue deadline. |
| `DATABASE_OPERATION_TIMEOUT` | The caller's operation deadline elapsed after dispatch; write outcome may be unknown. |
| `DATABASE_EXECUTOR_FAILED` | The assigned executor or actor exited or its communication boundary failed. |
| `DATABASE_OPEN_FAILED` | The actor could not safely open the physical database. |
| `DATABASE_MIGRATION_FAILED` | The database could not reach the required schema. |
| `DATABASE_SCHEMA_MISMATCH` | Actor, realm, reader, or file schema generations disagree. |
| `DATABASE_AUTHORITY_CHANGED` | Live request authority no longer matches the captured authority. |
| `DATABASE_CONFLICT` | A declarative precondition or conditional mutation did not match. |
| `DATABASE_HISTORY_GAP` | Durable incremental changes cannot cover the requested cursor. |
| `DATABASE_PROTOCOL_ERROR` | IPC validation, versioning, or correlation failed. |
| `DATABASE_CLOSED` | The coordinator or bound database capability is closed. |
| `DATABASE_OUTCOME_UNKNOWN` | A dispatched write may have committed; retry with the same idempotency key. |

Filesystem-specific path errors may remain a more detailed internal cause.
They are normalized before crossing the public database boundary.

## Observability

Every coordinator is app-local, so database events must use that app's
`PlatformObservabilityRuntime` through `emitPlatformCodeTo`. Actor code sends
safe telemetry envelopes to the parent; it does not choose a process-global
sink.

The central `OBS_CODES` registry should define stable events for:

- coordinator configured, started, draining, and stopped;
- writer and reader actor started, ready, exited, and restarted;
- database open, close, open failure, and quarantine;
- migration started, completed, and failed;
- queue saturation and queue timeout;
- operation failure and slow operation;
- unknown mutation outcome;
- change replay and history gap;
- graceful and forced shutdown failures.

Safe metadata includes:

- non-sensitive database reference;
- executor slot, backend, process identifier where safe, and actor generation;
- operation class, never SQL or row contents;
- queue depth;
- sequence range;
- duration;
- retry count;
- normalized SQLite error class.

Do not emit logical tenant IDs, database names, paths, SQL strings, query
inputs, rows, credentials, tokens, invitation data, or raw authorization
references. Raw errors must pass the existing sink redaction boundary and must
not become public error details.

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

Coolify documentation and templates must configure those requirements
explicitly. Native-IPC subprocess actors do not require externally exposed
network ports, but their process count, memory, file descriptors, signals, and
shutdown/reaping behavior must be included in capacity planning.

## Hybrid Hot/File Placement — Required Later Phase

The current actor/concurrency phase intentionally opens named and tenant
databases in file/WAL mode. It does not load tenant databases into RAM, choose
hot tenants, spill cold tenants, or migrate a database between placements.

The overall initiative remains incomplete until Zero adds a bounded hybrid
placement layer. That phase must define:

- a declarative placement policy per database realm and, where appropriate,
  per trusted database binding;
- explicit `file` and `hot` eligibility rather than an implicit mode switch;
- memory budgets, admission limits, and eviction behavior for hot databases;
- snapshot intervals and final-snapshot failure handling;
- promotion from file/WAL to a hot runtime;
- demotion from hot runtime back to a durable file boundary;
- crash-recovery semantics and accepted loss windows for hot placement;
- placement-aware executor scheduling and diagnostics;
- migration and schema parity between hot and file runtimes;
- realtime sequence and epoch behavior across a placement transition;
- backup, restore, doctor, observability, and operational controls;
- tests proving that placement changes never create two active writers or lose
  acknowledged durability outside the selected hot-mode contract.

Hybrid does not mean that every tenant should be hot. Sensitive or strict
durability workloads may deliberately remain file/WAL. Small active databases
may be promoted when an application opts into the hot durability tradeoff.
Zero-owned control, logging, metrics, or plugin realms may later select their
own placement through the same policy.

Until that phase lands:

- topology documentation must say `file/WAL only` for named and tenant files;
- config must reject hot/ephemeral named-database settings;
- diagnostics must not describe the current manager as hybrid;
- benchmarks must report only the qualified file/WAL executor behavior;
- the multi-database initiative must not be marked fully complete.

## Rollout Phases

### Phase 0 — Foundations

Status: implemented and covered in branch work.

- Opaque ID normalization and safe deterministic file mapping.
- Root/file containment, symlink, type, and permission checks.
- One physical `DatabaseRuntime` abstraction.
- Immutable custom migration registries.
- Sync ownership injection for the pinned default ReactiveDB.
- Default database identity and lifecycle compatibility tests.

The foundations remain branch-internal until every later integration and
release gate is qualified.

### Phase 1 — Qualified actor data plane

Status: implemented and covered by unit plus real-subprocess integration tests;
deployment-matrix and package acceptance remain release gates.

- `DatabaseExecutor` and executor-factory boundaries.
- Bun subprocess/native-IPC concurrency and compiled self-spawn proof: passed.
- Writer-actor coordinator and fair bounded scheduling.
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

Status: not implemented; the durable replay primitive and per-file sequence
contract required by this phase are implemented in Phase 1.

- Extract Sync storage operations behind an asynchronous executor.
- Per-database socket binding, snapshot, replay, and change routing.
- Policy-filtered reads and conditional mutations.
- Actor-generation recovery and history-gap resnapshot behavior.
- Per-database mutation receipts and origin handling.

### Phase 3 — Auth-derived tenant files

Status: partially implemented.

- Bind databases only from verified tenant authority. Implemented in the
  manager; ordinary request projection is in progress.
- Install the request, websocket, native, extension, mobile, and background
  projections.
- Add the authority mutation gate to every relevant control-plane mutation.
  The ReactiveDB final-commit fence is implemented; the complete managed-auth
  write-path audit remains a release gate.
- Adapt resources and built-in services which currently assume one synchronous
  ReactiveDB.
- Add tenant lifecycle, suspension, deletion, export, backup, and restore
  behavior.
- Add admin/tenant diagnostics and operational controls.

### Phase 4 — Hybrid hot/file placement

Status: required and not implemented.

- Implement the bounded placement policy described above.
- Prove promotion, demotion, restart, durability, and realtime behavior.
- Add capacity planning, metrics, doctor checks, and operator controls.

Only after this phase and its acceptance tests pass can the overall
multi-database initiative be described as complete.

### Phase 5 — Realm expansion

Status: future work.

- Optionally place Zero control, audit, logging, metrics, plugin, or other
  internal realms into dedicated databases.
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

The current same-thread callback manager cannot pass this test.

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

### Backpressure and fairness

- Block every writer slot and fill bounded queues.
- Verify overflow and queue deadlines return their stable error codes.
- Verify cancellation removes only undispatched work.
- Verify a hot database cannot starve a different database.
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
- Verify a snapshot and represented sequence come from one WAL transaction.

### Migrations and readers

- Race first opens of one database and prove one migration owner.
- Migrate two different files concurrently within the migration limit.
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

These tests belong to Phase 4 and are required before overall completion:

- bounded hot admission and deterministic eviction;
- file-to-hot promotion from a consistent durability boundary;
- hot-to-file demotion with a verified final snapshot/file result;
- crash restore within the configured hot loss window;
- no simultaneous hot and file writers for one database;
- sequence, epoch, and realtime correctness across placement transitions;
- placement-aware backup, restore, diagnostics, and observability.

## Current Branch Work: Keep and Replace

### Keep and evolve

- `src/databases/database-file.ts`: identifier normalization, domain-separated
  filename encoding, containment, symlink/type checks, and private
  permissions.
- The `DatabaseRuntime` concept: move it behind the writer-actor entry and add
  stable errors, app-local telemetry relaying, and actor lifecycle semantics.
- Immutable migration-registry composition in `Migrator`.
- The injected-ReactiveDB ownership seam in `createSyncPlugin()` for default
  app composition and tests.
- Configuration allowlisting and validation-before-filesystem-work.
- The multi-tenant request-facade rule which blocks unscoped raw database
  capabilities.
- Isolation, persistence, WAL, sequence, epoch, migration, and cleanup tests,
  adapted to execute through executors.

### Replace before publication

- `DatabaseManager.acquire()` returning an in-process lease.
- `DatabaseLease` exposing runtime, ReactiveDB, and SQLite handles.
- `DatabaseManager.withDatabase(id, callback)`.
- The main-thread named-runtime factory in `createApp()`.
- `ServerRouteServices.databases: DatabaseManager` as an ordinary public
  application service.
- Inline function-bearing named `tables` and `migrations` as the final actor
  configuration.
- Manager tests which interleave synchronous calls but describe the result as
  concurrent execution.
- Documentation which treats separate SQLite lock domains as proof of
  JavaScript execution concurrency.

The safe file and runtime work is useful foundation. The callback manager is a
prototype which established lifecycle requirements; it is not the production
surface and should be removed or made strictly internal while the executor-
backed coordinator replaces it.

## Release Boundary

The following claims have different completion points and must not be
collapsed into one status:

| Claim | Required phase |
| --- | --- |
| Multiple isolated SQLite files can be resolved and opened safely | Phase 0 |
| Different files execute writes concurrently and the same file supports WAL readers | Phase 1 |
| Each file participates in Zero realtime snapshot and ordered change delivery | Phase 2 |
| Authenticated tenant requests are automatically and safely routed to their file | Phase 3 |
| Multi-database mode supports bounded policy-driven hot and file placement | Phase 4 |
| The overall multi-database initiative is complete | Phases 0–4, documentation, and full acceptance |

Until the relevant phase passes its tests, Zero's public documentation and
release notes must use the narrower completed claim.

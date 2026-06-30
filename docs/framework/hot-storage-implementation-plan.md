# Hot Storage Implementation Plan

## Purpose

This plan turns the hot-storage architecture into implementation slices. It
covers three platform storage planes:

1. SQL: Bun SQLite hot snapshot mode, file/WAL mode, and ephemeral test mode.
2. KV/cache: Zero-owned Redis-style hot memory cache with WAL/checkpoint
   recovery.
3. Vector: zvec-backed vector storage with explicit hot, file, and ephemeral
   modes.

The core rule is simple: production Zero apps should get the fastest local
in-process path by default while still having clear durability knobs.

## Decision

Zero will own its app-facing KV/cache engine.

The implementation should adapt the useful shape of `neocache` rather than
depend on it as the public or internal source of truth. The useful parts are
the hot in-memory cache focus, TTL support, configurable max size, LRU
eviction, batch-friendly access, and small API surface. Zero will rewrite that
style under its own contracts so the engine can grow into richer data types and
so all persistence flows through Zero's WAL/checkpoint model.

`neocache` is currently ISC licensed. If later implementation copies or closely
adapts code rather than only reimplementing ideas, preserve required license
attribution in the repo. The preferred path is a clean Zero-native rewrite
informed by the behavior and benchmark goals.

The ai-gateway code remains the source pattern for durability:

- SQL hot mode uses `Database.deserialize()` from a serialized SQLite snapshot.
- SQL file mode uses SQLite WAL and checkpoints.
- KV/cache persistence uses append-only mutation records, periodic fsync, and
  checkpoint/snapshot restore.

The cache library does not need to provide durable snapshot or WAL behavior.
Zero owns that.

## Current Gaps

Current Zero has KV-like pieces, but not a real general-purpose platform KV:

- `src/sync/state-manager.ts`: per-user state sync backed by SQLite.
- `src/sync/ephemeral-manager.ts`: RAM-only live socket state.
- Auth metadata/user properties: persisted auth-specific key/value-like data.

Those should remain separate. The missing primitive is an app-facing
Redis-style service for fast cache, counters, rate limiters, app scratch data,
workflow coordination, and future richer in-memory structures.

ReactiveDB also currently opens Bun SQLite directly. That makes sync decide
storage policy even though it should only own table mutation, change events,
ring-buffer replay, and WebSocket sync behavior.

Vector storage already has a zvec adapter and useful config seams, but it needs
the same explicit storage-mode vocabulary as SQL.

## KV/Cache Target

### Public Surface

The app-facing backend context should expose:

```ts
zero.kv.get(key)
zero.kv.set(key, value, options)
zero.kv.delete(key)
zero.kv.has(key)
zero.kv.expire(key, ttl)
zero.kv.persist(key)
zero.kv.getMany(keys)
zero.kv.setMany(entries)
zero.kv.batch((batch) => ...)
zero.kv.compareAndSet(key, expected, next)
zero.kv.getOrSet(key, loader, options)
zero.kv.namespace('auth')

zero.counter.incr(key, by)
zero.counter.decr(key, by)
zero.counter.value(key)
zero.counter.reset(key)

zero.limiter.fixedWindow(key, options)
zero.limiter.tokenBucket(key, options)
zero.limiter.slidingWindow(key, options)
```

Future extensions should fit without changing the persistence core:

```ts
zero.kv.hash.set(key, field, value)
zero.kv.hash.get(key, field)
zero.kv.sets.add(key, value)
zero.kv.sets.members(key)
zero.kv.list.push(key, value)
zero.kv.list.pop(key)
zero.kv.lease.acquire(key, options)
zero.kv.lease.release(key, token)
```

### Internal Data Model

Every entry should carry enough metadata for future data types:

```ts
type ZeroKvKind =
  | 'value'
  | 'counter'
  | 'hash'
  | 'set'
  | 'list'
  | 'lease'
  | 'rate-limit';

interface ZeroKvEntry<T = unknown> {
  key: string;
  kind: ZeroKvKind;
  value: T;
  expiresAt: number | null;
  version: number;
  createdAt: number;
  updatedAt: number;
  lastAccessedAt: number;
  sizeBytes: number;
}
```

Versioning is required for CAS and future optimistic coordination. `kind`
prevents painting the engine into a plain string-key/string-value corner.

### File Layout

Keep one responsibility per file:

- `src/kv/kv-types.ts`: public config, entry, result, and service contracts.
- `src/kv/kv-errors.ts`: typed KV/cache errors.
- `src/kv/kv-clock.ts`: testable clock/timer boundary.
- `src/kv/kv-ttl-index.ts`: TTL scheduling and expiration pruning.
- `src/kv/kv-lru-index.ts`: recency tracking and max-size eviction.
- `src/kv/kv-memory-engine.ts`: hot in-memory get/set/delete/iterate behavior.
- `src/kv/kv-mutation.ts`: mutation record types and reducers.
- `src/kv/kv-journal.ts`: append-only mutation persistence.
- `src/kv/kv-checkpoint.ts`: checkpoint read/write and compaction.
- `src/kv/kv-recovery.ts`: checkpoint load plus journal replay.
- `src/kv/kv-serializer.ts`: deterministic serialization and validation.
- `src/kv/kv-service.ts`: public KV methods over engine and persistence.
- `src/kv/kv-namespace.ts`: namespace wrapper.
- `src/kv/kv-counter-service.ts`: counter helpers.
- `src/kv/kv-limiter-service.ts`: rate limiter helpers.
- `src/kv/kv-observability.ts`: stable observability emissions.
- `src/kv/kv.plugin.ts`: Elysia plugin exposing `zero.kv`.
- `src/kv/index.ts`: public server exports only.

Do not put storage policy, Elysia plugin behavior, rate limiter algorithms, and
memory indexing in one file.

### Memory Engine

The v1 memory engine should be a Zero-native rewrite with neocache-like goals:

- Direct `Map<string, ZeroKvEntry>` lookup.
- O(1) or near-O(1) `get`, `set`, `has`, and `delete`.
- TTL metadata checked on read and pruned by a timer.
- Configurable max entries.
- Configurable max approximate bytes.
- LRU eviction for bounded caches.
- `entries()` iterator for checkpoint writes.
- No hidden global singleton.
- No direct `console.*`.
- Deterministic timer/clock injection for tests.

Implementation detail options:

- Use a `Map` for entries and a separate recency structure for LRU.
- For a first slice, an insertion-ordered `Map` can support simple LRU by
  delete/reinsert on access. If benchmarking shows this is insufficient, move
  recency into a small linked-list index.
- TTL should not depend on scanning every entry. Use a bucketed TTL index or
  timing wheel similar to the ai-gateway implementation.

### Persistence

KV/cache active lookup is always memory. Files are recovery artifacts.

Mutation order:

1. Normalize and validate mutation.
2. Append mutation to the journal according to configured durability.
3. Apply mutation to memory.
4. Emit observability/metrics.
5. Return the result.

Durability modes:

| Mode | Behavior | Use |
| --- | --- | --- |
| `everysec` | Append to buffered journal, fsync periodically and on shutdown. | Default Redis-style balance. |
| `always` | Fsync before mutation resolves. | Stronger durability, slower writes. |
| `memory` | No journal/checkpoint. | Tests and intentionally ephemeral cache. |

Checkpoint behavior:

- Write a compact snapshot of live, non-expired entries.
- Include engine metadata: checkpoint id, journal offset/sequence, createdAt,
  config compatibility, and serializer version.
- Write atomically through temp path then rename.
- After successful checkpoint, compact old journal segments that are safely
  covered.

Recovery behavior:

1. Load latest checkpoint if present.
2. Rebuild memory engine and TTL/LRU indexes.
3. Replay journal entries newer than the checkpoint.
4. Drop expired entries during recovery.
5. Emit recovery diagnostics.

### Value Storage

The first implementation can store values directly inside checkpoint/journal
records. The public contracts should still leave room for larger value storage:

- `inline`: value is stored directly in entries and journal records.
- `prealloc`: future page-backed value storage for larger payloads.
- `hybrid`: future hot inline values with cold spill pages.

Large value storage must not change the active lookup rule. Key metadata and
hot values remain memory-first.

## SQL Target

SQL gets its own platform persistence primitive before ReactiveDB touches it.

Target files:

- `src/persistence/storage-types.ts`
- `src/persistence/sqlite-connection.ts`
- `src/persistence/snapshot-manager.ts`
- `src/persistence/checkpoint-manager.ts`
- `src/persistence/statement-cache.ts`
- `src/persistence/transaction-manager.ts`
- `src/persistence/buffer-pool.ts`
- `src/persistence/platform-storage.ts`

Modes:

| Mode | Active Path | Recovery |
| --- | --- | --- |
| `hot` | `Database.deserialize()` in RAM | Serialize snapshot on interval/shutdown |
| `file` | SQLite file with WAL/mmap/cache PRAGMAs | SQLite WAL recovery |
| `ephemeral` | `:memory:` | None |

ReactiveDB should accept an injected `Database` handle from the platform
storage service. Standalone sync usage can keep legacy config compatibility,
but it should still route through the persistence primitive internally.

## Vector Target

Vector is the third storage plane and should use the same mode vocabulary:

| Mode | Active Path | Recovery |
| --- | --- | --- |
| `hot` | memory-backed zvec collection where supported | snapshot/checkpoint restore |
| `file` | zvec file/mmap collection | zvec file reopen |
| `ephemeral` | temp collection | deleted on dispose |

Implementation must first verify exactly what the current zvec version exposes
for memory indexes and snapshots. If zvec only exposes file/mmap behavior, Zero
should still expose `file` cleanly and make `hot` an explicit planned mode
rather than pretending the active path is memory-backed.

Vector remains storage only. Native embedding, reranking, and provider choice
stay in the AI layer.

## Zero Infrastructure Version

This section defines the cleaned-up Zero version of the ai-gateway
infrastructure. The ai-gateway implementation proves the shape, but Zero should
rebuild it with stricter boundaries, stable observability, safer SQL helpers,
and framework-level lifecycle ownership.

### Runtime Composition

`createApp()` should construct one local platform runtime before mounting
feature plugins:

```ts
const runtime = await createPlatformRuntime({
  rootDir: './data',
  db: {
    mode: 'hot',
    path: './data/app.db',
    snapshotPath: './data/app.snapshot.db',
  },
  kv: {
    enabled: true,
    baseDir: './data/kv',
  },
  vector: {
    mode: 'file',
    dataDir: './data/vector',
  },
});
```

The runtime owns shared infrastructure and exposes narrow service handles:

```ts
interface PlatformRuntime {
  storage: PlatformStorageService;
  db: PlatformSQLiteService;
  kv: PlatformKvService | null;
  vectorStorage: PlatformVectorStorageService | null;
  lifecycle: PlatformLifecycle;
  diagnostics(): PlatformRuntimeDiagnostics;
  close(): Promise<void>;
}
```

Feature systems then consume those handles:

```ts
const reactiveDb = new ReactiveDB({
  database: runtime.db.raw,
  statements: runtime.db.statements,
  transactions: runtime.db.transactions,
  ownsDatabase: false,
});

const auth = new UserStore(reactiveDb);
const tokens = new PlatformTokenStore(reactiveDb);
const vectors = createVectorService(runtime.vectorStorage);
```

The app-facing API should remain stable:

- Existing `createApp({ db, sync, auth, vector, ... })` config stays valid.
- Existing ReactiveDB/sync/resource APIs keep their public behavior.
- New storage internals are mostly invisible unless the app opts into advanced
  storage config.
- Legacy `db.mode: 'memory'` remains accepted as an ephemeral/test alias during
  migration, but generated apps should stop using it.

### Lifecycle Order

Lifecycle needs one owner. The platform runtime should start and stop services
in a deterministic order.

Startup order:

1. Resolve config and env.
2. Ensure data directories exist.
3. Open SQL source file when needed.
4. Run pending migrations against the durable SQL source.
5. Create the active SQL service:
   - `hot`: deserialize source/snapshot into memory.
   - `file`: open file DB with WAL/mmap/cache PRAGMAs.
   - `ephemeral`: open `:memory:` for tests/demos.
6. Recover KV/cache:
   - load checkpoint
   - replay newer journal segments
   - rebuild TTL/LRU indexes
   - drop expired entries
7. Open vector storage according to mode.
8. Create ReactiveDB from the shared SQL handle.
9. Mount feature plugins.
10. Start background loops:
    - SQL hot snapshots
    - SQL file checkpoints
    - KV fsync/checkpoints
    - vector snapshots where supported

Shutdown order:

1. Stop accepting new requests/sockets.
2. Stop scheduler/workflow intake.
3. Flush sync state and close WebSocket loops.
4. Flush KV journal and write final checkpoint.
5. Write final SQL hot snapshot or file-mode checkpoint.
6. Flush/close vector storage.
7. Finalize statement cache.
8. Close SQLite handle.
9. Emit runtime closed event.

Crash recovery is best-effort by design:

- SQL `hot` recovers to the latest snapshot.
- SQL `file` recovers through SQLite WAL.
- KV/cache recovers to latest fsynced journal/checkpoint according to durability
  mode.
- Vector recovers according to configured storage mode and zvec support.

### Module Responsibilities

The Zero infrastructure should split responsibilities like this:

```txt
src/platform-runtime/
  runtime-types.ts          runtime contracts only
  runtime-config.ts         config/env normalization
  platform-runtime.ts       composition and lifecycle owner
  runtime-diagnostics.ts    doctor/diagnostic shape

src/persistence/
  storage-types.ts          SQL storage contracts
  sqlite-connection.ts      Bun SQLite open/deserialize/PRAGMA policy
  snapshot-manager.ts       hot-mode snapshot writes
  checkpoint-manager.ts     file-mode WAL checkpoints
  statement-cache.ts        prepared statement lifecycle
  transaction-manager.ts    safe transaction helpers
  buffer-pool.ts            reusable binary buffers
  platform-sqlite.ts        SQL service composition

src/kv/
  kv-types.ts               public KV contracts
  kv-memory-engine.ts       hot memory index
  kv-ttl-index.ts           TTL scheduling
  kv-lru-index.ts           eviction/recency tracking
  kv-mutation.ts            mutation records and reducers
  kv-journal.ts             append-only persistence
  kv-checkpoint.ts          checkpoint read/write/compaction
  kv-recovery.ts            startup restore
  kv-service.ts             public KV facade
  kv-counter-service.ts     counters
  kv-limiter-service.ts     limiters
  kv.plugin.ts              Elysia integration

src/vector/
  vector-storage.ts         vector storage mode service
  vector-snapshot.ts        hot-mode snapshot support if zvec allows it
  vector-config.ts          mode/path/env validation
```

`src/frontend/server/app-factory.ts` should compose these pieces but should not
own their internals.

### SQL Infrastructure Polish

Port the ai-gateway SQL shape, but tighten it for Zero:

- Use `hot`, `file`, and `ephemeral` mode names.
- Keep all PRAGMA policy in `sqlite-connection.ts`.
- Ensure hot-mode source serialization is safe:
  - checkpoint source WAL
  - temporarily force `journal_mode=DELETE` before serialization when required
  - deserialize with strict mode
  - apply memory PRAGMAs to the active handle
- Make snapshots atomic with temp write and rename.
- Prevent concurrent snapshots.
- Add final sync snapshot on graceful shutdown.
- Make checkpoint manager no-op unless mode is `file`.
- Expose diagnostics without surprising state mutation where possible.
- Validate and quote SQL identifiers in generic helpers.
- Avoid async work inside open SQLite transactions unless a queue/lock makes it
  explicit and safe.
- Finalize statement cache on close.
- Route all failures through `OBS_CODES`.

### KV Infrastructure Polish

The Zero KV engine should be simpler than the ai-gateway stream-backed cache:

- Direct service methods append a mutation and apply it to memory.
- No consumer-group/poll-loop abstraction is needed for v1.
- Checkpoints snapshot live KV entries directly.
- Journal replay applies mutations in sequence.
- TTL expiry writes delete/tombstone mutations only when persistent expiry
  needs to be durable; otherwise expired keys can be omitted from checkpoint
  and ignored during recovery.
- Serializer version is stored with every checkpoint and journal segment.
- Corrupt journal records should produce a structured recovery warning and stop
  or skip according to configured recovery policy.
- The public API should hide persistence details.

KV config should make durability explicit:

```ts
kv: {
  enabled: true,
  baseDir: './data/kv',
  durability: 'everysec',
  checkpointIntervalMs: 30_000,
  fsyncMs: 1000,
  maxEntries: 250_000,
  maxBytes: 512 * 1024 * 1024,
  eviction: 'lru',
}
```

The cache should never support active file lookup mode. If a workload does not
fit memory, it should use SQL/file mode, vector/file mode, object storage, or a
future external adapter.

### Vector Infrastructure Polish

Vector storage should not overpromise. First implementation must verify the
exact zvec capabilities before exposing `hot` as production-ready.

Rules:

- `file` is the safe default if zvec's durable API is file/mmap-oriented.
- `hot` is only enabled when Zero can prove active queries are memory-backed and
  snapshots restore correctly.
- `ephemeral` uses temp dirs and deletes them on dispose.
- Vector mode config should live near vector config, but lifecycle belongs to
  platform runtime.
- AI remains a consumer of vector services, not the owner of vector storage.

### Observability And Diagnostics

Every infrastructure subsystem should emit stable codes through Zero
observability:

- runtime start/stop
- SQL mode selected
- SQL snapshot loaded/written/failed
- SQL checkpoint completed/failed
- KV recovery started/completed/failed
- KV checkpoint written/failed
- KV journal fsync failed
- KV eviction happened
- vector mode selected
- vector snapshot/recovery failed
- unsafe config fallback used

Doctor should inspect:

- production app using `ephemeral`
- hot SQL without snapshot path
- hot SQL with very long snapshot interval
- KV enabled without baseDir
- KV durability set to `memory` outside tests
- KV max memory/entry limits missing
- vector hot requested but unsupported by current adapter
- vector file mode without writable data dir
- ReactiveDB created outside platform runtime in create-app paths

### Test Matrix

Infrastructure work is not complete without restart/recovery tests:

| Area | Required Tests |
| --- | --- |
| SQL hot | writes survive graceful close/reopen by snapshot |
| SQL hot | missing snapshot starts empty but creates durable snapshot |
| SQL hot | failed snapshot emits observability and does not corrupt previous snapshot |
| SQL file | writes survive reopen through file/WAL |
| SQL ephemeral | writes do not survive restart |
| ReactiveDB | injected database preserves rows and emits changes |
| KV memory | get/set/delete/TTL/LRU/batch/CAS/counter behavior |
| KV recovery | checkpoint restore plus journal replay |
| KV recovery | expired entries do not come back |
| KV recovery | corrupt journal handling follows configured policy |
| KV durability | `everysec`, `always`, and `memory` behavior |
| Vector | file mode opens/reopens index |
| Vector | hot mode gated or proven with snapshot restore |
| App factory | generated app default uses durable storage |

## Implementation Slices

### Slice 1: Documentation And Contracts

- Save this plan.
- Update the hot-storage architecture doc to point at this plan.
- Record the decision in Obsiian.
- No runtime behavior changes.

### Slice 2: KV Memory Engine

- Add `src/kv` contracts, errors, clock, TTL index, LRU index, and memory engine.
- Implement `get`, `set`, `delete`, `has`, `clear`, `entries`, TTL, max entries,
  and max approximate bytes.
- Add tests for hot operations, TTL, eviction, iteration, and deterministic
  clock behavior.
- No persistence or Elysia plugin in this slice.

### Slice 3: KV Journal, Checkpoint, Recovery

- Add append-only journal, checkpoint writer/reader, serializer, and recovery.
- Add durability modes: `everysec`, `always`, and `memory`.
- Add tests for restart recovery, checkpoint compaction, replay after
  checkpoint, expired-entry recovery, and corrupted-record handling.

### Slice 4: KV Service And Elysia Plugin

- Add `KvService`, namespace wrapper, counters, rate limiters, and backend
  plugin.
- Expose `zero.kv`, `zero.counter`, and `zero.limiter`.
- Route all warnings/errors through Zero observability codes.
- Add docs and package exports.

### Slice 5: SQL Persistence Primitive

- Port the ai-gateway SQLite connection/snapshot/checkpoint pattern into
  `src/persistence`.
- Add hot/file/ephemeral tests.
- Keep SQL isolated from KV/cache internals.

### Slice 6: ReactiveDB Refactor

- Make ReactiveDB accept an injected `Database`.
- Route legacy ReactiveDB config through the new persistence primitive.
- Make DB lifecycle ownership explicit.
- Add restart tests proving hot snapshot mode preserves rows.

### Slice 7: App Factory Wiring

- `createApp()` creates platform storage first.
- Sync, auth, tokens, resources, workflows, scheduler, storage, AI, vector, and
  app routes receive the shared platform services.
- Generated apps default to durable hot SQL plus enabled KV once stable.

### Slice 8: Vector Storage Modes

- Add vector mode config.
- Implement or explicitly gate hot vector snapshot support based on zvec
  capabilities.
- Keep file/mmap mode polished and documented.
- Add doctor checks for unsafe or impossible mode combinations.

### Slice 9: Doctor, Env, Create-App, Docs

- Add doctor checks for SQL/KV/vector modes.
- Update `.env.example`.
- Update create-app config templates.
- Update start-here, platform overview, SDK/server docs, vector docs, and sync
  docs.

## Acceptance Criteria

- Zero has a real app-facing KV/cache service.
- KV reads are memory lookups.
- KV writes flow through Zero's journal/checkpoint model.
- KV can recover from checkpoint plus replay.
- KV supports TTL, counters, batches, CAS, namespaces, and rate limiters.
- The KV engine is Zero-owned and organized for future hash/set/list/lease data
  types.
- SQL hot mode persists rows across restart through snapshots.
- SQL file mode remains available for stricter SQLite WAL durability.
- ReactiveDB no longer owns root SQLite connection policy when used through
  `createApp()`.
- Vector config clearly separates hot, file, and ephemeral storage modes.
- Platform doctor warns about unsafe storage choices.
- Docs explain which mode to use and what durability tradeoff each mode makes.

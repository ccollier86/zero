# Hot Storage Architecture

> **Status:** historical implementation design. The shared SQLite persistence
> foundation and `createApp()` composition described as targets here have
> since landed. Use [bun:sqlite Best Practices](../bun-sqlite-best-practices.md),
> [Sync Architecture](../realtime-sync/realtime-sync/architecture.md), and the
> current source for supported APIs; snippets below preserve design history and
> are not package-mode copy-paste examples.

## Purpose

Zero's fastest production path should be a hot in-process storage runtime with
three storage planes:

1. SQL DB: Bun SQLite hot snapshot mode for fastest relational data, with
   file/WAL mode available when stricter commit durability or lower RAM matters.
2. KV/cache: Redis-style memory index with TTL/counters/limiters/CAS/batches,
   backed by snapshots/checkpoints plus append/replay recovery.
3. Vector: zvec-backed local vector collections with memory-backed snapshot
   restore for fastest work, or file/mmap for constrained/larger deployments.

All three planes should be in-process and zero-hop. The KV/cache plane must not
be an active file-backed cache; files are only the recovery boundary.

This fixes the current mismatch where `ReactiveDB` opens `new Database(':memory:')`
directly and therefore bypasses the intended platform persistence primitive.
ReactiveDB should be the observable sync wrapper; it should not own SQLite
connection policy.

The SQL source model is the working `../ai-gateway/src/db` architecture:

- `connection.ts`: opens file SQLite or loads a serialized snapshot into memory.
- `snapshot.ts`: periodically writes `db.serialize()` to disk.
- `checkpoint.ts`: manages WAL checkpointing in file mode.
- `statement-cache.ts`: reuses prepared statements.
- `transactions.ts`: central transaction helpers.
- `buffer-pool.ts`: preallocated `Uint8Array` buffers for zero-allocation helper paths.

The buffer pool is important, but the main speed win is not a hand-rolled row
array. The main speed win is Bun SQLite running against an in-memory database
handle created by `Database.deserialize()`, with snapshots as the durable
boundary.

The KV/cache source model is the working `../ai-gateway/src/zero` architecture:

- `core/cache/zero-cache.ts`: Redis-style API over an in-memory `Map` index.
- `core/streams/persistent-engine.ts`: stream engine with recovery and
  checkpoints.
- `adapters/persistence/file-wal.ts`: append-only persistence with periodic
  fsync and checkpoint restore.
- `adapters/storage/*`: RAM, prealloc, disk, hybrid, and frozen page providers
  for value storage. These are backing stores for values/recovery, not the
  active lookup path.

Implementation note: Zero should not blindly copy the ai-gateway stream/cache
layout. The selected direction is a Zero-owned KV/cache engine with a
neocache-style hot memory core, rewritten to Zero's engineering standards and
wrapped in the ai-gateway WAL/checkpoint recovery pattern. See
[Hot Storage Implementation Plan](./hot-storage-implementation-plan.md).

## Performance Profile

The target is Redis-class application latency without a Redis process:

- No network hop.
- No client/server serialization boundary.
- No cross-process cache lookup.
- Elysia handlers, platform services, ReactiveDB, persistent KV, and platform
  cache all call the same in-process Bun runtime.
- Hot mode puts active SQLite pages in RAM by construction.
- File mode uses SQLite WAL, mmap, large page cache, prepared statements, and
  bounded checkpointing.
- KV/cache uses an active in-memory index, not an active SQL/file lookup. Each
  mutation is appended to a durable stream/log, checkpoints are written on a
  schedule, and restart restores checkpoint state then replays newer entries.
- Vector storage follows the same explicit performance split: memory-backed
  vector collections with snapshot restore for maximum speed, or file/mmap
  collections when RAM is constrained or indexes are too large to keep hot.
- Snapshot and checkpoint work runs outside normal request logic.

Expected target behavior on local NVMe-class hardware:

| Operation | SQL Hot Mode Target | SQL File/WAL Mode Target | KV/Cache Target | Vector Target |
| --- | --- | --- | --- | --- |
| Point read | Sub-millisecond | Sub-millisecond to low single-digit ms | In-memory Map lookup | In-memory vector index or mmap lookup |
| Search/query | Indexed SQL over hot DB | Indexed SQL over WAL/mmap DB | Key/prefix/rate-limit helpers in memory | zvec ANN/scalar-filter query, memory-backed or mmap |
| Single write | In-memory SQLite write path, snapshot deferred | WAL write path | Append mutation, apply to memory index | Upsert into active zvec collection, snapshot/checkpoint or file persistence |
| Batch writes | SQLite transaction, no per-row async hop | SQLite transaction, WAL append | Append batch, apply to memory index | zvec batch upsert |
| TTL/counters/limiters | SQL-backed only when modeled as tables | SQL-backed only when modeled as tables | Native timing wheel + counter/rate limiter helpers | Not applicable |
| Clean shutdown | Synchronous final snapshot | WAL checkpoint and close | Flush log, write checkpoint/snapshot | Snapshot memory collection or close file/mmap collection |
| Restart | Deserialize latest snapshot | SQLite WAL recovery/checkpoint | Restore checkpoint/snapshot, replay log | Restore vector snapshot or reopen file/mmap collection |

Durability tradeoff is explicit:

- SQL `hot` is the fastest relational active path. Crash recovery returns to the latest
  snapshot, so the possible loss window is the snapshot interval.
- SQL `file` is the stricter relational durability path. SQLite WAL owns
  committed writes and recovery.
- KV/cache is always memory-first. Its durability target comes from append-only
  persistence plus checkpoint/snapshot restore, not active file lookups.
- Vector can be memory-first like SQL hot mode when the index fits in RAM, with
  snapshot/checkpoint restore. It can also run file/mmap for larger indexes or
  constrained servers.
- If an app needs maximum write durability over maximum active latency, choose
  SQL `file` and increase `synchronous` to `FULL`.

## SQL Storage Modes

Zero should standardize one vocabulary for relational SQLite storage while
keeping KV/cache and transient live state separate:

| Mode | Behavior | Durability | Best For |
| --- | --- | --- | --- |
| `hot` | Load serialized SQLite snapshot into RAM, write snapshots to disk on interval/shutdown. | Snapshot interval bounded. | Fastest relational app DB on servers with enough RAM. |
| `file` | Open SQLite file directly with WAL, mmap, large page cache, and checkpointing. | SQLite/WAL durability. | Lower-memory servers or apps where every committed write must immediately live in SQLite's WAL. |
| `ephemeral` | Process memory only, no restore, no snapshot. | None. | Tests and intentionally throwaway relational data. |

## KV/Cache Recovery Model

Platform KV/cache is a Redis-style service:

- Active values and metadata live in memory.
- Reads are direct memory lookups.
- Writes publish mutations into a persistent stream/log.
- Mutations apply to the memory index and resolve once applied.
- TTL expiry uses a timing wheel, not periodic table scans.
- Checkpoints/snapshots are written periodically.
- Restart loads the latest checkpoint/snapshot and replays newer log entries.
- Optional value stores can back large payloads with RAM, preallocated extents,
  hybrid storage, or frozen/object storage while keeping the lookup index hot.

KV/cache has no `file` active mode. A file-backed active cache defeats the point
of a Redis-style cache. If an app enables platform KV/cache, the active path is
memory and the recovery path is snapshot/checkpoint plus append-only replay.

The persistence knobs are recovery knobs, not lookup-mode knobs:

```ts
kv: {
  enabled: true,
  baseDir: './data/kv',
  fsyncMs: 1000,
  checkpointIntervalMs: 30_000,
  recoverConcurrency: 8,
  ttlTickMs: 250,
  ttlSlots: 512,
  valueStorage: {
    mode: 'prealloc',
    baseDir: './data/kv-values',
    extentMB: 16,
    pageKB: 64,
    checksum: 'crc32c',
  },
}
```

For maximum speed, use RAM/prealloc value storage. For larger apps, hybrid value
storage can spill cold value pages while keeping key metadata and hot values in
memory. That is still not a file-based active cache; it is a memory cache with
bounded backing storage for values and recovery.

Compatibility aliases:

- Existing `db.mode: 'memory'` should become an alias for `ephemeral` in tests,
  but generated apps should stop defaulting to it.
- Existing `db.mode: ':memory:'` should also mean `ephemeral`.
- Existing `db.mode: './data/app.db'` should continue to mean `file`.
- New apps should prefer `db.mode: 'hot'` with a snapshot path.

## Target Runtime Shape

The app should create one platform storage service first, then pass its database
handle into every database-backed subsystem.

```ts
const storage = createPlatformStorage({
  rootDir: './data',
  db: {
    mode: 'hot',
    path: './data/app.db',
    snapshotPath: './data/app.snapshot.db',
    snapshotIntervalMs: 30_000,
    synchronous: 'NORMAL',
    cacheSize: -262_144,
    mmapSize: 1_073_741_824,
    pageSize: 4096,
    walAutocheckpoint: 1000,
    busyTimeout: 5000,
  },
  kv: {
    enabled: true,
    baseDir: './data/kv',
    checkpointIntervalMs: 30_000,
    fsyncMs: 1000,
  },
  vector: {
    mode: 'hot',
    dataDir: './data/vector',
    snapshotDir: './data/vector-snapshots',
    enableMMAP: true,
  },
});
```

Then `createApp()` wires each subsystem to its owned plane. The original
single-handle sketch has been superseded by the mandatory system/application
split:

```ts
const applicationDB = createReactiveDB({
  database: applicationStorage.raw,
  ringBufferDepth,
});
const systemDB = createReactiveDB({
  database: systemStorage.raw,
  ringBufferDepth,
});

const state = new StateManager(systemDB);
const tokens = new PlatformTokenStore(systemDB);
const auth = new UserStore(systemDB);
// Resource CRUD and the default Sync plane use applicationDB.
const kv = storage.kv;
const vector = createVectorService(storage.vector);
```

ReactiveDB still owns table definitions, change events, ring-buffer replay, and
sync semantics. It no longer decides whether SQLite is file-backed, hot
snapshot-backed, or ephemeral.

## Files To Add

### `src/persistence/storage-types.ts`

Owns config and service contracts only.

Key exports:

```ts
export type StorageMode = 'hot' | 'file' | 'ephemeral';
export type DurableStorageMode = 'hot' | 'file';

export interface SQLiteStorageConfig {
  mode?: StorageMode | 'memory' | ':memory:' | string;
  path?: string;
  snapshotPath?: string;
  snapshotIntervalMs?: number;
  snapshotEnabled?: boolean;
  cacheSize?: number;
  mmapSize?: number;
  walAutocheckpoint?: number;
  pageSize?: number;
  synchronous?: 'OFF' | 'NORMAL' | 'FULL' | 'EXTRA';
  tempStore?: 'DEFAULT' | 'FILE' | 'MEMORY';
  busyTimeout?: number;
  statementCacheSize?: number;
  bufferPool?: false | BufferPoolConfig;
}

export interface PlatformStorageConfig {
  rootDir?: string;
  db?: SQLiteStorageConfig;
  kv?: PlatformKVConfig | false;
  vector?: {
    mode?: 'hot' | 'file' | 'ephemeral';
    dataDir?: string;
    snapshotDir?: string;
    enableMMAP?: boolean;
  };
}
```

`PlatformKVConfig` is not a SQLite config. It configures an in-memory KV/cache
engine with append-only persistence, checkpoints/snapshots, TTL timing wheel,
and optional value storage providers. The resolver should reject any config that
turns platform KV/cache into an active file lookup path.

### `src/persistence/buffer-pool.ts`

Port the `ai-gateway` `BufferPool` as a generic utility:

- Preallocate common `Uint8Array` sizes.
- Track checked-out buffers with a `WeakSet`.
- Zero buffers before returning them to the pool.
- Expose `stats()` for doctor/observability.

Do not present this as SQLite's page cache. It is a helper for Zero code that
needs temporary binary/serialization buffers without repeated allocation.

### `src/persistence/sqlite-connection.ts`

Owns Bun SQLite opening and PRAGMA policy.

Responsibilities:

- Normalize `hot`, `file`, and `ephemeral`.
- Ensure parent directories exist for file and snapshot paths.
- In `hot` mode:
  - Open the snapshot source if it exists.
  - Force a checkpoint if the source is WAL-backed.
  - Temporarily switch source journal mode to `DELETE` before `serialize()`,
    because Bun deserialization is unreliable from active WAL serialization.
  - Return `Database.deserialize(data, { strict: true })`.
  - Fall back to a new `:memory:` DB if no snapshot exists.
  - Apply memory PRAGMAs: `journal_mode=MEMORY`, `synchronous=OFF`,
    configured cache, page size, temp store, foreign keys.
- In `file` mode:
  - Open `new Database(path, { create: true, readwrite: true })`.
  - Set `SQLITE_FCNTL_PERSIST_WAL` to `0`.
  - Apply WAL PRAGMAs: `journal_mode=WAL`, configured `synchronous`,
    cache size, mmap size, page size, `wal_autocheckpoint`, temp store,
    busy timeout, foreign keys, optimize, journal size limit.
- In `ephemeral` mode:
  - Open `new Database(':memory:')`.
  - Apply memory PRAGMAs.

### `src/persistence/snapshot-manager.ts`

Owns hot-mode persistence back to disk:

- `start()`
- `stop()`
- `snapshot()`
- `snapshotSync()`
- Atomic write through `snapshotPath.tmp` then rename.
- Guard against concurrent snapshots.
- Emit observability events on success/failure.

### `src/persistence/checkpoint-manager.ts`

Owns file-mode WAL checkpoints:

- `start()`
- `stop()`
- `checkpoint(mode)`
- `status()`

This should only run for `file` mode. Hot mode snapshots, not WAL checkpoints.

### `src/persistence/statement-cache.ts`

Owns reusable prepared statement caching for generic SQL callers.

ReactiveDB can still prepare per-table CRUD statements itself. The statement
cache is for cross-cutting platform services, generic data queries, migrations,
doctor diagnostics, and future SQL helpers.

### `src/persistence/transaction-manager.ts`

Owns transaction helpers:

- `run(fn, isolation)`
- `runSync(fn)`
- `batchInsert(table, rows)` only if safely quoted/validated, or leave batch
  insert to ReactiveDB to avoid string assembly risk.

### `src/persistence/platform-sqlite.ts`

Owns construction and lifecycle for the full local storage runtime:

```ts
export interface PlatformSQLiteService {
  raw: Database;
  mode: StorageMode;
  path: string | null;
  snapshotPath: string | null;
  statements: StatementCache;
  transactions: TransactionManager;
  checkpoint: CheckpointManager | null;
  snapshot: SnapshotManager | null;
  buffers: BufferPool;
  close(): void;
  diagnostics(): PlatformSQLiteDiagnostics;
}

export interface PlatformStorageService {
  db: PlatformSQLiteService;
  kv: PlatformKVService | null;
  vector: PlatformVectorStorageConfig;
  close(): Promise<void> | void;
}
```

### `src/kv`

Build the Redis-style Zero KV/cache runtime as a separate system from SQL
persistence. It should use a Zero-owned in-memory engine inspired by
neocache's focused hot cache design, then apply the ai-gateway persistence
pattern for WAL/checkpoint recovery.

Suggested files:

- `src/kv/kv-types.ts`: public KV/cache contracts.
- `src/kv/kv-memory-engine.ts`: in-memory index, TTL/LRU support, iteration,
  and eviction.
- `src/kv/kv-ttl-index.ts`: TTL scheduling and expiration pruning.
- `src/kv/kv-lru-index.ts`: recency tracking and max-size eviction.
- `src/kv/kv-journal.ts`: append-only mutation persistence with everysec or
  always-fsync durability.
- `src/kv/kv-checkpoint.ts`: checkpoint writes and restore.
- `src/kv/kv-recovery.ts`: checkpoint load plus journal replay.
- `src/kv/kv-service.ts`: CAS, batches, counters, limiters, `getOrSet`, and
  namespaces over the memory engine.
- `src/kv/kv-value-store.ts`: optional future value page store for larger
  payloads.
- `src/kv/kv.plugin.ts`: Elysia plugin that exposes `zero.kv`, `zero.counter`,
  and `zero.limiter` to backend code.

The active read path must remain memory-based. Disk files are for mutation log,
checkpoints/snapshots, and optional value-page recovery.

## Files To Refactor

### `src/sync/types.ts`

Replace the current `ReactiveDBConfig` meaning.

Current behavior:

```ts
mode: 'memory' | string;
```

Target behavior:

```ts
export interface ReactiveDBConfig {
  database?: Database;
  mode?: 'hot' | 'file' | 'ephemeral' | 'memory' | ':memory:' | (string & {});
  path?: string;
  snapshotPath?: string;
  snapshotIntervalMs?: number;
  ringBufferDepth?: number;
}
```

Backwards compatibility:

- `createReactiveDB({ mode: 'memory' })` stays valid for tests and maps to
  ephemeral memory.
- `createReactiveDB({ mode: './data/app.db' })` stays valid and maps to file.
- `new ReactiveDB({ database })` becomes the preferred internal path.

### `src/sync/reactive-db.ts`

ReactiveDB should accept an existing `Database` handle and a lifecycle ownership
flag.

Target constructor policy:

```ts
constructor(config: ReactiveDBConfig | ReactiveDBRuntime) {
  if (config.database) {
    this.db = config.database;
    this.ownsDatabase = false;
  } else {
    const runtime = createPlatformSQLiteService({ db: normalizeLegacyDbConfig(config) });
    this.db = runtime.raw;
    this.runtime = runtime;
    this.ownsDatabase = true;
  }
}
```

Dispose policy:

- If ReactiveDB owns the runtime, close it.
- If the platform storage service owns the runtime, only finalize ReactiveDB
  statements/listeners and leave DB closing to `createApp()`/plugin lifecycle.

Startup policy:

The following bullets preserve the original target and are superseded by the
current file-mode implementation: `_zero_sync_log_state` now owns the
monotonic cursor and pruning watermark, `_changes` is explicitly versioned and
retained by default, and each runtime can poll the shared log for
cross-connection fanout. The seq-0 sentinel and trigger fence require a
coordinated stop-all on first adoption. See
[ReactiveDB](../realtime-sync/realtime-sync/reactive-db.md#multi-process-boundary)
for the supported boundary.

- Create `_changes`.
- Originally proposed: truncate `_changes` on every durable-mode process start.
- Originally proposed: keep `seq` process-local and snapshot after restart.

### `src/sync/sync.plugin.ts`

`createSyncPlugin()` should accept an existing DB or storage service:

```ts
createSyncPlugin({
  db: reactiveDbConfig,
  database: storage.db.raw,
  tables,
});
```

Target behavior:

- `createApp()` creates the application and system SQL services first.
- `createSyncPlugin()` receives the application database handle and, when
  Guardian is enabled, the separate system-plane projection handle.
- Sync plugin no longer creates the root SQLite connection by itself when used
  from `createApp()`.
- Standalone sync usage still works by letting ReactiveDB create its own
  platform SQLite service from legacy config.

### `src/frontend/server/app-factory.ts`

`createApp()` should become the canonical composition owner:

1. Resolve the application `db` and Zero-owned `systemDb` configs.
2. Create separate platform SQL services and ReactiveDB runtimes for both
   planes.
3. Run Zero migrations and built-in service schema setup only against the
   system plane; install application tables and ID-only Guardian anchors only
   where their declarative schema requires them.
4. Mount application Sync/resources against `db`, system projections and
   built-in services against `systemDb`, and actor-backed tenant planes through
   Fabric when configured.
5. Close actor-owned databases before the authority/system plane, with pinned
   planes otherwise closing in reverse dependency order.

Generated apps should default to durable local storage:

```ts
db: {
  mode: process.env.ZERO_DB_MODE ?? 'hot',
  path: process.env.ZERO_DB_PATH ?? './data/app.db',
  snapshotPath: process.env.ZERO_DB_SNAPSHOT_PATH ?? './data/app.snapshot.db',
}
```

Use `file` mode on constrained servers:

```ts
db: {
  mode: 'file',
  path: './data/app.db',
}
```

Use ephemeral only when the app intentionally wants throwaway state:

```ts
db: { mode: 'ephemeral' }
```

## Platform KV And Cache

Current Zero does **not** implement the full Redis-style platform KV/cache
library. It has KV-like subsystems, but they are not the same thing:

- `StateManager`: per-user state sync, RAM map plus SQLite write-through in
  `_user_state`.
- `EphemeralStateManager`: topic-scoped RAM-only KV with TTL for presence,
  typing, cursors, drag state, and other live socket data.
- Auth user properties: user metadata stored through auth tables.

The missing platform service is the general app-facing KV/cache library:

- `zero.kv.get/set/del/expire/persist/getOrSet/cas/batch/namespace`
- `zero.counter.incr/decr/value/reset`
- `zero.limiter.fixedWindow/tokenBucket/gcra/slidingWindow`
- TTL timing wheel
- in-memory active index
- append-only mutation log
- periodic checkpoint/snapshot restore
- optional value-store providers for large values

That implementation already exists in `../ai-gateway/src/zero` and should be
ported/adapted into this repo under `src/kv`.

Target architecture:

1. Keep `EphemeralStateManager` explicitly RAM-only. It is live connection state,
   not durable app cache.
2. Keep `StateManager` as per-user reactive state sync. It may continue using
   the app SQL DB because its purpose is user preference/form-state sync over
   the WebSocket protocol.
3. Add the real platform KV/cache service as a memory-first engine. Reads must
   be memory lookups. Writes append to the durable mutation stream and apply to
   memory.
4. Restore KV/cache by loading the latest checkpoint/snapshot and replaying
   newer log entries.
5. Do not implement an active file-based KV/cache mode. Disk is for recovery,
   checkpoints, logs, and optional large value pages only.

Target KV config:

```ts
kv: {
  enabled: true,
  baseDir: './data/kv',
  fsyncMs: 1000,
  checkpointIntervalMs: 30_000,
  recoverConcurrency: 8,
  ttlTickMs: 250,
  ttlSlots: 512,
  maxAppliedCache: 1024,
  valueStorage: {
    mode: 'prealloc',
    baseDir: './data/kv-values',
    extentMB: 16,
    pageKB: 64,
    checksum: 'crc32c',
  },
}
```

Default recommendation:

- App SQL DB: `hot`.
- Platform KV/cache: enabled by default once implemented, memory-first with
  append/checkpoint recovery.
- Ephemeral KV: RAM-only and separate from platform KV/cache.

## Vector Store

Vector is the third storage plane. It should support the same deployment choice
as SQL:

- `hot`: memory-backed vector collections with snapshot/checkpoint restore for
  the fastest active path.
- `file`: zvec file/mmap collections for larger indexes or lower-RAM servers.
- `ephemeral`: temp vector collections for tests/demos only.

Current Zero already has a zvec-backed vector service with useful seams:

- top-level `dataDir`
- per-index `path`
- per-index `enableMMAP`
- lazy index opening through `VectorRegistry`
- adapter boundary through `VectorIndexStore`

Target changes:

1. Add explicit vector storage mode to config.
2. Implement `hot` vector mode as memory-backed active collections with snapshot
   restore. If zvec does not provide a direct in-memory snapshot API, wrap it
   with a snapshot directory and restore/open strategy that still keeps active
   queries memory-backed where supported.
3. Keep `file` + mmap available for large indexes and constrained servers.
4. Allow `ephemeral` vector indexes for tests/demos by placing collections under
   a temp directory and deleting them on dispose.
5. Do not add native embedding/reranking here; AI integration remains the bridge.
6. Expose vector diagnostics through platform doctor:
   - mode
   - index path
   - snapshot path
   - mmap enabled
   - document count
   - index completeness
   - disk size when cheaply available

Recommended vector config:

```ts
vector: {
  mode: 'hot',
  dataDir: './data/vector',
  snapshotDir: './data/vector-snapshots',
  defaultIndex: 'default',
  indexes: {
    default: {
      dimensions: 1536,
      enableMMAP: true,
      path: './data/vector/default',
    },
  },
}
```

Constrained server config:

```ts
db: { mode: 'file', path: './data/app.db' },
kv: {
  enabled: true,
  baseDir: './data/kv',
  valueStorage: {
    mode: 'hybrid',
    baseDir: './data/kv-values',
  },
},
vector: {
  mode: 'file',
  dataDir: './data/vector',
  indexes: {
    default: { dimensions: 1536, enableMMAP: true },
  },
}
```

Maximum speed config:

```ts
db: {
  mode: 'hot',
  path: './data/app.db',
  snapshotPath: './data/app.snapshot.db',
  snapshotIntervalMs: 10_000,
},
kv: {
  enabled: true,
  baseDir: './data/kv',
  fsyncMs: 1000,
  checkpointIntervalMs: 10_000,
  valueStorage: {
    mode: 'prealloc',
    baseDir: './data/kv-values',
  },
},
vector: {
  mode: 'hot',
  dataDir: './data/vector',
  snapshotDir: './data/vector-snapshots',
  indexes: {
    default: { dimensions: 1536, enableMMAP: true },
  },
}
```

## Data Directory Layout

Default generated apps should use one predictable local data root:

```txt
data/
  app.db
  app.db-shm
  app.db-wal
  app.snapshot.db
  kv/
    streams/
    checkpoints/
  kv-values/
  vector/
    default/
  vector-snapshots/
  storage/
  migrations/
```

Notes:

- `app.db` is the file-mode DB or migration/schema source.
- `app.snapshot.db` is the hot-mode serialized snapshot target.
- Hot mode can use the same file for `path` and `snapshotPath`, but a separate
  snapshot path is clearer and safer during migration.
- File mode does not need snapshot files.
- `data/kv` owns append-only mutation logs and checkpoints for the memory-first
  platform KV/cache service.
- `data/kv-values` owns optional value pages for large KV values.
- Vector files stay under `data/vector`; vector snapshots stay under
  `data/vector-snapshots`.

## Migration Rules

Hot mode introduces one important rule: migrations must run against a real
SQLite file before the app deserializes into RAM, or they must run against the
hot in-memory DB and immediately snapshot afterward.

Recommended implementation:

1. On startup, create/open the source file DB.
2. Run pending migrations against the source file.
3. Checkpoint and serialize the source file.
4. Deserialize into hot memory.
5. Start serving requests.
6. Snapshot hot memory back to `snapshotPath` on interval and shutdown.

This keeps generated apps simple: deploy code, start server, migrations apply,
hot DB loads, app runs.

Destructive migrations should require explicit confirmation or a strict
`platform migrate` command. Hot mode must snapshot after successful migrations
before accepting requests.

## Observability And Doctor Checks

Add stable observability codes for:

- storage service started/stopped
- hot snapshot loaded
- hot snapshot written
- hot snapshot failed
- file WAL checkpoint completed
- file WAL checkpoint failed
- storage config invalid
- storage fallback used
- kv cache started/stopped
- kv checkpoint written
- kv recovery completed
- kv recovery failed
- vector snapshot loaded
- vector snapshot written
- vector recovery failed

Add doctor checks for:

- app DB mode is `ephemeral` outside tests
- generated app still defaults to `memory`
- hot mode missing `snapshotPath`
- hot mode snapshot interval too high for expected durability
- KV enabled without base directory
- KV checkpoint interval or fsync interval is unsafe for the app's durability
  expectation
- KV value storage is missing size/budget limits
- file mode parent directory missing or unwritable
- vector hot mode missing snapshot directory
- vector ephemeral mode outside tests/demos
- vector mmap disabled on large file-mode indexes

## Implementation Phases

See [Hot Storage Implementation Plan](./hot-storage-implementation-plan.md) for
the detailed phased work plan and KV/cache file layout.

### Phase 1: Port SQL Persistence Primitive

Status: implemented in the current package as `src/persistence` with the
`@zero/framework/persistence` export. The follow-up runtime wiring is also in
place: `createApp()` creates one shared SQLite service, migrations run on that
handle, ReactiveDB consumes it, and app-owned backend routes can inspect/use it
through `zero.sql`.

- Add `src/persistence` files listed above.
- Add focused tests for:
  - hot mode writes survive service close/reopen through snapshot
  - file mode writes survive restart through WAL
  - ephemeral mode does not survive restart
  - PRAGMAs apply without throwing
  - snapshot writes are atomic
  - buffer pool acquire/release/stats

### Phase 2: Refactor ReactiveDB Onto SQL Storage

Status: implemented in the current package for SQL. ReactiveDB accepts injected
`PlatformSQLiteService` and raw `Database` handles, routes standalone legacy
configs through `createPlatformSQLiteService`, and makes disposal ownership
explicit.

- Accept an injected Bun SQLite `Database`.
- Keep legacy config support.
- Stop creating `new Database(':memory:')` directly except through the
  persistence primitive.
- Make `dispose()` ownership-aware.
- Verify existing ReactiveDB tests still pass.
- Add a restart test proving hot snapshot mode persists table rows.

### Phase 2.5: Wire `createApp()` To Shared SQL

Status: implemented in the current package for SQL. `createApp()` constructs the
platform SQLite service before migrations and plugin composition, passes it
into the sync plugin, and exposes the same service as `zero.sql`/`zero.sqlite`
for app-owned backend routes. KV/cache and vector still have their own later
storage-mode alignment work.

### Phase 3: Port Real Platform KV/Cache

- Implement the Zero-owned memory engine with neocache-style hot-path goals.
- Adapt the ai-gateway append/checkpoint recovery pattern.
- Keep the file layout split by responsibility: memory engine, TTL index, LRU
  index, journal, checkpoint, recovery, service, counters, limiters, plugin.
- Expose `zero.kv`, `zero.counter`, and `zero.limiter` through the backend
  context.
- Add tests for:
  - `set/get/del/expire/persist`
  - `getMany/setMany/batch`
  - CAS success/conflict
  - counters
  - fixed window, token bucket, GCRA, sliding window
  - checkpoint restore
  - append log replay after checkpoint
  - TTL recovery behavior

### Phase 4: Refactor App Factory And Sync Plugin

- Create the application and system SQL services before sync/auth/resources.
- Pass each plane's owned handle into its corresponding ReactiveDB.
- Mount the KV/cache plugin early enough that backend routes, workflows,
  scheduler jobs, AI helpers, auth throttles, and app code can use it.
- Keep `StateManager`, auth/token stores, workflows, notifications, rooms, and
  storage metadata in `systemDb`; keep application Resources in `db` or their
  trusted Fabric tenant plane. These planes are never the same handle or file.
- Change generated app defaults from ephemeral memory to durable hot storage.
- Keep standalone `createSyncPlugin()` compatibility.

### Phase 5: Vector Alignment

- Add storage-mode docs to vector config.
- Add hot vector snapshot/recovery path.
- Keep file/mmap available for large indexes and constrained deployments.
- Add optional ephemeral temp-dir vector mode for tests/demos.
- Add doctor diagnostics for vector mode, paths, snapshots, and mmap.

### Phase 6: Docs And Generated App Updates

- Update `docs/start-here.md`.
- Update `docs/platform-overview.md`.
- Update `docs/realtime-sync/realtime-sync/reactive-db.md`.
- Update `docs/bun-sqlite-best-practices.md`.
- Update `.env.example`.
- Update create-app templates and tests.

## Acceptance Criteria

The fix is not complete until all of this is true:

- No app-facing production template defaults to ephemeral memory.
- ReactiveDB does not decide SQLite storage mode when used through `createApp()`.
- Hot mode persists app rows across restart by snapshot.
- File mode persists app rows across restart by WAL/file DB.
- State sync follows the app DB mode automatically.
- Ephemeral KV remains intentionally RAM-only.
- Platform KV/cache exists as a real Redis-style memory-first app-facing
  service with snapshot/checkpoint plus append/replay recovery.
- Platform KV/cache is never an active file-backed lookup service.
- Vector storage supports hot snapshot/recovery and file/mmap deployment modes.
- Platform doctor warns on dangerous storage choices.
- Docs explain when to choose SQL `hot`, SQL `file`, vector `hot`, vector
  `file`, and ephemeral test/live-state modes.

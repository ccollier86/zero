# Platform KV/cache

Zero ships a server-side Redis-style KV/cache service for fast app data,
counters, rate limits, workflow coordination, and backend scratch state without
adding Redis or another service.

The active lookup path is memory-first. Disk is used for append-only journal
records and checkpoints so a normal restart can recover the cache state.

## createApp Defaults

`createApp()` mounts KV by default:

```ts
import { defineZeroConfig } from '@zero/framework/server';

export default defineZeroConfig({
  db: {
    mode: 'hot',
    path: './data/app.db',
    snapshotPath: './data/app.snapshot.db',
  },
  tables,
  kv: {
    baseDir: './data/kv',
    durability: 'everysec',
  },
});
```

Omit `kv` to use the same default durable settings. Set `kv: false` only when
an app intentionally does not want the platform cache mounted.

```ts
export default defineZeroConfig({
  db: { mode: 'hot', path: './data/app.db', snapshotPath: './data/app.snapshot.db' },
  tables,
  kv: false,
});
```

Tests and intentionally ephemeral demos may use `durability: 'memory'`.
Generated apps should keep `everysec` or use `always` when the caller must not
observe a successful mutation until the journal is flushed.

## Backend Usage

App-owned backend routes receive the service through the `zero` context:

```ts
import { createServerRoute } from '@zero/framework/server';

export default createServerRoute({ name: 'cache.demo', prefix: '/api/cache' })
  .post('/message', async ({ zero }) => {
    await zero.kv?.set('message:latest', 'hello', { ttlMs: 60_000 });
    await zero.counter?.increment('message:writes');

    return {
      value: zero.kv?.get('message:latest') ?? null,
      writes: zero.counter?.value('message:writes') ?? 0,
    };
  });
```

The same service can be resolved outside a route when needed:

```ts
import { getKvService } from '@zero/framework/server';

const kv = getKvService();
await kv?.set('job:last-run', Date.now());
```

Use the process-level accessor only after application startup has completed.
Elysia routes mounted after `createKvPlugin()` are gated until recovery is
ready; arbitrary startup code using `getKvService()` does not have a request
lifecycle to provide that gate.

## Public API

The service currently supports:

- `get`, `getEntry`, `has`
- `set`, `setMany`, `getMany`
- `delete`, `deleteMany`
- `expire`, `persist`
- `compareAndSet`
- `getOrSet`
- `increment`, `decrement`
- `namespace`
- counters through `zero.counter`
- fixed-window, token-bucket, and sliding-window limiters through `zero.limiter`

Example namespacing:

```ts
const onboarding = zero.kv?.namespace('onboarding');

await onboarding?.set('draft:123', { step: 3 }, { ttlMs: 24 * 60 * 60 * 1000 });
const draft = onboarding?.get<{ step: number }>('draft:123');
```

## Concurrency and atomicity

One `KvService` instance provides a linearizable decision-and-commit boundary
for each key. Once work enters that key boundary, it observes earlier queued
mutations and later queued mutations cannot pass it. This boundary includes
ordinary writes, deletes, expiry changes, counters, `compareAndSet`, and the
state mutations used by the limiter helpers.

`getOrSet` intentionally runs its caller-provided loader outside the key queue
so a slow or nested loader cannot block or deadlock unrelated application work.
After the loader resolves, `getOrSet` enters the key boundary and checks again:
if an overlapping write filled the key first, it returns that value; otherwise
it commits the loaded value. Overlapping calls may therefore complete in a
different order from the order in which their loaders began while remaining
linearizable.

In particular:

- `compareAndSet` performs its read, version comparison, and conditional write
  as one same-key operation. It is atomic against `set`, `delete`, `expire`,
  `persist`, counters, and other compare-and-set calls using that service
  instance.
- Fixed-window, token-bucket, and sliding-window limiters read their bucket,
  make the admission decision, and commit the next bucket state as one
  same-key operation. Concurrent requests through the same service therefore
  cannot all make a decision from the same stale bucket state.
- A successful mutation returns the value, entry version, or limiter decision
  produced by that specific operation. Its result is captured before a later
  mutation can replace the key; the service does not reread shared state after
  an asynchronous persistence step to construct the result.

In an unbounded service, different keys may perform their key-local work
concurrently. Durable modes still commit journaled mutations in one ordered
sequence so that recovery replays the same order; that necessary journal commit
boundary is not a promise of fully parallel disk writes.

When `memory.maxEntries` or `memory.maxBytes` is configured, capacity and LRU
eviction are global state: writing one key can evict another. Zero therefore
serializes bounded mutation decisions through one capacity boundary in addition
to their per-key queues. This is required so an in-flight CAS, counter, or
limiter decision cannot be invalidated by another key's eviction before its WAL
record applies.

Standalone and `memory`-durability engines default to access-recency LRU.
Durable services default to mutation-recency LRU because synchronous reads
cannot durably record access order without adding write I/O to the hot read
path. Configuring `evictionRecency: 'access'` on a durable service rejects with
`KV_LIMIT_INVALID`; use `'mutation'` or omit the option.

These guarantees are **process-local and instance-local**. Separate
`KvService` instances do not share the per-key mutation boundary, even when
they run in the same process. Never point two live services or processes at the
same KV `baseDir`; the journal and checkpoint directory has one live owner.
KV compare-and-set and limiters are therefore not distributed locks,
distributed replay guards, or distributed rate limiters. Use a storage system
with cross-process atomicity when more than one server instance must coordinate
the same key.

## Durability

| Mode | Behavior | Use |
| --- | --- | --- |
| `everysec` | Append the journal record before applying and resolving the mutation; fsync the file and any newly-created directory entries periodically according to `fsyncMs` (one second by default) and during a clean stop. A crash or power loss can lose records appended since the last successful fsync. | Default balance of latency and durability. |
| `always` | Append and fsync the journal record, plus any newly-created WAL or directory namespace, before applying and resolving the mutation. | Callers must not observe success before that mutation has reached the selected local filesystem durability boundary. |
| `memory` | Apply in process memory without creating a journal or checkpoint. All state is lost when the process exits. | Tests and intentionally ephemeral demos. |

The same-key atomicity and operation-specific result guarantees apply in all
three modes. Durability describes when journal data is written and flushed; it
does not widen the coordination boundary beyond one `KvService` instance.

Periodic persistence failures are routed through Zero observability. Journal
flush failures emit `kv.flush.failed`; because a journal I/O failure is
fail-closed, later durable mutations reject instead of acknowledging work that
cannot meet the selected durability policy. Checkpoint failures emit
`kv.checkpoint.failed` and are retried on a later checkpoint interval. The
ordered journal remains the recovery source between successful checkpoints.
Checkpoint files are written to a same-directory temporary file, fsynced,
atomically renamed, and followed by a directory fsync. The prior checkpoint is
never deleted as a rename fallback.

Startup recovery:

1. Load the latest checkpoint when present.
2. Rebuild the memory engine and TTL/LRU indexes.
3. Replay journal records newer than the checkpoint.
4. Resume the next journal sequence only after accepted records have applied.

Under the default fail policy, current v2 records require a contiguous sequence
after the checkpoint and fail closed on gaps or reordering. Zero 1.3's v1 writer allocated sequences before
unsynchronized file appends, so valid legacy files can contain forward gaps and
non-monotonic physical order. Upgrade recovery preserves v1's established
file-order replay, records a migration warning, and starts v2 at one past the
largest accepted legacy sequence. A v1 record after v2 is treated as a
downgrade/corruption boundary. Records already covered by a checkpoint do not
participate in replay-contiguity checks.

An unterminated final WAL frame is treated as a torn append: recovery truncates
and fsyncs that tail, emits `kv.journal.tail_recovered`, and keeps the valid
prefix. Complete corrupt frames fail startup by default. The explicit
`corruptRecordPolicy: 'skip'` mode skips them, emits
`kv.recovery.records_skipped`, and never advances the writer sequence from an
untrusted or rejected record. In that explicit mode, a later accepted v2 record
may advance across a detected forward gap, which is reported in the recovery
diagnostics.

TTL cleanup is also durable. Reads hide expired values without deleting the
physical recovery state. Bounded services include a persisted cleanup cutoff
in their globally coordinated mutations. Periodic and final checkpoints first
append and apply a journaled cleanup boundary, then snapshot the resulting live
entries. A checkpoint failure therefore cannot leave memory cleaner than WAL
recovery, while default unbounded services still reclaim expired keys instead
of carrying them forever. A wall-clock rollback can reveal a logically expired
value only until a later acknowledged cleanup boundary removes it.

During an orderly shutdown, `stop()` first drains mutations already admitted
to the service and any in-flight flush or checkpoint. Durable modes then flush
the ordered journal and write a final checkpoint when the service has data or
mutations. The returned promise does not resolve before that drain and final
persistence work complete. Stop accepting application traffic before calling
`stop()` so shutdown has a fixed set of admitted work to drain.

## Lifecycle and value contract

When constructing `KvService` directly, await `start()` before submitting a
mutation. Writes attempted before startup or after a completed stop reject with
`KV_SERVICE_NOT_RUNNING`; writes submitted after shutdown begins reject with
`KV_SERVICE_STOPPING`. `createApp()` and `createKvPlugin()` manage this
lifecycle for normal app usage. The Elysia plugin also holds every downstream
request until startup recovery completes, so the first request cannot observe
an empty pre-recovery engine or race a not-yet-started write.

KV values are isolated, lossless JSON-compatible snapshots. Supported values
are `null`, booleans, finite numbers, strings, arrays without holes or custom
properties, and plain objects containing those values. BigInts, `undefined`,
functions, symbols, non-finite numbers, dates and other class instances,
accessor properties, cyclic structures, and excessively deep structures reject
with `KV_VALUE_INVALID`. Mutating an input after calling `set()` or mutating a
returned value does not alter the stored value.

New v2 writes reject top-level `undefined`. Legacy v1 JSON omitted such a value
entirely; during upgrade, a missing-value set is migrated to an absent key and a
missing-value checkpoint entry is discarded. Zero emits
`kv.persistence.legacy_migrated` with aggregate counts instead of failing an
otherwise recoverable 1.3 store.

Limiter calculations preserve their last effective timestamp if the wall clock
moves backward. A clock correction therefore cannot reopen a fixed window,
refill a token bucket, or discard sliding-window usage early. The fixed-window
helper also carries an active count forward from Zero's earlier time-suffixed
storage format on first access, so deploying this change does not reset an
in-progress limit window.

## Advanced Direct Plugin Usage

Most apps should let `createApp()` mount KV. Manual Elysia composition is still
available:

```ts
import { Elysia } from 'elysia';
import { createKvPlugin } from '@zero/framework/kv';

const app = new Elysia()
  .use(createKvPlugin({ baseDir: './data/kv' }))
  .get('/cache', ({ kv }) => kv.get('message'));
```

The plugin decorates Elysia context with `kv`, `kvService`, `counter`, and
`limiter`.

Treat the service's engine, journal, and checkpoint collaborators as adapter
surfaces for construction and testing, not as alternate mutation APIs. Writing
through one of those collaborators while `KvService` is running bypasses its
per-key atomicity, durability ordering, lifecycle admission, and result
contract. Application mutations must go through `KvService`, its counter and
limiter helpers, or a namespace created from the service.

## Rules

- Active KV/cache reads stay in memory.
- Disk is for journal, checkpoint, and recovery.
- KV/cache is not an active file-backed lookup service.
- Use SQL/file mode, vector/file mode, object storage, or a future external
  adapter for workloads that do not fit memory.

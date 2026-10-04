# Architecture

Four layers, one data flow. Each ReactiveDB plane owns its SQLite state and
durable change log. File-mode runtimes which share that plane can relay its log
without turning separate planes or RAM-only channels into a distributed bus.

> **Advanced engine docs:** This diagram uses lower-level standalone sync hook
> names. In normal Zero frontend apps, the public app-facing hooks are
> `useCollection`, `useLazyCollection`, `useRow`, `useQuery`, and `useStatus`
> from `@zero/framework/react`.

## System Layers

```
┌─────────────────────────────────────────────────────────┐
│                     React Components                     │
│    useTable('todos')    useRow('todos', id)    useQuery  │
├─────────────────────────────────────────────────────────┤
│                      SyncClient                          │
│   @xstate/store ← routeMessage() ← WebSocket listener   │
│   optimistic mutations → WS send → pending queue         │
├────────────────────── WebSocket ─────────────────────────┤
│                   Sync Plugin (Elysia)                   │
│   .ws('/sync') — per-socket data, mutation routing       │
│   db.onChange() → projected, status-checked direct sends │
├─────────────────────────────────────────────────────────┤
│                      ReactiveDB                          │
│   bun:sqlite — defineTable, prepared CRUD, change events │
│   versioned _changes log + state/watermark — replay/fanout│
└─────────────────────────────────────────────────────────┘
```

## Layer Responsibilities

### ReactiveDB (Server)

SQLite wrapper that makes every write observable. Each data plane owns one
instance; file-mode instances in peer runtimes may point at the same local
SQLite database.

**Owns:**
- The SQLite database (`:memory:` or WAL file)
- Table definitions and their prepared statements
- The monotonic database sequence and pruning watermark
- The versioned `_changes` log, immutable seq-0 sentinel, and replay boundary
- Change event emission

**Does not own:**
- Connection management (that's the sync plugin's WS handler)
- Network serialization (that's the sync plugin's WS handler)
- Auth/permissions (external — not part of the sync engine)

**Implementation:** `src/sync/reactive-db.ts` prepares each table's CRUD
statements in `defineTable()` and reuses them for later reads and writes. The
shared SQLite foundation in `src/persistence/` owns connection configuration;
ReactiveDB adds table metadata, transactions, sequencing, and change events.

```ts
// Conceptual API
interface ReactiveDB {
  defineTable(name: string, schema: TableSchema): void;
  insert(table: string, row: Record<string, unknown>): Change;
  createStrict(table: string, row: Row): Change;
  createScoped(table: string, row: Row, scope: RowScope): Change;
  update(table: string, id: string, partial: Record<string, unknown>): Change;
  updateIfCurrent(table: string, id: string, partial: Partial<Row>, expectedRow: Row): Change | null;
  updateScoped(table: string, id: string, partial: Partial<Row>, scope: RowScope): Change | null;
  delete(table: string, id: string): Change;
  deleteIfCurrent(table: string, id: string, expectedRow: Row): Change | null;
  deleteScoped(table: string, id: string, scope: RowScope): Change | null;
  query(table: string): Row[];
  queryOne(table: string, id: string): Row | null;
  getScoped(table: string, id: string, scope: RowScope): Row | null;
  transaction<T>(fn: () => T): T;
  readAtCurrentSequence<T>(reader: () => T): { value: T; seq: number };
  onChange(listener: (change: Change, delivery: ChangeDeliveryMetadata) => void): () => void;
  getChangesAfter(seq: number): Change[];
  dispose(): void;
}
```

The strict/conditional/scoped variants are platform-internal persistence
boundaries for registered resources. `createStrict()` and `createScoped()` use
non-replacing inserts, so a CREATE decision cannot overwrite an existing row.
`updateIfCurrent()`/`deleteIfCurrent()` repeat the exact policy-evaluated row
snapshot in the final SQL predicate. The scoped variants additionally bind the
row primary key and tenant discriminator in that statement. Each scoped write
is atomic and verifies its stored postcondition before commit, rolling back
trigger-driven scope changes or row recreation.
Ordinary standalone ReactiveDB methods retain their compatibility
semantics; app server code using them directly remains trusted and must provide
its own tenant constraints.

Standalone `createSyncPlugin({ tenancyMode: 'multi' })` requires a resource
policy adapter that reports both an explicit `global` or `tenant` realm and an
explicit `internal`, `http`, `sync`, or `all` client exposure for every
configured app table. Missing either classification is a construction-time
error, before the database or WebSocket endpoint can serve data. Only `sync`
and `all` participate in table Sync. `createApp()` builds that adapter from its
sealed resource registry.

For managed Zero auth, direct resource mutations re-resolve durable session
authority and the resource policy's trusted-property fingerprint inside the
same SQLite transaction as the conditional data write and mutation receipt.
Standalone token verifiers retain their compatibility contract unless they
implement Zero's optional synchronous authority-reference methods.

See [ReactiveDB deep dive](./reactive-db.md).

### SyncServer (Elysia Plugin)

The sync plugin — `createSyncPlugin()` — is an Elysia plugin that wraps
ReactiveDB lifecycle + a `.ws('/sync')` handler. Table changes use a small
active-socket set and direct Bun `send()` calls so Zero can project row policy,
track a per-socket predecessor cursor, and react to backpressure status.
State Sync uses the ordered `onChange` dispatcher for both local and file-mode
replica events. Delivery excludes the mutation-origin connection, then
rechecks each recipient's exact state principal and current socket authority
before a status-checked direct send.
Ephemeral collaboration uses
an app-local manager plus direct per-socket delivery so the server can
re-evaluate each recipient's async topic policy before every change.

**Owns:**
- ReactiveDB lifecycle (created during plugin composition; delivery listeners
  and channel managers started in `onStart`; disposed by the shared idempotent
  teardown on startup failure, `onStop`, or Zero runtime disposal)
- `derive({ as: 'global' })` — exposes `syncDB` to all routes and plugins
- Compatibility getter `getSyncDB()` for cross-plugin access; full `createApp()`
  wiring captures its own app-local database through `onDatabaseCreated`
- WebSocket lifecycle (via Elysia `.ws()` — `open`, `message`, `close`, `drain`)
- Per-socket state (via `ws.data` — typed `SyncSocketData`, available in all handlers)
- Per-socket subscribed-table and last-delivered-cursor state
- Authorized ephemeral bindings from client topic names to server-derived
  internal namespaces, including key ownership and live revalidation
- Subscription gating (`SyncPolicy.canReadTable` derives `allowedTables` during auth and revalidation)
- Mutation policy (`SyncPolicy.canMutateTable` and operation callbacks gate direct writes)
- Mutation dispatch (accepted client request → ReactiveDB write → ack back to caller)
- Change delivery (ReactiveDB `onChange` → policy projection → status-checked direct send)
- Reconnect handling (`epoch` + opaque authorization `scope` + `lastSeq`)

**Does not own:**
- Client-side state (that's SyncClient)
- React rendering (that's the hooks layer)
- Auth/permissions rules (external — the application supplies token verification and `SyncPolicy`)

**Why direct table delivery:** native topic publish does not report status for
each recipient and cannot attach that recipient's projected predecessor cursor.
At Zero's intended small-team concurrency, iterating the active sockets is
cheap and makes correctness explicit: `-1` is queued backpressure, `0` closes
for replay, and a successful queue advances only that socket's cursor.

**Data flow through the plugin:**

```
           ┌──────────────────────────────────────┐
           │         sync.plugin.ts                │
           │                                       │
  WS msg ──┤  1. Parse JSON message                │
           │  2. Switch on message type:            │
           │     sync.subscribe →                   │
           │       intersect with readable tables   │
           │       compare epoch + auth scope        │
           │       send replacement or catchup       │
           │     sync.mutate → dispatch below       │
           │                                       │
           │  On sync.mutate:                       │
           │  3. Validate: table exists,            │
           │     SyncPolicy allows mutation         │
           │  4. Call db.insert/update/delete        │
           │     (ordered drain wakes after commit)  │
           │  5. ws.send(sync.ack) to caller        │
           │                                       │
           │  db.onChange registered in onStart:     │
           │  project for each subscribed socket    │
           │  attach epoch/scope/prevSeq             │
           │  check that socket's send() status      │
           └──────────────────────────────────────┘
```

**Any write to ReactiveDB delivers — not just WS mutations.** An HTTP route
calling `syncDB.insert()` triggers the same `onChange` → projected direct-send
path. Background jobs, timers, other plugins, and WS writes share it.

### Wire Protocol (Transport)

JSON messages over WebSocket. Sequenced for consistency, designed for reconnect.

**Owns:**
- Message format definitions
- Sequence numbering rules
- Reconnect negotiation
- Optimistic update acknowledgment

See [Wire Protocol deep dive](./protocol.md).

### SyncClient (Client)

@xstate/store powered client. Receives changes from the server, applies them to local state, provides React hooks for consumption. Handles optimistic mutations and reconnect.

**Owns:**
- The @xstate/store instance (auto-generated from table definitions)
- Optimistic mutation queue (pending mutations awaiting server ack)
- WebSocket connection + reconnect logic
- Message routing (switch-on-type → store.send())
- React hook bindings (useSyncExternalStore)

**Does not own:**
- Data persistence (that's server-side)

**Implementation:** `src/sync/client/sync-socket-message-router.ts` routes wire
messages, while `src/sync/client/sync-store.ts` applies them to @xstate/store
state and exposes change-detected slices.

```ts
// Conceptual API
interface SyncClient {
  readonly store: SyncStore;
  readonly connected: boolean;
  insert(table: string, row: Row): void;   // optimistic + WS send
  insertAsync(table: string, row: Row, options?: SyncMutationWaitOptions): Promise<void>;
  update(table: string, id: string, partial: Partial<Row>): void;
  updateAsync(
    table: string,
    id: string,
    partial: Partial<Row>,
    options?: SyncMutationWaitOptions,
  ): Promise<void>;
  delete(table: string, id: string): void;
  deleteAsync(table: string, id: string, options?: SyncMutationWaitOptions): Promise<void>;
  disconnect(): void;
}
```

The void methods preserve the original immediate-return contract. Async
methods take the same optimistic path and await the exact server receipt. Their
abort/overall-wait options govern only the caller's bounded wait after
submission; they are not write-cancellation primitives.

See [SyncStore deep dive](./sync-store.md).

## The Core Loop

This is the fundamental data flow. Every mutation follows this path:

```
┌──────────┐    sync.mutate     ┌──────────┐    insert()     ┌──────────┐
│  Client A │ ────────────────→ │Sync Plugin│ ──────────────→ │ReactiveDB│
│           │                   │           │                 │          │
│           │    sync.ack       │           │    onChange()   │          │
│           │ ←──────────────── │           │ ←────────────── │          │
│           │                   │           │                 │          │
│           │    sync.change    │           │  direct deliver │          │
│           │ ←──────────────── │ ←──────── │  (per socket)   │          │
└──────────┘                   │           │                 └──────────┘
                                │           │
┌──────────┐    sync.change    │           │
│  Client B │ ←──── direct ───── │           │
└──────────┘                   │           │

┌──────────┐    sync.change
│  Client C │ ←──── direct ───── (same projected delivery pass)
└──────────┘
```

**Step by step:**

1. **Client A** calls `insert('todos', { id: '1', title: 'Buy milk', done: 0 })`
2. Client A's SyncClient applies the change **optimistically** to local store (instant UI update)
3. Client A's SyncClient sends `sync.mutate` message over WebSocket
4. **Sync plugin** receives the message, validates it, calls `db.insert('todos', row)`
5. **ReactiveDB** writes to SQLite, increments `seq`, and wakes its ordered change drain
6. **onChange listener** (registered in `onStart`) receives the change event
7. onChange projects the change for each readable subscribed socket, attaches
   that socket's `prevSeq`, and checks its direct `send()` result
8. Plugin sends `sync.ack { ref, seq, ok: true }` to Client A via `ws.send()` (direct, only to caller)
9. Each subscribed client receives the change, routes it via `store.send()`, @xstate/store updates
10. React re-renders via `useSyncExternalStore`

**Client A receives both the change and the ack.** The change replaces the
optimistic version with the server's canonical row state regardless of its
best-effort `origin` hint. The matching ack removes the mutation from the
pending queue. Order between the two does not matter—they serve different
purposes. Live same-runtime delivery can carry Client A's connection ID;
durable catch-up and external-runtime delivery use an empty origin.

## The Optimistic Path

When a client mutates, it doesn't wait for the server:

```
Client A:  insert({id:'1', title:'Buy milk'})
           │
           ├── store.send('todos.optimistic-insert', row)  ← instant, local
           │   └── UI re-renders immediately
           │
           └── ws.send('sync.mutate', { ref:'abc', table:'todos', op:'INSERT', row })
                                                │
                                        ┌───────┘
                                        ▼
Server:            transaction(data + receipt) → onChange
                           │                          │
                           ▼                          ▼
               direct projected sync.change           ws.send(sync.ack)
               (status checked per socket)             (to originator only)
                           │                          │
                    ┌──────┘                   ┌──────┘
                    ▼                          ▼
Client A:  ← sync.change { origin:'connA', ... }
           │   └── Replace optimistic row with server's canonical state.
           │
           ← sync.ack { ref:'abc', ok: true, change:{...canonical} }
               └── Install canonical result and remove the pending ref.

Client B:  ← sync.change (direct projected delivery)
               └── store.send('sync.change', ...) — new row appears. Re-render.
```

The successful data write and its principal-scoped mutation receipt share one
SQLite transaction. If the ack is lost, the client waits for a new baseline and
resends the same ref with a higher attempt number. A matching receipt returns
the current canonical row without a second write. A missing receipt fails
closed, so a restart or pruned replay window cannot duplicate non-idempotent
work.

**On rejection:**

```
Client A:  insert({id:'1', title:''})  ← validation will fail server-side
           │
           ├── store.send('todos.optimistic-insert', row)  ← instant
           │   └── UI shows the row (briefly)
           │
           └── ws.send('sync.mutate', ...)
                                        │
                                        ▼
Server:                    Validation fails (title required)
                           No db write, no onChange, no publish.
                                        │
                                        ▼
Client A:  ← sync.ack { ref:'abc', ok: false, error: 'title required' }
               └── Rollback: restore previousState → UI re-renders → row disappears
```

## WebSocket Configuration

Elysia `.ws()` wraps Bun's native WebSocket. These are the configuration knobs that matter:

```ts
app.ws('/sync', {
  // ─── Per-socket data (typed, set at upgrade) ──────────
  data: {} as SyncSocketData,

  // ─── Bun WebSocket config ─────────────────────────────
  idleTimeout: 120,           // Close after 2min idle (default). Bun sends pings automatically.
  sendPings: true,            // Automatic ping/pong heartbeat (default: true). Keeps connections alive
                              // through NATs, firewalls, load balancers. No custom heartbeat needed.
  maxPayloadLength: 1_048_576, // 1 MiB inbound client-frame ceiling.
  backpressureLimit: 16_777_216, // 16 MiB outgoing queue; bounded State snapshots stay below 12 MiB.
  closeOnBackpressureLimit: true, // Reconnect/replay is safer than silent loss.
  publishToSelf: true,        // Retained for extension channels using Bun topics.
  perMessageDeflate: false,    // Compression off. At 2-4 users, CPU cost > bandwidth savings.

  // ─── Lifecycle ─────────────────────────────────────────
  open(ws) { /* subscribe to allowed topics, send snapshot */ },
  message(ws, message) { /* route: sync.subscribe | sync.mutate */ },
  close(ws, code, reason) { /* Bun auto-unsubscribes from all topics */ },
  drain(ws) { /* socket ready for more data — resume any paused sends */ },
});
```

### What Bun handles automatically (no code needed)

| Concern | Bun's behavior |
|---------|---------------|
| **Heartbeat / keep-alive** | `sendPings: true` (default) — Bun sends WebSocket ping frames automatically. Client browsers respond with pong natively. Dead connections detected and closed. |
| **Idle timeout** | `idleTimeout: 120` (default) — connections closed after 120s of no data. Ping/pong resets the timer. |
| **Topic cleanup** | When a socket closes (clean or crash), Bun automatically unsubscribes it from all topics. No manual cleanup. |
| **Auto-corking** | `open`, `message`, and `drain` callbacks are automatically corked — multiple `send()` / `publish()` calls within one callback batch into a single network packet. |
| **Ping/pong pass-through** | Browsers handle pong responses natively. No application code needed on either side. |

### What we handle (application logic)

| Concern | Our approach |
|---------|-------------|
| **Backpressure** | `-1` marks queued backpressure until `drain`; `0` closes with `1013`; the 16 MiB outgoing queue limit also closes. Inbound frames remain capped at 1 MiB. Reconnect resumes from the last client-accepted cursor. |
| **Reconnect (client)** | Exponential backoff with jitter. Open a clean socket, send `sync.auth`, wait for `sync.auth.ready`, then send `sync.subscribe { epoch, scope, lastSeq }`; replay when comparable, otherwise replace every cache. |
| **WebSocket auth** | The sync plugin can receive an auth bridge with a lazy token verifier. The first `sync.auth` message is verified before application messages; invalid or missing required credentials close with `4001`. |
| **Subscription gating** | The sync plugin intersects the client's `sync.subscribe` request with `ws.data.allowedTables`, derived from the live account and `SyncPolicy.canReadTable` during the auth handshake and revalidation. |
| **Mutation gating** | `sync.mutate` is checked separately through `SyncPolicy.canMutateTable` and the optional `canInsert`, `canUpdate`, and `canDelete` callbacks. Read access does not imply write access. |
| **Per-connection state** | `ws.data` holds allowed/subscribed tables, last queued seq, backpressure state, auth context, opaque scope, and row filters. |
| **Transaction delivery** | ReactiveDB transactions emit committed changes in order; every subscribed socket gets a predecessor-linked stream. |

## Process Model

Within one runtime, everything shown below runs in a **single Bun process**. The
sync plugin is one `.use()` call in the Elysia chain:

```
┌─ Bun Process ────────────────────────────────────────────┐
│                                                           │
│  ┌─ Elysia App ───────────────────────────────────────┐  │
│  │                                                     │  │
│  │  .use(syncPlugin)  ← single plugin, self-contained │  │
│  │    │                                                │  │
│  │    ├─ compose: create DB, define tables, register   │  │
│  │    │           app-local services                   │  │
│  │    ├─ onStart: start delivery/auth/polling/managers │  │
│  │    ├─ derive: { syncDB } from this plugin instance  │  │
│  │    ├─ .ws('/sync'): WS handler (subscribe, mutate)  │  │
│  │    └─ onStop: idempotent full-runtime teardown      │  │
│  │                                                     │  │
│  │  .use(otherPlugins)  ← can read/write syncDB       │  │
│  │  .get('/api/...', ({ syncDB }) => ...)              │  │
│  │                                                     │  │
│  └────────────────────────────────────────────────────┘  │
│                                                           │
│  ┌─ ReactiveDB (owned by sync plugin) ─────────────────┐ │
│  │  bun:sqlite (:memory: or WAL file)                   │ │
│  │  Tables: user-defined + _changes                      │ │
│  │  composition: DB + schema available before listen()  │ │
│  │  onStart: onChange + optional replica log polling     │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                           │
└───────────────────────────────────────────────────────────┘
```

No separate database process, message queue, or cache layer is required.
SQLite is the database and replay log. The plugin keeps only the active socket
set needed for policy projection, delivery status, and predecessor cursors.
Multiple file-mode runtimes can tail one shared local SQLite log; each still
owns its Elysia server, sockets, policy projection, and RAM-only ephemeral
topics. `hot`/`ephemeral` databases and separate files remain independent.

## Elysia Plugin Architecture

The sync engine is an **Elysia plugin**, following the same lifecycle and
composition conventions as current Storage, Scheduler, Rooms, and
Notifications plugins:

| Convention | Sync engine implementation | Existing precedent |
|------------|---------------------------|-------------------|
| Factory function | `createSyncPlugin(config)` | `createStoragePlugin(config)`, `createSchedulerPlugin(config)` |
| Composition-time services | Create `ReactiveDB`, define configured tables, and register DB/SQLite capabilities before dependent plugins compose | Managed plugins can resolve app-bound services before `listen()` |
| `onStart` / `onStop` lifecycle | Start delivery, auth revalidation, State/Ephemeral managers, and optional replica polling / run one idempotent full-runtime teardown | `src/storage/storage.plugin.ts`, `src/scheduler/scheduler.plugin.ts` |
| `derive({ as: 'global' })` | Expose the non-null `syncDB` captured by this plugin instance | Scheduler, Rooms, Notifications, KV, and Tokens expose their scoped services the same way |
| Compatibility getter export | `getSyncDB()` returns the sole legacy provider, `null` with none, and throws `ZERO_RUNTIME_AMBIGUOUS` with multiple app runtimes | `CompatibilityProviderRegistry` prevents cross-app service selection |
| Named plugin | `new Elysia({ name: 'sync' })` | `new Elysia({ name: 'storage' })`, `new Elysia({ name: 'scheduler' })` |
| WebSocket and per-socket state | `.ws('/sync', { ... })` with typed `SyncSocketData` | Owned by `src/sync/sync.plugin.ts`; auth/access helpers include `src/sync/sync-socket-auth.ts`, `src/sync/sync-socket-access.ts`, and `src/sync/sync-socket-revalidation.ts` |
| TypeBox validation | `query: t.Object({ ... })` on WebSocket upgrade | The same plugin validates the compatibility query shape before its auth handshake |

### Plugin Structure

```ts
// Schematic current shape; policy/auth/delivery details are omitted here.
const compatibilityRuntimes = new CompatibilityProviderRegistry<SyncRuntime>(
  'Sync runtime',
);

export function getSyncDB(): ReactiveDB | null {
  // Fails closed when more than one app runtime is registered.
  return compatibilityRuntimes.get()?.db ?? null;
}

export function createSyncPlugin(config: SyncPluginConfig) {
  const db = createReactiveDB(config.db);
  const cleanupOnCompositionFailure = [() => db.dispose()];

  try {
    config.onDatabaseCreated?.(db);

    const runtime: SyncRuntime = {
      db,
      stateManager: null,
      ephemeralManager: null,
      ephemeralChannel: null,
      unsubscribeChange: null,
      unsubscribeExternalChanges: null,
      mutationOrigin: { current: null },
      replicaLogInvalid: false,
    };
    const activeSockets = new Set<ServerWebSocket<SyncSocketData>>();
    const openSockets = new Set<ServerWebSocket<SyncSocketData>>();

    const compatibilityRegistration = compatibilityRuntimes.register(
      {},
      () => runtime,
    );
    cleanupOnCompositionFailure.push(
      () => compatibilityRegistration.unregister(),
    );

    // Schema exists during composition, before this plugin or dependents start.
    for (const [name, schema] of Object.entries(config.tables)) {
      db.defineTable(name, schema);
    }
    config.runtime?.set(ZERO_SYNC_DB, db);

    let teardownComplete = false;
    const teardown = (): unknown[] => {
      if (teardownComplete) return [];
      teardownComplete = true;
      // Best-effort every stage: unsubscribe delivery/polling; dispose State,
      // Ephemeral, and auth managers; close sockets; clear app-bound and
      // compatibility registrations; dispose the DB; collect all failures.
      return teardownSyncRuntime(/* runtime, sockets, registrations, db */);
    };

    const plugin = new Elysia({ name: 'sync' })
      .onStart(() => {
        try {
          if (config.stateSync) runtime.stateManager = new StateManager(db);
          runtime.unsubscribeChange = db.onChange(/* ordered delivery below */);
          runtime.ephemeralManager = new EphemeralStateManager();
          runtime.ephemeralChannel = createEphemeralChannel(/* ... */);
          runtime.unsubscribeExternalChanges = startReplicaPollingIfConfigured();
          socketAuth.start();
        } catch (error) {
          throwWithCleanupFailures(error, teardown());
        }
      })
      .onStop(() => raiseLifecycleCleanupFailures(
        teardown(),
        '[sync] Plugin shutdown failed.',
      ))
      .derive({ as: 'global' }, () => ({ syncDB: db }))
      .ws('/sync', {
        open(ws) { /* initialize this instance's socket/auth state */ },
        message(ws, message) {
          return routeMessage(/* ..., */ runtime.mutationOrigin /*, ... */);
        },
        close(ws) { /* remove socket and clean its ephemeral state */ },
        drain(ws) { /* clear this socket's backpressure marker */ },
      });

    cleanupOnCompositionFailure.length = 0;
    return plugin;
  } catch (error) {
    // The real implementation runs this stack in reverse and aggregates any
    // cleanup failures with the original composition error.
    throwAfterCompositionCleanup(error, cleanupOnCompositionFailure);
  }
}
```

The snippet is deliberately schematic, but its ownership boundaries are the
contract: there is no process-global selected database or unsubscribe handle.
Every handler closes over one plugin-local `runtime`. A configured Zero runtime
also receives that app's DB/SQLite capabilities during composition. The
no-argument getters are compatibility adapters only; their registry refuses to
choose between multiple applications in the same process.

Composition has its own reverse-order cleanup stack. Once composition
succeeds, startup failure, Elysia `onStop`, and Zero runtime disposal converge
on the same guarded teardown. Teardown is safe to call repeatedly, attempts
every cleanup stage even if one fails, and reports combined failures rather
than leaking later resources.

### Projected direct delivery via onChange

ReactiveDB's `onChange` listener delivers every committed change through the
same policy-aware path. It is registered during `onStart`, before connections
arrive. In file mode, one durable-log dispatcher emits local and external rows
in strict database sequence order; a local commit synchronously drains any
lower remote sequence first. Each eligible socket gets a message containing the
runtime epoch, opaque authorization scope, and that socket's previous delivered
cursor.

```ts
runtime.unsubscribeChange = db.onChange((change, delivery) => {
  if (runtime.replicaLogInvalid) return;

  try {
    if (change.table === '_user_state') {
      if (!runtime.stateManager) return;
      const stateChange = runtime.stateManager.applyCommittedChange(change);
      if (!stateChange) {
        throw new Error(`Invalid durable State Sync change at seq ${change.seq}`);
      }

      // Origin is bound to the exact same-runtime committed sequence. External
      // commits use null and are delivered to every eligible principal peer.
      const origin = delivery.source === 'local'
        ? getReactiveDBLocalChangeOrigin(db, change.seq)
        : null;
      deliverStateChangeToEligibleSockets(stateChange, origin);
      return;
    }

    if (change.table.startsWith('_')) return;
    observeResourcePolicySynchronously(change);

    deliverSyncChange(
      activeSockets,
      change,
      db.syncEpoch,
      delivery.source === 'local'
        ? runtime.mutationOrigin.current ?? ''
        : '',
      socketAuth.validateCurrentAuthority,
    );
  } catch (error) {
    // A failed policy projection or malformed durable State row cannot be
    // skipped without breaking the ordered stream. Latch the runtime invalid
    // and close its sockets for a clean reconnect/recovery boundary.
    invalidateSyncRuntime(error, OBS_CODES.SYNC_POLICY_STATE_FAILED);
  }
});
```

Direct delivery is intentional: topic publish cannot report status for each
recipient or attach a recipient-specific `prevSeq`. The active socket set is
small, closed sockets are removed in the WS close hook, and the ack remains a
separate direct response to the mutating client. `routeMessage()` sets and
restores `runtime.mutationOrigin.current` only around this plugin instance's
synchronous mutation transaction. It is never a process-global routing signal,
and external-runtime changes intentionally carry no connection origin.

### Per-Socket Data

`src/sync/sync.plugin.ts` initializes the typed per-socket state in the
WebSocket `open` handler so later message, close, and drain handlers share the
same authorization and subscription state:

```ts
interface SyncSocketData {
  /** Tables this connection is allowed to subscribe to and snapshot */
  allowedTables: Set<string>;

  /** Topics this socket has subscribed to */
  subscribedTopics: Set<string>;

  /** Last seq sent to this client (for reconnect tracking) */
  lastSeq: number;

  /** Auth identity verified by sync.auth, or null for explicitly public sync */
  authContext: SyncAuthContext | null;

  /** True after async WebSocket auth resolution has completed */
  authResolved: boolean;
}
```

The `allowedTables` field is read-side connection state. The sync plugin
derives it after `sync.auth` by evaluating `SyncPolicy.canReadTable` against
all non-internal ReactiveDB tables, then recomputes it during revalidation.
Mutation policy is intentionally separate and evaluated per `sync.mutate`
message.

### Plugin Config

```ts
interface SyncPluginConfig {
  db: {
    /** ':memory:' for RAM-only, or a file path for durable storage */
    mode: 'memory' | string;
    /** Ring buffer depth (default: 1000) */
    ringBufferDepth?: number;
  };
  tables: Record<string, TableSchema>;
  auth?: SyncAuthConfig;
  policy?: SyncPolicy;
  ephemeralPolicy?: EphemeralTopicPolicy;
  /** Automatic in file mode; opt in for a shared injected SQLite handle. */
  replicaChangePolling?: false | {
    /** Positive safe integer; values 1-9 are clamped to 10ms. */
    intervalMs?: number;
  };
  /** Managed read-only framework tables in a separate system database. */
  systemDataPlane?: {
    db: ReactiveDB;
    tables: readonly string[] | Readonly<Record<string, unknown>>;
    /** Independent system-file polling; omission inherits/auto-detects. */
    replicaChangePolling?: false | { intervalMs?: number };
  };
  /** Optional State Sync database; managed apps bind this to system.db. */
  stateDB?: ReactiveDB;
}
```

Tables are defined in the plugin config — not scattered across application
code. One place defines the schema, and the plugin creates them during
composition. `policy` is optional; missing table policy preserves standalone
allow-all sync behavior. Ephemeral defaults are intentionally different:
authless standalone plugins preserve legacy unrestricted topics, while an
authenticated plugin without `ephemeralPolicy` denies every unclassified
topic.

Each configured file-backed application and system plane automatically polls
its own shared versioned `_changes` log (250 ms by default). When `stateDB` and
`systemDataPlane.db` are the same handle, one secondary poller serves both
rather than delivering duplicates. The nested system polling option can be
tuned independently; omission inherits the top-level choice and otherwise
uses file-mode auto-detection. `_zero_sync_log_state` owns each plane's
monotonic cursor/watermark, and
the first seq-0 fence adoption requires the release guide's stop-all upgrade.
The ordered dispatcher is the sole listener path while enabled: it
emits local and external commits exactly once in durable sequence order and
uses writer origin only to label process-local delivery metadata. An injected
SQLite handle does not reveal its topology, so direct composition must opt in
with `replicaChangePolling` (or the nested system option). If pruning, an
incompatible format, or corruption
creates a cursor gap, the plugin reports whether it was a `retention`,
`continuity`, or `format` gap. Before closing sockets with `1012`, it calls the
resource policy's synchronous `onHistoryGap` reset so state derived from
`observeChange` cannot survive skipped authorization history. Expensive policy
reconstruction remains lazy in the next access-resolution call. A stateful
policy without that hook, or a hook that throws or returns a Promise, latches
the runtime invalid; current and future sockets are refused until restart.
The incremental `observeChange` hook is synchronous for the same reason. A
throw, Promise return (including one hidden behind a composed policy), or a
row-filter/projector exception fatally invalidates the runtime rather than
advancing past an authorization event.
After a successful reset, reconnect supplies a fresh snapshot. State Sync
stores its raw `_user_state` mutation and one logical internal log event in the
same transaction; external state events bypass generic table broadcast and go
only to matching, revalidated state subscribers. This supports multiple
runtimes over one file-mode database; it is not replication between independent
databases, and RAM-only ephemeral topics remain local.

The reset contract is intentionally synchronous:

```ts
interface SyncResourcePolicyAdapter {
  observeChange?(change: Change): void; // update/invalidate synchronously
  onHistoryGap?(gap: {
    kind: 'retention' | 'continuity' | 'format';
    afterSeq: number;
    oldestSeq: number;
    currentSeq: number;
  }): void; // invalidate now; rebuild lazily during resolveTableAccess()
}
```

Composed adapters must preserve the delegate method receiver and surface a
thenable result instead of discarding it. The Sync runtime detects a thenable,
consumes any later rejection, and fails closed before advancing delivery.

Non-retryable log-state/schema/read failures are stronger than recoverable
history gaps: they close subscribed, unauthenticated, and auth-pending sockets
and reject later connections. SQLite busy/locked failures alone are retried
without moving the dispatcher cursor.

### WebSocket Auth And Sync Policy

HTTP auth middleware does not automatically populate WebSocket context. The
sync plugin uses an explicit auth bridge: the app passes a lazy token verifier,
and the WebSocket protocol authenticates with a first `sync.auth` message
before handling subscriptions or application messages.

```ts
createSyncPlugin({
  db: { mode: 'app.db' },
  tables,
  auth: {
    required: true,
    getTokenVerifier: getTokenService,
  },
});
```

The verifier is lazy because `createApp()` mounts sync before auth, while
WebSocket connections are accepted only after all plugin startup has
completed. The client opens a clean URL and sends `sync.auth { token }` as its
first message. The server verifies it, resolves the current account, derives
table and row permissions, and replies with `sync.auth.ready` before accepting
subscriptions. An invalid or missing token closes a required socket with
`4001`. Auth-enabled `createApp()` deployments default to required; public
sync is an explicit `syncAuth: 'public'` choice.

The server re-resolves both identity and readable-table/row-filter policy
before inbound work and periodically while connected. It also resolves the
socket's secret-free durable authority synchronously at the final boundary
before every subscribed live change is sent. A security-generation, account,
session, tenant, membership, advanced-role revision, trusted-property, or
resource-policy change closes and unsubscribes the socket before stale
authority can receive another change. Official trusted-property writes revoke
the affected user's sessions so they participate in this fence. The client
reconnects with a fresh token and receives a fresh policy.

Managed `createApp()` auth adds a system-plane SQLite authority clock and polls
it at 250 ms. Security-relevant changes on another runtime sharing `systemDb`
trigger immediate local socket and ephemeral-policy revalidation without
copying a bearer token. A
standalone verifier may expose `getAuthorityRevision()` and configure
`invalidationPollIntervalMs` to use the same boundary.

Multi-tenant authenticated Sync fails closed unless the verifier supplies
`captureAuthContextAuthority()` and `resolveAuthContextAuthority()`. Legacy
standalone single-tenant verifiers may omit that extension for compatibility.
Legacy query-string bearer support is an explicit temporary compatibility
flag, disabled by default; the current Zero client never puts tokens in URLs.

Subscription control remains table-based:

```ts
const requested = msg.tables;
const allowed = ws.data.allowedTables;
const subscribeTables = requested.filter((table) => allowed.has(table));
```

Direct mutation control is separate:

```ts
const decision = evaluateSyncMutationPolicy(policy, { table, op, rowId, row, authContext });
if (!decision.ok) sendAck(ws, ref, false, null, decision.reason);
```

The current standalone default is allow-all. `createApp()` composes app policy
with deny-wins platform defaults: private framework tables are removed from
generic reads, scoped framework rows use target/membership/owner filters across
snapshot/catch-up/live delivery, and service-owned tables reject direct Sync
mutation.

## File Organization

```
src/sync/
├── reactive-db.ts                  # Stable CRUD/transaction/snapshot/delivery facade
├── reactive-db-table-contract.ts   # Registered schema, identity, scope, exact-row rules
├── reactive-db-change-log.ts       # Durable sequence/log adoption, writes, and pruning
├── reactive-db-change-codec.ts     # Strict change/history serialization and validation
├── reactive-db-external-poller.ts  # Ordered cross-runtime polling and gap handling
├── reactive-db-synchronous-boundary.ts # Hostile/async callback-result guard
├── sync.plugin.ts                  # Elysia lifecycle, derive, and /sync WebSocket
├── message-handler.ts              # Top-level protocol dispatch
├── sync-policy.ts                  # Table read/mutation policy
├── row-filter.ts                   # Per-connection row predicates
├── sync-subscribe-handler.ts       # Subscription and catch-up coordination
├── sync-snapshot-response.ts       # Snapshot projection
├── sync-change-delivery.ts         # Live per-socket projection and delivery
├── sync-socket-auth.ts             # Authentication runtime
├── sync-socket-access.ts           # Readable-table access state
├── sync-socket-authorizer.ts       # Handshake authorization
├── sync-socket-revalidation.ts     # Live account/policy revalidation
├── types.ts                        # Shared server/client and wire types
├── index.ts                        # Public server API
│
└── client/
    ├── sync-client.ts              # Public client facade
    ├── sync-socket-connection.ts   # WebSocket lifecycle
    ├── sync-socket-handshake.ts    # Subscription handshake
    ├── sync-socket-auth-client.ts  # Bearer handshake/refresh
    ├── sync-socket-message-router.ts # Message parsing and routing
    ├── sync-reconnect-scheduler.ts # Reconnect timing
    ├── sync-store.ts               # @xstate/store reducers and slices
    ├── hooks.ts                    # useTable, useRow, useQuery, useSyncStatus
    └── index.ts                    # Public client API
```

Server and client responsibilities are split into focused modules. The public
entry points remain `src/sync/index.ts` and `src/sync/client/index.ts`.

## Integration with Application

The sync plugin composes into any Elysia app the same way every other plugin does:

```ts
// app.ts — low-level standalone composition

import { Elysia } from 'elysia';
import { createSyncPlugin } from '@zero/framework/sync';

const syncPlugin = createSyncPlugin({
  db: { mode: 'memory' },
  tables: {
    todos: { id: 'text primary key', title: 'text not null', done: 'integer default 0' },
    contacts: { id: 'text primary key', name: 'text not null', email: 'text' },
  },
});

const app = new Elysia()
  // Sync engine — provides syncDB in global context, WS at /sync
  .use(syncPlugin)

  // Application routes can write to syncDB directly
  .post('/api/seed', ({ syncDB }) => {
    syncDB.insert('todos', { id: crypto.randomUUID(), title: 'Seeded todo', done: 0 });
    return { ok: true };
    // After commit: ordered drain → policy projection → checked direct send.
  })

  .listen(3000);
```

This compact standalone example is deliberately public/allow-all. Add the
plugin's WebSocket auth bridge plus read/mutation policy before storing private
data, or use `createApp()` for Zero's managed framework-table protections.

**Key points:**
- `syncDB` is available in every route handler and middleware via `derive({ as: 'global' })`
- Any write to `syncDB` — from HTTP routes, background jobs, or WS mutations — enters the `onChange` pipeline; only eligible subscribed connections receive its projected change
- The sync plugin is **standalone** — it creates its persistence foundation
  from the supplied DB config and does not require other Zero plugins. It can
  be the only plugin in a minimal app
- It can also run alongside all existing plugins in the full application — just another `.use()` call in the chain

### Standalone Usage

The sync engine can also run as its own minimal server — no existing application needed:

```ts
import { Elysia } from 'elysia';
import { createSyncPlugin } from '@zero/framework/sync';

new Elysia()
  .use(createSyncPlugin({
    db: { mode: 'memory' },
    tables: {
      todos: { id: 'text primary key', title: 'text not null', done: 'integer default 0' },
    },
  }))
  .listen(3000);

// That's it. WebSocket live at ws://localhost:3000/sync
// This minimal server is public/allow-all until auth and policy are supplied.
```

Three lines of application code. The sync engine is a primitive — agnostic of what it's embedded in.

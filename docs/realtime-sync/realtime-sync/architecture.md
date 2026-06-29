# Architecture

Four layers, one data flow. Everything happens in a single Bun process.

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
│   db.onChange() → server.publish(topic) (native pub/sub) │
├─────────────────────────────────────────────────────────┤
│                      ReactiveDB                          │
│   bun:sqlite — defineTable, prepared CRUD, change events │
│   _changes ring buffer — seq tracking, replay on reconnect│
└─────────────────────────────────────────────────────────┘
```

## Layer Responsibilities

### ReactiveDB (Server)

SQLite wrapper that makes every write observable. One instance per application.

**Owns:**
- The SQLite database (`:memory:` or WAL file)
- Table definitions and their prepared statements
- The global sequence counter (`seq`)
- The `_changes` ring buffer for replay
- Change event emission

**Does not own:**
- Connection management (that's the sync plugin's WS handler)
- Network serialization (that's the sync plugin's WS handler)
- Auth/permissions (external — not part of the sync engine)

**Key pattern:** Same as `src/persistence/sqlite-hot-store.ts` — all prepared statements created in `defineTable()`, reused on every call. The constructor sets up PRAGMAs, `defineTable()` creates tables and prepares statements, write methods use those prepared statements and emit changes.

```ts
// Conceptual API
interface ReactiveDB {
  defineTable(name: string, schema: TableSchema): void;
  insert(table: string, row: Record<string, unknown>): Change;
  update(table: string, id: string, partial: Record<string, unknown>): Change;
  delete(table: string, id: string): Change;
  query(table: string): Row[];
  queryOne(table: string, id: string): Row | null;
  transaction<T>(fn: () => T): T;
  onChange(listener: (change: Change) => void): () => void;
  getChangesAfter(seq: number): Change[];
  dispose(): void;
}
```

See [ReactiveDB deep dive](./reactive-db.md).

### SyncServer (Elysia Plugin)

The sync plugin — `createSyncPlugin()` — is an Elysia plugin that wraps ReactiveDB lifecycle + a `.ws('/sync')` handler. Uses **Bun's native pub/sub topics** for broadcasting — no manual connection sets, no broadcast loops. Each table subscription maps to a topic. Bun handles fan-out internally at the C/uWebSocket layer.

**Owns:**
- ReactiveDB lifecycle (`onStart` creates, `onStop` disposes — same pattern as `persistence.plugin.ts`)
- `derive({ as: 'global' })` — exposes `syncDB` to all routes and plugins
- Lazy getter `getSyncDB()` — cross-plugin access (same pattern as `getPersistenceColdStore()`)
- WebSocket lifecycle (via Elysia `.ws()` — `open`, `message`, `close`, `drain`)
- Per-socket state (via `ws.data` — typed `SyncSocketData`, available in all handlers)
- Table-to-topic mapping (`sync:todos`, `sync:users` — one topic per table)
- Subscription gating (`SyncPolicy.canReadTable` derives `allowedTables` at WebSocket open)
- Mutation policy (`SyncPolicy.canMutateTable` and operation callbacks gate direct writes)
- Mutation dispatch (accepted client request → ReactiveDB write → ack back to caller)
- Change broadcast (ReactiveDB `onChange` → `server.publish(topic)` — Bun fans out)
- Reconnect handling (client sends `lastSeq` → replay missed changes via `ws.send()`)

**Does not own:**
- Client-side state (that's SyncClient)
- React rendering (that's the hooks layer)
- Auth/permissions rules (external — the application supplies token verification and `SyncPolicy`)

**Why Bun native pub/sub instead of a manual `Set<Connection>` + broadcast loop:**

The existing codebase uses `Set<ClientConnection>` with a manual broadcast loop (`src/server/session-orchestrator.ts`). That works, but for the sync engine we can do better:

| Manual broadcast | Bun native pub/sub |
|-----------------|-------------------|
| JS iterates Set, calls `send()` per connection | Single `server.publish(topic, msg)` — Bun handles fan-out at the C layer |
| Must track broken connections and clean up | Bun removes closed sockets from topics automatically |
| Must manage subscription sets manually | `ws.subscribe(topic)` / `ws.unsubscribe(topic)` — native |
| Corking requires manual batching | `open`, `message`, and `drain` callbacks are auto-corked |
| No backpressure awareness | `send()` returns `-1` (backpressure), `0` (dropped), `1+` (sent) |

For 2–4 users the performance difference is negligible, but the code is dramatically simpler. Zero connection tracking code. Zero cleanup code. The plugin becomes almost entirely routing logic.

**Data flow through the plugin:**

```
           ┌──────────────────────────────────────┐
           │         sync.plugin.ts                │
           │                                       │
  WS msg ──┤  1. Parse JSON message                │
           │  2. Switch on message type:            │
           │     sync.subscribe →                   │
           │       intersect with readable tables   │
           │       ws.subscribe('sync:{table}')     │
           │       send snapshot or catchup         │
           │     sync.mutate → dispatch below       │
           │                                       │
           │  On sync.mutate:                       │
           │  3. Validate: table exists,            │
           │     SyncPolicy allows mutation         │
           │  4. Call db.insert/update/delete        │
           │     (onChange fires synchronously →     │
           │      server.publish to ALL subscribers) │
           │  5. ws.send(sync.ack) to caller        │
           │                                       │
           │  db.onChange registered in onStart:     │
           │  server.publish(                       │
           │    'sync:' + change.table,             │
           │    JSON.stringify(sync.change msg       │
           │      with origin = connection ID)      │
           │  )                                     │
           │  Bun delivers to all subscribed        │
           │  sockets automatically                 │
           └──────────────────────────────────────┘
```

**Any write to ReactiveDB broadcasts — not just WS mutations.** An HTTP route calling `syncDB.insert()` triggers the same `onChange` → `server.publish()` path. Background jobs, timers, other plugins — any write source. One broadcast code path for everything.

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

**Key pattern:** Same as `packages/sdk/src/transport/ws-bridge.ts` — `routeMessage()` function that switches on `msg.type` and dispatches to `store.send()`. Same as `packages/sdk/src/store/store.ts` — `createSlice()` for change-detected subscriptions.

```ts
// Conceptual API
interface SyncClient {
  readonly store: SyncStore;
  readonly connected: boolean;
  insert(table: string, row: Row): void;   // optimistic + WS send
  update(table: string, id: string, partial: Partial<Row>): void;
  delete(table: string, id: string): void;
  disconnect(): void;
}
```

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
│           │    sync.change    │           │  server.publish │          │
│           │ ←──────────────── │ ←─(topic) │  ('sync:todos') │          │
└──────────┘                   │           │                 └──────────┘
                                │           │
┌──────────┐    sync.change    │           │
│  Client B │ ←──(topic sub)─── │           │
└──────────┘                   │           │

┌──────────┐    sync.change
│  Client C │ ←──(topic sub)─── (same publish, Bun delivers)
└──────────┘
```

**Step by step:**

1. **Client A** calls `insert('todos', { id: '1', title: 'Buy milk', done: 0 })`
2. Client A's SyncClient applies the change **optimistically** to local store (instant UI update)
3. Client A's SyncClient sends `sync.mutate` message over WebSocket
4. **Sync plugin** receives the message, validates it, calls `db.insert('todos', row)`
5. **ReactiveDB** writes to SQLite, increments `seq`, emits change event
6. **onChange listener** (registered in `onStart`) receives the change event
7. onChange calls `server.publish('sync:todos', changeJSON)` with `origin` set to Client A's connection ID — Bun delivers to all sockets subscribed to `sync:todos` (including Client A)
8. Plugin sends `sync.ack { ref, seq, ok: true }` to Client A via `ws.send()` (direct, only to caller)
9. Each subscribed client receives the change, routes it via `store.send()`, @xstate/store updates
10. React re-renders via `useSyncExternalStore`

**Client A receives both the change and the ack.** The change (with `origin === myConnectionId`) replaces the optimistic version with the server's canonical row state. The ack removes the mutation from the pending queue. Order between the two does not matter — they serve different purposes.

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
Server:                    ReactiveDB.insert() → onChange
                           │                          │
                           ▼                          ▼
               server.publish('sync:todos', change)   ws.send(sync.ack)
               (to ALL subscribers, includes origin)  (to originator only)
                           │                          │
                    ┌──────┘                   ┌──────┘
                    ▼                          ▼
Client A:  ← sync.change { origin:'connA', ... }
           │   └── Replace optimistic row with server's canonical state.
           │
           ← sync.ack { ref:'abc', ok: true }
               └── Remove from pending queue.

Client B:  ← sync.change (via topic subscription)
               └── store.send('sync.change', ...) — new row appears. Re-render.
```

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
  maxPayloadLength: 1_048_576, // 1MB max message. Snapshots of 1000 rows ≈ 200KB — plenty of room.
  backpressureLimit: 1_048_576, // 1MB buffer before backpressure kicks in.
  closeOnBackpressureLimit: false, // Don't kill slow clients — let drain() handle it.
  publishToSelf: true,        // Mutating client also receives the change via topic (updates lastSeq).
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
| **Backpressure** | Check `ws.send()` return value: `-1` = backpressure (message queued), `0` = dropped, `1+` = bytes sent. On `-1`, `drain` callback fires when ready. For changes, backpressure is acceptable — the client will catch up via the ring buffer on reconnect if messages are dropped. |
| **Reconnect (client)** | Exponential backoff with jitter: `Math.min(1000 * 2^attempt + random(0,1000), 30000)`. On reconnect, send `sync.subscribe { lastSeq }` — server replays missed changes or sends snapshot. |
| **WebSocket auth** | The sync plugin can receive an auth bridge with a lazy token verifier. Provided tokens are verified in `open`; invalid tokens close with `4001`. Missing tokens remain allowed unless sync auth is configured as required. |
| **Subscription gating** | The sync plugin intersects the client's `sync.subscribe` request with `ws.data.allowedTables`, which is derived from `SyncPolicy.canReadTable` at WebSocket open. |
| **Mutation gating** | `sync.mutate` is checked separately through `SyncPolicy.canMutateTable` and the optional `canInsert`, `canUpdate`, and `canDelete` callbacks. Read access does not imply write access. |
| **Per-connection state** | `ws.data` holds `SyncSocketData` (allowedTables, subscribedTopics, lastSeq, authContext). Typed via Elysia's WS data generic. Available in all lifecycle handlers. |
| **Transaction batching** | ReactiveDB transactions emit multiple changes. Each `server.publish()` call within an auto-corked `message` handler batches into one packet. For changes emitted from `onChange` (outside a handler), wrap in `ws.cork()` if needed. |

## Process Model

Everything runs in a **single Bun process**. The sync plugin is one `.use()` call in the Elysia chain:

```
┌─ Bun Process ────────────────────────────────────────────┐
│                                                           │
│  ┌─ Elysia App ───────────────────────────────────────┐  │
│  │                                                     │  │
│  │  .use(syncPlugin)  ← single plugin, self-contained │  │
│  │    │                                                │  │
│  │    ├─ onStart: createReactiveDB(), defineTable(),   │  │
│  │    │           onChange → server.publish()          │  │
│  │    ├─ derive: { syncDB } into global context        │  │
│  │    ├─ .ws('/sync'): WS handler (subscribe, mutate)  │  │
│  │    └─ onStop: db.dispose()                          │  │
│  │                                                     │  │
│  │  .use(otherPlugins)  ← can read/write syncDB       │  │
│  │  .get('/api/...', ({ syncDB }) => ...)              │  │
│  │                                                     │  │
│  └────────────────────────────────────────────────────┘  │
│                                                           │
│  ┌─ ReactiveDB (owned by sync plugin) ─────────────────┐ │
│  │  bun:sqlite (:memory: or WAL file)                   │ │
│  │  Tables: user-defined + _changes                      │ │
│  │  onChange registered in onStart → server.publish()      │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                           │
└───────────────────────────────────────────────────────────┘
```

No separate database process. No message queue. No cache layer. No manual connection management. SQLite is the database and the event log. Bun's WebSocket handles all connection lifecycle and fan-out. The plugin is pure routing logic.

## Elysia Plugin Architecture

The sync engine is an **Elysia plugin** — same pattern as every other subsystem in this codebase (`persistence.plugin.ts`, `ai-service.plugin.ts`, `knowledge.plugin.ts`). It follows the established conventions exactly:

| Convention | Sync engine implementation | Existing precedent |
|------------|---------------------------|-------------------|
| Factory function | `createSyncPlugin(config)` | `createIngestionQueuePlugin(getMemoryService)` |
| `onStart` / `onStop` lifecycle | Create ReactiveDB, define tables, register onChange → `server.publish()` / dispose | `persistence.plugin.ts` — init + crash recovery / dispose |
| `derive({ as: 'global' })` | Expose `syncDB` to all routes and plugins | `persistence.plugin.ts` — exposes `persistence` |
| Lazy getter export | `getSyncDB()` for cross-plugin access | `getPersistenceColdStore()`, `getKnowledgeMemoryService()` |
| Named plugin | `new Elysia({ name: 'sync' })` | `new Elysia({ name: 'persistence' })`, `new Elysia({ name: 'audio-ws' })` |
| WS handler inside plugin | `.ws('/sync', { ... })` | `audioWebSocket` — `.ws('/ws', { ... })` |
| Per-socket data via `ws.data` | `SyncSocketData` typed through Elysia | `audio-handler.ts` — `ws.data.query`, `ws.data.__orchestrator` |
| TypeBox validation | `query: t.Object({ ... })` on WS upgrade | `audio-handler.ts` — validates `sessionId`, `token`, etc. |

### Plugin Structure

```ts
// src/sync/sync.plugin.ts

import Elysia, { t } from 'elysia';
import { createReactiveDB, type ReactiveDB } from './reactive-db';
import type { SyncPluginConfig, SyncSocketData } from './types';

let _db: ReactiveDB | null = null;
let _unsubChange: (() => void) | null = null;

/** Lazy getter — other plugins/routes access the ReactiveDB instance */
export function getSyncDB(): ReactiveDB | null {
  return _db;
}

export function createSyncPlugin(config: SyncPluginConfig) {
  return new Elysia({ name: 'sync' })

    // ─── Lifecycle ────────────────────────────────────
    .onStart(({ server }) => {
      _db = createReactiveDB(config.db);

      // Define tables from config
      for (const [name, schema] of Object.entries(config.tables)) {
        _db.defineTable(name, schema);
      }

      // Register onChange in onStart — before any WS connections arrive.
      // server.publish() is a no-op if no sockets are subscribed yet.
      _unsubChange = _db.onChange((change) => {
        server.publish(
          `sync:${change.table}`,
          JSON.stringify({
            type: 'sync.change',
            seq: change.seq,
            table: change.table,
            op: change.op,
            rowId: change.rowId,
            row: change.row,
            origin: change.origin,
            ts: change.ts,
          })
        );
      });

      console.log(`[sync] Enabled (${config.db.mode === 'memory' ? ':memory:' : config.db.mode})`);
    })

    .onStop(() => {
      _unsubChange?.();
      _unsubChange = null;
      _db?.dispose();
      _db = null;
      console.log('[sync] Stopped');
    })

    // ─── Derive: expose syncDB to all routes/plugins ─
    .derive({ as: 'global' }, () => ({
      syncDB: _db,
    }))

    // ─── WebSocket handler ────────────────────────────
    .ws('/sync', {
      query: t.Object({
        token: t.Optional(t.String()),           // Auth token (only query param allowed)
      }),

      // Per-socket data — typed, available in all handlers
      data: {} as SyncSocketData,

      // Bun WebSocket knobs
      idleTimeout: 120,
      sendPings: true,
      maxPayloadLength: 1_048_576,
      publishToSelf: true,
      perMessageDeflate: false,

      open(ws) { /* verify token, subscribe topics, send snapshot/catchup */ },
      message(ws, message) { /* route: sync.subscribe | sync.mutate */ },
      close(ws) { /* Bun auto-unsubscribes from all topics */ },
      drain(ws) { /* resume paused sends */ },
    });
}
```

### Broadcasting: `server.publish()` via onChange

The critical integration point: ReactiveDB's `onChange` listener needs to broadcast changes to all subscribed WebSockets. This uses Bun's `server.publish(topic, data)`. The `onChange` listener is registered in the sync plugin's `onStart` lifecycle — before any WebSocket connections arrive. It is **not** deferred to the first socket open.

```ts
// Inside the plugin's onStart lifecycle:

.onStart(({ server }) => {
  _db = createReactiveDB(config.db);

  for (const [name, schema] of Object.entries(config.tables)) {
    _db.defineTable(name, schema);
  }

  // Register onChange listener immediately — broadcasts to all future subscribers.
  // If no sockets are subscribed yet, server.publish() is a no-op.
  _unsubChange = _db.onChange((change) => {
    server.publish(
      `sync:${change.table}`,
      JSON.stringify({
        type: 'sync.change',
        seq: change.seq,
        table: change.table,
        op: change.op,
        rowId: change.rowId,
        row: change.row,
        origin: change.origin,
        ts: change.ts,
      })
    );
  });

  console.log(`[sync] Enabled (${config.db.mode === 'memory' ? ':memory:' : config.db.mode})`);
})
```

**Why `server.publish()` instead of `ws.publish()`:**

| Method | Behavior |
|--------|----------|
| `ws.publish(topic, data)` | Sends to all topic subscribers **except** the calling socket |
| `server.publish(topic, data)` | Sends to **all** topic subscribers, no exclusions |

We use `server.publish()` in the `onChange` listener because:
1. The mutating client also needs the change (to update `lastSeq` and confirm optimistic state)
2. The `onChange` listener fires for ALL writes — not just WS mutations. HTTP routes, background jobs, transactions — any write to ReactiveDB broadcasts to all subscribers
3. Single code path for all broadcast — no special cases

The ack is still sent directly via `ws.send()` to the mutating client only.

### Per-Socket Data

Same pattern as `audio-handler.ts` — per-socket state set during upgrade, typed, available in all handlers:

```ts
interface SyncSocketData {
  /** Tables this connection is allowed to subscribe to and snapshot */
  allowedTables: Set<string>;

  /** Topics this socket has subscribed to */
  subscribedTopics: Set<string>;

  /** Last seq sent to this client (for reconnect tracking) */
  lastSeq: number;

  /** Auth identity verified during WebSocket open, or null for anonymous sync */
  authContext: SyncAuthContext | null;

  /** True after async WebSocket auth resolution has completed */
  authResolved: boolean;
}
```

The `allowedTables` field is read-side connection state. The sync plugin derives it at WebSocket open by evaluating `SyncPolicy.canReadTable` against all non-internal ReactiveDB tables. Mutation policy is intentionally separate and evaluated per `sync.mutate` message.

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
}
```

Tables are defined in the plugin config — not scattered across application code. One place defines the schema, the plugin creates them all in `onStart`. `policy` is optional; missing policy preserves standalone allow-all sync behavior.

### WebSocket Auth And Sync Policy

HTTP auth middleware does not automatically populate WebSocket context. The sync plugin uses an explicit auth bridge: the app passes a lazy token verifier, and the sync `open` lifecycle verifies `?token=...` before handling messages.

```ts
createSyncPlugin({
  db,
  tables,
  auth: {
    required: false,
    getTokenVerifier: getTokenService,
  },
});
```

The verifier is lazy because `createApp()` mounts sync before auth, while WebSocket connections are accepted only after all plugin startup has completed. A valid token becomes `ws.data.authContext`, which state sync and presence can use for per-user behavior. An invalid provided token closes the socket with `4001`.

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

The current standalone default is allow-all for app tables. `createApp()` composes that with platform defaults that make service-owned tables read-only over direct sync mutation.

## File Organization

```
src/sync/
├── reactive-db.ts          # ReactiveDB — SQLite wrapper with change events
├── sync.plugin.ts          # Elysia plugin — lifecycle, derive, WS handler
├── message-handler.ts      # Switch-on-type message routing (sync.subscribe, sync.mutate)
├── types.ts                # Shared types: TableSchema, Row, Change, SyncSocketData, protocol messages
├── index.ts                # Public API: createSyncPlugin, getSyncDB, createReactiveDB
│
├── client/
│   ├── sync-client.ts      # SyncClient — WS connection, reconnect, message dispatch
│   ├── sync-store.ts       # @xstate/store — auto-generated from table defs, reducers
│   └── hooks.ts            # useTable, useRow, useQuery — React bindings
└── client/index.ts         # Public client API: createSyncClient, hooks
```

**Server** (5 files): `reactive-db.ts` is the data layer, `sync.plugin.ts` is the Elysia integration, `message-handler.ts` is the protocol routing, `types.ts` is shared types, `index.ts` re-exports. Each under 400 lines. Single responsibility per file.

**Client** (3 files + barrel): separate package or directory, no server dependencies. Same @xstate/store pattern as `packages/sdk/src/store/store.ts`.

## Integration with Application

The sync plugin composes into any Elysia app the same way every other plugin does:

```ts
// app.ts — same composition pattern as the existing server

import { createSyncPlugin, getSyncDB } from '../sync';

const syncPlugin = createSyncPlugin({
  db: { mode: 'memory' },
  tables: {
    todos: { id: 'text primary key', title: 'text not null', done: 'integer default 0' },
    users: { id: 'text primary key', name: 'text not null', email: 'text' },
  },
});

const app = new Elysia()
  .use(cors({ origin: '*' }))
  .use(errorHandlerMiddleware)

  // Sync engine — provides syncDB in global context, WS at /sync
  .use(syncPlugin)

  // Application routes can write to syncDB directly
  .post('/api/seed', ({ syncDB }) => {
    if (!syncDB) return { error: 'sync not initialized' };
    syncDB.insert('todos', { id: crypto.randomUUID(), title: 'Seeded todo', done: 0 });
    return { ok: true };
    // onChange fires → server.publish() → all WS clients see the new row
  })

  .listen(3000);
```

**Key points:**
- `syncDB` is available in every route handler and middleware via `derive({ as: 'global' })`
- Any write to `syncDB` — from HTTP routes, background jobs, or WS mutations — broadcasts to all subscribers automatically via the `onChange` listener
- The sync plugin is **standalone** — it doesn't depend on persistence, knowledge, analysis, or any other plugin. It can be the only plugin in a minimal app
- It can also run alongside all existing plugins in the full application — just another `.use()` call in the chain

### Standalone Usage

The sync engine can also run as its own minimal server — no existing application needed:

```ts
import { Elysia } from 'elysia';
import { createSyncPlugin } from './sync';

new Elysia()
  .use(createSyncPlugin({
    db: { mode: 'memory' },
    tables: {
      todos: { id: 'text primary key', title: 'text not null', done: 'integer default 0' },
    },
  }))
  .listen(3000);

// That's it. WebSocket live at ws://localhost:3000/sync
```

Three lines of application code. The sync engine is a primitive — agnostic of what it's embedded in.

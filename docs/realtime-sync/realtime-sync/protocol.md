# Wire Protocol

JSON messages over WebSocket. Every message has a `type` field. The server assigns a monotonic sequence number to every data change. Clients track their position in the sequence to handle reconnect without data loss.

> **Advanced engine docs:** This page describes the standalone sync wire
> protocol. Full Zero apps usually consume this through `@zero/framework/react`
> hooks (`useCollection`, `useLazyCollection`, `useStatus`) instead of the
> lower-level sync hooks named here.

## Message Types

### Server → Client

#### `sync.snapshot`

Full table state sent on initial connection (after subscribe) or when the client's gap is too large for incremental replay.

```json
{
  "type": "sync.snapshot",
  "tables": {
    "todos": {
      "1": { "id": "1", "title": "Buy milk", "done": 0 },
      "3": { "id": "3", "title": "Walk dog", "done": 1 }
    },
    "users": {
      "alice": { "id": "alice", "name": "Alice", "role": "admin" }
    }
  },
  "seq": 42
}
```

| Field | Type | Description |
|-------|------|-------------|
| `tables` | `Record<string, Record<PK, Row>>` | Full contents of each subscribed table, keyed by primary key |
| `seq` | `number` | Current sequence number — client stores this as `lastSeq` |

The client replaces local state for the included tables. Pending mutations and
same-row queue tracking are cleared only for tables present in the snapshot
payload because the snapshot is authoritative for those tables. Lazy tables are
usually omitted from snapshots, so their pending optimistic mutations remain
active until an ack, catchup, timeout, or later snapshot explicitly includes
that table. See [SyncStore — Snapshot Behavior](./sync-store.md#snapshot-behavior)
for details.

#### `sync.change`

Single row mutation. Sent to all subscribed clients after every successful write.

```json
{
  "type": "sync.change",
  "seq": 43,
  "table": "todos",
  "op": "INSERT",
  "rowId": "5",
  "row": { "id": "5", "title": "New todo", "done": 0 },
  "origin": "conn_abc123",
  "ts": 1709500000000
}
```

| Field | Type | Description |
|-------|------|-------------|
| `seq` | `number` | Global sequence number for this change |
| `table` | `string` | Table name |
| `op` | `'INSERT' \| 'UPDATE' \| 'DELETE'` | Operation type |
| `rowId` | `string` | Primary key of the affected row |
| `row` | `Row \| null` | Full row data (null for DELETE) |
| `origin` | `string` | Connection ID of the client that caused this mutation |
| `ts` | `number` | Server timestamp (Date.now()) |

The `origin` field identifies which client connection triggered the mutation. The originating client uses `sync.change` to apply the server's canonical row state (replacing its optimistic version, which may differ if the server added timestamps, defaults, etc.). The `sync.ack` then clears the mutation from the pending queue. Non-originating clients ignore this field — they just apply the row state normally.

For `UPDATE`, `row` contains the **full row** (not a partial). This simplifies client-side reducers — always replace the entire row.

For `DELETE`, `row` is `null` and `rowId` identifies which row to remove.

#### `sync.ack`

Acknowledgment of a client mutation request. Sent only to the requesting client.

```json
{
  "type": "sync.ack",
  "ref": "abc-123",
  "seq": 43,
  "ok": true
}
```

```json
{
  "type": "sync.ack",
  "ref": "abc-123",
  "seq": null,
  "ok": false,
  "error": "Validation failed: title is required"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `ref` | `string` | Client-generated reference ID (echoed back from the mutation request) |
| `seq` | `number \| null` | Sequence number of the resulting change (null if rejected) |
| `ok` | `boolean` | Whether the mutation succeeded |
| `error` | `string?` | Human-readable error message (only present when `ok: false`) |

On `ok: true`, the client removes the mutation from its pending queue — the optimistic state is confirmed.

On `ok: false`, the client rolls back the optimistic change by restoring the previous state from the pending queue.

#### `sync.catchup`

Array of missed changes sent on reconnect. Structurally identical to an array of `sync.change` messages.

```json
{
  "type": "sync.catchup",
  "changes": [
    { "seq": 43, "table": "todos", "op": "INSERT", "rowId": "5", "row": { "id": "5", "title": "New", "done": 0 }, "origin": "conn_abc", "ts": 1709500000000 },
    { "seq": 44, "table": "todos", "op": "UPDATE", "rowId": "1", "row": { "id": "1", "title": "Buy milk", "done": 1 }, "origin": "conn_def", "ts": 1709500001000 },
    { "seq": 45, "table": "todos", "op": "DELETE", "rowId": "3", "row": null, "origin": "conn_abc", "ts": 1709500002000 }
  ],
  "seq": 45
}
```

| Field | Type | Description |
|-------|------|-------------|
| `changes` | `Change[]` | Ordered array of changes since the client's `lastSeq` |
| `seq` | `number` | Latest sequence number after applying all changes |

The client applies each change in order, updating `lastSeq` to the final `seq` value.

### Client → Server

#### `sync.subscribe`

Declares which tables the client wants to receive changes for. Sent on initial connection and on reconnect.

```json
{
  "type": "sync.subscribe",
  "tables": ["todos", "users"],
  "snapshot": ["todos"],
  "lastSeq": 0
}
```

| Field | Type | Description |
|-------|------|-------------|
| `tables` | `string[]` | Table names to subscribe to for live changes |
| `snapshot` | `string[]` | Table names to include in the snapshot response. Lazy tables should be omitted. |
| `lastSeq` | `number` | Last sequence number the client received (0 for fresh connect) |

The server intersects `tables` and `snapshot` with the socket's readable table set. Readable tables are derived from `SyncPolicy.canReadTable` during WebSocket open and stored as `ws.data.allowedTables`.

**Server response logic:**
- If `lastSeq === 0` → send `sync.snapshot` with full table contents
- If `lastSeq > 0` and gap is within ring buffer depth → send `sync.catchup`
- If `lastSeq > 0` but gap exceeds ring buffer → send `sync.snapshot` (full resync)

#### `sync.mutate`

Request to mutate data. The server validates policy and applies or rejects.

```json
{
  "type": "sync.mutate",
  "ref": "abc-123",
  "table": "todos",
  "op": "INSERT",
  "row": { "id": "5", "title": "New todo", "done": 0 }
}
```

```json
{
  "type": "sync.mutate",
  "ref": "def-456",
  "table": "todos",
  "op": "UPDATE",
  "rowId": "1",
  "row": { "done": 1 }
}
```

```json
{
  "type": "sync.mutate",
  "ref": "ghi-789",
  "table": "todos",
  "op": "DELETE",
  "rowId": "3"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `ref` | `string` | Client-generated reference ID (crypto.randomUUID). Used to correlate ack. |
| `table` | `string` | Target table name |
| `op` | `'INSERT' \| 'UPDATE' \| 'DELETE'` | Operation type |
| `rowId` | `string?` | Primary key (required for UPDATE/DELETE, optional for INSERT if included in `row`) |
| `row` | `Row \| Partial<Row>?` | Full row for INSERT, partial for UPDATE, omitted for DELETE |

Mutation authorization is separate from subscription authorization. `sync.mutate` is checked through `SyncPolicy.canMutateTable` and the optional operation callbacks `canInsert`, `canUpdate`, and `canDelete`. A table can be readable over sync but writable only through a domain service or HTTP route.

## Sequencing

### Global Sequence Counter

The server maintains a single monotonic counter incremented on every write:

```
seq=1  INSERT todos {id:'1', title:'Buy milk'}
seq=2  INSERT todos {id:'2', title:'Walk dog'}
seq=3  UPDATE todos {id:'1', done:1}
seq=4  DELETE todos {id:'2'}
seq=5  INSERT users {id:'alice', name:'Alice'}
```

The counter spans **all tables** — it's a global ordering of all changes. This makes reconnect simple: the client says "I have everything up to seq=3" and the server replays seq 4, 5, ... regardless of which tables they affect.

**Implementation:** A simple integer variable in ReactiveDB, incremented atomically in each write method. Not stored in SQLite (volatile) — starts at 0 on process start, first write gets `seq=1`. On restart, the `_changes` ring buffer is truncated (stale entries from the previous process) and all reconnecting clients get a fresh snapshot.

### Client Tracking

Each client tracks `lastSeq` — the highest sequence number it has processed:

```
Client connects          → lastSeq = 0
Receives sync.snapshot   → lastSeq = 42
Receives sync.change     → lastSeq = 43
Receives sync.change     → lastSeq = 44
Disconnects...
Reconnects               → sends sync.subscribe { lastSeq: 44 }
Receives sync.catchup    → lastSeq = 48 (4 changes replayed)
```

### Ring Buffer (`_changes` table)

The server keeps a ring buffer of recent changes in a SQLite table for replay on reconnect:

```sql
CREATE TABLE _changes (
  seq     INTEGER PRIMARY KEY,
  tbl     TEXT NOT NULL,
  op      TEXT NOT NULL,
  row_id  TEXT NOT NULL,
  data    TEXT,          -- JSON-serialized row (null for DELETE)
  ts      INTEGER NOT NULL
);
```

**Ring buffer depth:** Configurable, default 1000 entries. When a new change would exceed the depth, the oldest entry is deleted:

```sql
DELETE FROM _changes WHERE seq <= (SELECT MAX(seq) - 1000 FROM _changes);
```

This runs as part of the write transaction, so it's atomic with the change insertion.

**When the buffer is insufficient:**

If a reconnecting client's `lastSeq` is older than the oldest entry in `_changes`, the server can't replay incrementally. It sends a `sync.snapshot` instead — a full resync. This is the fallback for clients that were disconnected for a long time.

For 2–4 users making modest mutations, a depth of 1000 covers several hours of disconnection.

## Connection Lifecycle

Uses Bun's native WebSocket with per-socket data and topic-based pub/sub. See [architecture.md](./architecture.md) for why.

### Initial Connect

```
Client                          Server (Elysia .ws())
  │                               │
  │── WS upgrade ──────────────→ │  query: ?token=... (auth only)
  │←── connection established ────│  open: verify token, derive readable tables from SyncPolicy
  │                               │
  │── sync.subscribe ───────────→ │  Intersect tables/snapshot with ws.data.allowedTables
  │   { tables, snapshot,        │  For each readable requested table:
  │     lastSeq: 0 }             │
  │                               │    ws.subscribe('sync:{table}')
  │                               │  lastSeq=0 → build snapshot
  │                               │
  │←── sync.snapshot ─────────────│  ws.send() — direct to this socket only
  │   { tables: {...}, seq: 42 }  │
  │                               │
  │  (client sets lastSeq = 42)   │
  │                               │
  │←── sync.change ───────────────│  Via topic subscription (server.publish)
  │←── sync.change ───────────────│
  │                               │
```

Table subscription is always message-based — the client sends `sync.subscribe { tables, snapshot, lastSeq }` as a JSON message after the connection is established. The only query string parameter allowed on the WS upgrade URL is `token` for authentication. Tables are **never** specified via query string parameters.

When the sync plugin is configured with an auth bridge, a provided token is verified in the WebSocket `open` lifecycle before any sync, state, or ephemeral messages are handled. Invalid provided tokens close the socket with code `4001`. Missing tokens are allowed for standalone/public sync unless the app config marks sync auth as required.

The same `open` lifecycle derives the socket's readable table set from `SyncPolicy.canReadTable`. Direct client writes are checked later per `sync.mutate` message through mutation policy, so read access does not automatically imply write access.

### Reconnect

```
Client                          Server
  │                               │
  │  (WS disconnects)            │  close: Bun auto-unsubscribes from all topics
  │                               │
  │  (exponential backoff         │
  │   + jitter)                   │
  │                               │
  │── WS upgrade ──────────────→ │  New socket, new ws.data
  │←── connection established ────│
  │                               │
  │── sync.subscribe ───────────→ │  lastSeq=44 → check ring buffer
  │   { tables, lastSeq: 44 }    │  ws.subscribe('sync:{table}') for each
  │                               │
  │                               │  Ring buffer has seq 40-48?
  │                               │  → send catchup (45, 46, 47, 48)
  │                               │
  │←── sync.catchup ─────────────│  ws.send() — direct to this socket
  │   { changes: [...], seq: 48 } │
  │                               │
  │  (client applies changes,     │
  │   sets lastSeq = 48)          │
  │                               │
  │←── sync.change ───────────────│  Live changes resume via topic
  │                               │
```

### Reconnect — Gap Too Large (Pruned Seq)

When `getChangesAfter(seq)` returns `null` — meaning the client's `lastSeq` has
been pruned from the ring buffer — the server cannot replay incrementally. It
sends `sync.snapshot` instead of `sync.catchup` for the requested snapshot
tables. The client treats the included tables as authoritative: it replaces
their local state and clears pending mutation state for those tables only.

```
Client                          Server
  │                               │
  │── sync.subscribe ───────────→ │  lastSeq=5, but oldest in buffer is seq=200
  │   { tables, lastSeq: 5 }     │  getChangesAfter(5) → null (pruned)
  │                               │  → send full sync.snapshot
  │                               │
  │←── sync.snapshot ─────────────│  Full resync via ws.send()
  │   { tables: {...}, seq: 300 } │
  │                               │
  │  (client replaces included    │
  │   table state and clears      │
  │   matching pending entries,   │
  │   sets lastSeq = 300)         │
  │                               │
```

### Client Reconnect Strategy

Exponential backoff with jitter prevents thundering herd on server restart:

```
attempt 1: wait  1s + random(0, 1000ms)
attempt 2: wait  2s + random(0, 1000ms)
attempt 3: wait  4s + random(0, 1000ms)
attempt 4: wait  8s + random(0, 1000ms)
...
max:        wait 30s + random(0, 1000ms)
```

On successful reconnect, reset the attempt counter to 0.

### Offline Behavior

Connection is expected. This is a web app — an active WebSocket connection is the baseline assumption.

When disconnected, the standalone sync client can show an offline indicator via `useSyncStatus()` (see [SyncStore — Connection Status](./sync-store.md#connection-status)). Full Zero apps usually use `useStatus()` from `@zero/framework/react`. There is no IndexedDB persistence and no offline mutation queue. Optimistic mutations sitting in the @xstate/store pending queue are lost if the tab or page is closed while disconnected.

When the connection resumes, the client sends `sync.subscribe` with its `lastSeq`. The server responds with `sync.catchup` (if the seq is still in the ring buffer) or a fresh `sync.snapshot` (if the seq was pruned). Either way, the client converges to the server's current state.

## Optimistic Update Protocol

### Success Path

```
Client A                        Server                        Client B
  │                               │                              │
  │ insert('todos', row)          │                              │
  │ ├─ store.send(optimistic)     │                              │
  │ │  └─ UI re-renders           │                              │
  │ └─ ws.send(sync.mutate)────→  │                              │
  │    { ref:'abc', ... }         │                              │
  │                               │ db.insert() → seq=43         │
  │                               │ onChange() fires              │
  │                               │ server.publish('sync:todos') │
  │                               │  (to ALL subscribers)        │
  │                               │                              │
  │ ←── sync.change ──────────── │ ──── sync.change ──────────→ │
  │  { seq:43, origin:'connA',    │  { seq:43, op:INSERT, row }  │
  │    op:INSERT, row }           │  └─ store.send() → re-render │
  │  └─ origin===myId → replace   │                              │
  │     optimistic with server's  │                              │
  │     canonical row state       │                              │
  │                               │                              │
  │ ←── sync.ack ─────────────── │                              │
  │  { ref:'abc', seq:43, ok:true}│                              │
  │  └─ Remove from pending queue │                              │
```

### Rejection Path

```
Client A                        Server
  │                               │
  │ insert('todos', { id:'1', title:'' })
  │ ├─ store.send(optimistic)     │
  │ │  └─ UI shows row (briefly)  │
  │ └─ ws.send(sync.mutate)────→  │
  │    { ref:'abc', ... }         │  Validation: title required
  │                               │
  │ ←── sync.ack ─────────────── │
  │  { ref:'abc', ok:false,       │
  │    error:'title required' }   │
  │  └─ Rollback: restore         │
  │     pre-mutation state         │
  │     from pending queue         │
  │  └─ UI re-renders (row gone)  │
```

### Pending Queue

The client maintains a queue of in-flight mutations:

```ts
interface PendingMutation {
  ref: string;                    // Correlation ID
  table: string;
  op: 'INSERT' | 'UPDATE' | 'DELETE';
  rowId: string;
  previousState: Row | null;      // For rollback — row before optimistic apply
  optimisticState: Row | null;    // What we applied optimistically
  sentAt: number;                 // For timeout detection
}
```

**Queue behavior:**
- On mutation: push to queue (capturing `previousState` from current store), apply optimistic change, send WS message
- On `sync.change` (with matching `table + rowId`): apply server's canonical row state (replaces optimistic version). This handles cases where the server modified the row (added timestamps, defaults, etc.).
- On `sync.ack { ok: true }`: remove from queue by `ref`. No state change needed — the `sync.change` already reconciled the data.
- On `sync.ack { ok: false }`: remove from queue by `ref`, restore `previousState` to store.
- On `sync.snapshot` (reconnect or full resync): clear pending entries and same-row queue tracking for tables included in the snapshot. The snapshot is the truth for those tables. Pending mutations for omitted lazy tables stay active.
- On timeout (configurable, default 10s): treat as rejection, roll back.
- **Same-row ordering:** Mutations to the same row are serialized — the client does not send a second mutation for a row until the first is acked. This prevents dependent `previousState` chains from breaking on rollback.

## Message Ordering Guarantees

**Server guarantees:**
- `sync.change` messages arrive in `seq` order (TCP + single publisher)
- On mutation: ReactiveDB writes → `onChange` fires → handler does two things: (1) `server.publish('sync:{table}', change)` to ALL subscribers (includes `origin` field), then (2) `ws.send(ack)` to the originating client
- `sync.snapshot` and `sync.catchup` are always the first data messages after `sync.subscribe`

**Client behavior for the originating client:**
- Receives `sync.change` with `origin === myConnectionId` → applies server's canonical row state (replacing optimistic version, which may differ if server added timestamps, defaults, etc.)
- Then receives `sync.ack` → removes mutation from pending queue
- Order between `sync.change` and `sync.ack` does not matter because they serve different purposes: the change reconciles data, the ack clears pending. Both always arrive (TCP guarantees delivery), and each is idempotent in its role

**Client assumptions:**
- WebSocket delivers messages in order (TCP guarantees this)
- If a `seq` gap is detected in live changes: send a new `sync.subscribe` with current `lastSeq` to request catchup

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Malformed JSON from client | Server ignores message, no ack sent |
| Unknown table in `sync.mutate` | `sync.ack { ok: false, error: 'Unknown table: xyz' }` |
| Policy-denied `sync.mutate` | `sync.ack { ok: false, error: '<policy reason>' }` |
| Unknown table in `sync.subscribe` | Server subscribes to known tables, ignores unknown ones |
| WS connection drops | Bun auto-unsubscribes socket from all topics. Client auto-reconnects with exponential backoff + jitter, sends `sync.subscribe { lastSeq }`. |
| Server restart | All clients reconnect. `seq` starts at 0. `_changes` truncated. All clients get fresh `sync.snapshot`. |

## Delivery Model

Changes are broadcast via Bun's native `server.publish(topic, msg)`. This is **at-most-once delivery** — if a socket's send buffer is full (backpressure), the message may be dropped (`send()` returns `0`).

This is fine because the seq counter + ring buffer provides a catch-up mechanism. If a client misses changes (due to backpressure, brief disconnect, or anything else), the next `sync.subscribe` replays the gap. The client detects missed changes by tracking `lastSeq` — if an incoming `sync.change` has `seq > lastSeq + 1`, there's a gap.

**At-most-once publish + catch-up on reconnect = effectively at-least-once delivery.** No message is permanently lost as long as it's within the ring buffer depth.

For 2–4 users on a local network, backpressure drops are essentially impossible. The ring buffer is a safety net, not a normal code path.

## Message Size Considerations

For the target use case (2–4 users, thousands of rows):

- Snapshot of 1000 rows at ~200 bytes/row ≈ 200KB — fine for a single WS message
- Individual changes are typically 100–500 bytes
- Ring buffer of 1000 changes at ~300 bytes each ≈ 300KB max catchup payload

No chunking or pagination needed at this scale.

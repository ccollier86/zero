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
  "seq": 42,
  "epoch": "7d7e...",
  "scope": "1a9c...",
  "reset": "preserve-pending"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `tables` | `Record<string, Record<PK, Row>>` | Full contents of each subscribed table, keyed by primary key |
| `seq` | `number` | Current sequence number — client stores this as `lastSeq` |
| `epoch` | `string` | Process-unique sequence epoch — a change makes old sequence numbers incomparable |
| `scope` | `string \| null` | Opaque hash of the authenticated identity and effective read policy |
| `reset` | `'preserve-pending' \| 'purge'` | Authoritative replacement of every full and lazy table cache |

Current servers mark snapshots as cache replacements. The client first clears
every table cache, including lazy tables omitted from `tables`, then installs
the supplied full-table rows. `preserve-pending` retains unresolved in-memory
work, but an already-attempted mutation does not cover the replacement's
authoritative row with stale optimistic state. Never-sent offline work may
remain optimistic until its first send. `purge` also removes pending work and
is used when the authorization scope changed. This prevents deleted or newly
forbidden lazy rows from surviving a restart or replay overflow.

#### `sync.change`

Single row mutation. Sent to all subscribed clients after every successful write.

```json
{
  "type": "sync.change",
  "seq": 43,
  "prevSeq": 42,
  "epoch": "7d7e...",
  "scope": "1a9c...",
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
| `prevSeq` | `number` | Previous change/catchup cursor successfully queued to this socket |
| `epoch` | `string` | Sequence epoch for this server runtime |
| `scope` | `string \| null` | Opaque authorization scope for this socket |
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
  "ok": true,
  "change": {
    "table": "todos",
    "op": "UPDATE",
    "rowId": "5",
    "row": { "id": "5", "title": "New todo", "done": 0 }
  }
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
| `seq` | `number \| null` | Server sequence at canonical resolution time (null if rejected) |
| `ok` | `boolean` | Whether the mutation succeeded |
| `error` | `string?` | Human-readable error message (only present when `ok: false`) |
| `change` | `{ table, op, rowId, row }?` | Current authorization-projected canonical result; current servers include it for successful SDK mutations |

On `ok: true`, the client installs the canonical `change` when present and
removes the mutation from its pending queue. This also reconciles defaults,
normalization, later writes, and durable receipt replay.

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
  "seq": 45,
  "prevSeq": 42,
  "epoch": "7d7e...",
  "scope": "1a9c..."
}
```

| Field | Type | Description |
|-------|------|-------------|
| `changes` | `Change[]` | Ordered array of changes since the client's `lastSeq` |
| `seq` | `number` | Latest sequence number after applying all changes |
| `prevSeq` | `number` | Exact client cursor used to build this atomic replay |
| `epoch` | `string` | Sequence epoch for the replay |
| `scope` | `string \| null` | Opaque authorization scope for the replay |

The client applies each change in order, updating `lastSeq` to the final `seq` value.

### Client → Server

#### `sync.subscribe`

Declares which tables the client wants to receive changes for. Sent on initial connection and on reconnect.

```json
{
  "type": "sync.subscribe",
  "tables": ["todos", "users"],
  "snapshot": ["todos"],
  "lastSeq": 42,
  "epoch": "7d7e...",
  "scope": "1a9c..."
}
```

| Field | Type | Description |
|-------|------|-------------|
| `tables` | `string[]` | Table names to subscribe to for live changes |
| `snapshot` | `string[]` | Table names to include in the snapshot response. Lazy tables should be omitted. |
| `lastSeq` | `number` | Last sequence number the client received (0 for fresh connect) |
| `epoch` | `string?` | Last accepted server epoch; omitted only before the first baseline |
| `scope` | `string \| null?` | Last accepted opaque authorization scope |

The server intersects `tables` and `snapshot` with the socket's readable table
set. Readable tables are derived from the live account and
`SyncPolicy.canReadTable` during the `sync.auth` handshake, stored as
`ws.data.allowedTables`, and recomputed during socket revalidation.

**Server response logic:**
- Missing/mismatched `epoch`, a cursor ahead of the server, or an insufficient
  ring buffer → `sync.snapshot { reset: 'preserve-pending' }`.
- A changed or incomparable non-fresh `scope` →
  `sync.snapshot { reset: 'purge' }`.
- Matching epoch/scope with a replayable cursor → `sync.catchup`, including an
  empty catchup when already current.

#### `sync.mutate`

Request to mutate data. The server validates policy and applies or rejects.

```json
{
  "type": "sync.mutate",
  "ref": "abc-123",
  "table": "todos",
  "op": "INSERT",
  "row": { "id": "5", "title": "New todo", "done": 0 },
  "epoch": "7d7e...",
  "attempt": 1
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
| `epoch` | `string?` | Server epoch used for the first transport attempt |
| `attempt` | `number?` | Monotonic transport attempt; the Zero client starts at 1 |

Mutation authorization is separate from subscription authorization. `sync.mutate` is checked through `SyncPolicy.canMutateTable` and the optional operation callbacks `canInsert`, `canUpdate`, and `canDelete`. A table can be readable over sync but writable only through a domain service or HTTP route.

Successful mutations write their data change and a principal-scoped receipt in
the same SQLite transaction. A reconnect reuses the original `ref`, request,
and first-attempt `epoch` while incrementing `attempt`. The server returns the
receipt without executing the operation again. If a later attempt has no
matching receipt—or a ref is reused for different work—the server rejects it.
It never guesses that retrying a non-idempotent operation is safe.

Receipts retain only `table`, `op`, and `rowId`; application row bodies are
reloaded under current read authorization and are never kept in the ledger.
Pruning protects receipts younger than one hour, then applies a 2,500-entry
per-principal cap before a 25,000-entry global cap, with a seven-day maximum
age. A burst can temporarily exceed the count caps during that protected
uncertainty window. Eviction can turn a very late retry into a visible
outcome-unavailable rejection, but it cannot turn that retry into a second
write. Start a genuinely new user action with a new ref.

The official client uses this retry contract. Legacy/raw clients that omit
`attempt` retain the compatibility behavior and are responsible for their own
idempotency discipline.

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

**Implementation:** The integer and a cryptographically random `epoch` live in
each ReactiveDB runtime. The counter starts at 0 and `_changes` is truncated for
durable databases on restart. Because clients send both values, a sequence from
an earlier process can never be mistaken for a current cursor—even when the old
and new counters happen to be equal. An epoch change produces an authoritative
replacement snapshot.

### Client Tracking

Each client tracks `lastSeq` — the highest sequence number it has processed:

```
Client connects          → lastSeq = 0
Receives sync.snapshot   → epoch = E1, scope = S1, lastSeq = 42
Receives sync.change     → verify prevSeq = 42, lastSeq = 43
Receives sync.change     → verify prevSeq = 43, lastSeq = 44
Disconnects...
Reconnects               → sends sync.subscribe { epoch:E1, scope:S1, lastSeq:44 }
Receives sync.catchup    → verify prevSeq = 44, lastSeq = 48
```

`seq` is global, but `prevSeq` is projected per connection. Changes to tables
that a socket did not subscribe to do not advance that socket's predecessor.
This avoids false gap detection while still proving continuity for every
change that should have reached that client.

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

If a reconnecting client's `lastSeq` is older than the oldest entry in
`_changes`, the server cannot replay incrementally. It sends a replacement
snapshot. The replacement invalidates omitted lazy caches as well as included
full tables, then preserves same-scope in-memory work. Already-attempted work
is rebased onto the snapshot without hiding its authoritative rows.

For 2–4 users making modest mutations, a depth of 1000 covers several hours of disconnection.

## Connection Lifecycle

Uses Bun's native WebSocket with per-socket data and status-checked direct
delivery for table sync. State and ephemeral extension channels retain topics.

### Initial Connect

```
Client                          Server (Elysia .ws())
  │                               │
  │── WS upgrade ──────────────→ │  clean URL; no bearer in query string
  │←── connection established ────│
  │── sync.auth { token } ──────→ │  verify token and current user
  │                               │  derive readable tables and row filters
  │←── sync.auth.ready ───────────│
  │                               │
  │── sync.subscribe ───────────→ │  Intersect tables/snapshot with ws.data.allowedTables
  │   { tables, snapshot,        │  Compare epoch + opaque authorization scope
  │     lastSeq: 0 }             │  Build authoritative initial baseline
  │                               │
  │←── sync.snapshot ─────────────│  ws.send() — direct to this socket only
  │   { tables, seq:42, epoch,    │
  │     scope, reset }            │
  │                               │
  │  (client sets lastSeq = 42)   │
  │                               │
  │←── sync.change ───────────────│  Direct status-checked per-socket delivery
  │←── sync.change ───────────────│  Each carries prevSeq + epoch + scope
  │                               │
```

Authentication and table subscription are message-based. The current client
opens a clean WebSocket URL, sends `sync.auth { token }`, waits for
`sync.auth.ready`, and only then sends
`sync.subscribe { tables, snapshot, lastSeq, epoch, scope }`. Bearer tokens and table names
are **never** placed in the URL by the current client.

When the sync plugin is configured with an auth bridge, it verifies the first
auth message before any sync, state, or ephemeral message is handled. Invalid
or missing credentials close a required socket with code `4001`. Standalone
sync can be deliberately public; auth-enabled `createApp()` deployments default
to required and must explicitly choose `syncAuth: 'public'` to allow anonymous
sync. A temporary server-only legacy query-token compatibility option is
disabled by default.

The auth handshake derives the socket's readable table set and resource row
filters. The server recomputes that authorization during socket revalidation;
if a role, property, table grant, or row filter changes, it closes the socket
and removes subscriptions so stale read access cannot continue. Direct client
writes are still checked per `sync.mutate` through mutation policy, so read
access does not automatically imply write access.

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
  │── sync.subscribe ───────────→ │  Verify epoch/scope, then check ring buffer
  │   { tables, lastSeq:44,      │
  │     epoch:E1, scope:S1 }     │
  │                               │
  │                               │  Ring buffer has seq 40-48?
  │                               │  → send catchup (45, 46, 47, 48)
  │                               │
  │←── sync.catchup ─────────────│  ws.send() — direct to this socket
  │   { changes, prevSeq:44,      │
  │     seq:48, epoch:E1,         │
  │     scope:S1 }                │
  │                               │
  │  (client applies changes,     │
  │   sets lastSeq = 48)          │
  │                               │
  │←── sync.change ───────────────│  Live status-checked delivery resumes
  │                               │
```

### Reconnect — Gap Too Large (Pruned Seq)

When `getChangesAfter(seq)` returns `null` — meaning the client's `lastSeq` has
been pruned from the ring buffer — the server cannot replay incrementally. It
sends `sync.snapshot` instead of `sync.catchup` for the requested snapshot
tables. The client clears all full and lazy caches. It then installs included
full-table rows and preserves unresolved mutations when the opaque
authorization scope is unchanged. Already-attempted mutations remain metadata,
not an overlay over the replacement's authoritative state.

```
Client                          Server
  │                               │
  │── sync.subscribe ───────────→ │  lastSeq=5, but oldest in buffer is seq=200
  │   { tables, lastSeq: 5 }     │  getChangesAfter(5) → null (pruned)
  │                               │  → send full sync.snapshot
  │                               │
  │←── sync.snapshot ─────────────│  Full replacement via status-checked ws.send()
  │   { tables, seq:300, epoch,   │
  │     scope, reset:             │
  │     'preserve-pending' }      │
  │                               │
  │  (client clears every cache,  │
  │   installs snapshot tables,   │
  │   rebases pending work,       │
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

When disconnected, the standalone sync client can show an offline indicator via
`useSyncStatus()` (see [SyncStore — Connection Status](./sync-store.md#connection-status)).
Full Zero apps usually use `useStatus()` from `@zero/framework/react`. Pending
mutations and outbound messages are queued in memory. After reconnect they wait
for the epoch/scope baseline. Same-scope replacements preserve the work but
show authoritative snapshot state for mutations that were already attempted;
never-sent offline work can remain optimistic. Changed-scope replacements purge
the queue before anything is sent. There is no IndexedDB persistence, so
closing the page still discards offline work.

When the connection resumes, the client sends `sync.subscribe` with its
`epoch`, `scope`, and `lastSeq`. It does not flush newly queued offline
mutations until a valid catchup or replacement baseline has been applied.

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
  │                               │ project for each socket      │
  │                               │ status-check ws.send()       │
  │                               │                              │
  │ ←── sync.change ──────────── │ ──── sync.change ──────────→ │
  │  { seq:43, origin:'connA',    │  { seq:43, op:INSERT, row }  │
  │    op:INSERT, row }           │  └─ store.send() → re-render │
  │  └─ origin===myId → replace   │                              │
  │     optimistic with server's  │                              │
  │     canonical row state       │                              │
  │                               │                              │
  │ ←── sync.ack ─────────────── │                              │
  │  { ref:'abc', seq:43, ok:true,│                              │
  │    change:{...canonical} }    │                              │
  │  └─ Install canonical result  │                              │
  │     and remove pending ref    │                              │
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
  optimisticPatch?: Partial<Row>; // Intent retained for safe rebasing
  sentAt: number;                 // For timeout detection
  attempts: number;               // Successful transport sends
}
```

**Queue behavior:**
- On mutation: push to queue (capturing `previousState` from current store), apply optimistic change, send WS message
- On `sync.change` (with matching `table + rowId`): apply server's canonical row state (replaces optimistic version). This handles cases where the server modified the row (added timestamps, defaults, etc.).
- On `sync.ack { ok: true }`: install its canonical result and remove by `ref`.
- On `sync.ack { ok: false }`: remove from queue by `ref`, restore `previousState` to store.
- On a `preserve-pending` replacement: clear every full and lazy cache, install
  the snapshot, and rebase attempted pending work without covering the server
  row. On `purge`, clear pending work and every cached row because the
  authorization scope changed.
- A catchup row never confirms a mutation merely because `table + rowId`
  matches. Only the matching ack/receipt settles the mutation.
- On timeout (configurable, default 10s): treat as rejection, roll back.
- **Same-row ordering:** Mutations to the same row are serialized — the client does not send a second mutation for a row until the first is acked. This prevents dependent `previousState` chains from breaking on rollback.

## Message Ordering Guarantees

**Server guarantees:**
- `sync.change` messages arrive in socket order and carry the exact projected
  predecessor cursor the client must already hold.
- On mutation: ReactiveDB writes → `onChange` fires → the server projects and
  directly sends the change to each readable subscribed socket → it sends the
  ack to the origin.
- `sync.snapshot` and `sync.catchup` are always the first data messages after `sync.subscribe`

**Client behavior for the originating client:**
- Receives `sync.change` with `origin === myConnectionId` → applies server's canonical row state (replacing optimistic version, which may differ if server added timestamps, defaults, etc.)
- Then receives `sync.ack` → removes mutation from pending queue
- Order between `sync.change` and `sync.ack` does not matter because they serve
  different purposes. A failed direct send closes the socket so reconnect
  replay supplies the canonical change.

**Client assumptions:**
- WebSocket delivers messages in order (TCP guarantees this)
- If `prevSeq`, `epoch`, or `scope` does not match, reject the message without
  mutating the store and reconnect from the last accepted cursor.

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Malformed JSON from client | Server ignores message, no ack sent |
| Unknown table in `sync.mutate` | `sync.ack { ok: false, error: 'Unknown table: xyz' }` |
| Policy-denied `sync.mutate` | `sync.ack { ok: false, error: '<policy reason>' }` |
| Unknown table in `sync.subscribe` | Server subscribes to known tables, ignores unknown ones |
| WS connection drops | Client auto-reconnects with exponential backoff + jitter and sends `sync.subscribe { epoch, scope, lastSeq }`. |
| Server restart | The new epoch makes every old cursor incomparable; clients receive an authoritative replacement snapshot. |
| Authorization scope changes while disconnected | Server sends `reset: 'purge'`; cached rows and queued mutations are removed before outbound work resumes. |
| Bun `send()` returns `0` | Server closes with `1013`; client reconnects from its last accepted cursor. |
| Retried mutation has no durable receipt | Server rejects it as outcome-unavailable; client keeps authoritative baseline state and does not duplicate the operation. |

## Delivery Model

Table changes use direct per-socket `send()` calls so Zero can observe Bun's
delivery status. `-1` means the message is queued under backpressure; the socket
is marked until `drain`. `0` means the message was dropped, so Zero immediately
closes the socket with `1013`. Bun is also configured to close a connection at
the one-megabyte backpressure limit.

Every live change includes `prevSeq`, the last cursor successfully queued to
that socket. Because this predecessor is per socket, unrelated or filtered-out
global changes do not create false gaps. A mismatch is rejected client-side and
causes reconnect/catchup. TCP ordering, explicit send-status handling, the
projected cursor, and epoch-aware replay together prevent a dropped UPDATE or
DELETE from becoming permanent local state.

## Message Size Considerations

For the target use case (2–4 users, thousands of rows):

- Snapshot of 1000 rows at ~200 bytes/row ≈ 200KB — fine for a single WS message
- Individual changes are typically 100–500 bytes
- Ring buffer of 1000 changes at ~300 bytes each ≈ 300KB max catchup payload

No chunking or pagination needed at this scale.

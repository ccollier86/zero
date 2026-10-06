# Wire Protocol

JSON messages over WebSocket. Every message has a `type` field. The server assigns a monotonic sequence number to every data change. Clients track their position in the sequence to handle reconnect without data loss.

Resource `arrayOverlaps` constraints need no new wire message. Snapshot,
catch-up and live row delivery apply the same exact array policy as HTTP/Fabric;
changed labels or live member authority can remove cached rows. Periodic bearer
revalidation checks durable authority before and after its async lookup, so
known membership revocation purges the data boundary rather than being mistaken
for ordinary token expiry. Same-authority token refresh retains its existing
behavior. See [array authorization](../../../docs-next/backend/resources/array-overlap.md).

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
    "contacts": {
      "alice": { "id": "alice", "name": "Alice", "kind": "customer" }
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
| `scope` | `string \| null` | Opaque hash of authenticated identity, durable session/tenant generations, and effective read policy |
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

Single row mutation. Sent after a successful write only to subscribed
connections whose current table/resource/row policy permits that change. At
the last boundary before send, authenticated sockets re-resolve their captured
durable session authority. A revoked or changed user/session/tenant/membership
or advanced-role revision closes and reset-clears the socket instead of
delivering under cached authority. Multi-tenant authenticated servers reject
connections whose verifier cannot provide that durable authority contract.

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
| `origin` | `string` | Exact process-local transaction origin when available; empty for replay, external, and application-owned writes |
| `ts` | `number` | Server timestamp (Date.now()) |

For a live mutation handled and delivered by the same Zero runtime, `origin`
contains the mutating connection ID. Zero binds it to the exact outer database
transaction and committed sequence, so reentrant application writes cannot
inherit it and a local row delayed by ordered replica draining cannot lose it.
The connection ID is deliberately not stored in the durable change log:
catch-up rows, file-replica rows, and application-owned changes use `""`.
Every client applies the canonical row regardless of this hint. Only the
matching `sync.ack.ref` correlates and settles an optimistic mutation.

For `UPDATE`, `row` contains the **full row** (not a partial). This simplifies client-side reducers — always replace the entire row.

For `DELETE`, `row` is `null` and `rowId` identifies which row to remove.

#### `sync.ack`

Acknowledgment of a client mutation request. Sent only to the requesting client.

```json
{
  "type": "sync.ack",
  "plane": "default",
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
  "plane": "default",
  "ref": "abc-123",
  "seq": null,
  "ok": false,
  "error": "Application data realm is not ready",
  "errorCode": "SYNC_DATA_REALM_NOT_READY"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `plane` | `'default' \| 'system' \| 'tenant'?` | Data plane which owns the acknowledged table. Present for tenant/system acknowledgements and for default acknowledgements on a multiplexed socket; omission is the legacy/default plane. It is a server assertion, never a client-selected database. |
| `ref` | `string` | Client-generated reference ID (echoed back from the mutation request) |
| `seq` | `number \| null` | Server sequence at canonical resolution time (null if rejected) |
| `ok` | `boolean` | Whether the mutation succeeded |
| `error` | `string?` | Human-readable error message (only present when `ok: false`) |
| `errorCode` | `SyncAckErrorCode?` | Stable machine-readable rejection class. Branch on this value, not `error`; omitted for rejection classes without a stable public code. |
| `change` | `{ table, op, rowId, row }?` | Current authorization-projected canonical result; current servers include it for successful SDK mutations |

On `ok: true`, the client installs the canonical `change` when present and
removes the mutation from its pending queue. This also reconciles defaults,
normalization, later writes, and durable receipt replay.

The additive `SyncClient.insertAsync()`, `updateAsync()`, and `deleteAsync()`
methods, plus their typed `Collection` equivalents, resolve only from this
exact `ref` after the ack has passed through canonical store routing and the
same-row queue. Existing void mutation methods retain their fire-and-forget
contract. The async wait defaults to 30 seconds and is bounded to five minutes.
Caller abort and wait timeout stop only the promise wait; they do not remove or
roll back a submitted mutation, so it may still commit. Temporary reconnects
and `preserve-pending` snapshots retain the waiter, while snapshot replacement,
client reset/disconnect, and authorization-scope replacement reject it with a
stable `SyncMutationError.code`.

On `ok: false`, the client rolls back the optimistic change by restoring the
previous state from the pending queue. A negative acknowledgement settles that
attempt; recovery behavior depends on `errorCode`:

| `errorCode` | Meaning | Client recovery |
| --- | --- | --- |
| `SYNC_DATA_REALM_NOT_READY` | The selected application realm's required identity anchors are still provisioning or retrying. No mutation committed. | Query the active realm through `client.dataRealm.getReadiness()`, use the idempotent `client.dataRealm.retry()` flow (or `DataRealmReadyGate`), and submit the desired application mutation only after the realm reports `ready`. Do not tight-loop the Sync mutation. |
| `SYNC_DATA_REALM_UNAVAILABLE` | Projection is terminally failed, quarantined, or otherwise unavailable. No mutation committed. | Keep the optimistic change rolled back, surface the realm failure, and require operator repair or an explicit supported readiness recovery. Do not automatically resubmit. |
| `SYNC_MUTATION_RECEIPT_EXPIRED` | The server can no longer prove the outcome of an older idempotency key. Current synchronized state is authoritative. | Reconcile from the accepted snapshot/catch-up state. Never blindly replay the old logical effect; create a new user-intended mutation only after the app has re-evaluated current state. |
| `SYNC_MUTATION_CAPACITY_EXHAUSTED` | The durable mutation-receipt capacity is exhausted. | Roll back and stop automatic retries; capacity requires operator remediation. |

Realm readiness codes currently apply to mutations on the pinned default
application plane whose declared Guardian references require projection. The
HTTP readiness API remains the source of retry timing and terminal/retryable
state; the Sync code deliberately contains no target ID, path, SQL detail, or
private projection failure.

High-level and low-level clients expose the same rejection notification:
`ClientConfig.onMutationRejected` / `SyncClientConfig.onMutationRejected` for a
configured observer and `client.onMutationRejected(handler)` for a disposable
runtime subscription. It fires after the optimistic row has been rolled back
and carries `{ ref, table, op, rowId, plane?, error?, errorCode?, source }`,
where `source` is `server` or `timeout`. Callback failures cannot interrupt
rollback or queue progress. Applications should branch on `errorCode` and use
`source` only to distinguish a local acknowledgement timeout; `error` remains
display-oriented text.

An awaited negative ack rejects with the secret-free `SyncMutationError` only
after that rollback. Its `code` is `SYNC_MUTATION_REJECTED` and its optional
`serverErrorCode` carries the stable `SyncAckErrorCode`; raw server text and
causes are deliberately excluded. The transport acknowledgement timeout uses
`SYNC_MUTATION_ACK_TIMEOUT`. The distinct `SYNC_MUTATION_WAIT_TIMEOUT` and
`SYNC_MUTATION_WAIT_ABORTED` codes mean only that the caller stopped waiting.

#### `sync.catchup`

Array of missed changes sent on reconnect. Structurally identical to an array of `sync.change` messages.

```json
{
  "type": "sync.catchup",
  "changes": [
    { "seq": 43, "table": "todos", "op": "INSERT", "rowId": "5", "row": { "id": "5", "title": "New", "done": 0 }, "origin": "", "ts": 1709500000000 },
    { "seq": 44, "table": "todos", "op": "UPDATE", "rowId": "1", "row": { "id": "1", "title": "Buy milk", "done": 1 }, "origin": "", "ts": 1709500001000 },
    { "seq": 45, "table": "todos", "op": "DELETE", "rowId": "3", "row": null, "origin": "", "ts": 1709500002000 }
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

For a registered tenant resource, realm enforcement is an additional mandatory
boundary outside those callbacks. The socket must carry a live session-bound
tenant context. Snapshots, catch-up, and live changes are filtered by the
trusted tenant discriminator. Inserts are server-stamped and reject a
conflicting discriminator; updates cannot include it. Authorized update/delete
predicates are carried into the actual SQL mutation, so a custom policy branch
or a row that changes tenant while async policy work is running cannot widen
the write. In multi mode, app-managed Sync tables without an explicit resource
realm and explicit exposure permitting Sync are neither subscribable nor
mutable.

Successful mutations write their data change and a principal-and-authorization-
scope receipt in
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

## Ephemeral Collaboration Channel

Ephemeral state is RAM-only, topic-scoped JSON used for presence, typing,
cursors, and similar short-lived collaboration. It is not part of the
sequenced table stream and is not replayed after a restart. Every accepted
client topic is mapped by server policy to an internal namespace; client input
is never used directly as the delivery namespace.

Client operations are:

```json
{ "type": "ephemeral.subscribe", "topic": "presence:room_123" }
{ "type": "ephemeral.unsubscribe", "topic": "presence:room_123" }
{ "type": "ephemeral.set", "topic": "presence:room_123", "key": "user:user_7", "value": { "online": true }, "ttl": 30000 }
{ "type": "ephemeral.delete", "topic": "presence:room_123", "key": "user:user_7" }
```

An accepted subscription receives a complete topic snapshot, followed by
changes. The `topic` in each response is the original client-facing topic, not
the internal namespace:

```json
{
  "type": "ephemeral.snapshot",
  "topic": "presence:room_123",
  "entries": {
    "user:user_7": { "value": { "online": true }, "userId": "user_7" }
  }
}
```

```json
{
  "type": "ephemeral.change",
  "topic": "presence:room_123",
  "key": "user:user_7",
  "value": { "online": true },
  "userId": "user_7",
  "op": "set"
}
```

### Authorization and ownership

`EphemeralTopicPolicy.authorize()` is async and runs for `subscribe`, `set`,
and `delete`. An allow decision supplies a server-owned `namespace` and either
`actor` ownership (the default) or explicit `unrestricted` ownership. Actor
ownership prevents one authenticated principal from overwriting or deleting a
key first written by another. The server rechecks live subscriptions
periodically and before delivery; room-membership changes trigger an immediate
recheck.

Auth-enabled `createApp()` reserves these topic families:

| Client topic | Rule | Internal namespace |
|---|---|---|
| `presence:<roomId>` | Current user must be a live room member; write/delete key must equal `user:<currentUserId>` | `room:<roomId>:presence` |
| `typing:<roomId>` | Same membership and key rule | `room:<roomId>:typing` |
| `user:<currentUserId>:<name>` | Must name the authenticated user | User-scoped namespace |

Other names are denied with `EPHEMERAL_TOPIC_UNCLASSIFIED` unless the app sets
`ephemeralPolicy`. App policy namespaces are automatically placed below an
`app:` internal prefix, so they cannot collide with reserved room or personal
state. Authless standalone plugins retain unrestricted legacy topics;
authenticated standalone plugins fail closed unless a policy is supplied.

### Bounds

| Input | Limit |
|---|---:|
| Client topic | 256 characters, no surrounding whitespace or control characters |
| Key | 256 characters, no control characters |
| JSON value | 65,536 UTF-8 bytes after serialization |
| TTL | Integer from 1 through 300,000 ms; default 30,000 ms |
| Live topics per socket | 64 |
| Policy namespace | 512 characters |
| Live entries per actor | 256 entries and 8 MiB |
| Live entries per internal namespace | 1,024 entries and 16 MiB |
| Live entries per app process | 4,096 entries and 64 MiB |

Aggregate limits apply even when a client writes without first subscribing.
Expired and deleted values release their capacity. A write that would exceed
one of these bounds fails without changing state.

### Stable errors

Denied and malformed operations receive an explicit error rather than a
silent ignore:

```json
{
  "type": "ephemeral.error",
  "operation": "subscribe",
  "code": "EPHEMERAL_FORBIDDEN",
  "message": "Room topic is not available",
  "topic": "presence:room_123",
  "revoked": true
}
```

`revoked: true` means a formerly valid subscription was removed. The server
also sends an empty snapshot for that topic; the official client purges its
cached entries. Stable codes are `EPHEMERAL_UNAUTHENTICATED`,
`EPHEMERAL_FORBIDDEN`, `EPHEMERAL_TOPIC_UNCLASSIFIED`,
`EPHEMERAL_POLICY_UNAVAILABLE`, `EPHEMERAL_POLICY_INVALID`,
`EPHEMERAL_INVALID_TOPIC`, `EPHEMERAL_INVALID_KEY`,
`EPHEMERAL_INVALID_TTL`, `EPHEMERAL_VALUE_TOO_LARGE`,
`EPHEMERAL_TOO_MANY_TOPICS`, `EPHEMERAL_CAPACITY_EXCEEDED`, and
`EPHEMERAL_KEY_NOT_OWNED`.

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

**Implementation:** The integer is allocated by the strict singleton
`_zero_sync_log_state` row and is database-wide for file-backed handles. The
application mutation, sequence increment, explicit-format `_changes` insert,
pruning-watermark advance, and physical prune commit in one transaction.
Sequences are never reused, including after an intentional history clear.
Retained pre-fence rows have a null format marker and decode only as legacy-v0;
new rows carry integer format `1`.

The cryptographically random `epoch` remains local to each ReactiveDB runtime.
An epoch change produces an authoritative replacement snapshot, so the current
WebSocket protocol does not use retained history to continue transparently
across a process restart. For file-mode plugins, each runtime polls the shared
durable `_changes` log. While polling is active, one dispatcher emits both local
and external rows exactly once in database sequence order; a synchronous local
drain first processes any lower remote sequence. If retention advances beyond
a runtime's cursor, or a retained row cannot be decoded, Zero closes its sockets
with `1012`; reconnect then receives an authoritative snapshot rather than a
discontinuous stream. This is a
shared-file multi-runtime boundary, not replication between separate SQLite
databases. `hot` and `ephemeral` databases remain process-local.

Snapshot rows and catch-up changes are paired with one cursor captured from the
same SQLite read transaction. The server uses that exact cursor for both the
wire payload and its per-socket state, so a concurrent commit is either
represented in the baseline or remains available as a later ordered change.

### Client Tracking

Each client tracks `lastSeq` — the highest sequence number it has processed:

```
Client connects          → lastSeq = 0
Receives sync.snapshot   → epoch = E1, scope = S1, lastSeq = 42
Receives sync.change     → verify prevSeq = 42, lastSeq = 43
Receives sync.change     → verify prevSeq = 43, lastSeq = 44
Disconnects...
Reconnects               → sync.auth → sync.auth.ready → sync.subscribe
                           { epoch:E1, scope:S1, lastSeq:44 }
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
  previous_data TEXT,    -- prior row for filtered DELETE/transition handling
  ts      INTEGER NOT NULL,
  origin  TEXT,          -- private writer-runtime identity
  format_version         -- no affinity/default; new writes use integer 1
);
```

Sequence `0` is a permanent immutable sentinel and is excluded from replay,
oldest-row checks, retention counts, pruning, and intentional clears. The
strict `_zero_sync_log_state` singleton stores the current sequence and
`prune_through`. Database triggers reject unversioned/future writes, row
replacement/update, deletion above the watermark, state regression, and
attempts to remove the sentinel.

**Ring buffer depth:** Configurable, default 1000 entries. When a new change would exceed the depth, the oldest entry is deleted:

```sql
UPDATE _zero_sync_log_state
SET prune_through = MAX(prune_through, seq - 1000);
DELETE FROM _changes
WHERE seq > 0
  AND seq <= (SELECT prune_through FROM _zero_sync_log_state);
```

This runs as part of the write transaction, so it's atomic with the change insertion.

**When the buffer is insufficient:**

If a reconnecting client's `lastSeq` is below `prune_through`, above the
current sequence, or cannot be matched to a complete contiguous retained
suffix, the server cannot replay incrementally. It sends a replacement
snapshot. The replacement invalidates omitted lazy caches as well as included
full tables, then preserves same-scope in-memory work. Already-attempted work
is rebased onto the snapshot without hiding its authoritative rows.

Depth `1000` is the default; choose it from the application's mutation rate and
expected offline window. It must be a positive safe integer.

### Change-log format compatibility

The first fence adoption is not a rolling upgrade. Stop all pre-fence runtimes,
workers, CLI/watch processes, and tests using the file and verify they are
gone. Then use SQLite's online backup API, or checkpoint WAL, close the SQLite
handle, copy the file, and verify the backup opens and passes
`PRAGMA integrity_check`. A plain main-file copy while writers are active is
not a consistent backup. Start one fence-aware process to install/validate the
log boundary, then start the others. Never roll a fenced database back to a
pre-fence binary. The sentinel blocks the released default startup clear, but
an already-running released writer—or one explicitly configured not to clear
history—cannot be made atomic after the fact.

Fence-aware readers accept retained legacy-v0 rows (`format_version IS NULL`)
and v1 rows. An unknown/non-integer version, invalid operation, corrupt JSON,
or sequence discontinuity emits no partial batch: the runtime treats it as an
authoritative gap, closes Sync sockets with `1012`, and requires a fresh
snapshot/reconnect. The gap is classified as `retention`, `continuity`, or
`format`. Authorization policy state derived from incremental change
observation is synchronously invalidated before reconnect is allowed; failure
to reset it makes the runtime permanently fail closed. A malformed durable
state/schema or other non-retryable log-read failure closes current and future
sockets until repair and process restart. Direct SQL mutation of the log or
its state is unsupported.

## Connection Lifecycle

Uses Bun's native WebSocket with per-socket data and status-checked direct
delivery. Table sync carries sequencing metadata; ephemeral delivery is direct
so recipient authorization can be revalidated. State Sync uses the same
ordered `onChange` dispatcher for local and file-replica events, excludes the
mutation-origin socket, and sends directly only to sockets whose exact state
principal and current authority are revalidated. State snapshots capture
`_user_state` rows and their internal cursor from one SQLite view, suppressing
later replay of already represented events.

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
  │── sync.auth { token } ──────→ │  Reverify token and current authority
  │←── sync.auth.ready ───────────│  Derive readable tables and row filters
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

After the replacement socket has completed the same `sync.auth` /
`sync.auth.ready` handshake shown above, `getChangesAfter(seq)` can return
`null`. That means the client's `lastSeq` has been pruned from the ring buffer,
so the server cannot replay incrementally. It sends `sync.snapshot` instead of
`sync.catchup` for the requested snapshot tables. The client clears all full
and lazy caches. It then installs included full-table rows and preserves
unresolved mutations when the opaque authorization scope is unchanged.
Already-attempted mutations remain metadata, not an overlay over the
replacement's authoritative state.

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

When the connection resumes, the client first sends `sync.auth`, waits for
`sync.auth.ready`, and only then sends `sync.subscribe` with its `epoch`,
`scope`, and `lastSeq`. It does not flush newly queued offline mutations until
a valid catchup or replacement baseline has been applied.

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
  │  └─ apply canonical row;      │                              │
  │     origin is only a hint     │                              │
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

**Client behavior after its mutation:**
- Applies every accepted `sync.change` as the server's canonical row state,
  whether `origin` is its connection ID or the empty string.
- Removes the optimistic mutation only when the matching `sync.ack.ref`
  arrives.
- Order between `sync.change` and `sync.ack` does not matter because they serve
  different purposes. A failed direct send closes the socket so reconnect
  replay supplies the canonical change with an empty origin hint.

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
| Identity anchors are still provisioning | Negative ack with `errorCode: 'SYNC_DATA_REALM_NOT_READY'`; optimistic state rolls back and the client follows the readiness API before a deliberate retry. |
| Identity projection is terminally unavailable | Negative ack with `errorCode: 'SYNC_DATA_REALM_UNAVAILABLE'`; optimistic state rolls back and automatic mutation retry stops. |
| Unknown table in `sync.subscribe` | Server subscribes to known tables, ignores unknown ones |
| WS connection drops | Client auto-reconnects with exponential backoff + jitter, sends `sync.auth`, waits for `sync.auth.ready`, then sends `sync.subscribe { epoch, scope, lastSeq }`. |
| Server restart | The new epoch makes every old cursor incomparable; clients receive an authoritative replacement snapshot. |
| Authorization scope changes while disconnected | Server sends `reset: 'purge'`; cached rows and queued mutations are removed before outbound work resumes. |
| Bun `send()` returns `0` | Server closes with `1013`; client reconnects from its last accepted cursor. |
| Retried mutation has no durable receipt | Server rejects it as outcome-unavailable; client keeps authoritative baseline state and does not duplicate the operation. |

## Delivery Model

Table changes use direct per-socket `send()` calls so Zero can observe Bun's
delivery status. `-1` means the message is queued under backpressure; the socket
is marked until `drain`. `0` means the message was dropped, so Zero immediately
closes the socket with `1013`. Incoming client frames remain capped at 1 MiB;
the outgoing queue ceiling is 16 MiB so a bounded State snapshot (under
12 MiB) fits without relaxing inbound request limits.

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

# ReactiveDB — Server-Side Design

SQLite wrapper that makes every write observable. Define a table, get prepared CRUD statements and change events for free. One instance per application.

## Overview

ReactiveDB is a thin layer over `bun:sqlite` that adds two things SQLite doesn't have natively:

1. **Change events** — every write emits a typed change object
2. **Sequence tracking** — every change gets a monotonic `seq` number for reconnect replay

Everything else is just SQLite, unchanged. Synchronous writes. Prepared statements. ACID transactions.

**Pattern source:** `src/persistence/sqlite-hot-store.ts` — the hot store prepares all statements in the constructor and uses them per-call. ReactiveDB extends this: statements are prepared per-table in `defineTable()`.

## `defineTable()`

The core API. Define a table schema, get full CRUD automatically.

```ts
const db = createReactiveDB({ mode: 'memory' });

db.defineTable('todos', {
  id:    'text primary key',
  title: 'text not null',
  done:  'integer default 0',
});
```

**What `defineTable()` does internally:**

1. Executes `CREATE TABLE IF NOT EXISTS` with the given schema
2. Prepares **all CRUD statements** for the table:
   - `INSERT OR REPLACE INTO todos (id, title, done) VALUES (?, ?, ?)`
   - `UPDATE todos SET title = ?, done = ? WHERE id = ?`
   - `DELETE FROM todos WHERE id = ?`
   - `SELECT * FROM todos WHERE id = ?`
   - `SELECT * FROM todos`
3. Stores the prepared statements in a per-table map
4. Records the table's column names and primary key for later use

```ts
// Internal structure
interface TableDef {
  name: string;
  columns: string[];              // ['id', 'title', 'done']
  primaryKey: string;             // 'id'
  stmts: {
    insert: Statement;
    update: Statement;
    delete: Statement;
    getOne: Statement;
    getAll: Statement;
  };
}
```

**Schema format:** Plain object mapping column names to SQLite column definitions. The first column ending with `primary key` is treated as the primary key. `_identity` is optional metadata, not a SQL column.

```ts
interface TableSchema {
  _identity?: string[];
  [column: string]: string | string[] | undefined;
}

// Examples:
{ id: 'text primary key', title: 'text not null', done: 'integer default 0' }
{ id: 'text primary key', name: 'text', email: 'text', role: 'text default "user"' }
{ id: 'text primary key', value: 'real not null', label: 'text' }
{
  membership_id: 'text primary key',
  team_id: 'text not null',
  user_id: 'text not null',
  _identity: ['team_id', 'user_id'],
}
```

No ORM. No migrations. No type mapping. The schema is the SQL. If you know SQLite column types, you know this.

## Natural Identity

ReactiveDB-managed sync tables use one string primary key. That keeps snapshots,
optimistic mutations, ack/rollback, and change replay fast and simple. For
tables that would normally use a composite primary key, declare `_identity`
instead:

```ts
db.defineTable('memberships', {
  membership_id: 'text primary key',
  team_id: 'text not null',
  user_id: 'text not null',
  role: 'text',
  _identity: ['team_id', 'user_id'],
});
```

ReactiveDB then:

1. Validates that identity fields are real columns and not the primary key.
2. Creates a unique SQLite index over the identity fields.
3. Generates a deterministic primary key when `insert()` receives a row without
   the sync primary key.
4. Prepares an identity lookup statement for `queryByIdentity()`,
   `upsertByIdentity()`, `updateByIdentity()`, and `deleteByIdentity()`.
5. Rejects identity field changes after insert.
6. Rejects plain `insert()` calls that would collide with another row's natural
   identity but a different sync primary key.

```ts
const change = db.insert('memberships', {
  team_id: 'team-1',
  user_id: 'user-1',
  role: 'admin',
});

const sameRow = db.queryByIdentity('memberships', {
  team_id: 'team-1',
  user_id: 'user-1',
});
```

Use `upsertByIdentity()` when the natural key is the app-level identifier:

```ts
db.upsertByIdentity('memberships', {
  team_id: 'team-1',
  user_id: 'user-1',
  role: 'member',
});
```

The sync primary key is still the row id used in websocket snapshots and change
events. Natural identity is an ergonomic layer on top; it is not a composite
primary key inside the sync protocol.

## Write Methods

Every write method follows the same pattern:

1. Execute the prepared statement
2. Increment the global `seq` counter
3. Insert into the `_changes` ring buffer
4. Emit change event to listeners

### `insert(table, row)`

```ts
db.insert('todos', { id: '1', title: 'Buy milk', done: 0 });
```

Executes the prepared INSERT statement. If the row already exists (same primary key), it replaces it (INSERT OR REPLACE behavior). Checks existence first to emit the correct op:

- Row **did not exist** → emits `op: 'INSERT'`
- Row **already existed** → emits `op: 'UPDATE'`

For natural-identity tables, `insert()` fills a missing sync primary key from
the identity fields. It also checks identity conflicts before SQLite runs
`INSERT OR REPLACE`, because SQLite would otherwise replace rows on the unique
identity index and silently change the sync row id.

Returns the `Change` object:

```ts
{
  seq: 43,
  table: 'todos',
  op: 'INSERT',  // or 'UPDATE' if PK already existed
  rowId: '1',
  row: { id: '1', title: 'Buy milk', done: 0 },
  ts: 1709500000000
}
```

### `update(table, id, partial)`

```ts
db.update('todos', '1', { done: 1 });
```

Reads the current row, merges the partial update, writes the full row. Returns a change with `op: 'UPDATE'` and the complete merged row.

**Why read-then-write?** So that `sync.change` always contains the full row. Clients receive complete state, not patches — this makes client-side reducers trivial (always replace the whole row).

### `delete(table, id)`

```ts
db.delete('todos', '1');
```

Executes the prepared DELETE statement. Returns a change with `op: 'DELETE'` and `row: null`.

### `query(table)` and `queryOne(table, id)`

Read-only methods. No change emission. Return plain row objects.

```ts
const all = db.query('todos');       // Row[]
const one = db.queryOne('todos', '1'); // Row | null
```

## Change Tracking

### The Change Type

```ts
interface Change {
  seq: number;                     // Global sequence number
  table: string;                   // Table name
  op: 'INSERT' | 'UPDATE' | 'DELETE';
  rowId: string;                   // Primary key value
  row: Record<string, unknown> | null;  // Full row (null for DELETE)
  ts: number;                      // Server timestamp (Date.now())
}
```

### Global Sequence Counter

A simple in-process integer, incremented atomically on every write:

```ts
private seq = 0;

private nextSeq(): number {
  return ++this.seq;
}
```

Not persisted to SQLite. On process restart, it resets to 0 and the process gets
a new random sync epoch. Clients compare the pair, so an old cursor can never
be mistaken for the new process even when both counters have the same value.

**Why not persist it?** The seq is only meaningful within its random epoch. On
restart, WebSockets reconnect and receive an authoritative replacement
snapshot. Durable mutation receipts separately resolve applied-but-unacked
writes without relying on the reset counter.

### Change Listeners

`onChange` is a method on ReactiveDB callable at any time after construction. It is not tied to WebSocket connections or any particular lifecycle stage. The sync plugin registers its listener in `onStart` — before any WebSocket connections arrive.

```ts
db.onChange((change: Change) => {
  // Sync plugin registers here to broadcast changes
});
```

Returns an unsubscribe function:

```ts
const unsub = db.onChange(listener);
// later:
unsub();
```

Listeners fire synchronously after every write, in registration order. For
transactions, listeners are called once per change, after the transaction
commits — not during. A complete committed batch is queued before delivery
begins, so a listener-triggered write follows the batch instead of interleaving
with it. Live delivery and durable `_changes` replay therefore observe the same
sequence order.

**Error isolation:** If a listener throws, the error is caught and logged — it does not propagate to the writer or prevent subsequent listeners from being called. The write has already committed to SQLite; a broken listener cannot roll it back. This matches the broadcast pattern in `src/server/session-orchestrator.ts` where a broken client connection doesn't fail the broadcast loop.

### Ring Buffer (`_changes` table)

Stores recent changes for reconnect replay:

```sql
CREATE TABLE IF NOT EXISTS _changes (
  seq     INTEGER PRIMARY KEY,
  tbl     TEXT NOT NULL,
  op      TEXT NOT NULL,
  row_id  TEXT NOT NULL,
  data    TEXT,
  ts      INTEGER NOT NULL
);
```

**Prepared statements** (created once in constructor):

```ts
private changeStmts: {
  insert: Statement;   // INSERT INTO _changes (seq, tbl, op, row_id, data, ts) VALUES (?, ?, ?, ?, ?, ?)
  prune: Statement;    // DELETE FROM _changes WHERE seq <= ?
  after: Statement;    // SELECT * FROM _changes WHERE seq > ? ORDER BY seq
  oldest: Statement;   // SELECT MIN(seq) AS min_seq FROM _changes
};
```

**Auto-pruning:** After each change insertion, prune entries beyond the configured depth. Both the insert and the prune run inside `db.transaction()` — a single atomic operation. No two-step process.

```ts
private recordChange(change: Change): void {
  this.db.transaction(() => {
    this.changeStmts.insert.run(
      change.seq, change.table, change.op, change.rowId,
      change.row ? JSON.stringify(change.row) : null,
      change.ts
    );
    // Prune: single atomic DELETE by range
    const cutoff = change.seq - this.ringBufferDepth;
    if (cutoff > 0) {
      this.changeStmts.prune.run(cutoff);
    }
  })();
}
```

The prune is a single `DELETE FROM _changes WHERE seq <= ?` — no two-step read-then-delete.

**Replay method:**

```ts
getChangesAfter(seq: number): Change[] | null {
  // Check if we can fulfill this request
  const oldest = this.changeStmts.oldest.get() as { min_seq: number } | null;
  if (!oldest || seq < oldest.min_seq - 1) {
    return null;  // Gap too large — caller should send snapshot
  }
  // Return all changes after the given seq
  return this.changeStmts.after.all(seq).map(row => ({
    seq: row.seq,
    table: row.tbl,
    op: row.op as Change['op'],
    rowId: row.row_id,
    row: row.data ? JSON.parse(row.data) : null,
    ts: row.ts,
  }));
}
```

Returns `null` when the gap is too large, signaling the caller (sync plugin) to send a full snapshot instead.

## Transactions

Batch multiple writes into a single atomic operation:

```ts
db.transaction(() => {
  db.insert('todos', { id: '1', title: 'First', done: 0 });
  db.insert('todos', { id: '2', title: 'Second', done: 0 });
  db.update('todos', '1', { done: 1 });
});
```

**Behavior:**
- All writes succeed or none do (SQLite ACID)
- Each domain write, durable sequence allocation, and `_changes` record commits
  in the same transaction
- Change listeners are **deferred** — accumulated during the transaction, fired after commit
- If the transaction fails, no changes are emitted and `seq` increments are rolled back
- The callback must be synchronous. Returning a Promise/thenable aborts the
  transaction, and its asynchronous continuation remains poisoned against
  later ReactiveDB mutation.

**Implementation pattern:** Same as `src/persistence/sqlite-hot-store.ts` `clearSession()` — uses `this.db.transaction()` from bun:sqlite:

```ts
transaction<T>(fn: () => T): T {
  const pendingChanges: Change[] = [];
  this.deferChanges = true;
  this.deferredChanges = pendingChanges;

  const result = this.db.transaction(() => {
    return fn();
  })();

  this.deferChanges = false;
  this.deferredChanges = null;

  // Emit all changes now that the transaction committed
  for (const change of pendingChanges) {
    this.emitChange(change);
  }

  return result;
}
```

## Configuration

```ts
interface ReactiveDBConfig {
  /** Storage mode. `memory` and `:memory:` are legacy aliases for ephemeral. */
  mode?: 'hot' | 'file' | 'ephemeral' | 'memory' | ':memory:' | string;

  /** File path for hot/file mode. Bare string `mode` values also mean file paths. */
  path?: string;

  /** Snapshot path for hot mode. */
  snapshotPath?: string;

  /** Existing platform SQLite service. Used by createApp() runtime wiring. */
  sqlite?: PlatformSQLiteService;

  /** Existing raw Bun SQLite handle. Caller owns PRAGMAs/lifecycle by default. */
  database?: Database;

  /** Ring buffer depth for reconnect replay (default: 1000) */
  ringBufferDepth?: number;
}
```

When `ReactiveDB` is mounted through `createApp()`, it does not decide the root
SQLite storage policy. `createApp()` creates the shared platform SQLite service
first, runs migrations against that handle, then injects the service into
ReactiveDB. App-owned backend routes can use the same foundation through
`zero.sql`/`zero.sqlite` without opening a second database.

Standalone `createReactiveDB()` calls remain supported for tests and low-level
sync usage. Legacy `{ mode: 'memory' }` maps to `ephemeral`; `{ mode:
'./data/app.db' }` remains a file/WAL shortcut; new durable in-memory apps
should use `{ mode: 'hot', path: './data/app.db', snapshotPath:
'./data/app.snapshot.db' }`.

### PRAGMA Stack

The platform SQLite foundation applies the PRAGMA stack according to storage
mode:

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA cache_size = -64000;        -- 64MB page cache
PRAGMA mmap_size = 268435456;      -- 256MB memory-mapped I/O
PRAGMA temp_store = MEMORY;
PRAGMA wal_autocheckpoint = 1000;
```

**For ephemeral/hot modes:** active pages are in process memory. Hot mode adds
snapshot recovery on interval/shutdown.

**For file mode:** WAL gives concurrent reads during writes, NORMAL sync
balances durability with speed, large cache and mmap keep hot data in memory.

## System Tables

ReactiveDB creates one internal table (prefixed with `_` to distinguish from user tables):

| Table | Purpose |
|-------|---------|
| `_changes` | Ring buffer for reconnect replay (see above) |

User-defined tables via `defineTable()` must not start with `_`.

**On startup (durable mode):** The `_changes` table is truncated (`DELETE FROM _changes`). Stale entries from a previous process have seq numbers that would collide with the new counter (which starts at 0). Since all clients must reconnect after a restart (WebSocket drops), they all get fresh snapshots — the ring buffer is only useful within a single process lifetime.

## Lifecycle

```ts
// Create
const db = createReactiveDB({ mode: 'memory' });

// Define tables (can be called multiple times, idempotent)
db.defineTable('todos', { ... });
db.defineTable('users', { ... });

// Register change listener (sync plugin does this)
const unsub = db.onChange((change) => { ... });

// Use
db.insert('todos', { ... });
db.update('todos', '1', { ... });
db.query('todos');

// Cleanup
unsub();
db.dispose();  // Closes only handles ReactiveDB owns
```

`dispose()` closes SQLite only when ReactiveDB created the platform SQLite
service or was explicitly told to own an injected raw database. When `createApp()`
injects the shared service, app/plugin lifecycle owns shutdown. After disposal,
all methods throw. The sync plugin calls this in `onStop`.

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Insert with duplicate PK | INSERT OR REPLACE — overwrites existing row, emits `op: 'UPDATE'` |
| Update non-existent row | No-op, returns null (no change emitted) |
| Delete non-existent row | No-op, returns null (no change emitted) |
| `defineTable` called twice | Idempotent — `CREATE TABLE IF NOT EXISTS` + re-prepares statements |
| Write after `dispose()` | Throws `Error('ReactiveDB is disposed')` |
| Invalid column in row | SQLite constraint error propagates — caller (sync plugin WS handler) catches and sends `sync.ack { ok: false }` |

## Performance Characteristics

For the target use case (2–4 users, thousands of rows):

| Operation | Expected latency |
|-----------|-----------------|
| Single insert (`:memory:`) | < 1 μs |
| Single insert (WAL file) | < 10 μs |
| Query all rows (1000 rows) | < 100 μs |
| Transaction (10 writes) | < 10 μs (`:memory:`), < 100 μs (WAL) |
| Ring buffer prune | < 10 μs (single DELETE by range) |

All operations are synchronous. No event loop yielding. No async overhead. This is the same performance profile as `src/persistence/sqlite-hot-store.ts`, which handles real-time session data at sub-millisecond latency.

# ReactiveDB — Server-Side Design

SQLite wrapper that makes every write observable. Define a table, get prepared CRUD statements and change events for free. One instance per application.

## Overview

ReactiveDB is a thin layer over `bun:sqlite` that adds two things SQLite doesn't have natively:

1. **Change events** — every write emits a typed change object
2. **Sequence tracking** — every change gets a monotonic `seq` number for reconnect replay

Everything else is just SQLite, unchanged. Synchronous writes. Prepared statements. ACID transactions.

ReactiveDB prepares per-table CRUD statements in `defineTable()` and reuses
them. The lower persistence layer provides the SQLite runtime and shared
statement-cache primitives under `src/persistence/`.

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

1. Executes `CREATE TABLE IF NOT EXISTS` in SQLite's `main` schema
2. Prepares **all CRUD statements** for the table:
   - `INSERT OR ABORT ... ON CONFLICT (id) DO UPDATE ...`
   - `UPDATE OR ABORT todos SET title = ?, done = ? WHERE id = ?`
   - `DELETE FROM todos WHERE id = ?`
   - `SELECT * FROM todos WHERE id = ?`
   - `SELECT * FROM todos`
3. Stores the prepared statements in a per-table map
4. Records the table's column names and primary key for later use

The table DDL, foreign-key safety inspection, natural-identity index, registered
SQLite structure, and new prepared-statement set form one immediate SQLite
schema-definition boundary. The registered structure records the main object
kind, normalized stored `CREATE TABLE` definition, column/default/primary-key
metadata, STRICT/WITHOUT ROWID flags, and primary-key index order and
collation. Recording the stored definition also fences non-primary-key
collations, `CHECK` clauses, and other constraints that SQLite's column PRAGMAs
do not expose. If any step fails, SQLite rolls back the schema work and
ReactiveDB finalizes every newly prepared statement. A
successful redefinition swaps the complete statement set and structure before
finalizing the previous statements. `defineTable()` therefore cannot run
inside `db.transaction()`; run migrations before registration, then define or
redefine schemas outside managed application-write transactions.

ReactiveDB qualifies managed table DDL, reads, writes, and internal State
storage against `main`. A connection-local `TEMP` table with the same name
therefore cannot redirect an application mutation or its durable change event
into a different schema.

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

**Schema format:** Plain object mapping column names to isolated SQLite column
definitions. Exactly one column must declare a top-level `PRIMARY KEY`
constraint. `_identity` is optional metadata, not a SQL column.

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

No ORM. No type mapping. Each value is one SQLite column definition, not a
free-form table fragment: top-level commas or semicolons, table constraints,
unbalanced grouping, ambiguous quoted multi-token declared types, and
unterminated quotes or comments fail closed. Commas inside balanced expressions
and quoted literals remain valid. Use the realm migration registry for schema
changes after deployment.

One constraint is deliberate: a tracked table cannot declare `CASCADE`,
`SET NULL`, or `SET DEFAULT` foreign-key actions. Those actions can mutate a
second tracked row without a corresponding change event. Spell dependent
writes out through `db.transaction()` instead; `NO ACTION` and `RESTRICT`
remain supported. ReactiveDB rechecks this rule and the registered table
structure after every committed main-schema version change, so recreating a
registered table behind its prepared statements cannot silently add a cascade
or change its stored definition, column, constraint, collation, or primary-key
contract.

## Natural Identity

ReactiveDB-managed sync tables use one single-column primary key with declared
SQLite `TEXT` or `INTEGER` affinity. `TEXT` is recommended, and Zero's default
generated sync key uses it. An explicitly numeric `INTEGER` key must remain a
JavaScript safe integer;
Zero canonicalizes it to the same string row-id shape used by snapshots,
optimistic mutations, acknowledgements, rollback, and change replay. `REAL`,
`BLOB`, `NUMERIC`, and typeless primary keys are rejected. For tables that
would normally use a composite primary key, declare `_identity` instead:

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

1. Begin an immediate SQLite transaction, or join the caller's existing transaction
2. Execute the application-row mutation
3. Atomically allocate the next database-wide `seq` from
   `_zero_sync_log_state`
4. Insert an explicitly versioned row and advance/prune through the durable
   watermark in `_changes`
5. Commit, then notify listeners directly or wake the ordered durable-log drain

The application row, sequence allocation, and change record succeed or roll
back together. Two file-backed connections therefore cannot allocate the same
sequence number.

When shared-file polling is active, local commits do not bypass the retained
log. They synchronously wake the same dispatcher used for external commits, so
an unseen remote sequence `N` is delivered before a local sequence `N+1`.

### `insert(table, row)`

```ts
db.insert('todos', { id: '1', title: 'Buy milk', done: 0 });
```

Executes a primary-key-targeted upsert. If the row already exists under the
primary key's real SQLite collation/affinity, that exact row receives
replacement-style values and the write emits the correct operation:

- Row **did not exist** → emits `op: 'INSERT'`
- Row **already existed** → emits `op: 'UPDATE'`

For natural-identity tables, `insert()` fills a missing sync primary key from
the identity fields. Every managed insert and update uses statement-level
`ABORT`, so schema-declared `IGNORE` or `REPLACE` policies cannot silently
discard a write or delete a different row through another unique constraint.
Only the named primary-key conflict becomes an update.

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

`rowId` always comes from the persisted row, not the caller's spelling. A
`NOCASE` text key or normalized integer key therefore has one stable identity
across insert, replay, update, and delete.

Tracked row snapshots must be lossless JSON objects. SQLite BLOB values,
non-finite numbers, `Date`, `undefined`, and other values whose JSON wire form
would differ are rejected before commit. Local listeners and durable replay
then observe the exact same canonical payload.

### `update(table, id, partial)`

```ts
db.update('todos', '1', { done: 1 });
```

Reads the current row, merges the partial update, writes the full row. Returns a change with `op: 'UPDATE'` and the complete merged row.

**Why read-then-write?** So that `sync.change` always contains the full row. Clients receive complete state, not patches — this makes client-side reducers trivial (always replace the whole row).

### Exact scoped and optimistic writes

`getScoped()`, `updateScoped()`, and `deleteScoped()` treat the trusted scope as
an authorization boundary, not as an ordinary SQLite lookup. Scope equality
must match in JavaScript and in SQL by both SQLite storage class and `BINARY`
comparison. A `NOCASE` declaration therefore cannot make `TenantA` authorize
`tenanta`, and column affinity cannot make text `'1'` authorize numeric `1`.

`updateIfCurrent()` and `deleteIfCurrent()`, plus the optional expected-row
snapshots on scoped writes, use the same exact contract for every non-primary-
key expected field. ReactiveDB first compares the already-read row to the
authorized snapshot without SQLite coercion, then repeats storage-class and
`BINARY` predicates in the atomic write statement. A case-only or type-only
change is stale authorization and rolls back without a change-log row or
listener delivery. Primary-key lookup retains SQLite's registered key
semantics; persisted primary-key postconditions still determine the canonical
row identity.

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

Managed CRUD derives `rowId` from the persisted primary key as a canonical
string using SQLite's real affinity and collation result. Platform code calling
`recordInternalChange()` must supply a non-empty string directly; numbers and
other values are rejected instead of being coerced.

### Database-Owned Sequence Counter

A singleton SQLite row is incremented inside the same immediate transaction as
every tracked application write:

```ts
private nextSeq(): number {
  return this.changeStmts.allocate.get().seq;
}
```

The allocator is durable and database-wide, so file-backed runtime replicas
cannot collide or reuse a retained sequence. The random runtime epoch still
forces an authoritative replacement when a client reconnects to a different
process; the durable counter also orders live fanout between processes sharing
that SQLite file.

### Change Listeners

`onChange` is a method on ReactiveDB callable at any time after construction. It is not tied to WebSocket connections or any particular lifecycle stage. The sync plugin registers its listener in `onStart` — before any WebSocket connections arrive.

```ts
db.onChange((change: Change, delivery: ChangeDeliveryMetadata) => {
  // Sync plugin registers here to broadcast changes
  // delivery.source is 'local' or 'external'
});
```

Returns an unsubscribe function:

```ts
const unsub = db.onChange(listener);
// later:
unsub();
```

Without replica polling, listeners fire synchronously after every local write,
in registration order. For transactions, ReactiveDB queues the complete
committed batch before it calls the first listener. A listener-triggered write
is appended after that complete batch, so every listener observes the original
batch before the reentrant change. For each change, ReactiveDB snapshots the
registered listener set: subscribing or unsubscribing during a callback affects
later changes, not the current dispatch set.

Listeners are synchronous callbacks. Every invocation receives its own copy of
the canonical `Change` payload—including deep copies of `row` and
`previousRow`—and its own delivery-metadata object. Mutating either object
cannot alter durable history, the write's returned `Change`, or what another
listener receives. A returned Promise or other thenable is a contract error;
ReactiveDB consumes a later rejection and reports the synchronous-listener
failure without awaiting it.

With replica polling active, one ordered dispatcher owns listener delivery for
both local and external rows. Local commits wake it synchronously;
`delivery.source` preserves process-local mutation-origin handling without
persisting connection IDs in SQLite.

**Error isolation:** If a listener throws or returns a thenable, the error is
caught and reported by `ReactiveDB.emitChange()` in `src/sync/reactive-db.ts`;
it does not propagate to the writer or prevent subsequent listeners from being
called. The write has already committed to SQLite, so a broken listener cannot
roll it back. Managed `createApp()`/`createSyncPlugin()` runtimes route these
codes through that app's own observability runtime, so two Zero apps in one
process cannot capture each other's callback failures. A direct standalone
`createReactiveDB()` retains the historical process-wide emitter unless the
caller supplies `emitCode` explicitly.

### Ring Buffer (`_changes` table)

Stores recent changes for reconnect replay:

```sql
CREATE TABLE IF NOT EXISTS _changes (
  seq     INTEGER PRIMARY KEY,
  tbl     TEXT NOT NULL,
  op      TEXT NOT NULL,
  row_id  TEXT NOT NULL,
  data    TEXT,
  previous_data TEXT,
  ts      INTEGER NOT NULL,
  origin  TEXT,
  format_version -- intentionally no affinity/default
);

CREATE TABLE _zero_sync_log_state (
  singleton         INTEGER PRIMARY KEY CHECK (singleton = 1),
  schema_version    INTEGER NOT NULL,
  write_format      INTEGER NOT NULL,
  min_reader_format INTEGER NOT NULL,
  seq               INTEGER NOT NULL CHECK (
    seq >= 0 AND seq <= 9007199254740991
  ),
  prune_through     INTEGER NOT NULL CHECK (
    prune_through >= 0 AND prune_through <= seq
  )
) STRICT;
```

`seq = 0` is a permanent structural sentinel, never a user change. Positive
rows are replay history. Retained pre-fence rows keep
`format_version IS NULL` and decode as legacy-v0; every new write supplies
integer format `1` explicitly. The format column has no SQLite affinity, so a
text value such as `'1'` cannot be coerced past the trigger fence. Readers also
check SQLite's storage class, so a numerically equal `REAL 1.0` is not accepted
as the integer v1 format.

The log schema is an exact compatibility boundary. Startup rejects alternate
collations, `AUTOINCREMENT`, every index or unique constraint on `_changes`,
and any extra trigger attached to the log, state, or legacy allocator tables.
Every outer managed write transaction repeats that ownership fence while its
`BEGIN IMMEDIATE` lock is held whenever either the main or temporary SQLite
schema version has changed. The audit compares the complete expected trigger
set and rejects main-schema or temporary triggers that target a protected log
table, including targets written with different SQL identifier casing. Main
schema changes also revalidate every registered table's normalized stored
`CREATE TABLE` definition, exact structural contract, and nonmutating foreign-
key actions before application DML runs.

A final schema-version check repeats the audit for DDL performed inside the
managed transaction. DDL-only application/auth installers and exact-definition-
compatible table rebuilds remain supported, as do tracked writes in later
transactions. A single transaction may not combine any main or temporary DDL
with tracked changes. That separation prevents an unsafe trigger or cascade
from being created, used to mutate an unlogged row, and removed before the
final audit. The cached versions advance only after commit. Every internal
insert must affect exactly one row, so conflict handlers or custom triggers
cannot silently suppress a log record while allowing its application write to
commit.

**Prepared statements** (created once in constructor):

```ts
private changeStmts: {
  allocate: Statement;     // monotonic state.seq + 1 ... RETURNING seq
  current: Statement;      // SELECT durable log state
  insert: Statement;       // explicit format_version = 1 ... RETURNING seq
  advancePrune: Statement; // monotonic prune_through advance
  prune: Statement;        // DELETE positive rows through watermark
  unprunedThrough: Statement; // prove no positive row remains through watermark
  after: Statement;        // SELECT positive rows after cursor
  oldest: Statement;       // MIN positive seq
  mainSchemaVersion: Statement; // PRAGMA main.schema_version
  tempSchemaVersion: Statement; // PRAGMA temp.schema_version
};
```

**Auto-pruning:** After each change insertion, prune entries beyond the
configured depth. The application mutation, sequence allocation, change
insert, and prune all run in one immediate transaction.

```ts
this.db.transaction(() => {
  mutateApplicationRow();
  const { seq } = this.changeStmts.allocate.get();
  const beforeInsert = this.changeStmts.current.get();
  const inserted = this.changeStmts.insert.get(
    seq, table, op, rowId, data, previousData, ts, origin, 1,
  );
  assert(inserted?.seq === seq);
  const afterInsert = this.changeStmts.current.get();
  assert(afterInsert.seq === beforeInsert.seq);
  assert(afterInsert.prune_through === beforeInsert.prune_through);
  const cutoff = seq - this.ringBufferDepth;
  if (cutoff > 0) {
    const expected = Math.max(afterInsert.prune_through, cutoff);
    this.changeStmts.advancePrune.run(cutoff);
    const after = this.changeStmts.current.get();
    assert(after.seq === seq && after.prune_through === expected);
    this.changeStmts.prune.run(after.prune_through);
    const afterPrune = this.changeStmts.current.get();
    assert(afterPrune.seq === seq && afterPrune.prune_through === expected);
    assert(!this.changeStmts.unprunedThrough.get(after.prune_through));
  }
}).immediate();
```

The watermark advance and physical delete commit together. Database triggers
allow deletion only for positive rows at or below `prune_through`; the sentinel
is unconditionally immutable. ReactiveDB also verifies exact postconditions:
the log insert must return the allocated sequence, durable state must remain
identical across the insert, the watermark must become exactly the expected
value (neither remain behind nor jump ahead), state must remain exact across
the physical prune, and no positive retained row may remain at or below it. A
suppressed target statement, custom-trigger side effect, or failed
postcondition rolls back the application mutation, log state, log row,
watermark, prune, and trigger side effects together. A crash cannot leave a
global delete guard open.

**Replay method:**

```ts
getChangesAfter(seq: number): Change[] | null {
  // State and rows come from one SQLite read snapshot.
  const { state, rows } = readChangeLogSnapshot(seq);
  if (seq < state.prune_through || seq > state.seq) return null;
  // Require the complete contiguous seq+1..state.seq suffix, then decode the
  // whole batch before exposing any row.
  return decodeCompleteBatch(rows);
}
```

Negative, fractional, `NaN`, and unsafe cursors are rejected. Once any history
has been pruned, `getChangesAfter(0)` returns `null` instead of pretending the
remaining suffix is complete. Unknown formats, invalid operations, malformed
JSON, and continuity gaps fail closed.

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
- Each write increments `seq` and records in `_changes` normally
- Change listeners are **deferred** — the complete committed batch is queued,
  then fired in sequence and registration order after commit
- If the transaction fails, no changes are emitted and `seq` increments are rolled back
- The callback must be synchronous; a returned Promise throws and its async
  continuation is barred from later ReactiveDB access
- Any managed mutation failure marks the surrounding transaction rollback-only.
  Catching that error inside the callback cannot commit other application DML;
  put independently recoverable work in a separate transaction instead.

The implementation uses Bun SQLite's `BEGIN IMMEDIATE` transaction form so
concurrent file-backed writers serialize before evaluating and mutating rows.
Sequence allocation is a normal database update in that transaction, so
SQLite rolls it back with the application writes. Change delivery remains
deferred until after commit; an enabled shared-log dispatcher then emits every
retained sequence exactly once and in order.

```ts
transaction<T>(fn: () => T): T {
  const pendingChanges: Change[] = [];
  this.deferredChanges = pendingChanges;

  const result = this.db.transaction(() => {
    return fn();
  }).immediate();

  this.deferredChanges = null;

  if (this.externalChangeDispatcher) {
    this.externalChangeDispatcher.drain();
  } else {
    for (const change of pendingChanges) {
      this.emitChange(change, { source: 'local' });
    }
  }

  return result;
}
```

### Consistent Snapshot Reads

`readAtCurrentSequence()` returns application data and the durable sequence
that represents it from one deferred SQLite read transaction:

```ts
const { value: rows, seq } = db.readAtCurrentSequence(() => db.query('todos'));
```

The reader must be synchronous. Returning a Promise or any thenable throws
immediately, the returned thenable's later rejection is consumed, and the
reader's asynchronous execution context remains poisoned. An awaited
continuation from that rejected reader cannot later read from or write through
ReactiveDB. This prevents work that has escaped the SQLite snapshot from being
mistaken for part of the captured `seq`.

The reader is also read-only through every managed ReactiveDB surface.
Transactions and CRUD writes, `defineTable()`, `recordInternalChange()`, and
`dispose()` are rejected. The active execution becomes rollback-only even when
reader code catches that rejection, so an enclosing managed write transaction
cannot commit an application row or durable change beside a false snapshot.
Nested snapshot reads are allowed and share the same SQLite snapshot/cursor.
`exec()` and `prepare()` remain explicit trusted raw-SQL escape hatches; code
using them is responsible for preserving this invariant and must not mutate
inside a snapshot reader.

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

  /**
   * Clear retained replay rows without reusing the monotonic sequence.
   * Use only during coordinated stop-all maintenance. Default: false.
   */
  clearChangesOnStart?: boolean;

  /** Ring buffer depth for reconnect replay (default: 1000) */
  ringBufferDepth?: number;

  /**
   * App-local platform-code emitter. Managed composition injects this;
   * standalone construction falls back to the process-wide emitter.
   */
  emitCode?: ReactiveDBPlatformCodeEmitter;
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

The platform SQLite foundation applies common defaults and then a mode-specific
stack. Unless configuration overrides them, every mode uses a 256 MiB page
cache (`cache_size = -262144`), 4 KiB pages, memory-backed temporary storage,
foreign keys, a 5-second busy timeout, and `PRAGMA optimize`.

| Mode | Journal/durability | File-only tuning | Persistence boundary |
| --- | --- | --- | --- |
| `file` | `journal_mode = WAL`, `synchronous = NORMAL` | 1 GiB mmap, WAL autocheckpoint every 1,000 pages, 64 MiB journal-size limit | Writes remain in the configured SQLite file; shutdown checkpoints WAL. |
| `hot` | Active database uses `journal_mode = MEMORY`, `synchronous = OFF` | No mmap or WAL autocheckpoint on the active in-memory handle | Loads a file/snapshot into memory and writes configured snapshots on interval/shutdown. |
| `ephemeral` | `journal_mode = MEMORY`, `synchronous = OFF` | No mmap or WAL autocheckpoint | Process memory only; restart discards the database. |

`mmapSize`, `walAutocheckpoint`, and `synchronous` therefore configure file
mode. Hot-mode source-file opening briefly coordinates WAL/checkpoint state so
it can deserialize a consistent image, but the running hot database still uses
the memory-mode PRAGMAs. See `src/persistence/storage-config.ts` and
`src/persistence/sqlite-connection.ts` for the exact normalized contract.

## System Tables

ReactiveDB owns these internal objects:

| Table | Purpose |
|-------|---------|
| `_changes` | Versioned replay/fanout log; reserved seq `0` is the downgrade sentinel and positive rows are changes |
| `_zero_sync_log_state` | Strict singleton containing format versions, the monotonic sequence, and the pruning watermark |
| `_change_sequence` | Pre-fence compatibility object read once during first adoption, then permanently poisoned so legacy allocator writes fail |

`defineTable()` permits `_`-prefixed tables for platform internals; the sync
plugin excludes them from client publication.

Platform subsystems that mutate an internal table through raw SQL can pair that
write with `recordInternalChange()` only inside the same active ReactiveDB
transaction. The method accepts only eligible underscore-prefixed internal
tables, requires a non-empty string `rowId`, and validates canonical v1
`row`/`previousRow` shapes before recording the change.

**On startup:** Change history is retained by default. The first fenced open
validates a contiguous legacy suffix, preserves those rows as legacy-v0,
creates the state singleton and sentinel, and installs versioned immutable-log
triggers in one `BEGIN IMMEDIATE` transaction. Every later open validates the
state, sentinel, retained suffix, and exact trigger definitions before it
prepares a writer. Later managed writes use cached main/temp schema versions to
avoid unnecessary catalog scans, but any schema change forces the same exact
protected-trigger audit and, for main DDL, registered-table/FK audit inside the
write lock before the transaction may commit.

`clearChangesOnStart: true` advances `prune_through` to the current sequence
and deletes only positive retained rows. It does **not** reset the sequence.
Use it only after every runtime sharing the file has stopped. A cursor below
the watermark receives a snapshot; a cursor at the current sequence remains
up to date.

Direct SQL must not insert, update, replace, or delete `_changes`,
`_zero_sync_log_state`, or `_change_sequence`. Stable trigger failures begin
with `ZERO_SYNC_LOG_`; recovery is to stop all processes, restore/inspect a
backup, and reopen with the same fence-aware Zero version—not to drop the
triggers.

### Multi-process boundary

Multiple file-backed ReactiveDB connections can commit tracked writes without
sequence collisions. `startExternalChangePolling()` makes the retained
`_changes` log the sole ordered `onChange` source for that runtime. It delivers
both local and external rows in strict sequence order; a local commit
synchronously drains any lower pending external row first. `createSyncPlugin()`
enables this automatically for file mode at a 250 ms cadence;
direct/injected compositions may opt in with
`replicaChangePolling: { intervalMs }`, or set it to `false` for an intentional
single-owner file.

#### First fenced upgrade and mixed versions

The first upgrade from a pre-fence Zero release is a coordinated stop-all
operation. Stop every app/runtime/worker/watch process that can use the file
and verify none remains. Then take a consistent backup with SQLite's online
backup API, or checkpoint WAL, close that SQLite handle, copy the database,
and verify the copy opens and passes `PRAGMA integrity_check`. Start one
fence-aware process so it can install and validate the boundary, then start the
remaining fence-aware processes. Do not run or roll back to a pre-fence binary
against the upgraded file. Never make a main-file-only copy while writers are
active: committed pages may still exist only in the WAL.

The seq-0 sentinel makes the released default constructor fail before serving
because that constructor tries `DELETE FROM _changes`. It is defense in depth,
not a rolling-upgrade mechanism: a released process explicitly configured with
`clearChangesOnStart: false` mutates an application row before its separate log
write and cannot be made atomic retroactively. That is why the initial stop-all
step is mandatory.

After the baseline is installed, fence-aware writers put the application row,
sequence allocation, versioned log insert, watermark advance, and prune in one
transaction. An incompatible insert raises `ROLLBACK`, so the application row
cannot commit alone. The log insert uses `RETURNING seq` and requires the exact
allocated sequence, so a later trigger cannot hide a suppressed target insert
behind unrelated trigger-side effects. Future format changes must first deploy readers that
understand both formats everywhere and confirm every old-format-only process
has drained. Only then may writers advance `write_format`; advance
`min_reader_format` and remove legacy decoding in a later release.

Polling starts at the runtime's current durable sequence because no sockets can
exist before plugin startup. Every returned sequence is checked for continuity.
The runtime also remembers its trusted sequence and pruning watermark: either
value moving backward is fatal rather than a recoverable history gap, because
resuming could reuse a sequence or reinterpret already-pruned history.
Rows are fully deserialized before the dispatcher advances or emits the batch.
Gap metadata distinguishes `retention`, `continuity`, and `format`, and includes
the previous, oldest retained, and current cursors. A standalone
`startExternalChangePolling()` consumer must handle `onGap` synchronously. A
missing or throwing handler permanently invalidates that ReactiveDB runtime
instead of advancing past unseen history.

The Sync plugin's handler first synchronously resets any authorization-policy
state derived from `observeChange`, then closes current sockets with `1012`.
Reconnect receives a full snapshot. A stateful `SyncResourcePolicyAdapter`
must implement synchronous `onHistoryGap`; expensive rebuilding should remain
lazy in the next access-resolution call. A missing, throwing, or Promise-
returning reset is unsafe and permanently invalidates the runtime. Non-
retryable state/schema/log read failures do the same, close sockets in every
phase (including pending auth), and refuse future sockets until the process is
restarted after repair. Only SQLite busy/locked failures retain the cursor for
retry. `observeChange`, row filters, and row projectors are authorization-state
code too: a throw or Promise-returning observer latches the same fatal state
instead of silently skipping one ordered authorization event.
The retained writer `origin` supplies process-local `delivery.source` metadata;
it is not exposed as a socket mutation origin.

Live socket attribution is separate process-local metadata. Zero consumes a
one-shot origin at outer transaction entry, binds it to every committed
sequence in that batch, and removes it after synchronous listener delivery (or
rollback, handled gap advancement, runtime invalidation, or disposal). This
keeps reentrant writes originless, preserves exact attribution when a local row
waits behind an active replica drain, and prevents external/replayed rows from
inheriting a stale connection ID.

Snapshot rows and catch-up history are read with exactly one cursor from one
deferred SQLite read transaction. The same captured cursor is used in the wire
message and `socket.lastSeq`, so a concurrent writer cannot be omitted while
advancing the client past it. A newly subscribed socket also ignores dispatcher
rows at or below the baseline cursor because those rows are already represented.

The `syncEpoch` remains runtime-local. Moving a client between runtimes therefore
causes a safe replacement snapshot rather than transparent cursor continuation.
The supported topology is multiple runtimes sharing one file-mode SQLite
database and the same ring-buffer policy. `hot` and `ephemeral` modes keep active
pages in process memory, and separate databases or cross-host ephemeral-topic
fanout still require an external coordination layer. Direct raw SQL that bypasses
ReactiveDB is trusted server code and does not create a tracked change row.
For the same reason, custom SQLite triggers must not mutate another tracked
row. Use explicit ReactiveDB writes in one synchronous transaction. Target-row
postconditions fail and roll back suppressed, deleted, scope-escaped, or
recreated writes, but Zero does not invent change events for arbitrary raw
trigger side effects.

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
| Insert with duplicate PK | PK-targeted upsert updates that row and emits `op: 'UPDATE'`; every other uniqueness conflict aborts |
| Update non-existent row | No-op, returns null (no change emitted) |
| Delete non-existent row | No-op, returns null (no change emitted) |
| Mutating foreign-key action | `defineTable()` and later schema-version audits reject it; use explicit tracked writes in one transaction |
| Registered table definition/object/column/constraint/collation/primary-key drift | The next managed write rejects the changed schema before application DML; repair/migrate and re-register the table |
| Case- or type-coerced scope/expected-row match | Rejected as unauthorized/stale; scoped reads return `null`, writes roll back without log/listener effects |
| DDL plus a tracked change in one transaction | Rolls back both; keep schema installers and tracked writes in separate transactions |
| `defineTable()` inside a managed transaction | Throws before schema work; define schemas outside application-write transactions |
| Async transaction callback | Throws and rolls back; later awaited ReactiveDB work in that callback remains poisoned |
| Async snapshot reader | Throws; the thenable rejection is consumed and later ReactiveDB access in its continuation remains poisoned |
| Managed write/schema/dispose inside a snapshot reader | Throws and poisons the active transaction even when the inner error is caught |
| Async/thenable change listener | Reported as a listener failure and not awaited; its rejection is consumed and later listeners still run |
| Managed mutation error caught by the callback | The outer transaction remains rollback-only and throws instead of committing partial application DML |
| Lossy/non-JSON change payload | Throws and rolls back before listener delivery |
| `defineTable` called twice | Idempotent — `CREATE TABLE IF NOT EXISTS` + re-prepares statements |
| Write after `dispose()` | Throws `Error('ReactiveDB is disposed')` |
| Invalid column in row | SQLite constraint error propagates — caller (sync plugin WS handler) catches and sends `sync.ack { ok: false }` |

## Performance Characteristics

ReactiveDB operations are synchronous and reuse prepared statements for their
normal CRUD paths. Actual latency depends on Bun/SQLite versions, database
mode, durability settings, hardware, row shape, indexes, transaction size, and
concurrent workload. Treat the small-team sizing guidance as a product target,
not a microsecond guarantee; benchmark the intended schema and persistence mode
on production-like hardware before setting capacity or latency objectives.

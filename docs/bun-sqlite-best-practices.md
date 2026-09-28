# bun:sqlite Best Practices

**Applies to**: `src/persistence/`, `src/server/queue/`, `src/workflows/`, `src/auth/`
**Runtime**: Bun only (synchronous, in-process SQLite via `bun:sqlite`)

## Type Declarations

### `bun-types` requires 2 type arguments

The `@types/bun` package (`bun-types`) declares `prepare()` and `Statement` with **two required type arguments**:

```ts
// bun-types signature (no defaults on ParamsType)
prepare<ReturnType, ParamsType extends SQLQueryBindings | SQLQueryBindings[]>(
  sql: string,
  params?: ParamsType,
): Statement<ReturnType, ParamsType extends any[] ? ParamsType : [ParamsType]>;

class Statement<ReturnType = unknown, ParamsType extends SQLQueryBindings[] = any[]> { ... }
```

### Correct usage

```ts
// Positional params (?)
const stmt = db.prepare<UserRow, any>('SELECT * FROM users WHERE id = ?');
const user = stmt.get('user-123');

// Named params ($param)
const stmt = db.prepare<UserRow, any>('SELECT * FROM users WHERE id = $id');
const user = stmt.get({ $id: 'user-123' });

// No params
const stmt = db.prepare<CountRow, any>('SELECT COUNT(*) as count FROM users');
const result = stmt.get();
```

### Statement type annotations

Use `any[]` for the params type in class properties — it matches `bun-types`' default:

```ts
private stmts: {
  getUser: Statement<UserRow, any[]>;
  insertUser: Statement<Record<string, unknown>, any[]>;
};
```

### Dynamic query params

When building dynamic WHERE clauses with spread params, type the array as `(string | number | null)[]` (not `unknown[]`) to satisfy `SQLQueryBindings[]`:

```ts
const params: (string | number | null)[] = [];
if (filter.name) { conditions.push('name = ?'); params.push(filter.name); }

const stmt = db.prepare(sql);
const rows = stmt.all(...params, limit, offset) as RowType[];
```

### Use Bun's declarations directly

Zero currently relies on `@types/bun` for `bun:sqlite`; it does not maintain a
second ambient `bun:sqlite` declaration. Avoid adding a local module
redeclaration to work around a call-site type error, because merged declarations
can silently drift from the supported Bun API. Fix the generic/parameter type
at the call site or update the pinned Bun types deliberately.

## Prepared Statements

Always prepare statements once (in constructor or `onStart`) and reuse:

```ts
class Store {
  private stmts: { get: Statement<Row, any[]> };

  constructor(db: Database) {
    this.stmts = {
      get: db.prepare<Row, any>('SELECT * FROM items WHERE id = ?'),
    };
  }

  getItem(id: string): Row | null {
    return this.stmts.get.get(id);
  }
}
```

## PRAGMAs

### Hot path (active sessions, high write throughput)
```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA cache_size = -64000;    -- 64MB
PRAGMA mmap_size = 268435456;  -- 256MB
PRAGMA temp_store = MEMORY;
```

### Cold path (archival, query-oriented, low RAM)
```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA cache_size = -8000;     -- 8MB
PRAGMA mmap_size = 67108864;   -- 64MB
PRAGMA temp_store = MEMORY;
PRAGMA wal_autocheckpoint = 1000;
```

## Transactions

Use `db.transaction()` for atomic multi-write operations:

```ts
const insert = db.transaction(() => {
  db.prepare('INSERT INTO a VALUES (?)').run('x');
  db.prepare('INSERT INTO b VALUES (?)').run('y');
});
insert(); // Atomic — both or neither
```

`bun:sqlite` transactions are synchronous — no `await` needed. All changes emit after commit.

## Crash Recovery

WAL mode enables crash recovery:
1. On startup, query for sessions in `'active'` or `'ending'` state
2. `'ending'` = crashed between cold store write and hot store cleanup (safe to clean up)
3. `'active'` = crashed mid-session (data recoverable from WAL, session cannot resume without client)

## Table Naming Convention

For systems using ReactiveDB (sync engine):

- **No prefix**: Table is eligible for Sync policy evaluation; this does not
  make it globally readable. `createApp()` may keep it private or apply a row
  filter (for example workflows and notifications).
- **`_` prefix**: Internal table, never client-readable through Sync (for
  example `_credentials`, `_refresh_tokens`, `_audit_log`).

# Migrations

Zero treats migrations as first-class production infrastructure. The app schema
in code remains the source of truth, migration files remain explicit reviewable
changes, and the database keeps an audit trail of what actually happened.

## Core Model

The migration system has four separate pieces:

1. **Migration files**: explicit `up()` / optional `down()` code.
2. **Migration ledger**: append-only `_zero_migrations` events.
3. **Schema history**: `_zero_schema_history` snapshots after successful runs.
4. **Doctor and plan tooling**: compare declared schemas with the live DB.

This is a hybrid model: code-first enough to detect drift and draft SQL, but
explicit enough that destructive changes still require human review.

## Migration File

```ts
import type { Database } from 'bun:sqlite';
import type { Migration } from '../migrator';

export const migration: Migration = {
  version: '20260628120000',
  description: 'add memberships table',
  safety: 'safe',
  downSafety: 'destructive',

  up(db: Database) {
    db.run(`
      CREATE TABLE memberships (
        membership_id text primary key,
        team_id text not null,
        user_id text not null,
        role text
      )
    `);
    db.run(`
      CREATE UNIQUE INDEX idx_memberships_identity
      ON memberships(team_id, user_id)
    `);
  },

  down(db: Database) {
    db.run('DROP TABLE memberships');
  },
};
```

Register new migrations in `src/migrations/index.ts` by appending them to the
`migrations` array. Never reorder or remove old migrations.

### Torrent migrations on the 1.3 compatibility line

Zero 1.3.1 appends Torrent migrations `030`, `032`, and `033` after the original
`001`–`007` registry. Migration `030` adds the versioned graph/runtime schema,
`032` adds durable single-owner runtime generations, and `033` adds
topology-neutral definition, draft, version, and terminal-event integrity.
Their ledger checksums and migration-local helpers are frozen; repair changed
behavior with a new migration rather than editing an applied file.

A later upgrade to Zero 2.0 applies the missing `008`–`029` migrations and
tenant-integrity migration `031`. Applied `032`/`033` ledger entries remain in
place and are not rerun; `031` preserves/reinstalls their final constraints for
the tenant-aware workflow topology. See [Torrent Durable Workflows](./workflows.md#zero-131-compatibility-boundary)
for the application compatibility boundary.

## Safety Classes

| Safety | Meaning | Default CLI behavior |
|--------|---------|----------------------|
| `safe` | Create tables, add nullable/defaulted columns, non-destructive indexes | Runs normally |
| `guarded` | May fail on existing data, such as unique indexes or NOT NULL backfills | Drafted by plan, review expected |
| `destructive` | Drops, rebuilds, deletes, narrows, or can lose data | Blocked unless opted in |
| `manual` | Needs human-written migration logic | Never auto-generated as runnable SQL |

Forward destructive migrations require:

```bash
bun run migrate --allow-destructive
```

Destructive rollbacks require:

```bash
bun run migrate --down-to 001 --allow-destructive-down
```

For file-backed databases, destructive migrations create a backup artifact by
default. Use `--backup-dir ./path` to choose the location. `--no-backup` is
intended only for disposable local databases.

## Commands

```bash
# Apply all pending migrations
bun run migrate

# Apply through a specific version
bun run migrate -- --to 20260628120000

# Show migration status
bun run migrate:status

# Roll back to a version, exclusive
bun run migrate -- --down-to 20260628110000 --allow-destructive-down

# Run doctor without schema drift checks
bun run migrate:doctor

# Run doctor with app schema drift checks
bun run migrate:doctor -- --schema ./app/lib/schemas.ts

# Fail on warnings too, for CI
bun run migrate:doctor -- --schema ./app/lib/schemas.ts --strict

# Print a draft plan from declared schema vs live DB
bun run migrate:plan -- --schema ./app/lib/schemas.ts

# Write a draft migration file for review
bun run migrate:plan -- --schema ./app/lib/schemas.ts --write --name "add memberships"
```

`--db ./path/app.db` overrides the database path. If omitted, the runner uses
`DATABASE_PATH` and then `./data/platform.db`.

Programmatic migration runners can call `migrator.run()`,
`migrator.rollback()`, and `migrator.list()`. The older `migrator.status()`
name remains supported and returns the same status rows as `list()`.

## Schema Module Shape

Doctor and plan need a module that exports declared tables. These shapes are
accepted:

```ts
export const tables = { todos: todoTable };
```

```ts
export const serverTables = db.serverTables;
```

```ts
export default schema({
  todos: {
    fields: { title: field.text({ required: true }) },
  },
});
```

`defineTable()` outputs are accepted directly. The loader extracts
`.serverTable` automatically.

## Doctor

Doctor checks:

- Pending migrations.
- Failed migration events.
- Applied migration checksum changes.
- Missing `down()` on destructive migrations.
- Declared tables missing from the DB.
- Missing or changed columns.
- Primary key drift.
- Composite primary keys in sync-managed tables.
- Missing natural identity indexes.
- Extra unmanaged tables and columns.

Default mode fails only on errors. `--strict` fails on warnings too, which is
the recommended CI mode.

## Migrate Plan

`migrate:plan` compares declared schema with the live SQLite schema and emits
reviewable SQL.

It can draft:

- `CREATE TABLE IF NOT EXISTS`.
- `ALTER TABLE ... ADD COLUMN` for safe SQLite-supported columns.
- Natural identity unique indexes.

It will not auto-write destructive operations. Drops, renames, type changes,
primary key changes, table rebuilds, and unknown transformations are reported as
manual review items.

When `--write` is provided, the draft migration is saved under
`src/migrations/definitions`. Review it, fill in `down()`, then append it to
`src/migrations/index.ts`.

## Ledger And History Tables

Zero creates these internal tables:

| Table | Purpose |
|-------|---------|
| `_zero_migrations` | Append-only migration event ledger |
| `_zero_schema_history` | Normalized schema snapshot after each successful event |
| `_zero_migration_artifacts` | Backups, generated plans, and related artifacts |
| `_migrations` | Legacy compatibility table for older migration tooling |

The ledger is append-only. Rollback records a `down` event with
`status = 'rolled_back'`; it does not erase the original `up` event.

Schema history stores a stable JSON snapshot and a SHA-256 hash. This lets
doctor detect drift and lets rollback verify the resulting schema shape in
future tooling.

## Rollback Contract

There are three rollback layers:

1. **Transaction rollback**: each migration runs in a SQLite transaction. If it
   throws, that migration is rolled back automatically.
2. **Version rollback**: `--down-to` runs `down()` migrations in reverse order.
3. **Backup restore**: destructive file-backed migrations record backup
   artifacts before running.

Important: `down()` can restore schema shape, but it cannot magically restore
dropped data unless the migration author wrote that logic or a backup is
restored.

## Natural Identity And Indexes

Tables declared with `identity: ['field_a', 'field_b']` produce `_identity`
metadata. Doctor and plan expect a matching unique index:

```sql
CREATE UNIQUE INDEX idx_table_identity ON table(field_a, field_b)
```

Missing identity indexes are planned as `guarded`, because creating a unique
index can fail if existing data has duplicates.

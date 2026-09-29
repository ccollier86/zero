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
`migrations` array. Versions must be non-empty, unique, and strictly increasing
under the same string ordering used by `--to`; zero-pad numeric versions. Never
reorder or remove old migrations.

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

For replicas that open the same SQLite file, the migrator waits up to 30 seconds
for another migration writer by default. Programmatic callers can tune that
connection-local wait without changing the migration contract:

```ts
const migrator = new Migrator({
  dbPath: './data/platform.db',
  migrations,
  busyTimeoutMs: 45_000,
});
```

`busyTimeoutMs` must be a non-negative finite number. A lock timeout means the
migration never started; it is returned to the caller as an operational error
and is not written as a failed migration attempt.

## Concurrent Replica Contract

Multiple current-version processes may call `run()` against the same SQLite
file during startup. Zero serializes each migration with an
`BEGIN IMMEDIATE` transaction and re-reads its durable state after acquiring the
writer lock. A stale contender skips a migration that another process already
applied, so the migration body, event-ledger row, schema-history snapshot, and
legacy compatibility row commit together once. Required backups are retained
and recorded only for the winning or genuinely attempted operation; a backup
staged by a contender that subsequently skips is removed.

Forward and rollback operations also recheck migration ordering while holding
that lock. A forward migration cannot run if an earlier registered migration is
no longer applied, and rollback cannot move beneath a later or unknown applied
version. If operators start opposing `run()` and `rollback()` operations at the
same time, one may finish and the other fails with a retryable ordering error;
the database is never left with a later migration applied above a rolled-back
dependency.

All processes allowed to migrate a file must use the same complete, append-only
migration registry. Current migrators refuse forward or rollback work when the
durable ledger contains a version missing from their registry, preventing a
stale current-version binary from silently operating below a newer schema. Do
not overlap a rollout with binaries whose migrator predates this concurrency
protocol: stop the old replicas, run the migration with the new release, and
then start the new replicas. The SQLite writer lock coordinates one shared
database file only; it is not a cross-database or cross-host deployment lock.

Migration `023` adds the private `_auth_installed_profile` singleton and its
auth-authority-revision triggers. The table records the exact installed tenancy
and authorization modes plus a monotonic generation; it is not application
schema and must not be edited manually. Auth startup uses one `BEGIN IMMEDIATE`
transaction for supported mode adoption, readiness validation, the system
audit event, and the marker compare-and-swap. An exact restart does not update
the row. See [Platform Configuration](./platform-configuration.md#installed-auth-profile-and-mode-upgrades)
for supported transitions and the one-time legacy multi/simple assertion.

Migrations `024` through `027` add the Administration Organization
discriminator/reconciliation, persisted MFA assurance, invitation grant
snapshots, and the versioned authorization-registry manifest. These are
security boundaries rather than application schema conveniences: follow the
[Administration Organization adoption procedure](./auth/platform-administration.md#adopting-the-administration-organization-on-a-pre-024-installation),
[invitation upgrade rules](./auth/tenant-invitations-and-join-requests.md#persistence-and-upgrade),
and [authorization registry deployment contract](./platform-configuration.md#authorization-registry-and-static-roles)
instead of editing their private rows directly.

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

Failed attempts are audit events, not durable schema state. A failed rollback
therefore leaves the last successful `up` state applied, while a successful
rollback is pending for the next forward run. Doctor reports the most recent
failure without misclassifying that durable state. Successfully recorded
migration code remains immutable even after rollback: restore its original
checksum and add a new version instead of editing it before reapplying.

That immutability includes transitive behavior. A numbered migration must not
call a mutable runtime schema installer, repair helper, trigger registry, or SQL
constant whose meaning can evolve with the current application. Keep the exact
historical SQL in the migration itself or in a version-named module beside the
migration, and put every later schema or trigger change in a new numbered
migration. Chain-parity tests should prove both that the new version is the
first migration to introduce its fields and that a full upgrade converges on
the same schema and trigger contract as a fresh runtime database.

For a migration that has already been committed, keep the exported migration
metadata and `up()`/`down()` function bodies byte-stable as well. The durable
ledger hashes those function strings. A safe extraction therefore aliases a
version-named frozen helper back to the historical symbol name without
rewriting the function body. Two independent test guards protect this contract:

- `migration-checksum-compatibility.test.ts` pins the canonical exported
  migration checksums for `001`–`028`, covering metadata plus the serialized
  `up()`/`down()` function bodies stored in the ledger contract.
- `migration-definition-immutability.test.ts` rejects value imports from
  mutable runtime implementations; pins normalized full-source SHA-256 hashes
  for every numbered definition and every version-local helper; asserts the
  exact discovered definition set; and verifies that the registry order is
  `001` through `028`. The full-definition and helper hashes are necessary
  because `migration.up.toString()` cannot see module-local constants or an
  imported helper's body.

When either guard changes, restore the frozen definition and add a new numbered
migration. Do not update an expected hash merely to make an old version pass.

`_migrations` remains synchronized for older tooling: successful forward events
upsert its version row, successful rollbacks remove that row, and startup imports
any legacy-only versions missing from a partially populated event ledger. The
event ledger remains authoritative for versions it already knows.

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

Keep `up()` and `down()` database-local. SQLite can roll back their schema/data
writes, but it cannot undo external API calls or arbitrary filesystem side
effects performed by migration code.

## Natural Identity And Indexes

Tables declared with `identity: ['field_a', 'field_b']` produce `_identity`
metadata. Doctor and plan expect a matching unique index:

```sql
CREATE UNIQUE INDEX idx_table_identity ON table(field_a, field_b)
```

Missing identity indexes are planned as `guarded`, because creating a unique
index can fail if existing data has duplicates.

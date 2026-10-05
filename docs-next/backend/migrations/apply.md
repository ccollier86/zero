---
id: zero.migrations.apply
type: how-to
audience: [developer, agent, operator]
owner: migrations
status: draft
visibility: internal
system: migrations
feature: apply
maturity: supported
applies_to: ["2.1.1 baseline with unreleased handler/planning corrections"]
modes: [system, application, Fabric-realm]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Apply Migrations With Honest Atomicity

[Migrations index](./index.md) · [Documentation index](../../index.md)

Migrator.run(toVersion?) applies pending registry entries through the optional
inclusive lexical target, returning versions actually applied by that runner.

## One Transaction Per Migration

Each migration runs under BEGIN IMMEDIATE. The engine rechecks current ledger
state/checksum/dependencies after acquiring the writer boundary, then runs up,
records success and the installed schema snapshot within the same transaction.

A failing migration rolls back its own changes. Earlier successful migrations
in that run remain committed; the whole registry is not one giant transaction.
A failure event may be recorded separately without overwriting the latest
successful durable state.

## Standalone In-Memory Example

```ts
import { Database } from 'bun:sqlite';
import { Migrator } from '@zero/framework/migrations';

const database = new Database(':memory:');
const migrator = new Migrator({
  database,
  createBackups: false,
  migrations: [{
    version: '001',
    description: 'synthetic notes table',
    up(db) { db.run('CREATE TABLE notes (id TEXT PRIMARY KEY)'); },
  }],
});
try {
  const appliedVersions = migrator.run();
} finally {
  migrator.dispose();
  database.close();
}
```

This explicitly owns a disposable raw handle. Injected handles are caller-owned
by default; dispose does not close them unless configured to own them.

## Concurrent Startup

Connection busy timeout defaults30000ms, with IMMEDIATE transaction serialization
and rechecking. If another runner already applied an entry, the current runner
does not execute it again. A lock-acquisition failure before the attempt starts
does not falsely record the migration body as failed.

This does not authorize independent Fabric instances to share a private root
or make arbitrary external migration side effects exactly-once.

## Completion

The runner checkpoints WAL after completion/no pending work.
A Promise-returning handler cannot be recorded successful under the corrected
[synchronous boundary](./declarations.md).
See [configuration](./configuration.md), [backups](./backups.md),
[registries](./registries.md) and [rollback](./rollback.md).

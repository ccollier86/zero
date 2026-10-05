---
id: zero.persistence.sqlite-service
type: how-to
audience: [developer, agent, operator]
owner: persistence
status: draft
visibility: internal
system: persistence
feature: sqlite-service
maturity: supported
applies_to: ["2.1.1 baseline with unreleased transaction/buffer corrections"]
modes: [file, hot, ephemeral, Fabric-actor]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Compose One Platform SQLite Service

[Persistence index](./index.md) · [Documentation index](../../index.md)

`createPlatformSQLiteService(config?,hooks?)` returns the public
PlatformSQLiteService implemented by DefaultPlatformSQLiteService.

```ts
import { createPlatformSQLiteService } from '@zero/framework/persistence';

const sql = createPlatformSQLiteService({ mode: 'ephemeral' });
try {
  sql.transactions.runSync(() => {
    sql.raw.run('CREATE TABLE example (id TEXT PRIMARY KEY)');
    sql.raw.run("INSERT INTO example VALUES ('synthetic')");
  });
} finally {
  sql.close();
}
```

This complete isolated in-memory example is raw SQL. It emits no managed
ReactiveDB row-change contract and defines no Resource/Guardian policy.

## Surface

The service exposes raw Bun Database, mode/path/snapshotPath, statement cache,
transaction manager, optional snapshot/checkpoint managers and optional buffer
pool. Snapshot exists only for hot; checkpoint only for file; buffers is null
when disabled.

start begins owned background loops; stop stops them without closing the handle;
close flushes mode-specific durability and releases resources; abort is a
startup-discard seam without publishing failed startup state. diagnostics returns
cheap mode/helper/health information.

## App-Local Composition

Managed apps create separate system and application services and hand the
correct one to ReactiveDB and built-in services. Fabric actors own their
corresponding writer/read services. Do not open a second connection by guessing
the app's path merely to access a feature.

The get/require/set/clearPlatformSQLiteService helpers are compatibility globals.
They do not prove which of multiple managed apps owns a handle. Prefer an
explicit service passed by the containing runtime.

## Hooks

Signal-only lifecycle hooks support periodic snapshot start/finish/dirty/clean/
failure and app-local observability/watchdog policy. They do not forward paths,
SQL errors or snapshot bytes. These hooks are infrastructure integration seams,
not an untrusted callback API or a replacement for tracked mutations.

## Related Guides And Next Steps

- [Transactions](./transactions.md) owns raw synchronous SQL behavior.
- [ReactiveDB](../reactive-db/index.md) adds tracked row/event atomicity.
- [Lifecycle](./lifecycle.md) owns the service's final durability boundary.
- [Configuration](./configuration.md) lists constructor inputs.

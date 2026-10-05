---
id: zero.persistence.modes
type: architecture
audience: [developer, agent, operator]
owner: persistence
status: draft
visibility: internal
system: persistence
feature: modes
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

# File, Hot And Ephemeral Storage

[Persistence index](./index.md) · [Documentation index](../../index.md)

`resolveSQLiteStorageConfig` normalizes declaration inputs without
opening a database or creating directories.

| Mode | Active database | Recovery boundary |
| --- | --- | --- |
| file | SQLite file with WAL | SQLite commit under configured synchronous policy |
| hot | in-memory SQLite image | published snapshot according to containing lifecycle/placement |
| ephemeral | in-memory SQLite | none |

Omitted mode resolves hot. Legacy memory/:memory: aliases mean ephemeral, not
hot persistence. An arbitrary other string mode is treated as a legacy file path.
Prefer explicit mode/path declarations.

## Paths And Startup

File path defaults ./data/app.db. Hot mode can restore an existing snapshot,
otherwise an existing source path, otherwise start empty. Hot snapshotPath uses
an explicit value, otherwise the configured source path; the default app source
gets ./data/app.snapshot.db. Ephemeral resolves no file/snapshot path.

Restoring hot storage is an exclusive ownership operation. It does not attach
a writable RAM copy while an unrelated live writer continues using the same
source. Managed path/isolation checks and Fabric actor exit proof govern their
own boundaries.

## WAL Is For File Mode

WAL allows a file-mode reader alongside the current writer. SQLite still has one
writer per file; independent Fabric files can write concurrently. RAM-active
snapshotting is a different mechanism and does not require that mode's database
to remain a file-backed WAL handle.

## Durability Choices

Standalone hot defaults to periodic snapshots, not on-write durability.
Fabric hot placement adds explicit size/durability/watchdog policy and may require
an image before acknowledging a write. Do not transfer that stronger guarantee
to every standalone hot service.

Disabling snapshots intentionally removes the hot service's normal snapshot
recovery boundary. Memory-only tests should choose ephemeral rather than silently
changing production storage defaults.

## Related Guides And Next Steps

- [Configuration](./configuration.md) owns exact paths/defaults.
- [WAL](./wal.md) explains file checkpoints.
- [Hot snapshots](./hot-snapshots.md) owns publication and health.
- [Data modes](../configuration/data-modes.md) composes app/system planes.

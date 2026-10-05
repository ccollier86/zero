---
id: zero.persistence.overview
type: index
audience: [developer, agent, operator]
owner: persistence
status: draft
visibility: internal
system: persistence
feature: overview
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

# SQLite Persistence Foundation

[Backend index](../index.md) · [Documentation index](../../index.md)

Persistence owns Bun SQLite connection policy, SQL helpers, WAL checkpoints,
hot snapshots and resource cleanup. ReactiveDB adds tracked rows/changes;
Fabric adds actor/file routing and stronger placement-specific boundaries.
Raw SQL helpers do not add authentication or realtime tracking.

For independent tenant/named files, use the managed
[Fabric layer](../fabric/index.md) rather than manually opening a database from
a request-supplied path.

## Choose And Configure

- [Modes](./modes.md): file, RAM-active hot and ephemeral without confusing WAL with snapshots.
- [Configuration](./configuration.md): every storage option/default and its read time.
- [Connections](./connections.md): opening resolved storage and safe ownership/admission failures.
- [SQLite service](./sqlite-service.md): one composed handle/helpers/lifecycle facade.

## Durability And Helpers

- [WAL](./wal.md): file reader/writer overlap and checkpoint modes/results.
- [Hot snapshots](./hot-snapshots.md): recovery images, publication outcomes and health.
- [Statement cache](./statement-cache.md): reusable connection-owned prepared statements.
- [Transactions](./transactions.md): synchronous raw SQL savepoints, distinct from ReactiveDB.
- [Buffer pool](./buffer-pool.md): bounded reusable binary buffers and release ownership.
- [Lifecycle](./lifecycle.md): start/stop/close/abort and app-local diagnostics.
- [Roadmap](./roadmap.md): future independent operational planes, not already shipped dashboards.

## Building Principles

Use one owned service per data plane, keep raw SQL privileged, and report an
actual durability outcome rather than equating an in-memory success with a
published recovery file. These are inferred principles of the inspected code.
Filesystem/deployment guarantees and external backups remain explicit operational
responsibilities; documentation does not certify a particular production disk.

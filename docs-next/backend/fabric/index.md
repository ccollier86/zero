---
id: zero.fabric.overview
type: index
audience: [developer, agent, operator]
owner: fabric
status: draft
visibility: internal
system: fabric
feature: overview
maturity: supported
applies_to: ["2.1.1 baseline with unreleased actor environment corrections"]
modes: [single, multiple, shared-row, tenant-database, file, hot]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# ReactiveDB Fabric

[Backend index](../index.md) · [Documentation index](../../index.md)

Fabric routes application data into independent SQLite databases while retaining
ReactiveDB's tracked mutations and realtime delivery. It uses Bun subprocess
actors, not a SQLite fork: different files can execute concurrently, while each
file still has one writer.

Guardian tenancy, permission complexity and Fabric placement are independent
choices. The canonical system database remains separate in every managed mode.

## Choose And Declare

- [Topology](./topology.md): single app database, named databases and tenant files.
- [Configuration](./configuration.md): exact settings, defaults and admission.
- [Database identities](./database-identities.md): opaque refs are routing identities, not permissions.
- [Realms](./realms.md): immutable schemas, migrations and local handlers.
- [Realm composition](./realm-composition.md): reusable feature contributions.
- [Actors](./actors.md): same-entry bootstrap, packaging and explicit environment.

## Use The Data Plane

- [Operations](./operations.md): the bound async client and structured reads/writes.
- [Concurrency](./concurrency.md): file-level overlap and writer ordering.
- [Consistency](./consistency.md): snapshot, read-your-writes and strong reads.
- [Idempotency](./idempotency.md): retained write receipts and uncertain outcomes.
- [Tenant isolation](./tenant-isolation.md): Guardian-bound admission and live fences.
- [Identity projection](./identity-projection.md): shallow FK anchors and readiness.
- [Realtime](./realtime.md): per-database snapshots, replay and authorization.

## Operate It

- [Placement](./placement.md): file, bounded hot and hybrid policies.
- [Capacity](./capacity.md): queue, file, active actor and persistent Sync limits.
- [Recovery](./recovery.md): generation retirement, replacement and shutdown.
- [Diagnostics](./operations-diagnostics.md): safe codes, outcomes and observations.
- [Roadmap](./roadmap.md): known future directions, distinct from shipped behavior.

## Integration And Principles

Declare [Schema](../schema/index.md) and [resources](../configuration/data-access.md)
once; use normal request `zero.data` rather than raw manager/path selection.
Guardian owns authority in its [system plane](../runtime/data-planes.md);
local anchors do not cache that authority. Durable
[database automations](../database-automations/index.md) reacquire their source
capability instead of retaining an unrestricted handle.

The inspected implementation favors explicit bounded work, app-local ownership,
private physical routing and honest durability outcomes. These are inferred
design principles, not a promise of distributed consensus or unlimited capacity.

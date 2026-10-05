---
id: zero.sync.tenant-sync
type: architecture
audience: [developer, agent, operator]
owner: sync
status: draft
visibility: internal
system: sync
feature: tenant-sync
maturity: supported
applies_to: ["2.1.1 source baseline; package qualification pending"]
modes: [single, multi, default-plane, system-plane, tenant-database]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Sync A Physically Isolated Tenant Database

[Sync index](./index.md) · [Documentation index](../../index.md)

Fabric tenant-database mode binds reads and writes to the current verified
organization's database capability. Sync does not accept a tenant or database
file selector from the wire protocol.

## Managed Assembly

The realm's Sync-exposed table catalog, Resource classification, comparable live
read policy and required multi-tenant authentication must agree. Invalid or
missing composition is rejected before transport admission. Do not reconstruct
the internal plane in application endpoints; use declared resources and the
managed root.

The capability must remain live across asynchronous actor work and at result/
commit boundaries. A tenant switch or revoked membership cannot keep using
an old socket's admitted file binding. Platform administration permission is not
automatic authority over another organization's application data.

## Bounded Snapshots

Tenant snapshots are read in pages rather than collecting an unbounded database
in the main server. Current internal transfer budgets are:

| Bound | Value |
| --- | --- |
| Page requests | 512 |
| Rows | 50000 |
| Observed encoded bytes | 67108864 (64MiB) |
| Deadline | 30000ms |

These are transport safeguards, not tenant storage quotas. A snapshot that
exceeds its admitted contract fails explicitly; clients should choose appropriate
[lazy loading](./lazy-data.md) for large application data.

Separate database actors allow independent files to progress concurrently.
Each plane retains its own change history and stream identity. Raw SQL bypasses
tracked ReactiveDB writes and is not guaranteed to update clients.

See [Fabric tenant isolation](../fabric/tenant-isolation.md),
[operation authority](../fabric/operations.md), [resources](../resources/index.md),
[identity mirrors](../fabric/identity-projection.md) and [reconnect](./reconnect.md).

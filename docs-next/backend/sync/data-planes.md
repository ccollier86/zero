---
id: zero.sync.data-planes
type: architecture
audience: [developer, agent, operator]
owner: sync
status: draft
visibility: internal
system: sync
feature: data-planes
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

# Independent Data Planes

[Sync index](./index.md) · [Documentation index](../../index.md)

A Sync data plane is one independently sequenced delivery stream. Current
names are default, system and tenant. These are wire identities, not permission
levels.

| Plane | Typical owner |
| --- | --- |
| default | Ordinary application database |
| system | Read-only admitted framework reconciliation |
| tenant | Actor-backed Fabric organization database |

User-state persistence also uses its configured system/state boundary; it is
not a user-created app table in a tenant file.

## Classification And Cursors

Managed server composition publishes exact table routes to the client.
Low-level tableSyncPlanes enables multiplexing; omission retains the historical
all-default protocol. Applications must not guess a table's plane from its name
or merge sequence numbers across databases.

Snapshot/catch-up/live identities carry the plane with the relevant epoch and
sequence. A system reset must not overwrite an unrelated tenant stream.
Authorization resets, however, purge all data associated with the replaced scope.

## Security Boundary

System tables remain write-protected over direct Sync. Tenant bindings come from
verified live authority. Global data and tenant data use explicit Resource realms;
a requested filename/tenant selector is not a supported shortcut.

The [system data plane](../runtime/data-planes.md) and
[Fabric realtime integration](../fabric/realtime.md) explain managed assembly.
See [snapshots](./snapshots.md), [reconnect](./reconnect.md),
[tenant Sync](./tenant-sync.md) and [SDK low-level Sync](../../frontend/sdk/low-level-sync.md).

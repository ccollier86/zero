---
id: zero.sync.snapshots
type: reference
audience: [developer, agent, operator]
owner: sync
status: draft
visibility: internal
system: sync
feature: snapshots
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

# Subscriptions And Snapshots

[Sync index](./index.md) · [Documentation index](../../index.md)

A subscription identifies readable tables. Snapshot delivery establishes a
coherent baseline with the database sequence, epoch and authorization scope.
It is not a raw SELECT response and must not be combined with rows from another
tenant or prior login.

## Loading And Exposure

Full loading supplies an initial admitted table snapshot. Lazy loading relies
on [HTTP queries](./lazy-data.md) to load useful records while Sync can update
those records. Auto mode is resolved by managed configuration. Resources may
expose a table to HTTP, Sync, both or neither.

A readable table is not automatically eligible for a full snapshot. Managed
snapshotTables reflects resolved loading modes. Conversely, a full loading
choice never bypasses table, row or field policy.

## Consistency And Transfer

The server captures rows with the matching current sequence. Row filters and
field projections run before wire delivery. Changes arising during a transfer
are deferred and reconciled after its accepted baseline; independent data
planes do not share one sequence number.

Small snapshots use sync.snapshot. Larger payloads use begin/chunk/end frames
with bounded chunk size and ordered assembly. A row that cannot fit the
transport contract terminates the stream instead of silently omitting it.
Bun backpressure pauses chunk production until drain.

The client applies an accepted snapshot according to its reset mode and rejects
inconsistent stream identities. Reconnect and authorization resets are distinct:
a reconnect may replay, whereas a changed authority must remove stale scoped data.

See [Schema loading modes](../schema/index.md), [resource exposure](../resources/exposure.md),
[reconnect](./reconnect.md), [data planes](./data-planes.md) and
[tenant snapshot budgets](./tenant-sync.md).

---
id: zero.fabric.realtime
type: how-to
audience: [developer, agent, operator]
owner: fabric
status: draft
visibility: internal
system: fabric
feature: realtime
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

# Realtime Across Tenant Databases

[Fabric index](./index.md) · [Documentation index](../../index.md)

Fabric retains ReactiveDB's tracked change stream rather than replacing it
with polling arbitrary SQL tables. Each physical source has ordered changes and
its own sequence; the system DB and other tenants are not part of that source.

## Binding And Snapshot

Tenant Sync acquires a server-derived, live-authorized persistent capability for
the current organization. Target readiness and identity projection must pass
before snapshot/replay data is released.

Snapshots are bounded and paged rather than assembled into an unbounded single
message. Persistent bindings/session counts, source row bytes/nodes, page sizes
and snapshot TTL all have explicit limits exported by the server facade.
Applications do not bypass these by increasing DataTable page size.

## Change Delivery

Tracked writer mutations, command results and synchronous automation changes
feed the same database's canonical changes. Resource filtering and current
authorization constrain delivery; raw privileged SQL is not guaranteed to
produce tracked changes.

A durable sequence supports replay; a process/source epoch distinguishes an
incompatible runtime history. History gaps require the managed snapshot/reset
path rather than pretending missing changes were delivered.

Client Sync merges admitted rows into reactive state; components subscribe to
the collections/slices they need. It is not a global cache permitted to leak
records from one organization into another.

## Authority And Backpressure

Membership/role/credential revocation revalidates admission. Scope changes retire
the old connection/cache/query state. Authentication finishing after socket close
must not reactivate its binding or timers; connection lifecycle has independent
cleanup ownership.

Backpressure and persistent capacity bounds apply even when the UI has no table
visible. Idle eviction cannot retire a database still pinned by a live capability.

See [capacity](./capacity.md), [tenant isolation](./tenant-isolation.md),
[ReactiveDB subscriptions](../reactive-db/subscriptions.md),
[frontend Sync](../../frontend/sdk/index.md) and
[consistency](./consistency.md).
The detailed transport contract belongs to Sync's system guide; Fabric owns the
physical-source relationship rather than a second websocket protocol.

---
id: zero.fabric.capacity
type: how-to
audience: [developer, agent, operator]
owner: fabric
status: draft
visibility: internal
system: fabric
feature: capacity
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

# Bound Actor And Queue Capacity

[Fabric index](./index.md) · [Documentation index](../../index.md)

Fabric admission is deliberately bounded. Active actor capacity, physical file
count, queued work and persistent Sync bindings are separate dimensions;
increasing one does not remove the others.

## Defaults

| Setting | Default | What it bounds |
| --- | --- | --- |
| `maxDatabases` | 16 | Simultaneously active physical databases |
| `maxDatabaseFiles` | 10000 | Owned main database files under the root |
| `maxBlockedDatabases` | 1024 | Retained permanently failed entries |
| `maxQueuedPerDatabase` | 128 | Waiting operations in one database lane |
| `maxQueuedTotal` | 1024 | Waiting operations app-wide |
| `maxTenantSyncDatabases` | 1 when maxDatabases is 1; otherwise maxDatabases − 1 | Databases pinned by persistent Sync |
| `maxTenantSyncBindingsPerDatabase` | 64 | Persistent capabilities for one database |
| `idleTimeoutMs` | 60000 | Idle actor generation lifetime |

A persistent Sync binding can keep a database active. Reserving one active slot
when possible avoids letting background connections consume every slot needed
for ordinary requests. Idle eviction closes owned actors; it does not delete
the durable database file or silently free the physical file count.

## Admission And Waits

Queue timeout defaults to 15000ms; dispatched operation timeout to 30000ms.
Per-operation overrides remain bounded. Backpressure and capacity exhaustion
have safe database codes; an application should explain them without exposing
paths or treating all of them as an authentication error.

Cancellation is honored before dispatch. Once a synchronous writer command is
running, cancellation cannot prove no commit occurred. Outcome-aware handling
still applies.

## Operational Tuning

Tune from actual app workload and memory/process/disk budgets. A hot image's
`maxBytes` bounds that database image, not whole-process RSS or all buffers,
history, IPC and active actors. Reader actors add process/connection resources.

Repeated permanent open/schema failures are bounded and fail closed.
Do not implement a browser endpoint that clears blocked entries or manipulates
actor leases without trusted operational authority.

See [configuration](./configuration.md), [concurrency](./concurrency.md),
[placement](./placement.md) and [diagnostics](./operations-diagnostics.md).

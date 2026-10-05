---
id: zero.persistence.wal
type: operations
audience: [developer, agent, operator]
owner: persistence
status: draft
visibility: internal
system: persistence
feature: wal
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

# WAL And File Checkpoints

[Persistence index](./index.md) · [Documentation index](../../index.md)

File-mode SQLite uses WAL. Readers can retain snapshots while one
writer commits; writers on the same file still serialize. Multiple independent
Fabric files are independent writer domains.

Checkpointing moves WAL content toward the main database file. It is neither
a RAM snapshot nor an extra multiwriter implementation.

## Manager And Results

CheckpointManager defaults to a 60000 ms periodic interval and PASSIVE mode.
start/stop own its timer. checkpoint(mode?) accepts PASSIVE/FULL/RESTART/TRUNCATE
and returns SQLite counters busy/log/checkpointed.

A busy result is data from SQLite, not proof that every frame was checkpointed.
Choose blocking/truncating behavior with its lock/reader consequences in mind.
The composed file service requests TRUNCATE on close; ongoing app work should
already be drained before providers close.

The manager owns its temporary connection-cached query statement rather than
leaving a prepared read lock until garbage collection.

## Diagnostics

Successful/failed checkpoints use PERSISTENCE_SQL_CHECKPOINT_COMPLETED/FAILED
through app-local observability when supplied. Failure events omit SQL and
filesystem-bearing exception text. Periodic failures are observed without
crashing the timer owner; callers of an explicit checkpoint receive its failure.

Telemetry is best effort, not a checkpoint authority or a durable backup log.

## Verify

Use disposable file connections to test reader overlap, busy counters,
periodic stop and final checkpoint/close. Do not delete a live WAL to force
truncation; that is not a supported operational fix.

## Related Guides And Next Steps

- [Modes](./modes.md) separates WAL from hot persistence.
- [Connections](./connections.md) establishes file policy.
- [Lifecycle](./lifecycle.md) drains before final checkpoint.

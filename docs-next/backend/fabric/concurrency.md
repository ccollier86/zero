---
id: zero.fabric.concurrency
type: how-to
audience: [developer, agent, operator]
owner: fabric
status: draft
visibility: internal
system: fabric
feature: concurrency
maturity: supported
applies_to: ["2.6.0 source; identify the installed archive by commit/hash"]
modes: [single, multiple, shared-row, tenant-database, file, hot]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "cb7ffed940232f0889a306d75414e95aeb9e89c7"
  snapshot: dirty
  date: "2026-10-19"
  evidence_level: source-observed
---

# Concurrency Across And Within Databases

[Fabric index](./index.md) · [Documentation index](../../index.md)

## Different Files

Active logical databases have independent subprocess actors and per-database
queues. A long writer command in database A does not route database B's writes
through A's SQL queue. Bun actors permit actual execution overlap across files;
the coordinator still enforces app-wide admission and capacity bounds.

This is concurrency within one managed application runtime, not distributed
ownership across independently launched servers pointing at the same root.
Do not interpret private file locks as a replicated consensus service.

## One File

SQLite remains single-writer per file. Fabric serializes tracked writes in the
writer lane, preserving mutation, change-log and receipt ordering. A separate
read-only WAL reader actor is enabled by default for file placement; snapshot
reads can overlap writes according to SQLite snapshot visibility.

An already-open read snapshot need not see a just-committed writer result.
Choose [read-your-writes or strong consistency](./consistency.md) when needed.
`readers: false` removes the separate reader actor rather than introducing
concurrent writes inside the file.

Hot placement owns a RAM-active image and durability policy. Do not treat a
file WAL reader as a second connection to another process's private RAM image;
placement-specific routing remains managed by Fabric.

## Guardian Authority Coordination

Actor work uses shared authority leases; authority-changing SYSTEM commits need
exclusive ownership. Managed asynchronous web/native-session, account and
administrative authority persistence reserves an
exclusive turn through the existing bounded fair queue before entering SQLite.
Once queued, later shared requests cannot barge ahead of it. Active shared work
is not interrupted, and password hashing/signing does not occupy the exclusive
turn. Auth admission has an internal five-second waiting bound, not a new
application configuration setting.

The permit covers only the synchronous persistence callback. Authority revision,
live session/eligibility checks and the nonwaiting cross-process final file fence
still run. Direct synchronous commits cannot wait under SQLite locks and retain
their fail-closed conflict path. The local queue is not distributed arbitration:
an unresolved cross-process race or exhausted admission can still fail safely
with a not-committed conflict. See [Guardian sessions](../guardian/sessions.md#fabric-commit-admission).

Idle hot outbox recovery/claim polls no longer publish identical durability
images when SQLite reports no changes. Actual private outbox writes, terminal
compaction and successful claims retain their durability behavior; a real claim
must be durably published before delivery even under periodic/final policies.
This reduces avoidable lease occupancy without removing the lease from active
writer work. See [outbox delivery](../database-automations/delivery.md).

Duplicate presence/identity publications also skip image I/O only when private
SQL reports no changes. Empty-source polling uses bounded backoff and commit
hints; delayed retries and active leases retain ordinary recovery cadence.
None of these optimizations creates parallel writers inside one database or
removes authorization checks from its commit boundary.

### Storage Cost Is Separate From Writer Scheduling

Hot/on-write durability serializes and fsyncs a complete database image at each
real write boundary. This scales with image size, unlike a small file/WAL write;
more workers do not remove that per-database I/O cost. File/WAL remains the
default and is normally the starting point for write-heavy datasets. Hot mode
is a bounded placement tradeoff, not a universal faster-write setting.

The operational regression suite covers separate-file overlap, same-file FIFO,
revocation during admission, shutdown/unknown outcomes, and populated hot
login/refresh/read/outbox progress. These are correctness checks, not a promise
of a latency SLA on arbitrary hardware or load. Qualify actual image sizes,
write rates, worker capacity and storage latency before deployment.

## Bounded Work

Queued work is bounded per database and across the app. Queue timeouts describe
pre-dispatch waiting; execution timeouts describe a dispatched actor operation.
Cancellation is honored before dispatch, not an interruption of arbitrary
synchronous SQL or handler code already executing.

Keep commands small and synchronous. Network requests, human input waits and
long AI work belong outside the SQLite command transaction, commonly in
workflow engine or a
durable automation integration. Persist the necessary correlation record and
perform a short tracked update when external work completes.

See [capacity](./capacity.md), [operations](./operations.md) and
[recovery](./recovery.md) for admission, outcomes and replacement.

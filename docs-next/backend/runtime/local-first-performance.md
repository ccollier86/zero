---
id: zero.runtime.local-first-performance
type: architecture
audience: [developer, agent, operator]
owner: platform-runtime
status: draft
visibility: internal
system: platform-runtime
feature: local-first-performance
maturity: planned
applies_to: ["Architectural requirement for Zero; measurements must identify their exact qualified candidate"]
---

# Local-first performance is a platform requirement

[Runtime](./index.md) · [Backend systems](../index.md)

User direction, reaffirmed 2026-11-15: Zero is an integrated local platform.
Its core services belong together on the application's machine. A collection
of mandatory remote databases, queues, schedulers and coordination services is
not the default solution to framework execution problems. Explicit external
providers still have their own unavoidable API boundaries; ordinary internal
service calls should use the native facade and admitted local capability.

**File-backed operation is a first-class performance target. HOT/RAM mode is
an optional optimization, not a prerequisite for a responsive application.**
Sizing a stronger host may be appropriate for an integrated workload, but extra
hardware cannot justify avoidable serialization, redundant work, scans, repeated
process boot or unbounded queues in the framework. This page is a design and
review requirement, not an unsupported claim that every current path already
meets a latency target or that physical I/O has no cost.

## Review every shared path

- Keep SQL transactions and final Guardian authority admission short. Do not
  hold a writer/authority lease across a pool wait, provider/AI request, timer,
  workflow execution, file delivery or human approval.
- Preserve SQLite's single-writer ordering within a file. Independent Fabric
  files and unrelated tasks must not acquire a global execution lane merely
  because each individual file has an ordered writer.
- Reuse admitted local workers, database actors and connections. Keep worker
  bootstrap imports small and explicit; do not boot the main app or import an
  entire service graph to execute a registered CPU task.
- Refill free capacity when work settles. Avoid whole-batch barriers which
  leave slots idle behind one slow task, and avoid turning a concurrent capacity
  limit into an arbitrary tasks-per-timer-tick throughput limit.
- Bound queues, concurrency, catch-up and payloads. Apply per-scope fairness
  and visible backpressure rather than infinite fan-out, dropped accepted work
  or starvation of interactive authentication/read/write operations.
- Use indexes and bounded projections for due discovery, queries and recovery.
  An idle feature must not repeatedly open every database or scan full tables.
  Optional disabled features should not allocate their own timers or actors.
- Coalesce actual committed reactive changes and perform authorized bounded
  rereads. Do not broadcast private payloads, fabricate row events, repeatedly
  reload an entire table or turn idle polling/heartbeats into audit traffic.
- Put high-output logging capture/delivery and read-heavy investigation behind
  its native durable source queues and supervised workers. Keep source commits
  atomic and small; preserve required delivery/backpressure instead of silently
  dropping evidence to improve a timing number.
- Reconcile uncertain receipts using their original identities. Performance
  shortcuts must not weaken revocation, change final authorization, duplicate
  an external effect or falsely claim cancellation/rollback.

## Measure the actual supported deployment

Compare file/WAL and any HOT mode under equivalent authentication, audit,
durability and reactive policies. Include populated realistic synthetic state,
concurrent independent databases and mixed short/slow workloads. Measure at least:

| Boundary | Evidence to collect |
| --- | --- |
| Auth and authority | Login/refresh/protected-read latency and bounded fair admission under concurrent writes. |
| Database reads/writes | Throughput, p50/p95/p99 latency, transaction/queue time and independence between files. |
| Reactive delivery | Accepted commit to authorized client update, payload/batch size and reconnect recovery. |
| Job admission/execution | Commit acknowledgment versus actual activity entry, busy-slot refill, fairness and queue bounds. |
| Workers | Cold start separately from warm task latency, IPC overhead, occupancy, cancellation and confirmed retirement. |
| Logging | Added source-commit cost, worker/backlog recovery and investigator-query impact on normal work. |
| Idle behavior | Repeated SQL/actor wakes, timers, CPU, memory and background bytes with no application activity. |

Record the candidate commit/archive hash, hardware, OS/architecture, local versus
emulated execution, storage/durability mode, dataset size, concurrency and policy
settings. Separate cold start, warm steady state, saturation and recovery. A
functional concurrency test does not establish an end-to-end latency SLA.

Set and track justified regression budgets from representative measurements.
Do not invent "lightning fast" numbers, hide tail latency with averages, or
compare audit-disabled/less-durable benchmarks against a production strict
configuration. Never trade away correctness, privacy, authorization, durability
or required audit evidence for a passing benchmark.

## Applying the rule during this foundation upgrade

The [foundation plan](../../_work/durable-jobs-and-workers-plan.md) applies this
requirement before returning to calendar backend implementation. Its current
review includes independent-file progress, short Torrent handoffs, indexed
future/idle wake discovery, bounded worker reuse/lifecycle, and a dispatcher
which refills individual free scope slots rather than awaiting a whole batch.
Remaining package/Linux/performance qualification is tracked there explicitly;
implemented mechanisms must not be confused with measured final deployment
performance.

---
id: zero.scheduler.index
type: index
audience: [developer, agent, operator]
owner: scheduler
status: draft
visibility: internal
system: scheduler
feature: system
maturity: supported
applies_to: ["2.11.0 source/local APIs; deployment requires matching artifact provenance and qualification"]
modes: ["managed Bun server", "standalone Elysia plugin/service"]
reviewed_against:
  package: "@zero/framework"
  version: "2.11.0"
  commit: "bc396a957c1e0fb85ac935bfa5b1d6dfdfb8b0b3"
  snapshot: clean
  date: "2026-11-15"
  evidence_level: source-observed
---

# Scheduler

[Backend systems](../index.md) · [Documentation index](../../index.md)

Scheduler is Zero's app-local in-process registry for named cron jobs. Use it
for trusted periodic maintenance and immediate operational controls. Job
definitions are code, not tenant-owned database records or a distributed queue.

Torrent persists its own deadlines/recovery state and uses Scheduler for wake
jobs. Scheduler is the timer mechanism, not the durable source of truth. A
process restart recreates code-defined jobs; it does not replay missed work.

Zero 2.11.0 implements the additive
[worker foundation](../workers/index.md) and optional [durable jobs](./durable-jobs.md),
including managed admission, private Fabric state, exact Torrent handoff, native
HTTP/SDK integration and the operator workspace. It also implements app-bound
Scheduler observability and cooperative, bounded `close()`.

These are implemented source/local APIs. Use the exact installed commit/archive
provenance and matching qualification receipt for deployment decisions; a version
number alone is not application deployment approval.
The [foundation record](../../_work/durable-jobs-and-workers-plan.md) distinguishes
source evidence from release gates. Durable jobs are a separate service; they do
not turn this app-local timer registry into a durable queue.

## Choose An Integration

| Need | Use |
| --- | --- |
| Periodic work in a normal Zero app | The app-bound Scheduler service supplied by managed composition. |
| Standalone trusted cron registry | SchedulerService from @zero/framework/scheduler. |
| Elysia admin controls and lifecycle | createSchedulerPlugin with app-local auth/service dependencies. |
| Restart recovery, waits, scoped run authority | Torrent's durable workflow service, not an in-memory job alone. |
| Durable one-off/recurring schedules and current-scope controls | Optional `zero.jobs`, backed by private Fabric state and pinned Torrent handoffs. |

All managed apps construct Scheduler; there is no AppConfig.scheduler toggle.
Normal trusted server code uses zero.scheduler. A tenant-scoped request does not
receive the app-global registry as a safe service: it is behind
zero.unsafe.scheduler. That boundary prevents a tenant from controlling other
tenants' or platform maintenance jobs.

## Features And References

- [Configuration](./configuration.md): managed versus explicit composition,
  plugin prefix/dependencies, startup and app-local binding.
- [Jobs](./jobs.md): exact declaration fields, cron/timezone, pause/manual runs,
  captured options, overlap and caught-versus-rethrown failure policy.
- [Durable jobs](./durable-jobs.md): managed configuration, ownership,
  permanent receipts, pinned handoff, live reads and deployment boundaries.
- [Status](./status.md): list/get/existence, busy versus scheduled state and
  timestamp meaning.
- [Lifecycle](./lifecycle.md): removal, stop, registration ownership and shutdown.
- [HTTP API](./http-api.md): admin-only controls, envelopes and busy/not-found errors.
- [Operations](./operations.md): stable errors/events, deterministic testing,
  application upgrades and durable-consumer boundaries.
- [Roadmap](./roadmap.md): current scope and explicitly unapproved future ideas.

## Design And Integration

The service owns named scheduling and control; the Elysia plugin owns transport,
auth guard and cleanup. Callbacks capture their required app-local services and
receive a `{ signal }` context for cooperative shutdown. Existing no-argument
callbacks remain compatible and simply ignore it. A callback must establish its own
current authority before accessing scoped data or invoking another service.

The guiding philosophy inferred from the implementation is a small reusable
timer/control primitive, with durable state and domain authority kept in their
own systems. Do not copy workflow recovery into cron callbacks or infer that a
shared timer creates cross-process coordination.

## Related Guides And Next Steps

Start with [jobs](./jobs.md) and [configuration](./configuration.md).
The runtime [service boundary](../runtime/server-services.md) explains trusted
versus scoped dependencies, and [ReactiveDB](../reactive-db/index.md) owns data
mutation/persistence rather than schedule definitions. Torrent and notifications
references will link here as their canonical manuals are completed.

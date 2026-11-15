---
id: zero.scheduler.roadmap
type: roadmap
audience: [developer, agent, operator]
owner: scheduler
status: draft
visibility: internal
system: scheduler
feature: roadmap
maturity: supported
applies_to: ["2.1.1 source plus reviewed uncommitted Scheduler corrections"]
modes: ["managed Bun server", "standalone Elysia plugin/service"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Scheduler Roadmap

[Scheduler](./index.md) · [Backend systems](../index.md) · [Documentation index](../../index.md)

The user approved a shared scheduling/jobs/worker expansion on 2026-11-14.
The [implementation plan](../../_work/durable-jobs-and-workers-plan.md) records
the integration matrix, phases, authority, placement and release gates. Existing
cron remains compatible; Torrent remains the execution/recovery engine. Calendar
backend work is paused behind this foundation.

## Approved Expansion, Not Yet Released

Track completion in the plan; these are not already-supported cron features:

- [ ] Persisted or tenant-owned schedule definitions with explicit actor authority.
- [ ] Multi-process lease ownership and failover scheduling.
- [ ] A reusable admin schedule/status UI if product demand warrants it.
- [ ] Broader timezone/calendar/runtime qualification fixtures.

The additive [worker API](../workers/index.md) and actor enqueue are in branch
development. Durable schedule controls and full qualification remain pending.
Do not claim cluster-wide ownership, unlimited concurrency or distributed
exactly-once effects merely because the expansion is approved.

## Existing Boundaries To Preserve

Jobs remain app-owned code. Callback effects need live domain authority.
Explicit caught/uncaught policy, per-job overlap and deterministic cleanup should
remain predictable. In-memory status is not an audit ledger or recovery source.

## Related Guides And Next Steps

[Jobs](./jobs.md) and [lifecycle](./lifecycle.md) describe current behavior.
[Operations](./operations.md) distinguishes tested corrections and future work;
return to [Scheduler](./index.md) for the complete implemented surface.

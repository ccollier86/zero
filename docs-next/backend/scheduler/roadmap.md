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
applies_to: ["2.11.0 released foundation; calendar backend and multi-host scheduling remain planned"]
modes: ["managed Bun server", "standalone Elysia plugin/service"]
reviewed_against:
  package: "@zero/framework"
  version: "2.11.0"
  commit: "4d2eb26034783cb77622a249c0cc57f48760331e"
  snapshot: clean
  date: "2026-11-16"
  evidence_level: source-observed
---

# Scheduler Roadmap

[Scheduler](./index.md) · [Backend systems](../index.md) · [Documentation index](../../index.md)

The user approved a shared scheduling/jobs/worker expansion on 2026-11-14.
The [implementation plan](../../_work/durable-jobs-and-workers-plan.md) records
the integration matrix, phases, authority, placement and release gates. Existing
cron remains compatible; Torrent remains the execution/recovery engine. The
foundation shipped in Zero 2.11.0 on 2026-11-16. Its
[release closure](../../_work/durable-jobs-and-workers-plan.md#release-closure--november-16)
records exact artifact identity and qualification limits. Calendar backend work
is not implemented; its next step is reviewing the preserved backend plan with
the user, not treating the released UI as a booking service.

## Released Foundation And Remaining Scope

Durable jobs and workers are additive services, not new persistence inside the
local cron registry. Preview/experimental maturity and application-specific
deployment acceptance remain separate from inclusion in a framework release.

| Area | Released in 2.11.0 | Still outside that release contract |
| --- | --- | --- |
| Local Scheduler | Compatible code-owned timers, app-bound observability and cooperative close/drain. | Durable history or multi-process coordination from the cron registry alone. |
| Durable jobs | Opt-in private Fabric schedules, explicit actor/service ownership, permanent receipts, revision-fenced controls and pinned Torrent handoff. | Calendar booking/recurrence semantics or indefinite high-frequency retention. |
| Workers and enqueue | Bounded fair pools, registered Bun task processes and actor-preserving short workflow enqueue. | Unlimited capacity, an OS sandbox or distributed exactly-once provider effects. |
| Operator UI | Native current-scope `JobsWorkspace` and jobs HTTP/client/hooks. | A dashboard for controlling every app-global cron callback or a calendar backend. |
| Ownership and recovery | One managed application with supervised children, fenced local ownership and recorded restart qualification. | Multi-host leader election/failover or a universally qualified compiled jobs application. |
| Time qualification | Recorded cron/timezone/DST/misfire checks and exact runtime/package evidence. | Appointment recurrence/series exceptions and application-specific calendar acceptance. |

See the [worker API](../workers/index.md), [durable jobs](./durable-jobs.md) and
[JobsWorkspace](../../frontend/jobs-workspace.md) for current contracts.
Post-release worker, workflow-dispatch, jobs query-plan and direct-dependency
fixes are source-reviewed on `feature/core-foundation-polish`. Fresh frozen
installs, TypeScript and 19 selected canonical test files passed. They are not in
the selected 2.11.0 archive, and separate release qualification remains pending;
see the
[review record](../../_work/durable-jobs-and-workers-plan.md#post-release-review-boundary).

## Existing Boundaries To Preserve

Jobs remain app-owned code. Callback effects need live domain authority.
Explicit caught/uncaught policy, per-job overlap and deterministic cleanup should
remain predictable. In-memory status is not an audit ledger or recovery source.

## Related Guides And Next Steps

[Jobs](./jobs.md) and [lifecycle](./lifecycle.md) describe current behavior.
[Operations](./operations.md) distinguishes tested corrections and future work;
return to [Scheduler](./index.md) for the complete implemented surface.

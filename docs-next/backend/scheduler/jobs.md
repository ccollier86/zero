---
id: zero.scheduler.jobs
type: how-to
audience: [developer, agent, operator]
owner: scheduler
status: draft
visibility: internal
system: scheduler
feature: job-registration-and-control
maturity: supported
applies_to: ["2.11.0 local source candidate; not a selected updater or deployment qualification"]
modes: ["managed Bun server", "standalone Elysia plugin/service"]
reviewed_against:
  package: "@zero/framework"
  version: "2.11.0"
  commit: "c401dbd68b29efbc185e55273d37e71aac3bd536"
  snapshot: dirty
  date: "2026-11-15"
  evidence_level: source-observed
---

# Register And Control Jobs

[Scheduler](./index.md) · [Configuration](./configuration.md) · [Documentation index](../../index.md)

Register a named callback with a code-defined cron pattern. Scheduler copies
the admitted declaration, so later caller mutation cannot rename its status,
replace its handler, change its failure policy or misreport the scheduled
pattern. Update a job by deliberately removing and recreating it.
These are implemented local Scheduler APIs in the 2.11.0 source candidate,
not [durable job definitions](./durable-jobs.md). Final exact installed-archive/
Linux qualification and normal updater selection remain pending.

## Complete Service Helper

This helper receives the intended trusted registry and an already
authority-bound maintenance function. The app owns cleanup and service lifetime.

```ts
import type { SchedulerService } from "@zero/framework/scheduler";

export function installMaintenance(
  scheduler: SchedulerService,
  cleanup: () => Promise<void>,
) {
  scheduler.register({
    name: "app-maintenance",
    pattern: "0 */15 * * * *",
    timezone: "UTC",
    protect: true,
    catchErrors: true,
    run: cleanup,
  });
  return () => scheduler.unregister("app-maintenance");
}
```

Scheduler passes a `{ signal: AbortSignal }` callback context. Existing
no-argument functions such as `cleanup` remain compatible. Capture services explicitly,
and establish live authority within the maintenance operation before accessing
scoped data. A cron name is not a tenant ID or authorization scope.

## Identity And Declaration

| Field | Required/default | Contract |
| --- | --- | --- |
| name | Required | Unique within this service's job map; duplicate registration rejects without replacing existing work. |
| pattern | Required | String interpreted by the installed Croner dependency. Prefer six fields including seconds, or a supported alias. |
| run | Required | (context: SchedulerRunContext) => void or Promise<void>; no-argument callbacks remain compatible. |
| timezone | Omitted: system timezone | IANA timezone such as UTC or America/New_York. |
| paused | false | Suppresses automatic scheduled firing until resumed. |
| protect | true | Prevents admitting overlapping scheduled or public immediate executions for this job. |
| catchErrors | true | Report callback failure and keep it caught; false reports and rethrows to Croner/runtime. |

create is the register alias. Registration is synchronous and returns void,
not a persisted definition ID or first-run completion. Invalid schedules/options
raise SCHEDULER_JOB_INVALID, and duplicates SCHEDULER_JOB_ALREADY_REGISTERED.
Scheduler rejects malformed names/handlers, unknown declaration
fields, accessors, proxies and non-boolean controls before constructing Croner.
Names are trimmed nonempty strings up to 200 characters without control bytes;
patterns are nonempty strings up to 256 characters. Error messages do not echo
invalid declarations. Versioned durable definitions use a different contract.

## Schedule And Timezone

A six-field pattern is seconds, minutes, hours, day of month, month, day of week.
The installed Croner 6.0.7 also supports its normal five-field form and aliases;
Zero does not implement a separate cron parser. Declare timezone explicitly
when deployment timezone must not change behavior. Do not treat local-time
daylight-saving transitions as a fixed elapsed-duration schedule.

Use @daily for the installed dependency's daily shorthand or
0 */15 * * * * for a quarter-hour boundary. These are cron boundaries, not a
promise of exact wall-clock delivery under CPU load, process downtime or a
blocked event loop. For exact durable deadlines, Torrent owns the persisted
wake/recovery state.

## Pause And Resume

pause(name) and resume(name) return false for a missing job and true for an
existing one. They change scheduling, not the code declaration or database.
Pause does not abort a callback already executing. Explicit trigger/run remains
available while a schedule is paused; this is useful for controlled maintenance.

Do not present pause as cancellation of an external operation. App callbacks
must own their transactional/idempotency behavior. Terminal `close()`
aborts the per-invocation signal and observes cooperative drain; ordinary pause
and stop retain their existing non-cancellation meaning.

## Immediate Runs And Overlap

trigger(name), and its run alias, request one immediate execution outside the
cron schedule. They return synchronously: true means admitted, not completed.
False means missing or protected busy work. Inspect has/status or use the
admin HTTP distinction when those outcomes matter.

protect:true checks the current job's busy state before immediate admission as
well as Croner's scheduled overlap guard. It does not queue a second execution.
After the callback settles, a later trigger can proceed. protect:false
deliberately permits overlap; make the callback safe for that choice.

Protection is per job in one process. Two names, services, processes or replicas
do not share this guard. A database lease, transaction or durable workflow
boundary is a different feature; do not infer distributed mutual exclusion.

## Error Policy

With catchErrors true, a sync throw or async rejection is reported through
scheduler.job.failed and caught by Croner. The service does not turn it into a
successful domain result; there is simply no result-returning job API.

With catchErrors false, Zero reports scheduler.job.unhandled_failed and rethrows
the same failure to the runtime. This intentional availability choice can
produce an unhandled rejection for automatic or unawaited immediate firing.
Do not choose it assuming the HTTP trigger request will await the callback and
return its error. That route returns an admission response.

## Related Guides And Next Steps

[Status](./status.md) explains busy/scheduled flags and dates.
[Lifecycle](./lifecycle.md) explains removal and active work.
[HTTP API](./http-api.md) exposes admin control, and
[operations](./operations.md) covers errors, events, testing and upgrades.

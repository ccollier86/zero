---
id: zero.scheduler.operations
type: operations
audience: [developer, agent, operator]
owner: scheduler
status: draft
visibility: internal
system: scheduler
feature: errors-observability-testing-and-upgrades
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

# Scheduler Operations And Verification

[Scheduler](./index.md) · [Jobs](./jobs.md) · [Documentation index](../../index.md)

Scheduler setup, callback execution and durable-consumer recovery are separate
outcomes. A synchronous accepted trigger does not prove the callback succeeded,
and an in-process status list is not a durable job ledger.

## Errors And Events

SchedulerError exposes a stable code and message. Setup/control codes are
SCHEDULER_JOB_ALREADY_REGISTERED, SCHEDULER_JOB_INVALID, SCHEDULER_JOB_BUSY and
SCHEDULER_STOPPED. Missing job controls preserve boolean/null service results;
the HTTP adapter preserves NOT_FOUND / 404 and maps protected busy to 409.

Platform codes cover scheduler.started, stopped, all_stopped, job.registered,
job.unregistered, job.failed and job.unhandled_failed. Registration metadata
contains job name/pattern and scheduled/paused state. Callback failure carries
the error through Zero's established sink; do not put secrets or sensitive
records in job names, patterns or exception messages.

The service does not emit a per-execution durable success/result record or
compute retry billing. Apps needing business audits must create their intended
authorized domain record. The runtime
[observability guide](../runtime/observability.md) owns sink configuration.

## Deterministic Tests

Use paused jobs and a controlled callback promise/barrier. Verify:

- duplicate/invalid setup leaves existing state intact;
- captured declarations cannot be mutated into another identity/handler;
- protected immediate calls admit one effect and resume after settlement;
- protect:false deliberately admits independent concurrent callbacks;
- pause/resume, missing controls and remove/stop change only intended state;
- default caught versus explicit rethrown failures produce the correct one event;
- composition callback failure and runtime disposal clear jobs/binding;
- HTTP auth/busy/not-found outcomes remain distinct.

Tests should clean up schedules in finally blocks and release barriers after
assertion failure. Do not rely on OS wall-clock coincidence to prove overlap.
Timezone/cron-boundary qualification is a separate dependency/runtime test;
use the installed dependency/version and intentional daylight-saving examples.

## Corrected Development Contract

The initial audit found catchErrors:false swallowed by a wrapper and missing
stable setup errors/failed-publication cleanup. The focused working corrections
restore explicit rethrow, setup codes and rollback.

The detailed source pass additionally reproduced immediate overlap bypass and
mutable declaration aliasing. Captured declarations and per-job immediate
admission now preserve the stated protect contract. Existing method names and
cron dependency remain; blocked trigger/run returns false and HTTP reports
SCHEDULER_JOB_BUSY. This is a correctness change, not a distributed scheduler.

The focused service/plugin/concurrency/HTTP subset passed 11 tests and 49
assertions on Bun 1.3.14. Those are uncommitted source checks, not proof an old
archive includes the corrections or that a live application was updated.

## Upgrades And Restart

Scheduler definitions are code and process-local. No Scheduler table migration
is introduced by these corrections. Recreate job declarations on app startup;
do not attempt to replay missed domain work by rewriting Scheduler internals.

Apps that relied on swallowed catchErrors:false should deliberately choose the
default caught policy unless runtime-level propagation is intended. Apps
triggering protected busy work must handle false/HTTP 409 rather than assume
every call launches another callback. Do not mutate a definition after register
to reconfigure a live job; unregister and register the intended replacement.

Keep previous deployment/artifact and normal app runtime backups while testing
the actual package upgrade. Source tests are separate from archive public-export
and app-specific operational qualification.

## Related Guides And Next Steps

[Configuration](./configuration.md) explains app-local binding;
[lifecycle](./lifecycle.md) explains dependency-safe shutdown.
[ReactiveDB](../reactive-db/index.md) owns durable app data, and
[AI workflow integration](../ai/torrent-integration.md) shows one consumer's
authority-aware durable boundary. The broader Torrent manual is linked when
its canonical pages exist.

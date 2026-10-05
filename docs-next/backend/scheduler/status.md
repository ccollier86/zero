---
id: zero.scheduler.status
type: reference
audience: [developer, agent, operator]
owner: scheduler
status: draft
visibility: internal
system: scheduler
feature: status-and-inspection
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

# Job Status And Inspection

[Scheduler](./index.md) · [Jobs](./jobs.md) · [Documentation index](../../index.md)

Status describes this process's admitted cron registry. It is not a durable
execution history, result log or count of completed domain operations.

## Read Methods

| Method | Result |
| --- | --- |
| getStatus(name) / get(name) | JobStatus or null for a missing/unregistered job. |
| listJobs() / list() | New array of the currently registered statuses. |
| has(name) | Whether this registry contains the job identity. |

Status records use the identity/pattern captured during registration. They do
not alias the caller's later declaration mutation.

## JobStatus Fields

| Field | Meaning |
| --- | --- |
| name / pattern | Admitted named job and original schedule expression. |
| running | Croner considers its schedule active, including waiting for the next firing. |
| paused | Not scheduled/running and not permanently stopped. |
| stopped | Croner marks scheduling stopped. |
| busy | Croner reports an executing callback. |
| nextRun | Next scheduled date in ISO format, or null when none exists. |
| previousRun | Previous run-start date in ISO format, or null. |

running does not mean the callback is currently working; busy is the relevant
flag. previousRun is not a confirmed success timestamp. A job can be paused
while manually triggered work is busy. A stopped/unregistered job disappears
from this registry after removal, so its historical status is not retained.

When protect:false admits concurrent callbacks, do not use Croner's single busy
flag as an exact in-flight count. Your own domain accounting or durable run
records are needed to inspect independent effects/results.

## Authority And Freshness

Trusted server inspection is app-global. The plugin's HTTP status routes are
Guardian-admin protected. Tenant-scoped server services keep Scheduler behind
the unsafe boundary; the status list can reveal platform job names and must not
be treated as tenant-owned public data.

Read a fresh status when rendering an operational control, but do not use a
prior busy read as a synchronization primitive. The immediate admission
operation owns its per-job guard.

## Related Guides And Next Steps

[Jobs](./jobs.md) explains immediate admission and overlap.
[HTTP API](./http-api.md) defines list/status envelopes.
[Operations](./operations.md) explains events, diagnostics and how status
differs from durable Torrent state.

---
id: zero.inventory.scheduler
type: inventory
audience: [maintainer, agent]
owner: scheduler
status: draft
visibility: internal
system: scheduler
feature: system-inventory
maturity: supported
applies_to: ["Zero 2.1.1 source baseline plus reviewed uncommitted scheduler correction; not a release qualification"]
modes: ["managed server app", "direct Elysia plugin/service composition"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-04"
  evidence_level: source-observed
---

# Scheduler System Inventory

[Systems inventory index](./index.md) · [Documentation index](../../../index.md)

## Audit Identity

This inventory covers the in-process cron service, Elysia administration
plugin, managed app binding, server-service projection, consumers, lifecycle,
errors, and observability. The pinned clean source baseline is `main` commit
`a3a5f726768dac890f241a3899c0a1acb66265d9`, package metadata 2.1.1. The docs
branch was `cd643b5b862f83b4ab40320486e1b89df1154c87`. A focused uncommitted source
delta now corrects the Scheduler error-policy defect recorded by the initial
inspection; it is supplemental evidence, not a qualified package. This audit
did not execute app routes or a package artifact.

## Purpose And Terminology

Scheduler is one app-local, in-process `croner` registry for named recurring
jobs. A job definition supplies a six-field cron expression (or supported cron
alias), callback, and runtime behavior. Register/create adds a live job;
pause/resume changes scheduling; trigger/run requests an immediate execution;
unregister/delete permanently stops and removes it. This service is not a
durable distributed queue or tenant-owned schedule store.

## Features And Documentation Coverage

| Feature | Maturity and modes | Public surfaces | Evidence | Planned/final guide | Review status |
| --- | --- | --- | --- | --- | --- |
| Named cron job registration | Supported; server | `SchedulerService.register`/`create`, `JobDefinition` | `src/scheduler/scheduler-service.ts`, service test | [Scheduler guide](../../../backend/scheduler/jobs.md) | Authored; independent guide review pending |
| Pause/resume and immediate trigger | Supported; server/admin HTTP | `pause`, `resume`, `trigger`/`run` | service/plugin source and tests | [Scheduler guide](../../../backend/scheduler/jobs.md) | Authored; independent guide review pending |
| Status/list/existence | Supported; server/admin HTTP | `getStatus`/`get`, `listJobs`/`list`, `has`, `JobStatus` | service source/test | [Scheduler guide](../../../backend/scheduler/status.md) | Authored; independent guide review pending |
| Removal and shutdown | Supported; server lifecycle | `unregister`/`delete`, `stopAll`/`stop` | service/plugin lifecycle source/tests | [Scheduler guide](../../../backend/scheduler/lifecycle.md) | Authored; independent guide review pending |
| Overlap, timezone, pause, and error options | Supported; server | `JobDefinition.timezone`, `paused`, `protect`, `catchErrors` | types/service source; focused true/false error-policy tests | [Scheduler guide](../../../backend/scheduler/jobs.md) | Authored; independent guide review pending |
| Managed app-local scheduler | Supported; all managed apps | `zero.scheduler`/server route service | app platform services/server services source | [Scheduler guide](../../../backend/scheduler/configuration.md) | Authored; independent guide review pending |
| Standalone Elysia plugin | Supported; advanced composition | `createSchedulerPlugin`, `SchedulerPluginConfig`, `getScheduler` compatibility getter | `scheduler.plugin.ts`, plugin lifecycle test | [Scheduler guide](../../../backend/scheduler/configuration.md) | Authored; independent guide review pending |
| Admin HTTP controls | Supported; Guardian admin | `GET /scheduler/`, `GET /scheduler/:name`, pause/resume/trigger POST routes | plugin source | [Scheduler guide](../../../backend/scheduler/http-api.md) | Authored; independent guide review pending |
| Torrent exact wakes and safety sweeps | Supported internal consumer | app-bound `SchedulerService` passed into Torrent | app/workflow wiring and wake tests | [Scheduler guide](../../../backend/scheduler/operations.md) | Authored; independent guide review pending |
| Notification maintenance | Supported internal consumer | app-bound scheduler passed into notifications | app platform service composition | [Scheduler guide](../../../backend/scheduler/operations.md) | Authored; independent guide review pending |
| Observability | Supported; server | platform scheduler codes/events; stable SchedulerError setup/control codes | service/plugin source and observability code registry | [Scheduler guide](../../../backend/scheduler/operations.md) | Authored; independent guide review pending |

## Public Surface Map

`@zero/framework/scheduler` exports:

- `SchedulerService`, plus working-tree `SchedulerError`/`SchedulerErrorCode`;
- `createSchedulerPlugin` and legacy compatibility getter `getScheduler`;
- `JobDefinition`, `JobStatus`, and `SchedulerPluginConfig`.

`@zero/framework/server` exports the plugin/getter and job/plugin types, not
`SchedulerService`; use the canonical Scheduler subpath for the class. The
working correction also exports the setup error/code through server. See
[`src/scheduler/index.ts`](../../../../src/scheduler/index.ts). The managed
server services expose `zero.scheduler`; app-bound access is preferred because
the compatibility getter returns a service only when exactly one provider is
unambiguous.

The service API is synchronous for registration/control/status, while job
callbacks may return `void | Promise<void>`. Canonical aliases are additive:
`create`→`register`, `delete`→`unregister`, `run`→`trigger`, `get`→`getStatus`,
`list`→`listJobs`, and `stop`→`stopAll`.

The plugin's default route prefix is `/scheduler` and exposes:

- `GET /` list;
- `GET /:name` status;
- `POST /:name/pause`;
- `POST /:name/resume`;
- `POST /:name/trigger`.

All routes invoke Guardian's `requireAdmin()`. There is no browser hook,
packaged scheduler UI, CLI, persistent job-definition API, or public per-tenant
schedule API. `SchedulerPluginRuntimeConfig` exists in the source for managed
composition/testing but is not exported from the package barrel as a named
public type.

## Integration Map

- Managed `createApp()` always constructs one `SchedulerService`, registers it
  in the app runtime, and mounts the plugin. There is no `AppConfig.scheduler`
  enable/disable object in the inspected public app type.
- The scheduler mounts before notifications and Torrent; those systems receive
  the exact app-local instance. Torrent persists deadlines and uses scheduled
  wake/safety work, so Scheduler itself is not their durable source of truth.
- Plugin cleanup stops every job, clears the runtime binding, unregisters the
  compatibility provider, and emits lifecycle events. Job registrations exist
  only in memory and must be recreated during app startup. Working corrections
  also clean up failed composition callbacks before rethrowing their failure.
- Admin HTTP controls use live Guardian admin authority. A tenant-scoped server
  request does not receive Scheduler as a safe tenant service; it is available
  only through the explicit `zero.unsafe.scheduler` boundary. A job callback
  must establish its own actor/system authority before tenant data access.
- `protect` defaults true and delegates overlap prevention to `croner`.
  `timezone` defaults to the system timezone, and `paused` defaults false.
- Stable platform codes cover scheduler start/stop/all-stopped,
  job registered/unregistered, caught failures, and unhandled failures.
  Metadata includes bounded job name/pattern; job payloads and secrets should
  not be logged.

## Configuration Inventory

| Configuration | Type/default and observed behavior | Security/startup effect | Planned section |
| --- | --- | --- | --- |
| Managed app scheduler | No public `AppConfig.scheduler`; always constructed/mounted | App-global server service and Guardian admin routes | `docs-next/backend/scheduler/configuration.md#managed-app` |
| `SchedulerPluginConfig.prefix` | Optional string, default `/scheduler` | Changes admin route mount path in standalone composition | `configuration.md#standalone-plugin` |
| `JobDefinition.name` | Required unique string; duplicate registration throws `SchedulerError` with `SCHEDULER_JOB_ALREADY_REGISTERED` after the working correction | App-global identity, not tenant namespace | `jobs.md#identity` |
| `JobDefinition.pattern` | Required `croner` pattern; documented as six-field or aliases | Parsed during registration; invalid pattern behavior comes from dependency | `jobs.md#schedule` |
| `timezone` | Optional IANA timezone; omitted uses system timezone | Deployment timezone changes can affect omitted behavior | `jobs.md#timezone` |
| `paused` | Optional, default false | Suppresses scheduled runs until resumed; admin route can change live state | `jobs.md#pause-and-resume` |
| `protect` | Optional, default true | Prevents overlapping callbacks within this process | `jobs.md#overlap` |
| `catchErrors` | Optional, default true: catch/report and continue; false reports `scheduler.job.unhandled_failed` then rethrows to the runtime | The false mode can surface an unhandled rejection for a scheduled run and is an explicit availability choice | `jobs.md#error-policy` |

Configuration is code-defined at service/plugin registration time; no scheduler
environment bindings, persisted settings, or Doctor validation were found.
Configuration/app module loading is trusted execution and was not run in this
inventory.

## Evidence And Verification

Implementation observed in
[`src/scheduler/scheduler-service.ts`](../../../../src/scheduler/scheduler-service.ts),
[`src/scheduler/scheduler.plugin.ts`](../../../../src/scheduler/scheduler.plugin.ts),
[`src/scheduler/types.ts`](../../../../src/scheduler/types.ts), managed app
platform services, server route services, tenant-boundary checks, Torrent wake
wiring, and the observability code catalog.

Tests present: two direct scheduler files. The service test covers canonical
aliases, stop, caught failures, and `catchErrors: false` rethrow/observability;
the plugin test covers app-runtime lifecycle. Cross-boundary server-service and
workflow tests reference the service, but no direct test was found for cron
timing, timezone, overlap, or admin routes.

Checks run after the focused correction:
`bun --no-env-file test src/scheduler/scheduler-service.test.ts
src/scheduler/scheduler.plugin.test.ts` initially passed 4 tests/17 expectations;
setup-error and failed-publication regressions now pass 7 tests/24 expectations. The
tests invoke only synthetic paused jobs and the local service/plugin lifecycle;
they do not load app configuration, open a database, call a provider/network,
or qualify a package. Existing documentation was research only; no dedicated
scheduler guide or example app was found.

## Findings

### Detailed Contract Corrections And Manual Evidence

The focused detailed pass on 2026-10-05 reproduced immediate-trigger overlap
despite `protect: true` and retained mutable job declarations changing reported
identity/pattern and callbacks (**1 passed, 2 failed** before correction).
Registration now captures a frozen declaration, and protected immediate
admission rejects busy work without a global lock. `trigger`/`run` still return
booleans; false now distinguishes non-admitted busy work as well as absence.
The admin HTTP route maps busy to `SCHEDULER_JOB_BUSY` / 409 instead of an
incorrect missing-job response, while preserving `NOT_FOUND` / 404.

Controlled promise barriers prove one protected effect, resumed progress after
settlement, explicit unprotected overlap and captured handler/identity. A local
Elysia fixture with a synthetic structural verifier proves anonymous/non-admin
denial, accepted admission, exact busy/not-found distinctions and no second
side effect. It does not qualify real Guardian credentials or a provider.

Executed `bun --no-env-file test src/scheduler/scheduler-concurrency.test.ts src/scheduler/scheduler-http.test.ts src/scheduler/scheduler-service.test.ts src/scheduler/scheduler.plugin.test.ts`:
**11 passed, 0 failed, 49 assertions** with Bun 1.3.14. Evidence:
[service](../../../../src/scheduler/scheduler-service.ts),
[transport](../../../../src/scheduler/scheduler.plugin.ts),
[concurrency regressions](../../../../src/scheduler/scheduler-concurrency.test.ts)
and [HTTP regressions](../../../../src/scheduler/scheduler-http.test.ts).
This supplements the original clean baseline as uncommitted corrected source.

The [Scheduler manual](../../../backend/scheduler/index.md) now provides eight
focused pages covering the complete inventoried public service/plugin/control
surface, configuration, status, cleanup, operations and roadmap. Independent
detailed-guide review and committed/artifact qualification are pending.

| Severity/category | Finding | Evidence/affected behavior | Required discussion/disposition |
| --- | --- | --- | --- |
| Resolved correctness | `catchErrors: false` was swallowed by an unconditional wrapper | `src/scheduler/types.ts`, `scheduler-service.ts`, focused service tests; all service modes | Local correction reports `scheduler.job.unhandled_failed`, rethrows the same failure to Croner/runtime, and proves default catch remains one caught event. Package qualification remains pending |
| Resolved error contract | Duplicate, invalid registration and post-disposal setup lacked domain error codes | New `SchedulerError`/code exports; focused duplicate/invalid tests | Working correction adds stable setup codes; existing missing-job HTTP NOT_FOUND envelope preserved |
| Resolved lifecycle | Publication callback failure could retain runtime binding and scheduled work | Synthetic callback throws after paused job setup | Working plugin cleans jobs/binding and unregisters cleanup before rethrow; no partial service remains |
| Medium test coverage | Only aliases and plugin cleanup have direct tests | two direct test files | Add pattern/timezone/pause/protect/error/admin route/lifecycle coverage before implementation verification |
| Scope boundary | Scheduler is process-local, app-global, non-persistent, and unsafe in tenant-scoped services | app wiring/server request boundary | State prominently; use Torrent/durable state where recovery matters |
| Documentation gap | No dedicated scheduler guide/example or Doctor support was found | repo documentation/source search | Create planned guides; do not claim diagnostics that do not exist |
| Release evidence | Source presence does not qualify the packaged export or dependency behavior | no artifact/runtime checks | Package/runtime qualification remains separate |

## Known Future Plans

No approved Scheduler expansion was found in the canonical platform roadmap.
Persisted/tenant-owned/distributed scheduling is therefore not a current promise
and should not be inferred from Torrent's durable deadline behavior. Record any
approved future work once in `docs-next/backend/scheduler/roadmap.md`, with
provenance and status.

## Navigation And Cross-Link Plan

Parent: `docs-next/_work/audits/systems/index.md`. Planned public home:
`docs-next/backend/scheduler/index.md`, with jobs, status, lifecycle,
configuration, HTTP API, operations, testing, migration, and roadmap pages.
Cross-link Guardian admin authority, server services and unsafe tenant boundary,
Torrent timing/recovery, notifications, observability, deployment timezone and
multi-process limitations.

## Independent Inventory Review

Root checked service aliases, plugin HTTP/lifecycle, managed mounting, public
barrels and job options. Corrected the false server re-export claim for the
service class and an inaccurate callback comment (callbacks receive no job
name argument). Independently reproduced and fixed failed-publication cleanup;
added setup errors without changing missing-job HTTP compatibility.
Archive qualification and timed Croner behavior remain separate evidence.

## Completion Review

- [x] Public service/plugin/type/route surfaces and managed app binding recorded.
- [x] Guardian, server-service, Torrent, notification, lifecycle, and observability integrations traced.
- [x] Tests present and checks actually run distinguished.
- [x] `catchErrors` defect corrected and focused true/false behavior tested.
- [x] Specify stable setup errors while preserving NOT_FOUND HTTP compatibility.
- [ ] Package/runtime behavior qualified on a committed disposable fixture.
- [ ] Whole-platform independent review completed.

Follow the [documentation process](../../../documentation-process.md) before
marking this inventory verified or beginning detailed feature rewriting.

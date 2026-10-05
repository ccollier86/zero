---
id: zero.scheduler.http-api
type: reference
audience: [developer, agent, operator]
owner: scheduler
status: draft
visibility: internal
system: scheduler
feature: admin-http-controls
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

# Scheduler Administration HTTP API

[Scheduler](./index.md) · [Configuration](./configuration.md) · [Documentation index](../../index.md)

The named Elysia plugin mounts an admin-only route group at /scheduler by
default. All routes resolve Guardian authority and call requireAdmin(), whose
compatibility contract requires the live global role admin. Organization
membership or a tenant role alone does not grant this application-global access.

## Routes And Results

Paths below are relative to the configured prefix.

| Method/path | Result |
| --- | --- |
| GET / | { jobs: JobStatus[] } |
| GET /:name | { job: JobStatus } |
| POST /:name/pause | { ok: true } after schedule pause |
| POST /:name/resume | { ok: true } after schedule resume |
| POST /:name/trigger | { ok: true } after immediate admission, not callback completion |

name is a nonempty path string. There is no built-in HTTP route to register
executable callbacks, change a schedule definition, delete jobs or inspect
callback result payloads. Use trusted app code for those capabilities.

Missing credentials reject 401; an authenticated non-admin rejects 403.
A missing job uses the established NOT_FOUND / 404 error envelope.
A protected busy immediate trigger rejects SCHEDULER_JOB_BUSY / 409 instead of
pretending the job was absent or accepting overlapping work.

The domain error projection contains error and code. Do not depend on human
message strings for program logic. A job's later callback failure is emitted
through observability; it does not retroactively change an already returned
admission response.

## Transport And App Isolation

Use the application's authenticated transport and app-local plugin/service.
An admin control must not accept an arbitrary service or tenant database
selector from the browser. A deployment with multiple replicas has independent
in-process Scheduler registries; invoking one route controls the serving
process's registry, not a distributed job owner.

The Scheduler package does not supply a browser hook or prefab dashboard.
An app can build a small administrative view over these endpoints and the
[status reference](./status.md), but should not publish the registry to ordinary
tenant members.

## Verification

The local Elysia fixture uses a synthetic standalone verifier and controlled
callback barrier. It proves missing/non-admin denial, accepted admission, exact
busy 409, missing 404 and no second side effect. It is not a real Guardian
credential/account or published archive qualification.

## Related Guides And Next Steps

[Jobs](./jobs.md) owns pause/overlap/error behavior.
[Status](./status.md) owns field meaning, and [operations](./operations.md)
owns error codes, events and upgrade checks.

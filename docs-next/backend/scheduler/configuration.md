---
id: zero.scheduler.configuration
type: reference
audience: [developer, agent, operator]
owner: scheduler
status: draft
visibility: internal
system: scheduler
feature: configuration
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

# Scheduler Configuration And Composition

[Scheduler](./index.md) · [Platform configuration](../configuration/index.md) · [Documentation index](../../index.md)

Managed Zero creates one app-local SchedulerService and mounts its plugin
before notification/Torrent consumers. No public scheduler enable/disable
object, persisted job settings table or scheduler-specific environment binding
exists. Job behavior is declared when trusted server code registers the job.
This describes implemented 2.11.0 source/local APIs. Match the exact installed
commit/archive and deployment topology to its provenance and qualification
receipt; a version number alone is not deployment approval.
The optional [durable jobs configuration](./durable-jobs.md) is separate from
this always-present local timer registry.

## Managed App

Use the actual app-local service. The compatibility getScheduler() getter
returns the only unambiguous mounted provider, or null; it is not a multi-app
selection mechanism. Avoid non-null assertions on a global getter inside
request or extension code.

Callbacks may start scheduling as soon as a Croner job is constructed, before
an application has published its HTTP listener. Register data-dependent work at
the correct extension lifecycle phase, or start paused and resume after the
necessary services are ready. Do not assume a code-defined timer automatically
waits for a database migration or app readiness.

The platform [resolution reference](../configuration/resolution.md) distinguishes
trusted startup configuration from live state. Job pause/resume are live
controls; changing a declaration requires deliberate unregister/re-register.

## Standalone Plugin

Public SchedulerPluginConfig contains prefix, default /scheduler.
createSchedulerPlugin additionally accepts its typed runtime-composition
parameters: runtime, getTokenService, onServiceCreated and service.
SchedulerPluginRuntimeConfig is not separately named-exported from the package
barrel; the factory's parameter type is the supported structural call surface.

| Option | Effect |
| --- | --- |
| prefix | Mount the admin route group at a different path. |
| service | Use a supplied SchedulerService instead of constructing one. The plugin owns cleanup of its jobs. |
| getTokenService | Inject this app's live TokenService dependency instead of compatibility lookup. |
| runtime | Bind/clear the app-local runtime service and register composition cleanup. |
| onServiceCreated | Publish the service synchronously while composing; failure cleans partial jobs/binding before rethrow. |

Plugin composition fragment for an already authorized server boundary:

```ts
import { Elysia } from "elysia";
import { SchedulerService, createSchedulerPlugin } from "@zero/framework/scheduler";

const scheduler = new SchedulerService();
const app = new Elysia().use(createSchedulerPlugin({
  prefix: "/operations/scheduler",
  service: scheduler,
  getTokenService: () => appTokenService,
  onServiceCreated(service) {
    service.register({
      name: "maintenance",
      pattern: "0 */15 * * * *",
      paused: true,
      run: () => runAuthorizedMaintenance(),
    });
  },
}));
```

appTokenService and runAuthorizedMaintenance are required app-owned dependencies,
not exported globals. This fragment does not start a server or create an admin.
The normal createApp path already mounts Scheduler; do not mount a second
registry merely to access its service.

## Public Packages

`SchedulerServiceOptions` is exported on the canonical scheduler entry:
`observability` selects an explicit app-local observability runtime, and
`shutdownGraceMs` configures cooperative close (default 5000 ms; 0–30000).
Managed construction supplies its own observability runtime automatically.
Standalone callers omitting it retain ambient compatibility. Two managed apps
must not publish each other's job events through whichever sink was configured
last. Verify installed exports against the exact artifact's qualification receipt.

@zero/framework/scheduler exports SchedulerService, createSchedulerPlugin,
getScheduler, SchedulerError and JobDefinition/JobStatus/plugin/error types,
plus `SchedulerRunContext` and `SchedulerServiceOptions`.
@zero/framework/server re-exports the plugin/getter, types and working setup
error surface, but not SchedulerService itself. Use the canonical subpath for
the class instead of an internal file import.

The root server `JobDefinition` remains this local timer declaration. Durable
definitions use `DurableJobDefinition` at `@zero/framework/server`, or
`JobDefinition` at `@zero/framework/jobs`; use the matching type when adopting
the optional durable service.

A tenant request's unsafe scheduler access is a deliberate application-global
capability. Do not expose it through a tenant selector or pass the entire
registry into an end-user tool. A job wanting durable scoped execution should
invoke the intended actor/system Torrent boundary.

## Related Guides And Next Steps

[Jobs](./jobs.md) owns schedule and error policy; [lifecycle](./lifecycle.md)
owns stop/cleanup. [HTTP API](./http-api.md) owns admin transport.
See runtime [lifecycle](../runtime/lifecycle.md) and
[shutdown](../runtime/shutdown.md) before registering dependency-sensitive jobs.

---
id: zero.scheduler.lifecycle
type: reference
audience: [developer, agent, operator]
owner: scheduler
status: draft
visibility: internal
system: scheduler
feature: removal-and-shutdown
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

# Scheduler Lifecycle And Shutdown

[Scheduler](./index.md) · [Configuration](./configuration.md) · [Documentation index](../../index.md)

Scheduler owns future cron firing and job-map entries. It does not implicitly
abort app callback work, wait for remote effects, persist a queue or recover
missed executions.

## Remove And Stop

unregister(name), and its delete alias, permanently stops that schedule and
removes the entry. It returns true when a job existed and false when absent.
Recreating the same name requires a new registration; resume cannot resurrect
a removed Croner instance.

stopAll(), and its stop alias, stops every admitted schedule and clears the
registry. These methods return void. A later direct service registration can
create new work; stopAll is not a permanent-disposal state on SchedulerService.

An already executing callback is app work: stopping its timer does not cancel
or synchronously drain it. If the callback uses services about to be disposed,
the app must fence/abort/drain that work through its own lifecycle or use the
durable workflow service.

## Plugin Ownership

The plugin binds the service to its app runtime while composing and publishes
the compatibility getter when Elysia starts. Startup after the owning runtime
was already disposed rejects SCHEDULER_STOPPED rather than reattaching a partial
service.

On stop/runtime cleanup, the plugin stops every job, clears the matching runtime
binding and unregisters its compatibility provider. Cleanup is idempotent.
A synchronous onServiceCreated failure performs the same rollback before
rethrowing; no scheduled jobs or stale runtime binding remain.

If you supply a service to the plugin, the plugin still owns clearing its jobs.
Do not attach one shared registry to independent applications and expect one
application's shutdown to leave the other's jobs intact.

## Dependency-Safe Shutdown

Managed Zero orders service cleanup, but arbitrary callback promises are not a
general extension drain. Register extension-owned work so its own
onBeforeStop/cleanup protocol stops intake, cooperatively cancels and awaits
the intended operations before their dependencies disappear.

Torrent separately drains/fences durable attempts under its configured grace
policy. Scheduler merely provides its wake/safety timers. A cron callback that
starts a durable workflow should establish the intended actor/system authority
at that boundary rather than copy a browser session into a timer closure.

## Related Guides And Next Steps

The runtime [lifecycle](../runtime/lifecycle.md) and
[shutdown](../runtime/shutdown.md) guides own the application-wide order.
[Jobs](./jobs.md) distinguishes pause from cancellation;
[operations](./operations.md) explains restart and verification.

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

# Scheduler Lifecycle And Shutdown

[Scheduler](./index.md) · [Configuration](./configuration.md) · [Documentation index](../../index.md)

Scheduler owns future cron firing, job-map entries and terminal cooperative
shutdown. This is not remote-effect cancellation, persistent queuing or
missed-execution recovery. These are implemented 2.11.0 source/local APIs;
match the exact installed artifact and deployment topology to its provenance
and qualification receipt. A version number alone is not deployment approval.

## Remove And Stop

unregister(name), and its delete alias, permanently stops that schedule and
removes the entry. It returns true when a job existed and false when absent.
Recreating the same name requires a new registration; resume cannot resurrect
a removed Croner instance.

Trusted-server `unregister(name, expectedRun)` removes the schedule only if its
currently registered callback is that exact function reference. Use this optional fence
when a subsystem retires its own timer: a later replacement under the same name
must remain untouched. The ordinary one-argument and HTTP contracts are unchanged;
the callback is an ownership fence, not a credential or a serializable API input.
When upgrading an older archive, verify this additive export/behavior against
the exact installed artifact rather than assuming version-name equivalence.

stopAll(), and its stop alias, stops every admitted schedule and clears the
registry. These methods return void. A later direct service registration can
create new work; stopAll is not a permanent-disposal state on SchedulerService.

An already executing callback is app work: `stopAll()` alone does not cancel or
drain it. This compatible synchronous method remains distinct from `close()`.

## Terminal Close

`close(): Promise<void>` permanently stops registration and timers, aborts the
`signal` passed to each active callback, and observes callback settlement.
Repeated calls return the same close promise. Managed plugin/runtime cleanup
awaits this boundary; it does not merely clear the registry and forget work.

`new SchedulerService({ shutdownGraceMs })` sets the bound: 5000 ms by default,
integer 0–30000. A callback ignoring abort is **not** reported as stopped after
that deadline. Close rejects `SCHEDULER_DRAIN_TIMEOUT`; `diagnostics().active`
continues counting it until it actually settles, and new registration stays
closed. No automatic replay or claim of rolled-back external effects follows.
There is no subprocess termination or CPU isolation in this local service.

No-argument callbacks remain valid. New callbacks may use `run: async ({ signal })
=> { ... }` and pass the signal to their own cancellable I/O. Do not use a timer
callback for unbounded CPU work; use the registered worker/Torrent boundary and
qualify its actual deployment containment.

## Plugin Ownership

The plugin binds the service to its app runtime while composing and publishes
the compatibility getter when Elysia starts. Startup after the owning runtime
was already disposed rejects SCHEDULER_STOPPED rather than reattaching a partial
service.

On stop/runtime cleanup, the plugin closes the scheduler, clears the matching
runtime binding and unregisters its compatibility provider. Cleanup is idempotent
and its returned promise observes drain failure rather than pretending success.
A synchronous onServiceCreated failure performs the same rollback before
rethrowing; no scheduled jobs or stale runtime binding remain.

If you supply a service to the plugin, the plugin still owns its terminal close.
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

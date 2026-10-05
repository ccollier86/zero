---
id: zero.runtime.lifecycle
type: architecture
audience: [developer, agent, operator]
owner: platform-runtime
status: draft
visibility: internal
system: platform-runtime
feature: startup-failure-cleanup
maturity: supported
applies_to: ["2.1.1 source; new documentation under review"]
modes: [managed-server]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Startup, Readiness And Failed Construction

[Runtime index](./index.md) · [Documentation index](../../index.md)

`createApp(config)` is asynchronous composition. Await it before calling
`listen`; successful construction and a live listener are separate stages.
An app-local runtime owns concrete services and their cleanup, rather than
publishing one ambient mutable “current app.”

## Construction Sequence

The inspected managed path performs these dependent stages:

1. Resolve configuration and validate database/path/Guardian-reference admission.
2. Open application/system SQL services and reject a prohibited legacy combined layout.
3. Bind app-local observability/email and compose declared resources/policies.
4. Build optional frontend assets.
5. Open/migrate the system runtime, then the application runtime.
6. Compose topology, identity projections and tenant data readiness.
7. Mount Sync and platform services, discover/apply app extensions, and install automation/lifecycle boundaries.
8. Return the composed Elysia app; listening starts its registered onStart work.

This is an architectural sequence, not a promise that every optional service
is usable at module import time. Lazy setup getters may be retained before a
service exists; required values must be checked at the correct readiness stage.

## Degraded Assets Versus Failed Backend Admission

Client bundle failure is reported by `APP_CLIENT_BUNDLE_FAILED` and can leave
SSR-only operation. Stylesheet failure uses `APP_STYLES_FAILED` and can leave
unstyled pages. They are distinct from rejected database/auth/resource admission.

Do not treat a started listener as proof that a frontend is hydrated or every
asset exists. Conversely, do not report an optional asset warning as a database
corruption failure. Keep operational checks specific to the feature required.

## Own Partial Setup

The internal runtime registers cleanup in construction order and disposes in
reverse order so dependants stop before providers. Disposal joins async cleanup,
collects failures and clears owned registrations. Repeated calls join the same
disposal promise.

The database bootstrap tracks which resources it acquired and whether it owns
injected SQL services. A construction failure attempts cleanup of owned resources;
it does not close an unrelated replacement or caller-owned service merely
because both share an API type.

When teardown also fails, an `AggregateError` preserves the startup and cleanup
failures. Do not replace that with a successful return or a retry against a
partially open runtime.

`ZeroAppRuntime` is an internal implementation owner, not a constructor exported
from `@zero/framework/server` for applications to instantiate. Applications use
`createApp` and the [public extension contracts](./plugins.md).

## Extension Responsibilities

Await dependency setup and handler registration before returning a ready plugin.
Own subscriptions/timers/tasks explicitly and release them on stop. A failed
setup must not leave detached tasks running against services that startup is
about to dispose.

For scheduled or durable work, use the corresponding platform service and its
defined readiness/recovery registration phase. `setTimeout` after setup is not
a substitute for recovery ordering. A narrow service constructor should not
perform deployment/data migration as a hidden side effect.

## Verification

Use synthetic plugin failures and disposable stores to check:

- failure before and after acquiring each dependency;
- correct ownership of injected services;
- no remaining task/timer after rejected construction;
- independent apps cannot read/clear one another's registrations;
- startup and cleanup errors remain observable.

These checks need fixture scope. Importing a real app config or running Doctor
executes trusted app code; it is not a read-only static documentation test.

## Related Guides And Next Steps

- [Composition](./composition.md) shows the minimal async entry point.
- [Discovery](./discovery.md) identifies executable extension imports.
- [Shutdown](./shutdown.md) joins app work before provider disposal.
- [Observability](./observability.md) separates safe operational events from raw failures.

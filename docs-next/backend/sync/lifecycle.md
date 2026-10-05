---
id: zero.sync.lifecycle
type: operations
audience: [developer, agent, operator]
owner: sync
status: draft
visibility: internal
system: sync
feature: lifecycle
maturity: supported
applies_to: ["2.1.1 source baseline; package qualification pending"]
modes: [single, multi, default-plane, system-plane, tenant-database]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Sync Lifecycle And Operational Signals

[Sync index](./index.md) · [Documentation index](../../index.md)

A connection is identified by the stable Bun raw socket, not Elysia's fresh
callback wrapper. open/message/close/drain share that identity and mutable
raw socket state. This is necessary for auth single-flight, timer cleanup,
subscription ownership and outbound drain.

## Close And Disposal

Close retires active tracking, handshake/revalidation timers, ephemeral state,
tenant capabilities and drain waiters. Plugin disposal prevents new admission
and tears down its owned transport/database work. An injected ReactiveDB is not
closed unless ownsReactiveDB:true.

Pending token verification or policy lookup may settle after close. Lifecycle
checks before and after asynchronous authority resolution ensure its result
cannot mark a closed socket authorized or restart a timer.

## Backpressure And Failure

Bun send status distinguishes accepted/queued/dropped sends. A dropped send
closes with 1013 instead of silently continuing a corrupted client stream.
Chunk transfers wait for drain; close rejects those waits. Replica history
invalidation closes with a recoverable service-restart signal; transport
contract violations require an explicit baseline/loading correction.

Managed events use the owning app's observability runtime and standard Sync
codes. Record event identity/stage/plane, not bearer tokens or private row data.
Custom policy diagnostics should remain bounded and value-safe.

## Operational Checks

Exercise a real connection when qualifying a release: normal auth, snapshot,
live update, revocation, concurrent message single-flight, disconnect during
pending verification and disposal during policy lookup. A passing unit test or
documentation source inspection alone does not prove a deployed socket lifecycle.

See [runtime shutdown](../runtime/shutdown.md),
[observability](../observability/index.md), [authentication](./authentication.md),
[configuration](./configuration.md) and [Fabric lifecycle](../fabric/recovery.md).

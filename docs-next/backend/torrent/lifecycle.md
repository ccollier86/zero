---
id: zero.torrent.lifecycle
type: reference
audience: [developer, agent, operator]
owner: torrent
status: draft
visibility: internal
system: torrent
feature: lifecycle
maturity: supported
applies_to: ["2.1.1 source baseline; not installed-package qualification"]
modes: ["authenticated single-tenant app", "Guardian multi-tenant app", "explicit trusted server composition"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Pause, Resume, Cancel And Shutdown

[Torrent](./index.md) · [Retries and time](./retries-and-time.md) · [Documentation index](../../index.md)

WorkflowStatus is pending, running, completed, failed, cancelled or paused.
StepStatus additionally distinguishes waiting and skipped. Waiting is a node
state, not a separate run status.

## Pause And Resume

pause(instanceId, scope?, mutation?) accepts a running instance. It stops
dispatch, durably marks pause, disarms wakes and aborts/fences current handler
and interaction attempts. A returned async result cannot overwrite paused state.

A received event may remain inboxed while paused, but must not execute the
waiting handler. Resume reopens eligible work after prior physical attempts/
interaction operations drain and preserves paused timing boundaries.
WORKFLOW_DRAINING is a retryable 409 when work still settles; do not force a
second attempt merely because the UI pause button completed.

Pause cannot rescue an already-expired deadline. Resume requires paused state,
and duplicate/illegal state transitions fail rather than silently resetting
attempt counters.

## Cancel

cancel/stop ends a nonterminal run, marks unfinished steps skipped, clears
retry/deadline queues, disarms wakes and aborts active work. Completed/skipped
steps remain historical progress. A cancelled wait cannot be reopened by a
late event/validator result.

Cancel is not remote rollback. A side effect may have been accepted by an
external provider; use logical idempotency and business reconciliation.

## Managed Shutdown

The plugin/runtime stops intake, removes its owned Scheduler jobs, aborts/fences
physical attempts, drains within shutdownGraceMs and releases its exact runtime
lease before Guardian/Fabric/database dependencies disappear.
dispose() is awaited and idempotently shares one disposal promise. Cleanup
failures are retained/aggregated, not waved through as successful shutdown.

The default grace is 30 seconds; zero means no cooperative wait allowance, not
permission to commit late results. Uncooperative external promises may settle
after a fence; they cannot reactivate local state or retained services.

Use [runtime shutdown](../runtime/shutdown.md) for extension drain ordering.
A standalone Elysia plugin installs a stop barrier; explicit low-level service
composition must arrange awaited disposal itself.

## Verification

Hold a handler/validator at a controlled promise, pause/cancel/stop, then release
it and assert state/output/memory did not revive. Test paused early event,
resume while draining, expired deadline, shutdown callback failure and ownership
release before opening a replacement. Do not infer real remote cancellation
from local AbortSignal delivery.

Related: [recovery](./recovery.md), [events](./events.md),
[authority](./authority.md), [operations](./operations.md).

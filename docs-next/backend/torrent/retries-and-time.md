---
id: zero.torrent.retries-and-time
type: reference
audience: [developer, agent, operator]
owner: torrent
status: draft
visibility: internal
system: torrent
feature: retries-and-time
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

# Attempts, Backoff, Deadlines And Wake Scheduling

[Torrent](./index.md) · [Activities](./activities.md) · [Documentation index](../../index.md)

retries is the total attempt budget including the first call, not the number
of additional calls. Its default is 3 and registration ceiling is
MAX_WORKFLOW_ATTEMPTS = 1,000. ctx.attempt is zero-based for physical attempts.

## Failure Ordering

A failed step awaiting retry remains a required predecessor. Later dependent
nodes do not execute past it. Independent explicit parallel branches may still
make progress. Retry state/availability is durable, not a transient setTimeout
closure lost on restart.

backoffMs defaults 1,000; exponential delay is capped at five minutes.
timeoutMs is optional and establishes a durable step/wait deadline. A newly
active wait receives its deadline at activation. Invalid options fail
registration instead of using undefined timer behavior.

A timeout aborts/fences the current attempt and prevents its late result/
memory from committing. External work already accepted remotely cannot be
rolled back; its idempotency key remains necessary.

## Exact Wake And Polling

The service uses exact in-process retry/deadline wakes through WorkflowWakeTimer,
with Scheduler safety/recovery sweeps in managed composition.
WorkflowServiceOptions.wakeTimer: false selects poll-only lower-level operation;
it is not a public AppWorkflowsConfig setting.

pollRetries and pollTimeouts are service maintenance methods. Do not install
independent app loops on managed Torrent simply to compensate for a UI that
expects immediate state. A wake is a scheduling hint; durable authority/state
still decides whether work can run.

A manual WorkflowClock and timer seam allow deterministic tests. Clock jumps,
early wakes and stale callbacks must not run a step outside its eligible state.

## Pause And Restart

Pause stops dispatch, aborts/fences active attempts and records pause state.
Resume respects drained-attempt lifetime and preserves unfinished timing by
adjusting paused deadlines/retry boundaries. It cannot convert an already
expired deadline into a successful pause. Restart recovery reloads the pinned
graph and durable attempt state, not the current mutable authoring definition.

Verify retry/deadline boundary ordering, timeout while awaiting an external
promise, pause during wait, early event retention and owner replacement.
[Lifecycle](./lifecycle.md) and [recovery](./recovery.md) explain those fences.

Related: [control flow](./control-flow.md), [events](./events.md),
[Scheduler](../scheduler/index.md), [operations](./operations.md).

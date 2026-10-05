---
id: zero.torrent.operations
type: operations
audience: [developer, agent, operator]
owner: torrent
status: draft
visibility: internal
system: torrent
feature: operations
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

# Torrent Errors, Observability And Verification

[Torrent](./index.md) · [Runtime observability](../runtime/observability.md) · [Documentation index](../../index.md)

WorkflowError carries code, status and retryable (default false).
workflowNotFound is the hidden/missing 404 boundary. Distinguish rejected start,
failed step, ambiguous external effect and retryable drain.

## Stable Error Families

Table suffixes use WORKFLOW_ except memory/interaction explicitly shown:

| Codes/family | Meaning |
| --- | --- |
| NOT_READY, DRAINING, STARTUP_FAILED, CONFIG_INVALID | Composition/readiness or settling attempts. |
| NOT_FOUND, DEFINITION_NOT_FOUND, VERSION_NOT_FOUND | Missing/hidden selection. |
| DEFINITION_INVALID, DEFINITION_GRAPH_INVALID, GRAPH_INVALID | Malformed declarations/graph. |
| VERSION_CONFLICT, VERSION_SOURCE_CONFLICT, VERSION_SCOPE_CONFLICT, VERSION_HISTORY_INVALID, DRAFT_CONFLICT | Publication/optimistic editor conflict. |
| HANDLER_NOT_REGISTERED, ACTIVITY_NOT_REGISTERED, ACTIVITY_NOT_ALLOWED | Missing exact code or databaseCallable gate. |
| ACTIVITY_INPUT_INVALID, ACTIVITY_OUTPUT_INVALID, INPUT_INVALID, OUTPUT_INVALID | Schema/JSON runtime validation. |
| ATTEMPT_STALE, STATE_INVALID | Stale completion/private-state inconsistency. |
| WORKFLOW_MEMORY_KEY_INVALID, VALUE_INVALID, LIMIT_EXCEEDED, CONFLICT | Scratch errors; each abbreviated suffix uses WORKFLOW_MEMORY_. |
| WORKFLOW_INTERACTION_NOT_FOUND, EXPIRED, CLOSED, FORBIDDEN, INVALID, SUBMISSION_CONFLICT, SUBMISSION_LIMIT, REJECTION_LIMIT | Response identity/policy/lifecycle/budget; each suffix uses WORKFLOW_INTERACTION_. |
| EVENT_INVALID, EVENT_IDEMPOTENCY_INVALID, EVENT_IDEMPOTENCY_CONFLICT, EVENT_QUEUE_FULL, EVENT_LIMIT_EXCEEDED | Event/receipt/capacity admission. |
| FANOUT_LIMIT_EXCEEDED, RUNTIME_LIMIT_EXCEEDED | Array or durable-value budget. |
| RUNTIME_OWNED, RUNTIME_LEASE_LOST | Conflicting/stale runtime owner. |
| AUTHORITY_REQUIRED, AUTHORITY_CHANGED, SCOPE_REQUIRED, SCOPE_INVALID | Missing/revoked authority/scope. |
| REQUEST_INVALID, REQUEST_PARSE_FAILED, INTERNAL_ERROR | Safe HTTP failures. |

Use exact code/status, not substrings of handler messages. HTTP 5xx messages
are generic. Bounded private handler errors are still not safe public progress.

## Observability

createWorkflowObservability(db?, runtime?) supplies emitNow/emitAfterCommit.
Managed events bind to that app's runtime; missing setup fails instead of
leaking to another app's global sink. State notifications defer until commit;
rolled-back transitions cannot emit successful lifecycle facts.

Standard workflows.* events cover initialized/startup/recovery/publication,
owner acquired/conflict/heartbeat_failed/lost/released; definition
published/activated/retired; instance started/completed/failed/paused/resumed/
cancelled; step retry_scheduled/timed_out; handler missing/advance failure;
system_event delivered/replayed/conflict/delivery_failed; node/choice/parallel/
each progress; memory conflict/limit rejection; interaction lifecycle.

Operational metadata can include app-scoped run/step/node IDs, counts and
bounded reasons. These are not blanket low-cardinality metric labels: do not
use IDs as labels. Never log input/output, prompts, OTPs, keys, private responses
or memory values. HTTP failures use safe request path/method/status.

## Capacity And Operations

Definitions have a 2-MiB envelope bound; one runtime JSON value is 1 MiB.
Accounted instance/step/fan-out/memory/interaction values are bounded at 32 MiB
per instance, separately from events. These limits are not total SQLite disk,
process RAM or provider-spend quotas. Events, arrays and memory have additional
dedicated policies in their guides.

Quota rejection is atomic with its runtime mutation. Do not bypass accounting
with private raw writes or delete history to force startup.

## Focused Verification

Use synthetic definitions/state, fake adapters and controlled timers/promises:
version pinning; databaseCallable; retry predecessor; early wait/deadline; response
idempotency; parallel/item order; memory commit/conflict/discard; owner expiry;
pause/cancel late results; live revocation; safe progress; awaited shutdown.

Repository examples of focused suites:
workflow-graph-foundation.test.ts, workflow-memory-store.test.ts,
workflow-graph-runtime.test.ts, workflow-each-controller.test.ts,
workflow-system-event-delivery.test.ts, workflow-lifecycle-regression.test.ts
and frontend workflow hooks. Some integration tests create disposable DB files/
servers; inspect scope before running, never substitute a live app directory.

Passing development checks is not committed-artifact/provider/deployment
qualification. Preserve pins/backups until restart acceptance passes.
Related: [recovery](./recovery.md), [HTTP](./http-api.md),
[authority](./authority.md), [lifecycle](./lifecycle.md).

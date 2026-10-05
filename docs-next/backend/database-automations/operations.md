---
id: zero.database-automations.operations
type: reference
audience: [developer, agent, operator]
owner: reactive-db
status: draft
visibility: internal
system: database-automations
feature: operations
maturity: supported
applies_to: ["2.1.1 source baseline; not installed-package qualification"]
modes: ["pinned application database", "Fabric realm database"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Database Automation Errors And Operations

[Database automations](./index.md) · [Runtime observability](../runtime/observability.md) · [Documentation index](../../index.md)

Separate declaration admission, source transaction failure and asynchronous
delivery failure. A successful origin commit means its durable command exists,
not that every external effect has completed.

## Definition Errors

@zero/framework/database-automations exports AUTOMATION_ERROR_CODES,
AutomationError, isAutomationError and isAutomationErrorCode.
The closed codes are AUTOMATION_DEFINITION_INVALID plus the five validation
codes in [validation](./validation.md). retryable is false. details are bounded
scalar metadata, not exception payloads.

Messages are at most 1,024 characters; detail entries at most 16, keys bounded
to 64 identifier characters and strings to 256. Prototype keys and nonfinite
numbers are excluded. A private cause can be retained but must not be copied
into a public error response. Authoring does not automatically select HTTP
status codes or log user data.

## Runtime Outcomes

| Code | Context and next action |
| --- | --- |
| DATABASE_CONFIG_INVALID | Invalid managed registry/storage/runtime configuration; repair before startup. |
| DATABASE_SCHEMA_MISMATCH | Private outbox/schema incompatibility; stop and reconcile the actual artifact/schema. |
| DATABASE_EXECUTOR_FAILED | Safe wrapped handler/storage failure; inspect private authorized cause separately. |
| DATABASE_PAYLOAD_LIMIT | Input or per-root cascade budget exceeded; reduce admitted work. |
| DATABASE_BACKPRESSURE | Active outbox capacity; drain/repair downstream work before admitting more. |
| DATABASE_CAPACITY_EXHAUSTED | Stored delivery capacity; inspect retention/accounting, not manual row deletion. |
| DATABASE_CONFLICT | Delivery identity reused for a different command. |
| DATABASE_CLOSED | Retained/closed capability or runtime use. |
| DATABASE_OPERATION_UNSUPPORTED | Unavailable service or write through a read-only registered capability. |

DatabaseError also carries retryable and outcome. Read these instead of
classifying every exception as a safe retry. A transaction failure rolls back
origin/cascades/outbox. An external effect can have an ambiguous completion;
idempotency is required.

Worker stored failure codes include AUTOMATION_HANDLER_FAILED and
AUTOMATION_FUNCTION_UNAVAILABLE. Private exception text is not copied into
queue diagnostic metadata. A terminal dead command requires business
reconciliation; no supported public redrive endpoint exists.

## Events And Privacy

Managed emitters use these standard event names:

- database.automation_dispatcher.started / .stopped
- database.automation_dispatch.failed
- database.automation_delivery.recovered / .claimed / .completed
- database.automation_delivery.retry_scheduled / .dead_lettered / .lease_lost
- database.automation_manifest.drift
- database.automation_execution.abandoned
- database.automation_service.cleanup_failed

Lifecycle metadata contains sourceKind, attempt, aggregate requeued/dead and
bounded reason—not tenant/run/delivery IDs, rows, payloads or thrown handler
messages. Detailed app-level correlation belongs in an explicitly authorized
business/audit system, not metric labels.

Observability callback failure must not alter successfully committed queue
state. Source and handler diagnostics should be associated with the app-local
runtime, not a process-global compatibility getter in multi-app deployments.

## Doctor

Doctor's configured checks inspect registry identity, schema/manifests,
canonical fingerprints and durable-infrastructure readiness without executing
handlers. Optional supplied actor fingerprints and aggregate health extend that
evidence; absence of runtime samples is not proof of cluster health.

Diagnostic families under database.automations:

| Suffix/family | Meaning |
| --- | --- |
| not_configured | Realm has no registry; informational. |
| registry_unreadable | Registry cannot be safely inspected. |
| definitions.identity_invalid/collision/target_missing/table_missing/column_missing | Canonical identity or schema target mismatch. |
| manifest.identity_invalid/collision/target_missing/table_missing/column_missing | Invalid/stale handler-free manifest entries. |
| manifest.mismatch, fingerprint.mismatch | Metadata disagrees with admitted definitions/hash. |
| actor_manifest_drift, actor_realm_drift, realm_fingerprint_stale, realm_rejected | Reported/admitted realm generations disagree. |
| durable.infrastructure_missing/ephemeral_source/outbox_missing/outbox_ephemeral/dispatcher_disabled | Durable commit or drain prerequisite absent. |
| health.invalid | Aggregate counters/thresholds inconsistent. |
| outbox.dead/stale_leases/capacity_exceeded/backlog_high | Repair terminal work, recovery or capacity pressure. |
| outbox.active/idle | Aggregate nonterminal work informational status. |

Health counters are pending, processing, dead, staleLeases and backlog, with
optional backlogLimit/warningBacklog. Counts must be nonnegative safe integers;
backlog cannot be less than pending plus processing. With a limit and no
explicit warning, warning begins at ceil(80% of limit), at least one.

A normal Doctor command imports trusted project configuration and may perform
other diagnostics. Do not run it against arbitrary untrusted code or mistake
the automation checker for an isolated execution sandbox.

## Deployment Checks

Verify definitions/artifacts, source durability, matching actor generations,
dispatcher recovery, live scope fences and external idempotency. Monitor retry
pressure before increasing quotas. Preserve prior pins and backups until a
restart test passes.

Related: [delivery](./delivery.md), [versioning](./versioning.md),
[testing](./testing.md), [runtime observability](../runtime/observability.md).

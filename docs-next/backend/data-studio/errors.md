---
id: zero.data-studio.errors
type: how-to
audience: [developer, agent]
owner: data-studio
status: draft
visibility: internal
system: data-studio
feature: errors
maturity: supported
applies_to: ["2.1.1 baseline with unreleased datetime calendar correction"]
modes: [multi, advanced-RBAC, tenant-database]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Data Studio Errors And Observability

[Data Studio index](./index.md) · [Documentation index](../../index.md)

DataStudioError carries closed code, retryable, outcome and bounded scalar
details. It must not include names, row values, SQL, paths, tenant/user IDs,
bodies or operation keys. Unknown exceptions normalize to safe internal failure.

## Useful Failures

Schema/value invalid and limits describe rejected input.
Table key/revision/idempotency conflicts require reviewing current intent.
Archived tables deny mutations.
Authority changed/unavailable reflect the current live boundary.
Outcome unknown is a dispatched write requiring same-key reconciliation.

The HTTP projection uses fixed safe messages/status and a
requiresSameIdempotencyKey marker for ambiguous writes. Do not treat every503
as permission to send a new operation key.

## Transaction And Receipt

Expected business failure results are distinct from protocol/corrupt-state
exceptions. Impossible CAS/state failures roll the transaction back rather than
retaining partial history/cells.

A replayed receipt is not a newly executed schema operation; observability avoids
counting that as a fresh accepted schema change.

## Safe Observation

Managed routes use DATA_STUDIO_* events and current app-local emitters.
Record operation category/schema revision/safe outcome, not full schema/value
documents or raw provider/SQLite exceptions.
UI errors use the platform presentation and retain failed edit state until the
user reviews it.

The working datetime correction rejects impossible dates without exposing the
rejected value in its public message; release/artifact qualification remains
separate.

See [concurrency](./concurrency.md), [HTTP API](./http-api.md),
[limits](./limits.md), [frontend integration](./frontend-integration.md) and
[runtime observability](../runtime/observability.md).

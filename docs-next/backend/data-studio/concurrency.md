---
id: zero.data-studio.concurrency
type: how-to
audience: [developer, agent]
owner: data-studio
status: draft
visibility: internal
system: data-studio
feature: concurrency
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

# Revisions And Durable Operation IDs

[Data Studio index](./index.md) · [Documentation index](../../index.md)

Data Studio uses optimistic revisions for user intent and Fabric idempotency
receipts for uncertain execution outcomes. They solve different problems.

## Operation Identity

Server service mutations require options.operationId.
Browser mutation options can supply the same stable ID; retain it for a logical
request that may need recovery. Table/row create derives stable identity from
the admitted actor/operation rather than generating a new row on every retry.

Same-ID same-intent replay can return the previous result without re-execution.
Different intent with the same key conflicts. IDs are scoped/attributed through
the live admitted database and actor, not globally interchangeable across tenants.

## Expected Revision

Table edit/status and row replace/delete require the current expectedRevision.
Conflict preserves the existing record/schema and may return a safe current
revision for review. Refresh the input base; do not merely increment a number
until a stale full replacement happens to succeed.

## Outcomes

Not-started/not-committed/unknown distinguish admission, observed rollback and
a dispatched result whose commit cannot be asserted.
Unknown is not blindly retryable and requires the same idempotency key for the
same logical operation.

WithReceipt server variants expose value/replayed; browser convenience methods
return the validated public entity. A failure after accepted persistence in a
UI callback is not permission to create another operation.

## Transaction Boundary

All relevant row/cell/stat/history/receipt effects are managed in one physical
writer transaction. There is no atomic transaction spanning another tenant DB
or external function/email/API side effect.

See [Fabric idempotency](../fabric/idempotency.md),
[schemas](./schemas.md), [rows](./rows.md), [errors](./errors.md)
and [frontend integration](./frontend-integration.md).

---
id: zero.fabric.diagnostics
type: how-to
audience: [developer, agent, operator]
owner: fabric
status: draft
visibility: internal
system: fabric
feature: diagnostics
maturity: supported
applies_to: ["2.1.1 baseline with unreleased actor environment corrections"]
modes: [single, multiple, shared-row, tenant-database, file, hot]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Fabric Errors And Operational Diagnostics

[Fabric index](./index.md) · [Documentation index](../../index.md)

The public `DatabaseError` export carries a stable code, safe message,
`retryable`, `outcome` and bounded scalar `details`. Its versioned wire
representation must not include SQL, bind values, paths, record contents,
credentials or arbitrary underlying errors.

## Handle The Contract

```ts
import { DatabaseError } from '@zero/framework/server';

export function describeDatabaseFailure(error: unknown): string {
  if (!(error instanceof DatabaseError)) return 'The operation failed.';
  if (error.outcome === 'unknown') return 'The write outcome needs reconciliation.';
  if (error.code === 'DATABASE_BACKPRESSURE') return 'The database is busy.';
  if (error.code === 'DATABASE_AUTHORITY_CHANGED') return 'Your access changed.';
  return 'The database operation could not complete.';
}
```

An app's HTTP/UI boundary should use the established framework error
presentation and stable classifications. The internal
`classifyDatabaseHttpFailure` helper is not a named public server export; do
not teach apps to import implementation files to use it.

## Failure Families

Configuration/admission failures describe invalid topology/realm or mismatched
owned files. Capacity/backpressure/queue failures describe bounded admission.
Actor/protocol/execution failures describe process generations and operation
outcomes. Authority changes fail closed. History gaps require replay recovery.
Conflict/payload/result limits describe validly rejected operation intent.

A generic status code alone cannot decide whether to replay a write.
[Idempotency](./idempotency.md) explains uncertain outcomes and retained keys.

## Observability

Managed composition uses standard database events, safe code/phase metadata and
app-local emitters. Health/diagnostics expose bounded counts and lifecycle state,
not physical paths or arbitrary operation payloads. Do not log the complete
operation input simply because it is serializable.

Transport diagnostics never expose the actor argv, nonce, environment values
or filesystem layout. Launch cleanup failures retain safe phase metadata and
are surfaced through owned lifecycle failure handling.

See [runtime observability](../runtime/observability.md),
[recovery](./recovery.md), [capacity](./capacity.md) and
[configuration](./configuration.md).

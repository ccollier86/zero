---
id: zero.guardian.audit
type: operations
audience: [developer, agent]
owner: guardian
status: draft
visibility: internal
system: guardian
feature: control-plane-audit-query-export-retention
maturity: supported
applies_to: ["2.1.1 source; new documentation under review"]
modes: [single-simple, single-advanced, multi-simple, multi-advanced]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Inspect Durable Guardian Audit Evidence

[Guardian index](./index.md) · [Documentation index](../../index.md)

Guardian retains secret-free control-plane audit events in the system database.
Audit storage is always enabled when authentication is enabled. It is distinct
from the application's operational log sink and is not a complete compliance
product simply because events are retained.

## Event Contract

An event records ID/time, action, succeeded/denied/failed outcome, safe reason,
application/tenant scope, actor provenance, optional actor user/membership/
session/client identifiers, request/correlation IDs, target and bounded scalar
metadata.

The browser-safe projection deliberately has no email or free-form message.
Passwords, API-key secrets, MFA codes/seeds, raw bearer/refresh/action tokens
and email bodies are not audit fields.

Actor provenance distinguishes authenticated-request, bootstrap,
account-recovery, registration and system. Preserve the distinction between
the operator who performed an action and the subject the action affected.

## Query Current Scope

| Endpoint | Authority |
| --- | --- |
| `GET /auth/audit/platform/events` | Single global admin, or multi live application audit-read authority. |
| `GET /auth/audit/platform/export` | Same read authority; export itself is audited. |
| `POST /auth/audit/platform/prune` | Multi application audit-manage authority, or admitted single admin. |
| `GET /auth/audit/tenant/events` | Current tenant and `tenant.audit:read`. |
| `GET /auth/audit/tenant/export` | Same selected-tenant read authority. |

Queries accept opaque cursor, action, outcome, from/to timestamps and targetType.
Lists accept limit 1–100; exports 1–1000. Reads are private/no-store and actor
authority is rechecked before publishing the result.

The tenant route derives its tenant from the session. A caller cannot add a
tenant ID to browse another organization. The platform event directory is an
explicit application-control permission, not customer-owner authority.

## Pages And Export

List returns `{ events, page: { limit, count, hasMore, nextCursor } }`.
Export returns `{ ndjson, count, hasMore, nextCursor }`.
NDJSON is one safe event per line; an export call is bounded, not a promise
to return all retained records in memory.

Follow returned cursors for a complete export. Keep exports private and apply
the app's retention/access policy when storing a downloaded artifact. A safe
event structure can still contain sensitive operational identifiers.

## Retention Configuration

```ts
import { defineAuthConfig } from '@zero/framework/auth';

export const auth = defineAuthConfig({
  audit: {
    retentionDays: 365,
    pruneBatchSize: 1000,
    pruneInterval: '6h',
  },
});
```

Retention days accept 1–3650; prune batch 1–10000; interval 1m–7d.
Background pruning is lifecycle-owned bounded work. Manual backlog pruning
also checks actor authority at the mutation boundary and emits an audited
retention action.

Do not run an app-level DELETE against audit tables to “fix” a retention view.
The retained record/service boundary owns event validation, pruning and
operational evidence.

## Logging Relationship

Operational observability uses stable `OBS_CODES` and the configured sink.
Audit events capture durable domain/control-plane decisions. They serve
different readers and may have different retention/routing requirements.

An app-specific audit action should be a short semantic action with safe scalar
metadata. Do not use the audit store as a free-form debug-log bucket or as a
place to dump provider responses.

## Verification

Check actor/target/scope accuracy, tenant isolation, pagination, bounded export,
audited exports/prunes, denied sensitive operations and retention cutoffs.
Revoking audit authority while an awaited request is resolving must prevent
publishing a stale page/export.

## Related Guides And Next Steps

- [Configuration](./configuration.md) gives exact startup inputs and interactions.
- [Control plane](./control-plane.md) describes the operations being recorded.
- [Authorization](./authorization.md) scopes audit access.
- [Runtime observability](../runtime/observability.md) defines operational code/sink conventions.

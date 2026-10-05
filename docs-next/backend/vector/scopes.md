---
id: zero.vector.scopes
type: architecture
audience: [developer, agent, operator]
owner: vector
status: draft
visibility: internal
system: vector
feature: scopes
maturity: supported
applies_to: ["2.1.1 baseline with unreleased scope/capacity corrections"]
modes: [server-only, named-local-indexes]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Required Metadata And Scope Integrity

[Vector index](./index.md) · [Documentation index](../../index.md)

VectorScope narrows an existing VectorService to an index and required metadata
filter. The app must derive that filter from verified live authority. A caller
supplied tenantId is not proof of membership.

```ts
import type { VectorService } from '@zero/framework/vector';

export function tenantVectors(vectors: VectorService, verifiedTenantId: string) {
  return vectors.scope('documents', { tenantId: verifiedTenantId });
}
```

This helper assumes its caller has already resolved permission and current
membership. Keep that live check at the app operation boundary.

## Reads And Writes

Queries/filter deletes AND caller filters with the required scope. Fetches
filter returned records in memory. Upserts stamp simple required equalities,
reject conflicting supplied values, and validate the full candidate against
compound requirements.

A scoped write also checks existing records with the submitted IDs before
replacement. Guessing an ID in another scope cannot seize it. Candidate and
existing-record checks share the same per-index write boundary as the native
upsert, ordinary upserts, ID deletes, filter deletes and optimization.

## Exact Guarantee

The corrected boundary belongs to one VectorService. Independent indexes remain
concurrent; failed operations release later work. Filter/record inputs are
detached. The boundary is not distributed locking across services/processes,
not native batch atomicity, and not automatic Guardian authorization.

Ordinary unscoped writes and direct adapters remain trusted privileged operations.
Do not route them to a tenant endpoint as an alternative to a failed scoped call.

Current fixed capacity is 128 pending writes per index and 1024 active operations
per service. Overflow rejects with VECTOR_BACKPRESSURE; disposal drains admitted
work and fences new intake.

See [Guardian authority](../guardian/index.md),
[machine services](../runtime/machine-services.md), [filters](./filters.md),
[operations](./operations.md) and [errors](./errors.md).

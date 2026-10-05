---
id: zero.vector.deletes
type: reference
audience: [developer, agent, operator]
owner: vector
status: draft
visibility: internal
system: vector
feature: deletes
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

# Delete Records Without Widening Scope

[Vector index](./index.md) · [Documentation index](../../index.md)

VectorService.delete removes one or several IDs from an explicit/default index.
deleteWhere removes records matching a structured filter. Both return
{ok,count,errors}; native partial issues are not implied all-or-nothing success.

VectorScope exposes deleteWhere, not a separate delete-by-ID shortcut. Required
scope is ANDed with the supplied filter. To delete a particular admitted record
through a scope, filter on its id while retaining that required scope.

```ts
import type { VectorScope } from '@zero/framework/vector';

export async function deleteScopedChunk(scope: VectorScope, id: string) {
  const result = await scope.deleteWhere({ id });
  return { ok: result.ok, deleted: result.count, issues: result.errors.length };
}
```

## Operation Boundary

Both ordinary and scoped deletes participate in the same-service per-index
write ordering. A delete cannot slip between another scoped writer's existing-ID
preflight and replacement. Different indexes are not serialized globally.

## Ownership And Recovery

Authorization belongs to the app; a metadata match alone does not prove the
caller has delete permission. Do not expose raw provider error text or attempt
an unscoped fallback after a scope denial.

Deletion is not soft archive or a retained history/restore API. Keep any business
recovery copy in an appropriately protected durable store, with an explicit
retention policy.

See [records](./records.md), [scopes](./scopes.md), [filters](./filters.md),
[operations](./operations.md) and [errors](./errors.md).

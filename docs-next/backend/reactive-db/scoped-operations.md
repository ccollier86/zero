---
id: zero.reactive-db.scoped-operations
type: reference
audience: [developer, agent, operator]
owner: reactive-db
status: draft
visibility: internal
system: reactive-db
feature: scoped-operations
maturity: supported
applies_to: ["2.1.1 source; new documentation under review"]
modes: [managed-server, standalone-Bun, Fabric-actor]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Enforce A Trusted Row Discriminator

[ReactiveDB index](./index.md) · [Documentation index](../../index.md)

Row-scoped operations enforce an exact equality discriminator in a
shared table. This is different from Fabric's trusted selection of a tenant
database file.

`ReactiveDBRowScope` contains a declared `field` and string/number `value`.
The scope must come from verified server authority, not arbitrary body/query
input.

For example, this service fragment receives an already server-verified scope
and stamps it into a new storage row before strict creation:

```ts
import type { ReactiveDB, ReactiveDBRowScope } from '@zero/framework/sync';

export function createScopedTask(
  db: ReactiveDB, id: string, title: string, trustedScope: ReactiveDBRowScope,
) {
  return db.createScoped('tasks', {
    id, title, done: 0, [trustedScope.field]: trustedScope.value,
  }, trustedScope);
}
```

The table must declare the discriminator column. This is not a route that accepts
an arbitrary scope object from the browser.

## Methods

| Method | Scope behavior |
| --- | --- |
| `createScoped(table,row,scope)` | strict create; supplied row must already match trusted scope |
| `getScoped(table,id,scope)` | exact scoped lookup; outside-scope row is null |
| `updateScoped(table,id,partial,scope,expectedRow?)` | exact scope plus optional expected-row comparison |
| `deleteScoped(table,id,scope,expectedRow?)` | exact scope plus optional expected-row comparison |

Creation does not silently turn a caller's mismatched row into a trusted one.
Stamp it in trusted service code or reject it before creation. Existing primary
key collisions reject even if the old row belongs to another scope.

Update cannot include the scope field at all; it is immutable for that operation.
Natural identity/key restrictions still apply. Exact JS and SQLite storage-class
plus BINARY equality prevent affinity/collation from widening a scope match.

## Scope Is Not Every Policy

A tenant discriminator can protect shared rows, but it does not itself enforce
role, user ownership, field read/write masks or account/credential status. Those
rules belong in the Resource/domain boundary and live authorization fences.

In tenant-database mode, a caller cannot choose a file by passing this scope.
Use the [request data client](../runtime/server-services.md#data-and-permission-are-separate)
for server-derived physical binding, then enforce the relevant row/domain rule.

## Verify

Test guessed IDs in another scope, mismatched creation values, forbidden scope
patches and string/numeric/case drift. Compare a policy-read row at mutation time
when policy depends on its current content. Do not infer isolation from a hidden
form control or a plain unvalidated tenant_id string.

## Related Guides And Next Steps

- [Conditional writes](./conditional-writes.md) defines expected-row comparison.
- [Data planes](../../concepts/data-planes.md) contrasts row/file isolation.
- [Service boundaries](../../concepts/service-boundaries.md) defines trusted scope origin.

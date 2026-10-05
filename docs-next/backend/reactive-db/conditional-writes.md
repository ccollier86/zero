---
id: zero.reactive-db.conditional-writes
type: reference
audience: [developer, agent, operator]
owner: reactive-db
status: draft
visibility: internal
system: reactive-db
feature: conditional-writes
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

# Commit Only Against The Policy-Evaluated Row

[ReactiveDB index](./index.md) · [Documentation index](../../index.md)

Use `updateIfCurrent(table,id,partial,expectedRow)` and
`deleteIfCurrent(table,id,expectedRow)` when a policy decision depends on a
pre-read row. Comparison and mutation share the managed writer transaction.

This is row-snapshot concurrency control, not a distributed lock, a user token
or a numeric version column.

This service fragment assumes the caller already has current authority and has
evaluated its policy against the supplied snapshot:

```ts
import type { ReactiveDB, Row } from '@zero/framework/sync';

export function changeTaskTitle(
  db: ReactiveDB, id: string, title: string, policyEvaluatedRow: Row,
) {
  return db.updateIfCurrent('tasks', id, { title }, policyEvaluatedRow);
}
```

## Comparison

The current row is checked with exact JavaScript values and a repeated SQL
storage-class/BINARY equality predicate. The addressed primary key chooses the
row; expected non-key columns must agree. Null, storage-type and case/collation
drift cannot be silently accepted as equivalent.

An already missing row returns null. A changed existing row throws a conflict
error and rolls back; it is not indistinguishable from “nothing changed.”
Update still retains the key and rejects natural-identity changes.

Scoped update/delete support the same expected-row concept while independently
requiring the trusted discriminator. See [scoped methods](./scoped-operations.md).

## Authority Boundary

A matching snapshot proves the content evaluated by policy did not drift, not
that the actor still has permission. Revalidate live authority at the commit
boundary. Request/Fabric/Resource integrations own that fence; a direct raw
engine call does not invent it.

If the row changed, re-read it and rerun policy with current authority before a
deliberate retry. Do not simply reuse the old expectedRow or overwrite the new
content after catching the conflict.

## Verify

Use barriers/independent connections in disposable fixtures to force a change
between policy read and write. Test ordinary/scoped update and delete, NULL,
type/case drift and a missing row. Verify that failed comparison produces
neither a row write nor a committed change event.

## Related Guides And Next Steps

- [Transactions](./transactions.md) owns comparison/write atomicity.
- [CRUD](./crud.md) contrasts unconditional merging updates.
- [Request services](../runtime/server-services.md) supplies live authority fences.

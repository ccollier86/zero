---
id: zero.reactive-db.crud
type: reference
audience: [developer, agent, operator]
owner: reactive-db
status: draft
visibility: internal
system: reactive-db
feature: crud
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

# Read, Create, Replace, Update And Delete

[ReactiveDB index](./index.md) · [Documentation index](../../index.md)

ReactiveDB instance methods are synchronous. They operate on a defined
table with storage values and return the canonical persisted change. They do
not perform an HTTP request or infer the actor's Resource/Guardian permissions.

## Exact Method Semantics

| Method | Result | Contract |
| --- | --- | --- |
| `query(table)`, `list(table)` | Row[] | all table rows; no pagination/order promise |
| `queryOne(table,id)`, `get(table,id)` | Row or null | one primary-key lookup |
| `insert(table,row)`, `create(table,row)` | Change | insert, or replace values on the exact existing primary key |
| `createStrict(table,row)` | Change | create only; existing primary key rejects |
| `update(table,id,partial)` | Change or null | merge into existing row; missing returns null |
| `delete(table,id)` | Change or null | delete existing row; missing returns null |

`insert/create` is **not strict creation**. Its exact-key conflict performs an
UPDATE and emits UPDATE; unrelated unique-constraint conflicts abort rather than
silently deleting another row through SQLite REPLACE. A permission-checked
CREATE path must not use that upsert to bypass UPDATE policy.

## Omission And Replacement

Insert omits absent columns from SQL so SQLite defaults can apply. Present
undefined/null values become SQL NULL. On an existing key, omitted fields can
be replaced by the insert/default representation; this is not partial patch
semantics. Use update to retain other existing values.

Update merges the partial row and preserves the addressed primary key.
Natural identity fields cannot change. Do not send a different key as a patch;
a key/identity change requires an explicit replacement/migration design.

The engine reads back canonical persisted rows, including defaults, before
building Change. Unknown row data is not a field-visibility policy: validate
the logical input, encode it and apply domain policy before the engine boundary.

## Changes And Commit

A Change has seq, table, INSERT/UPDATE/DELETE op, canonical string rowId,
post-mutation row (null for DELETE), previousRow and timestamp. Sequence/change
recording happens in the same transaction as the row.

Inside an explicit transaction, a returned Change is still pending until root
commit. Listeners run after commit and receive separate copies; mutating the
returned object cannot rewrite durable delivery.

## Errors And Verification

Constraint/admission errors throw and poison the active managed transaction.
A missing update/delete is null, not an exception or success against a fabricated
row. Never return raw SQLite error text as an unreviewed public API message.

Test strict versus duplicate-key upsert, omitted defaults versus partial patch,
unrelated UNIQUE failure, missing rows and the full returned persisted change.
Use bounded server/Fabric query surfaces for user-facing large tables; query()
does not add implicit pagination.

## Related Guides And Next Steps

- [Conditional writes](./conditional-writes.md) prevents stale policy-approved replacements.
- [Scoped operations](./scoped-operations.md) restricts a shared row discriminator.
- [Transactions](./transactions.md) defines when a Change becomes committed.
- [Codecs](../schema/codecs.md) converts logical forms to storage values.

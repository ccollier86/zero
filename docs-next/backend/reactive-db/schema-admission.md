---
id: zero.reactive-db.schema-admission
type: how-to
audience: [developer, agent, operator]
owner: reactive-db
status: draft
visibility: internal
system: reactive-db
feature: schema-admission
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

# Construct And Define A Managed Table

[ReactiveDB index](./index.md) · [Documentation index](../../index.md)

Use the managed app's existing application/Fabric services for normal
apps. Direct construction is for trusted server libraries or isolated fixtures:

```ts
import { createReactiveDB } from '@zero/framework/sync';
import { defineTable, field } from '@zero/framework/schema';

const tasks = defineTable('tasks', {
  title: field.text({ required: true }),
  done: field.boolean({ defaultValue: false }),
});
const db = createReactiveDB({ mode: 'ephemeral' });
try {
  db.defineTable(tasks.name, tasks.serverTable);
  db.createStrict('tasks', { id: 'synthetic-task', title: 'Review', done: 0 });
} finally {
  db.dispose();
}
```

This is an isolated in-memory server example, not production storage or a
permission policy. Required schema validation belongs to the appropriate logical
mutation/service boundary; a raw engine call uses SQLite/storage values.
[Schema validation](../schema/validation.md) explains that distinction.

## Table Contract

The instance method `defineTable(name, schema)` installs/adopts SQL schema and
prepared CRUD statements. It is distinct from the imported Schema DSL
`defineTable`, which constructs a declaration without opening a database.

Every table needs exactly one isolated primary-key column with TEXT or INTEGER
affinity. INTEGER values must remain safe integers; wire row IDs are canonical
strings. Composite primary keys and additional embedded column definitions are
not a supported workaround. Use [natural identity](./natural-identity.md) for a
multi-field business key.

Only SQL column strings plus supported metadata belong in the table map.
Non-enumerable validation/Guardian metadata does not become a column. The
high-level DSL is preferable to manually copying server/client shapes.

## DDL And Existing Tables

DDL, FK inspection, natural-identity unique-index creation and prepared statement
setup succeed or roll back as one immediate schema boundary. Repeating a name
replaces its prepared statement set only after new admission succeeds.

`CREATE TABLE IF NOT EXISTS` is not a migration tool. Review installed schema
and migrations when changing a declaration. Managed mutation contracts guard
later schema drift; do not alter protected log/schema objects to bypass them.

Mutating FK actions CASCADE, SET NULL and SET DEFAULT are rejected because they
could change another tracked row without its own event. Guardian references use
managed local anchors and restrictive deletion. Table definition cannot run
inside a managed ReactiveDB transaction or read-only snapshot callback.

## Verify

In a disposable fixture, test valid TEXT/INTEGER keys, missing/composite/invalid
keys, non-isolated declarations, unsafe FK actions and failed replacement without
losing prior usable statements. Test upgrades separately against a copy/backup,
not a live application database.

## Related Guides And Next Steps

- [Schema tables](../schema/tables.md) owns the full-stack declaration.
- [CRUD](./crud.md) chooses strict create versus replacement.
- [Transactions](./transactions.md) owns tracked atomic writes.
- [Guardian references](../schema/guardian-references.md) supplies local FK anchors.

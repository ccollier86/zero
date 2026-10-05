---
id: zero.schema.tables
type: how-to
audience: [developer, agent]
owner: schema
status: draft
visibility: internal
system: schema
feature: tables
maturity: supported
applies_to: ["2.1.1 baseline with unreleased Schema corrections"]
modes: [server, browser, single-database, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Declare Tables Once

[Schema index](./index.md) · [Documentation index](../../index.md)

`defineTable(name, fields, options?)` creates the descriptor, server SQL shape,
server mutation validator and browser table shape from one declaration. It does
not create a SQLite table when called. Managed startup/migrations install the
appropriate physical schema; the browser registers a transport/state shape.

## A Named Table

```ts
// db/schema.ts — safe shared declaration, no credentials
import { defineTable, field, type InferRow } from '@zero/framework/schema';

export const tasks = defineTable('tasks', {
  title: field.text({ required: true, maxLength: 200 }),
  done: field.boolean({ defaultValue: false }),
}, { pk: 'task_id', sync: 'lazy' });

export type Task = InferRow<typeof tasks>;
```

Server configuration uses `tables: { tasks }` or `tasks.serverTable` inside the
table map. Browser configuration uses `tasks.clientTable`. These are configuration
fragments: the app still needs its database, resources/policies and transport
configuration. Table declaration alone does not expose anonymous CRUD.

## Returned Members

`name` is the declared name; `schema` is the [descriptor](./descriptors.md).
`serverTable` carries SQL declarations and server-only metadata.
`mutationValidator` is the logical validator used by tracked Sync mutations.
`clientTable` carries `_pk`, optional `_sync`, natural identity and boolean
encoding metadata. Guardian reference arrays describe managed anchor requirements.

Keep the map key and declared table name consistent in application configuration.
Share the declaration module, not the server's service objects. Neither the
table descriptor nor its client projection contains a user's live authority.

## Primary Key

The default key name is `id`. When it is absent from the fields, conversion adds
a TEXT primary key on the server and a text field on the client. A custom key
name uses `pk`. If a field with that name is explicitly declared, its storage
type becomes the primary-key column rather than creating a second key.

Sync still identifies each row by one key. Do not use a composite SQL primary
key to represent a multi-field business key; use [natural identity](./natural-identity.md).
Key generation belongs to row insertion/identity helpers, not `getDefaults()`.
Do not change a row's key during an update.

## Several Tables With schema()

```ts
import { schema, field } from '@zero/framework/schema';

export const databaseSchema = schema({
  tasks: {
    fields: {
      title: field.text({ required: true }),
      done: field.boolean({ defaultValue: false }),
    },
    sync: 'lazy',
  },
  labels: {
    fields: { name: field.text({ required: true }) },
    sync: 'full',
  },
});
```

The result has `serverTables`, `clientTables` and `definitions` indexed by table
name. Server configuration can use `tables: databaseSchema.serverTables`;
`createClient` uses `tables: databaseSchema.clientTables`, together with its
required server URL; there is no `ClientConfig.schema` option. `_types` carries declaration
information for TypeScript; it is not a runtime registration service.

## Sync And Physical Placement

`sync` accepts `full`, `lazy` or `auto`. Omission leaves the client table without
an explicit loading-mode override so app defaults can apply. Loading mode is
not permission: full synchronization must still pass the server resource/Sync
policy, and lazy mode does not make otherwise exposed data private.

In corrected development source, raw `serverTable` / `schema().serverTables`
composition retains declared sync intent rather than losing it during server
resolution. Explicit per-table app defaults can override that intent; global
defaults apply only when neither is supplied. This correction is not asserted
for the original published 2.1.1 artifact.

Fabric placement is a separate decision. The table must be contributed to its
declared realm; `sync: 'lazy'` does not place it in a tenant database. Guardian
references work through managed [identity anchors](./guardian-references.md)
in the application or tenant plane as required.

## Changes And Failure Behavior

Changing fields or key/identity options changes a declaration, not stored data.
Review and apply the corresponding migration/admission procedure before using
it with an existing database. Never edit client metadata as a workaround for a
server schema mismatch or weakened foreign key.

Required values are validated logically; encoding maps them to the SQL/wire
representation. The installed server must retain executable mutation metadata.
JSON-serializing a server declaration loses symbol-backed policies and is not
a supported way to install a schema.

## Related Guides And Next Steps

- [Configuration](./configuration.md#table-options) lists exact table options.
- [Codecs](./codecs.md) covers boolean and structured row representations.
- [Natural identity](./natural-identity.md) defines deterministic business keys.
- [Guardian references](./guardian-references.md) supports user-owned data without
  moving canonical authentication records into application tables.

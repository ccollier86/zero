---
id: zero.schema.registry
type: reference
audience: [developer, agent]
owner: schema
status: draft
visibility: internal
system: schema
feature: registry
maturity: supported
applies_to: ["2.1.1 source; public augmentation statically checked"]
modes: [server, browser, single-database, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Explicit Table Type Registration

[Schema index](./index.md) · [Documentation index](../../index.md)

`Register` is an empty TypeScript interface that an application can augment.
Its `tables` map lets `TableNames` and `TableRow<Name>` resolve application table
types. It has no runtime object, service registration, schema migration, loading
behavior or authority. Use it for shared type aliases, not for installing tables.

## Register Stored Row Shapes

```ts
// db/schema.ts — module included in the app's TypeScript program
import {
  defineTable, field,
  type InferRow, type TableNames, type TableRow,
} from '@zero/framework/schema';

export const tasks = defineTable('tasks', {
  title: field.text({ required: true }),
  done: field.boolean(),
});

export interface AppTables {
  tasks: InferRow<typeof tasks>;
}

declare module '@zero/framework/schema' {
  interface Register {
    tables: AppTables;
  }
}

export type AppTableName = TableNames; // 'tasks'
export type RegisteredTask = TableRow<'tasks'>;
```

Use the public schema subpath as the augmentation target. The file must be part
of the TypeScript program; an unreferenced file outside the program does not
provide registration. Register a stored row shape when the alias is used for a
collection, rather than registering logical form arrays where stored TEXT is expected.

## Alias Resolution

| Alias | With a declared tables map | Without a declared tables map |
| --- | --- | --- |
| `TableNames` | string keys of that map | string |
| `TableRow<'tasks'>` | mapped row intersected with Zero's record row type | Record<string, unknown> |
| `TableRow<'unknown'>` | Record<string, unknown> for a missing key | Record<string, unknown> |

TableRow's key parameter accepts a string; it deliberately falls back for a key
outside the map. Use TableNames as the parameter type when a helper should only
accept registered names:

```ts
function labelForTable(table: TableNames): string {
  return table === 'tasks' ? 'Tasks' : table;
}
```

The intersection preserves the row's declared members while supporting Zero's
record-based SDK APIs. It does not grant permission to read a table or validate
a record at runtime.

## SDK And Hook Integration Is Explicit

Current collection and hook signatures accept an explicit row generic. They do
not automatically turn a literal table-name argument into a registered row type.
Use the alias directly:

```ts
// Fragment inside code that already has a configured Zero client.
const collection = client.collection<TableRow<'tasks'>>('tasks');
```

Here `client` is the application's normal authenticated client, not an object
provided by type augmentation. Server table installation, browser table
registration, subscriptions and resource policies still need their ordinary
configuration. A Register declaration does not make arbitrary server/system
tables available to browser code.

Do not assign `schema()._types` directly as a row map: it retains per-table
configuration with fields/pk/sync/identity, not inferred collection rows. Derive
each row with [InferRow](./types.md#stored-rows-and-insert-inputs).

## Scope And Verification

Module augmentation affects the application's TypeScript compilation globally.
Avoid competing declarations of Register.tables with incompatible maps. Combine
your own table interfaces in one authoritative app map instead of teaching each
plugin to overwrite the same property.

The source static contract verifies augmentation through @zero/framework/schema,
the resulting name literal and typed mapped rows. There is no runtime test or
database to start for registration itself. This correction removes stale prose
claiming automatic hook/collection name binding; it does not add a new inference
or registry runtime API.

## Related Guides And Next Steps

- [Types](./types.md) owns logical and stored inference aliases.
- [Tables](./tables.md) installs the corresponding runtime shapes.
- [Validation](./validation.md) explains runtime checks that registration cannot replace.
- [Configuration](./configuration.md) distinguishes startup declarations from types.

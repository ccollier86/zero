---
id: zero.fabric.realms
type: how-to
audience: [developer, agent, operator]
owner: fabric
status: draft
visibility: internal
system: fabric
feature: realms
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

# Define An Immutable Database Realm

[Fabric index](./index.md) · [Documentation index](../../index.md)

A realm is the schema and executable registry that the parent and every actor
import independently. It is side-effect-free: defining it must not start the
server, acquire files, read credentials or call external services.

## A Minimal Realm

```ts
import { defineDatabaseRealm } from '@zero/framework/server';

export const appRealm = defineDatabaseRealm({
  name: 'example-app',
  version: '1',
  tables: {
    notes: {
      id: 'text primary key',
      title: 'text not null',
    },
  },
  queries: {
    'notes.count': ({ database }) => {
      const row = database.query('SELECT count(*) AS count FROM notes').get() as { count: number };
      return { count: row.count };
    },
  },
  commands: {
    'notes.rename': ({ db }, input: { id: string; title: string }) => {
      db.update('notes', input.id, { title: input.title });
      return { id: input.id };
    },
  },
});
```

For schema-driven apps, use the corresponding admitted
[server tables](../schema/tables.md), preserving validators and Guardian reference
metadata, instead of separately rewriting their SQL declarations.

## Required And Optional Parts

`name`, `version` and `tables` are required. Migrations, queries, commands and
automations are optional. Admission detaches/freezes table and registry metadata,
orders dependent tables, rejects reserved anchor tables and validates names and
migration declarations.

Queries receive a revocable read-only SQL capability, not a Bun Database.
Commands receive tracked ReactiveDB operations, not raw SQL/schema/lifecycle
access. Both are synchronous and return canonical serializable values.
Async handlers and arbitrary returned prototypes fail admission/execution.

## Fingerprints And Versioning

The fingerprint includes realm identity/version, schema, migration checksums and
registered operation names. It is not automatic hashing of handler bodies.
Bump the explicit version when handler or validator behavior changes without a
name/schema change. Deploy the matching definition to parent and actors;
mismatch fails closed rather than silently using an old handler.

See [realm composition](./realm-composition.md) for plugins,
[operations](./operations.md) for invocation, and
[automations](../database-automations/index.md) for functions/triggers.
Function code stays local; only names and serializable input cross IPC.

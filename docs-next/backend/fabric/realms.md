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

Explicit `sync: 'full'`, `'lazy'` and `'auto'` from either `defineTable()` or
`schema().serverTables` travel as framework-owned symbol metadata. Fabric's
direct and composed realm admission validates/preserves that exact symbol along
with existing mutation validators and Guardian references. Spreading a schema
preserves its enumerable loading intent; the admitted clone restores an
immutable data descriptor. Unknown symbols and accessor/invalid-mode metadata
fail with `DATABASE_CONFIG_INVALID` without invoking metadata getters.

Loading intent is gateway policy, not a SQL column or actor execution identity.
It does not change the SQL schema checksum, realm fingerprint or durable
operation namespace. Parent and actors still import the matching schema module;
changing full/lazy/auto alone is not a data migration or authority change.

## Required And Optional Parts

`name`, `version` and `tables` are required. Migrations, queries, commands and
automations are optional. Admission detaches/freezes table and registry metadata,
orders dependent tables, rejects reserved anchor tables and validates names and
migration declarations.

Queries receive a revocable read-only SQL capability, not a Bun Database.
Commands receive tracked ReactiveDB operations, not raw SQL/schema/lifecycle
access. Both are synchronous and return canonical serializable values.
Async handlers and arbitrary returned prototypes fail admission/execution.

### Registered reads inside a command

The Calendar integration branch adds `context.query(name, input)` to native
command contexts. This is **not yet part of the selected 2.11.1 archive**. A
canonical writer can invoke an existing named read against its exact current
transaction, including its own uncommitted tracked changes, without obtaining
raw SQL or another connection. For example:

```ts
'notes.rename': ({ db, query }, input: { id: string; title: string }) => {
  db.update('notes', input.id, { title: input.title });
  return query('notes.count', {});
},
```

Only that realm's registered query names are admitted. The read-only query
session and its statements close before the writer resumes, on success or
failure. Unknown names, asynchronous handlers, attempted query-side mutation
and invalid results reject the command transaction. Dispatch expires with the
command capability; it cannot escape into a later timer or post-commit task.
Direct internal test sessions without an installed realm dispatcher report
`DATABASE_OPERATION_UNSUPPORTED`, not an arbitrary-query fallback.

Keep external I/O, AI/provider calls and expensive expansion outside the writer.
Named-query dispatch does not extend the writer's authority or bypass Guardian,
writer admission, current resource policy or final commit checks.

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

## Native historical table stages

The Calendar integration branch adds an optional native `migrationTableStages`
contract for a specific legacy pattern: an unchanged historical migration creates
indexes/triggers on tables supplied by its original runtime rather than creating
those tables itself. Ordinary application migrations should continue to own their
DDL; do not precreate a latest schema over an older populated database.

Each stage declares a migration version, its exact cumulative post-migration
table map and, where needed, `prepare: 'create-added-tables'`. Native admission
detaches/freezes the declarations, proves an exact ordered prefix and includes
their schema/flags in the realm fingerprint. Omission preserves the previous
realm fingerprint and behavior. The pending boundary creates only that stage's
new tables/natural-identity indexes inside the **same transaction** as the original
`up`, final schema validation and ledger append. Original migration functions,
checksums and successful ledger rows are not rewritten.

Read-only source inspection precedes writable constructors and proves native
binding/ownership before preparation. Missing old tables, unexplained future
tables, ledger holes, wrong checksums or unknown framework objects fail closed;
this is not an automatic legacy import or repair API. Framework metadata is
explicitly classified rather than hidden behind an underscore-prefix allowlist.
Table-stage declarations do not attest every application trigger's SQL.

Current complete-prefix admission and no-op preparation prove exact native
objects/fixed metadata, the ledger prefix and domain schema, retaining the
existing streamed Sync-format proof once. They do not repeatedly decode every
permanent receipt and logging payload. This is structural/no-migration admission,
not a forensic attestation of all retained content. Actual pending migration
preparation still performs deep retained-source checks before writable
initialization and inside each original migration boundary. Malformed retained
payloads are never rewritten to make them pass.

This initial native contract rejects Guardian/presence/automation-dependent
staged realms and unsupported composition rather than silently dropping those
features. The existing-realm contribution adapter also rejects staged realms;
it cannot discard their preparation contract. Staged migration rollback is
explicitly unsupported for this forward-only increment, before any backup,
checkpoint, down handler or evidence write. Ordinary unopted rollback is unchanged.
Actual Calendar uses its original 001–016 handlers and retains its
previous 016 policy fingerprint for historical evidence. Source/MEMORY migration
checks are not installed-file, WAL/HOT, actor or update qualification; see the
[Calendar qualification record](../calendar/qualification.md).

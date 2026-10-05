---
id: zero.fabric.composition
type: how-to
audience: [developer, agent, operator]
owner: fabric
status: draft
visibility: internal
system: fabric
feature: composition
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

# Compose Realm Contributions

[Fabric index](./index.md) · [Documentation index](../../index.md)

Reusable features can provide a realm contribution containing tables,
migrations, named queries/commands and automation declarations. Composition keeps
a single admitted contract; it is not a mutable registry accepting arbitrary
code from database rows.

## Declare And Compose

```ts
import {
  composeDatabaseRealm,
  defineDatabaseRealmContribution,
} from '@zero/framework/server';

const notes = defineDatabaseRealmContribution({
  name: 'notes-feature',
  version: '1',
  tables: { notes: { id: 'text primary key', title: 'text not null' } },
});

export const appRealm = composeDatabaseRealm({
  name: 'example-app',
  version: '1',
  contributions: [notes],
});
```

An existing complete admitted realm can be adapted using
`databaseRealmContribution(existingRealm)`. Contributions retain their own
identity/version; bump the owner version for changed handler behavior as well
as the deployed realm version where appropriate.

## Collision And Dependency Rules

Composition validates the merged schema/registries again. It rejects
case-insensitive table collisions, duplicate contribution identities, conflicting
migration versions, query/command name collisions and incompatible automation
registries. Contribution order must not be used to silently override another
feature's declaration.

A trigger can refer to a table supplied by another contribution: its
schema-backed target admission occurs after the final merge. Keep the resulting
realm available in every actor entry; executable handlers are not shipped over
IPC.

Feature migrations remain explicitly ordered/identified. Composition is not a
cross-file transaction or a substitute for deployment migration planning.

## Integrating Platform Features

Features such as Data Studio expose their own realm contributions. Use the
published contribution/feature contract rather than copying internal tables and
handlers into the app. Preserve the same app-table declarations needed by
[tenant topology admission](./topology.md).

See [realms](./realms.md) for fingerprint/version behavior,
[actor launch](./actors.md) for package boundaries, and
[database automations](../database-automations/index.md) for reusable functions
and AFTER-trigger declarations.

---
id: zero.migrations.registries
type: how-to
audience: [developer, agent, operator]
owner: migrations
status: draft
visibility: internal
system: migrations
feature: registries
maturity: supported
applies_to: ["2.1.1 baseline with unreleased handler/planning corrections"]
modes: [system, application, Fabric-realm]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Immutable Registries And Migration Checksums

[Migrations index](./index.md) · [Documentation index](../../index.md)

createMigrationRegistry composes ordered lists into a detached frozen array
and frozen entries. Later caller mutation cannot alter a live migrator's
order, metadata, handlers or checksum intent.

## Compose

```ts
import { createMigrationRegistry } from '@zero/framework/migrations';
import type { Migration } from '@zero/framework/migrations';

const first: Migration = {
  version: '001', description: 'synthetic first', up(_db) {},
};
const second: Migration = {
  version: '002', description: 'synthetic second', up(_db) {},
};
export const registry = createMigrationRegistry([first], [second]);
```

These no-op examples show ordering only, not a useful app schema.
The registry validates nonempty unique strictly increasing version strings and
the corrected synchronous handler contract.

## Retained Checksums

hashMigration includes version, description, safety, backup requirement and
function source strings for up/down. It is not a semantic proof that two code
bodies are equivalent or a hash of every imported dependency.

Applied and successfully rolled-back durable state retains its checksum.
A changed body is rejected even when no forward work is pending.
Restore the original and append a new migration; do not erase the ledger
to make changed source appear unapplied.

A stale registry may not omit durable newer state. Forward/down dependency
checks happen within the IMMEDIATE transaction, so another runner cannot
silently reverse the declared order.

## App Versus Built-In Registries

The public migrations export is Zero's built-in system registry.
Do not apply it to an app/Fabric database simply because it contains rows.
Fabric realms have their own app registry and fingerprint.

See [data planes](./data-planes.md), [apply](./apply.md),
[rollback](./rollback.md) and [schema history](./schema-history.md).

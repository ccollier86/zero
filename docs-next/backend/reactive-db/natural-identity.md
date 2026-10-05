---
id: zero.reactive-db.natural-identity
type: reference
audience: [developer, agent, operator]
owner: reactive-db
status: draft
visibility: internal
system: reactive-db
feature: natural-identity
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

# Operate By A Natural Business Key

[ReactiveDB index](./index.md) · [Documentation index](../../index.md)

A natural identity is an ordered set of immutable business fields
with a unique index and deterministic Sync key. It does not replace the table's
single primary key.

[Schema natural identity](../schema/natural-identity.md) owns declaration/value
rules and shared ID helpers. This page owns instance operations.

```ts
import type { ReactiveDB } from '@zero/framework/sync';

// The assignments table declares project_id/member_id as its natural identity.
export function labelAssignment(db: ReactiveDB) {
  return db.upsertByIdentity('assignments', {
    project_id: 'synthetic-project', member_id: 'synthetic-member', label: 'Review',
  });
}
```

This trusted service fragment assumes table admission and caller authority were
established. A missing primary key is derived for a new natural-identity row.

## Methods

| Method | Contract |
| --- | --- |
| `getIdentity(table)` | copy of ordered fields; empty when none |
| `identityKey(table,key)` | deterministic key; rejects table without identity |
| `queryByIdentity(table,key)` | row or null using declared identity values |
| `upsertByIdentity(table,row)` | merge existing matching row using its current key, otherwise insert |
| `updateByIdentity(table,key,partial)` | update matching row; missing returns null |
| `deleteByIdentity(table,key)` | delete matching row; missing returns null |

Missing keys are derived from identity values. Existing rows are addressed by
their current canonical key; the upsert does not rewrite identity because the
caller supplied a different arbitrary key. Identity fields remain immutable
during update.

## Per-Database Uniqueness

Uniqueness belongs to the owning database. The same business values in two
tenant files do not create one global row. File selection/live authority must
be established before identity operations.

An encoded deterministic ID is neither secret nor proof of access. Never let
it stand in for tenant/role/ownership policy.

## Verify

Check deterministic field order, missing/invalid values, duplicate identity
conflicts, unchanged identity during normal updates and behavior of an existing
row with a retained key. In Fabric mode verify equal business keys remain
isolated in independently authorized tenant files.

## Related Guides And Next Steps

- [Schema declaration](../schema/natural-identity.md) owns identity rules.
- [CRUD](./crud.md) contrasts exact-key replacement with identity merge.
- [Scoped operations](./scoped-operations.md) adds trusted shared-row boundaries.

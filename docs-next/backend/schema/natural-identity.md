---
id: zero.schema.natural-identity
type: how-to
audience: [developer, agent]
owner: schema
status: draft
visibility: internal
system: schema
feature: natural-identity
maturity: supported
applies_to: ["2.1.1 source; new documentation under review"]
modes: [server, browser, single-database, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Business Identity Without Composite Sync Keys

[Schema index](./index.md) · [Documentation index](../../index.md)

Use natural identity when several existing fields uniquely identify one
business record—for example, an assignment identified by project and member.
Zero keeps one Sync primary key while deriving a deterministic identifier from
the ordered business-key values and enforcing their declared uniqueness.

```ts
import { defineTable, field } from '@zero/framework/schema';

export const assignments = defineTable('assignments', {
  project_id: field.text({ required: true }),
  member_id: field.text({ required: true }),
  label: field.text(),
}, {
  pk: 'assignment_id',
  identity: ['project_id', 'member_id'],
});
```

The server and client projections carry the same ordered identity declaration.
Managed identity helpers derive a missing key; plain tables without natural
identity generate UUID keys instead. A deterministic identifier is not a
composite SQL primary key and is not a tenant permission or security token.

## Declaration Rules

- Identity fields must be declared fields, must be unique and cannot be the
  configured primary key.
- Names follow the platform identifier shape: a letter/underscore first,
  followed by letters, digits or underscores.
- Omitted or empty identity in the high-level schema declaration means no
  natural identity. The lower-level identity helper requires a nonempty list.
- Identity values must be nonempty strings, finite numbers or booleans. Missing,
  null, empty-string, object and nonfinite-number values are rejected.
- Field order is part of the identity. Keep it aligned across server and client.

See [table options](./configuration.md#table-options). Changing identity fields
or their order is a data migration, not a presentation adjustment.

## Public Helpers

The identity helpers are available from `@zero/framework/sync/identity`:

```ts
import { createIdentityId } from '@zero/framework/sync/identity';

const id = createIdentityId('assignments', ['project_id', 'member_id'], {
  project_id: 'project-one', member_id: 'member-one',
});
```

`createIdentityId` constructs a version-prefixed deterministic string from the
table, ordered fields and values. `ensureRowSyncPrimaryKey` preserves an existing
nonempty key, otherwise derives one or generates a UUID. `withIdentityPrimaryKey`
forces the deterministic key for identity upserts. `getIdentityValues`,
`assertIdentityFields` and `hasIdentity` validate/inspect that declaration;
`quoteSqlIdentifier` is a validated identifier helper, not a value parameterizer.

Ordinary application code should prefer the SDK's identity-aware collection
operations rather than constructing protocol envelopes itself. Do not treat an
arbitrary caller-provided ID as proof that the business key or actor is valid.

## Mutations And Isolation

Identity fields are immutable in identity-aware mutation handling. Change a
non-key attribute such as `label` through an update; changing the business key
requires a deliberate replacement/migration strategy. Do not mutate `_identity`
or patch only the client definition to bypass the server rule.

Uniqueness applies in the owning database. In Fabric tenant-database mode,
identical business values in two tenant databases do not cause a global shared
row. Request/realm authority still selects the correct physical database before
the mutation; an encoded ID is not a database selector.

## IDs Are Not Secret

The encoded identifier carries business-key information; it is not encrypted.
Use opaque business identifiers, not passwords, credentials or sensitive text,
as identity fields. Do not use row IDs as high-cardinality metrics labels.

## Verify A Declaration

Generate two IDs for the same table/ordered values: they should match. Change
one value: the ID should change. Verify missing and invalid values fail before
dispatch, and identity-aware updates reject key changes. Those checks are
different from testing a database's unique index and live tenant isolation.

## Related Guides And Next Steps

- [Tables](./tables.md) keeps server/client declarations aligned.
- [Descriptors](./descriptors.md) exposes the selected identity metadata.
- [Guardian references](./guardian-references.md) explains membership anchors;
  business identity alone does not establish membership authority.
- [Roadmap](./roadmap.md) separates future schema behaviors from today's keys.

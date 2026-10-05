---
id: zero.schema.guardian-references
type: how-to
audience: [developer, agent]
owner: schema
status: draft
visibility: internal
system: schema
feature: guardian-references
maturity: supported
applies_to: ["2.1.1 baseline with unreleased Schema corrections"]
modes: [Guardian single, Guardian multi, single-database, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Reference Users Without Copying Authentication

[Schema index](./index.md) · [Documentation index](../../index.md)

Guardian's canonical users, authentication and authority live in Zero's system
database. Application records live in the application database or a Fabric
tenant database. SQLite foreign keys cannot cross those database boundaries.
Guardian reference fields request managed, minimal local identity anchors so
application records can still have real user/membership foreign keys.

## Attribute A Record To A User

```ts
import { defineTable, field } from '@zero/framework/schema';

export const notes = defineTable('notes', {
  author_id: field.guardianUser(),
  body: field.text({ required: true }),
});
```

The field emits a TEXT reference to `users(user_id)` with delete RESTRICT and,
by default, NOT NULL. The managed application composition discovers its anchor
requirement and prepares the corresponding application/tenant plane before
authorized operations use it.

Do not define a second full `users` authentication table in the app database,
copy password/session/role state into an application record, or replace the
foreign key with a plain text field to get past readiness checks.

## Attribute To A Membership

```ts
export const teamNotes = defineTable('team_notes', {
  author_membership_id: field.guardianMembership(),
  body: field.text({ required: true }),
});
```

This references `tenant_memberships(membership_id)` and requires multi-tenant
Guardian. Membership references imply both membership and user anchors, because
the managed membership anchor itself depends on the user anchor. They describe
a tenant membership, not the user's current platform permission set.

## Options And Admission

Both builders accept `label`, `description`, `required`, `tableVisible`,
`sortable`, `filterable` and `columnWidth`. Defaults are required=true and
tableVisible=false. Other presentation options are delegated to the consumer.
They are presented as hidden/reference fields rather than an automatic user
picker. In the corrected development source, `required:false` permits an
omitted or null reference, matching the nullable SQL column. It does not make
an empty string or nonexistent identity valid. A required reference rejects
omission/null. Null can clear an optional reference explicitly in JSON updates;
undefined is an omitted property, not a reliable wire-level clear operation.

Guardian references require auth enabled. Membership references additionally
require `auth.tenancy.mode: 'multi'`. Configuration failures reject startup with
`DATABASE_CONFIG_INVALID`; declaration/installed foreign-key mismatch is rejected
rather than silently publishing a weakened table. An installed application FK
mismatch uses `DATABASE_SCHEMA_MISMATCH`.

These fields do not enable Fabric by themselves. They work in the declared
application/realm placement. Managed runtime admission and projection readiness
own the preparation barrier; callers must not mutate a projection to fabricate
authority.

## Existence Is Not Permission

An anchor proves local referential existence. It does not prove the actor may
assign that author, read a record, manage that membership or use another tenant's
data. Derive ownership from the live server context or enforce the appropriate
resource write policy; never trust a hidden client field as authorization.

Suspension, login/logout, profiles, roles and revocation remain canonical in the
system plane. Use the supported Guardian/server services when those details are
needed. A shallow anchor is deliberately not a complete profile or permission
cache.

## Inspect Without Guessing

`getGuardianTableReferences(table)` lists exact declared references;
`getGuardianAnchorRequirements(table)` lists the complete user/membership set;
`hasGuardianTableReferences(table)` tests presence. These are public from
`@zero/framework/schema`. `inspectGuardianReferenceSchema(table, storage?)`
reports safe mismatch issues and optionally inspects installed FK metadata
through a supplied trusted read-only database adapter.

The attached symbol metadata is immutable and non-enumerable. Serializing a
server table into JSON discards that metadata; it is not a supported shortcut
for passing server declarations to managed composition.

## Verification

In an isolated fixture, check the generated FK target/delete behavior, both
anchor requirements for a membership field, and rejection when auth/mode or
installed schema is wrong. Then test actual ownership/tenant permissions with
the app's resource policy. Passing FK validation does not substitute for that
authorization test.

## Related Guides And Next Steps

- [Tables](./tables.md) shows how reference fields travel in full declarations.
- [Configuration](./configuration.md#guardian-reference-options) lists their
  presentation and mode requirements.
- [Natural identity](./natural-identity.md) is a separate business-key facility.
- [Data planes](../../concepts/data-planes.md) explains why these anchors are
  local while canonical authentication remains in the system database.

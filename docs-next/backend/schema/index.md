---
id: zero.schema
type: index
audience: [developer, agent]
owner: schema
status: draft
visibility: internal
system: schema
feature: overview
maturity: supported
applies_to: ["2.1.1 source; new documentation under review"]
modes: [single-database, Fabric, server, browser]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Schema: One Declaration, Several Consumers

[Backend index](../index.md) · [Documentation index](../../index.md)

The schema package describes the application's rows. A field carries validation,
presentation metadata and a storage representation. A schema descriptor groups
fields; a table definition adds a name and row identity. Server and browser
consumers use different projections of that declaration.

Schema is not authorization. Hiding a field, assigning a password input type,
or declaring an owner reference does not make a record private or authorize a
write. Server resource and Guardian policies enforce those decisions.

## Choose Your Entrance

- [Fields](./fields.md): every builder's validators, logical values, defaults and
  SQL representation, including optional clears and identity references.
- [Descriptors](./descriptors.md): validation, defaults and reusable row metadata
  without installing a table.
- [Tables](./tables.md): `defineTable` and multi-table `schema` composition,
  server/client projections and primary keys.
- [Codecs](./codecs.md): logical form values versus SQLite/wire values.
- [Types](./types.md): logical input/output, stored rows, insert inputs and
  literal/dynamic option inference.
- [Registry](./registry.md): explicit global table-name/row type aliases without
  runtime registration or implicit SDK name binding.
- [Validation](./validation.md): server logical mutation validation, partial
  updates and its separate authorization/codec boundaries.
- [UI metadata](./ui-metadata.md): generated controls, column precedence and
  presentation boundaries in reusable forms/tables.
- [Natural identity](./natural-identity.md): deterministic row IDs for a business
  key, without composite Sync primary keys.
- [Guardian references](./guardian-references.md): user and membership foreign
  keys through managed shallow anchors, without copying identity authority.
- [Configuration](./configuration.md): exact declaration options and what they
  control; these are startup declarations, not a database settings editor.
- [Roadmap](./roadmap.md): future schema ideas, separated from today's API.

These guides describe inspected working source. Their draft/internal state
means source/artifact review and the complete reader-facing frontend integration
manual are still being qualified; it is not a feature availability switch.

## Minimal Table Module

This is a declaration module, not a complete server:

```ts
// db/schema.ts
import { defineTable, field } from '@zero/framework/schema';

export const tasks = defineTable('tasks', {
  title: field.text({ required: true, label: 'Title' }),
  done: field.boolean({ defaultValue: false, label: 'Done' }),
});
```

The definition supplies `tasks.schema`, `tasks.serverTable`,
`tasks.mutationValidator` and `tasks.clientTable`. If no `id` field is declared,
the generated server/client shapes include that key. The descriptor's ordered
field names still contain only the fields you explicitly declared.

## Design Principles

The following principles are inferred from the inspected integration:

1. Share declarations, not server execution authority. Client descriptors carry
   loading/encoding metadata, never executable permission checks.
2. Keep logical validation separate from storage codecs. Encoding a value does
   not prove it is valid or authorized.
3. Keep one Sync primary key even when business identity uses several fields.
4. Reference canonical identity through minimal storage anchors; continue to
   resolve access from live Guardian state.

Treat declarations as startup inputs. Some returned structures are typed
readonly but are not universally deep-frozen; do not mutate them after admission.

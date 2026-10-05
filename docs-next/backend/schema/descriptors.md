---
id: zero.schema.descriptors
type: reference
audience: [developer, agent]
owner: schema
status: draft
visibility: internal
system: schema
feature: descriptors
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

# Reusable Schema Descriptors

[Schema index](./index.md) · [Documentation index](../../index.md)

Use `defineSchema` when you need row validation and generated UI metadata
without declaring a named database table. Use [defineTable](./tables.md) when
the same declaration should also be installed on the server and registered in
the client.

## Define And Validate

```ts
import { defineSchema, field } from '@zero/framework/schema';

const taskForm = defineSchema({
  title: field.text({ required: true, maxLength: 200 }),
  done: field.boolean({ defaultValue: false }),
});

const result = taskForm.validate({ title: 'Prepare a report', done: false });
if (result.success) {
  // result.output is the Valibot-parsed logical record.
} else {
  // result.issues contains field-addressed validation feedback.
}
```

`validate` is synchronous and returns a Valibot safe-parse result; it does not
write a row or throw merely because a user value fails validation. A malformed
declaration can fail during construction/admission instead. Use safe field
messages in the UI, not arbitrary provider/database stack traces.

## Descriptor Contract

| Member | Meaning |
| --- | --- |
| `schema` | The Valibot object schema for the explicitly declared logical fields. |
| `fields` | Ordered metadata lookup by field name. |
| `fieldNames` | Declaration insertion order; generated primary keys are not appended. |
| `primaryKey` | Configured key name; defaults to `id`. |
| `identity` | Ordered natural identity fields; empty means no natural identity. |
| `getFieldSchema(name)` | One field validator, or undefined for an unknown name. |
| `getDefaults()` | Fresh object of form/default values, not a database row or generated ID. |
| `validate(data)` | Synchronous logical validation; no persistence or authority check. |
| `encodeField`, `decodeField` | Known-field conversion; unknown field values pass through. |
| `encodeRow`, `decodeRow` | Convert known fields in a shallow copy; preserve other row properties. |
| `toTableSchema(options?)` | SQL column definitions plus server-only mutation/reference metadata. |
| `toClientTableDef(options?)` | Browser table metadata; no executable server validator. |
| `guardianReferences`, `guardianAnchorRequirements` | Storage dependencies described in the [reference guide](./guardian-references.md). |

## Defaults Are Not A Completed Form

The unreleased corrected `getDefaults()` uses an explicit `defaultValue` when
present, then the field validator's parsed omitted value when that is valid.
Optional formatted/choice strings can begin blank, and nullable scalar fields
accept null without weakening constraints on supplied nonblank values.

| Field family | Initial value when no explicit default is supplied |
| --- | --- |
| boolean | false |
| optional number | zero when valid; otherwise undefined/omitted, not an invented min/max value |
| multi-select, tags, multiple combobox | empty array |
| date range | two empty endpoint strings |
| JSON | null |
| Guardian reference | undefined/absent; a real identity is still needed for a required field |
| other string/choice controls | blank string when optional; required fields can still begin incomplete |

Required fields that cannot validate an omitted value receive a suitable
incomplete UI value (for example zero or a blank string), not an assertion
that the form is already valid. Explicit invalid defaults reject declaration
with the value-free `SCHEMA_DEFAULT_INVALID` configuration error. Clearing an
optional numeric control emits explicit null so a JSON PATCH does not silently
drop the edit. The field/type references explain exact per-builder semantics.

Do not assume those initial UI values satisfy every required field or business
constraint. Validation is still required before submitting. Defaults do not
produce a row primary key, insert a record, hash a password or grant permission.
See [configuration](./configuration.md#defaults-and-read-time) for declaration
versus database behavior, and [codecs](./codecs.md) for structured values.

## Deriving Shapes

```ts
const serverTable = taskForm.toTableSchema();
const clientTable = taskForm.toClientTableDef({ sync: 'lazy' });
```

The conversion options may override `pk` and `identity`; the client conversion
also accepts `sync`. Keep server and client identity/key options aligned.
Changing a descriptor does not migrate an existing database. A table definition
is normally safer than separately maintaining two conversion calls.

## Boundaries And Verification

Schema can be imported in browser code, but never put credentials, secret
defaults or server-only application settings into a shared declaration module.
The schema object itself is not a field-access policy. Server validation and
resource exposure must still control data crossing the API/Sync boundary.

A focused check is to validate one valid and one invalid synthetic record and
inspect the generated key/client metadata. No running app or database is needed
for this descriptor check. Installed-package qualification of these examples
is tracked separately from source inspection.

## Related Guides And Next Steps

- [Tables](./tables.md) turns a descriptor into a named full-stack declaration.
- [Codecs](./codecs.md) explains why validation and encoding are separate steps.
- [Natural identity](./natural-identity.md) explains identity conversion options.
- [Configuration](./configuration.md) collects exact options and read times.

These default/type corrections are working-source behavior, not a claim that
the original 2.1.1 package already contained them.

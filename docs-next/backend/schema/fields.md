---
id: zero.schema.fields
type: reference
audience: [developer, agent]
owner: schema
status: verified
visibility: internal
system: schema
feature: fields
maturity: supported
applies_to: ["2.6.0"]
modes: [server, browser, single-database, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "c5656b306051b04ec6adc641b7057a0672fd7a3e"
  snapshot: clean
  date: "2026-10-07"
  evidence_level: source-observed
---

# Field Builders

[Schema index](./index.md) · [Documentation index](../../index.md)

`field` supplies logical validators, SQL/client type hints and presentation
metadata from one declaration. It is browser-safe and does not create tables,
write records or authorize a request. Use it inside a [descriptor](./descriptors.md)
or [table definition](./tables.md).

## A Small Declaration

```ts
// db/schema.ts — shared declaration, no secrets
import { defineTable, field } from '@zero/framework/schema';

export const tasks = defineTable('tasks', {
  title: field.text({ required: true, maxLength: 200, label: 'Title' }),
  status: field.enum(['open', 'complete'], { defaultValue: 'open' }),
  estimate: field.number({ min: 1, integer: true, label: 'Estimated hours' }),
  labels: field.tags({ maxTags: 8 }),
  owner_id: field.guardianUser(),
});
```

This fragment declares a shape. The server still installs the table, contributes
it to the correct data plane and enforces resource/Guardian policy. The owner
reference requires [managed identity anchors](./guardian-references.md); it does
not assign the current user automatically.

## Required, Omitted, Blank And Null

Ordinary builders default `required` to false. Guardian references default it
to true. These terms are deliberately distinct:

- **Omitted** means no property, or an undefined value before transport. Optional
  validators may fill an omitted value using a default.
- **Blank** is the empty string a text control presents. Optional string and
  single-choice controls accept it without disabling validation of nonblank values.
- **Null** represents an absent optional scalar/reference, including an existing
  SQL NULL. It is preserved, not replaced with an invented string, ID or number.
- **Required** uses the builder's nonoptional validator. False and zero remain
  actual values for required boolean/number fields, not missing values.

Required string builders impose their specific string constraints. Text and
textarea use a minimum length of one when required unless `minLength` explicitly
sets another constraint. Email, URL, dates and choices retain their validators;
password's minimum defaults to eight. No builder treats a valid configured
default as permission to omit a required input.

Structured fields use their established neutral logical representations: arrays
for tags/multiple choices, a two-string tuple for date ranges and null for optional
JSON. Their codecs remain separate from scalar null behavior.

## Builder Reference

The result of each method is a `FieldDef` containing `_schema`, `_meta`,
`_sqlType` and `_clientType`. The underscored members support framework composition;
ordinary application code normally uses descriptor methods instead. Exact options
are in [configuration](./configuration.md#field-options).

| Builder | Logical validation and omitted optional value | SQL/client representation |
| --- | --- | --- |
| `text(options?)` | string; minLength/maxLength when set; required minimum defaults to 1; omitted optional becomes `''` or explicit default | TEXT; optional explicit string default emitted as a safely quoted SQL literal |
| `email(options?)` | email string; optional `''`/null; omitted becomes `''` or explicit default | TEXT |
| `phone(options?)` | canonical E.164 string; possible-number validation by default, stricter valid-number option; optional `''`/null; omitted becomes `''` or explicit default | TEXT; required adds NOT NULL; no implicit national-number conversion |
| `url(options?)` | URL string; optional `''`/null; omitted becomes `''` or explicit default | TEXT |
| `password(options?)` | string, minLength defaults to 8, optional maxLength; optional `''`/null; omitted becomes `''` or explicit default | TEXT; tableVisible is forced false, not encryption or hashing |
| `number(options?)` | number with optional integer/min/max; optional null; omission uses explicit default or valid implicit 0, otherwise stays undefined | REAL, or INTEGER with integer=true; optional explicit numeric SQL default |
| `boolean(options?)` | boolean; omitted optional uses defaultValue or false | SQLite INTEGER, encoded as 1/0; client boolean decoding metadata |
| `select(choices, options?)` | one declared value; optional `''`/null; omitted becomes `''` or explicit default | TEXT |
| `multiSelect(choices, options?)` | array of declared values; required array must be nonempty; omitted optional becomes explicit default or `[]` | JSON TEXT |
| `textarea(options?)` | string with text minLength/maxLength behavior; optional `''`/null; omitted becomes `''` or explicit default | TEXT |
| `date(options?)` | ISO date string; optional `''`/null; omitted becomes `''` or explicit default | TEXT, not a JavaScript Date |
| `datetime(options?)` | ISO timestamp string; optional `''`/null; omitted becomes `''` or explicit default | TEXT, not a JavaScript Date |
| `json(options?)` | unknown structured logical value; required rejects null/undefined/`''`; omitted optional becomes explicit default or null | JSON TEXT; constrain application-specific object shape separately |
| `enum(values, options?)` | one literal value from a nonempty tuple; generated labels; optional `''`/null | TEXT |
| `tags(options?)` | string array; required array must be nonempty; omitted optional becomes explicit default or `[]` | JSON TEXT; maxTags is UI metadata, not a Valibot item-count constraint |
| `combobox(choices, options?)` | single declared value by default; multiple=true uses an array and required nonempty behavior | TEXT when single, JSON TEXT when multiple |
| `dateRange(options?)` | `[start, end]` strings, each blank or ISO date; required requires both dates; optional omission becomes `['', '']` | JSON TEXT; no implicit start-before-end business rule |
| `hidden({ defaultValue? }?)` | unknown value with optional default; no rendered control | TEXT hint; hiding does not validate arbitrary payloads or protect data |
| `guardianUser(options?)` | canonical user ID, required by default; optional omission/null allowed, blank rejected | restricted FK to an ID-only users anchor |
| `guardianMembership(options?)` | canonical membership ID, required by default; optional omission/null allowed, blank rejected | restricted FK to an ID-only membership anchor; multi tenancy required |

SQL constraints are not identical to logical validation. For example, required
multiSelect/tags/dateRange is enforced by the logical validator even though its
generated SQL type is TEXT without NOT NULL. Only use a raw SQL shape when its
validation boundary is understood; [server validation](./validation.md) explains
where Zero retains and uses the logical validator.

## Phone Fields

Phone fields are supported in Zero 2.6.0 and share their headless validator
with generated forms. Formatting and numbering-plan validation are not proof
that a user owns the number.

```ts
import { defineTable, field } from '@zero/framework/schema';

export const contacts = defineTable('contacts', {
  phone: field.phone({
    label: 'Contact phone', required: true,
    defaultCountry: 'US', validation: 'possible',
  }),
});
```

`phone` uses the same logical validator in forms and the server mutation
boundary. Nonblank values must already be canonical international strings such
as `+12135550123`: at most 15 ASCII digits after `+`, a supported calling code
and a possible number length. National numbers, formatted strings, extensions,
incomplete drafts and invalid nonblank values are rejected, not silently cleared
or converted using a default country.

`validation: 'valid'` additionally checks the current numbering-plan patterns.
Neither mode verifies ownership, deliverability, SMS support or consent to
contact a number. `defaultCountry` defaults to `US` and only guides the generated
[PhoneInput](../../frontend/components/phone-input.md). It does not change server
normalization, SQL columns or Fabric realm schema identity.

Optional omission defaults to `''` or the explicitly admitted `defaultValue`;
blank and null remain valid absence. Required fields reject omission, blank and
null even when a valid default is configured. Invalid defaults use the existing
value-free `SCHEMA_DEFAULT_INVALID` error. Phone options and generated rendering
are detailed in [configuration](./configuration.md#phone-options)
and [UI metadata](./ui-metadata.md#phone-presentation).

## Choices And Literal Types

Select, multiSelect and combobox choices are label/value pairs:

```ts
const severity = field.select([
  { label: 'Normal', value: 'normal' },
  { label: 'Urgent', value: 'urgent' },
], { required: true });

const recipients = field.combobox([
  { label: 'Operations', value: 'operations' },
  { label: 'Support', value: 'support' },
], { multiple: true });
```

Literal declarations preserve their value union in logical inference. An options
array already widened to string values cannot recover literal values later.
Enum generates a label by capitalizing and splitting camel-case values; supply
explicit choice labels when presentation must differ. See [types](./types.md)
for logical, stored and dynamic-option inference.

## Number Absence And Editing

```ts
const quantity = field.number({ min: 1, integer: true });
```

Optional omitted quantity remains absent because zero fails its minimum; Zero
does not invent a quantity of one. Every actual supplied number must still meet
the declared constraints. An explicit `defaultValue: 2` fills omission with two;
`defaultValue: null` fills it with null.

Clearing a known optional numeric control sends null so an existing persisted
value can actually be cleared. Undefined would disappear from JSON PATCH and
leave the old value unchanged. Required numeric controls retain strict rejection
of blank/null. This behavior is shared by generated forms, the headless form
event path and inline numeric editors; the server must still accept the mutation.

## Default Admission And Errors

An explicit default must pass the field's declaration validator. Invalid email,
undeclared choice, out-of-range number, or wrong single/multiple combobox shape
fails at construction with `SchemaConfigurationError`:

```ts
import { field, SchemaConfigurationError } from '@zero/framework/schema';

try {
  field.number({ min: 1, defaultValue: 0 });
} catch (error) {
  if (error instanceof SchemaConfigurationError) {
    // error.code === 'SCHEMA_DEFAULT_INVALID'
    // error.fieldType === 'number'; message does not expose the default value.
  } else {
    throw error;
  }
}
```

This is a declaration/configuration failure, not a rejected user's form value.
Normal user validation returns a safe-parse result. No new logging sink is
installed by a field declaration; an application error boundary can handle a
configuration failure using standard safe error presentation.

## Verification And Upgrade

For a declaration, validate one valid nonblank value, one invalid nonblank value,
omission and the intended null/blank behavior. Check defaults independently from
raw SQL DEFAULT clauses, and test codecs for structured values. The focused
source tests cover field defaults, default admission, static inference and actual
AutoForm/SQLite clears; installed-artifact qualification remains a separate gate.

Compared with the inspected baseline, optional scalars now honestly retain SQL
null and logical types no longer erase their constraints. Applications may need
null guards where they previously assumed every optional stored scalar was a
non-null value. Normal declaration calls remain unchanged. Existing required
business rules are not weakened, and physical SQL codecs are unchanged.

## Related Guides And Next Steps

- [Configuration](./configuration.md#field-options) lists accepted options by builder.
- [Types](./types.md) distinguishes logical validation from stored-row types.
- [Validation](./validation.md) explains the server mutation boundary.
- [UI metadata](./ui-metadata.md) covers labels, visibility and generated controls.
- [Guardian references](./guardian-references.md) owns reference admission and isolation.

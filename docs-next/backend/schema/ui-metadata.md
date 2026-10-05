---
id: zero.schema.ui-metadata
type: reference
audience: [developer, agent]
owner: schema
status: draft
visibility: internal
system: schema
feature: ui-metadata
maturity: supported
applies_to: ["2.1.1 source with audited corrections; package qualification pending"]
modes: [browser, SSR, single-database, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Schema Metadata In Forms And Tables

[Schema index](./index.md) · [Documentation index](../../index.md)

Field metadata gives Zero's forms and tables a shared presentation vocabulary.
It reduces duplicated labels, editors, widths and codec rules while leaving app
layout/actions configurable. Metadata is not a server field policy: hiding a
control or disabling a sort button cannot protect a record or authorize a write.

## A Reusable Descriptor

```ts
import { defineSchema, field } from '@zero/framework/schema';

export const taskFields = defineSchema({
  title: field.text({
    required: true, label: 'Task', placeholder: 'Describe the task',
    description: 'A short name visible to the workspace.', columnWidth: 280,
  }),
  status: field.enum(['open', 'complete'], { label: 'Status' }),
  estimate: field.number({ min: 1, label: 'Estimated hours' }),
  internal_note: field.textarea({ tableVisible: false, label: 'Internal note' }),
});
```

Use this descriptor in a generated form or a schema-aware table. It has no
server-only imports or credentials. A named table using the same fields should
normally originate from a single [table definition](./tables.md), so validation
and client/server encodings remain aligned.

## Metadata Contract

`descriptor.fields` is a metadata map in declaration order; fieldNames exposes
the corresponding ordered names. FieldMeta includes the following vocabulary,
but the [builder option families](./configuration.md#field-options) determine
which options a particular field accepts.

| Metadata | Consumer meaning |
| --- | --- |
| type | chooses the input/editor, value formatter and codec family |
| label | form label and default table heading; otherwise consumers format the field name |
| placeholder | supported text/choice/date control prompt |
| description | generated form helper text |
| required | validator requirement; optional numeric controls use it to represent explicit clear as null |
| defaultValue | initial/default value; see descriptor defaults rather than assuming every control has a string default |
| options | label/value choices for select, multiSelect, enum and combobox |
| min/max | numeric validator and supported numeric input bounds |
| minLength/maxLength | text/password family constraints where the builder applies them |
| tableVisible | false excludes a default generated column list; does not remove stored/server fields |
| sortable/filterable | default column eligibility, subject to table-wide and explicit column overrides |
| columnWidth | default table column size, overridden by explicit table column width |
| maxTags | TagInput presentation limit; not an automatic server array-length validator |
| searchable/multiple | combobox search and single/multiple presentation |
| optionIcon/optionDescription | available combobox metadata; not a promise that generated AutoForm enriches plain label/value choices with these details |

Undefined presentation options delegate to the consumer's documented defaults;
they are not a globally normalized theme/config setting. Password tableVisible is
forced false. Hidden fields and Guardian references render no automatic input.

## Generated Forms

This is a UI fragment. It needs the app's normal client provider only when using
a collection name; a fully custom asynchronous submission can run standalone.

```tsx
import { AutoForm } from '@zero/framework/react';

<AutoForm
  schema={taskFields}
  collection="tasks"
  columns={2}
  submitLabel="Create task"
  fields={{ title: { autoFocus: true } }}
/>;
```

AutoForm delegates state/validation to useForm and rendering to FieldRenderer.
Its mode defaults to create; edit mode needs editId. It accepts explicit initial
values, a field allow-list, layout/card presentation and per-field autofocus,
hidden and boolean-switch overrides. A visual fields[name].hidden override only
hides rendering; includeFields is the supported form allow-list for rendering,
validation and submitted fields. Neither is a server access-control boundary.

Rendering choices include text/email/URL/password/number inputs, textarea,
checkbox or switch, select, multiple-choice checkbox list, date picker,
date-range picker, tags, combobox and JSON textarea. Datetime uses a DatePicker
and emits an ISO timestamp; do not infer a separate time-of-day editor from the
field name. Required hidden identity fields need values from appropriate app/server
logic; a generated form is not a user picker or authority service.

Initial values combine descriptor defaults and defaultValues and are decoded for
the UI. The submission path encodes known fields again and awaits the custom
callback or acknowledged collection operation. Structured defaults are arrays,
tuples or JSON null; optional scalar SQL null renders as an empty control without
silently changing stored meaning. Optional numeric clearing emits explicit null;
required numeric blank remains invalid.

## Generated Table Columns

The normal DataTable reads schema.fieldNames and omits tableVisible=false by
default. An explicit columns list chooses its own field list; therefore hidden
metadata is not a secret field prohibition. Columns decode known values before
formatting/editor use.

Precedence is deliberate:

- Heading: column override header, then field label, then formatted field name.
- Width: column override width, then field columnWidth.
- Sorting: table-wide sortable must permit it, then explicit column sortable or
  field sortable=false controls eligibility.
- Filtering: explicit column filterable wins over field filterable=false.
- Editing: explicit column editable or the table's editable field list; a schema
  declaration alone does not mark a column writable.

Table column overrides also expose minimum/maximum widths, flexibility, wrapping,
truncation and custom cell rendering. Use those public options for long/revealable
values rather than CSS selectors reaching into internal cells. Server sources
control query execution; a metadata flag does not fetch/sort an already accepted
server page again in the browser.

## Authority, Lifecycle And Verification

The normal authenticated SDK/provider partition protects data when login, tenant
or authority changes. A schema has no user-specific permissions and should not
be mutated to grant access. Configure policies and app actions separately; role
gates can improve the UI without becoming its enforcement boundary.

Verify the intended form controls/defaults, column overrides and server-rejected
edits in an isolated screen. Keep controls usable during pending operations;
display success only after acceptance, and preserve useful failure feedback.
Changing metadata after admission is not a supported schema migration or
implicit reset strategy; use documented component configuration and migration
procedures for the relevant change.

The corrected source tests exercise untouched optional fields, required failures,
nonblank format validation, explicit numeric clears and stored SQL NULL through
actual AutoForm and database validation. These checks establish working-source
behavior; they do not replace package qualification or every app's visual review.

## Related Guides And Next Steps

- [Fields](./fields.md) owns validators rather than presentation hints.
- [Configuration](./configuration.md#field-options) lists exact accepted settings.
- [Descriptors](./descriptors.md) owns defaults and row conversion methods.
- [Validation](./validation.md#forms-and-inline-editing) connects UI acceptance to server writes.
- [Runtime observability](../runtime/observability.md) owns safe logging/error boundaries.

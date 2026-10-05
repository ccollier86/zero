---
id: zero.frontend.forms.auto-form
type: how-to
audience: [developer, agent]
owner: frontend-forms
status: draft
visibility: internal
system: frontend-forms
feature: auto-form
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

# Generate A Form From Its Schema

[Forms index](./index.md) · [Documentation index](../../index.md)

AutoForm composes useForm, metadata-selected field controls and submit/reset
presentation. It saves repetitive wiring while keeping layout, callbacks and
field selection configurable. Use the headless hook for a genuinely custom
editor rather than reproducing its validation/receipt logic.

## Normal Collection Fragment

```tsx
import { AutoForm } from '@zero/framework/react';
import { tasks } from './db/schema';

<AutoForm
  schema={tasks.schema}
  collection="tasks"
  columns={2}
  card={{ title: 'Create task', description: 'Add a workspace task.' }}
  fields={{ title: { autoFocus: true }, done: { useSwitch: true } }}
  showReset
/>;
```

The fragment requires the normal app/client provider and declared collection.
mode defaults create; edit mode supplies editId. A custom onSubmit can instead
own an app/resource operation and must return its complete promise. Encoded data
is supplied to that callback, not an unencoded array/object logical form value.

## Layout And Controls

Default layout is vertical, one column, no card, no reset button. columns greater
than one supplies a field grid; inline adjusts action presentation. The submit
label defaults Create/Save from mode. Pending submission disables the action;
reset is disabled while pending or not dirty. Custom classes still compose with
the platform's token-based primitives.

Field types, labels/help/placeholders/options are derived from the descriptor.
The [renderer](./field-renderer.md) owns input choices, not a new form-specific
schema. Per-field overrides are autoFocus, hidden and useSwitch. Form-field
context wires labels/control/error feedback.

## Field Selection And Ownership

includeFields is the allow-list for rendering, validation and payload. Unknown
names reject and repeated names are deduplicated. fields[name].hidden only hides
the control; hidden/schema-required fields can still need a value. A visual
override does not mean a field was removed or is safe for client assignment.

Guardian author/user fields need the relevant server-derived or authorized value
flow; AutoForm does not fabricate current-user IDs or a membership picker. Server
resource/Guardian policy still owns write/tenant authority. Never put a secret
default into a shared descriptor to make a hidden field appear convenient.

## Defaults, Editing And Accepted Submission

Defaults/defaultValues are decoded for initial UI state. In edit mode the built-in
collection path reads an available local row; application server loading belongs
to its appropriate data hook/resource. Stable defaultValues changes do not
overwrite active user input automatically.

Untouched optional formatted/choice controls validate as blank, while invalid
nonblank values remain invalid. Existing optional SQL NULL stays semantically
null even when the control displays blank. Optional numeric clear is explicit
null; required numeric blank remains rejected. Structured values are arrays/
tuples/JSON logically and encoded on submit. See [fields](../../backend/schema/fields.md).

The built-in writer awaits its exact collection receipt; custom onSubmit is
awaited. onSuccess is not called merely because an optimistic write changed
local state. Duplicate and obsolete scope completion are fenced by useForm.
Supply onError with the app's safe error presentation for submission failures;
validation field feedback and async server rejection are different paths.

## Verification And Compatibility

Check required/format errors, allow-list versus visual hidden fields, edit row
loading, reset/dirty behavior and accepted/rejected writers. Focused actual
AutoForm browser regressions prove optional defaults/null clears and pending
completion using synthetic data. They are not blanket accessibility or every
Guardian/Fabric mode qualification.

Receipt/default corrections preserve ordinary calls while fixing premature
success and impossible optional submissions. Optional scalar reads now have
honest nullable types; adapt app null handling instead of weakening the server.

## Related Guides And Next Steps

- [Configuration](./configuration.md#autoformprops) lists props/defaults.
- [useForm](./use-form.md) owns state and submission lifecycle.
- [Input types](./input-types.md) covers generated representations.
- [Submission and scope](./submission-and-scope.md) connects to accepted writes.

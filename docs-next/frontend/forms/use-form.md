---
id: zero.frontend.forms.use-form
type: reference
audience: [developer, agent]
owner: frontend-forms
status: draft
visibility: internal
system: frontend-forms
feature: use-form
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

# Headless Form State

[Forms index](./index.md) · [Documentation index](../../index.md)

The additive [settings-save contract](./save-and-leave.md) documents accepted
baselines, typed submit outcomes, expected revisions, field acknowledgements and
shared Save/Discard/Stay guards. Legacy initial/reset and handleSubmit behavior
remain compatible; opt into accepted baselines deliberately.

useForm manages schema-backed values, validation, dirty state and an optional
submission path. Rendering stays with the app or [AutoForm](./auto-form.md).
Persisting/authorizing values remains with the SDK/callback and server.

## Compose With Existing Controls

```tsx
import { useForm, FieldRenderer, Button } from '@zero/framework/react';
import { taskFields } from './db/schema';

function TaskForm() {
  const form = useForm({ schema: taskFields, collection: 'tasks' });
  return <form onSubmit={form.handleSubmit}>
    <FieldRenderer
      name="title" meta={taskFields.fields.get('title')!}
      registration={form.register('title')}
    />
    <Button type="submit" disabled={form.isSubmitting}>Create</Button>
  </form>;
}
```

This fragment needs the normal AppProvider/ClientProvider and matching configured
collection; taskFields is the app descriptor with a known title field. Render
all needed required fields or supply appropriate values. useForm is imported
from the React/root barrel, not the generic /hooks package route.

## Result Members

| Member | Behavior |
| --- | --- |
| register(name) | field name/presentation value, change/blur, error and element ref |
| handleSubmit(event?) | async validation/submission; prevents form default when an event is supplied |
| errors | current visible field-validation messages |
| isSubmitting | current accepted-operation wait, scope-aware |
| isDirty | structural comparison of declared logical fields against initial/reset values |
| isValid | current selected-field/schema validation result, false while scope is not readable |
| reset() | resets to captured initial/edit values and clears form feedback |
| setValue(name, value) | sets one logical value for a current scope |
| watch(name) | current logical field value, or undefined for a stale scope |
| getValues() | current logical values, not already encoded data or parsed-output type proof |
| getFieldMeta(name) | schema metadata lookup |
| fieldNames | ordered/deduplicated allowed field names |

Registration accepts direct values or ordinary input events. Checkbox events use
checked; numeric events convert actual numeric text, and known optional numeric
clear becomes null. A nullable value may render as blank while the underlying
logical value still remains null. Do not spread an unknown-value registration
into a custom typed control without choosing its appropriate representation.

## Values And Validation

Initial values merge descriptor defaults and defaultValues and decode known
fields. Structured defaults are logical arrays/tuples/JSON; optional Guardian
references remain absent rather than invented blank IDs. Required inputs may
still need user/server-provided values. [Schema fields](../../backend/schema/fields.md)
owns these rules, including constrained numeric omission.

Blur validates one field. Submit validates the full descriptor, or selected
individual fields when includeFields is supplied, marks fields touched and
focuses the first available invalid control ref. It does not guarantee every
custom input forwards a focusable ref or every generated picker behaves like a
native input; qualify those controls in the relevant browser screen.

Unknown includeFields entries reject; duplicates are removed. A hidden renderer
alone does not remove the field from validation/submission. Changing initial
props does not continuously reset an in-progress form; configure record/authority
replacement deliberately rather than feeding a new default object as autosave.

## Submission And Scope

After successful validation, known fields are encoded using the descriptor.
A custom onSubmit wins over collection and is awaited. Otherwise collection
create uses insertAsync, edit with editId uses updateAsync after removing the
configured primary key. No writer means validation only, not a persisted mutation.

Rapid duplicate submits share the pending-operation guard. Success/error feedback
and isSubmitting updates are suppressed for an obsolete identity/tenant scope.
Edit mode reads an available local collection row and resets its initial values;
it is not a server query or live overwrite of an active draft.

onError receives the caught Error.message or the fallback Submit failed. Custom
writers must throw safe feedback or handle their error boundary; the headless
hook does not install a toast/sink or sanitize arbitrary app-owned messages.
See [submission and scope](./submission-and-scope.md) for accepted/uncertain outcomes.

A failure in the onSuccess notification is separately observed with the standard
frontend mutation code and accepted-callback stage, without logging its raw
message or calling the write-failure onError. A promise returned by that callback
is also observed/awaited; its late failure cannot finish a replacement scope.
An accepted write must not be reissued because its follow-up notification failed.

## Verification And Compatibility

Test structured defaults/dirty comparison, field allow-list, required/format
failure, duplicate submit, delayed acceptance/rejection and scope replacement.
The audited receipt correction changes earlier optimistic-success timing while
keeping the normal options/callback shape. Optional clears now represent real
nullable persistence instead of a dropped patch. Do not infer a database migration
or universal autosave facility from those corrections.

## Related Guides And Next Steps

- [Configuration](./configuration.md#useformoptions) lists every option.
- [FieldRenderer](./field-renderer.md) is the normal metadata control bridge.
- [AutoForm](./auto-form.md) provides complete generated layout.
- [Acknowledged mutations](../sdk/acknowledged-mutations.md) owns receipt semantics.

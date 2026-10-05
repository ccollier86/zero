---
id: zero.frontend.forms.field-context
type: reference
audience: [developer, agent]
owner: frontend-forms
status: draft
visibility: internal
system: frontend-forms
feature: field-context
maturity: supported
applies_to: ["2.1.1 source; package qualification pending"]
modes: [browser, SSR]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Label, Control And Error Context

[Forms index](./index.md) · [Documentation index](../../index.md)

Field context connects one control with its name, label, help text and error.
It owns IDs/ARIA presentation, not form values, validation, submission or server
authority. Generated FieldRenderer already uses it; compose it for custom fields.

## Public Composition

```tsx
import {
  FormField, FormLabel, FormControl, FormDescription, FormMessage,
} from '@zero/framework/components/ui/form-field';
import { Input } from '@zero/framework/react';

// Fragment: value/change/error are supplied by the app's form state.
<FormField name="title" error={error} description="A short task name.">
  <FormLabel>Task</FormLabel>
  <FormControl><Input value={value} onChange={onChange} /></FormControl>
  <FormDescription>A short task name.</FormDescription>
  <FormMessage />
</FormField>;
```

FormField takes name/children and optional error, description and className. Its
description prop supplies context; FormDescription renders the actual helper
element. Do not assume passing description alone renders content.

## Members

- FormField creates the stable React ID and strict context for this field.
- FormLabel links htmlFor to that ID and uses error-aware token styling.
- FormControl clones exactly one ReactElement child with id, name,
  aria-describedby and aria-invalid. Extra supplied props can override the
  generated values, so preserve intended accessibility when customizing.
- FormDescription renders the matching description ID.
- FormMessage prefers the context error to children; it renders only when a body
  exists and uses role=alert with the matching error ID.
- useFormFieldContext reads id/name/error/description and requires FormField.

Error linkage takes precedence over description linkage in the current generated
aria-describedby value. A custom control must accept/forward the cloned props
to its actual accessible element; cloning a composite element does not itself
prove the final DOM is connected correctly.

## State And Failure Boundaries

Connect values/change/blur/ref to [useForm](./use-form.md) or the app's deliberate
control state. Context does not convert numeric values, encode structured fields
or catch a rejected writer. Keep field validation feedback separate from the
app's asynchronous submission error presentation.

Messages are caller/schema feedback, not a sanitization function. Do not display
raw private server/provider stack text through FormMessage. Hidden/disabled field
UI does not restrict server assignment or make a value secret.

## Verification

Check label click targets the real input, errors/description IDs resolve,
aria-invalid changes with validation and custom children forward the linkage.
Test keyboard/focus behavior in the actual rendered control; source-level context
inspection alone is not full accessibility qualification.

## Related Guides And Next Steps

- [FieldRenderer](./field-renderer.md) is the normal generated composition.
- [useForm](./use-form.md) supplies validation and registration.
- [Configuration](./configuration.md#field-context) lists exact context inputs.
- [Input types](./input-types.md) distinguishes logical control representations.

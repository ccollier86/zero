---
id: zero.frontend.forms.field-renderer
type: reference
audience: [developer, agent]
owner: frontend-forms
status: verified
visibility: internal
system: frontend-forms
feature: field-renderer
maturity: supported
applies_to: ["2.6.0"]
modes: [browser, SSR]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "c5656b306051b04ec6adc641b7057a0672fd7a3e"
  snapshot: clean
  date: "2026-10-07"
  evidence_level: source-observed
---

# Metadata-Selected Field Rendering

[Forms index](./index.md) · [Documentation index](../../index.md)

FieldRenderer is the bridge between a field's metadata and useForm registration.
It renders an existing platform control with label/help/error context. It does
not run persistence, select a tenant, grant field access or replace the schema
validator.

## Public Props

FieldRenderer and FieldRendererProps are public from @zero/framework/react.
Required props are name, meta and registration; overrides optionally supplies
autoFocus, hidden and useSwitch. Phone/readOnly overrides also supply
phone defaultCountry and supported native-control readOnly overrides.

```tsx
import { FieldRenderer, useForm } from '@zero/framework/react';

// Fragment: schema is an app-owned descriptor containing title.
const form = useForm({ schema, onSubmit: saveEncodedValues });
<FieldRenderer
  name="title" meta={schema.fields.get('title')!}
  registration={form.register('title')}
  overrides={{ autoFocus: true }}
/>;
```

saveEncodedValues is the app's complete async writer, not a platform helper
introduced by this example. A useForm hook must be called inside a React component.
The known field should be checked when a name comes from dynamic/untrusted input.

## Rendering Behavior

Hidden metadata or overrides.hidden renders nothing. Otherwise the label is
meta.label or a formatted name; description and validation error are connected
through FormField. Control selection follows [input types](./input-types.md).
Per-field override hidden only affects rendering; use the form's includeFields
to select validation/payload fields deliberately.

Numeric input displays null/undefined/blank as empty, converts numeric text,
and maps a known optional clear to null. Text controls emit strings. Choice
controls emit declared values/arrays. Date controls convert selected Dates into
schema strings; date ranges emit a two-string tuple. JSON textarea parses valid
JSON and retains invalid/non-JSON text as a logical string for its validator.

Checkbox is the default boolean; useSwitch selects the platform Switch. Tags
use maxTags presentation metadata. Combobox maps label/value options, honors
multiple and defaults its generated search to true when metadata is omitted.
optionIcon/optionDescription metadata does not automatically manufacture rich
option content from a plain label/value declaration.

## Phone Rendering

Phone fields use the shared control and ordinary field lifecycle in Zero 2.6.0.

Phone metadata renders the shared [PhoneInput](../components/phone-input.md).
The renderer forwards current value, change, blur, input ref, required state,
placeholder, autofocus, default country and numbering-plan validation mode.
FormControl still supplies the ID/name/description/error linkage. The renderer
does not invent a separate form controller or submit path.

`overrides.defaultCountry` is phone-specific and takes precedence over schema
metadata (`US` when omitted). It does not relax canonical backend validation.
`overrides.readOnly` is forwarded to phone and generated native Input/Textarea
controls; rich choice/date/boolean controls do not gain an implicit readOnly API.
Read-only presentation is not a permission check and does not exclude a field
from validation or submission.

Optional phone null displays blank. A user clear emits null, while a required
clear stays blank and invalid. Nonempty partial values remain drafts and must
pass the [phone validator](../../backend/schema/fields.md#phone-fields)
before ordinary form submission can succeed. See [form configuration](./configuration.md#phone-and-readonly-overrides).

## Custom Controls And Boundaries

A genuinely custom input can consume registration directly, choose its logical
representation and compose [field context](./field-context.md). Keep value/blur/ref
wiring aligned rather than reimplementing auth, dirty state or the writer.
Metadata is descriptive: tableVisible, hidden and password input presentation
do not encrypt stored data or authorize its exposure.

Required hidden Guardian IDs need a supported server-derived assignment flow;
FieldRenderer is not an automatic user/member picker. Sharing a schema is safe
only when its metadata/defaults contain no credentials or server-only secrets.

## Verification

Check the intended type/control, logical value, schema validation and encoded
writer payload. Exercise blank/null/defaults and custom ref focus in a real
synthetic screen. Actual AutoForm regressions cover several generated field
families; full accessibility/installed-package qualification remains separate.

## Related Guides And Next Steps

- [Input types](./input-types.md) gives the control/value map.
- [Field context](./field-context.md) owns label/help/error linkage.
- [Schema UI metadata](../../backend/schema/ui-metadata.md) owns declaration hints.
- [useForm](./use-form.md) owns values/validation and accepted submit.

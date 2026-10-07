---
id: zero.frontend.components.phone-input
type: reference
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: phone-input
maturity: preview
applies_to: ["Working source on Zero 2.5.0; release qualification pending"]
modes: [browser, SSR, controlled, native-form, generated-form]
reviewed_against:
  package: "@zero/framework"
  version: "2.5.0"
  commit: "39c0ed1de0501986810a2b99366f484e66ba80dc"
  snapshot: dirty
  date: "2026-10-06"
  evidence_level: source-observed
---

# Phone Input

[Component index](./index.md) · [Forms](../forms/index.md) · [Documentation index](../../index.md)

`PhoneInput` combines a country flag, a searchable country picker and national
number formatting. It reuses Zero's Input, Button, Popover, Command, ScrollArea
and icons, with the current light/dark tokens. Formatting comes from
`react-phone-number-input`; numbering-plan validation uses
`libphonenumber-js`. No provider, session or AppProvider is needed to edit a local
value. Persistence and contact verification remain application responsibilities.

This is an additive, unreleased working-source component, adapted from ReUI's
country-picker and read-only examples. It is not in the already published
2.5.0 archive. The shared [Input](./primitives/inputs.md#input-textarea-and-label)
remains the normal base control; a second general-purpose input is not added.

## Public Imports And Ordinary Usage

```tsx
'use client';

import { useState } from 'react';
import { PhoneInput } from '@zero/framework/components/phone-input';
import { Label } from '@zero/framework/components/ui/label';

export function ContactPhone() {
  const [phone, setPhone] = useState('');
  return <div className="space-y-2">
    <Label htmlFor="contact-phone">Phone number</Label>
    <PhoneInput id="contact-phone" name="phone" value={phone}
      onChange={setPhone} placeholder="Enter a phone number" />
  </div>;
}
```

The focused entry exports `PhoneInput`, `PhoneInputProps` and `PhoneInputSize`.
The component and types are also available from `@zero/framework/react` and the
framework root. Headless `isPhoneNumber`, `isPhoneCountry`, `PhoneCountry` and
`PhoneNumberValidation` are available from `@zero/framework/schema`, as well as
root/React, without importing a server or executing a database operation.

## Values, Country Selection And Validation

`defaultCountry` is `US` unless specified. It chooses the initial country for
national input; it is not a forced country override for an existing international
number. For example, `value="+33612345678"` is French even if the default is US.
Use ISO country codes such as `US`, `FR` and `GB`, not dial codes. `countries`
optionally limits the picker and `onCountryChange` observes upstream country
changes. `labels` allows caller-supplied country names and accessibility labels.
There is no invented controlled `country` API or service-backed country lookup.

The change callback receives international E.164 drafts: a complete US number
is `+12025550123`. A partial number, including a lone `+`, remains nonempty and
invalid. Only an actual clear emits `''`. Do not save every callback value
without validation. Controlled `value={null}` or `value={undefined}` clears a
controlled component rather than restoring its `defaultValue`.

| Validation setting | Meaning |
| --- | --- |
| `possible` (default) | Canonical international format and possible number length/country. |
| `valid` | The same checks plus the library's current numbering-plan patterns. |

Neither setting checks ownership, consent, reachability or SMS delivery. Strict
numbering-plan metadata can lag real allocations. No network request or phone
verification occurs, and installing this control does not add SMS MFA to Guardian.
Malformed nonempty values participate in native validity; the field marks its
own invalid state after blur unless the surrounding form supplies `aria-invalid`.
Associate an accessible label and explanatory/error text normally.

## Read-Only, Disabled And Native Forms

```tsx
import { PhoneInput } from '@zero/framework/components/phone-input';
import { Input } from '@zero/framework/components/ui/input';

export function LockedContact() {
  return <form>
    <Input aria-label="Account identifier" name="account" value="example"
      readOnly />
    <PhoneInput aria-label="Verified phone" name="phone"
      value="+12025550123" readOnly />
  </form>;
}
```

`readOnly` prevents both text edits and country selection. The country prefix
becomes static, an already-open menu closes, and late country callbacks cannot
change a locked value. The number remains focusable, selectable, copyable and
included in a native form. Shared Input retains those native semantics and its
focus indicator, without suggesting an editable hover border.

`disabled` instead disables interaction and excludes the field from native
submission. Read-only is presentation, not a server authorization rule: a caller
can construct a different HTTP request. Enforce immutable properties server-side.

The visible input displays a formatted number and is intentionally unnamed.
`name` adds exactly one hidden field with the canonical current value; a valid
native `FormData` therefore does not contain duplicate formatted/canonical values.
`form` associates both with an external form. Native `required`/custom validity,
`id`, `autoComplete` (default `tel`), `autoFocus`, ARIA, blur/focus handlers and the
forwarded `HTMLInputElement` ref belong to the visible input. Uncontrolled native
reset restores the initial `defaultValue`; a controlled owner must reset its state.

## Schema-Generated Forms

```tsx
import { AutoForm } from '@zero/framework/react';
import { defineTable, field } from '@zero/framework/schema';

const contacts = defineTable('contacts', {
  name: field.text({ required: true }),
  phone: field.phone({ label: 'Phone number', defaultCountry: 'US' }),
});

export function ContactForm({ save }: {
  save: (data: Record<string, unknown>) => Promise<void>;
}) {
  return <AutoForm schema={contacts.schema} onSubmit={save}
    fields={{ phone: { defaultCountry: 'FR', readOnly: false } }} />;
}
```

`field.phone()` carries the same validation into the schema and server mutation
validator. It persists ordinary TEXT, not a new database type. Server input must
already be canonical; `defaultCountry` is UI metadata, not an implicit server
normalizer. Optional blank/null follows the existing scalar contract; generated
forms explicitly clear optional phone values to `null`. Required blanks and
nonempty invalid drafts remain rejected. See [field options](../../backend/schema/configuration.md#field-options)
and [generated values](../forms/input-types.md) for defaults and submission.

`AutoForm.fields.<key>.readOnly` also applies to native text/email/url/password,
numeric and textarea controls. It does not invent read-only behavior for every
rich selector or grant permission to persist the field.

## Presentation Options

| Prop | Default / purpose |
| --- | --- |
| `value`, `onChange` | Parent-owned string or nullable clear; callback receives a string draft. |
| `defaultValue` | `''`; initial uncontrolled value. |
| `defaultCountry` | `US`; initial national interpretation. |
| `countries`, `labels`, `onCountryChange` | Optional picker subset, translations and change observer. |
| `validation` | `possible`; opt into `valid` for stricter patterns. |
| `variant` | `default`; `sm` and `lg` provide compact/large control heights. |
| `className` | Outer joined field layout. |
| `inputClassName` | Visible shared Input styling. |
| `popupClassName`, `scrollAreaClassName` | Country popover and bounded scrolling overrides. |
| Native input props | Labels, form association, read-only/disabled, focus, autocomplete and validity. |

The country popup uses the existing collision-aware Popover and scrolls within
the available viewport. Do not remove its width/height bounds when customizing.
Keep semantic tokens and accessible focus styles; the future theme redesign is
separate from this component.

## Related Guides And Next Steps

- [Native input semantics](./primitives/inputs.md) explains shared base behavior.
- [FieldRenderer](../forms/field-renderer.md) connects registration and field context.
- [Schema fields](../../backend/schema/fields.md) defines admitted stored values.
- [Guardian properties](../../backend/guardian/user-properties.md) are a separate
  account configuration contract; a phone schema builder does not silently change it.

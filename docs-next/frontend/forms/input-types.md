---
id: zero.frontend.forms.input-types
type: reference
audience: [developer, agent]
owner: frontend-forms
status: draft
visibility: internal
system: frontend-forms
feature: input-types
maturity: supported
applies_to: ["2.1.1 source with audited corrections; package qualification pending"]
modes: [browser, SSR]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Generated Input Values

[Forms index](./index.md) · [Documentation index](../../index.md)

Generated controls edit logical values. Submission encodes known fields using
the descriptor; server validation and authority remain separate. This map
describes FieldRenderer composition, not every option exposed by each underlying
UI primitive.

| Schema kind | Generated control | Logical value / clear behavior |
| --- | --- | --- |
| text/email/url/password | Input with corresponding type | string; nullable stored value displays blank |
| phone — 2.5.0 working update | PhoneInput with country/flag selector | canonical international string draft; optional clear null; required blank stays invalid |
| number | numeric Input | number; optional explicit clear null; required blank stays invalid |
| textarea | Textarea | string |
| boolean | Checkbox, or Switch override | boolean, including valid required false |
| select/enum | Select | single string choice; optional blank/null belongs to schema rules |
| multiSelect | labeled checkbox list | array of selected declared values |
| date | DatePicker | ISO date string; clear emits blank |
| datetime | DatePicker | ISO timestamp string; clear emits blank, no separately implied time editor |
| dateRange | DateRangePicker | `[start, end]` ISO dates; incomplete/clear emits `['', '']` |
| tags | TagInput | string array, maxTags presentation setting |
| combobox | Combobox | single string or multiple array from metadata; generated search defaults true |
| json | Textarea | parsed JSON when valid text, otherwise the retained string |
| hidden/Guardian reference | no generated control | value supplied by the appropriate app/server flow |

Date conversion uses ISO strings rather than sending Date objects. Date ranges
validate both values/requiredness but do not impose a business ordering rule.
Choose the appropriate application timezone/date policy explicitly when that
distinction matters; a field type alone is not a calendar/workflow service.

## Phone Values: 2.5.0 Working Update

This addition is source-observed in the working profile-settings branch based
on `39c0ed1de0501986810a2b99366f484e66ba80dc`, separate from the earlier
full-page review identity and installed-package qualification.

The [phone field](../../backend/schema/fields.md#phone-fields-250-working-update)
chooses the reusable [PhoneInput](../components/phone-input.md). Display formatting
is not the stored value: accepted nonblank values are canonical E.164 strings.
Default country is `US`, configurable in the schema or per-field presentation
override. The backend does not infer a country from national input.

Incomplete nonempty drafts remain invalid and are not converted into optional
absence. Clearing an optional phone emits null so a previous persisted value can
be cleared; clearing a required phone retains an invalid blank. Optional stored
null displays blank without changing the initial form payload. The normal
useForm validation, acknowledgment and scope-replacement rules still apply.

Default `possible` validation checks calling code/length; `valid` also checks
current numbering-plan patterns. Neither verifies ownership, delivery or SMS
availability. ReadOnly overrides preserve focus/copy/submitted value rather
than using disabled-field omission. See [configuration](./configuration.md#phone-and-readonly-overrides-250-working-update).

## Defaults And Storage

Ordinary optional strings/single choices support blank/null without weakening
their nonblank format/value checks. Optional constrained numeric omission stays
absent if implicit zero is invalid; actual numeric values retain min/max/integer.
An explicit nullable clear must survive JSON instead of being dropped as undefined.
Required numeric clear remains rejected.

Structured initial values are logical arrays/tuples/JSON, not empty strings.
Boolean codec uses integer 1/0; arrays/dateRange/JSON become TEXT. Declared client
booleans have automatic collection decoding, but arbitrary structured TEXT
columns do not universally become objects in every SDK. See
[codecs](../../backend/schema/codecs.md).

## Configuration And Security

Field labels, descriptions, placeholders, options and supported constraints come
from [schema metadata](../../backend/schema/ui-metadata.md). The form controls do
not grant write permission or validate arbitrary JSON business shape. Password
presentation masks entry and hides default table display; it is not hashing,
encryption or permission enforcement.

FieldRenderer owns the generated mapping. Use the underlying public primitive's
own reference for custom behavior instead of assuming metadata exposes every
Radix/animation/native input prop. Keep the same token system and field context.

## Verification And Related Guides

Verify control values, required/nonblank rejection, logical/encoded round trips
and clear behavior. UI defaults passing a schema are not proof a server policy
accepted the record. Actual field/form tests support working-source examples;
primitive-level accessibility and packaged build checks remain separate.

## Related Guides And Next Steps

- [FieldRenderer](./field-renderer.md) owns props/composition.
- [Schema fields](../../backend/schema/fields.md) owns exact validators/defaults.
- [Field context](./field-context.md) owns accessible linkage.
- [Submission and scope](./submission-and-scope.md) owns accepted writer behavior.

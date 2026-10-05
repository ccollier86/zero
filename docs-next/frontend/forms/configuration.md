---
id: zero.frontend.forms.configuration
type: reference
audience: [developer, agent]
owner: frontend-forms
status: draft
visibility: internal
system: frontend-forms
feature: configuration
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

# Form Configuration

[Forms index](./index.md) · [Documentation index](../../index.md)

These are React hook/component inputs read during composition and submission,
not environment settings or a database configuration editor. Field settings live
in the [schema declaration reference](../../backend/schema/configuration.md).
Server permissions remain separate.

## UseFormOptions

| Option | Accepted value | Default / effect |
| --- | --- | --- |
| schema | required SchemaDescriptor | supplies fields, logical validation/defaults/codecs |
| defaultValues | partial caller row | merged over descriptor defaults and decoded for initial/reset values |
| collection | string or Collection<T> | optional; string resolves through client context; object uses caller's supplied collection |
| mode | create or edit | create |
| editId | string | optional; edit collection path loads existing row and excludes primary key from update |
| includeFields | readonly string[] | omitted includes schema fields; known names only, deduplicated; controls validation/payload as well as generated rendering |
| onSubmit | `(encodedData: T) => void | Promise<void>` | custom path wins over collection; caller owns completion/persistence |
| onSuccess | `() => void` | optional, called after accepted current-scope callback/collection operation |
| onError | `(message: string) => void` | optional current-scope submission failure callback |

Changing defaultValues alone does not overwrite the active form's values.
Identity/tenant boundary replacement resets form state from the current initial
configuration. Edit mode's collection lookup is the local row available at the
configured lifecycle point, not an implicit server get request.

## AutoFormProps

AutoForm accepts the preceding options plus:

| Prop | Accepted value | Omitted behavior |
| --- | --- | --- |
| layout | vertical, horizontal or inline | vertical; presentation option, not a schema mutation |
| columns | number | 1; more than 1 sets a CSS grid for generated fields |
| card | title and optional description object | no card wrapper |
| fields | name-to-overrides map | optional autoFocus, hidden and useSwitch per field |
| submitLabel | string | Save for edit, Create otherwise |
| showReset | boolean | false; shown reset disabled when pending or not dirty |
| className | string | optional class composition |

fields[name].hidden hides a rendered control only. includeFields selects rendered,
validated and submitted fields. Neither is a server authorization boundary.
Generated controls still use [field metadata](../../backend/schema/ui-metadata.md).

## FieldRendererProps

name, meta and registration are required. registration is a useForm field
registration containing value/change/blur/error/ref. overrides optionally supplies
autoFocus, hidden or useSwitch. Hidden metadata/override returns no rendered
control; Guardian anchors are hidden reference fields, not an automatic user picker.

## WizardProps

schema, nonempty steps and onComplete are required. Each step has fields:string[],
title:string and optional description. Every registered field must exist in the
schema; intentional fieldless review steps are valid. defaultValues is optional;
onStepChange receives the navigation target index. completeLabel defaults Complete,
columns defaults 1 and className is optional.

Schema replacement or changed step titles/field layout resets navigation and
completion indicators before rendering. Equivalent new arrays preserve navigation
and values; description-only changes do not reset. This configuration reset does
not call onStepChange and does not remount/reset the form instance. See
[Wizard](./wizard.md) for validation/completion lifecycle.

## Field Context

FormField needs name and children; error, description and className are optional.
FormLabel/Description/Message accept their normal label/paragraph props.
FormControl accepts one ReactElement child and clones ID/name/ARIA linkage into
it. useFormFieldContext must be inside FormField. These primitives do not hold
values or run a validator.

## Timing, Security And Verification

No form prop enables server registration/RBAC/tenant rules. Initial values can
include identity data, but the server must derive or authorize assignment. Do
not ship secret defaults or use a hidden field as proof of ownership.

When testing, separate field validation from accepted async submission and
scope replacement. Doctor checks trusted backend declarations; it does not
render a form, simulate keyboard focus or qualify browser field accessibility.

## Related Guides And Next Steps

- [useForm](./use-form.md) owns result members and headless lifecycle.
- [AutoForm](./auto-form.md) owns generated presentation.
- [Wizard](./wizard.md) owns dynamic step behavior.
- [Submission and scope](./submission-and-scope.md) owns acceptance/stale completion.

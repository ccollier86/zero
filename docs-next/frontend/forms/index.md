---
id: zero.frontend.forms
type: index
audience: [developer, agent]
owner: frontend-forms
status: draft
visibility: internal
system: frontend-forms
feature: overview
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

# Schema-Driven Forms

[Frontend index](../index.md) · [Documentation index](../../index.md)

Schema describes validation, logical values and presentation. useForm owns state,
dirty/validation/submission lifecycle; AutoForm/FieldRenderer/Wizard render it.
The SDK or custom callback owns persistence, and the server remains authoritative.

## Choose A Composition

- [useForm](./use-form.md): headless values/registration/validation and awaited submit.
- [AutoForm](./auto-form.md): generated form, layout and field allow-list.
- [FieldRenderer](./field-renderer.md): metadata-selected input rendering.
- [Wizard](./wizard.md): current-step validation and safe dynamic navigation.
- [Field context](./field-context.md): reusable label/control/help/error wiring.
- [Input types](./input-types.md): representation and supported generated control map.
- [Submission and scope](./submission-and-scope.md): accepted writes, stale callbacks
  and identity/organization replacement.
- [Settings saves and leave guards](./save-and-leave.md): accepted baselines, field Check/Cancel, floating saves and Save/Discard/Stay.
- [Configuration](./configuration.md): exact props/defaults/read-time semantics.
- [Roadmap](./roadmap.md): future editor/autosave direction, not current APIs.

useForm and generated forms are public from @zero/framework/react; there is no
@zero/framework/components/forms package subpath. Generic /hooks is not the
useForm entrance. Individual field-context primitives have the documented
@zero/framework/components/ui/form-field route.

## Integration And Philosophy

[Schema](../../backend/schema/index.md) owns validators/defaults/codecs and
logical/stored [inference](../../backend/schema/types.md). [AppProvider](../runtime/app-provider.md)
normally supplies the client and scope protection. [Collections](../sdk/collections.md)
provide acknowledged writes for the built-in path. A custom callback must return
its complete asynchronous operation rather than reporting optimistic success.

Persistent user preferences/form drafts are State Sync integrations, not an
automatic useForm subscription or generic per-tenant autosave mechanism. Compose
them deliberately where needed; the form's defaultValues are initial/reset input,
not a supported way to overwrite an active draft on every render.

The inspected design favors shared field declarations, reusable token-based
controls, explicit accepted submission and scope-bound UI. A hidden field or
form allow-list never substitutes for resource/Guardian assignment policy.

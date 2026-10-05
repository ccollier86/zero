---
id: zero.inventory.frontend-forms
type: inventory
audience: [agent, maintainer]
owner: frontend-forms
status: draft
visibility: internal
system: frontend-forms
applies_to: ["2.1.1"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-04"
  evidence_level: source-observed
---

# Schema-Driven Forms And Validation

[System inventory index](./index.md) · [Documentation index](../../../index.md)

## Audit Identity And Verification Boundary

Framework `@zero/framework` 2.1.1 source baseline is committed `main` at `a3a5f726768dac890f241a3899c0a1acb66265d9`; inspection date 2026-10-04. The baseline commit was clean. The shared working tree now also contains separately authorized source/test corrections; baseline claims remain pinned to the commit unless a supplemental correction is stated. This draft inventory is source-observed and awaiting independent reconciliation. It does not qualify an installed package, wider version range, production browser, or every Guardian/Fabric mode. No application imports, environment files, Doctor, provider requests, live databases, or app scripts were executed. “Tests present” means located, not passed. Planned destinations are plain paths relative to `docs-next/`.

## Purpose And Terminology

Owns headless React form state, generated fields, schema validation and multi-step forms. Schema owns field metadata/codecs; SDK owns persistence/acknowledgements; server authorization remains authoritative.

## Supplemental Authorized Defect Correction

The front matter pins the original committed source audit, not the later working-tree fixes. After the user authorized confirmed defect corrections, Wizard's empty-step crash and silent unknown-field skipping were reproduced with isolated SSR tests: 2 passed and 3 failed before the fix. The working tree now validates a nonempty steps array and every registered field before rendering, with an actionable error that identifies the step/field. Deliberate fieldless review steps remain valid. Changes are in [wizard.tsx](../../../../src/components/forms/wizard.tsx) and [wizard.test.tsx](../../../../src/components/forms/wizard.test.tsx).

Executed on Bun 1.3.14 with automatic env-file loading disabled: `bun --no-env-file test src/components/forms/wizard.test.tsx`; **5 passed, 0 failed** after the fix. This is dirty-working-tree focused verification, not qualification of the original main artifact or the complete browser/form mode matrix. Separately, the authorized [use-form.ts](../../../../src/hooks/use-form.ts) correction now awaits built-in collection insertAsync/updateAsync receipts before onSuccess and submitting-state completion; rejection reaches onError, and custom onSubmit retains precedence and remains awaited. The owning reviewer reports [use-form.test.tsx](../../../../src/hooks/use-form.test.tsx) **4/4 passed**, including scope replacement and stale-submission races; no server transport was used.

### Accepted Notification Closeout

Detailed writing reproduced another narrow acceptance defect: a throwing
onSuccess callback reached the same catch as the accepted writer and invoked
the write-failure onError with private notification text. The synthetic hook
reproduction first recorded **4 passed / 1 failed**. The corrected hook observes
the accepted notification separately, awaits returned promises, emits only the
standard frontend.mutation.failed code with surface/stage metadata and suppresses
obsolete-scope notification failure. It does not reissue a write or change the
callback signatures. Test observability uses a local write-only fixture sink;
HTTP/default sinks are disabled, no external request occurs.

The updated focused hook file passes **6 tests / 0 failed / 37 assertions**,
including sync failure privacy and delayed async notification failure after
scope replacement. The prior hook + actual AutoForm run passed 12 tests/49
assertions before the second async notification case was added. Current global
typecheck passed after the production change; final freeze qualification remains
separate. Source: [use-form.ts](../../../../src/hooks/use-form.ts) and
[regressions](../../../../src/hooks/use-form.test.tsx).

### Dynamic Wizard Navigation Closeout

Further code review confirmed that replacing a multi-step configuration with a
shorter list could leave `currentStep` outside the replacement array. The working
correction reconciles navigation during render, before looking up that step. A
different schema reference or different step titles/field lists resets the current
step, direction and completed-step set; equivalent copied arrays preserve
navigation. This does not remount the form or reset its values. Description-only
changes do not reset navigation, and the configuration reset does not call
`onStepChange` (that callback reports explicit navigation).

The isolated [wizard-lifecycle.browser.test.ts](../../../../src/components/forms/wizard-lifecycle.browser.test.ts)
fixture uses real React rerenders in Chromium without app configuration, network
transport or live data. Its **3 tests passed**: shrinking the list at the last step
does not crash, equivalent arrays preserve the current step and entered values,
and schema replacement resets navigation. On 2026-10-05,
`bun --no-env-file test src/components/forms/wizard.test.tsx src/components/forms/wizard-lifecycle.browser.test.ts src/modals/hold-button.browser.test.ts src/modals/modal-store.test.ts`
passed **21 tests across 4 files, 0 failed, 50 assertions**. Those totals include
the 5 Wizard SSR tests, 3 Wizard browser tests, 10 hold-confirmation browser tests
and 3 modal-store tests; they are not a full accessibility or package qualification.

## Features And Documentation Coverage

| Feature | Exact public symbols/evidence | Canonical planned guide |
| --- | --- | --- |
| Headless form state | useForm/UseFormOptions/UseFormReturn via root/react (not /hooks); [src/hooks/use-form.ts](../../../../src/hooks/use-form.ts) | `frontend/forms/use-form.md` |
| Generated schema form | AutoForm/AutoFormProps via root/react; [src/components/forms/auto-form.tsx](../../../../src/components/forms/auto-form.tsx) | `frontend/forms/auto-form.md` |
| Metadata-driven field renderer | FieldRenderer/FieldRendererProps; [src/components/forms/field-renderer.tsx](../../../../src/components/forms/field-renderer.tsx) | `frontend/forms/field-renderer.md` |
| Multi-step wizard | Wizard/WizardProps/WizardStep; [src/components/forms/wizard.tsx](../../../../src/components/forms/wizard.tsx) | `frontend/forms/wizard.md` |
| Form-field composition/context | FormField/FormLabel/FormControl/FormDescription/FormMessage/useFormFieldContext via UI wildcard; [src/components/ui/form-field.tsx](../../../../src/components/ui/form-field.tsx) | `frontend/forms/field-context.md` |
| Date/date-range/tag/combobox/boolean/text/number inputs | Individual primitives in component catalog; FieldRenderer selects from FieldMeta | `frontend/forms/input-types.md` |
| Persistent drafts/preferences | useFormDraft/usePreference via SDK hooks; [src/frontend/client/preference-hooks.ts](../../../../src/frontend/client/preference-hooks.ts) | `frontend/state/form-drafts.md` |
| Scope-aware reset/submission | useForm authorization-boundary integration; custom submit awaited; authorized working correction awaits collection insertAsync/updateAsync receipts | `frontend/forms/submission-and-scope.md` |

## Public Surface And Integration Map

No /components/forms subpath is declared; use the actual root/react exports. The private forms barrel is implementation evidence, not a new package import. Generic /hooks does not export useForm. useForm exposes register/handleSubmit/reset/setValue/watch/getValues/getFieldMeta, errors/isSubmitting/isDirty/isValid/fieldNames. String collection requires ClientProvider/AppProvider in the browser; a collection object/custom onSubmit may be used without that client context.

Schema default/codec/field allow-list controls client rendering/submission. Hiding a field or restricting a generated form is not server-side field authorization. SDK scope replacement resets form state and stale callbacks; server Resources/Guardian apply final authority. The authorized collection submission correction waits for SDK receipts; it does not define stronger database durability than the collection contract. Wizard validates steps with Valibot and delegates completion; no durable backend workflow is implied.

## Configuration Inventory

| Exact options | Type/default/timing and exposure |
| --- | --- |
| UseFormOptions schema/defaultValues/collection/mode/editId/includeFields/onSubmit/onSuccess/onError | schema required; mode=create; collection name/object/custom submit; includeFields validates known fields/deduplicates; browser render/submit state, not server env config. |
| AutoFormProps inherits those options plus layout/columns/card/fields/submitLabel/showReset/className | layout=vertical, columns=1, showReset=false; fields overrides autoFocus/hidden/useSwitch; card optional; label derived create/edit. |
| FieldRendererProps name/meta/registration/overrides | required name/meta/registration; optional autoFocus/hidden/useSwitch overrides; metadata selects input types. |
| WizardProps schema/steps/defaultValues/onComplete/onStepChange/completeLabel/columns/className | schema/steps/onComplete required; Complete/1 defaults; each step fields/title/description. Authorized working corrections require nonempty steps/known fields and reset navigation for schema or title/field-layout replacement, preserving values. |
| useFormDraft/usePreference | Key/default/state options at preference-hooks declarations; per-authorized-scope state transport, not unscoped local persistence. |

Planned `frontend/forms/configuration.md`. React props have no automatic Doctor/env precedence. Changes to initial values/mode/authority require deliberate lifecycle examples.

## Evidence And Verification

Tests present: [src/hooks/form-value-utils.test.ts](../../../../src/hooks/form-value-utils.test.ts), [src/frontend/client/authorization-scope-hooks.test.ts](../../../../src/frontend/client/authorization-scope-hooks.test.ts), [src/components/ui/date-picker-value.test.ts](../../../../src/components/ui/date-picker-value.test.ts); collection tests cover transport contracts, not a full forms browser suite. Source examples in [src/components/crud-page/crud-page.tsx](../../../../src/components/crud-page/crud-page.tsx) and master-detail. Existing [docs/frontend/forms.md](../../../../docs/frontend/forms.md) is research input.

## Findings, Philosophy, And Known Future Plans

- Confirmed Wizard defect, now corrected in the authorized working tree: empty steps previously crashed and unknown registered fields were silently omitted/skipped. See the supplemental evidence above; no wider release applicability is inferred.
- Confirmed dynamic navigation defect, now corrected in the authorized working tree: a shrinking step configuration previously retained an out-of-range current index. See the browser closeout supplement for the exact replacement/reset contract.
- Confirmed original-main success/error contract defect, now corrected in the authorized working tree: built-in collection submission previously dispatched void insert/update then called onSuccess. It now awaits insertAsync/updateAsync receipts, routes rejection to onError, and waits to complete isSubmitting. Custom onSubmit precedence/awaiting and authorization-scope suppression are preserved. See supplemental focused test evidence above; this is not an installed-package claim.
- Qualification gap: focus/error announcements, hidden/allow-listed submissions, scope replacements, async rejection and date codecs have not been exercised here.
- Established philosophy: one schema drives validation and generated controls while callbacks/SDK own persistence. Forms need dedicated index/configuration/roadmap and links to Schema/Resources/Guardian.
- Future richer data/editor/public-content features in [docs/platform-roadmap.md](../../../../docs/platform-roadmap.md) must reuse supported primitives rather than imply new form APIs.

## Independent Source Reconciliation

Reviewed independently on 2026-10-05 against useForm values/validation/codecs/allow-list, AutoForm/FieldRenderer/Wizard composition, field context, preference/draft hooks and actual frontend/UI exports. Catalog field-context and draft/preference guide homes now agree with the owning inventory. AutoForm's `fields[name].hidden` only suppresses rendering; it is distinct from `includeFields`, which also selects validation and submitted fields. `defaultValues` are initial/reset values, not a promise to overwrite an in-progress form on every prop change. Preferences/drafts require State Sync and use per-user transport keys (`preferences.<key>`, default `drafts.<key>`), not an automatic form autosave subscription or tenant-global store.

The UI closeout reviewer reports a final synthetic set of **22 passed, 0 failed, 52 assertions** across Wizard SSR/browser and HoldButton/modal-store tests on Bun 1.3.14. That supplements rather than rewrites the earlier reproduced failing and intermediate passing runs above. The default submit receipt fix did not by itself repair custom callers that discarded source promises; the subsequent [CrudPage](./frontend-data-controls.md#supplemental-crudpage-acceptance-closeout) and [MasterDetail](./frontend-data-controls.md#supplemental-masterdetail-server-and-write-closeout) closeouts correct and test those composed paths separately.

## Navigation And Completion Review

### Supplemental Schema Defaults And Clears

The Schema owner and independent UI reviewer reproduced untouched optional
formatted/choice fields failing validation, incorrect structured defaults,
password defaults being ignored and absent optional Guardian anchors becoming
blank IDs. The corrected dirty source preserves valid optional blank/null values,
strict required/nonblank constraints and true optional absence. Optional numeric
implicit zero is retained only when valid; explicit clear uses null through the
generated renderer, native useForm event path and server JSON patch.

The independent runtime plus actual AutoForm suite passed **40 tests, 0 failed,
174 assertions**. It includes a fresh in-memory ReactiveDB/SQLite mutation
validator/change-delivery round trip; no app database/provider was used. The
owner's combined eight-file Schema/form/type/default-admission/mode suite passed
81 tests/382 assertions. See [Schema closeout](./schema.md#supplemental-schema-correction-and-detailed-draft-closeout)
for precise scope, initial failing runs and the separate source/package gate.
These are not claims of an automatic form autosave facility or a new field
authorization mechanism. Detailed [defaults/field](../../../backend/schema/fields.md)
and [UI metadata](../../../backend/schema/ui-metadata.md) draft guides now own
the shared contracts; the dedicated frontend form manual follows.

Planned section entrance/configuration/roadmap and per-feature homes above require their parent indexes, contextual links and useful reciprocal guides. Keep these working inventories out of public publication. See the [process](../../../documentation-process.md) and [standards](../../../documentation-standards.md).

- [x] Source-backed feature groups, public routes, and planned homes recorded.
- [x] Tests present, source inspection, and execution claims distinguished.
- [x] Findings and uncertainties recorded without documenting defects away.
- [x] Independent targeted feature/default/import reconciliation.
- [ ] Whole-platform reconciliation and discovered-defect closeout.
- [ ] Exact-package/export/example/mode qualification.
- [x] First-draft feature guides, configuration, indexes and roadmaps placed.
- [ ] Whole-set guide review, public projection and publication qualification.

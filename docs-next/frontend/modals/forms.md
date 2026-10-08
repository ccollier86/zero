---
id: zero.frontend.modals.forms
type: reference
audience: [developer, agent]
owner: modals
status: draft
visibility: internal
system: modals
feature: forms
maturity: supported
applies_to: ["2.6.0 source; structured-modal upgrade unreleased"]
modes: [browser, standalone, Guardian single, Guardian multi, single-database, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "1b5a1fa0281deba69b3809471d2467d596516e4b"
  snapshot: dirty
  date: "2026-10-08"
  evidence_level: source-observed
---

# Forms, Save Guards And Reactive Record Changes

[Modals index](./index.md) · [Documentation index](../../index.md)

The unreleased modal adapter composes existing `useForm`, `useFormSave` and
Save/Discard/Stay presentation. It does not create a new form backend or guess
which table/RPC should persist a draft.

## Native Form And Acknowledged Save

A body component can use `useModalForm({context,form,save?})` to publish owned
dirty/busy/error state and accept only an acknowledged, current, clean submission.
This component fragment assumes an application schema and authorized writer:

~~~tsx
import {
  FieldRenderer, UnsavedChangesDialog, useForm, useFormSave, useModalForm,
  type ModalContext, type FormRevision, type FormSubmitContext,
  type FormSubmissionAcceptance,
} from "@zero/framework/react";
import type { SchemaDescriptor } from "@zero/framework/schema";

type Project = { id: string; name: string };
type Props = {
  context: ModalContext<Project>;
  schema: SchemaDescriptor;
  initial: Project;
  revision: FormRevision;
  saveProject(values: Project, context: FormSubmitContext): Promise<FormSubmissionAcceptance<Project>>;
};

export function ProjectEditor({ context, schema, initial, revision, saveProject }: Props) {
  const form = useForm<Project>({
    schema, defaultValues: initial, mode: "edit", editId: initial.id,
    baseline: "accepted", initialRevision: revision,
    scopeKey: initial.id, onSubmit: saveProject,
  });
  const save = useFormSave({ form, scopeKey: initial.id, guardNavigation: false });
  const modal = useModalForm({ context, form, save });
  return <>
    <form id="project-settings" onSubmit={modal.onSubmit}>
      <FieldRenderer name="name" meta={schema.fields.get("name")!}
        registration={form.register("name")} />
    </form>
    <UnsavedChangesDialog controller={save} />
  </>;
}
~~~

Open with body `context => <ProjectEditor context={context} ... />` and an action
`{id:"save",label:"Save changes",variant:"primary",submit:true,formId:"project-settings"}`.
The footer targets the actual native form. Native constraint validation and the
form's own onSubmit participate; the shell does not install a global Enter handler
that submits while using a textarea, IME or popup.

This static initial-record example does not opt into recordIdentity: that option
requires an explicit authoritative ready snapshot through the record adapter
below, otherwise saving correctly remains blocked until availability is known.

With one active form the shell can identify its target; with multiple forms supply
`formId`. The adapter stops parent submit bubbling across React portals, so a
child form cannot replay its parent's writer. Outside native submission, its
`action()` adapter returns false to prevent the kernel accepting a failed form.
Legacy `handleSubmit()` resolves void and is not evidence of accepted persistence.

## Save/Discard/Stay

`useModalForm` registers a lifetime-owned close guard when a save controller is
provided. It uses cancellable `requestLeave(continuation,{signal})`; closing,
replacing or retiring the owner cancels that leave decision, not an independently
admitted server write. Render UnsavedChangesDialog for the three choices.

Failed, invalid, conflicted or uncertain writes preserve the draft and do not
continue departure. A successful save with newer unsaved edits does not close.
Discard restores the accepted baseline; Stay keeps editing. Native unload/reload
uses the browser's warning, not a custom animated modal.

Manual bodies must publish dirty state through the form adapter or
`context.setDirty`; arbitrary typing is not assumed to represent a persistent
draft. Explicit descriptor guards and bound form guards take precedence over the
generic discard-only prompt. Retained tabs aggregate their owned form state:
unmounting one contributor cannot clear another panel's dirty/pending state.

## Reactive Record Awareness

The canonical [record baseline guide](../forms/reactive-records.md) owns the
source/readiness and reload contract. The following is its modal integration.

The domain supplies an explicit `FormRecordSnapshot<T>` with `identity` and
readiness. A ready snapshot also supplies canonical permitted values,
`origin:"authoritative"` and optional backend revision. Set form.recordIdentity
to the same identity, then use `useReactiveFormRecord({form,record})`.

Readiness is loading/missing/forbidden/ready. An absent local cache row remains
loading until an authoritative read establishes otherwise. `origin:"pending-local"`
is not an accepted receipt or a competing server update and is ignored.

Pristine authoritative changes atomically adopt values, revision and reset baseline.
Dirty or saving forms preserve the draft and expose changedElsewhere plus the
incoming record/revision for review. There is **no inferred automatic field merge**.
The app displays a safe changed-elsewhere notice and explicitly chooses Keep draft
or Reload. `reloadRecord({discardDraft:true})` / the hook's `reload` can admit
discard after the user approves it; an in-flight save cannot be rebased.

Identity/scope checks and known receipt-proven revision supersession prevent
obsolete callbacks or a delayed known-old echo from reinstalling a prior baseline.
Opaque revisions are never numerically sorted by the browser.

## Conditional Writes And Authority

The adapter passes expectedRevision and AbortSignal to a custom writer.
The backend must enforce that revision with an atomic conditional write and
live permission checks, and return canonical accepted values/revision.

A generic collection update acknowledgment is **not automatically a
compare-and-swap check** merely because the form has an initialRevision.
Use the domain's revision-aware endpoint where conflict safety is required.
A browser abort/timeout can occur after server acceptance; keep an operation
identity and reconcile stored state rather than blindly replaying the write.

## Related Guides And Next Steps

[Accepted form baseline](../forms/save-and-leave.md) owns shared saving;
[headless form](../forms/use-form.md) owns validation/values;
[scope retirement](./scope-transitions.md) fences stale editors;
[Guardian](../../backend/guardian/authorization.md) owns permission authority.

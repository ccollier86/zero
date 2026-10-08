---
id: zero.frontend.forms.reactive-records
type: reference
audience: [developer, agent]
owner: frontend-forms
status: draft
visibility: internal
system: frontend-forms
feature: reactive-records
maturity: supported
applies_to: ["2.6.0 source; structured-modal upgrade unreleased"]
modes: [browser, SSR, single-database, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "1b5a1fa0281deba69b3809471d2467d596516e4b"
  snapshot: dirty
  date: "2026-10-08"
  evidence_level: source-observed
---

# Reactive Record Baselines Without Lost Drafts

[Forms index](./index.md) · [Documentation index](../../index.md)

The unreleased record-aware addition connects an application-owned authorized
snapshot to useForm's accepted baseline. It preserves edits during live updates
and reports when another authoritative version is available. It does not create
subscriptions, infer deletion from an empty cache, merge conflicting fields, or
implement backend compare-and-swap.

## Source Identity And Readiness

Set useForm's recordIdentity to the same stable string/number as the source,
baseline:'accepted', an initialRevision when known, and the form's scopeKey.
FormRecordSnapshot has identity plus one of these alternatives:

| status | Other fields | Meaning |
| --- | --- | --- |
| loading | None | Availability is not established; an empty local cache normally means this. |
| missing | None | An authorized authoritative source established absence. |
| forbidden | None | The source established unavailability; do not expose private reasons. |
| ready | values, origin, optional revision | Permitted canonical logical values; origin is authoritative or pending-local. |

`useReactiveFormRecord({form,record})` reconciles through an effect and returns
status, changedElsewhere, incomingRevision, incomingRecord and reload (the
form's reloadRecord). It avoids replaying an unchanged older snapshot after an
accepted save has moved the baseline forward.

Import the helper from root/React or @zero/framework/hooks. The unreleased
generic hooks addition also exposes useForm/useFormSave and the form types.

Complete presentation adapter. Its caller supplies a configured form and an
authorized record source; this component does not guess readiness from cache rows.

~~~tsx
import {
  useReactiveFormRecord, type UseFormReturn, type FormRecordSnapshot,
} from '@zero/framework/react';

type Project = { id: string; name: string };

export function RecordNotice({ form, record }: {
  form: UseFormReturn<Project>;
  record: FormRecordSnapshot<Project>;
}) {
  const observed = useReactiveFormRecord({ form, record });
  if (observed.status === 'missing' || observed.status === 'forbidden') {
    return <p role="status">This record is no longer available.</p>;
  }
  return observed.changedElsewhere ? <section aria-label="Changed elsewhere">
    <p>A newer version is available. Your draft has been kept.</p>
    <button type="button" disabled={form.isSubmitting}
      onClick={() => observed.reload({ discardDraft: true })}>
      Discard draft and reload
    </button>
  </section> : null;
}
~~~

The explicit discard label is the user's decision; a screen may additionally
ask for confirmation. Never call discardDraft:true silently on a live update.

## Admission Rules

| Form/source state | Result |
| --- | --- |
| Pristine, not saving; current authoritative ready source | Adopt values, revision and accepted reset baseline together. |
| Dirty or saving; changed authoritative ready source | Preserve draft; retain incoming record and mark changedElsewhere. |
| pending-local echo | Ignore: optimistic state is neither a receipt nor an authoritative competing revision. |
| Wrong identity or retired scope | Ignore without installing another editor's data. |
| Loading/missing/forbidden | Report readiness; unavailable data is not an empty valid draft. |

Imperative reconcileRecord(record,{discardDraft?}) and reloadRecord({discardDraft?})
return adopted/preserved/unchanged/unavailable, ignored with
retired/identity/pending-local/superseded reason, or blocked with
saving/draft/unavailable reason. Reload never rebases an in-flight save; dirty
reload requires an explicit discard decision.

Revisions are opaque, not browser timestamps or chronologically sortable
identifiers. Only receipt-proven known-obsolete revisions can be rejected as
superseded. The domain remains responsible for providing current authorized reads.

## Writes And Conflicts

A custom writer receives FormSubmitContext.expectedRevision and a lifetime
AbortSignal. Send the revision to a conditional backend writer and return its
canonical accepted values/revision. The server must enforce the condition
atomically; collection updateAsync does not become compare-and-swap because a
form carries a revision.

Conflict/uncertain outcomes preserve the draft and require authoritative
reconciliation. Do not replay a possibly accepted operation because UI follow-up
failed. Newer edits made during a save remain dirty after its older receipt.

## Related Guides And Next Steps

- [Save and leave](./save-and-leave.md) owns acknowledgments and departure.
- [Managed form dialogs](../modals/forms.md) binds editors to the shared shell.
- [Acknowledged mutations](../sdk/acknowledged-mutations.md) owns client writers.

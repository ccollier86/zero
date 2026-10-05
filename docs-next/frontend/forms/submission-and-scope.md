---
id: zero.frontend.forms.submission-and-scope
type: architecture
audience: [developer, agent]
owner: frontend-forms
status: draft
visibility: internal
system: frontend-forms
feature: submission-and-scope
maturity: supported
applies_to: ["2.1.1 source with audited corrections; package qualification pending"]
modes: [browser, Guardian single, Guardian multi, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Finish Forms Only After Accepted Writes

[Forms index](./index.md) · [Documentation index](../../index.md)

A local optimistic collection update is fast feedback, not server acceptance.
The normal form path awaits its authoritative writer before success callbacks;
it also fences pending UI state across identity/organization replacement.

## Submission Sequence

1. Refuse obsolete-scope or duplicate pending submission.
2. Mark fields touched and validate the logical record/allow-list.
3. Encode known values to the descriptor's wire representation.
4. Await custom onSubmit when present; otherwise await collection insertAsync
   or updateAsync, excluding the configured primary key from an edit patch.
5. Call success/error and clear pending state only for the still-current operation
   and readable scope. An old operation cannot finish a replacement form's UI.

No callback/collection means no persistence. The operation's expected behavior
must be supplied by the app; a form descriptor cannot create a server endpoint.

## Returning The Writer

```ts
// Accepted custom path: resource is an app's normal policy-aware ResourceClient.
onSubmit: async (encodedData) => {
  await resource.create(encodedData);
}
```

Do not dispatch `collection.insert()` and immediately return as if onSubmit
waited for acceptance. Prefer the ordinary built-in collection path or return
insertAsync/updateAsync. Custom callbacks own their safe error presentation;
useForm's onError receives the caught message rather than creating a toast/sink.

CrudPage and MasterDetail composed wrappers must preserve this returned promise
too. A corrected headless hook cannot repair a caller that discards the async
source operation. The audited composed paths now use the same acknowledged
source/mutation lifecycle and exact-modal closure instead of premature success.

## Scope Replacement

The hook reads the [authorization boundary](../runtime/authorization-scope-boundary.md).
Its values/errors/pending state are masked/reset at identity/tenant/data-authority
replacement. Retained old setters/blur/submit callbacks are refused. Completion
after await checks the captured boundary, so a rejected old write cannot set the
new scope's errors or clear its submission.

Changing defaultValues alone is not that boundary. Edit record selection and
server loading need deliberate component lifecycle; do not overwrite a user's
active input merely because a remote row refresh occurred.

## Cancellation And Errors

Receipt wait cancellation or scope replacement is not proof a server write did
not commit. Preserve the relevant [receipt](../sdk/acknowledged-mutations.md) or
[resource idempotency](../sdk/resources.md#uncertain-results-and-idempotency)
contract when reconciling uncertain outcomes. A post-accept notification error
must not repeat an already accepted mutation.

useForm observes/awaits the success callback separately from its writer. A thrown
or rejected success notification emits value-free standard frontend observability
with accepted-callback stage, does not call the failed-write onError and remains
scope-fenced. Notification errors cannot turn one accepted write into a second
submission or clear a newer scope's pending form.

Field validation messages differ from asynchronous server failures. Do not pass
raw private provider/database error details into a custom toast/FormMessage.
The server keeps policy, readiness, FK and logical validation independent of
hidden/allow-listed client controls.

## Verification And Upgrade

Hold a receipt, double-submit, accept/reject and switch tenant before resolution.
The old form must not invoke success/error or finish the new pending operation.
Verify that encoded nullable numeric clear reaches the server as null, not an
omitted field. Required clears and invalid nonblank formats remain rejected.

Focused hook/actual AutoForm/CrudPage/MasterDetail regressions support the corrected
source contract. Existing calls keep their options, but acceptance timing is now
honest. This is not a changed configured database durability promise or an automatic
single-to-multi-tenant migration.

## Related Guides And Next Steps

- [useForm](./use-form.md) owns the state/result interface.
- [AutoForm](./auto-form.md) composes the standard UI.
- [Schema validation](../../backend/schema/validation.md) owns server row checks.
- [Scope transitions](../runtime/scope-transitions.md) protects the surrounding subtree.

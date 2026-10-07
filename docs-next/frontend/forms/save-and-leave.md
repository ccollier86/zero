---
id: zero.frontend.forms.save-and-leave
type: reference
audience: [developer, agent]
owner: frontend-forms
status: verified
visibility: internal
system: frontend-forms
feature: acknowledged-settings-save
maturity: supported
applies_to: ["2.6.0"]
modes: [browser, SSR, standalone, Guardian-bound, modal]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "c5656b306051b04ec6adc641b7057a0672fd7a3e"
  snapshot: clean
  date: "2026-10-07"
  evidence_level: implementation-verified
---

# Acknowledged Settings Saves And Leave Guards

[Forms index](./index.md) · [useForm](./use-form.md) · [Modal manager](../modals/index.md)

The existing form system can opt into an accepted baseline and compose a compact
Save/Discard surface. Persistence remains the app's acknowledged SDK/server
operation; the controller must not report success on dispatch or reset newer
typing when an old response arrives.

## Accepted Baseline

`useForm` adds `baseline: 'accepted'`, `initialRevision` and `scopeKey` without
changing legacy initial/reset behavior. A custom `onSubmit(values, context)`
receives an abort signal and the expected revision. It may return accepted
`{ values, revision }`; omitted accepted values acknowledge the submitted
snapshot, not whatever text happens to be in the inputs later.

`submit()` resolves an explicit accepted/invalid/failed/retired/blocked outcome.
Legacy `handleSubmit()` retains its void compatibility. Validation must finish
before the custom callback runs. `validateFields(fields?)` validates a selected
subset for field-level operations.

For explicit field saves, capture `captureValues(fields)` before the awaited
operation and pass the acknowledgement to `acceptValues(acceptance, captured)`.
Only the originating mounted form/scope generation can accept it. A newer value
typed into that same field survives; the accepted snapshot becomes its baseline.
Application/server revisions are opaque string/number values, never browser
timestamps or authority proof.

## Save/Discard/Stay Composition

`useFormSave({ form, scopeKey, beforeUnload?, guardNavigation? })` accepts the
form's dirty/submitting/read/reset/submit contract. It returns pending/error
state, `save`, `discard`, `requestLeave` and `chooseLeave`. Compose it with
`FormSaveBar` and `UnsavedChangesDialog` from the React facade or
`@zero/framework/components/form-save`.

`FormSaveBar` is floating by default or inline. It reserves flow space so it
does not cover the final field, wraps at narrow widths and exposes pending/error
feedback. `saveLabel`/`discardLabel`, `className` and `style` are optional.
The shared leave dialog is Save/Discard/Stay, not a second form backend.

Saving is single-flight. Invalid/failed/conflicted work keeps the draft and does
not execute the pending navigation. Discard restores the accepted baseline.
Stay cancels the pending departure. Duplicate navigation attempts cannot replace
the first admitted destination while its decision is pending.

Typed revision-conflict codes (including `AUTH_PROFILE_REVISION_CONFLICT`) and
an untyped HTTP 409 require review before another stale write. A typed
availability error such as `DUPLICATE_USERNAME` is a normal correctable failure,
not a revision lock. Preserve the draft and let the user correct it; do not force
a reload merely because its HTTP status is also 409.

## Router, Modal And Native Browser Boundaries

When RouterProvider is present, the hook joins its optional `useNavigationGuard`
contract. Native Back/Forward is reconciled with the guarded destination.
`guardNavigation: false` disables this advisory integration. A standalone form
still uses explicit `requestLeave` composition.

Modal manager `beforeClose(context)` may return a boolean or promise and receives
an abort signal. `modals.requestClose` is the awaited close-admission API.
Existing unguarded synchronous close behavior remains compatible. Authoritative
force-close/scope retirement bypasses advisory decisions and fences old callbacks;
save prompts must never block logout or revocation.

`beforeUnload` defaults true for this opt-in hook. Native tab close/reload uses
the browser's own warning; a custom animated dialog cannot replace a browser
unload prompt or reliably save during process termination.

## Explicit Field Check/Cancel

The existing `InlineEditText` supports explicit save/cancel actions alongside
its smooth display/edit presentation. Pending actions are awaited and locked;
disabled editing, IME interaction and scope retirement are explicit. Its public
configuration controls the behavior; it is not an automatic backend writer.
The packaged [profile editor](../guardian/profile-settings.md) uses the same
accepted-draft/revision model for configured field Check/Cancel or page saves.

Network cancellation is advisory and a timeout may occur after acceptance.
Retain the draft, report the safe error and reload/review the stored result.
Do not assume an aborted browser promise proves the server rolled back.

- [Submission and scope](./submission-and-scope.md) explains ordinary collection writes.
- [Navigation](../router/index.md) owns the application router.
- [Guardian profiles](../../backend/guardian/user-profiles.md) own live authority/CAS.

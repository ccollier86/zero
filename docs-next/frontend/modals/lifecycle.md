---
id: zero.frontend.modals.lifecycle
type: reference
audience: [developer, agent]
owner: modals
status: draft
visibility: internal
system: modals
feature: lifecycle
maturity: supported
applies_to: ["2.1.1 source with audited corrections; package qualification pending"]
modes: [browser, Guardian single, Guardian multi, single-database, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Exact Close, Clear And Notification Lifecycle

[Modals index](./index.md) · [Documentation index](../../index.md)

modals.close(id) marks one live instance closing and triggers exit removal.
closeLast chooses the newest instance not already closing. closeAll immediately
clears the current stack; it does not wait for all exit animations.
update(id,Partial<OpenModalOptions>) changes supported open-instance properties.

A missing/already-closing ID is ignored. Closing a confirm settles it false unless
its true result already settled. A closing dialog cannot reopen when a newer
dialog is added before its animation completes.

## Close Callback Isolation

Dismissal/clear state commits before invoking caller onClose. A callback cannot
recursively re-enter its own close, prevent dismissal by throwing, call an already
closing notification twice via closeAll, or strand another confirmation.
Async returned notifications are observed safely despite the existing void
callback signature. These are focused corrected development-source semantics.

closeAll captures the current stack, clears it, then notifies the instances that
were not already closing. A new modal deliberately opened by one of those callbacks
is a new workflow and remains open; it is not accidentally swept into the old clear.
discardAll differs: no app callbacks run at all.

Caught callback failures emit stable frontend.modal_callback.failed with safe
{ surface:'modal-manager', stage:'close-callback' } metadata.
No raw error, modal title/ID/content or rejected callback payload is emitted.
This observation cannot roll back external side effects initiated by a callback.

Use exact IDs around asynchronous editors rather than closing whichever modal
happens to be newest. Confirmation/close notifications remain UI-only; server
authority and accepted writes are separate.

## Verification

Test callback throw/rejection/recursive close, multiple pending confirmations,
already-closing instances, new content opened by notification, animation removal
and scope discard. Store-level focused tests establish ownership/callback behavior;
they are not full production dialog/accessibility/artifact qualification.

## Related Guides And Next Steps

- [Content](./content.md) owns open/update inputs.
- [Confirmation](./confirm.md) owns user-intent promises.
- [Scope transitions](./scope-transitions.md) owns callback-free discard.
- [Host](./modal-manager.md) owns rendering/animation.

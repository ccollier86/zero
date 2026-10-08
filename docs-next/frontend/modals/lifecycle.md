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

# Ownership, Settlement And Visual Cleanup

[Modals index](./index.md) · [Documentation index](../../index.md)

The unreleased kernel separates logical result settlement from visual exit cleanup.
An exact instance owns its callbacks, pending action and parent/child graph;
a later unrelated modal cannot be closed by an old “close last” continuation.

## Outcomes And Admission

`show` snapshots a validated descriptor and returns one handle/result waiter.
Accepted work settles `{kind:"accepted",value}`; admitted dismissal settles
`{kind:"dismissed",reason}`; owner/scope retirement settles `{kind:"retired"}`.
The waiter settles once even when multiple close/update/exit events arrive.

Dismissal reasons are escape, backdrop, close-button, cancel, programmatic,
parent-closed or host-unmount. A pending/required dialog refuses ordinary
dismissal. A dirty dialog uses the supplied/bound close guards or the default
discard decision. `requestClose(id,{reason?,force?})` returns Promise<boolean>;
force is for deliberate authoritative retirement, not an app shortcut around
the user's unsaved draft.

`handle.close(value)` / context.accept(value) express acceptance, not advisory
dismissal. They require current ownership. Aborted or superseded contexts cannot
accept, mutate presentation or open children.

## Nested Ownership And Updates

Use context.show for owned child dialogs. Parent acceptance/dismissal retires
descendants with parent-closed outcomes; each waiter settles. Layer position alone
does not create ownership for unrelated dialogs.

`handle.update` validates the merged descriptor, keeps its ID/result waiter, and
retires the old callback generation/pending decisions. Its parent cannot change.
Old action callbacks cannot close or overwrite the replacement generation.
Updating a descriptor cannot roll back backend work that already began.

React-controlled feature state should use ControlledModal's per-opening bridge
instead of calling handle.update on every keystroke. Structural/target changes
need a new identityKey/opening; see [migration](./migration.md).

## Close, Clear And Retirement

`modals.close(id)` delegates to admission and retains the legacy void signature.
`closeLast` chooses only the latest active, non-exiting instance; reserve it for
synchronous generic UI, not awaited domain continuations.
`closeAll` respects relevant dirty/required/pending guards unless forced; the
unguarded compatibility clear captures existing instances and notifies them.

`discardAll` is different: immediate authoritative retirement, no app onClose
callbacks, pending old results settled safely. Host teardown retires captured
instance IDs, not dialogs opened by a newer host. Neither operation proves
remote work was cancelled or undone.

Owning sibling-host teardown retires its captured openings before a successor
host claims rendering. It does not transfer/remount a live form or repeat an
admitted writer under another React tree. Prefer a persistent application host.

## Callback And Error Isolation

onClose is a post-commit notification, never a save receipt or veto. Notification
throw/rejection is isolated and recorded with the standard content-free
frontend.modal_callback.failed surface/stage metadata. Callback payloads, titles,
IDs and raw exceptions are not logged through this path.

Synchronous action admission prevents duplicate callbacks before a pending React
paint. Normal action failure keeps the draft/dialog open and does not replay the
writer automatically. Success notifications must not convert accepted work into
a second failed/retry mutation.

## Exit Reservations And Focus

A closing modal stays reserved until its exact generation's exit completes.
Its callback cannot remove another/newer layer. Lower active dialogs retain
inert ownership; one shared backdrop and registered page surface coordinate
presentation. Page restoration may outlast shell exit, so scene/scroll/focus
handoff waits for the complete relevant cleanup.

Owned popup Escape and parent dialog Escape must not fire together. Focus returns
only to a connected current owner, not an obsolete account/organization opener.
Reduced-motion changes/unmount/retirement settle presentation without waiting for
a callback that might never arrive.

## Related Guides And Next Steps

[Host](./modal-manager.md) covers portals and layers; [scope](./scope-transitions.md)
covers authoritative invalidation; [forms](./forms.md) covers cancellable leave
decisions; [motion](./motion.md) owns exact exit timing.

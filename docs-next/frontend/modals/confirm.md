---
id: zero.frontend.modals.confirm
type: reference
audience: [developer, agent]
owner: modals
status: draft
visibility: internal
system: modals
feature: confirm
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

# Decision-Only And Action-Backed Confirmation

[Modals index](./index.md) · [Documentation index](../../index.md)

Confirmation records intent, not permission or a mutation receipt. The unreleased
upgrade offers decision helpers and an action-backed helper on the same managed
shell. Choose the one matching who owns the actual acknowledged operation.

## Decision-Only Boolean

~~~ts
import { modals } from "@zero/framework/react";

async function archiveTask(archiveAccepted: () => Promise<void>) {
  const approved = await modals.confirm({
    title: "Archive this task?",
    description: "You can restore it later.",
    confirmLabel: "Archive",
  });
  if (approved) await archiveAccepted();
}
~~~

This browser event function assumes a mounted host. `confirm(OpenConfirmOptions)`
returns Promise<boolean>: true only on accepted confirmation, false on cancel,
dismissal or retirement. The actual archive writer runs **after** that decision;
its errors are not automatically owned by a confirmation that already closed.

Legacy confirm options are title(required), description, confirmLabel/cancelLabel,
variant(default/destructive), holdToConfirm/holdDuration plus size/customSize/from/
className. The unreleased additions include motion, trigger, icon and tone.
The new shell preserves the boolean contract; sm is the default size.
Legacy from is not a Motion Lab preset selector.

## Action-Backed Confirmation

~~~ts
import { modals } from "@zero/framework/react";

export async function deleteProject(
  trigger: Element,
  deleteAccepted: () => Promise<{ deleted: true }>,
) {
  const handle = modals.actionConfirm({
    title: "Delete project?",
    description: "This permanently deletes the project and its tasks.",
    tone: "danger",
    confirmLabel: "Delete project",
    holdToConfirm: true,
    trigger,
    onConfirm: async () => await deleteAccepted(),
  });
  return await handle.result;
}
~~~

The writer is supplied by the owning domain and must enforce live authority,
conditional writes/idempotency as needed and accepted acknowledgment.
`actionConfirm<T>` returns ModalHandle<T>, not Promise<boolean>. It locks pending
UI, retains the dialog on failure, and accepts the callback's resolved value.
A false callback result keeps it open. Errors are safe generic presentation;
unknown outcome reconciliation remains domain-owned.

ModalActionConfirmOptions uses ModalDecisionOptions(title/description/icon/tone,
confirm/cancel labels, hold configuration, motion, trigger) plus onConfirm.
Danger decisions start focus on Cancel so Enter cannot accidentally delete.
Use a supplied icon/tone rather than copying another header.

## Alert And Required Steps

`await modals.alert({title,description,tone?,...})` returns Promise<void> and shows
one acknowledgment action on the common shell. Its default tone is the helper's
ordinary descriptor default unless explicitly configured; choose info/success/danger
to convey meaning. Acknowledgment does not perform an operation.

Use `show({dismissible:false,...})` for a required step with a real accepted action.
No X, Escape or outside-click path should evade it; an authoritative logout/scope
retirement still removes it. This UI option is not a permission fence.
There is no assumption that a prompt or required acknowledgment persisted data.
Denied required-step Escape or backdrop dismissal gives a small additive nudge
without interrupting entrance motion; reduced motion suppresses it. Its base
260ms is 390ms at the default duration multiplier.

[Prompt](./prompt.md) supplies the standard single-field variant with explicit
sync/async validation and a string-or-null result.

## Deliberate Holds And Generic Hook

Structured action holds default to1500ms real elapsed time, unaffected by
durationMultiplier or reduced motion. HoldButton can also be used independently;
see [hold interaction](./hold-button.md). Completing its fill is intent, not proof
that deletion succeeded.

ConfirmProvider/useConfirm retains its single-slot contract but now adapts the
common manager. A replacement/unmount settles the earlier request false and
suppresses stale results; it is not a confirmation queue. A fallback host is mounted
only outside an existing host. See [confirmation hook](../hooks/confirmation.md).

ConfirmModalContent remains a compatibility export for older advanced composition;
ordinary feature code should not create private resolvers or instantiate a second
frame around it.

## Related Guides And Next Steps

[Content/results](./content.md) owns acceptance; [lifecycle](./lifecycle.md) owns
settlement; [forms](./forms.md) owns save decisions; [Guardian authority](../../backend/guardian/authorization.md)
must still authorize each server operation.

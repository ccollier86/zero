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

# Await Intent Before An Action

[Modals index](./index.md) · [Documentation index](../../index.md)

```ts
import { modals } from '@zero/framework/react';

const approved = await modals.confirm({
  title: 'Archive this task?',
  description: 'You can restore it later.',
  confirmLabel: 'Archive',
});
if (approved) await archiveTask();
```

This browser event fragment assumes a mounted host and an app-owned accepted
archiveTask writer. confirm(OpenConfirmOptions) returns Promise<boolean>:
true on confirmation, false on cancel/dismiss/programmatic clear. The Promise
is user intent, not the archive writer's receipt.

Required title plus optional description/confirmLabel/cancelLabel/variant/
holdToConfirm/holdDuration configure content. size defaults sm; customSize/from/
className customize the host. Standard labels are Confirm/Cancel. Hold mode honors
confirmLabel or "Hold to Confirm", with "Confirming..." progress—not a claim that
every action is deletion. Hold duration defaults1500ms and requires a finite
positive value.

ConfirmModalContent is public on /modals for advanced host composition; it takes
a ModalInstance with confirmOptions and onResult(boolean).
Its props type is not a named public barrel export. Do not supply/mutate a private
resolver or bypass normal host lifecycle.

A confirmation should not be reused after identity/source replacement. Managed
discard settles pending confirmations false without app close callbacks.
Backend live permission/idempotency checks remain necessary after true.
For keyed table actions use [action definitions](../data-controls/data-table/actions.md),
which compose confirmation, pending operation and refresh.

## Related Guides And Next Steps

- [HoldButton](./hold-button.md) owns deliberate sustained interaction.
- [Lifecycle](./lifecycle.md) owns clear/close settlement.
- [Scope transitions](./scope-transitions.md) owns revoked UI context.
- [Generic confirmation](../hooks/confirmation.md) is the separate one-dialog alternative.

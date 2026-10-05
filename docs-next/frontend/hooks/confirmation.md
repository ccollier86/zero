---
id: zero.frontend.hooks.confirmation
type: reference
audience: [developer, agent]
owner: modals
status: draft
visibility: internal
system: modals
feature: generic-confirmation
maturity: supported
applies_to: ["2.1.1 source with audited corrections; package qualification pending"]
modes: [browser]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# One Shared Confirmation Dialog

[Hooks index](./index.md) · [Documentation index](../../index.md)

ConfirmProvider/useConfirm is a generic single-dialog promise implementation,
separate from modals.confirm/ModalManager. Import from @zero/framework/hooks
or the browser-safe root/React barrel. The provider takes children.

```tsx
import { ConfirmProvider, useConfirm } from '@zero/framework/hooks';

function ArchiveButton() {
  const confirm = useConfirm();
  return <button onClick={async () => {
    if (await confirm({ title: 'Archive?', confirmLabel: 'Archive' })) {
      await archiveTask();
    }
  }}>Archive</button>;
}
```

This fragment assumes caller archiveTask and an enclosing ConfirmProvider.
ConfirmOptions is title(required), description/confirmLabel/cancelLabel/variant
(default|destructive). Labels default Confirm/Cancel. There are no sizing/hold
options inherited from the separate modal stack.

The function returns Promise<boolean>. A newer request cancels the older one
with false rather than strand its resolver. Provider unmount settles pending
requests false; a retained function after unmount resolves false. Acceptance
settles only the current request once. Focus returns to the still-connected
original programmatic opener; a replaced request cannot steal it.

Missing description has an accessible hidden fallback. Animated alert-dialog
content retires after close rather than retaining pointer isolation. Those are
corrected development-source contracts with focused synthetic browser regressions,
not a claim of complete screen-reader/mobile/package qualification.

Unlike the managed modal stack this generic provider does not automatically
acquire Guardian scope-discard integration. Custom apps must compose its lifetime
with their context and retain server-checked action fences. Confirmation is intent,
not role permission or a writer acknowledgment.

## Related Guides And Next Steps

- [Modal stack](../modals/index.md) is the managed imperative alternative.
- [Table actions](../data-controls/data-table/actions.md) composes intent and receipts.
- [Scope transitions](../runtime/scope-transitions.md) owns normal authority fencing.

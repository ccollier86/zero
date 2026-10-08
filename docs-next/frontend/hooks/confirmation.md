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
applies_to: ["2.6.0 source; structured-modal upgrade unreleased"]
modes: [browser, standalone, Guardian, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "1b5a1fa0281deba69b3809471d2467d596516e4b"
  snapshot: dirty
  date: "2026-10-08"
  evidence_level: source-observed
---

# One Shared Confirmation Dialog

[Hooks index](./index.md) · [Documentation index](../../index.md)

ConfirmProvider/useConfirm is a single-slot promise adapter to the same managed
modal shell, not a second dialog renderer or stack. It inherits the surrounding
ModalManager; standalone composition supplies a fallback host. The provider still
takes children. This integration is unreleased working source.

Import from @zero/framework/hooks or the root/React facade. Complete component;
the caller's archive function owns authorization, acknowledgment and failure UI.

~~~tsx
import * as React from 'react';
import { Button, ConfirmProvider, useConfirm } from '@zero/framework/react';

function ArchiveButton({ archive }: { archive: () => Promise<void> }) {
  const confirm = useConfirm();
  const [error, setError] = React.useState<string | null>(null);
  return <><Button onClick={async () => {
    setError(null);
    try {
      if (await confirm({ title: 'Archive?', confirmLabel: 'Archive' })) await archive();
    } catch { setError('Archiving could not be completed. Check the current state before retrying.'); }
  }}>Archive</Button>{error ? <p role="alert">{error}</p> : null}</>;
}

export function ArchiveControl({ archive }: { archive: () => Promise<void> }) {
  return <ConfirmProvider><ArchiveButton archive={archive} /></ConfirmProvider>;
}
~~~

## Options And Settlement

ConfirmOptions has required title and optional description, confirmLabel,
cancelLabel, variant(default|destructive), holdToConfirm and holdDuration.
Labels default Confirm/Cancel. A destructive decision starts focus on Cancel;
a deliberate hold uses the shared HoldButton safety interval, not modal pace.
Use the [structured facade](../modals/confirm.md) when you need tone, icon,
motion, explicit trigger, sizing/layout or an action-backed acknowledged write.

The returned Promise<boolean> represents intent. The hook does not perform
archive/delete itself. The provider holds one request, not a queue:

- A newer request retires the old request and resolves its promise false.
- Provider unmount resolves pending requests false.
- A retained confirmation function called after unmount resolves false.
- Acceptance settles only the current request once.

The compatibility adapter retains the original initiating focus target across
supersession, rather than restoring a replaced dialog's Cancel button.
Its managed lifetime participates in the host's scope retirement; backend
authority and app-owned writers remain decisive. Missing description uses safe
fallback decision text.

If the writer must finish before the dialog closes, use
`modals.actionConfirm` rather than performing it after a boolean answer.
Failures/unknown outcomes then stay under the action-backed owner's lifecycle
without treating the intent result as a receipt.

## Related Guides And Next Steps

- [Modal confirmations](../modals/confirm.md) owns decisions, holds and awaited actions.
- [Migration](../modals/migration.md) replaces independent dialog frames.
- [Scope transitions](../runtime/scope-transitions.md) owns authority fencing.

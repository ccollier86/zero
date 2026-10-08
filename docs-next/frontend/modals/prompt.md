---
id: zero.frontend.modals.prompt
type: reference
audience: [developer, agent]
owner: modals
status: draft
visibility: internal
system: modals
feature: prompt
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

# Validated Single-Field Prompts

[Modals index](./index.md) · [Documentation index](../../index.md)

`modals.prompt` uses the standard small modal shell with a labeled Input and
Cancel/Save actions. It resolves the trimmed accepted string, or null after
dismissal/retirement. This unreleased helper does not perform server persistence.

Complete component. The app supplies the awaited writer and must handle its
rejection without treating a prompt answer as a persistence receipt.

~~~tsx
import * as React from 'react';
import { Button, modals } from '@zero/framework/react';

export function RenameButton({ currentName, rename }: {
  currentName: string;
  rename: (name: string) => Promise<void>;
}) {
  const [error, setError] = React.useState<string | null>(null);
  return <><Button onClick={async event => {
    setError(null);
    try {
      const name = await modals.prompt({
        title: 'Rename view', label: 'View name', value: currentName,
        required: true, confirmLabel: 'Rename', trigger: event.currentTarget,
        validate: value => value.length > 80 ? 'Use 80 characters or fewer.' : null,
      });
      if (name !== null) await rename(name);
    } catch { setError('The rename could not be completed. Check its current state before retrying.'); }
  }}>Rename</Button>{error ? <p role="alert">{error}</p> : null}</>;
}
~~~

## Options And Validation

ModalPromptOptions includes decision options title, description, icon, tone,
confirmLabel, cancelLabel, motion and trigger, plus:

| Option | Behavior |
| --- | --- |
| label | Visible field label; default Name. |
| value | Initial string; default empty. |
| placeholder | Input placeholder. |
| required | Native required validation plus trimmed non-empty admission. |
| validate(value) | Sync/async safe user-facing problem string, or null before acceptance. |

The submit label defaults Save. Validation receives the trimmed draft and
keeps the dialog open on a reported problem. An aborted owner cannot publish
a late validator result. Native form submission and field constraints remain
intact. This helper deliberately has no hold-to-confirm option.

The prompt disables the generic unsaved-changes guard: Cancel or Escape may
dismiss its local draft. Use [form modals](./forms.md) for multi-field,
record-aware or Save/Discard/Stay behavior. For a backend write that must finish
before closing, use a structured descriptor with an awaited action instead of
performing the mutation after prompt resolves.

## Related Guides And Next Steps

- [Confirmations](./confirm.md) separates decisions from acknowledged writes.
- [Motion](./motion.md) covers explicit button origin and Rise fallback.

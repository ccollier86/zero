---
id: zero.frontend.components.primitives.inline-editing
type: reference
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: inline-edit-text
maturity: supported
applies_to: ["2.6.0 candidate working source; release qualification pending"]
modes: [browser, SSR]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "ae85a4b6efe11eeb74ab89b15ed02a23e982c59f"
  snapshot: dirty
  date: "2026-10-07"
  evidence_level: source-observed
---

# Geometry-Preserving Inline Text Editing

[Primitive index](./index.md) · [Frontend index](../../index.md) · [Documentation index](../../../index.md)

InlineEditText keeps display text in the row's layout and overlays a native input
while editing. It is suited to dense name/title management, distinct from
DataTable EditableCell and Data Studio's revisioned value editor.
Import from `@zero/framework/components/ui/inline-edit-text`.

`InlineEditTextProps` requires `value: string`, `revision: string | number`,
`label: string` and `onCommit(value, context): void | Promise<unknown>`.
`context` supplies the revision captured when editing began and an abort signal.
Existing callbacks that accept only the value remain compatible.

Optional props are `disabled = false`, `selected = false`,
`placeholder = 'Untitled'`, `commitMode = 'blur'`, `scopeKey`, `className`,
`onSelect`, `onReload`, `onNavigate(direction: -1 | 1)`, `normalize` and
`isConflictError`. `scopeKey` is an additional opaque record/authority identity;
it is not a backend authorization credential.

```tsx
import { InlineEditText, type InlineEditTextCommitContext } from '@zero/framework/components/ui/inline-edit-text';

export function ProjectName(props: {
  name: string; revision: number;
  save(value: string, context: InlineEditTextCommitContext): Promise<unknown>;
}) {
  return <InlineEditText value={props.name} revision={props.revision}
    label="Project name" commitMode="explicit" onCommit={props.save} />;
}
```

The save function must represent server acceptance and include the correct
concurrency precondition in its own transport. Forward `context.expectedRevision`
to the supported revision check and `context.signal` to the SDK operation;
the component does not invent a write endpoint or perform authorization.
The default normalizer trims and rejects empty text. Beginning an edit captures
the supplied revision. A changed parent revision presents conflict feedback.

## Commit Modes

In the compatible default `commitMode="blur"`, Enter saves; Tab saves and requests
navigation (Shift-Tab moves in direction -1); Escape cancels. Blur saves unless
the current command has already suppressed that blur. A rejected write restores
the supplied parent value and may await `onReload`. Reload failure cannot replace
the primary failure presentation.

`commitMode="explicit"` shows compact Check/Cancel controls. Enter or Check saves;
Escape or Cancel discards the local edit. Blur does not save, and Tab keeps its
normal focus-navigation behavior without committing. A failed save retains the
draft. A revision conflict retains the draft and replaces Check with Reload;
the next save must use the reviewed parent value/revision. Supply `onReload`
when reviewing requires a server refetch; without it, Reload adopts the current
parent props rather than fetching data itself.

Both modes ignore composing IME keystrokes and finish an unchanged normalized
value without a write. Pending locks duplicate admission. Accepted writes briefly
show saved feedback and an optimistic display value until the parent projection
catches up. Pending status remains visible under reduced motion, but does not spin.

The default conflict detector recognizes status=409 or code CONFLICT /
REVISION_CONFLICT. Supply isConflictError for a different stable application
error code. normalize and error strings are caller-controlled; do not pass raw
provider/server secrets into UI error messages. Key actions/types are exported
from this specific module for deliberate custom compositions.

Duplicate same-tick events admit one commit through an independent in-flight
guard. Unmount, scope replacement or changing `disabled` to true aborts the
component's request signal and retires late result/focus/navigation admission.
Cancellation is advisory: an already accepted server write is not rolled back.
Changing `disabled` also prevents a new queued blur/keyboard save.
Post-acceptance navigation failures are observed through safe standard events,
not reclassified as rejected edits. Mount/key the component for the actual record
identity when switching records: value/revision alone cannot identify a row.
Focused actual-input tests do not establish complete device/assistive-technology
qualification. Parent values and server policies remain the final authority.

## Related Guides And Next Steps

- [DataTable editing](../../data-controls/data-table/editing.md) provides full source writes.
- [Data Studio inline cells](../../data-studio/inline-cell.md) owns logical row revision writes.
- [Generic actions](../../hooks/state-and-actions.md) explains accepted command boundaries.
- [Settings save and leave guards](../../forms/save-and-leave.md) composes acknowledged
  form baselines, field saves and Save/Discard/Stay navigation protection.

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
applies_to: ["2.1.1 source with audited corrections; package qualification pending"]
modes: [browser, SSR]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Geometry-Preserving Inline Text Editing

[Primitive index](./index.md) · [Frontend index](../../index.md) · [Documentation index](../../../index.md)

InlineEditText keeps display text in the row's layout and overlays a native input
while editing. It is suited to dense name/title management, distinct from
DataTable EditableCell and Data Studio's revisioned value editor.
Import from `@zero/framework/components/ui/inline-edit-text`.

InlineEditTextProps requires value:string, revision:string|number, label:string
and onCommit(value):void|Promise<unknown>. Optional props: disabled=false,
selected=false, placeholder='Untitled', className, onSelect, onReload,
onNavigate(direction:-1|1), normalize and isConflictError.

```tsx
import { InlineEditText } from '@zero/framework/components/ui/inline-edit-text';

export function ProjectName(props: {
  name: string; revision: number; save(value: string): Promise<unknown>;
}) {
  return <InlineEditText value={props.name} revision={props.revision}
    label="Project name" onCommit={props.save} />;
}
```

The save function must represent server acceptance and include the correct
concurrency precondition in its own transport. This component cannot infer a
server revision parameter from a string alone. The default normalizer trims and
rejects empty text. Begin edit captures the supplied revision; a changed revision
while editing restores the latest parent value and presents conflict feedback.

Enter saves; Tab saves and requests navigation (Shift-Tab direction -1); Escape
cancels. Composing IME keystrokes are ignored. Blur saves unless the current
command already suppressed that blur. Unchanged normalized text finishes without
a write. pending disables duplicate editing; accepted save briefly displays saved
feedback and an optimistic value until the parent projection catches up.
A rejected write restores the supplied value, distinguishes conflicts and may
await onReload; reload failure cannot replace the primary failure presentation.

The default conflict detector recognizes status=409 or code CONFLICT /
REVISION_CONFLICT. Supply isConflictError for a different stable application
error code. normalize and error strings are caller-controlled; do not pass raw
provider/server secrets into UI error messages. Key actions/types are exported
from this specific module for deliberate custom compositions.

Duplicate same-tick events admit one commit through an independent in-flight
guard. Unmount retires result/focus/navigation admission, including a retained
callback; already-started server writes are not cancelled or rolled back.
Changing disabled to true prevents a new queued blur/keyboard save; it does not
cancel a write already admitted while the editor was enabled.
Post-acceptance navigation failures are observed through safe standard events,
not reclassified as rejected edits. Mount/key the component for the actual record
identity when switching records: value/revision alone cannot identify a row.
Focused actual-input tests do not establish complete device/assistive-technology
qualification. Parent values and server policies remain the final authority.

## Related Guides And Next Steps

- [DataTable editing](../../data-controls/data-table/editing.md) provides full source writes.
- [Data Studio inline cells](../../data-studio/inline-cell.md) owns logical row revision writes.
- [Generic actions](../../hooks/state-and-actions.md) explains accepted command boundaries.

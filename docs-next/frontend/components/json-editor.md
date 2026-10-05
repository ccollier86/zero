---
id: zero.frontend.components.json-editor
type: reference
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: json-editor
maturity: supported
applies_to: ["2.1.1 working source; package qualification pending"]
modes: [browser, SSR]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Structured JSON Editing

[Component index](./index.md) · [Frontend index](../index.md) · [Documentation index](../../index.md)

`JsonEditor` is Zero's token-themed adapter over the packaged `json-edit-react`
2.0.4 component. It provides structured object/array/value editing and an **Edit
as text** action for a whole JSON document. The text slot uses Zero's existing
Textarea; this is not a syntax-highlighted general code editor, a SQL console,
or a schema-to-database deployment mechanism.

Import `JsonEditor` and its `JsonEditorProps`, `JsonEditorHandle` and
`JsonEditorCommitResult` types from `@zero/framework/react`, `@zero/framework`,
or `@zero/framework/components/json-editor`.

## Controlled Document And Configuration

Required props are `value:T` and `onChange(value:T):void`. The callback must update
local document state synchronously; it is **not** a persistence callback. A
generic `T` describes the input, not a runtime promise that every intermediate
tree edit has that shape. Use the complete-document `validate` callback before
consuming the final result.

Optional props:

| Prop | Default | Responsibility |
| --- | --- | --- |
| `validate(value:unknown):T` | None | Synchronous admission/normalization at explicit commit; throw for invalid documents. |
| `disabled` | `false` | Prevent new local edits/commits; does not replace server authorization. |
| `label` | `JSON editor` | Accessible editor group name; text area uses the name plus ` text`. |
| `rootName` | `schema` | Displayed root node name. |
| `collapse` | `3` | Initial structured tree expansion depth; accepts a boolean or number. |
| `className` | None | Outer layout composition. |
| `scrollMode` | `self` | `self` owns the bounded viewport; `parent` uses an enclosing dialog/panel's scroll region. |
| `rawTextDraft` | Uncontrolled local retention | Parent-owned unfinished JSON string, or null when absent. |
| `onRawTextDraftChange` | None | Observe raw text or explicit discard/accepted local application; store separately from `value`. |
| `onEditingChange` | None | Observe open inline editing for dirty-close prompts. |
| `editorRef` | None | Zero's local-draft imperative handle, not the upstream package's handle. |

The structured tree and text slot use semantic CSS variables, existing Lucide
icons and Zero Select/Textarea controls. The bounded editor area scrolls rather
than forcing an entire application page to grow. Color/font overrides belong to
the [design system](../design-system/tokens.md), not per-app hard-coded palettes.
When embedded in an already bounded dialog, use `scrollMode="parent"`; the text
slot grows with its lines and the enclosing body owns vertical scrolling.

## Commit Is Local Admission, Not A Save

`editorRef.current.commit()` synchronously finishes the current local editor,
validates the entire document, and returns either `{ ok:true, value:T }` or
`{ ok:false, error:string }`. Parsing or validation failure retains the editable
draft. A pending key-rename interaction must be finished/cancelled with its own
controls if the underlying editor cannot confirm it through the value handle.
`startTextEdit()` opens root JSON text editing; `cancel()` explicitly discards an
open edit and its retained raw text.

```tsx
import * as React from 'react';
import { JsonEditor, type JsonEditorHandle } from '@zero/framework/react';
import { Button } from '@zero/framework/components/ui/button';

export function SettingsDocument() {
  const [document, setDocument] = React.useState<unknown>({ enabled: true });
  const [raw, setRaw] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const editor = React.useRef<JsonEditorHandle<unknown>>(null);

  function checkDraft() {
    const result = editor.current?.commit();
    setNotice(result?.ok ? 'Local draft is ready; no server write has occurred.'
      : result?.error ?? 'The editor is unavailable.');
  }

  return <>
    <JsonEditor value={document} onChange={setDocument} editorRef={editor}
      rawTextDraft={raw} onRawTextDraftChange={setRaw}
      label="Settings JSON" rootName="settings" />
    {notice && <p role="status">{notice}</p>}
    <Button onClick={checkDraft}>Validate draft</Button>
  </>;
}
```

This fragment performs local draft admission only. To save, await the domain
writer with the admitted result, and report saved only after it accepts. Its caller owns actual write
authorization, duplicate admission, expected revisions, operation identity,
scope/lifetime guards and accepted-save presentation. Prefer a domain controller
for a production write, not an arbitrary async callback without those contracts.

## Retaining Unfinished Work

Keep `rawTextDraft` in a parent that survives editor tab changes/remounts. Valid
object state cannot represent incomplete strings such as `{"name":`; replacing
the text from `JSON.stringify(value)` would lose that draft. Zero restores a
retained buffer when the text slot reopens. Invalid syntax and invalid schema
text remain unchanged when commit fails. Explicit Cancel discards the active
text; an explicit parent discard should clear its retained state too.

Mount/key the editor for a document/organization identity. Parent state must not
carry one organization's raw text into another. Unmount retires the imperative
handle's admission; it does not save, roll back, or cancel an external write.
Callbacks use the standard `frontend.json_editor.callback_failed` observation
with static stage metadata, never raw JSON/default values or callback errors.

## Related Guides And Next Steps

- [Data Studio dialogs](../data-studio/dialogs.md) binds actual schema validators,
  Visual/JSON mode handoff and revisioned table writes.
- [Data Studio values](../data-studio/values.md) explains stable IDs and defaults.
- [CodeBlock](./public-pages/code-block.md) displays highlighted code without editing.
- [Component configuration](./configuration.md) routes reusable UI configuration.
- [Component roadmap](./roadmap.md) tracks the separate future code-editor work.

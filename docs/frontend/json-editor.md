# JSON Editor

[Frontend index](./README.md) · [Data Studio schema editing](../data-studio.md#visual-and-json-schema-editing) · [Design tokens](./design-tokens.md)

`JsonEditor` is Zero's reusable, token-themed wrapper over `json-edit-react`
2.0.4. It supports structured object/array/value editing and **Edit as text** for
the whole JSON document. Its text/select slots use Zero's existing controls.
This is a JSON editor, not a syntax-highlighted general-purpose code editor or
an automatic database/schema deployment mechanism.

## Import And Local Draft

```tsx
'use client';

import * as React from 'react';
import {
  JsonEditor,
  type JsonEditorHandle,
} from '@zero/framework/components/json-editor';
import { Button } from '@zero/framework/components/ui/button';

export function SettingsDraft() {
  const [document, setDocument] = React.useState<unknown>({ enabled: true });
  const [raw, setRaw] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const editor = React.useRef<JsonEditorHandle<unknown>>(null);

  function checkDraft() {
    const result = editor.current?.commit();
    setNotice(result?.ok
      ? 'The local draft is valid. No server write has occurred.'
      : result?.error ?? 'The editor is unavailable.');
  }

  return (
    <>
      <JsonEditor
        value={document}
        onChange={setDocument}
        editorRef={editor}
        rawTextDraft={raw}
        onRawTextDraftChange={setRaw}
        rootName="settings"
        label="Settings JSON"
      />
      {notice && <p role="status">{notice}</p>}
      <Button type="button" onClick={checkDraft}>Validate draft</Button>
    </>
  );
}
```

The component and its `JsonEditorProps`, `JsonEditorHandle` and
`JsonEditorCommitResult` types are also exported from `@zero/framework/react`
and `@zero/framework`. `value` is controlled; `onChange` must update local
document state synchronously. It is not a persistence callback. A generic type
does not ensure every intermediate tree edit already satisfies a domain schema;
use `unknown` or a suitable draft type and validate the complete result.

## Configuration

| Prop | Default | Contract |
| --- | --- | --- |
| `value`, `onChange` | Required | Controlled local document and synchronous draft update. |
| `validate(value: unknown): T` | None | Synchronous complete-document validation/normalization at explicit commit; throw to reject. |
| `disabled` | `false` | Prevent local edits and commit. Not server authorization. |
| `label` | `JSON editor` | Accessible group name; text input appends ` text`. |
| `rootName` | `schema` | Structured tree root label. |
| `collapse` | `3` | Initial tree expansion depth; boolean or number. |
| `className` | None | Outer composition styling. |
| `scrollMode` | `self` | `self` owns a bounded 28rem viewport; `parent` lets the enclosing dialog/panel own vertical scrolling. |
| `rawTextDraft`, `onRawTextDraftChange` | Local retention | Optional parent-owned incomplete JSON string, separate from the object; null means no retained text. |
| `onEditingChange` | None | Observe an open edit, for example when deciding whether closing a dialog needs confirmation. |
| `editorRef` | None | Zero's local-draft handle, not the upstream library handle. |

Use `scrollMode="parent"` inside a bounded modal body so there is one vertical
scroll owner. The text slot grows with its lines; the dialog heading/actions
remain outside the scrolling body. Colors and controls use Zero's light/dark
design tokens rather than app-specific hard-coded themes.

## Validation, Persistence And Lifecycle

`editorRef.current.commit()` finishes an open local value edit where possible,
validates the complete document and returns `{ ok: true, value }` or
`{ ok: false, error }`. Invalid JSON or rejected schema retains the editable
draft. If the upstream editor cannot finish a key-rename interaction through
its value handle, finish/cancel that interaction before retrying commit.

`startTextEdit()` opens root text editing. `cancel()` deliberately discards the
open edit, including retained raw text. Keep parent-owned text in a state owner
that survives tab changes or remounts: incomplete text such as `{"name":`
cannot be represented by the last valid object. Do not replace it with
`JSON.stringify(value)` on a failed admission.

Commit is **not a save or a server acknowledgment**. After local admission,
the enclosing domain controller still owns authentication, authorization,
operation IDs, expected revisions, duplicate admission, pending presentation,
scope fencing and the awaited accepted write. Data Studio already supplies
that complete persistence flow around this component.

Reset/key the editor and its parent drafts for the selected document and
organization. A draft must not survive an authorization boundary into another
organization's editor. An unmounted or disabled editor rejects retained-handle
commit attempts. Callback failures report through Zero's frontend observability
boundary with `FRONTEND_JSON_EDITOR_CALLBACK_FAILED` and static stage metadata,
without including document values.

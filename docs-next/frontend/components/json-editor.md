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
applies_to: ["2.6.0 working source; additive JSON/YAML/TOML/env Tree/Code editor; original JsonEditor retained"]
modes: [browser, SSR]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "335b27372b0b8ef57a1e92cf93cec378923fe50b"
  snapshot: dirty
  date: "2026-10-11"
  evidence_level: source-observed
---

# Structured Document Editing

[Component index](./index.md) · [Frontend index](../index.md) · [Documentation index](../../index.md)

`JsonEditor` is Zero's token-themed adapter over the packaged `json-edit-react`
2.0.4 component. It provides structured object/array/value editing and an **Edit
as text** action for a whole JSON document. The text slot uses Zero's existing
Textarea; this is not a syntax-highlighted general code editor, a SQL console,
or a schema-to-database deployment mechanism.

Import `JsonEditor` and its `JsonEditorProps`, `JsonEditorHandle` and
`JsonEditorCommitResult` types from `@zero/framework/react`, `@zero/framework`,
or `@zero/framework/components/json-editor`.

For the new compact, handwritten Tree/Code interaction, use
[`JsonDocumentEditor`](#json-document-editor). It provides in-place value/key
editing, local history, source diagnostics, magnetic row paint, change markers
and optional accepted-save feedback. This is an additive API, not a silent
replacement of `JsonEditor` or Data Studio's current editor. Both remain available.

For file-first JSON, YAML, TOML or literal `.env` editing, use
[`DocumentEditor`](#multi-format-source-files). It assembles the same Tree/Code
organism and adds source-preserving format adapters, not four separate editors.

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
| `density` | `default` | `compact` gives the text editor a shorter initial surface for anchored single-value panels; it does not narrow validation or change document behavior. |
| `rawTextDraft` | Uncontrolled local retention | Parent-owned unfinished JSON string, or null when absent. |
| `onRawTextDraftChange` | None | Observe raw text or explicit discard/accepted local application; store separately from `value`. |
| `onEditingChange` | None | Observe open inline editing for dirty-close prompts. |
| `editorRef` | None | Zero's local-draft imperative handle, not the upstream package's handle. |

The structured tree and text slot use semantic CSS variables, existing Lucide
icons and Zero Select/Textarea controls. The bounded editor area scrolls rather
than forcing an entire application page to grow. Color/font overrides belong to
the [design system](../design-system/tokens.md), not per-app hard-coded palettes.
When embedded in an already bounded dialog, use `scrollMode="parent"`; the text
slot grows with its lines and the enclosing body owns vertical scrolling. Use
`density="compact"` for a focused [Studio JSON cell](../data-studio/inline-cell.md);
full schema/dialog editors retain their default text surface.

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

## JSON Document Editor

Import `JsonDocumentEditor`, `parseJsonDocument` and `diffJsonDocument` from the
same three public entries above. The focused entry also owns the props/handle,
`JsonDocumentValue`, `JsonDocumentPath`, `JsonDocumentMode`, `JsonDocumentPatch`,
`JsonDocumentEdit`, `JsonDocumentSaveContext` and `JsonDocumentParseResult` types.
Private row parts, session, source tokenizer and motion/scroll adapters are not
independent public components.

`JsonDocumentValue` accepts finite, acyclic, dense plain JSON, including scalar
roots and legal empty/prototype-named object keys. It does not accept functions,
Dates, sparse arrays, accessors, undefined, BigInt or nonfinite numbers. Values
and writer snapshots are detached; edits never mutate the caller's object.
Source parsing additionally rejects duplicate object keys rather than silently
keeping the last value. User strings render as text, never executable HTML.

### Document Configuration

| Prop | Default | Responsibility |
| --- | --- | --- |
| `value`, `onChange` | Required | Retain local JSON synchronously. Local changes are not persistence acknowledgment. |
| `documentKey` | `json-document` | Retire the editor session, history and pending feedback when document/tenant identity changes. Reset the caller's draft/raw state for that identity too. |
| `label`, `rootName` | `Document`, `root` | Accessible group/source names and displayed path root. |
| `format`, `sourceText` | `json`, generated from `value` | Source representation and supplied text, never a filesystem path. If both source and value are supplied, their projections must agree. |
| `onSourceChange` | None | Observe valid local source, including comments/spacing and conversions. Not persistence acknowledgment. |
| `defaultMode` | `tree` | Initial Tree/Code view; retained raw text or JSON requiring exact source-number precision opens Code. |
| `defaultExpandDepth` | `1` | Initially expand the root. Integer 0–64; zero folds it. |
| `pageSize` | `50` | Per-branch paging, integer 1–500. Search/selection reveal the needed page. |
| `maxHeight` | `420` | Bounded native viewport height, 80–10000px; header/footer stay outside it. |
| `scrollMode`, `scrollTreatment` | `self`, `arc` | Use one decorated native viewport, or let an existing parent own scrolling. `native` retains normal scrollbar comparison. |
| `density` | `default` | 30px tree rows; `compact` uses 26px rows without changing document validation. |
| `disabled` | `false` | Prevent mutations, commits and saves. Browsing/copying remain available. Server authorization remains app-owned. |
| `validate` | None | Synchronous whole-document validation/normalization at explicit commit and before saving. Throw to retain the draft. |
| `validateEdit` | None | Preflight replacements, renames, additions, removals and Code edits against the whole previous/next document. Return a problem to reject the edit. |
| `onSave` | None | An app-owned writer promise that resolves only after accepting the exact supplied snapshot. Without it, no Save action is rendered. |
| `rawTextDraft`, `onRawTextDraftChange`, `onEditingChange` | Optional | Retain unfinished text separately and observe unfinished editing for a managed dirty-close guard. |
| `editorRef`, `className`, `style` | Optional | Local admission/control and outer layout/token composition. |

Theme materials and typography inherit the existing Zero boundary. The component
does not activate a global theme, download Geist, change the AppShell or introduce
a second Select/Tooltip/scroll engine. The reference's 18px card, 30px row, 16px
indent, 13px technical text and compact path/status bars remain scoped geometry.
Narrow containers use a 12px indent. Magnetic paint and tab travel consume
shared picker timings; branch/row motion consumes standard/fast timings. Live
reduced motion settles those tracks without discarding state.

### Tree Editing and Source Drafts

Enter or click a scalar to edit it; a boolean click/Space toggles it. Double-click
an object key or press F2 to rename it. Strings use a multiline textarea so real
line breaks are not lost. The shared Morph Select changes JSON type. Choosing
object/array creates an empty container; it does not parse the existing scalar
as one. The format adapter rejects unsupported types instead of coercing them.
Add, rename and its initial value form one undoable transaction; Escape
cancels an unfinished new entry. Handled Escape in an inline input, search or Code
field is reserved before the modal manager's capture listener, so cancelling an
edit does not dismiss the enclosing dialog. Escape elsewhere still follows the
manager's normal dismissal/dirty-guard policy. Removal has local Undo, not a server rollback.

Arrow keys navigate visible rows and branches; Home/End select the first/last
visible row. Enter/Space opens a branch or a Show more row. Tab/Shift+Tab after an
inline commit moves between editable scalars. Delete/Backspace removes a nonroot
entry; Shift+Enter adds. `/` focuses search. Search cycles matches with Enter and
Shift+Enter, preserving collapsed/paged context. Copy actions expose exact values
and safe displayed paths; Ctrl/Command+C on a row copies its value, with Shift
copying the path. Ctrl/Command+Z/Y control tree history.

Code retains every unfinished buffer. Invalid syntax or edit-preflight failure freezes tree mutations at
the last valid document and shows one-based line/column diagnostics. Switching
views does not erase the buffer. Format is available only for syntactically valid
source. Tab indents/outdents a selection, soft tabs and paired brackets/quotes
help typing, and Escape followed by Tab leaves
the source field. Whole-document validation is separate from syntax status:
"Valid JSON" does not mean the application schema or server accepted it.

Do not read `value` as a finished document while an inline/source edit is open.
Use `editorRef.current.commit()`: it finishes editing, validates the complete
document and returns `JsonEditorCommitResult<JsonDocumentValue>`. It does not
advance the saved baseline. A fresh key must proceed through its value step
before an explicit commit can succeed. Failed parsing, validation or a local
callback retains the editable draft.

### Accepted Saves and Reactive Replacements

```tsx
import * as React from 'react';
import {
  JsonDocumentEditor, type JsonDocumentValue, type JsonDocumentPatch,
} from '@zero/framework/components/json-editor';

interface AcceptedWriter {
  (request: {
    documentId: string;
    expectedRevision: number;
    operationId: string;
    document: JsonDocumentValue;
    patch: readonly JsonDocumentPatch[];
    signal: AbortSignal;
  }): Promise<{ accepted: true; revision: number }>;
}

// Mount this owner with key={documentId}; its writer is supplied by the domain
// controller, which owns authorization, expected revisions and idempotency.
export function EditableSettings({ documentId, initial, initialRevision, write }:
  { documentId: string; initial: JsonDocumentValue; initialRevision: number; write: AcceptedWriter }) {
  const [document, setDocument] = React.useState(initial);
  const [raw, setRaw] = React.useState<string | null>(null);
  const revision = React.useRef(initialRevision);
  return <JsonDocumentEditor documentKey={documentId} label="Settings JSON"
    rootName="settings" value={document} onChange={setDocument}
    rawTextDraft={raw} onRawTextDraftChange={setRaw}
    onSave={async (snapshot, patch, { signal }) => {
      const receipt = await write({ documentId, expectedRevision: revision.current,
        operationId: crypto.randomUUID(), document: snapshot, patch, signal });
      if (receipt.accepted !== true) throw new Error('The document was not accepted.');
      if (!signal.aborted) revision.current = receipt.revision;
    }} />;
}
```

The writer receives the snapshot, an RFC 6902 patch relative to the last accepted
baseline, and `{ signal, format, text }`. The patch represents data differences;
file writers must use the exact `text` and `format`, not reconstruct the file
from the projection. A comment-only change can have an empty patch. Resolve only after domain acceptance; a fulfilled
`fetch` promise by itself is not acceptance. Expected revision, authorization,
retry identity, normalized server values and transport remain the controller's
responsibility. `diffJsonDocument` escapes JSON pointers and emits detached
add/remove/replace/move operations; it neither applies a server patch nor detects
concurrent server changes.

Only the accepted snapshot advances the baseline. Editing while a save is pending
is allowed; newer edits remain dirty after that snapshot succeeds. Rejection
retains edits and shows failure. Disable, unmount, identity change or an actual
external replacement aborts pending UI feedback. Aborting does not prove that a
remote operation was rolled back.

Prop echoes of local edits preserve history/drafts. A different reactive document
arriving while the editor is dirty preserves that draft and blocks commit/save
until explicit Discard adopts the incoming version. It does not silently merge,
overwrite or claim conflict resolution. Clean external replacements establish a
new baseline. Retain raw drafts under the correct document identity in the parent.

### Local Control and Limits

The handle provides `commit`, `cancel`, `startTextEdit`, `setMode`, `setFormat`, `undo`, `redo`,
`expandAll`, `collapseAll`, `search`, `select`, `save`, `discard` and a detached
read-only `patch`, `format`, `text`, `dirty` and `valid` snapshots.
`setFormat(format):boolean` returns false when the source is unfinished or the
conversion would change a value/native type. `save():Promise<boolean>` reports accepted feedback
only for the still-live session; false includes absence of a writer, no changes,
invalid/unfinished drafts, rejection and retired feedback. `cancel` abandons the
active inline/raw edit; `discard` restores the accepted/incoming baseline.

Admission is bounded to 64 levels, 50000 value nodes and 1000000 source/string-key
characters. History retains at most 100 steps and approximately 4 million
serialized characters; large documents keep fewer steps. The tree renders at
most 5000 visible rows, with branch paging. Syntax decoration is capped at 5001
tokens while the source text remains complete. This is a focused document editor,
not an unrestricted code IDE, schema service or database writer.
Source-preserving YAML tree rewrites are additionally bounded to 1000 semantic
operations; a larger normalization is explicitly routed to Code, not an
unbounded series of mapping scans.

`zero add components/json-editor --target ./src --dry-run` previews both editors
and their helper/CSS closure. Existing customized copies are skipped by default.
Use the original `JsonEditor` until a consumer deliberately adopts the new props
and lifecycle. No old file or theme retirement is implied by source copying.

## Multi-Format Source Files

Import `DocumentEditor` and `parseDocumentSource`, with `DocumentEditorProps`,
`DocumentEditorHandle`, `DocumentFormat`, `DocumentSourceChange` and
`DocumentParseResult`, from the same root, React or focused editor entry. The
`components/json-editor` route remains stable; this addition is not another
organization pass. `DocumentEditor` accepts the configuration above, but `value`
and `onChange` are optional when supplying `sourceText`. Its default identity is
`source-document`; use a real document/tenant identity in production.

| Format | Source contract | Tree behavior and preservation |
| --- | --- | --- |
| JSON | Strict JSON, including scalar roots. | Ordinary JSON tree editing; duplicate keys and nonfinite values rejected. |
| YAML | One YAML 1.2 document with string mapping keys and bounded JSON-compatible values. | Comments, scalar styles, block text and unrelated anchors remain in the parsed document. Aliases are not silently detached; edits changing a shared anchor or alias require Code. Unknown tags, complex/nonstring keys, cyclic/excessive aliases and nonfinite values are rejected. |
| TOML | TOML 1.0 object root; no null values. | Source-range edits preserve untouched tables, arrays of tables, comments and native values. Simple values, field renames/removals/additions are editable in Tree. Ambiguous table/dotted-key or comment-bearing structural changes require Code rather than a lossy whole-file rewrite. |
| `.env` | Flat string dictionary; letters/underscore start keys, with letters, digits, underscores, dots and hyphens afterward. | Exact untouched lines, `export` prefixes, comments, quotes and literal interpolation-like text remain. Duplicate/invalid keys and unclosed quotes are diagnosed. Nested objects, null, booleans and numeric values are not silently converted to strings. |

TOML native date/time values and 64-bit integers beyond JavaScript's safe range
have exact **textual projections** in `value`, with a source-native type label in
Tree. They are editable in Code, not coerced through the string field. Their
original native type remains in saved source; an unrelated tree edit leaves
their bytes unchanged. Conversion out of TOML is refused while these native
values are present. `value`/JSON patch alone cannot preserve their file types.
Nonfinite TOML floats are not admitted by the JSON-compatible facade.

JSON and YAML numbers use JavaScript's numeric projection. Files containing decimal or
integer precision that projection cannot retain stay source-authoritative in
Code, with an explicit tree hint and conversion guard. Format preserves their
original numeric lexemes (YAML Format leaves those files unchanged rather than
rounding through its AST); inline edits cannot silently round a new value.
Save these files from `context.text`, not by serializing `value` or its patch.
Root value copying retains their exact source; individual values are copied
from Code rather than from rounded tree projections.

No codec loads a URL, uses `eval`, expands variables, reads `.env` files, mutates
`process.env`, or executes a configuration. YAML uses the packaged `yaml` AST;
TOML uses the packaged syntax parser with source ranges. These are production
dependencies, not runtime CDN downloads. Source-copy consumers install the same
dependencies through their normal package manager.

### Format Controls, Comments and Diagnostics

Code offers JSON/YAML/TOML/`.env` with a shared-motion selection pill. Narrow
containers use the existing Morph Select. Invalid/blocked Code must be repaired
or explicitly reverted before conversion. Compatible formats retain their own
last valid source; switching back restores comments, and subsequent edits are
patched into that source. Conversions are local source changes, included in
history and dirty state; they do not advance the saved baseline merely by viewing
another representation.

Tree shows the first inline comment, or a preceding comment when there is no
inline comment. The shared tooltip exposes the full comment. Comments are edited
in Code. Undo/redo restore source, format and comment state together. Discard
restores the exact accepted/incoming source, including comments and spacing.

YAML Enter continues lists and indents keys/block values. Error line paint,
source squiggles and Jump locate parse failures; YAML indentation tabs can be
explicitly replaced with spaces. TOML Format changes assignment spacing using
parsed ranges; `.env` Format changes assignment spacing only on actual assignment
lines. Neither touches assignment-like text inside multiline strings. YAML
Format uses the retained document AST, keeping comments and anchors.

### Accepted File Writer Example

```tsx
import * as React from 'react';
import {
  DocumentEditor, type DocumentFormat, type JsonDocumentValue,
} from '@zero/framework/components/json-editor';

interface AcceptedFileWriter {
  (request: {
    documentId: string;
    expectedRevision: number;
    format: DocumentFormat;
    text: string;
    projection: JsonDocumentValue;
    signal: AbortSignal;
  }): Promise<{ accepted: true; revision: number }>;
}

// The domain writer owns authorization, stable retry identity and actual file storage.
// Mount this owner with key={documentId} when switching document/tenant identity.
export function ConfigFile({ documentId, initialText, initialFormat, initialRevision, write }:
  { documentId: string; initialText: string; initialFormat: DocumentFormat;
    initialRevision: number; write: AcceptedFileWriter }) {
  const [source, setSource] = React.useState({ format: initialFormat, text: initialText });
  const [raw, setRaw] = React.useState<string | null>(null);
  const revision = React.useRef(initialRevision);
  return <DocumentEditor documentKey={documentId} label="Function config"
    rootName="config" format={source.format} sourceText={source.text}
    onSourceChange={({ format, text }) => setSource({ format, text })}
    rawTextDraft={raw} onRawTextDraftChange={setRaw}
    onSave={async (projection, _patch, { format, text, signal }) => {
      const receipt = await write({ documentId, expectedRevision: revision.current,
        format, text, projection, signal });
      if (receipt.accepted !== true) throw new Error('The file was not accepted.');
      if (!signal.aborted) revision.current = receipt.revision;
    }} />;
}
```

Retain unfinished raw text separately from the valid source. A malformed external
replacement is diagnosed in its actual format and keeps the last valid tree
frozen until the file is repaired or explicitly reverted. A source-only
external revision (even comments alone) conflicts with a dirty draft; explicit
Discard adopts it. A pending save carries an immutable source/format snapshot.
Newer comments, formatting or data stay dirty when that older snapshot is
accepted. A missing writer never invents Saved, and a failed writer keeps the
draft. The editor does not supply a server endpoint or revision protocol.

## Related Guides And Next Steps

- [Data Studio dialogs](../data-studio/dialogs.md) binds actual schema validators,
  Visual/JSON mode handoff and revisioned table writes.
- [Data Studio values](../data-studio/values.md) explains stable IDs and defaults.
- [CodeBlock](./public-pages/code-block.md) displays highlighted code without editing.
- [Component configuration](./configuration.md) routes reusable UI configuration.
- [Component roadmap](./roadmap.md) tracks the separate future code-editor work.

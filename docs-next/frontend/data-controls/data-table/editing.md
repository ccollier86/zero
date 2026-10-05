---
id: zero.frontend.data-controls.data-table-editing
type: reference
audience: [developer, agent]
owner: frontend-data-controls
status: draft
visibility: internal
system: frontend-data-controls
feature: data-table-editing
maturity: supported
applies_to: ["2.1.1 source with audited corrections; package qualification pending"]
modes: [browser, SSR, array, collection, lazy, server query]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Inline Editing And Accepted Cell Writes

[DataTable index](./index.md) · [Documentation index](../../../index.md)

DataTable provides schema-aware inline editors that remain pending until their
writer accepts the change. A declaration marks editable fields; the server still
validates values, ownership, permissions and the live authorization scope.

## Choose Exactly One Authoritative Writer

```tsx
import { DataTable } from '@zero/framework/react';

<DataTable
  schema={tasks.schema}
  collection="tasks"
  columns={['title', 'done']}
  editable={['title', 'done']}
/>;
```

This fragment assumes configured client/provider and an admitted tasks collection.
The source's update action owns persistence. DataTable encodes a logical editor
value through schema codecs before sending it.

Writer precedence is onCellCommit, then resolved source actions.update, then
onCellEdit when no source action exists. onCellCommit replaces the normal writer;
do not manually write in it and expect the source to write again.
Both callbacks receive (rowId, columnId, encodedValue, optionalContext) and may
return Promise<void>. Await the actual acknowledged server operation.

Legacy onCellEdit is dual-purpose. Without source actions it is the authoritative
array writer. After a source update it is only an accepted follow-up notification.
A failed follow-up reports safe accepted-callback feedback; it must not expose
Retry that reissues an already accepted source write. This distinction is a
corrected development-source contract, not an assertion about an old artifact.

Arrays need onCellCommit or onCellEdit to edit. They remain caller-controlled:
accepting a callback does not silently mutate the supplied row array. Update
app state or return refreshed source rows through the normal source contract.

## Keyboard, Validation And Failure

An editable display activates by click, Enter or Space. Text-like editors commit
through their configured Enter/blur/Tab interaction, cancel with Escape, and
advance only after acceptance. Pending controls prevent duplicate saves.
Boolean fields use a pending-aware checkbox rather than a text input.

Optional numeric clear produces explicit null so JSON/wire updates do not drop
the change; required numeric clear remains an invalid blank. Schema metadata
chooses the editor and encoding; it is not a substitute for backend validation.
Rejected writes keep the editor/failure state rather than announcing success.
The mutation runner presents safe generic failure feedback and records stable
frontend.mutation.failed metadata without rejected values.

After successful execution the source refresh is awaited when configured.
If refresh fails after the write, Retry repeats only refresh, not the accepted
write. Authorization/source replacement or unmount aborts pending UI work and
prevents stale completion from closing/advancing the new scope's editor.
An AbortSignal is a cancellation request, not rollback of already accepted
server side effects.

## Standalone Cells

```tsx
import { EditableCell, AnimatedCell } from '@zero/framework/components/data-table';
```

EditableCell requires value, rowId, columnId, isEditing, onStartEdit, onSave and
onCancel; optional fieldMeta, onAccepted, onTabNext, mutationRunner, onRefresh,
refreshOnSuccess and mutationBoundaryKey customize composition.
onSave receives rowId, columnId, value and optional mutation context; onAccepted runs after write and
configured refresh. A supplied mutationRunner shares keyed operations across
the table; otherwise a local scope-aware runner is created.

AnimatedCell takes value, children and optional className; it highlights changed
values after initial render. It is presentation only, not an update subscription,
writer or acknowledgment signal. These subcomponents have a public table subpath;
do not assume every prop/type is exported from the root barrel.

## Upgrade And Verification

Delayed/rejected writes should not finish editors prematurely. Confirm successful
null clear, invalid required clear, failed refresh retry, accepted notification
failure, duplicate interaction, scope change and unmount. Source identity is a
partition boundary, not a browser-supplied privilege selector. Qualify custom
writers independently and keep their error text/payloads out of UI telemetry.

## Related Guides And Next Steps

- [Actions](./actions.md) explains the shared keyed mutation lifecycle.
- [Sources](./sources.md) identifies the normal accepted update writer.
- [Schema codecs](../../../backend/schema/codecs.md) owns logical/stored values.
- [Acknowledged SDK mutations](../../sdk/acknowledged-mutations.md) owns receipts.

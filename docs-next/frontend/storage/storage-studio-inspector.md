---
id: zero.frontend.storage.storage-studio-inspector
type: reference
audience: [developer, agent, operator]
owner: storage
status: draft
visibility: internal
system: storage
feature: storage-studio-inspector
maturity: supported
applies_to: ["2.1.1 development source; not package-qualified"]
modes: [single-tenant, multi-tenant, guardian-enabled, storage-enabled]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# StorageStudioInspector

[Storage UI index](./index.md) · [Documentation index](../../index.md)

`StorageStudioInspector` renders the right-hand detail/control panel for the current selection. Props are required `controller`, optional `slots: StorageStudioInspectorSlots`, and `className`.

Drive mode requires selectedDrive; file mode requires selectedFile. With no selection it shows a compact explanation instead of creating actions or assuming a user owns the workspace.

## Drive Panels

Tabs are Overview, Access, Settings, Usage and Jobs:

- Overview shows stable key, owner/scope/isolation, generation/revision, timestamps and bounded failure code.
- Access shows effective read/write/admin/owner or a supplied ACL editor.
- Settings shows limits/visibility or a supplied mutable settings panel.
- Usage shows logical bytes/counts and an available quota indicator.
- Jobs shows the supplied lifecycle-job display history.

Native composition replaces the Access/Settings defaults with established grant/settings organisms, preserving distinct data-admin and control-manage checks.

## File/Folder Panels

Tabs are Preview, Details, Access and Sharing. Details include path/type/size/checksum/timestamps and existing metadata. Editable metadata values use `InlineEditText`, current file updatedAt revision and `updateFileMetadata`; edits require write authority. The current UI edits existing keys—it is not a general schema designer or complete add/remove metadata builder.

Preview is rendered by [StorageFilePreview](./storage-file-preview.md), unless a slot replaces it. Exact-object ACLs use [StorageObjectPermissionsPanel](./storage-object-permissions-panel.md) in native composition.

Sharing separates an object's own public flag from effective visibility inherited through a public drive/path. An object's private flag does not negate a public drive. Durable visibility changes require ACL admin and policy permission; temporary links do not change visibility. A public drive disables the object's restrictive toggle until the drive is private.

## Slots And Composition

```tsx
import { StorageStudioInspector } from '@zero/framework/components/storage';
import type { StorageManagementController } from '@zero/framework/components/storage';

export function Inspector({ controller }: { controller: StorageManagementController }) {
  return (
    <StorageStudioInspector controller={controller} slots={{
      driveJobs: (_drive, jobs) => <p>{jobs.length} recent lifecycle jobs</p>,
    }} />
  );
}
```

Slot return null/undefined falls back to built-in content; use an empty fragment if intentionally replacing it with nothing. Do not infer raw provider paths or secrets from these logical browser-safe views.

[Family index](./index.md) · [Controller/slot contract](./controller-contract.md) · [Permissions](../../backend/storage/permissions.md) · [Presigned capabilities](../../backend/storage/capabilities.md)

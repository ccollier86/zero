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
applies_to: ["2.2.1 development source with explicit visibility UI; not package-qualified"]
modes: [single-tenant, multi-tenant, guardian-enabled, storage-enabled]
reviewed_against:
  package: "@zero/framework"
  version: "2.2.1"
  commit: "95ba0578f6625fc4597a9ec6786ee1d3353f29cd"
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

Sharing separates an object's own public flag from effective visibility inherited
through a public drive. An object's private flag does not negate a public drive.
Public folder flags do not automatically publish child objects; inherited
ancestor ACL grants are a separate access mechanism. Durable visibility changes
require ACL admin and policy permission; temporary links do not change visibility.
A public drive disables the object's restrictive toggle until the drive is private.

## Public Downloads

Enable `storage.studio.publicAccess` deliberately before publishing:

```ts
import type { AppStorageConfig } from '@zero/framework/server';

export const storage: AppStorageConfig = {
  studio: {
    enabled: true,
    publicAccess: {
      allowPublicDrives: true,
      allowPublicObjects: true,
    },
  },
};
```

Merge this module into the app's existing configuration; the normal server
configuration update/restart applies. See [public access](../../backend/storage/public-access.md)
for policy ceilings and inheritance rather than treating a UI prop as authority.

- Select a drive, open **Settings**, choose **Public read** under Visibility and
  save. Existing and future files inherit public downloads.
- Select an individual file in a private drive, open **Sharing**, and choose
  **Make public** under Public visibility. This sets the object's own flag.
- Visibility stays visible when publishing is disabled, with an explanatory
  disabled control. Existing public resources still offer **Make private** after
  policy tightening. A public drive must be made private before an object's
  private flag can restrict access. A public folder flag does not automatically
  publish its children; descendant access via ancestor ACL grants is distinct.

These controls do not permit anonymous upload, editing or permission changes.
File publication requires live ACL admin; managed drive settings require the
live control-plane authority. Short-lived download links remain a separate
sharing option and do not change durable visibility.

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

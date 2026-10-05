---
id: zero.frontend.storage.storage-object-permissions-panel
type: reference
audience: [developer, agent, operator]
owner: storage
status: draft
visibility: internal
system: storage
feature: storage-object-permissions-panel
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

# StorageObjectPermissionsPanel

[Storage UI index](./index.md) · [Documentation index](../../index.md)

`StorageObjectPermissionsPanel` edits grants originating on one file/folder and presents inherited drive/ancestor grants read-only.

| Prop | Contract |
| --- | --- |
| `driveId` | Required string for current drive. |
| `file` | Required FileInfo for exact selected object. |
| `access` | Required `StorageAccessCapabilities | null`; canAdmin controls admission. |
| `onChanged?` | Optional callback after accepted changes. |

```tsx
import { StorageObjectPermissionsPanel } from '@zero/framework/components/storage';
import type { FileInfo, StorageAccessCapabilities } from '@zero/framework/react';

export function ObjectAccess({ driveId, file, access }: {
  driveId: string; file: FileInfo; access: StorageAccessCapabilities | null;
}) {
  return <StorageObjectPermissionsPanel driveId={driveId} file={file} access={access} />;
}
```

## Exact Object Versus Inheritance

The permission request includes file.path. Direct grant grouping compares permission.object_id to file.id, not its name. New grants set objectPath to this exact file path. Revoke dispatch rejects a permission whose object_id differs, so inherited rows cannot be deleted here. A folder-origin grant can affect descendants but must be managed at its source.

Without resolved canAdmin, the component does not inspect/alter grants; it still shows available effective access summary. Passing a forged capability object cannot bypass the backend.

Mutations await the SDK action, refresh both permissions and parent via onChanged, and report normalized failures through the shared Storage observability path and toast. Grant failure rethrows to the internal form, which retains input; revoke failure stays in owning panel presentation. This is not a blanket organization role assignment or invitation action.

[Family index](./index.md) · [Drive grants](./storage-drive-permissions-panel.md) · [Backend hierarchical ACLs](../../backend/storage/permissions.md) · [Native inspector](./storage-studio-inspector.md)

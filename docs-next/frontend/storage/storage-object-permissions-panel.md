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
applies_to: ["2.2.1 development source with compact grant controls; not package-qualified"]
modes: [single-tenant, multi-tenant, guardian-enabled, storage-enabled]
reviewed_against:
  package: "@zero/framework"
  version: "2.2.1"
  commit: "95ba0578f6625fc4597a9ec6786ee1d3353f29cd"
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

The panel reads the normal AppProvider/ClientProvider authorization boundary.
One synchronous reservation covers grant and revoke together. Replacing
drive/object ID or path, changing scope, or losing/regaining admin capability
retires the old operation lifetime and resets the grant draft. Late outcomes
cannot refresh/toast/notify a successor or clear its pending operation—even if
the original target/scope is selected again. Rejected retired requests still
emit safe captured-target failure accounting; they do not display stale toasts.
An `onChanged` notification failure is not a rejected server mutation. Unmount
retires UI work but cannot undo a completed server write.

The shared grant form wraps according to the inspector's available width.
Direct and inherited grants use separate compact, labeled scroll regions,
each bounded to 20rem and keyboard-focusable. Long targets truncate visually
without widening the pane; row titles expose the full target. Direct revoke
buttons name the target and access level. Inherited rows have no revoke action:
their source drive/folder must be edited instead. This visual layout preserves
the existing exact-object and live-capability boundaries.

[Family index](./index.md) · [Drive grants](./storage-drive-permissions-panel.md) · [Backend hierarchical ACLs](../../backend/storage/permissions.md) · [Native inspector](./storage-studio-inspector.md)

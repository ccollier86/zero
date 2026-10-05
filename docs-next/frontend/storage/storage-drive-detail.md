---
id: zero.frontend.storage.storage-drive-detail
type: reference
audience: [developer, agent, operator]
owner: storage
status: draft
visibility: internal
system: storage
feature: storage-drive-detail
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

# StorageDriveDetail

[Storage UI index](./index.md) · [Documentation index](../../index.md)

`StorageDriveDetail` composes Settings and Permissions tabs for one established `StorageDriveRow`. It delegates persistence to its parent and mounts the built-in ACL editor.

| Prop | Contract |
| --- | --- |
| `drive` | Required StorageDriveRow. |
| `busy?` | Defaults false; pending parent operation. |
| `onSave` | Required `(driveId: string, changes: Partial<StorageDriveRow>) => void | Promise<void>`. |
| `onRefresh?` | Optional callback after ACL changes. |

```tsx
import { StorageDriveDetail } from '@zero/framework/components/storage';
import type { StorageDriveRow } from '@zero/framework/components/storage';

export function DriveEditor({ drive, save }: {
  drive: StorageDriveRow;
  save: (id: string, changes: Partial<StorageDriveRow>) => Promise<void>;
}) {
  return <StorageDriveDetail drive={drive} onSave={save} />;
}
```

The default tab is Settings. `drive.access?.canAdmin === true` gates the legacy settings form and grant editor. An unresolved access value is not treated as permission. The parent callback should reject on failed persistence and own user-visible error/observability; returning void means no additional awaited operation exists.

In native Studio, use the [composition hook's slots](./use-storage-studio-management.md), which adapt the settings and grants separately: settings need control manage, grants need ACL admin. Do not reuse the legacy data-admin check as a universal rule for managed drive lifecycle.

[Family index](./index.md) · [Settings panel](./storage-drive-settings-panel.md) · [Drive grants](./storage-drive-permissions-panel.md) · [Controller distinction](./controller-contract.md)

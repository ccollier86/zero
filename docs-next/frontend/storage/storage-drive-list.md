---
id: zero.frontend.storage.storage-drive-list
type: reference
audience: [developer, agent, operator]
owner: storage
status: draft
visibility: internal
system: storage
feature: storage-drive-list
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

# StorageDriveList

[Storage UI index](./index.md) · [Documentation index](../../index.md)

`StorageDriveList` is the established fully wired drive master/detail screen. Required `onBrowse(driveId: string)` delegates entering a drive to the parent; optional `className` styles the wrapper.

```tsx
import { StorageDriveList, StorageFileBrowser } from '@zero/framework/components/storage';
import { useState } from 'react';

export function ExistingStorageScreens() {
  const [driveId, setDriveId] = useState<string | null>(null);
  return driveId
    ? <StorageFileBrowser driveId={driveId} onBack={() => setDriveId(null)} />
    : <StorageDriveList onBrowse={setDriveId} />;
}
```

Render below the client/app provider. The list uses useStorageDrives/useStorageActions, the shared MasterDetailPage and exported storageDriveSchema/listColumns. It converts `drive_id` to presentation row `id`; those are two views of the same drive identity, not different ownership IDs.

## Actions And Detail

New Drive uses the established createDrive API and a name dialog. Browse delegates to onBrowse. Public/private and Delete require resolved data-admin access; delete uses a destructive hold-to-confirm modal. Details compose usage/header, settings and permission grants.

Save delegates drive settings to updateDrive and visibility to setVisibility, awaits both requested actions, refreshes and reports failure. Those are separate operations, not a combined transaction. Pending state disables UI actions; backend permissions remain authoritative.

## Choose Native Studio For Managed Provisioning

This screen is not the owner-aware Studio provisioner: it does not use native control-plane capabilities, stable owner/key receipts, revisions or lifecycle jobs. Use [StorageStudioManagement](./storage-studio-management.md) for that need. Supplying this UI alone cannot enable organization self-service.

Exports `storageDriveSchema`, `storageDriveListColumns` and `storageDriveEditableFields` are presentation metadata, not declarations creating backend storage tables or granting access. They are public through the storage component barrel:

| Schema field | Presentation definition |
| --- | --- |
| `name` | Required text, Name label. |
| `max_size_bytes` | Number, whole-byte drive limit. |
| `max_file_size_bytes` | Number, whole-byte per-file limit. |
| `allowed_mime_types` | Text, wildcard/comma-separated display. |
| `public` | Select values `'1'`/`'0'`, default `'0'`. |

`storageDriveListColumns` is `['name', 'allowed_mime_types', 'public']`; `storageDriveEditableFields` contains all five fields above. The row's `id` is supplied by the drive record projection and MasterDetail primaryKey, not declared as an editable schema field.

[Family index](./index.md) · [Detail](./storage-drive-detail.md) · [Backend drives](../../backend/storage/drives.md) · [Shared master/detail](../data-controls/master-detail.md)

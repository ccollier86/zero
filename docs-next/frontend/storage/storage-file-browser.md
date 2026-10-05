---
id: zero.frontend.storage.storage-file-browser
type: reference
audience: [developer, agent, operator]
owner: storage
status: draft
visibility: internal
system: storage
feature: storage-file-browser
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

# StorageFileBrowser

[Storage UI index](./index.md) · [Documentation index](../../index.md)

`StorageFileBrowser` is the established ready-wired browser for one drive. Props are required `driveId: string`, required `onBack(): void`, optional `className`.

It owns current folder path, selected file, search/type/sort controls, mutations and inline error state. Folder/usage/capability/URL reads and mutations use the standard storage hooks; it does not receive raw server services or signing secrets.

```tsx
import { StorageFileBrowser } from '@zero/framework/components/storage';

export function Files({ driveId, back }: { driveId: string; back: () => void }) {
  return <StorageFileBrowser driveId={driveId} onBack={back} />;
}
```

## Interactions

Breadcrumbs and folder opens clear selection. Shared compact table search comes before type/sort controls. In this established browser, search filters the **currently loaded folder items** by name/path/MIME; it is not a query across all storage files. Type and sorting are forwarded to the folder API.

Write-capable users see upload/dropzone and folder creation. Selected details provide download, temporary-link copy, rename/move path, visibility toggle and destructive deletion. Effective object capabilities are requested for the selected path; backend ACLs still govern every operation. Delete uses hold-to-confirm. Download opens an approved presigned URL with noopener/noreferrer; sharing uses Clipboard API and reports unavailable clipboard support.

This component is distinct from the native Studio's paginated server search/lifecycle control plane. For large paginated folders and owner-aware provisioning, start with [StorageStudioManagement](./storage-studio-management.md); do not infer its capabilities from this legacy prop surface.

## Reuse

The parent chooses screen navigation through onBack. For app-specific layout/actions, use [useStorageBrowser](./storage-browser-hooks.md), core [folder/actions hooks](./storage-hooks.md), or a custom native [controller](./controller-contract.md).

[Family index](./index.md) · [File details](./storage-file-detail-panel.md) · [Dropzone](./storage-dropzone.md) · [Backend objects](../../backend/storage/objects.md)

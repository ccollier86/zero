---
id: zero.frontend.storage.storage-studio-action-bar
type: reference
audience: [developer, agent, operator]
owner: storage
status: draft
visibility: internal
system: storage
feature: storage-studio-action-bar
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

# StorageStudioActionBar

[Storage UI index](./index.md) · [Documentation index](../../index.md)

`StorageStudioActionBar({ controller })` renders selection-aware actions in the bottom `RecordNavigationBar`. It has no className prop. Callback availability and effective capabilities jointly decide visible actions; loading/busy state disables mutation admission.

## Selection Versus Pagination

Record previous/next chooses a drive/file inside the currently supplied array. Selection index is derived from drive ID or file ID. It does not request a server page. Use [pagination controls](./storage-studio-pagination.md) for that separate operation.

## Drive Actions

Read-capable ready drives can Open. Control manage plus renameDrive enables Rename; the built-in action focuses the row's inline editor rather than opening a separate giant form. Suspend, Restore/Resume/Retry and Delete require their control capabilities and supplied operations. Provisioning/deleting/restoring disables lifecycle actions.

New Drive appears only if at least one organization/personal provisioning capability is true and createDrive exists. The built-in provisioning form uses server policy and current owner choices, not a browser-supplied organization ID.

## File Actions

Folder Open and file Download use read capability. Rename, Move, Copy and Delete use write capability and relevant operations; Copy/Download/Share are file-only. Share requests a temporary link and uses read capability, not permanent public visibility.

New Folder and Upload require a ready selected drive and current-path write capability. Native controllers provide path capabilities; a legacy controller omitting that property uses drive-level data access as a fallback.

The action bar dispatch observes async rejection because controllers own reporting; it does not fabricate success toasts or log a second error. For custom controllers, implement pending/error/authority handling inside the callback. Built-in deletion confirmation belongs to the operation layer.

```tsx
import { StorageStudioActionBar } from '@zero/framework/components/storage';
import type { StorageManagementController } from '@zero/framework/components/storage';

export function Actions({ controller }: { controller: StorageManagementController }) {
  return <StorageStudioActionBar controller={controller} />;
}
```

[Family index](./index.md) · [Controller contract](./controller-contract.md) · [List](./storage-studio-list.md) · [Backend lifecycle](../../backend/storage/studio-lifecycle.md)

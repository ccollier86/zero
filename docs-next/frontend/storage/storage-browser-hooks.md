---
id: zero.frontend.storage.storage-browser-hooks
type: reference
audience: [developer, agent, operator]
owner: storage
status: draft
visibility: internal
system: storage
feature: storage-browser-hooks
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

# useStorageBrowser And useDriveQuota

[Storage UI index](./index.md) · [Documentation index](../../index.md)

`useStorageBrowser(driveId: string | null, initialPath = '')` groups one drive's folder navigation, selected item, upload queue and common mutations. It is headless; the app controls layout and confirmations.

## Browser State And Commands

State is driveId/path/isRoot/items/selected/total/loading/error string|null/actionError string|null/uploadQueue. Paths trim surrounding slashes. Commands:

- openFolder(FileInfo|string), goUp(), setPath(string), select(FileInfo|null), refresh().
- uploadFiles(File[]|FileList, options?): Promise<FileInfo[]>.
- createFolder(name, isPublic?): Promise<FileInfo|null>.
- deleteSelected(): Promise<void>.
- moveSelected(to), copySelected(to): Promise<FileInfo|null>.

Mutations await standard Storage actions, refresh folder data, report current-scope failures with FRONTEND_STORAGE_ACTION_FAILED, and reject on actual errors. No selected item or absent drive returns the documented null/no-op shape rather than inventing a successful mutation. This hook does not open confirmation dialogs for deletion; that belongs to the consuming UI.

```tsx
import { useStorageBrowser } from '@zero/framework/react';

export function BrowserNames({ driveId }: { driveId: string | null }) {
  const browser = useStorageBrowser(driveId, 'documents');
  return (
    <section>
      <button onClick={browser.goUp} disabled={browser.isRoot}>Up</button>
      {browser.items.map(file => (
        <button key={file.id} onClick={() => browser.select(file)}>{file.name}</button>
      ))}
      {browser.actionError && <p role="alert">{browser.actionError}</p>}
    </section>
  );
}
```

## Drive And Authority Identity

Drive changes and auth-boundary changes clear selected object/path/action error, restoring initialPath. Old drive handlers cannot mutate the previously selected object after a replacement. A separate mounted fence also prevents retained selected-object action admission after unmount. Scope transitions mask prior values and fence async completion. Folder results belong to their own request identity.

The hook exposes total but not a folder cursor-navigation interface; it is not the native paginated Studio controller. For paginated server search/sorting/lifecycle use [useStorageStudioManagement](./use-storage-studio-management.md). A FileInfo selected by an app must still belong to the intended drive; frontend state is not a server authorization claim.

## Quota

`useDriveQuota(driveId)` wraps useDriveUsage and adds:

| Value | Meaning |
| --- | --- |
| percentUsed | Usage percentage, default 0 before data. |
| unlimited | True without resolved usage or when maxBytes<=0. Distinguish loading from a known unlimited policy. |
| overLimit | Resolved positive quota and totalBytes>maxBytes; equality is not “over.” |
| nearLimit | Resolved positive quota and percentUsed>=80. |

Quota flags are UI hints, not upload reservations. The server enforces concurrent reservations/byte limits.

[Family index](./index.md) · [Basic hooks](./storage-hooks.md) · [Upload queue](./upload-queue-hooks.md) · [Backend quotas](../../backend/storage/studio-quotas.md)

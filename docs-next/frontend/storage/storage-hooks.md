---
id: zero.frontend.storage.storage-hooks
type: reference
audience: [developer, agent, operator]
owner: storage
status: draft
visibility: internal
system: storage
feature: storage-hooks
maturity: supported
applies_to: ["2.2.1 development source with HTTP path correction; not package-qualified"]
modes: [single-tenant, multi-tenant, guardian-enabled, storage-enabled]
reviewed_against:
  package: "@zero/framework"
  version: "2.2.1"
  commit: "b4a47cab24839a4b2033c093df315d14cc47b627"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Basic Storage Hooks

[Storage UI index](./index.md) · [Documentation index](../../index.md)

The eight core hooks are exported from `@zero/framework/react` (also the framework root). Use them below the existing app/client provider. They delegate authenticated transport to the SDK; do not read browser tokens or implement a second refresh loop.

## Reads

| Hook | Input | Result |
| --- | --- | --- |
| `useStorageDrives()` | None | drives with effective access, loading, error string|null, refresh |
| `useStorageFolder(driveId, path?, options?)` | nullable drive; ListOptions cursor/limit/search/type/sort | items, total, next cursor|null, loading, error, refresh |
| `useDriveCapabilities(driveId, path?)` | nullable drive, optional exact object path | capabilities|null, loading, error, refresh |
| `useStoragePermissions(driveId, objectPath?)` | nullable drive; path selects relevant inherited/direct grants | permissions, loading, error, refresh |
| `useDriveUsage(driveId)` | nullable drive | usage|null, loading, error, refresh |

Read hooks abort superseded work, mask values not owned by the current auth/request identity, and ignore obsolete completion. Null drive IDs defer work. refresh triggers another read only for the current ready scope. These are HTTP reads, not direct ReactiveDB subscriptions; explicitly refresh after accepted changes or compose an appropriate app invalidation channel.

Folder search/type/sort/cursor are sent to the server. items is one accepted page, not every cached object; cursor identifies another page. Permission list access still requires backend data-admin authority. Anonymous catalogs may include public drives under core server policy; native Studio requires authenticated authority.

```tsx
import { useStorageFolder } from '@zero/framework/react';

export function FolderNames({ driveId }: { driveId: string | null }) {
  const folder = useStorageFolder(driveId, 'documents', {
    limit: 40, search: 'invoice', type: 'file', sortBy: 'name', sortDir: 'asc',
  });
  if (folder.error) return <p role="alert">{folder.error}</p>;
  return <ul>{folder.items.map(file => <li key={file.id}>{file.name}</li>)}</ul>;
}
```

## Upload And Temporary URLs

`useUpload()` returns uploading/progress/error/result, `upload(driveId, file, options?): Promise<FileInfo>`, and reset(). Options are path/overwrite/public/metadata/onProgress. Multipart XHR progress runs through the SDK's authenticated transport lifecycle: stored-session restoration, at most the normal 401 refresh/retry, and scope acceptance. It aborts on unmount/scope reset; stale results do not become current UI data. Await upload; failed operations reject and also set current error. reset aborts the active upload and clears presentation.

`usePresignedUrl()` returns `getUrl(driveId, path, method?: upload | download): Promise<string>`, default download. It requests a bounded server-signed capability. This hook has no arbitrary expiration prop. A URL grants its approved operation for its lifetime; it is not a permanent path or harmless log value.

## Actions

`useStorageActions()` returns Promise-based methods:

- createDrive(name, options?) and updateDrive(driveId, updates); names/limits/MIME use the core engine wire shape.
- deleteDrive(driveId), grantPermission(driveId, params), revokePermission(permissionId), createUploadGrant(driveId, params).
- createFolder(driveId, path, isPublic?), deleteFile(driveId, path), moveFile(driveId, from, to), copyFile(driveId, from, to).
- updateFileMetadata(driveId, path, metadata), setVisibility(driveId, isPublic, path?).
- getFileUrl(driveId, path), a synchronous URL builder, **not** an authenticated/presigned download promise.

Pass raw logical paths, normally `FileInfo.path`, to these methods; do not
pre-encode filenames. The hook encodes URL segments and the shared HTTP
boundary decodes them exactly once. `/invoice 1.txt` and `/invoice%201.txt`
remain distinct targets, including when deleting an uploaded file through the
packaged hold-to-confirm interaction. See the canonical
[logical-path contract](../../backend/storage/objects.md#logical-paths-and-http-encoding).

Async actions fence admission and response against the current scope. A response rejected after scope change can represent an accepted server write; do not assume browser rejection rolled back persistence. Core actions do not implement native Studio owner/key/revision/receipt lifecycle; use client.storageStudio for that contract.

[Family index](./index.md) · [Queue](./upload-queue-hooks.md) · [Single-object hook](./storage-file-hooks.md) · [Backend request authority](../../backend/storage/request-authority.md) · [Core SDK integration](../../backend/storage/client-integration.md)

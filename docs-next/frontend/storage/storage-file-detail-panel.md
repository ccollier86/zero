---
id: zero.frontend.storage.storage-file-detail-panel
type: reference
audience: [developer, agent, operator]
owner: storage
status: draft
visibility: internal
system: storage
feature: storage-file-detail-panel
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

# StorageFileDetailPanel

[Storage UI index](./index.md) · [Documentation index](../../index.md)

`StorageFileDetailPanel` is a focused selected-object summary/action dispatcher for the established browser. It has no transport, confirmation modal or automatic error reporting of its own.

Required props are `file: FileInfo` and callbacks `onDownload`, `onCopyLink`, `onRename`, `onToggleVisibility`, `onDelete`; each is `(file: FileInfo) => void`. Optional `busy` defaults false; `canWrite` and `canAdmin` default true for the existing direct composition contract. **Explicitly pass resolved capabilities when reusing it.** Those defaults are presentation behavior, not authorization.

```tsx
import { StorageFileDetailPanel } from '@zero/framework/components/storage';
import type { FileInfo } from '@zero/framework/react';

export function FileActions({ file, remove, download, share, rename, visibility }: {
  file: FileInfo;
  remove: (file: FileInfo) => void;
  download: (file: FileInfo) => void;
  share: (file: FileInfo) => void;
  rename: (file: FileInfo) => void;
  visibility: (file: FileInfo) => void;
}) {
  return <StorageFileDetailPanel file={file} canWrite={false} canAdmin={false}
    onDelete={remove} onDownload={download} onCopyLink={share}
    onRename={rename} onToggleVisibility={visibility} />;
}
```

Details include path, bytes, MIME/folder type, shortened checksum, timestamps and public flag. Files expose Download/Copy temporary link; folders do not. Rename/Delete require canWrite, durable visibility requires canAdmin, and busy disables buttons.

The parent must resolve temporary URLs, await mutations inside its own action handler, implement confirmation for destructive operations and present/report failures. Do not supply bare async callbacks that reject without an event-owned observer. For richer current/effective visibility, object grants and metadata editing, use [native inspector](./storage-studio-inspector.md).

[Family index](./index.md) · [Established file browser](./storage-file-browser.md) · [Backend public access](../../backend/storage/public-access.md)

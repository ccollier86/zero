---
id: zero.frontend.storage.storage-file-hooks
type: reference
audience: [developer, agent, operator]
owner: storage
status: draft
visibility: internal
system: storage
feature: storage-file-hooks
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

# useStorageFile

[Storage UI index](./index.md) · [Documentation index](../../index.md)

`useStorageFile(driveId: string | null, path: string | null)` loads one exact file/folder's metadata and supplies common object actions. Import it from `@zero/framework/react`.

Result: file: FileInfo|null; url: string|null; loading; error: Error|null; refresh(): void; remove(): Promise<void>; setVisibility(isPublic): Promise<void>. Unlike basic hooks' string errors, this hook exposes an Error instance.

```tsx
import { useStorageFile } from '@zero/framework/react';

export function ObjectSummary({ driveId, path }: {
  driveId: string | null; path: string | null;
}) {
  const object = useStorageFile(driveId, path);
  if (object.error) return <p role="alert">{object.error.message}</p>;
  return <p>{object.file?.name ?? (object.loading ? 'Loading…' : 'Choose a file')}</p>;
}
```

Null/empty selection defers reads. Metadata requests encode drive/path and use client.fetch. auth+drive+path identity masks old metadata during a replacement; request-generation/abort checks discard superseded completions. Retained handlers for a previous path/drive cannot dispatch against it after replacement. A separate mounted fence prevents retained action admission after unmount; pending metadata is aborted and its late completion cannot update state.

remove delegates deletion and clears the current selected metadata after success. setVisibility delegates durable flag mutation and updates the current visible object; neither bypasses the backend ACL/public policy. Errors are observed with established Storage frontend codes and rethrown to the caller, which must await or observe them.

## URL Is Not A Capability

url is constructed from the normal storage file route. It is **not** a presigned URL and does not attach bearer authorization when embedded in an arbitrary browser element. Use [usePresignedUrl](./storage-hooks.md) for an approved temporary download or [preview hook](./use-storage-file-preview.md) for safe browser rendering. Do not write a plain img/link around url and assume private authentication is transported.

This is one HTTP object read, not a live storage-table subscription. Call refresh or use app-owned invalidation after external updates.

[Family index](./index.md) · [Basic hooks](./storage-hooks.md) · [Preview](./storage-file-preview.md) · [Backend objects](../../backend/storage/objects.md)

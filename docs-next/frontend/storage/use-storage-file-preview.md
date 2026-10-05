---
id: zero.frontend.storage.use-storage-file-preview
type: reference
audience: [developer, agent, operator]
owner: storage
status: draft
visibility: internal
system: storage
feature: use-storage-file-preview
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

# useStorageFilePreview

[Storage UI index](./index.md) · [Documentation index](../../index.md)

`useStorageFilePreview(driveId: string, file: FileInfo)` returns scope-fenced preview data. It is exported from `@zero/framework/components/storage`, framework/react and react/hooks.

Return fields: kind (image/audio/video/pdf/text/unsupported); status (idle/loading/ready/error/unsupported); url:string|null; text:string|null; error:string|null; refresh():void.

```tsx
import { useStorageFilePreview } from '@zero/framework/components/storage';
import type { FileInfo } from '@zero/framework/react';

export function PlainPreview({ driveId, file }: { driveId: string; file: FileInfo }) {
  const preview = useStorageFilePreview(driveId, file);
  return preview.kind === 'text' && preview.status === 'ready'
    ? <pre>{preview.text}</pre>
    : <p>{preview.error ?? preview.status}</p>;
}
```

## Identity And Classification

Preview identity includes authorization boundary, drive, file ID/path and updatedAt. Changing any selection/version masks old data. The effect aborts superseded fetches and verifies scope before presenting completion. refresh triggers a new preview attempt.

Classification uses normalized MIME and conservative text extensions. SVG and folders are unsupported. Text/JSON/XML/YAML contents are returned as text, never trusted HTML. media/pdf results contain a presigned URL. The classifier and text byte-limit helpers are internal source helpers, not additional public package APIs.

## Bounded Text

Text metadata above 512 KiB is rejected before fetching. A streamed response is also counted as bytes so a dishonest Content-Length/file size cannot exceed the bound. It decodes text with TextDecoder. Non-text previews obtain an approved presigned download URL without loading the whole file into React state.

Requests omit credentials/referrer for the signed text fetch; the signing capability was obtained through authenticated Zero transport first. Failure is normalized through the shared frontend Storage observation path and returned as current preview.error.

This is a browser-safe rendering classification, not malware scanning, document editing, automatic URL renewal or a promise every PDF/audio/video codec works. If reusing url, preserve no-referrer/safe rendering and don't log/persist it as object identity. Prefer [StorageFilePreview](./storage-file-preview.md) for existing renderer/retry states.

[Family index](./index.md) · [Preview component](./storage-file-preview.md) · [Capabilities](../../backend/storage/capabilities.md)

---
id: zero.frontend.storage.storage-file-preview
type: reference
audience: [developer, agent, operator]
owner: storage
status: draft
visibility: internal
system: storage
feature: storage-file-preview
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

# StorageFilePreview

[Storage UI index](./index.md) · [Documentation index](../../index.md)

`StorageFilePreview({ driveId, file })` renders an approved presigned preview for one FileInfo. Required driveId is string; file is the selected file metadata. There is no arbitrary URL or raw HTML prop.

```tsx
import { StorageFilePreview } from '@zero/framework/components/storage';
import type { FileInfo } from '@zero/framework/react';

export function Preview({ driveId, file }: { driveId: string; file: FileInfo }) {
  return <StorageFilePreview driveId={driveId} file={file} />;
}
```

## Supported Rendering

- Non-SVG images render with img, no-referrer and bounded fit.
- Audio/video use browser controls and metadata preload; codec support remains browser-specific.
- PDFs use a sandboxed iframe with no-referrer.
- Supported text/JSON/XML/YAML and recognized text extensions render as escaped plain text in pre. Stored markup/script is not injected.
- Folders, SVG and other unsupported types show an explanatory state and point to Download.

The source classifier is conservative about executing markup, not an antivirus scanner or proof every supported browser codec renders. MIME and file bytes can still disagree; decode failures show Retry instead of silently succeeding.

## Lifecycle

[useStorageFilePreview](./use-storage-file-preview.md) owns auth/path/version identity, presigned fetching, bounded text reads and request cancellation. Text is capped at 512 KiB by both metadata admission and streamed-response byte accounting. Media uses an approved URL; the component does not load entire videos into React state.

Loading/idle uses a secure-preview loading state; failed requests/rendering show a bounded error and Retry; unsupported formats do not request unsafe rendering. Retry increments renderer state and refreshes the hook.

A scoped preview URL is an expiring capability; do not log or persist it as the permanent object identity. The browser does not possess the signing secret. Browser PDF/media behavior has not been exhaustively certified by this documentation pass.

[Family index](./index.md) · [Preview hook](./use-storage-file-preview.md) · [Backend capability semantics](../../backend/storage/capabilities.md) · [Native inspector](./storage-studio-inspector.md)

---
id: zero.frontend.storage.upload-queue-hooks
type: reference
audience: [developer, agent, operator]
owner: storage
status: draft
visibility: internal
system: storage
feature: upload-queue-hooks
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

# useUploadQueue

[Storage UI index](./index.md) · [Documentation index](../../index.md)

`useUploadQueue()` composes the single-file upload hook into a sequential UI queue. Import from `@zero/framework/react`. A call processes its supplied files one at a time; this is not a server background job queue or durable resumable upload ledger.

## Result And Options

Result fields are items, uploading, progress, completed, failed; methods uploadFiles(driveId, File[]|FileList, options?): Promise<FileInfo[]>, cancel(): void, clear(): void. Each item has id/file/name/size/progress/status/error/result. Status is queued/uploading/complete/error/cancelled.

Options extend UploadFileOptions (path, overwrite, public, metadata, onProgress) with resolvePath(file): string|undefined. A resolved per-file path overrides the common path. Aggregate progress is the rounded arithmetic mean of item percentages—not byte-weighted provider telemetry.

```tsx
import { useUploadQueue } from '@zero/framework/react';

export function QueueSummary() {
  const queue = useUploadQueue();
  return (
    <section>
      <p>{queue.completed.length} completed; {queue.progress}%</p>
      <button onClick={queue.cancel} disabled={!queue.uploading}>Cancel</button>
    </section>
  );
}
```

The consuming screen calls and awaits queue.uploadFiles from its event handler; [StorageDropzone](./storage-dropzone.md) provides ready-wired admission and error observation.

## Completion And Failure

Successful items retain their accepted FileInfo. The call returns completed results after the run and final scope check. An ordinary upload failure marks that item error and rejects; it does not automatically retry every remaining item or return a fictional all-success array. Previously accepted files are visible in completed state and are not rolled back.

cancel marks active/queued items cancelled, invokes uploader.reset to abort the active XHR, and stops admission of remaining files. clear cancels active work when necessary and removes visible queue state. Cancellation is not deletion of already accepted server objects.

Scope changes cancel/reset/mask queue values. Final scope verification rejects rather than returning old-scope FileInfo after a transition. Auth transport remains in useUpload, not queue-local token storage.

Use one active upload operation per consumer. The queue is local React state, not a concurrent multi-producer scheduler; app-level upload orchestration and durable retry are different requirements. Backend admission and quota enforcement apply regardless of local queue behavior.

[Family index](./index.md) · [Single upload](./storage-hooks.md) · [Dropzone hook](./upload-dropzone-hooks.md) · [Backend upload admission](../../backend/storage/studio-quotas.md)

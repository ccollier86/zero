---
id: zero.frontend.storage.upload-dropzone-hooks
type: reference
audience: [developer, agent, operator]
owner: storage
status: draft
visibility: internal
system: storage
feature: upload-dropzone-hooks
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

# useUploadDropzone

[Storage UI index](./index.md) · [Documentation index](../../index.md)

`useUploadDropzone(options)` composes react-dropzone with Zero's authenticated sequential upload queue. Accepted files upload immediately when the current scope and drive are available.

Required driveId is string|null. Optional path is string|null; accept/minSize/maxSize/maxFiles/multiple/disabled/noClick/noKeyboard are drag/drop options. Upload defaults/options are overwrite/public/metadata. Callback names are onUploaded(FileInfo[]), onRejected(FileRejection[]) and onError(Error).

Result is `{ dropzone: DropzoneState, queue: UseUploadQueueReturn, disabled, uploadFiles }`. Manual uploadFiles accepts files and UploadQueueFilesOptions, returns Promise<FileInfo[]> and intentionally rejects on failure after reporting.

```tsx
import { useUploadDropzone } from '@zero/framework/react';

export function CustomDrop({ driveId }: { driveId: string | null }) {
  const state = useUploadDropzone({ driveId, path: 'documents', multiple: true });
  return (
    <div {...state.dropzone.getRootProps()}>
      <input {...state.dropzone.getInputProps()} />
      <p>{state.disabled ? 'Choose a writable drive' : 'Drop files here'}</p>
    </div>
  );
}
```

## Admission And Destination

disabled combines explicit disabled, no drive and unready authorization scope. Current-scope rejected files notify onRejected but are not uploaded. Accepted files resolve destination from per-call resolvePath or configured path/file.name; per-call upload options override configured upload options. Browser accept/size rules are not backend MIME/quota enforcement.

The automatic drop event observes upload rejection because it has no async caller. The upload path has already reported to queue state, FRONTEND_STORAGE_ACTION_FAILED and onError. This avoids an unhandled promise without changing the imperative method's rejection contract.

onUploaded fires only for the current scope after completion. Callback delivery does not grant ownership and must not be used to persist sensitive data in an unrelated scope. A transition makes retained admission unavailable; async failures from an obsolete scope are not re-presented as current-scope errors.

## Reuse

Use [StorageDropzone](./storage-dropzone.md) for default design-token presentation/queue; use these bindings to integrate an existing app layout. Ensure getRootProps and getInputProps are rendered rather than building a second raw file-upload transport.

[Family index](./index.md) · [Upload queue](./upload-queue-hooks.md) · [Basic upload contract](./storage-hooks.md) · [Configuration](./configuration.md)

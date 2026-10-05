---
id: zero.frontend.storage.storage-dropzone
type: reference
audience: [developer, agent, operator]
owner: storage
status: draft
visibility: internal
system: storage
feature: storage-dropzone
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

# StorageDropzone

[Storage UI index](./index.md) · [Documentation index](../../index.md)

`StorageDropzone` is a themed immediate-upload area with optional queue display and a render-prop escape hatch. It wraps [useUploadDropzone](./upload-dropzone-hooks.md); it does not retain files locally awaiting an extra submit step.

```tsx
import { StorageDropzone } from '@zero/framework/components/storage';

export function Documents({ driveId, reload }: {
  driveId: string | null; reload: () => void;
}) {
  return <StorageDropzone driveId={driveId} path="documents"
    accept={{ 'application/pdf': ['.pdf'] }} maxSize={10 * 1024 * 1024}
    onUploaded={reload} />;
}
```

## Props

Required driveId is string|null. Optional path is string|null. Accepted filtering options are accept (react-dropzone MIME/extension map), minSize/maxSize/maxFiles, multiple (default true), disabled. Upload options are overwrite (component default true), public and metadata. Backend quotas/MIME/public policy remain final.

Presentation options are title (default 'Drop files here'), description (default upload explanation), chooseLabel (default 'Choose files'), showQueue (default true), className and div HTML attributes excluding conflicting children/onError/title. Callback names are onUploaded(FileInfo[]), onRejected(FileRejection[]), and **onUploadError(Error)**; the lower-level hook calls this onError.

The button opens the hidden input. Accepted files upload immediately in sequence. Queue state displays aggregate progress and completed/failed/cancelled items; clearing resets queue presentation and cancels active work as provided by the queue. A failure is not shown as success, and drop events observe the reported rejected operation.

## Custom Presentation

children is `(state: UseUploadDropzoneReturn) => ReactNode`. Supplying it replaces the component's entire default layout. Render state.dropzone.getRootProps()/getInputProps() and your queue yourself; merely rendering a custom label does not install a file input.

Current permission/readiness transitions disable admission and fence callbacks/results. Client file filtering is user experience, not a replacement for server MIME sniffing, quotas or ACLs.

[Family index](./index.md) · [Dropzone hook](./upload-dropzone-hooks.md) · [Queue](./upload-queue-hooks.md) · [Backend uploads](../../backend/storage/objects.md)

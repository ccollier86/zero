---
id: zero.frontend.storage.use-storage-studio-management
type: reference
audience: [developer, agent, operator]
owner: storage
status: draft
visibility: internal
system: storage
feature: use-storage-studio-management
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

# useStorageStudioManagement

[Storage UI index](./index.md) · [Documentation index](../../index.md)

`useStorageStudioManagement(options?)` composes native managed-drive capabilities/catalog, object browsing, effective ACLs, usage, lifecycle jobs, modal-backed mutations and uploads into a transport-free controller.

```tsx
import {
  StorageStudioWorkspace, useStorageStudioManagement,
} from '@zero/framework/components/storage';

export function StorageWithExtraUsage() {
  const { controller, inspectorSlots, uploadInputProps } =
    useStorageStudioManagement({ filePageSize: 40 });
  return (
    <>
      <input {...uploadInputProps} className="sr-only" aria-label="Choose files" />
      <StorageStudioWorkspace
        controller={controller}
        inspectorSlots={{
          ...inspectorSlots,
          driveUsage: (_drive, usage) => <p>{usage?.fileCount ?? 0} files</p>,
        }}
      />
    </>
  );
}
```

If using the composed upload operation, render its input props once. Omitting the input leaves the Upload picker without its intended DOM input.

## Options And Result

Options are `enabled?`, `initialDriveId?`, `drivePageSize?`, `filePageSize?`, `onDriveChange?`; exact defaults/bounds are in [the wrapper reference](./storage-studio-management.md). Results are `controller: StorageManagementController`, `inspectorSlots: StorageStudioInspectorSlots`, and `uploadInputProps` from react-dropzone's input bindings. The public hook is also exported by `@zero/framework/react/hooks`.

## Native State And Operations

Catalog requests use current scope and owner/lifecycle/search filters. Folder requests use current path, opaque cursor, file search, type and server sorting. File navigation stores cursor history; changing scope, drive, path, debounced search, type or sort resets it. Page size defaults differ for catalog/folders. Folder pages remain server pages; the hook does not merge them into a full client collection.

The selected drive can resolve outside the visible catalog page; the selected file is cleared when absent from the current folder result. Returning to the drive catalog clears drive/path/file and search. Jobs are loaded only when the selected drive has control manage authority; the current bounded jobs read is not a continuous job-progress subscription.

Operations use current SDK scope, expected drive revisions and mutation receipts. The operation layer reports failures through standardized Storage frontend observability, controller error state and toasts; the workspace does not duplicate that responsibility. UI visibility depends both on live capabilities and the presence of an operation.

## Authority And Async Ownership

Authentication, `boundary.ready` and Studio enablement gate catalog use. Scope transitions invalidate SDK acceptance and scoped UI values immediately. Modal-backed operations must still belong to the captured scope before transport and after awaits. Normal token rotation does not invent a new organization.

Uploads use the current folder capability, overwrite enabled, and selected drive's per-file size ceiling. Core upload transport restores/refreshes credentials through the SDK. These are admission and result fences, not a guarantee that an already accepted server mutation can be rolled back by a later logout.

[Family index](./index.md) · [Controller contract](./controller-contract.md) · [Basic hooks](./storage-hooks.md) · [Upload dropzone](./upload-dropzone-hooks.md) · [Backend authority](../../backend/storage/request-authority.md)

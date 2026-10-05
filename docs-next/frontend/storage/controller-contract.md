---
id: zero.frontend.storage.controller-contract
type: reference
audience: [developer, agent, operator]
owner: storage
status: draft
visibility: internal
system: storage
feature: controller-contract
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

# Storage Management Controller And Inspector Slots

[Storage UI index](./index.md) · [Documentation index](../../index.md)

`StorageManagementController` separates state/actions from rendering. Supply it to [StorageStudioWorkspace](./storage-studio-workspace.md) or `StorageManagement`. Custom controllers can use a different app endpoint, but must preserve their own authoritative permission checks, async fencing and error handling.

Import controller/slot/pagination/operation types from `@zero/framework/components/storage`.

## State

| Group | Fields |
| --- | --- |
| Admission | `status: loading | ready | disabled | error`, `capabilities: StorageStudioCapabilities | null`; optional `busy`, `loading`, `error: string | null` |
| Current view | `view: drives | files`, `drives`, `files`, `selectedDrive`, `selectedFile` |
| Data access | Optional `currentPathAccess`, required `selectedFileAccess`; effective `StorageAccessCapabilities | null` |
| Navigation | `currentPath: string | null`, `breadcrumbs: { label, path: string | null }[]`; null path means root |
| Secondary data | `usage: DriveUsage | null`, `jobs: StorageStudioJobPresentation[]` |
| Controls | `filters`: search, owner, lifecycle, objectType, sortBy, sortDir |
| Page state | Optional `drivePagination`/`filePagination`: page, count, optional total, hasPrevious, hasNext |

Arrays are readonly presentation results. `StorageStudioJobPresentation` is the public alias for the frontend job display type; it is not the backend job record type. Progress is optional and the native projection estimates attempts, not exact byte progress.

## Commands

All controllers require search/owner/lifecycle/type/sort setters; `selectDrive`, `openDrive`, `selectFile`, `openFolder`, `openBreadcrumb`, `showDriveCatalog`, and `refresh`. Page-navigation methods are optional. Commands changing selection are synchronous; operation callbacks may return void or Promise<void>.

The optional operation map supports createDrive/upload/createFolder, download, renameDrive/renameFile, updateFileMetadata, move/copy/share/setFileVisibility, suspend/restore/deleteDrive/deleteFile. The UI omits unavailable actions and also checks capabilities. A controller must report its own asynchronous failures: action dispatch observes rejections to prevent browser unhandled promises, not to create a generic mutation success contract.

## Inspector Slots

Slots receive current selected data and replace one panel:

- `driveAccess(drive)`, `driveSettings(drive)`.
- `driveUsage(drive, usage)`, `driveJobs(drive, jobs)`.
- `filePreview(file)`, `fileAccess(file)`, `fileSharing(file)`.

A nullish return falls back to the built-in content because panel composition uses `slot?.(...) ?? fallback`. Return a real element if replacing a section; an empty fragment can intentionally suppress content. Slots do not expose a credentials or privileged service object.

## Capability Precision

Drive lifecycle and settings use `drive.control`. Data grant editing and durable file visibility use `drive.drive.access.canAdmin` or exact-object access. File mutation uses write, reads/downloads use read, upload/new-folder use current path write plus ready lifecycle. Do not substitute “member of administration organization” for either capability.

For legacy controllers omitting `currentPathAccess`, the action bar falls back to drive data access. Native controllers provide path access explicitly; null means unresolved/unavailable, not permission granted.

[Family index](./index.md) · [Composition hook](./use-storage-studio-management.md) · [Backend Studio editing](../../backend/storage/studio-editing.md) · [Permission model](../../backend/storage/permissions.md)

---
id: zero.frontend.storage.overview
type: index
audience: [developer, agent, operator]
owner: storage
status: draft
visibility: internal
system: storage
feature: index
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

# Storage Components And Hooks

Storage provides two ready-made integration levels: a managed-drive Studio control plane and the established drive/file management adapter. Both use Zero's authenticated SDK; neither grants authority by rendering a button.

[Frontend index](../index.md) · [Documentation index](../../index.md)

## Choose An Integration

| Need | Start with |
| --- | --- |
| Owner-aware provisioning, lifecycle and jobs under current Guardian scope | [StorageStudioManagement](./storage-studio-management.md) |
| A custom transport/controller with the same control-plane UI | [StorageStudioWorkspace](./storage-studio-workspace.md) and [controller contract](./controller-contract.md) |
| Existing `StorageManagement` integration without a Studio controller | [StorageManagement](./storage-management.md) |
| Focused drive/file screens | [StorageDriveList](./storage-drive-list.md), [StorageFileBrowser](./storage-file-browser.md) |
| Custom file-browser UI | [Browser/quota hooks](./storage-browser-hooks.md), [basic hooks](./storage-hooks.md) |
| Uploads or file previews only | [Dropzone](./storage-dropzone.md), [upload queue](./upload-queue-hooks.md), [preview](./storage-file-preview.md) |

A **control capability** permits drive provisioning or lifecycle management. A **data capability** permits reading, writing or administering a drive/path. They are separate: `drive.control.canManage` is not `drive.drive.access.canAdmin`. The owner choices `organization`/`personal` are logical scopes, not arbitrary database IDs or filesystem paths. See [backend provisioning](../../backend/storage/studio-provisioning.md) and [authority](../../backend/storage/studio-authority.md).

## Complete Feature Map

- Managed composition: [Studio wrapper](./storage-studio-management.md), [composition hook](./use-storage-studio-management.md), [SDK integration](./sdk-integration.md).
- Presentational pieces: [workspace](./storage-studio-workspace.md), [toolbar](./storage-studio-toolbar.md), [list](./storage-studio-list.md), [inspector](./storage-studio-inspector.md), [action bar](./storage-studio-action-bar.md), [pagination](./storage-studio-pagination.md).
- Established drive components: [list](./storage-drive-list.md), [detail header](./storage-drive-detail-header.md), [detail tabs](./storage-drive-detail.md), [settings](./storage-drive-settings-panel.md).
- ACL editors: [drive grants](./storage-drive-permissions-panel.md), [object grants](./storage-object-permissions-panel.md).
- Files: [browser](./storage-file-browser.md), [detail panel](./storage-file-detail-panel.md), [preview](./storage-file-preview.md), [preview hook](./use-storage-file-preview.md), [single-object hook](./storage-file-hooks.md).
- Uploads: [dropzone component](./storage-dropzone.md), [dropzone hook](./upload-dropzone-hooks.md), [queue hook](./upload-queue-hooks.md), [single-upload/basic hooks](./storage-hooks.md).
- Setup: [configuration](./configuration.md); prospective changes: [roadmap](./roadmap.md).

## Composition And Product Philosophy

Use `@zero/framework/components/storage` for the component/controller surface and `@zero/framework/react` for core hooks. Render beneath the app's provider. Server settings and live authority determine capabilities; the app chooses placement and can replace individual inspector slots or the entire UI. The native controller masks old scope data and fences stale async completions.

The established pattern is a compact search/filter toolbar, dense selectable list, right-hand inspector, and bottom action bar. Details and grants belong in the inspector; selection-specific operations belong in the action bar. This is an observed design pattern, not a promise that every legacy piece has identical controls.

Read [backend Storage](../../backend/storage/index.md) for byte persistence, quotas, isolation, public visibility and lifecycle semantics. Reading a browser profile does not disclose an adapter path or signing secret. A UI gate improves interaction; the backend remains the enforcement boundary.

This family is source-observed in the working documentation branch. It is not an installed-archive or browser accessibility certification.

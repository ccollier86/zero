---
id: zero.frontend.storage.storage-studio-toolbar
type: reference
audience: [developer, agent, operator]
owner: storage
status: draft
visibility: internal
system: storage
feature: storage-studio-toolbar
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

# StorageStudioToolbar

[Storage UI index](./index.md) · [Documentation index](../../index.md)

`StorageStudioToolbar({ controller, className? })` renders navigation, search, filtering, sorting and Refresh. It is presentational: each interaction delegates to the matching controller command.

```tsx
import { StorageStudioToolbar } from '@zero/framework/components/storage';
import type { StorageManagementController } from '@zero/framework/components/storage';

export function Toolbar({ controller }: { controller: StorageManagementController }) {
  return <StorageStudioToolbar controller={controller} />;
}
```

## Controls By View

Drive view displays the Storage heading, shared `DataTableControls`/`DataTableSearch`, owner filter when owner choices are not exactly one, and lifecycle filter. Owner values are all/organization/personal; lifecycle choices include ready, provisioning, degraded, suspended, restoring, failed, deleting and deleted.

File view displays Back to drives plus drive/path breadcrumbs. Search comes first; filters choose all/files/folders, server sort field and sort direction. Breadcrumb null path targets the drive root.

The search is the shared compact expanding table search, not an independent input variant. It uses 112px collapsed and 216px expanded widths, constrained to available width. Drive/file max lengths are 120/200; labels and placeholders change with view. The toolbar itself does not debounce or filter rows: [native hook](./use-storage-studio-management.md) owns that query behavior, while a custom controller may choose another supported data source.

Refresh is disabled during loading/busy work and spins during loading. Owner/lifecycle controls describe requested filtering; their presence cannot authorize a catalog or arbitrary owner scope.

## Compose

This component can be placed outside the full workspace if an app reuses the same controller. Do not render two unrelated search-state owners against one list or add a second browser client for toolbar requests. Pair with [list](./storage-studio-list.md) and [pagination](./storage-studio-pagination.md).

[Family index](./index.md) · [Controller contract](./controller-contract.md) · [Table controls](../data-controls/data-table/controls.md) · [Configuration](./configuration.md)

---
id: zero.frontend.storage.storage-studio-pagination
type: reference
audience: [developer, agent, operator]
owner: storage
status: draft
visibility: internal
system: storage
feature: storage-studio-pagination
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

# StorageStudioPaginationControls

[Storage UI index](./index.md) · [Documentation index](../../index.md)

`StorageStudioPaginationControls({ controller })` displays server-page navigation for drive catalog or folder results. It selects `drivePagination` in drives view and `filePagination` in files view, along with that view's optional previous/next callbacks.

The exact page contract is `{ page, count, total?, hasPrevious, hasNext }`. `page` is UI navigation position, not a decoded opaque cursor. An exact total is optional; when absent, the component displays only page and current item count. It never invents a last page/count query.

Controls are absent when no page state exists or neither previous nor next is possible. Buttons are disabled during pending work, unavailable directions, or missing callbacks. Native catalog pages use opaque cursor history; file pages use the folder result's next cursor and separate history. Filter/path/sort changes reset native navigation.

```tsx
import { StorageStudioPaginationControls } from '@zero/framework/components/storage';
import type { StorageManagementController } from '@zero/framework/components/storage';

export function Pages({ controller }: { controller: StorageManagementController }) {
  return <StorageStudioPaginationControls controller={controller} />;
}
```

Do not concatenate all cached files into a cursor page or use selection navigation as page navigation. A custom controller must keep page result membership/order separate from any shared cache, and discard older responses after query or authorization changes.

[Family index](./index.md) · [Controller contract](./controller-contract.md) · [Native composition](./use-storage-studio-management.md) · [Backend listing](../../backend/storage/objects.md)

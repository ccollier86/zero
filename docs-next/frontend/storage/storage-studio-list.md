---
id: zero.frontend.storage.storage-studio-list
type: reference
audience: [developer, agent, operator]
owner: storage
status: draft
visibility: internal
system: storage
feature: storage-studio-list
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

# StorageStudioList

[Storage UI index](./index.md) · [Documentation index](../../index.md)

`StorageStudioList({ controller, className? })` renders the current drive catalog or folder page as a dense selectable table. It consumes provided results and appends the controller's cursor-safe page controls; it does not query or locally re-page native server results.

## Drive View

Columns are Name, Owner, Status and Access; some columns hide at smaller widths. Clicking selects the drive. Double-click opens only a read-capable ready drive. Enter selects. Name edits use `InlineEditText`, current profile revision and `renameDrive`; they require control manage authority and an available operation.

The lifecycle badge is presentation of server state. A drive is not writable solely because the row exists or is selected.

## File View

Columns include Name, Type, Size and Updated with responsive visibility. Clicking selects; folders can open on double-click/Enter. Selected file name editing requires resolved exact-object write capability and an available `renameFile` operation. Other rows do not inherit the selected object's ACL.

Inline edits delegate a Promise-returning mutation, reload through controller.refresh and maintain navigation callbacks. App-specific controllers must preserve accepted/rejected mutation semantics; a resolved callback means the UI may consider the edit complete.

```tsx
import { StorageStudioList } from '@zero/framework/components/storage';
import type { StorageManagementController } from '@zero/framework/components/storage';

export function Catalog({ controller }: { controller: StorageManagementController }) {
  return <StorageStudioList controller={controller} className="min-h-0 flex-1" />;
}
```

## Empty And Loading States

Empty drive/folder states differ from no selected drive. Search emptiness is described as no matching results. Loading with no supplied rows uses a loading state; existing current-page rows need not be replaced by fabricated placeholders. The list owns no full-text index, virtualized infinite dataset or independent record cache.

Row keyboard and responsive implementations exist in source; this documentation pass has not certified every assistive-technology/browser combination.

[Family index](./index.md) · [Controller contract](./controller-contract.md) · [Pagination](./storage-studio-pagination.md) · [Action bar](./storage-studio-action-bar.md)

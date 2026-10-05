---
id: zero.frontend.storage.storage-drive-permissions-panel
type: reference
audience: [developer, agent, operator]
owner: storage
status: draft
visibility: internal
system: storage
feature: storage-drive-permissions-panel
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

# StorageDrivePermissionsPanel

[Storage UI index](./index.md) · [Documentation index](../../index.md)

`StorageDrivePermissionsPanel` manages drive-level data ACL grants. It is not a Guardian role-definition editor or Studio lifecycle-authority editor.

Props: required `driveId: string`; optional `canAdmin: boolean` (default false) and `onChanged(): void`. Without canAdmin it shows an explanation and does not request the permission list. The backend checks live authority for every read/write regardless of this prop.

```tsx
import { StorageDrivePermissionsPanel } from '@zero/framework/components/storage';

export function DriveAccess({ driveId, canAdmin }: {
  driveId: string; canAdmin: boolean;
}) {
  return <StorageDrivePermissionsPanel driveId={driveId} canAdmin={canAdmin} />;
}
```

## Grant Types

The form supports role, exact user ID and trusted policy-enabled auth property grants. Role options come from auth configuration, including declared roles. Property choices must have useInPolicies; arbitrary user metadata must not become a grant predicate. Grant levels are read/write/admin; frontend choices do not change how backend permissions compose.

Grant/revoke await useStorageActions. Successful changes refresh the list, notify onChanged and show success; failures use established storage frontend observability/toast presentation. Grant failure retains form input. Refresh and mutation pending disable duplicate UI interaction.

Existing grants are displayed separately from implicit owner/platform/public authority. A list with no explicit grants does not mean there is no effective access. Conversely, changing a Guardian role does not rewrite durable ACL grant records; evaluation uses current authority.

For folder/file scoped grants, use [object permissions](./storage-object-permissions-panel.md) so inherited grants cannot be revoked at the wrong level.

[Family index](./index.md) · [Basic permissions hook](./storage-hooks.md) · [Backend ACL semantics](../../backend/storage/permissions.md) · [Guardian roles](../../backend/guardian/rbac.md)

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
applies_to: ["2.2.1 development source with compact grant controls; not package-qualified"]
modes: [single-tenant, multi-tenant, guardian-enabled, storage-enabled]
reviewed_against:
  package: "@zero/framework"
  version: "2.2.1"
  commit: "95ba0578f6625fc4597a9ec6786ee1d3353f29cd"
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

Grant and revoke share a synchronous operation reservation for this panel, so
same-tick clicks cannot dispatch overlapping mutations before React paints the
pending state. The panel reads the normal authorization boundary under
AppProvider/ClientProvider. Target/scope replacement or loss/recovery of admin
capability starts a new form/operation lifetime, including A→B→A transitions.
Late success cannot refresh/toast/notify its successor or release the successor's
busy reservation. A rejected old request still emits a safe failure event for
its captured target, but does not display a stale toast. Unmount retires the
presentation lifetime; it does not roll back an already-accepted server write.
An `onChanged` exception is safely observed as a notification failure, not a
reason to classify an accepted grant/revoke as failed or send it again.

Existing grants are displayed separately from implicit owner/platform/public authority. A list with no explicit grants does not mean there is no effective access. Conversely, changing a Guardian role does not rewrite durable ACL grant records; evaluation uses current authority.

## Inspector Composition

The shared grant form adapts to its **pane width**, not the surrounding desktop
viewport. Grant type, Role/User ID/property target and Access level wrap into
readable controls in a narrow inspector without horizontal overflow. The action
is inline with the compact form rather than a separate full-size card.

Current grants are compact rows with type/access badges, truncated long targets
(the full value remains available through the row title), and individually
named revoke buttons. The list is a focusable, labeled scroll region bounded
to 20rem. Many grants scroll within that list instead of expanding the entire
workspace or pushing its anchored action bar offscreen. Refresh is an explicit
button labeled **Refresh grants**. These presentation changes do not alter
grant evaluation, backend authorization or existing public props.

For folder/file scoped grants, use [object permissions](./storage-object-permissions-panel.md) so inherited grants cannot be revoked at the wrong level.

[Family index](./index.md) · [Basic permissions hook](./storage-hooks.md) · [Backend ACL semantics](../../backend/storage/permissions.md) · [Guardian roles](../../backend/guardian/rbac.md)

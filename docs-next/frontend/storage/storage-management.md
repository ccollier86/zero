---
id: zero.frontend.storage.storage-management
type: reference
audience: [developer, agent, operator]
owner: storage
status: draft
visibility: internal
system: storage
feature: storage-management
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

# StorageManagement Adapter

[Storage UI index](./index.md) · [Documentation index](../../index.md)

`StorageManagement` preserves the established entry point while supporting a caller-provided native/custom controller.

```tsx
import { StorageManagement } from '@zero/framework/components/storage';

export function ExistingDriveScreen() {
  return <StorageManagement initialDriveId={null} />;
}
```

## Exact Selection Rule

When `controller` is supplied, the component renders `StorageStudioWorkspace` with that controller and optional inspector slots. It does not invoke the native hook. Without a controller, it renders its internal legacy adapter, using existing drive/object hooks. Enabling server Studio alone does **not** change this selection rule.

| Prop | Contract |
| --- | --- |
| `initialDriveId?` | `string | null`, legacy adapter starts files view if set; default null. |
| `onDriveChange?` | `(driveId: string | null) => void`, legacy adapter selection callback. |
| `controller?` | `StorageManagementController`; when present it owns all navigation/state, so the two legacy props above are not used. |
| `inspectorSlots?` | Passed to the workspace in controller mode. |
| `className?` | Wrapper/workspace class. |

The legacy adapter projects existing drive records into the modern list/detail/action-bar presentation. It does not acquire Studio owner policies, native lifecycle jobs or managed provisioning idempotency simply by using the same layout. Search/filter semantics are constrained by the established adapter's loaded drive/folder data. Native Studio is the choice for a policy-managed organization/person provisioning interface.

## Move To Native Studio Intentionally

```tsx
import { StorageStudioManagement } from '@zero/framework/components/storage';

export function ManagedDriveScreen() {
  return <StorageStudioManagement />;
}
```

That replacement requires server Studio enablement and declared/granted permissions. Keep permission enforcement on the backend; do not make browser “isAdmin” flags implement the new control plane.

Read [configuration](./configuration.md), [native wrapper](./storage-studio-management.md) and [backend Studio authority](../../backend/storage/studio-authority.md) before switching an existing screen. UI reuse is not a data migration or a silent runtime mode conversion.

[Family index](./index.md) · [Controller contract](./controller-contract.md) · [Workspace](./storage-studio-workspace.md)

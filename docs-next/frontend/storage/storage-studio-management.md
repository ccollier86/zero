---
id: zero.frontend.storage.storage-studio-management
type: how-to
audience: [developer, agent, operator]
owner: storage
status: draft
visibility: internal
system: storage
feature: storage-studio-management
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

# StorageStudioManagement

[Storage UI index](./index.md) · [Documentation index](../../index.md)

`StorageStudioManagement` is the simplest packaged entry into the owner-aware Studio workspace. It composes the native controller, editable inspector slots and hidden upload input. Use it when the server has Storage Studio enabled and Guardian supplies the current authority.

```tsx
import { StorageStudioManagement } from '@zero/framework/components/storage';

export function WorkspaceStorage() {
  return <StorageStudioManagement drivePageSize={50} filePageSize={100} />;
}
```

Place this screen beneath [AppProvider/ClientProvider](../sdk/index.md); do not create a second browser client or pass a user-selected tenant ID. [Backend configuration](../../backend/storage/configuration.md) owns enablement and permission policy.

## Props

| Prop | Contract/default |
| --- | --- |
| `enabled?` | Defaults enabled; `false` disables catalog/control-plane admission. |
| `initialDriveId?` | `string | null`; defaults null/catalog view. A nonempty ID initializes files view, but must resolve within current authority. |
| `drivePageSize?` | Default 50; finite values are floored/clamped to 1–100. |
| `filePageSize?` | Default 100; same bounds. |
| `onDriveChange?` | `(driveId: string | null) => void`; selection notifications, including returning to catalog. |
| `className?` | Workspace wrapper styling; existing theme tokens remain the default. |

There is no `tenantId`, provider credential, administrator bypass or arbitrary filesystem prop. The server capability response determines allowed owner choices, provisioning, quotas and public-read options.

## Behavior

The hidden file input uses the dropzone bindings; Upload opens it only for a ready drive and write-capable current path. The controller combines capability/catalog reads, folder results, effective access, usage, lifecycle jobs and mutations. Search is debounced by 200 ms, catalog search bounded to 120 characters and file search to 200.

The inspector uses the existing settings/drive grants/object grants components with distinct control/data checks. A failed or disabled Studio does not become a raw drive engine or silently fall back to unrestricted creation. Loading, errors and Retry render inside the workspace.

Changing Guardian scope clears selected drive/file/path state, masks stale results and resets cursor navigation. This is browser result ownership, not distributed cache invalidation or a substitute for backend revalidation.

## Customize

Use [useStorageStudioManagement](./use-storage-studio-management.md) and [StorageStudioWorkspace](./storage-studio-workspace.md) to preserve transport behavior while replacing inspector slots. Use [StorageManagement](./storage-management.md) only when deliberately selecting its legacy adapter or supplying a controller; that component does not automatically choose the native Studio hook.

[Family index](./index.md) · [Configuration](./configuration.md) · [SDK integration](./sdk-integration.md) · [Lifecycle semantics](../../backend/storage/studio-lifecycle.md)

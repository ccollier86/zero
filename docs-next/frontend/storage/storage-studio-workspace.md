---
id: zero.frontend.storage.storage-studio-workspace
type: reference
audience: [developer, agent, operator]
owner: storage
status: draft
visibility: internal
system: storage
feature: storage-studio-workspace
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

# StorageStudioWorkspace

[Storage UI index](./index.md) · [Documentation index](../../index.md)

`StorageStudioWorkspace` is the transport-free modern control-plane layout. It accepts an already composed controller; it does not fetch, create drives or resolve permissions itself.

```tsx
import { StorageStudioWorkspace } from '@zero/framework/components/storage';
import type { StorageManagementController } from '@zero/framework/components/storage';

export function StoragePresentation({ controller }: {
  controller: StorageManagementController;
}) {
  return <StorageStudioWorkspace controller={controller} />;
}
```

Props: required `controller`; optional `inspectorSlots` and `className`. All controller fields and slot callbacks are documented in [controller contract](./controller-contract.md).

## Layout

The workspace renders the shared compact toolbar, list/detail layout, selected-object inspector and bottom action bar. It uses theme tokens for background/borders/foreground and a minimum height of 36rem. Desktop proportions use a 3fr list and 2fr detail region with a 19rem detail minimum; responsive selection/back controls expose the same controller actions on smaller screens.

The list's page controls are separate from bottom record navigation. Previous/Next in the bottom action bar changes selection **within the supplied page**; the list's pagination changes the server page. Do not use the record bar as evidence of a total backend record count.

## States

Disabled status renders the unavailable state. An error alert shows controller.error and a Retry action calling refresh; it does not erase permission boundaries. Loading, empty and selection states are rendered by the focused children. The controller may retain useful current-scope values during some work, but must not retain prior-organization data.

Standalone presentation can be tested with an in-memory controller. Such rendering does not qualify the actual SDK, provider, permissions or deployed storage adapter. For a complete integration use [native composition](./storage-studio-management.md).

[Family index](./index.md) · [Toolbar](./storage-studio-toolbar.md) · [List](./storage-studio-list.md) · [Inspector](./storage-studio-inspector.md) · [Action bar](./storage-studio-action-bar.md)

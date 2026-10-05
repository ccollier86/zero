---
id: zero.frontend.storage.configuration
type: reference
audience: [developer, agent, operator]
owner: storage
status: draft
visibility: internal
system: storage
feature: configuration
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

# Storage UI Configuration

[Storage UI index](./index.md) · [Documentation index](../../index.md)

Frontend configuration selects composition and presentation. Server `storage`/`storage.studio` settings own actual enablement, owner policy, quotas, grants and signing. The component's props cannot override them.

## Server Prerequisites

```ts
import type { AppStorageConfig } from '@zero/framework/storage';

export const storage = {
  studio: {
    enabled: true,
    organizationDrives: true,
    personalDrives: false,
    publicAccess: { allowPublicDrives: false, allowPublicObjects: false },
    limits: { maxOrganizationDrives: 20 },
  },
} satisfies AppStorageConfig;
```

This is a configuration fragment, not a complete app. Merge it into the app's existing trusted configuration and declare/grant [Studio permission fragments](../../backend/storage/studio-permissions.md). Enabled does not mean every member can provision.

organizationDrives represents application-owned drives in single mode and active-organization drives in multi mode. personalDrives represents personal ownership within the app/active tenant; personalSelfService is separately controlled. Current physical isolation policy is shared-cas, not per-drive filesystem sandboxing. [Backend configuration](../../backend/storage/configuration.md) is authoritative for defaults, validation, secrets and standalone injection.

## Component/Hook Settings

| Setting | Owner |
| --- | --- |
| Native enabled/initialDriveId/page sizes/onDriveChange | [Studio wrapper/hook](./storage-studio-management.md) |
| Custom controller/inspector replacement slots | [Controller contract](./controller-contract.md) |
| Legacy adapter versus native composition | [StorageManagement](./storage-management.md) |
| Upload accept/size/count/path/overwrite/public/metadata | [Dropzone](./storage-dropzone.md); backend still enforces |
| Show default queue, labels or custom render prop | [Dropzone presentation](./storage-dropzone.md) |
| Current folder request search/type/sort/cursor/limit | [Basic hooks](./storage-hooks.md) |
| Preview support/bounds/retry | [Preview hook](./use-storage-file-preview.md); no arbitrary unsafe renderer switch |

Use the app's existing provider; standalone hook composition requires a ClientProvider or AppProvider in the browser. SSR returns safe unresolved/fallback values rather than server storage handles. A client-rendered capability response is a read model, not an authority certificate.

## Design And Placement

The default workspace uses shared search/control primitives and theme tokens. App className and inspector slots support composition; do not reach into private storage provider paths or duplicate auth transport. Scoped mounts must clear prior selections/results on organization or permission replacement.

For a developer-facing platform such as a workflow service, mount native Studio inside the current organization and choose the corresponding app roles. Administration-organization membership alone must not grant cross-organization data access; current live permissions and selected scope still apply.

[Family index](./index.md) · [Backend installation](../../backend/storage/studio-installation.md) · [Guardian control plane](../guardian/people-control-plane.md) · [SDK integration](./sdk-integration.md)

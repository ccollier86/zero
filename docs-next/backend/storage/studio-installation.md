---
id: zero.storage.studio-installation
type: how-to
audience: [developer, agent, operator]
owner: storage
status: draft
visibility: internal
system: storage
feature: studio-installation
maturity: supported
applies_to: ["2.1.1 source; new documentation under review"]
modes: [single, multi, application, organization, personal, shared-cas]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Enable The Adaptive Storage Studio

[Storage index](./index.md) · [Documentation index](../../index.md)

Studio is inert unless storage.studio.enabled is true.
Core authenticated file storage and optional managed-drive provisioning are
separate capabilities.

## Configuration

```ts
import type { AppStorageConfig } from '@zero/framework/storage';

export const storage = {
  studio: {
    enabled: true,
    organizationDrives: true,
    personalDrives: false,
    limits: {
      maxOrganizationDrives: 20,
      defaultDriveSizeBytes: 1024 * 1024 * 1024,
      maxDriveSizeBytes: 4 * 1024 * 1024 * 1024,
    },
  },
} satisfies AppStorageConfig;
```

The app must separately merge declared permission/role fragments and grant its
actors appropriate authority. Enabled does not mean every member can provision.

## Owner Modes

organizationDrives means org drives in multi mode and application drives in
single mode. personalDrives enables user ownership inside the active app/tenant;
personalSelfService additionally permits eligible self-service and requires
personalDrives.

At least one owner mode is required when Studio is enabled.
Current only isolation is shared-cas; adapter safety/isolation must pass.

## Capabilities

The server returns scopeKind, ownerChoices, catalog/provision/manage/delete
booleans and safe policy ceilings. Frontend components adapt from that read
model; apps choose where to mount them or may build their own UI.

Capability data controls presentation, not server authorization.
Scope/permission/config changes retire cached capabilities and pending results.

Normal managed installation supplies system sidecars/lifecycle workers.
Existing legacy drive rows aren't automatically assigned a new managed profile
by matching a name.

See [permissions](./studio-permissions.md),
[provisioning](./studio-provisioning.md), [authority](./studio-authority.md),
[configuration](./configuration.md) and [client integration](./client-integration.md).

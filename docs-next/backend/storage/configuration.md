---
id: zero.storage.configuration
type: reference
audience: [developer, agent, operator]
owner: storage
status: draft
visibility: internal
system: storage
feature: configuration
maturity: supported
applies_to: ["2.2.1 development source; package qualification pending"]
modes: [single, multi, application, organization, personal, shared-cas]
reviewed_against:
  package: "@zero/framework"
  version: "2.2.1"
  commit: "95ba0578f6625fc4597a9ec6786ee1d3353f29cd"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Storage Configuration Reference

[Storage index](./index.md) · [Documentation index](../../index.md)

## Managed App

storageDir defaults .storage and owns the local byte root.
It must not overlap database/control/build output roots.
AppStorageConfig options:

| Setting | Default / precedence |
| --- | --- |
| signingSecret | explicit, ZERO_STORAGE_SIGNING_SECRET, retained random system secret |
| defaultPresignedTTL | 3600 positive integer seconds |
| studio.enabled | false |
| studio.organizationDrives | true |
| studio.personalDrives | false |
| studio.personalSelfService | false; requires personalDrives |
| studio.isolation | shared-cas only |
| studio.defaultGrants | empty role/user/property read/write/admin declarations |
| studio.maxCapabilityTTL | defaultPresignedTTL; default TTL may not exceed it |
| studio.publicAccess.allowPublicDrives | false |
| studio.publicAccess.allowPublicObjects | false |

Property default grants require grantKey; role/user grants may not use it.
Duplicate grants and unknown/malformed keys fail admission.
Enabled Studio needs at least one owner mode.

Both `publicAccess` booleans are opt-in publication ceilings, not default
visibility. `allowPublicDrives: true` requires `allowPublicObjects: true` because
public drives expose their existing/future objects. Object-only publication may
be enabled while drives remain private. Use [public-read configuration and UI
guidance](./public-access.md#studio-ceilings) for an exact module and drive/file
examples. Anonymous writes/ACL edits remain forbidden; disabling publication
does not prevent an authorized administrator from clearing an existing public
flag. Restart after changing the captured server configuration.

## Studio Limits

| limits field | Default |
| --- | --- |
| maxOrganizationDrives | 100 positive |
| maxPersonalDrivesPerUser | 10 positive |
| maxObjectsPerDrive | 0 unlimited |
| defaultDriveSizeBytes / defaultFileSizeBytes | 0 unlimited |
| maxDriveSizeBytes / maxFileSizeBytes | 0 no upper bound |
| maxConcurrentUploadBytes | 0 unlimited per drive |

Byte/object limits are non-negative safe integers. Bounded defaults fit maxima;
file size fits the corresponding bounded drive size.
Zero never means “no permitted bytes.” See [quotas](./studio-quotas.md).

## Standalone StoragePluginConfig

db required; adapter optional local; localDir defaults .storage.
signingSecret/defaultPresignedTTL/normalized studio follow the owning policy.
runtime binds app-local resources; getTokenService/authorization/getUserProperties/
isPolicyTrustedProperty/getAuditService inject current Guardian dependencies.
studioLifecycleProvider and timeout inject explicit idempotent continuation hooks.
onServiceCreated is a trusted composition callback, not a client grant.

The low-level StorageService constructor takes metadata db, adapter and options:
uploadGrantSecret, defaultPresignedTTL, isPolicyTrustedProperty, tenancyMode,
prepareCapability, uploadAdmission, managedObjectPolicy and aclAudit.
Those latter fences/policies are managed infrastructure, not values to fabricate
from request JSON. Prefer createApp's supplied scoped services.

## Read Time

Config is validated/captured on server setup; there is no generic env-backed
Studio policy or hot reload catalog. Browser capability projection omits signing
secrets/provider namespaces/physical paths.

See [composition](./composition.md), [adapters](./adapters.md),
[Studio installation](./studio-installation.md), [Studio permissions](./studio-permissions.md)
and [request authority](./request-authority.md).

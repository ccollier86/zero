---
id: zero.resources.configuration
type: reference
audience: [developer, agent]
owner: resources
status: draft
visibility: internal
system: resources
feature: configuration
maturity: supported
applies_to: ["2.1.1 source; new documentation under review"]
modes: [single, multi, shared-row, tenant-database]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Resource Configuration Reference

[Resources index](./index.md) · [Documentation index](../../index.md)

## App Composition

| App option | Default / meaning |
| --- | --- |
| resources | empty declaration array |
| serverResourcesDir | ./server/resources; false disables directory discovery |
| resourceRoutes | enabled generated CRUD; false disables those routes |
| resourceRoutes.prefix | /api/resources |
| resourceRoutes.defaultLimit | 100 |
| resourceRoutes.maxLimit | 1000 |

Disabling generated CRUD is not the same as disabling all HTTP data or Sync;
use explicit resource exposure for the transport boundary.

## Definition

table and policy are required. Name defaults to table; primaryKey is inferred
from the registered schema/typed table and cannot conflict.
Actions default to all five. Exposure/realm omission is accepted only for the
legacy single-tenant registry rules, not multi-tenant client-visible tables.

Tenant realm defaults to tenant_id in shared-row mode.
Physical tenant-database mode does not require/stamp that discriminator, but
the logical tenant declaration still matters.

Fields is optional. When declared, read is required; create/update default empty;
filter/sort default read and must not include hidden columns.
Policies are captured validated declarations, evaluated live per action.

## Permission And Ownership Options

ownerPolicy and guardianActorPolicy default create stamp and immutable true.
Membership attribution requires matching multi-tenant Guardian configuration.
metadataPolicy keys must be declared/trusted; authorizationPolicy uses the
normal Guardian AccessRequirement and explicit credential admission.

Standalone plugins must supply app-local registry, table declarations, auth
configuration and compatible data/authority services. Internal callback seams
marked for managed tenant binding are not browser-selectable adapters.

## Read Time And Diagnostics

Discovery executes trusted module code during server construction.
Registration validates schema/auth/topology relationships before publication.
Operation policy is live, not a one-time permission snapshot.

Use declared field/query limits and safe standard resource diagnostics.
The public registry globals are compatibility composition, not preferred
multi-app request state.

See [registry](./registry.md), [exposure](./exposure.md),
[realms](./realms.md), [Guardian integration](./guardian-integration.md) and
[queries](./queries.md).

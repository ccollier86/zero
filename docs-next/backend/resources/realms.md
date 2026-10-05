---
id: zero.resources.realms
type: how-to
audience: [developer, agent]
owner: resources
status: draft
visibility: internal
system: resources
feature: realms
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

# Declare Global And Tenant Data Realms

[Resources index](./index.md) · [Documentation index](../../index.md)

A resource realm is a logical data ownership boundary. It is not the same thing
as a Fabric realm module (schema/migrations/handler registry).

## Global

`globalRealm()` or `realm: 'global'` deliberately identifies shared application
data. Policy still controls access. “Global” does not mean anonymous public read,
platform-admin-only, or permission to read another tenant's private file.

## Tenant

`tenantRealm({ field? })` or `realm: 'tenant'` identifies organization-owned
data. The default field is tenant_id.

- Shared-row isolation requires that schema column and mandatory server-derived
  scope constraints/stamping.
- Tenant-database isolation binds the physical Fabric capability instead of
  requiring/stamping an extra discriminator column in each app table.

```ts
import { tenantRealm } from '@zero/framework/resources';
export const organizationRealm = tenantRealm({ field: 'organization_id' });
```

The custom field matters for shared-row storage. It does not let the browser
choose an organization or retarget its physical client.

## Admission And Enforcement

Multi-tenant client-visible app tables require explicit realm classification.
Legacy omission is limited to single-tenant admission. Managed transport realm
checks occur outside the app policy callback, so a permissive custom callback
cannot erase tenant isolation.

Tenant permission and row ownership are distinct. A Builder may operate inside
its own organization but still be forbidden to edit another member's record.
The Administration Organization is also a valid ordinary app workspace; its
platform powers are separately granted.

See [Fabric topology](../fabric/topology.md),
[Guardian authorization](../guardian/index.md),
[policies](./policies.md) and [field access](./field-access.md).
Do not equate a resource realm with an arbitrary filesystem name.

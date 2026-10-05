---
id: zero.resources.guardian
type: how-to
audience: [developer, agent]
owner: resources
status: draft
visibility: internal
system: resources
feature: guardian
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

# Use Live Guardian Authority In Resources

[Resources index](./index.md) · [Documentation index](../../index.md)

Resources use the same app-local authorization kernel and live subject as
route/service guards. Permissions do not come from request body properties,
a stale cached role label, or shallow FK anchors.

## Permission Policy

```ts
import {
  authorizationPolicy, defineResource, tenantRealm,
} from '@zero/framework/resources';

export const notes = defineResource({
  table: 'notes',
  exposure: 'all',
  realm: tenantRealm(),
  actions: ['list', 'get'],
  policy: authorizationPolicy({ tenant: 'required', permission: 'notes:read' }),
});
```

The app must declare notes:read with tenant scope. This example deliberately
enables only read actions. To expose writes, use an explicit per-action map
and stronger write permission rather than applying the read grant to all actions. See
[definitions](./definitions.md).

AccessRequirement supports the ordinary Guardian mode/tenant/permission/credential
contract. API-key admission is explicit in the requirement; possession of an API
key does not automatically satisfy legacy human-only policy inspection.

## Canonical Actor References

guardianActorPolicy declares userField and optionally membershipField. It stamps
and checks current canonical user/membership references, defaults to stamp
creation and immutable attribution, and validates multi-tenancy prerequisites
when a membership field is used.

A membership ID is not a user ID. Declare the matching
[Schema Guardian references](../schema/guardian-references.md) so the physical
SQLite FK has a minimal local anchor without copying profiles/credentials.

## Organization Kind

tenantKindPolicy admits explicit current server-owned organization kinds.
Use it only when a feature truly differs between administration/customer kinds,
not as a blanket customer-only restriction on ordinary app features.

Administration membership and application-scoped platform permission are
independent. App-only members of that organization can use explicitly granted
app resources; platform management still requires explicit live powers.

## Failure Behavior

Unavailable authorization services fail closed rather than falling back to
untrusted claims. Writes preserve credential ceilings/live revocation and
physical commit fences in managed Fabric mode.

See [Guardian](../guardian/index.md), [Fabric isolation](../fabric/tenant-isolation.md),
[field access](./field-access.md) and [Sync integration](./sync-integration.md).

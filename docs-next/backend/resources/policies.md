---
id: zero.resources.policies
type: how-to
audience: [developer, agent]
owner: resources
status: draft
visibility: internal
system: resources
feature: policies
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

# Choose Resource Policy Primitives

[Resources index](./index.md) · [Documentation index](../../index.md)

Policies return an allow/deny decision plus optional mandatory data constraints
and stamped input. Managed CRUD/query/Sync paths enforce those decisions;
a client-side gate is not a policy.

## Primitive Choices

| Helper | Contract |
| --- | --- |
| authenticatedOnly | Requires an authenticated user; no owner restriction |
| adminOnly | Checks legacy global user role admin, not every advanced platform permission |
| readOnly | Public list/get, all writes denied |
| publicReadUserWrite | Public reads, authenticated writes; no automatic ownership |
| ownerPolicy | User ID attribution/constraints, with controlled create stamping |
| metadataPolicy | Declared trusted user-property requirements |
| customPolicy | App callback, failing closed on thrown/rejected errors |

Public policy does not bypass a tenant realm's independent boundary. In advanced
RBAC prefer [authorizationPolicy](./guardian-integration.md), not an assumption
that every operator has the legacy global admin role.

## Owner Policy

```ts
import { ownerPolicy } from '@zero/framework/resources';
export const owned = ownerPolicy({
  userField: 'owner_id',
  create: 'stamp',
  immutable: true,
});
```

Create modes are stamp (default), require, or forbid; immutable defaults true.
Stamp derives the owner from authenticated server context. Require checks the
provided owner; it is not authority to impersonate another user.
Reads yield owner constraints, and row writes check matching ownership.
Use declared Guardian references for database FK existence.

## Trusted Metadata

metadataPolicy supports scalar equality, allowed values and operator forms
equals/in/not/exists. Registry validation requires known server-trusted user
properties. A self-editable browser profile flag must not become an admin grant.

## Custom Policy

```ts
import { customPolicy } from '@zero/framework/resources';
export const authenticated = customPolicy(({ user }) => user !== null, {
  name: 'example-authenticated',
});
```

Thrown/rejected evaluation logs safe standard metadata and becomes denial.
Callbacks may return structured constraints/stamps, but cannot override exposure,
realm, immutable identity or field admission. Broad true means a broad grant
within those boundaries; reviewers must assess the intended business rule.

See [composition](./policy-composition.md) and
[input validation](./input-validation.md).

---
id: zero.guardian.rbac
type: how-to
audience: [developer, agent]
owner: guardian
status: draft
visibility: internal
system: guardian
feature: roles-delegation-revisions-and-owner-protection
maturity: supported
applies_to: ["2.1.1 source; new documentation under review"]
modes: [single-simple, single-advanced, multi-simple, multi-advanced]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Configure Roles And Delegate Them Safely

[Guardian index](./index.md) · [Documentation index](../../index.md)

Advanced RBAC gives a user or membership multiple retained role assignments.
Permissions are declared in startup configuration; operators assign those
roles through live, revision-checked management APIs. Role definitions are
not arbitrary executable policy supplied by an untrusted browser.

## Declare The Registry

```ts
import { defineAuthConfig } from '@zero/framework/auth';

export const auth = defineAuthConfig({
  tenancy: 'multi',
  authorization: {
    mode: 'advanced',
    registryVersion: 1,
    permissions: {
      'documents:read': { scope: 'tenant', label: 'Read documents' },
      'documents:write': { scope: 'tenant', label: 'Edit documents' },
    },
    roles: {
      reader: { label: 'Reader', permissions: ['documents:read'] },
      editor: {
        label: 'Editor',
        permissions: ['documents:read', 'documents:write'],
      },
    },
  },
});
```

Registry version defaults 1. Permission scope defaults according to tenancy;
declare it explicitly for security-sensitive registries. Built-in permission
keys cannot be redefined. Non-system role templates may be customized within
the validated registry; protected owner authority is not a normal editable
role template.

In single/simple mode, the live global role supplies the compatibility
application role. In multi/simple mode, a membership holds one simple role
key. Do not submit a multi-role advanced assignment to a simple profile and
expect the server to arbitrarily choose one.

## Built-In Roles

Single advanced mode supplies protected `owner` and `access-manager`
(application role read/manage).

Multi mode supplies:

| Role | Intended authority |
| --- | --- |
| `member` | Read its tenant, member directory and role descriptors. |
| `manager` | Member authority plus membership, invitation, onboarding/join review and domain verification controls. |
| `administrator` | Administration-only template with bounded tenant and platform user/tenant/role/audit powers. |
| `access-manager` | Administration-only access delegation template. |
| `owner` | Protected all-permissions authority inside the actual scope. |

Manager is not owner. For example, domain release is deliberately not implied
by the manager's verify permission. “All permissions” remains scope-relative:
a customer owner does not acquire application platform powers.

Use capability/role descriptors returned by the management APIs instead of
hardcoding which checkboxes should appear for every actor.

## Assignment Boundaries

Roles with application-scoped permissions are administration-only in multi
mode. They can be assigned inside the Administration Organization, never a
customer organization. Tenant-only app roles can be assigned in either kind.

An Administration member can hold only an app role, only a platform role, or
both. Removing an app role removes its app permissions without manufacturing
platform authority. Removing a platform role leaves only the surviving app
role's authority, subject to session invalidation/re-authentication rules.

A delegating actor cannot grant beyond their own admitted ceiling. Possessing
`tenant.roles:manage` or `application.roles:manage` is necessary for the
management operation, not permission to assign arbitrary stronger roles.

## Use The Right Management Surface

Single advanced application assignments:

- `GET /auth/application/config` returns registry/capability context.
- `GET /auth/application/users` returns bounded users and retained role state.
- `PATCH /auth/application/users/:userId/roles` takes
  `{ roles, expectedRevision }`.
- `POST /auth/application/ownership/transfer` takes `{ userId }`.

Multi active organization assignments:

- `GET /auth/tenant/config` returns selected-scope capabilities and role choices.
- `GET /auth/tenant/members` returns memberships, retained roles and revisions.
- `PATCH /auth/tenant/members/:membershipId` takes
  `roles` and `expectedRoleRevision` alongside optional membership status.
- `POST /auth/tenant/ownership/transfer` takes `{ membershipId }`.

The generic profile `role` field is the global identity role, not the advanced
application/organization assignment list. Never update it to simulate tenant
roles.

## Revisions And Retained History

Fetch current role state before editing. Submit its revision with a replacement
so a stale editor cannot silently overwrite another operator's change.
On conflict, reload and let the user review the new assignment; do not blindly
retry the stale replacement with a freshly copied revision.

Retained role history may include assignments made under an older registry.
A role that is no longer valid for a tenant kind stays available to management
for cleanup but confers no live authority. Suspended/removed memberships can
likewise retain history without remaining authorized.

A successful assignment change bumps the appropriate authority generation.
Cached sessions, sync subscriptions and API keys must resolve the new authority;
they do not keep the old permission merely because a token's role snapshot
has not expired.

## Protected Ownership

The system owner marker is not grantable through normal assignment endpoints.
Ordinary replacement/removal cannot accidentally remove protected ownership.
Use the explicit transfer lifecycle, which validates both the current owner
and the eligible target in the same admitted scope.

A role-management permission alone does not make the actor an owner and cannot
authorize owner transfer. Global account deletion/suspension, membership
changes and last-owner guards also protect the installation from losing its
required administration authority.

For an existing single advanced installation, `ownerAdoption` requires exactly
one server-selected user ID or email. Multi advanced legacy simple-role
adoption is a separate explicit configuration switch. Neither is a runtime
“make me owner” API.

## Verification And Diagnostics

Test delegation ceilings, protected-owner replacements, revision conflicts,
unknown/retired roles, mixed Administration roles, customer rejection of
platform roles and revocation across HTTP/resources/sync/API keys. Read-only
role descriptors must agree with actual writes.

Assignment errors preserve `AUTHORIZATION_*` domain codes. Do not reinterpret
a role-scope error as a missing UI checkbox and bypass it with raw table writes.

## Related Guides And Next Steps

- [Configuration](./configuration.md) gives exact startup inputs and interactions.
- [Authorization](./authorization.md) attaches permissions to operations.
- [Tenant administration](./tenant-administration.md) manages memberships and status.
- [Control plane](./control-plane.md) manages the Administration Organization.
- [API keys](./api-keys.md) adds per-scope role eligibility without widening authority.

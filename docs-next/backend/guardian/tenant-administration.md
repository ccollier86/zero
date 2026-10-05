---
id: zero.guardian.tenant-administration
type: how-to
audience: [developer, agent]
owner: guardian
status: draft
visibility: internal
system: guardian
feature: selected-organization-member-management
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

# Manage A Selected Organization's Members

[Guardian index](./index.md) · [Documentation index](../../index.md)

The `/auth/tenant` surface manages the current session's organization.
Its request schemas contain no target tenant selector: the server derives the
tenant from live admitted authority. This is appropriate for customer managers
and for ordinary membership management inside the Administration Organization.

## Capability Projection

`GET /auth/tenant/config` returns tenancy/authorization mode, terminology,
tenant identity/kind, actor membership, effective roles/permissions,
capabilities and role descriptors.

Capabilities distinguish member read/manage, role read/manage, owner transfer,
invitations and join-request review. Role descriptors identify protected system
roles, administration-only roles, assignability and the actor's grantability.
Use these to adapt controls; a hidden button must still have backend enforcement.

## List And Add Members

`GET /auth/tenant/members` supports bounded `limit` (1–100), opaque `cursor`,
`search` (up to 120 characters), and status active/suspended/removed.
Use returned pagination rather than requesting an unlimited canonical user list.

`POST /auth/tenant/members` takes an existing account's canonical email and
optional `roles`:

```http
POST /auth/tenant/members
Authorization: Bearer <selected organization session>
Content-Type: application/json

{"email":"builder@example.test","roles":["editor"]}
```

Member creation requires `tenant.members:manage`. Non-default role choices
also require `tenant.roles:manage` and the delegating actor's grant ceiling.
An Administration add requires an explicit eligible role selection; app-only
roles are eligible there as well as administration-only roles.

This endpoint adds an existing identity. To onboard someone who has no account,
use [invitations](./invitations.md), not a fabricated user ID.

## Update, Suspend And Remove

`PATCH /auth/tenant/members/:membershipId` accepts:
`status: 'active' | 'suspended'`, `roles`, and
`expectedRoleRevision` for role replacement. At least a status or role change
must be supplied; an empty update returns `TENANT_MEMBER_UPDATE_EMPTY` (422).

Simple mode preserves its single-role contract. Advanced customer replacement
may intentionally remove non-owner roles; Administration role semantics and
protected-owner guards remain stricter. Fetch the current returned role
revision before editing, and handle stale revision conflicts by reloading.

`DELETE /auth/tenant/members/:membershipId` removes membership authority while
retaining required history. It does not delete the canonical account, its other
memberships, or the tenant's application records.

Suspension/removal invalidates live membership authority and relevant
credentials/subscriptions. Reactivating a membership is not permission to revive
an already-revoked credential family.

## Transfer Ownership

`POST /auth/tenant/ownership/transfer` takes `{ membershipId }`.
The actor must be the live owner, not merely hold a role-management permission.
The target must be an admitted eligible member in that same organization.

Normal role replacement cannot assign/remove the protected owner marker.
Self/last-owner and Administration continuity guards remain enforced throughout
status, removal and account-level operations.

## Administration Versus App Roles

The Administration Organization accepts ordinary tenant/app roles and
application-authority roles. Its app-only members are not platform operators.
Customer organizations reject application-authority roles, even when a caller
can manage their customer members.

Platform operators managing a different organization use
[the explicit platform control plane](./control-plane.md), not an extra tenant
field on this route.

## Verification And Presentation

Test directory pagination, default/non-default add, unknown email, stale revision,
delegation ceiling, owner transfer, suspension/removal, app-only Administration
members and customer rejection of platform roles. Invalidate detail/selection
state on an authorization boundary so a delayed response cannot repopulate the
previous organization's editor.

Use domain errors and actor-dependent capabilities to explain disabled actions.
Do not expose password/security recovery controls as ordinary tenant actions;
those are canonical platform-user powers.

## Related Guides And Next Steps

- [Configuration](./configuration.md) gives exact startup inputs and interactions.
- [RBAC](./rbac.md) explains revision replacement and grant ceilings.
- [Control plane](./control-plane.md) manages Administration and other customer organizations.
- [Invitations](./invitations.md) adds accounts that do not yet exist.
- [API keys](./api-keys.md) separates user eligibility from actor issuance authority.

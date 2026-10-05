---
id: zero.guardian.control-plane
type: architecture
audience: [developer, agent]
owner: guardian
status: draft
visibility: internal
system: guardian
feature: platform-identity-and-administration-organization
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

# Operate The Application Control Plane

[Guardian index](./index.md) · [Documentation index](../../index.md)

The application control plane manages canonical users and, in multi mode,
customer organizations. It is distinct from ordinary app workspace access.
Guardian's Administration Organization lets the same membership carry app
roles and explicit platform roles without treating every member as a superuser.

## Owner And Administration Scope

Single/simple mode retains global administrator account controls.
Single/advanced mode has a protected application owner and application-role
assignments. Multi mode bootstraps a protected Administration Organization
and its owner membership.

That organization has its own ordinary application data realm. Its members
can use app features like customer members when granted the app's tenant
permissions. Platform permissions are additional authority, not a requirement
for ordinary app use.

| Membership | App workspace authority | Platform authority |
| --- | --- | --- |
| Customer owner | Owner authority in its customer workspace. | None from ownership alone. |
| Administration app-only role | Only the granted Administration app permissions. | None from membership alone. |
| Administration platform role | Granted tenant/platform permissions in that role. | Explicit live application permissions. |
| Administration mixed roles | Union of admitted role permissions, each in its scope. | Explicit live application permissions. |
| Protected Administration owner | Protected owner authority in the Administration realm. | Protected application administration authority. |

“Administration organization” does not mean every member can inspect another
tenant's data. Platform directory/member-management operations are explicit
and do not silently rebind general application services to a chosen tenant.

## Discover Capabilities Before Rendering Controls

`GET /auth/platform/config` is the multi-mode platform-control projection.
It includes Administration identity, actor-dependent capabilities, roles and
customer-role choices. Typical capabilities distinguish reading/managing
members, invitations, tenants and customer memberships, plus owner transfer.

A role descriptor being present in the registry does not mean the actor may
grant it. Honor `assignable`, `grantable` and system/protected flags.
An app-only Administration member must not receive platform controls simply
because their active tenant has kind administration.

The packaged user/org control plane can adapt to those capabilities; placement
is the application developer's choice. Use one coherent selection/detail/action
surface rather than attaching unrelated administrative powers to every account
card.

## Multi Platform API Map

Below `/auth/platform`:

| Resource | Supported operations |
| --- | --- |
| `/members` | List/add Administration members. |
| `/members/:membershipId` | Update status/roles or remove a member. |
| `/ownership/transfer` | Transfer protected Administration ownership. |
| `/invitations` | List/issue Administration invitations. |
| `/invitations/:invitationId` | Revoke an invitation. |
| `/tenants` | List/create customer organizations. |
| `/tenants/:tenantId` | Update a customer's name/status. |
| `/tenants/:tenantId/members` | List/add that customer's members. |
| `/tenants/:tenantId/members/:membershipId` | Update/remove a customer's membership. |
| `/tenants/:tenantId/ownership/transfer` | Transfer that customer's owner through the platform ceremony. |

Member and role writes require the corresponding explicit live permissions.
Creating a customer organization also requires a selected canonical owner
account. Do not fabricate a membership by passing a tenant selector to an
ordinary endpoint.

The generic canonical-account surface remains `/auth/admin/users`, with
profile, suspension, password recovery and MFA actions described in their
focused guides. It is not the selected organization's member directory.

## Canonical Accounts Versus Memberships

An account may belong to several organizations. Suspending the canonical
account blocks its authentication everywhere; suspending one membership removes
authority only in that organization. Removing a membership does not delete
the canonical account or every other organization's membership.

Deletion is protected by account/owner and retained-tenant-history guards.
Historical memberships and audit references can require retaining the identity
rather than deleting its row. Do not convert a refused delete into direct
SQL deletion of system tables.

Changes that alter the account's authentication boundary revoke its tokens.
Role changes and membership/tenant status changes invalidate the associated
scope generation. Management services recheck actor authority at commit, not
only when the UI loaded.

## Existing Installation Adoption

`authorization.ownerAdoption` is single/advanced only and selects exactly one
`userId` or `email` for deliberate adoption. Multi
`tenancy.administration.adoptTenantId` selects an existing server-owned tenant
for protected administration adoption under the reconciliation guards.

These options are controlled deployment changes, not browser defaults or an
automatic legacy-mode migration. Changing tenancy does not automatically
convert existing app records or owner foreign keys.

## Verification And Observability

Exercise owner protections, app-only Administration members, mixed role grants,
delegated ceilings, customer platform-role rejection, membership-only versus
global suspension, customer owner transfer and authority loss during an awaited
operation. Keep operational/audit actor and target IDs distinct.

Use Guardian domain errors and standard auth observability, not raw exception
text that can expose identity/credential state. [Audit](./audit.md) describes
retained control-plane evidence.

## Related Guides And Next Steps

- [Configuration](./configuration.md) gives exact startup inputs and interactions.
- [RBAC](./rbac.md) defines role delegation and protected assignment behavior.
- [Tenant administration](./tenant-administration.md) is the selected-org surface.
- [Password recovery](./password-recovery.md) and [MFA](./mfa.md) define canonical account recovery.
- [Service boundaries](../../concepts/service-boundaries.md) prevents a management permission from becoming an unscoped data bypass.

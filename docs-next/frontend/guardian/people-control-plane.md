---
id: zero.frontend.guardian.people-control-plane
type: reference
audience: [developer, agent]
owner: guardian
status: draft
visibility: internal
system: guardian
feature: adaptive-account-and-membership-management
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

# Adaptive People And Organization Control Plane

[Guardian frontend index](./index.md) · [Documentation index](../../index.md)

`UserManagement` is the packaged adaptive control plane: a list, selected-record
detail pane and bottom action bar, not a set of disconnected page-sized action
cards. It changes its account/access context using public server configuration
and current authority. `PlatformUserManagement` is the same component under an
explicit platform-oriented name.

Import these from `@zero/framework/react`. The underlying canonical account,
membership and platform authority contracts remain in
[Guardian's backend control plane](../../backend/guardian/control-plane.md).

## Choose One Control Plane First

```tsx
import { UserManagement } from '@zero/framework/react';

export function PeoplePage() {
  return <UserManagement className="h-full" pageSize={25} />;
}
```

With self-wired data the component chooses:

| Config/current scope | Experience |
| --- | --- |
| Single tenant, simple permissions | Canonical identity/account management. |
| Single tenant, advanced RBAC | Identity management plus selected-user application roles/permissions and ownership. |
| Multi tenant, ordinary organization | Active organization memberships/roles; global account augmentation only with separate authority. |
| Multi tenant, Administration Organization | One control plane with People/Workspaces and Administration/Identities navigation where permitted. |
| Config pending/error or no selected organization | Explicit loading/unavailable state; no guessed mode. |
| Explicit `data` supplied | Controlled identity manager, intentionally preserving its established contract in every profile. |

Administration membership is not enough to show every platform action.
Identities navigation requires `application.users:read`. Workspaces navigation
requires `application.tenants:read`, or tenant-management plus identity-read
authority for choosing an initial owner. The server rechecks every request.

Within Administration, organization members can carry ordinary app roles,
platform roles or both. Role controls must preserve that distinction; see
[RBAC](../../backend/guardian/rbac.md).

## UserManagementProps

The adaptive public prop type includes:

| Group | Props |
| --- | --- |
| Presentation | `className?`, `pageSize?`, `roleOptions?: readonly UserRoleOption[]` |
| Controlled identity data | `data?: UserManagementUser[]`, `config?: AuthAdminConfig | null` |
| Controlled mutations | `onCreate`, `onUpdate`, `onDeleteProperty`, `onDelete` |
| Identity details/actions | `additionalDetailContent(user)`, `additionalNavigationActions(user | null)`, `onSelectedUserChange(user | null)` |
| Tenant details/actions | `additionalTenantMemberDetailContent(member)`, `additionalTenantMemberNavigationActions(member | null)`, `onSelectedTenantMemberChange(member | null)` |
| Initial platform navigation | `defaultManagementView: 'people' | 'workspaces'` (people), `defaultPeopleScope: 'administration' | 'identities'` (administration) |
| Actor lifecycle | `onActorSessionInvalidated?`, `onActorAuthorizationChanged?` |

Identity extensions apply to identity-backed modes; tenant extensions apply to
membership-backed modes. Supplying an identity extension does not implicitly
make it run for an organization membership record.

Use detail extensions for contextual information or editable role/property
panels. Use navigation extensions for compact commands in the standard bottom
action bar. Do not create a second account directory to add one action.

Controlled handlers retain void-or-Promise compatibility:

- `onCreate(params)`: optional accepted `UserManagementCreateResult`.
- `onUpdate(userId, changes)`: optional accepted `UserManagementUser`.
- `onDeleteProperty(userId, key)`: optional accepted updated user.
- `onDelete(userId)`: void/Promise<void>.

When async, return the actual acceptance promise. The component cannot await
work that a custom callback launches and then discards. Controlled mode owns
its data updates/permissions and custom security ceremony; it does not inherit
all self-wired security endpoints from rendering an account row.

## IdentityUserManagement

`IdentityUserManagement` explicitly chooses the canonical account manager using
the common props, plus `accountEditMode?: 'inline' | 'dialog'` (inline).
In multi mode this is a global account directory, not tenant role management.

The selected detail includes identity fields, canonical account status/properties
and available security status. The action bar can expose setup email, emailed/
manual reset, clearing password-change requirement, verification email/mark
verified, session revocation, suspension/reactivation and MFA requirement/reset.
Visibility depends on live capabilities, target/self status and delivery
readiness; it is not promised that every action always appears.

Self-targeting destructive/security actions are deliberately restricted.
Global-admin targets require the stronger global-admin capability. Live
multi-tenant identity deletion is not offered from the generic directory:
retained organization/invitation history needs the canonical lifecycle check,
so suspension is the safe packaged operation. This does not mean custom code
can bypass server history/owner guarantees.

## TenantMemberManagement And TenantScopedUserManagement

`TenantMemberManagement` is the active-tenant membership surface, imported
from `@zero/framework/components/auth`. Props are `className`, `pageSize`
(default25), `title`, `description`,
`onActorSessionInvalidated`, `detailContent(member)`,
`navigationActions(member | null)`, `secondaryPrimaryAction`,
`onSelectedMemberChange(member | null)`.

It uses a membership ID, not a global-user ID, for membership mutation. The
right pane displays membership roles/access; the bottom bar carries the allowed
add/remove/status/ownership actions. The server retains grant ceilings and
owner/last-owner guarantees even when a client manipulates controls directly.

`TenantScopedUserManagement` is public through `@zero/framework/react` and
accepts `TenantScopedUserManagementProps`, an alias of those props. It enriches
the same membership surface with global account detail/security actions only
when the actor has separate account authority. It also integrates the invite
action/dialog. Ordinary organization managers do not acquire app-wide password,
account deletion or global identity powers from this wrapper.

A self-role/status/removal or ownership operation may intentionally invalidate
the actor's session. The callback reports that outcome; do not convert it into
a new silent session with the old privileges.

## PlatformWorkspaceManagement

Import from `@zero/framework/components/auth`.
`PlatformWorkspaceManagementProps` supports `className`, `pageSize`
(default25, bounded by the component), `title`, `description`,
`selectedWorkspaceId?: string | null`,
`onSelectedWorkspaceIdChange(id | null)`, `memberDetailContent`,
`memberNavigationActions`, `onSelectedMemberChange`.

This directory handles customer workspaces while the actor remains in the
Administration scope. It does not switch the active application workspace or
expose a raw database selector. Read/create/status and customer-member controls
follow explicit platform capabilities. Selected member details can be augmented
in the same manner as the adaptable people view.

Selection is controlled only when the ID prop is defined; supply the change
callback to handle invalid/out-of-page selections and create-result selection.
Separate directory/member/mutation errors are retried at the correct surface.
An organization boundary change remounts the scoped control plane and retires
old selection/requests.

## Verification And Related Guides

Use each of the four Guardian profiles, an app-only Administration member, a
delegated platform operator and an ordinary organization manager. Confirm the
same layout adapts, allowed actions work, denied actions are absent/disabled,
and forced forbidden requests still fail server-side.

- [Management hooks](./management-hooks.md) provide the underlying custom-UI data/state contract.
- [Account management backend](../../backend/guardian/accounts.md) owns security/account mutations.
- [Tenant administration backend](../../backend/guardian/tenant-administration.md) owns role/member lifecycle.

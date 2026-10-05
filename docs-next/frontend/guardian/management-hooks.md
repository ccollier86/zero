---
id: zero.frontend.guardian.management-hooks
type: reference
audience: [developer, agent]
owner: guardian
status: draft
visibility: internal
system: guardian
feature: authority-bound-management-data
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

# Account, Application And Organization Management Hooks

[Guardian frontend index](./index.md) · [Documentation index](../../index.md)

Use these hooks for a custom control plane while retaining the standard client
transport, current-scope fences, capability loading and safe error reporting.
Import from `@zero/framework/react/hooks`, except `useAdminUsers`, which is
public through `@zero/framework/react`.

A hook's availability is not a permission grant. Read capability descriptors
and handle server rejection; don't infer platform powers from an organization
name. Backend contract owners are [accounts](../../backend/guardian/accounts.md),
[application RBAC](../../backend/guardian/rbac.md) and
[tenant/platform administration](../../backend/guardian/control-plane.md).

## useAdminUsers

`UseAdminUsersOptions`: `enabled` (true), `loadUsers` (true),
`pageSize`, `initialSearch`, `initialRole`, `initialStatus`.
Set `loadUsers: false` to obtain needed admin config without loading the
directory, such as a controlled identity component with omitted config.

`UseAdminUsersResult` provides `users`, `config`, `page`, `filters`,
`isLoading`, `error`; `setSearch`, `setRole`, `setStatus`;
`reload(): Promise<void>` and `loadPage(offset): Promise<void>`.
This is the canonical **offset** directory, not the tenant-membership cursor API.

Mutation methods await their SDK receipt:

- `createUser` returns `UserManagementCreateResult`
  (`user`, `setupEmailSent`).
- `updateUser`, `deleteUserProperty`, `suspendUser`, `activateUser`,
  `clearPasswordChangeRequirement`, `requireMfa`, `clearMfaRequirement`,
  `verifyEmail` return the accepted `UserManagementUser`.
- `deleteUser`, `sendPasswordReset`, `resetPassword`, `revokeSessions`,
  `sendVerificationEmail` complete void.
- `sendSetupEmail` returns whether setup email was sent.
- `getMfaStatus` and `resetMfa` return the SDK's MFA status/reset result.

`UserManagementUser` maps canonical account data into rows with `id`,
`userId`, names/email/username, global `role`, status/security flags,
properties and created/updated timestamps. `UserRoleOption` is
`{ value, label }`; a label is presentation, not declaration of a server role.

## useApplicationAccess

This hook is for **single-tenant advanced RBAC**. Options extend
`AuthApplicationUserListParams` without cursor plus `enabled?`
(search/status/limit). Result includes `isAvailable`, `isDenied`,
`config`, readonly `users`, `page`, `isLoading`, `isLoadingMore`,
`isMutating`, `error`, `reload()`, `loadMore()`.

`replaceUserRoles(userId, roles)` returns
`AuthApplicationRoleMutationResult`.
`transferOwnership(userId)` returns
`AuthApplicationOwnershipTransferResult`.
These results can indicate the actor's own authorization changed. Do not
preserve an old permission projection after ownership/self-role changes.
The hook masks previous-actor snapshots before new actor requests settle and
fences mutations before/after acceptance.

## useTenantMembers

Options extend `AuthTenantMemberListParams` without cursor:
`enabled?`, `limit?`, `search?`, `status?`.
The active tenant comes from the current completed session, not an option.

Result: `config`, `members`, `page`, `isLoading`, `isLoadingMore`,
`isMutating`, `error`, `reload(): void`, `loadMore(): Promise<void>`.

Methods `addMember(params)`, `updateMember(membershipId, params)` and
`removeMember(membershipId)` return accepted membership projections;
`transferOwnership(membershipId)` returns the ownership-transfer result.
The hook first loads current tenant administration capabilities; it does not
load members when read capability is denied. Cursor continuation is scoped to
that current query/tenant. Changed queries/identity/tenant retire stale loads
and mutation callbacks.

## usePlatformAdministration

This handles the protected Administration Organization's own members and
invitations, not the customer-workspace directory.

Options: `enabled`, `memberLimit`, `memberSearch`, `memberStatus`,
`invitationLimit`, `invitationStatus`.
Result includes `isAvailable`, `config`, `members/memberPage`,
`invitations/invitationPage`.

Prefer precise slice states over compatibility aggregates:

| Slice | State/retry |
| --- | --- |
| Config | `isLoadingConfig`, `configError`, `reloadConfig` |
| Members | `isLoadingMembers`, `isMutatingMembers`, `membersError`, `reloadMembers`, `isLoadingMoreMembers`, `loadMoreMembers` |
| Invitations | `invitationPolicyStatus`, nullable `invitationsEnabled`, `invitationDelivery`, `invitationConfigError`, `isLoadingInvitations`, `isMutatingInvitations`, `invitationsError`, `reloadInvitations`, `loadMoreInvitations` |

Aggregate `isLoading/isMutating/error/reload` remains available. Unresolved
public invitation policy is not enabled. Add/update/remove methods return
`AuthTenantMemberMutationResult`; ownership returns its transfer result.
`issueInvitation` returns the issued invitation result, and
`revokeInvitation` returns the retained invitation projection.
Capabilities remain operation-specific.

## usePlatformTenants

This is the customer-organization directory from Administration.
Options extend `AuthPlatformTenantListParams` without cursor plus
`enabled`, `selectedTenantId`, `memberLimit`, `memberSearch`,
`memberStatus`.

Result separates `tenants/page`, `selectedTenant`,
`selectedTenantMembers/selectedTenantMemberPage`, directory/member loading
and pagination, mutation state and three errors:
`directoryError`, `selectedTenantMembersError`, `mutationError`.
The compatibility `error` aggregates them; custom UI should show/retry each
where it belongs. Use `reloadDirectory`, `reloadSelectedTenantMembers`,
`clearMutationError` or overall `reload` appropriately.

Methods: `createTenant`, `setTenantStatus`, `addTenantMember`,
`updateTenantMember`, `removeTenantMember`, `transferTenantOwnership`.
Customer-member methods require both explicit target tenant ID and membership
ID as relevant, checked by the protected platform service. Target selection
does not change the actor's active application tenant or grant access to its
ordinary data.

## useTenantOnboardingAdministration

Options: `enabled`, `limit`, `invitationStatus`, `joinRequestStatus`.
Result includes `config`, `invitations/invitationPage`,
`joinRequests/joinRequestPage`, aggregate loading/mutation/error and distinct
public-policy/protected-config/invitation/join-request states.

Feature-enabled flags `invitationsEnabled` and `joinRequestsEnabled` are
nullable until policy resolves. Permission-denied, disabled, loading and failed
are different states. Precise fields include:
`authConfigStatus/authConfigError`,
`isLoadingConfig/isConfigPermissionDenied/configError`,
`isLoadingInvitations/isMutatingInvitations/isInvitationsPermissionDenied/invitationsError`,
and the corresponding join-request fields.

Use `reloadConfig`, `reloadInvitations`, `reloadJoinRequests` for targeted
retry; `loadMoreInvitations`/`loadMoreJoinRequests` for cursor continuation.
`issueInvitation`, `revokeInvitation`, `approveJoinRequest`,
`denyJoinRequest` await the canonical protected operation, then reconcile its
slice. Do not show generic “success” from launching an unawaited callback.

## Verification And Related Guides

Use synthetic accounts to verify capability denial, stale query responses,
organization switching mid-operation, cursor continuation and self-authority
changes. A pending count is UI state, not a global transaction lock.

- [Adaptive control plane](./people-control-plane.md) packages these interactions.
- [Authentication hooks](./auth-hooks.md) own human session transition state.
- [Authorization boundaries](../runtime/authorization-scope-boundary.md) explain cross-scope retirement.

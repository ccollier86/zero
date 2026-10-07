---
id: zero.frontend.guardian.sdk-surfaces
type: reference
audience: [developer, agent]
owner: guardian
status: verified
visibility: internal
system: guardian
feature: public-auth-service-facades
maturity: supported
applies_to: ["2.6.0"]
modes: [single-simple, single-advanced, multi-simple, multi-advanced]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "c5656b306051b04ec6adc641b7057a0672fd7a3e"
  snapshot: clean
  date: "2026-10-07"
  evidence_level: source-observed
---

# Public Client Authentication And Administration Facades

[Guardian frontend index](./index.md) · [Documentation index](../../index.md)

Use the configured framework `Client` for non-React application code, or
`useClient()` from `@zero/framework/react/hooks` inside the configured provider.
Client construction/lifecycle and typed HTTP belong to the
[frontend SDK](../sdk/index.md). This page owns its Guardian method families.

All mutation methods below return acceptance promises. They do not grant the
caller capabilities, and they reject server validation/authority failures.
Never turn a target user/membership/tenant ID into a fabricated browser session.

## State And Authorization

Client getters: `user: AuthUser | null`, `activeTenant: AuthTenantSummary | null`,
`isAuthenticated`, `sessionTransition`, `token: string | null`,
`authorization: AuthAuthorizationSnapshot | null`, `authorizationState`.

`getAuthorization()` ensures a current projection when absent;
`refreshAuthorization()` forces a live read;
`subscribeAuthorization(callback)` returns an unsubscribe function.
The projection has identity/profile/current scope, optional application scope
and opaque revision. It is sanitized UI guidance, not token verification or
a server principal. Read [authorization hooks/gates](./authorization-gates.md)
for React consumption.

`hasAuthorizationPermission(snapshot, permission)`,
`hasEveryAuthorizationPermission(snapshot, permissions)` and
`hasAnyAuthorizationPermission(snapshot, permissions)` are public through
`@zero/framework/react`. They check declared projected permission keys across
current scope/application scope; unknown keys fail closed even for an
all-permissions owner. Empty all/any lists return false.

Do not read `token` to build a parallel browser transport. Use the shared HTTP/
typed API path for restoration, refresh, replay and scope guarantees.
[HTTP integration](../sdk/http.md) owns that transport contract.

## Account Entry And Completion

| Client method | Input / result |
| --- | --- |
| `login(username, password)` | `Promise<AuthCompletionResult>`; inspect continuation versus session. |
| `register(params)` | `Promise<AuthRegistrationResult>`; email verification may be required. |
| `getAuthConfig()` | `Promise<AuthPublicConfig>`; public policy, never server secrets. |
| `forgotPassword(email, nativeContinuation?)` | Private/non-enumerating request completion. |
| `resendVerificationEmail(email, nativeContinuation?)` | Verification delivery request completion. |
| `inspectActionToken(token)` | `AuthActionTokenInfo`; action-kind/readiness inspection, not consumption. |
| `verifyEmail(token)` | `AuthCompletionResult`. |
| `resetPassword(token, newPassword)` | `AuthCompletionResult`. |
| `setupPassword(token, newPassword)` | `AuthCompletionResult`. |
| `changePassword(currentPassword, newPassword)` | Void completion for current-user mutation. |

`RegisterParams` requires username/email/password and optionally first/last
name, MFA enrollment request, validated native continuation, bootstrap secret,
organization name/slug. Only the server's current bootstrap/registration/
creation policy admits those choices.

`AuthUser` contains canonical account ID/names/email/global role/status,
password/email/MFA gates, string properties and timestamps; no password hash
or MFA secret. `AuthTenantSummary` contains ID/kind/slug/name/current simple
role summary, not the full advanced grant set.

The exported SDK guards `isAuthTenantSelectionRequiredResult`,
`isAuthTenantOnboardingRequiredResult`,
`isAuthEmailVerificationRequiredResult` and
`isAuthProfileCompletionRequiredResult` distinguish completion shapes.
The email guard checks email-verification-required without a completed session.
The profile guard identifies required-profile completion without application
credentials; render its restricted flow rather than treating `user` alone as a
completed sign-in.
These are type guards, not security verification of arbitrary JSON.
The auth component barrel has its separately named UI guards documented in
[authentication flows](./authentication-flows.md).

## Own Profiles, Contacts, Avatars And Presence

The adaptive-profile source adds `client.userProfile` (`auth.profile`),
`client.userContacts` (`auth.contacts`), `client.userAvatar` (`auth.avatars`) and
the SDK-owned `client.presence`. Use their real typed transports through the
current provider rather than copying tokens into a parallel fetch helper.
These own-account facades do not accept arbitrary target identities for writes.

`client.userProfileCompletion` / `auth.profileCompletion` uses the restricted
in-memory first-use proof before a general session exists. It may hand off to
tenant/native continuation rather than directly complete sign-in; mandatory
email/MFA ceremonies precede profile completion.

Exact methods and limits live in [profiles](../../backend/guardian/user-profiles.md),
[contacts](../../backend/guardian/contacts.md), [avatars](../../backend/guardian/avatars.md),
[presence](../../backend/guardian/presence.md) and
[required completion](../../backend/guardian/profile-completion.md).
The [packaged settings component](./profile-settings.md) composes them with
accepted drafts and current server readiness. Older installed packages need an
actual framework upgrade to obtain these Zero 2.6 contracts.

## MFA And Session Operations

`listMfaMethods()` returns `{ methods, required }`.
`startMfaSetup({ setupToken?, method, label? })` returns the setup start result.
`verifyMfaSetup({ verificationToken, code })` returns setup verification result.
`verifyMfaChallenge({ challengeToken, code })` returns account completion.
Methods are `email`/`totp`; available readiness and policy stay server-owned.

`logout()`, `refresh()` and `reconcileAuthSession()` complete void at the
high-level Client facade. Reconciliation retries the local baseline of an
already-committed session; it is not another login/switch.
`setProperty(key, value)` and `deleteProperty(key)` complete void;
`getProperty(key)` returns string/null and `getProperties()` returns the
string map. Writer policy still applies.

## Active-Tenant Entry And Memberships

| Method | Result / boundary |
| --- | --- |
| `selectTenant(continuation, tenantId)` | Tenant-bound `AuthSessionResult` after identity proof. |
| `listTenants()` | `AuthTenantListResult` with activeTenantId/eligible summaries. |
| `createTenant(params)` | Owned tenant and activated `AuthSessionResult`. |
| `switchTenant(tenantId)` | Rotated tenant session backed by current refresh proof. |
| `getTenantAdministrationConfig()` | Current capabilities/role descriptors. |
| `listTenantMembers(params?)` | Membership cursor page. |
| `addTenantMember(params)` | `AuthTenantMemberMutationResult`. |
| `updateTenantMember(membershipId, params)` | Mutation result; role replacement uses expected revision. |
| `removeTenantMember(membershipId)` | Retained membership mutation result. |
| `transferTenantOwnership(membershipId)` | Owner transfer result, not ordinary role replacement. |

`AuthTenantMember` contains membershipId, safe identity, status, roles,
roleRevision and membership timestamps. Status is active/suspended/removed,
not canonical global account status. All operations use the active session
tenant; the platform namespace below is the separately authorized way to
target another customer tenant.

## Invitations, Join Requests And Domains

Invitation methods:
`inspectTenantInvitation(token)`,
`acceptTenantInvitation(params)`,
`listTenantInvitations(params?)`,
`issueTenantInvitation(params)`,
`revokeTenantInvitation(invitationId)`.
Acceptance can need account/MFA continuation. Issue can return a one-time manual
token. Revocation returns `{ invitation }`; it is not deletion of history.

Join methods:
`submitTenantJoinRequest(tenantSlug, continuation?)` returns
`{ submitted: true }`;
`listTenantJoinRequests(params?)` returns a cursor page;
`approveTenantJoinRequest(id, params)` and
`denyTenantJoinRequest(id, params)` return `{ request }`.
Acknowledgment deliberately does not disclose availability/grant membership.

Domain methods:
`getTenantDomainAdministration(signal?)`;
`createTenantDomainClaim(domain)`;
`issueTenantDomainChallenge(claimId, expectedRevision)`;
`verifyTenantDomainClaim(claimId, expectedRevision)`;
`updateTenantDomainPolicy(claimId, update)`;
`releaseTenantDomainClaim(claimId, input)`.
The create/challenge result can include DNS challenge material;
policy/release inputs retain expected revision and exact domain confirmation.

Onboarding proof:
`startDomainOnboarding(identityContinuation?)` returns accepted acknowledgment;
`completeDomainOnboarding(proofToken)` returns proved completion;
`admitDomainOnboarding(continuation, identityContinuation?)` returns admission.
The public client does not auto-grant membership from an email suffix.
Use [onboarding hooks](./onboarding-controls.md) to handle revisions/fences.

## Canonical Global Account Administration

The high-level Client implements `AuthAdminSdkSurface` using the exact
`AuthAdmin` names, not the lower-level class's abbreviated `Admin` names.

Read/config:
`getAuthAdminConfig`, `listAuthAdminUsers(params?)`,
`getAuthAdminUser(userId)`.
List uses offset/search/role/status/limit and returns users plus exact page.

CRUD:
`createAuthAdminUser(params)` returns `{ user, setupEmailSent }`;
`updateAuthAdminUser(userId, params)` returns accepted user;
`setAuthAdminUserProperty(userId, key, value)`,
`deleteAuthAdminUserProperty(userId, key)`,
`deleteAuthAdminUser(userId)` complete void.

Security:
`sendAuthAdminSetupEmail` returns boolean;
`sendAuthAdminPasswordReset`, `resetAuthAdminPassword(userId, password)`,
`revokeAuthAdminUserSessions`, `sendAuthAdminVerificationEmail` complete void.
`clearAuthAdminPasswordChangeRequirement`, `suspendAuthAdminUser`,
`activateAuthAdminUser`, `requireAuthAdminUserMfa`,
`clearAuthAdminUserMfaRequirement`, `verifyAuthAdminUserEmail` return user.
`getAuthAdminUserMfa` returns public-safe status;
`resetAuthAdminUserMfa` returns the reset counts/result.

These need explicit live account/global-admin authority as applicable, not
mere tenant-member-management permission. Creation/reset/email/override
features also depend on app configuration. Owner/history/self protection
remain server-enforced. See [account management](../../backend/guardian/accounts.md).

## Namespaced Scoped Control Planes

`client.applicationAdmin` (single/advanced) exposes
`getConfig`, `listUsers`,
`replaceUserRoles(userId, roles, expectedRevision)`,
`transferOwnership(userId)`.
Role mutation returns actorAuthorizationChanged; preserve the expected revision
from the current user projection and handle the actor refresh.

`client.platformAdmin` (Administration) exposes:
`getConfig`, `listMembers`, `addMember`,
`updateMember`, `removeMember`, `transferOwnership`,
`listInvitations`, `issueInvitation`, `revokeInvitation`.
It separately exposes `listTenants`, `createTenant`,
`updateTenant(tenantId, { status, expectedAuthorizationGeneration })`,
`listTenantMembers`, `addTenantMember`, `updateTenantMember`,
`removeTenantMember`, `transferTenantOwnership`.
Customer-target methods take explicit tenant ID plus target membership where
needed. Creation takes name/optional slug and existing initial-owner email.
Membership mutation results retain actorSessionInvalidated; customer owner
transfer preserves the Administration actor session.

`client.apiKeys` has `self`, `applicationAdmin`, `tenantAdmin`,
`platformAdmin` namespaces. All have rotate/revoke;
self has list/issue; applicationAdmin has listUser/issueUser; tenantAdmin has
listMember/issueMember; platformAdmin has directory list (optional tenant filter)
and listMember/issueMember with tenantId+membershipId.
Issue/rotation input is label/optional ttl; result is one-time
`{ apiKey, secret }`. Lists are secret-free capability-bearing cursor pages.
See [API-key UI](./api-key-controls.md) and [backend keys](../../backend/guardian/api-keys.md).

`client.audit` exposes `list(scope, query?)`, `export(scope, query?)`,
`prune()`. Prune is an explicit platform-authorized retention pass returning
deleted/hasMore, not a user-directed deletion of arbitrary security history.
See [audit controls](./audit-controls.md).

## Failures, Reconciliation And Related Guides

Use structured `AuthClientError` status/code for server rejection. Distinguish
a committed session whose local synchronization failed from a rejected
credential operation; [low-level client/error reference](./auth-client.md)
explains this recovery contract.

- [Management hooks](./management-hooks.md) reconcile accepted data for custom React UI.
- [Backend control plane](../../backend/guardian/control-plane.md) owns each authority boundary.
- [SDK HTTP](../sdk/http.md) owns shared authenticated request behavior.

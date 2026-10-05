---
id: zero.frontend.guardian.auth-client
type: reference
audience: [developer, agent]
owner: guardian
status: draft
visibility: internal
system: guardian
feature: low-level-account-controller-and-errors
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

# Lower-Level AuthClient And Auth Errors

[Guardian frontend index](./index.md) · [Documentation index](../../index.md)

Most apps should use the configured framework Client and
[public auth facades](./sdk-surfaces.md). The public `AuthClient` class is the
lower-level account/authorization controller used by that SDK, exported from
`@zero/framework/react`. Creating a second independent controller inside an
already-configured app can introduce competing restoration/coordination state.

## Construction And Ownership

`new AuthClient(baseUrl, options?)` creates focused transports plus session
and authorization controllers. Construction starts stored-session restoration.
Access tokens live in memory; refresh proof is managed/persisted/rotated by the
browser coordinator. This is a web client, not the credential vault API for a
native host.

`AuthClientOptions.authorizationScopeLifecycle` is the SDK-owned cache/
transport barrier contract: begin/complete/abort/reconcile transition plus
request epoch assertion and optional cancellation registration.
`authorizationRevalidationIntervalMs` controls browser hint revalidation;
zero disables polling. `browserAuthCoordination` is internal deterministic
environment injection, not an application “skip security” option.

`store` exposes the account store used for subscriptions. Read state rather
than mutating it to impersonate an identity. `subscribe(callback)` and
`subscribeAuthorization(callback)` return unsubscribe functions.
`dispose()` releases controller/coordinator listeners and polling; it does
not itself perform the remote logout ceremony.

## State And Method Differences

Getters: user, activeTenant, isAuthenticated, isLoading, isRestoring, error,
authenticationContinuation, sessionTransition, accessToken, authorization,
authorizationState. `authorizationScopeKey` is an internal opaque cache family,
not authority. `invalidateAuthorization` is internal cache retirement.

The account/MFA/tenant/domain/property families have the same method names and
result contracts as the public facade, except:

- Public `client.getAuthConfig()` delegates to `AuthClient.getConfig(signal?)`.
- Public `client.token` projects `AuthClient.accessToken`.
- Public `client.reconcileAuthSession()` delegates to `reconcileSession()`.
- Class `refresh(): Promise<boolean>` reports refresh outcome; the high-level
  facade's `refresh(): Promise<void>` hides that return.
- Canonical admin class methods omit the `Auth` segment:
  `getAdminConfig`, `listAdminUsers`, `getAdminUser`, `createAdminUser`,
  `updateAdminUser`, `setAdminUserProperty`, `deleteAdminUserProperty`,
  `deleteAdminUser`, `sendAdminSetupEmail`, `sendAdminPasswordReset`,
  `clearAdminPasswordChangeRequirement`, `resetAdminPassword`,
  `suspendAdminUser`, `activateAdminUser`, `revokeAdminUserSessions`,
  `getAdminUserMfa`, `requireAdminUserMfa`,
  `clearAdminUserMfaRequirement`, `resetAdminUserMfa`,
  `sendAdminVerificationEmail`, `verifyAdminUserEmail`.
  Inputs/results match [canonical facade operations](./sdk-surfaces.md#canonical-global-account-administration).

`clearAuthenticationContinuation()` clears in-memory UI continuation.
`expireSession()` locally retires the current session; it is not the same as
server revocation. Do not substitute it for logout/revoke operations.

## Authenticated Transport

`fetchWithAuth(url, init?)` resolves only against the configured server origin,
waits for active restoration, uses the shared authenticated retry path and
guards response consumption against a retired authorization scope.
`fetchWithOptionalAuth` allows public flow requests but waits for an active
stored-proof restoration instead of silently downgrading it to anonymous.
It honors an explicitly supplied Authorization header while otherwise attaching
the available account token.

`requestWithAuthTransport` is an internal extension for a non-fetch typed
transport to share those lifecycle guarantees. It is not a supported app
replacement for the standard SDK HTTP/typed API. Origin checking is not a
general open-proxy permission, and caller fetch options must not be used to
rebuild a credential-leaking cross-origin adapter.

## AuthClientError

`AuthClientError(message, status, code, body)` carries readonly HTTP
`status`, structured `code: string | null`, response `body: unknown`,
and `retryable` derived only from an explicit response retryable flag.
A network/origin failure can use status0; domain 4xx rejection is not
automatically retryable. Avoid dumping raw body/headers/passwords into logs.
Use [auth error presentation](./account-actions.md#auth-error-helpers).

## AuthSessionSynchronizationError

This public error means the **new session was committed**, but its local
scope/Sync baseline did not finish:

- `code = 'AUTH_SCOPE_SYNCHRONIZATION_REQUIRED'`.
- `recoverable = true`, `committed = true`.
- `operation` and `revision` identify the transition; cause retains local
  diagnostic context, not permission to replay credential issue.

Keep the accepted session and call the reconciliation method. Do not replay
registration, tenant creation or tenant switching just because local Sync
failed after commit; that can create duplicate operations or consume a
single-use proof. See [scope transition recovery](../runtime/scope-transitions.md).

## Verification And Related Guides

Use a configured SDK to verify restoration, same-origin request admission,
authorization refresh/revocation and a deliberately failed local reconciliation
after accepted session issue. Check that disposal stops polling/listeners.

- [Public facade](./sdk-surfaces.md) is the default app integration.
- [Native SDKs](../../backend/native-auth/index.md) use different credential-owning hosts.
- [Frontend runtime](../runtime/index.md) owns provider/cache lifecycle.

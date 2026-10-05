---
id: zero.frontend.guardian.auth-hooks
type: reference
audience: [developer, agent]
owner: guardian
status: draft
visibility: internal
system: guardian
feature: account-state-and-actions
maturity: supported
applies_to: ["2.1.1 source; new documentation under review"]
modes: [single-simple, single-advanced, multi-simple, multi-advanced]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Account State And Auth Hooks

[Guardian frontend index](./index.md) · [Documentation index](../../index.md)

Import these hooks from `@zero/framework/react/hooks`. They subscribe to the
framework client's Guardian controllers inside the configured frontend provider;
they do not install server auth or permit arbitrary tenant selection.
The [frontend runtime](../runtime/index.md) owns provider setup and shared
authorization boundaries.

## useAuth State

`useAuth()` exposes current account state and account actions:

| State member | Meaning |
| --- | --- |
| `user` | Current canonical `AuthUser | null`. |
| `activeTenant` | Current selected tenant projection, or null. |
| `isAuthenticated` | A completed authenticated account session exists. |
| `isLoading` | Restoration/transition loading visible to this hook. |
| `isRestoring` | The client is restoring its session. |
| `error` | Current account-action error string or null. |
| `authenticationContinuation` | Limited MFA/selection/onboarding result, not a completed app session. |
| `sessionTransition` | Current session transition state. |

An anonymous page can be ready without an authenticated session. Do not
replace an entire login/bootstrap page with a permanent “restoring” screen just
because a previous Sync reset incremented a revision. Shared boundaries clear
stale authenticated data while allowing a settled signed-out page.

Use [authorization hooks](./authorization-gates.md) for permission readiness;
`isAuthenticated` alone does not mean a permission projection or Fabric realm
is ready.

## Account Actions

The action names mirror the public client facade:

| Group | Hook actions |
| --- | --- |
| Entry | `login`, `register`, `getConfig` |
| Password/email actions | `forgotPassword`, `resendVerificationEmail`, `verifyEmail`, `inspectActionToken`, `resetPassword`, `setupPassword`, `changePassword` |
| MFA | `listMfaMethods`, `startMfaSetup`, `verifyMfaSetup`, `verifyMfaChallenge` |
| Organizations | `selectTenant`, `listTenants`, `createTenant`, `switchTenant` |
| Session | `logout`, `refresh`, `reconcileSession`, `clearAuthenticationContinuation` |
| User properties | `setProperty`, `getProperty`, `getProperties`, `deleteProperty` |

Nullable results are deliberate for SSR/no-current-client states; a known
auth-disabled client rejects managed-auth operations with the standard disabled
error. Async methods use the existing SDK transport. Captured callbacks are
checked before dispatch. Ordinary account actions also check after completion;
scope-changing actions such as login, logout and tenant switching intentionally
allow their own valid transition and rely on the SDK lifecycle. Preserve that
behavior by using the public hook rather than
rebuilding fetch, token refresh or callback authority in a component.

Login/register/password/MFA/selection actions may return a continuation rather
than a final session. Render the appropriate ceremony before enabling app
features; see [completion states](../../backend/guardian/sessions.md).
Do not equate a non-null result with authentication success.

## useAuthConfig

`useAuthConfig()` returns public policy only:

- `status`, `config`, `isLoading`, `error`.
- `canRegister`: the registration capability, not a guess from route names.
- `bootstrapRequired`: current first-owner setup state.
- `reload()`: reload the public policy controller.

The hook ensures current configuration on mount. It does not expose bootstrap
secrets, signing material or private provider settings. An initial browser
unknown/loading state is loading; SSR uses its safe snapshot. Configuration
loading/error should have an explicit UI state rather than silently presenting
registration as available.

## useCurrentUser And useRequireAuth

`useCurrentUser()` returns `useAuth().user`.

`useRequireAuth(redirectTo = '/login')` is a client navigation convenience. Once
loading settles, a signed-out user is redirected by history/PopState handling.
It does not protect server pages, resources or HTTP APIs. Configure server
protected pages independently, and keep authentication pages public.

## useUserProperty

```tsx
import { useUserProperty } from '@zero/framework/react/hooks';
import { useAsyncAction } from '@zero/framework/react';

export function TutorialPreference() {
  const preference = useUserProperty<boolean>('show_tutorial', {
    defaultValue: false,
    parse: raw => raw === 'true',
    serialize: value => String(value),
  });
  const update = useAsyncAction((next: boolean) => preference.setValue(next));
  return (
    <>
      <button disabled={preference.isLoading || update.pending}
        onClick={() => {
          // The action stores its rejected outcome; the event observes the Promise.
          void update.run(!preference.value).catch(() => {});
        }}>
        {preference.value ? 'Hide tutorial' : 'Show tutorial'}
      </button>
      {update.error ? <p role="alert">The preference could not be saved.</p> : null}
    </>
  );
}
```

`useUserProperty<T>(key, { defaultValue, parse?, serialize? })` exposes
`value`, `rawValue`, `isLoading`, `error`, `setValue`, `refresh` and
`remove`. Raw values are stored strings or null; absent values use the explicit
default. Parsing applies only to a present raw value, not to the default.
Mutations use the authenticated account-property methods and the configured
[writer policy](../../backend/guardian/user-properties.md). A UI preference
default is not persisted automatically and must not grant trusted authority.
The example uses the [async action hook](../hooks/state-and-actions.md) to retain
pending/error state and explicitly observes event-owned rejection.

## Loading, Failures And Verification

Treat action promises as complete operations. Await their result before
advancing the UI, catch safe failures, and do not call custom success handlers
after a scope change. A background authorization refresh and a session
restoration are different states.

Verify first load, settled signed-out state, login continuation, restored
session, tenant switching, account suspension and logout. A user-property
preference should survive the intended account change but must never leak a
previous account's value into a new one.

- [Authorization gates](./authorization-gates.md) cover ready permission checks.
- [Backend sessions](../../backend/guardian/sessions.md) define restoration/revocation.
- [Backend public configuration](../../backend/guardian/configuration.md) defines capabilities.

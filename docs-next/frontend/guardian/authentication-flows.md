---
id: zero.frontend.guardian.authentication-flows
type: reference
audience: [developer, agent]
owner: guardian
status: draft
visibility: internal
system: guardian
feature: login-registration-and-continuations
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

# Login, Registration And Authentication Continuations

[Guardian frontend index](./index.md) · [Documentation index](../../index.md)

Use the packaged forms for the default account flow, or compose the public
[auth hooks](./auth-hooks.md) with your own presentation. The packaged forms
adapt to public server policy; setting a UI prop cannot enable a server-disabled
operation. Imports below use `@zero/framework/components/auth`.

## Minimal Web Flow

```tsx
import { AuthLayout, LoginForm } from '@zero/framework/components/auth';

export function SignInPage() {
  return (
    <AuthLayout appName="Example">
      <LoginForm registerHref="/register" forgotPasswordHref="/forgot-password"
        onSuccess={() => window.location.assign('/app')} />
    </AuthLayout>
  );
}
```

Mount inside the configured frontend provider and keep login/register/recovery
routes public. Configure protected pages and the already-authenticated login
redirect on the server; see [login](../../backend/guardian/login.md).
The form's `onSuccess` does not automatically choose your destination.

## LoginForm

`LoginFormProps`:

| Prop | Default / effect |
| --- | --- |
| `onSuccess` | Called after completed login/continuation, not immediately after receiving an MFA/profile/tenant continuation. |
| `onPasswordChangeRequired`, `onAccountSuspended` | Optional callbacks for those backend codes; the form still presents the mapped error. |
| `showForgotPassword` / `forgotPasswordHref` | true / `'#forgot-password'`. |
| `showRegisterLink` / `registerHref` | true / `'#register'`. |
| `respectRegistrationPolicy` | true; public config controls which registration/recovery links are available. |
| `identifierLabel` / `identifierPlaceholder` | Username or email / `you@example.com`. |
| `identifierAutoComplete` | `'username'`. |
| `socialProviders` | Optional callbacks rendered with `SocialLoginGroup`. |
| `className` | Additional layout styling. |
| `showRememberMe` | Deprecated compatibility prop; no checkbox or persistence change. |

Public-config failure hides unconfirmed optional paths and presents loading/error
guidance, but the login credential form remains usable. It submits through
`useAuth().login`, not a form-owned fetch. Limited results are routed into
`AuthFlowContinuation`; the shared controller continuation is also observed
across the expected authorization-subtree remount.

## RegisterForm

`RegisterFormProps` accepts `onSuccess`, `showLoginLink` (true),
`loginHref` (`'#login'`), `fields` (email/password),
`showPasswordStrength` (true), `respectRegistrationPolicy` (true),
`unavailable`, `socialProviders` and `className`.
Valid field names are `email`, `username`, `firstName`, `lastName`,
`password`. Username falls back to email when the username field is absent.

Public-config loading, unavailable and closed-registration states are distinct.
`unavailable` customizes the unavailable/closed presentation; bypassing UI policy
with `respectRegistrationPolicy={false}` does not bypass backend policy.

The form adds conditional controls outside the optional account field list:

- First-owner bootstrap secret input when the public policy requires it.
- Organization name for first multi-tenant bootstrap.
- Optional organization creation for authenticated self-creation policy.
- Optional MFA enrollment when enabled/ready and policy is optional.

The server still owns [bootstrap](../../backend/guardian/bootstrap.md),
[registration](../../backend/guardian/registration.md) and
[organization creation](../../backend/guardian/tenancy.md).
A registration needing email verification displays a pending-verification
screen and resend action; it does not invoke completed-session success.
MFA, required-profile and tenant continuations are routed through the common
coordinator. Required profile fields are completed after mandatory email/MFA
ceremonies and before tenant binding or full application credentials.

## AuthFlowContinuation

`AuthFlowContinuationProps` requires `result: AuthFlowContinuationResult`
and accepts `onSuccess`, `onBack`,
`onTenantOnboardingRequired(result)` and `className`.
Its keyed internal flow resets local state when the server-issued ceremony
identity changes.

The server owns the ceremony order. The coordinator renders the matching
limited result and retains subsequent stages rather than reporting app success:

1. MFA setup/challenge goes to `MFAContinuation`. Its completion may still need
   required profile completion or tenant selection/onboarding; that result stays
   in the coordinator.
2. A required-profile result goes to `ProfileCompletionForm`. It accepts only
   the enabled required profile fields through the restricted profile continuation;
   its completion can proceed to tenant selection/onboarding instead of issuing
   a session immediately.
3. A tenant-selection result goes to `TenantSelectionForm`.
4. A no-membership onboarding result loads public policy and offers only
   server-authorized creation and/or verified-domain request-to-join.
5. If neither onboarding path is available, it explains that invitation/approval or
   platform-created access is required.

The coordinator does not treat an MFA/profile proof as application or tenant
authority, or guess that an email suffix grants membership. See
[required profile completion](../../backend/guardian/profile-completion.md) and
[backend session states](../../backend/guardian/sessions.md).
Back callbacks clear/restart UI flow; a continuation's actual validity and
single-use enforcement remain server responsibilities.

## ProfileCompletionForm

`ProfileCompletionForm` is exported from `@zero/framework/components/auth`,
the React facade and the framework root. Its optional `result` accepts an
`AuthProfileCompletionRequiredResult`; omitting it uses the current in-memory
authentication continuation from the configured provider. Other props are
`onComplete(result)`, `onSuccess`, `onBack` and `className`.

```tsx
import { ProfileCompletionForm } from '@zero/framework/components/auth';

export function CompleteProfilePage({ onBack }: { onBack: () => void }) {
  return <ProfileCompletionForm onBack={onBack} />;
}
```

Mount this page inside the normal provider if an app needs a separate completion
entrance. No proof asks the user to restart sign-in; the page does not invent an
identity. Keep the continuation in memory, never in a URL or localStorage.
Ordinary `UserProfileSettings` is a signed-in account editor, not a replacement
for this identity-only stage.

The form renders only enabled required profile fields, retaining the original
server policy as the authority. It does not ask for optional biography/regional
preferences, require an avatar/contact proof, or clear omitted optional values.
It submits the actual expected profile revision, retains a failed/conflicted
draft and offers review of the accepted latest state. Unready storage shows an
explicit migration/configuration state rather than a fabricated empty profile.
SDK inspection and completion bound both response headers and JSON-body reads
to 30 seconds. A timeout releases pending controls but retains the current
restricted proof and failed draft; it does not mean the server did not commit.
Review the latest profile before retrying, or restart sign-in if the proof was
consumed or expired. No completion request is automatically replayed.
`onComplete` reports an accepted auth result; `onSuccess` runs only for an
accepted full session. A tenant/native continuation is not app success.

## Public Result Guards

The auth barrel exports:

- `isAuthSessionResult`: checks access token, refresh token and user shape.
- `isMfaSetupRequiredResult`, `isMfaChallengeRequiredResult`,
  `isMfaContinuationResult`.
- `isTenantSelectionRequiredResult`, `isTenantOnboardingRequiredResult`.
- `isProfileCompletionRequiredResult`.
- `isAuthFlowContinuationResult` and the `AuthFlowContinuationResult` type.

These guards distinguish SDK result variants for UI composition. They are not
cryptographic verification of user-controlled JSON. Never submit an arbitrary
browser result as a server principal.

## Verification And Related Guides

Exercise first bootstrap, closed registration, unverified email, required MFA,
required profile completion, multi-membership selection and a verified account
without membership. Include profile conflicts, missing/expired proofs and a
completion which continues to tenant/native consent rather than app success.
`onSuccess` should run only when the full ceremony yields a session, with the
configured navigation destination.

- [MFA controls](./mfa-controls.md) cover enrollment/challenge/account settings.
- [Account actions](./account-actions.md) cover password/email/property forms.
- [Required profile completion](../../backend/guardian/profile-completion.md) owns enrollment, restricted authority and final issuance.
- [Native web UI](./native-ui.md) preserves native authorization continuation.

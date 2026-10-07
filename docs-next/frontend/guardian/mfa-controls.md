---
id: zero.frontend.guardian.mfa-controls
type: reference
audience: [developer, agent]
owner: guardian
status: draft
visibility: internal
system: guardian
feature: mfa-ui
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

# MFA Enrollment, Challenge And Account Controls

[Guardian frontend index](./index.md) · [Documentation index](../../index.md)

The four MFA components are public through
`@zero/framework/components/auth`. Use the server's
[MFA policy and result contracts](../../backend/guardian/mfa.md); UI props do
not enable an unavailable delivery method.

## MFAContinuation

`MFAContinuationProps` requires an MFA setup/challenge result and accepts
`onSuccess?`, `onComplete?(result: AuthCompletionResult)`, `onBack?`,
`className?`. Setup is routed to `MFAEnrollmentForm`; challenge is routed
to `MFAChallengeForm`.

`onComplete` receives the next account completion result, which may still be
a tenant selection/onboarding continuation. `onSuccess` is reserved for
completion recognized by the chosen form. In composed login flows prefer
`AuthFlowContinuation`, which keeps the whole ceremony coordinated.

## MFAEnrollmentForm

`MFAEnrollmentFormProps`:

| Prop | Purpose |
| --- | --- |
| `setupToken?` | Limited setup token from required enrollment; omit for eligible current-user settings enrollment. |
| `methods?` | Allowed presentation choices; default totp/email. |
| `allowUserChoice?` | Default true; controls choosing among available methods. |
| `preferredMethod?` | Initial choice if present among supplied methods. |
| `onSuccess?` | Accepted enrollment/final-session completion callback. |
| `onComplete?` | Receives an account completion result when setup advances auth. |
| `onBack?`, `className?` | Navigation/presentation. |

The scope wrapper resets local enrollment state for changes in user/setup token/
method set. An empty methods array uses the component defaults; do not use it
to communicate that no method is server-enabled. Pass the public ready/available
policy from `useAuthConfig`, or let the packaged coordinator/panel do so.

Email setup renders OTP verification. TOTP setup provides a QR code and manual
secret, with clipboard interaction and code verification. That secret is
sensitive enrollment material; do not persist it as a user property, log it,
send it to unrelated telemetry or render it to an unauthorized viewer.
The server owns verification token expiry and method persistence.

The chooser supports keyboard roving radio navigation. The OTP primitive waits
for accepted verification before advancing the callback flow; see the
[development interaction corrections](./auth-primitives.md#otpverification).

## MFAChallengeForm

`MFAChallengeFormProps` requires `challengeToken` and
`method: 'totp' | 'email'`, with optional `challenge`, `onSuccess`,
`onComplete`, `onBack`, `className`.
The challenge details drive destination text; verification uses the limited
challenge token/code through the SDK. New challenge identity remounts the inner
form so previous code state is not reused.

A successful challenge can return a tenant continuation. It is not necessarily
the final app session. Do not replace the coordinator with a generic
“OTP passed, show app” branch.

## MFAManagementPanel

`MFAManagementPanelProps` contains only `className?`.
The panel loads current methods/required status, shows active method labels,
reports load failures with retry and offers enrollment based on public policy.
Accepted enrollment reloads status.

### Capability Correction: 2.5.0 Working Update

This focused UI correction is source-observed in the working profile-settings
branch based on `39c0ed1de0501986810a2b99366f484e66ba80dc`. It does not
replace the earlier full-page review identity or claim installed-artifact
qualification.

When the current ready auth configuration explicitly disables MFA, the panel
renders nothing and makes no method-list request. Unknown/loading policy is
shown as an explicit loading state; failed or missing MFA policy is shown as
unavailable with retry. A previously cached configuration retained during refresh
does not authorize enrollment while the new policy request is pending.

An enabled panel loads status only for the current authenticated, readable
authorization scope. Enrollment requires a successfully loaded status, no active
method, `mfa.enabled: true`, `mfa.ready: true` and at least one method present in
both `methods` and `availableMethods`. Empty availability does not fall back to
email/TOTP or offer unusable setup.

Configuration/capability or account/organization/authorization-boundary changes
retire local enrollment and method-list state. Superseded or late responses,
including failures, cannot repopulate a retired panel or dispatch a retained
retry. Backend validation, permission checks and MFA proof lifecycle remain
authoritative; hiding this UI does not change server policy or disable enrolled
methods.

It is a current-account settings UI, not a recovery-code manager, remembered
device manager, passkey manager or administrator MFA-reset screen. Those are
distinct capabilities; reserved unsupported options must not be documented as
usable features. The backend's required policy can enroll an existing user
during next login rather than leaving them without a setup path.

## Verification And Related Guides

Exercise optional setup from account settings, required first setup, enrolled
challenge, invalid code, method readiness failure and MFA-then-tenant selection.
Only the server can determine whether the ceremony grants a session.

- [MFA backend](../../backend/guardian/mfa.md) defines policy/readiness and live requirements.
- [Authentication flow coordinator](./authentication-flows.md) handles subsequent continuations.
- [OTP/password primitives](./auth-primitives.md) own small interactions and keyboard behavior.

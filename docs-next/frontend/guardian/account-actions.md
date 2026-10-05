---
id: zero.frontend.guardian.account-actions
type: reference
audience: [developer, agent]
owner: guardian
status: draft
visibility: internal
system: guardian
feature: password-email-and-property-forms
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

# Password, Email And Account-Property Forms

[Guardian frontend index](./index.md) · [Documentation index](../../index.md)

These components use the public account SDK through
[auth hooks](./auth-hooks.md). They handle presentation and awaiting operations;
the backend owns action tokens, identity verification and property writers.
Import from `@zero/framework/components/auth`.

## ForgotPasswordForm

`ForgotPasswordFormProps` accepts:

- `onSubmit?(email, nativeContinuation?): Promise<void>`: optional custom
  request callback; otherwise the standard `forgotPassword` method is used.
- `onBack?()`, `loginHref` (default `'#login'`).
- `respectEmailPolicy` (true), `unavailable`, `className`.

The form checks public email/recovery policy, shows distinct pending/error/
unavailable states and waits for the request promise before showing received
confirmation. Its wording deliberately says “If an account exists…”; it must
not expose account enumeration or claim confirmed delivery. A custom callback
must preserve that privacy and handle its own approved transport.

```tsx
import { ForgotPasswordForm, PasswordActionForm } from '@zero/framework/components/auth';

export function RecoveryPages({ token }: { token?: string }) {
  return token
    ? <PasswordActionForm token={token} mode="reset" loginHref="/login" />
    : <ForgotPasswordForm loginHref="/login" />;
}
```

## PasswordActionForm

`PasswordActionFormProps`: `token?`, `mode?: 'auto' | 'reset' | 'setup'`
(auto), `loginHref` (`'#login'`), `onSuccess?`, `className?`.

The active token comes from the explicit prop or manually entered token.
Inspection drives loading/error and action-kind validation. Auto mode follows
the inspected action; an explicit mismatched mode is rejected by the UI, with
backend verification still mandatory. The form validates matching new passwords
and the minimum length before dispatching the matching setup/reset method.

Inspection effects retire on token/flow changes or unmount. Submission awaits
the SDK; a continuation enters the common auth coordinator, while final
completion shows success and invokes `onSuccess`. Never include action tokens
in application logs or broad analytics; read
[action token security](../../backend/guardian/password-recovery.md).

## EmailVerificationForm

`EmailVerificationFormProps`: `token?`, `email?`, `loginHref`
(`'#login'`), `onSuccess?`, `className?`.

It supports explicit/manual tokens, inspection, email-verification type checks,
verification and a resend email form. Inspection can supply the account email
as a hint. Invalid/expired/used links show the mapped safe lifecycle message;
success may still require MFA/tenant continuation. The component does not grant
access merely because a token-looking string appears in a URL.
See [canonical email verification](../../backend/guardian/email-verification.md).

## ChangePasswordForm

`ChangePasswordFormProps` contains `onSuccess?` and `className?`.
It asks for current/new/confirmation passwords, checks length/match, and awaits
`changePassword(current, next)`. On acceptance it clears all password fields,
shows feedback and invokes success. It is an authenticated current-user
operation, not an administrator reset UI; use the adaptable administration
control plane for administrator-issued reset/setup actions.

## UserPropertiesForm

`UserPropertiesFormProps` accepts `title` (Account settings),
`description` (settings this app lets you control), `emptyState` (null),
`onSuccess(properties: Record<string, string>)`, `className`.

The form renders the public self-editable property descriptors rather than all
stored properties. Boolean/string/number/select presentation follows the
descriptor. Identity/property snapshots reset local values. Without a user it
renders null; public-config failure shows loading/error; no fields renders the
configured empty state.

Submission writes fields sequentially through `setProperty`, then reads
`getProperties` and reports that accepted snapshot. This is **not** one atomic
bulk-property transaction: if a later write fails, earlier accepted writes
remain. Backend validation/writer policy still prevents writing trusted or
undeclared properties. Use server service composition for an application task
that explicitly needs atomic multi-field changes, not a success toast hiding a
partial failure.

## Auth Error Helpers

The auth barrel exports `getAuthErrorCode(error)`,
`getAuthDisplayMessage(error, fallback)` and `reportAuthUiError(action, error)`.
The code helper reads the structured SDK/domain code. The display helper gives
specific wording for password-change-required, suspension, registration/
bootstrap/recovery/email configuration and action-token lifecycle failures.
Generic Error messages remain user-facing; application callbacks should provide
safe messages. The report helper uses Zero's auth frontend observability
boundary, not console logging with credentials.

## Verification And Related Guides

Check missing/invalid/expired/consumed tokens, explicit action-kind mismatch,
resend privacy, mismatched passwords and property writer rejection. Do not use
real account links or codes for component tests.

- [Authentication flows](./authentication-flows.md) own incomplete-session routing.
- [User-property backend](../../backend/guardian/user-properties.md) owns writers/defaults.
- [Password recovery backend](../../backend/guardian/password-recovery.md) owns tokens/rotation.

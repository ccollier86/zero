---
id: zero.frontend.guardian.auth-primitives
type: reference
audience: [developer, agent]
owner: guardian
status: draft
visibility: internal
system: guardian
feature: auth-presentation-primitives
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

# Authentication Presentation Primitives

[Guardian frontend index](./index.md) · [Documentation index](../../index.md)

These small components help compose a branded authentication flow without
copying Zero's inputs, validation presentation or motion conventions. They are
presentation primitives, not password policy, OAuth providers or authentication
transport. Import from `@zero/framework/components/auth`.

This draft includes the approved development corrections to password-toggle
keyboard access and OTP pending admission. The original 2.1.1 baseline skipped
the reveal button in Tab order and allowed overlapping verification/resend
callbacks. Those fixes are not claimed to be in the pinned clean artifact.

## AuthLayout And AuthHeader

`AuthLayoutProps`:

| Prop | Default and behavior |
| --- | --- |
| `children` | Authentication content. |
| `appName` | `'Zero'`; shown beside the default/explicit logo. |
| `logo` | Optional React node; otherwise the brand's initial. |
| `image` | Optional image path replacing the brand display. |
| `gradient` | Optional decorative gradient string. |
| `background` | `'dot-grid'`; also `plain`, `grid`, `radial-grid`. |
| `className` | Additional layout classes. |

The layout supplies a card and decorative background; it does not install
`AppProvider`, route the user, or set server policy. Motion respects reduced
motion. Existing decorative background gradients include fixed blue accents;
use the explicit customization props if those accents do not fit the app.

`AuthHeaderProps` requires `title: string`; optional `description` and
`className` add secondary text and styling.

```tsx
import { AuthHeader, AuthLayout, PasswordInput } from '@zero/framework/components/auth';

export function PasswordPrompt() {
  return (
    <AuthLayout appName="Example" background="plain">
      <AuthHeader title="Confirm your password" description="Continue securely." />
      <label htmlFor="confirmation">Password</label>
      <PasswordInput id="confirmation" autoComplete="current-password" />
    </AuthLayout>
  );
}
```

## PasswordInput, PasswordStrength And Helpers

`PasswordInputProps` extends the standard Zero `Input` props and adds
`showStrength?: boolean` (false), `strengthClassName?: string` and
`className`. It switches between password/text using a labeled type-button,
preserves value, and forwards focus/blur callbacks. Supply a label and the
appropriate autocomplete purpose. The development correction makes Show/Hide
reachable by Tab and operable with Space/Enter; it does not change props.

A strength display appears while focused or when a controlled string `value`
is nonempty. Its score uses that controlled value; an uncontrolled
`defaultValue` is not automatically a live strength value.

`PasswordStrengthProps` requires `password: string` and optional
`className`. `getPasswordRules(password)` returns five validation rules:
at least eight characters, lowercase, uppercase, number and special character.
`calcPasswordStrength(password)` returns 0 for empty, then 1–4 based on rule
count. The labels are Weak/Fair/Good/Strong. This is feedback, not entropy
estimation or proof the backend will accept a password. The server's exact
[password contract](../../backend/guardian/login.md) remains authoritative.

## OTPInput

`OTPInputProps`:

- `value: string` and `onChange(value)` implement controlled code entry.
- `length?: number` defaults to 6; a visual separator splits near the midpoint.
- `onComplete?(value)` fires when code entry is complete.
- `error?: boolean` defaults false and enables error styling.
- `disabled?: boolean` is additive in the development correction and blocks
  editing/completion while a parent operation is pending.
- `className?` styles the outer motion container.

It wraps `input-otp` and supplies token-based slots/focus styling. It does not
send/validate a code. Reduced-motion users do not receive the shake/scale effect.

## OTPVerification

`OTPVerificationProps` requires `destination: string` and
`onVerify(code): Promise<void>`. Other props are `title` (Verification),
`description` (code destination wording), `length` (6),
`onResend?(): Promise<void>`, `resendCooldown` (60 seconds), `onBack?()`
and `className`.

The component waits for the supplied verifier. Success is owned by that callback,
so a parent may advance the ceremony; there is no extra success callback.
Rejection displays the error and clears code entry. Resend starts its cooldown
only after the callback accepts the operation; rejection does not start it.

The corrected development interaction admits only one verification or resend
at a time, with a synchronous admission fence before awaiting the callback.
Input/resend controls are disabled while pending. Unmount retires UI settlement;
it does not abort external work that an app callback already started. A Back
callback may unmount the flow. Do not retain the code as application state,
include it in logs, or treat local UI admission as server replay protection.

Failures pass through `reportAuthUiError` without code/destination payloads.
Custom callback Error messages remain user-facing; supply safe messages rather
than provider stack traces or secrets.

## SocialLoginGroup

`SocialLoginGroupProps` accepts
`providers: { name: string; label?: string; icon: ReactNode; onClick(): void }[]`,
`dividerText` (OR) and `className`. An empty list renders nothing; labels
fall back to names; multiple providers use a two-column layout.

This component does not add social authentication to Guardian. A provider plugin
or application flow must implement the callback, callback URL handling and
server-side identity verification. Do not claim that rendering a provider button
configures a usable OAuth backend.

## Verification And Related Guides

Check keyboard Tab order, Show/Hide value preservation, reduced motion, OTP
pending/rejection/retry and resend acceptance/cooldown. Use synthetic codes.

- [Canonical MFA](../../backend/guardian/mfa.md) defines limited setup/challenge tokens.
- [Account login](../../backend/guardian/login.md) defines authentication completion.
- Base tokens and motion conventions remain owned by the design-system family;
  its focused entrance is being prepared separately.

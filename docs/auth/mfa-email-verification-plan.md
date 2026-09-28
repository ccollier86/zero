---
type: plan
schema_version: 0.1.0
project: zero-platform
system: auth
status: proposed
priority: high
confidence: user-stated
created: 2026-07-03
updated: 2026-07-03
codex_visible: true
tags:
  - auth
  - email-verification
  - mfa
  - otp
  - totp
---

# Auth Email Verification and MFA Plan

> Historical/partially implemented plan. Email verification, email OTP,
> authenticator/TOTP, enrollment/challenge UI, and the account gates described
> as complete below are implemented. Recovery codes and the other explicitly
> reserved items are not. File paths such as `zero/auth.ts` are app-owned
> organization conventions: `createApp()` does not discover them. Import and
> compose them through `zero.config.ts`; see
> [Platform Configuration](../platform-configuration.md).

This plan upgrades Zero auth from password-only account lifecycle flows into a
complete first-party account system with optional email verification, email OTP
MFA, authenticator-app TOTP MFA, branded auth emails, and polished auth screens.

SMS is intentionally out of scope for the core platform. It can become a later
adapter/plugin.

## Goals

- Allow apps to require email verification during public registration.
- Keep first-user admin bootstrap safe while still supporting verification.
- Support forgot-password through email links and optional OTP verification.
- Support MFA with email OTP and authenticator-app TOTP.
- Let developers choose optional, required, or admin-required MFA.
- Let users choose their MFA method when more than one method is enabled.
- Design the contracts so users can later keep multiple active MFA methods and
  use a "try another way" fallback when the default challenge method is not
  available.
- Let admins enforce MFA per user when global policy allows it.
- Add branded, themeable auth emails with safe defaults.
- Make auth branding, verification, MFA, and email templates configurable from
  focused Zero config files with commented starter templates.
- Improve login, registration, verification, reset, setup, and MFA UI.
- Preserve simple defaults for apps that do not need MFA or verification.

## Non-Goals

- SMS OTP in core.
- Social login/OAuth changes.
- Passkeys/WebAuthn in this slice.
- Multi-tenant role/RBAC expansion.

## Current Foundation

Zero already has several useful pieces:

- `_auth_action_tokens` for hashed one-time account tokens.
- `email_verification` already exists as an action token type.
- `AccountEmailService` sends setup and reset emails through the platform email boundary.
- `PasswordActionForm`, `ForgotPasswordForm`, `OTPInput`, and `OTPVerification` already exist.
- `input-otp` is already used, so OTP polish should upgrade the existing component instead of creating a duplicate.
- Public reset/setup pages and token-paste fallback are already wired.
- Email verification config/routes/UI are implemented.
- MFA config normalization, public/admin config readiness exposure, user
  `mfa_required`, internal MFA tables, `MfaMethodStore`, `MfaChallengeStore`,
  and `MfaChallengeService` are implemented.
- MFA setup/challenge routes are implemented:
  `GET /auth/mfa/methods`, `POST /auth/mfa/setup`,
  `POST /auth/mfa/setup/verify`, and
  `POST /auth/mfa/challenge/verify`.
- Required MFA gates session issuance through short-lived transition tokens.
  Full access/refresh tokens are only returned after setup or challenge
  verification succeeds.

## Config File Protocol

All settings in this plan must be configurable through the same Zero config
protocol used by generated apps. Inline `createApp()` config remains supported,
but starter apps should put auth behavior in `zero/auth.ts` so developers and
agents can find it immediately.

Recommended starter shape:

```txt
zero.config.ts
zero/
  auth.ts
  auth-emails/
    index.ts
    account-setup.ts
    password-reset.ts
    email-verification.ts
    email-otp.ts
    password-changed.ts
    mfa-enabled.ts
    mfa-disabled.ts
    recovery-codes-regenerated.ts
```

`zero.config.ts` stays small:

```ts
import { defineZeroConfig } from '@zero/framework/server';
import auth from './zero/auth';

export default defineZeroConfig({
  app: {
    name: Bun.env.APP_NAME ?? 'My app',
    publicUrl: Bun.env.APP_PUBLIC_URL,
    logoUrl: Bun.env.APP_LOGO_URL,
    supportEmail: Bun.env.APP_SUPPORT_EMAIL,
  },
  auth,
  email: Bun.env.RESEND_API_KEY
    ? {
      provider: 'resend',
      from: Bun.env.EMAIL_FROM,
      replyTo: Bun.env.EMAIL_REPLY_TO,
      resend: { apiKey: Bun.env.RESEND_API_KEY },
    }
    : false,
});
```

`zero/auth.ts` owns the behavior:

```ts
import {
  defineAuthConfig,
  defineAuthEmailTemplates,
} from '@zero/framework/server';
import { authEmailTemplates } from './auth-emails';

export default defineAuthConfig({
  account: {
    requireEmailVerification: Bun.env.AUTH_REQUIRE_EMAIL_VERIFICATION === 'true',
    emailVerificationPath: '/verify-email',
  },
  mfa: {
    enabled: Bun.env.AUTH_MFA_ENABLED === 'true',
    policy: Bun.env.AUTH_MFA_POLICY ?? 'optional',
    methods: ['email', 'totp'],
    allowUserChoice: true,
    allowMultipleMethods: false,
    recoveryCodes: false, // reserved for a later recovery-code flow
    totp: {
      // Authenticator/TOTP is self-hosted by Zero. Issuer defaults to app.name.
      encryptionKey: Bun.env.AUTH_TOTP_ENCRYPTION_KEY,
    },
  },
  branding: {
    appName: Bun.env.APP_NAME,
    logoUrl: Bun.env.APP_LOGO_URL,
    supportEmail: Bun.env.APP_SUPPORT_EMAIL,
    brandColor: Bun.env.AUTH_EMAIL_BRAND_COLOR,
  },
  emails: defineAuthEmailTemplates(authEmailTemplates),
});
```

`zero/auth-emails/` is optional. If absent, Zero uses built-in branded
defaults. When present, each template should live in its own file so app code
can replace one email without turning a registry file into a wall of markup.
The folder `index.ts` only composes templates:

```ts
// zero/auth-emails/index.ts
import { defineAuthEmailTemplates } from '@zero/framework/server';

import { passwordResetEmail } from './password-reset';

export const authEmailTemplates = defineAuthEmailTemplates({
  passwordReset: passwordResetEmail,
});
```

```ts
// zero/auth-emails/password-reset.ts
import type { AuthEmailTemplate } from '@zero/framework/server';

export const passwordResetEmail: AuthEmailTemplate = (ctx) => ({
  subject: `Reset your ${ctx.branding.appName} password`,
  text: ctx.defaultText,
  html: ctx.defaultHtml,
});
```

Generated config templates should be comment-heavy and safe by default. A
developer should be able to enable verification or MFA by changing two or three
obvious values, not by hunting through route code.

Implemented config/env keys (see
[Platform Configuration](../platform-configuration.md) for the current shape):

| Key | Purpose |
| --- | --- |
| `APP_NAME` | Default app/site name for auth pages and emails. |
| `APP_PUBLIC_URL` | Public origin for verification/reset/setup links. |
| `APP_LOGO_URL` | Optional logo shown on auth screens and emails. |
| `APP_SUPPORT_EMAIL` | Optional support identity in auth emails. |
| `AUTH_EMAIL_BRAND_COLOR` | Optional default email button/accent color. |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Enables required verification on account creation. |
| `AUTH_MFA_ENABLED` | Enables MFA features. |
| `AUTH_MFA_POLICY` | `optional`, `required`, or `admin-required`. |
| `AUTH_MFA_METHODS` | Optional comma list, for example `email,totp`. |
| `AUTH_TOTP_ENCRYPTION_KEY` | Secret used to encrypt self-hosted authenticator/TOTP seeds at rest. |

## Configuration Shape

Extend `AuthBehaviorConfig`:

```ts
auth: {
  account: {
    requireEmailVerification: false,
    emailVerificationMode: 'optional', // optional | required
    emailVerificationTTL: '24h',
    emailVerificationPath: '/verify-email',
    allowLoginBeforeEmailVerified: false,
  },
  mfa: {
    enabled: false,
    policy: 'optional', // optional | required | admin-required
    methods: ['email', 'totp'],
    allowUserChoice: true,
    // v1 keeps one active method per user. The method the user sets up becomes
    // their login challenge method. Later releases can enable multiple active
    // methods and fallback without changing the storage model.
    allowMultipleMethods: false,
    rememberDevice: false,
    challengeTTL: '10m',
    challengeCooldown: '1m',
    maxAttempts: 5,
    recoveryCodes: false, // reserved for a later recovery-code flow
    totp: {
      issuer: 'My app', // optional; defaults to app.name
      encryptionKey: Bun.env.AUTH_TOTP_ENCRYPTION_KEY,
      qrRobustness: 'M',
    },
  },
  branding: {
    appName: 'My app',
    logoUrl: '/logo.svg',
    supportEmail: 'support@example.com',
    brandColor: '#2563eb',
  },
  emails: {
    templates: {
      accountSetup: customTemplate,
      passwordReset: customTemplate,
      passwordChanged: customTemplate,
      emailVerification: customTemplate,
      emailOtp: customTemplate,
      mfaDisabled: customTemplate,
      mfaRecoveryCodesRegenerated: customTemplate,
    },
  },
}
```

Config defaults should keep today's behavior unless a developer opts in.

Config resolution order:

1. Platform defaults.
2. `app` identity from `zero.config.ts`.
3. Focused `zero/auth.ts` config.
4. Inline `createApp({ auth })` overrides for tests or small apps.
5. Runtime admin/user policy where allowed, never for secrets.

## Backend Data Model

Add columns to `users`:

```sql
email_verified_at INTEGER;
email_verification_required INTEGER NOT NULL DEFAULT 0;
mfa_required INTEGER NOT NULL DEFAULT 0;
```

Add `_auth_mfa_methods`:

```sql
method_id TEXT PRIMARY KEY;
user_id TEXT NOT NULL;
type TEXT NOT NULL; -- email | totp
label TEXT;
status TEXT NOT NULL; -- pending | active | disabled
is_primary INTEGER NOT NULL DEFAULT 0;
secret_ciphertext TEXT; -- only for totp
created_at INTEGER NOT NULL;
verified_at INTEGER;
disabled_at INTEGER;
last_used_at INTEGER;
metadata TEXT;
```

Add `_auth_mfa_challenges`:

```sql
challenge_id TEXT PRIMARY KEY;
user_id TEXT NOT NULL;
method_id TEXT;
method_type TEXT NOT NULL; -- email | totp | recovery
code_hash TEXT;
expires_at INTEGER NOT NULL;
attempts INTEGER NOT NULL DEFAULT 0;
max_attempts INTEGER NOT NULL;
consumed_at INTEGER;
created_at INTEGER NOT NULL;
metadata TEXT;
```

Add `_auth_mfa_recovery_codes`:

```sql
code_id TEXT PRIMARY KEY;
user_id TEXT NOT NULL;
code_hash TEXT NOT NULL;
created_at INTEGER NOT NULL;
consumed_at INTEGER;
```

Security requirements:

- Raw OTP codes are never stored.
- Email OTP and recovery codes are hashed.
- TOTP secrets are encrypted, not hashed, because verification needs the secret.
- TOTP encryption requires an app secret. Doctor should warn/fail strict mode if MFA TOTP is enabled without one.
- MFA challenge attempts are capped and logged through observability.
- Initial UI can enforce one active primary method per user to keep the first
  release simple, but `_auth_mfa_methods` must allow multiple active methods so
  the future "try another way" flow does not need a schema redesign.

## Backend Services

Add single-responsibility auth services:

- `email-verification-service.ts`
  - creates verification action tokens
  - sends verification emails
  - consumes verification tokens
  - marks `email_verified_at`

- `mfa-method-store.ts`
  - stores MFA method records
  - activates/disables methods
  - lists public-safe method metadata

- `mfa-challenge-service.ts`
  - creates email OTP challenges
  - verifies email OTP challenges
  - verifies TOTP codes
  - verifies recovery codes
  - enforces TTL/cooldown/attempts

- `totp-service.ts`
  - creates TOTP secrets
  - creates otpauth URLs for QR codes
  - verifies authenticator codes with a small clock window

- `recovery-code-service.ts`
  - generates recovery code batches
  - hashes codes
  - consumes one code once

- `auth-email-template-service.ts`
  - resolves built-in or app-provided templates
  - injects branding context
  - renders safe HTML/text output

## HTTP Routes

Current implemented public/account routes relevant to this historical plan:

```txt
POST /auth/register
POST /auth/login
POST /auth/resend-verification
GET  /auth/action-token/:token
POST /auth/verify-email
POST /auth/forgot-password
POST /auth/reset-password
POST /auth/setup-password
```

MFA routes implemented now:

```txt
GET  /auth/mfa/methods
POST /auth/mfa/setup
POST /auth/mfa/setup/verify
POST /auth/mfa/challenge/verify
```

Future current-user MFA management routes:

```txt
GET    /auth/me/mfa
POST   /auth/me/mfa/email/enable
POST   /auth/me/mfa/totp/start
POST   /auth/me/mfa/totp/confirm
POST   /auth/me/mfa/:methodId/prefer
POST   /auth/me/mfa/recovery-codes/regenerate
DELETE /auth/me/mfa/:methodId
```

Admin routes:

```txt
GET    /auth/admin/users/:userId/mfa
POST   /auth/admin/users/:userId/mfa/require
POST   /auth/admin/users/:userId/mfa/clear-requirement
POST   /auth/admin/users/:userId/mfa/reset
POST   /auth/admin/users/:userId/verify-email
POST   /auth/admin/users/:userId/send-verification-email
```

## Login Flow

Password login should not issue full app tokens until all required checks pass.
Email verification is primarily a signup/account-activation step. Login does
not ask already verified users to verify again; it only detects accounts that
registered under required verification and still have not completed activation.

1. Validate username/email and password.
2. Reject suspended accounts.
3. Reject password-change-required accounts with existing lifecycle error.
4. If email verification is required and missing:
   - return `EMAIL_VERIFICATION_REQUIRED` as a pending account-activation state
   - include safe user/email metadata
   - allow resend-verification UI when email delivery is configured
   - do not issue app tokens
5. If MFA is required:
   - return `mfaSetupRequired` with `mfaSetupToken` when no active method exists
   - return `mfaChallengeRequired` with `challengeToken` when an active method exists
   - do not issue app tokens
6. After challenge verification, issue access/refresh token pair.

The frontend auth client treats MFA setup/challenge responses as explicit auth
completion states instead of errors that look like broken login.

Method selection policy:

- First implementation: each user has one active/preferred MFA method. If both
  `email` and `totp` are enabled, enrollment lets the user choose which method
  to set up. That selected method becomes their login challenge method.
- Required MFA: after email verification or first login, users who have no
  active method are forced into enrollment before protected routes.
- Optional MFA: when the user opts in during signup or later account settings,
  they go through the same enrollment choice and their selected method becomes
  preferred.
- Future multi-method mode: users can keep both email OTP and authenticator
  active. Login defaults to authenticator/TOTP when enrolled because it is the
  stronger method, while the UI exposes "try another way" to switch to email OTP
  or recovery codes when allowed by config and policy.
- Future fallback mode should be configurable so stricter apps can disable
  "try another way" entirely.

## Registration Flow

Default mode remains current behavior: register and receive tokens.

When `requireEmailVerification` is true:

1. Create the user.
2. Mark `email_verification_required = 1`.
3. Create an `email_verification` action token.
4. Send verification email.
5. Return `{ emailVerificationRequired: true }` instead of issuing app tokens,
   unless config explicitly allows login-before-verification.
6. Email verification consumes the token, sets `email_verified_at`, and can
   issue tokens or redirect to login based on route/UI choice.

Bootstrap admin behavior:

- If verification is required, email runtime must be ready before registration
  creates the first admin.
- Doctor should warn/fail strict mode when verification is required without a
  ready email provider and `app.publicUrl`.

## Forgot Password Flow

Keep link reset as the default:

1. User requests reset email.
2. Email contains link to `/reset-password?token=...`.
3. Reset page can also accept pasted token.
4. Valid token allows password change.

Optional OTP reset layer:

- When enabled, reset email can include both:
  - a link
  - a short OTP code
- `/reset-password` supports:
  - token from URL
  - token paste
  - OTP code verification against a reset challenge

This should be configurable because link-only reset is simpler and already
secure for many apps.

## Email Templates

Default templates should use:

- app name
- logo URL if configured
- public URL
- support email if configured
- brand/accent color if configured
- action button
- fallback raw URL/code
- expiration text
- security note

Template adapter shape:

```ts
type AuthEmailTemplate = (context: AuthEmailTemplateContext) => {
  subject: string;
  text: string;
  html?: string;
};
```

Template context should include:

```ts
interface AuthEmailTemplateContext {
  type:
    | 'accountSetup'
    | 'passwordReset'
    | 'passwordResetOtp'
    | 'emailVerification'
    | 'emailOtp'
    | 'mfaEnabled'
    | 'mfaDisabled'
    | 'recoveryCodesRegenerated';
  branding: {
    appName: string;
    publicUrl?: string;
    logoUrl?: string;
    supportEmail?: string;
    brandColor?: string;
  };
  user: UserRecord;
  actionUrl?: string;
  code?: string;
  expiresAt?: number;
  defaultSubject: string;
  defaultText: string;
  defaultHtml: string;
}
```

Template resolution order:

1. App-provided template from `zero/auth-emails/index.ts`.
2. Built-in branded HTML template using app config.
3. Built-in plain text fallback.

App-provided templates should not receive secrets except the single raw link or
code needed for delivery. Raw tokens and OTP codes must never be logged by the
template service.

Built-in templates:

- account setup
- password reset
- password reset OTP
- email verification
- email OTP MFA
- password changed notice
- MFA enabled/disabled notice
- recovery codes regenerated notice

## Frontend Components

Upgrade existing components:

- `AuthLayout`
  - optional logo/image slot over form
  - configurable background: `plain | grid | dot-grid | radial-grid`
  - centered card remains the default auth screen
  - no side/brand panel by default
  - app name/logo config defaults from platform config

- `LoginForm`
  - complete: route into MFA challenge/setup state
  - route into email verification required state
  - more polished internal visual hierarchy

- `RegisterForm`
  - email verification required success state
  - resend verification action when allowed
  - complete: optional MFA enrollment request when MFA is ready

- `ForgotPasswordForm`
  - link reset remains default
  - optional OTP reset mode

- `PasswordActionForm`
  - already supports URL token and pasted token
  - complete: route into MFA challenge/setup state after password action
  - add optional OTP branch only when reset OTP is enabled

- `OTPInput`
  - keep current `input-otp` base
  - adopt SmoothUI-style focus/validation/reduced-motion polish
  - no duplicate OTP component

New components:

- `MFAChallengeForm`
  - complete: implemented shared login challenge component
  - show the selected/default challenge first
  - v1 verifies the user's single active/preferred method
  - future multi-method mode can choose email OTP or authenticator when multiple
    active methods are available and fallback is allowed
  - verify challenge
  - recovery code fallback is reserved

- `MFAEnrollmentForm`
  - complete: implemented email OTP and authenticator enrollment component
  - let the user choose email OTP or authenticator when both are allowed
  - enable email OTP
  - start authenticator setup
  - show QR code for otpauth URL
  - verify first TOTP code
  - mark the confirmed method as the user's active/preferred method
  - recovery code display is reserved

- `MFAManagementPanel`
  - complete: implemented current-user status/setup panel
  - user settings organism
  - list enabled methods
  - disabling methods and regenerating recovery codes are reserved

- Admin user management additions
  - MFA status badge
  - require/clear MFA
  - reset user MFA
  - send verification email
  - mark email verified when explicitly allowed

## QR Code Component

Add a platform `QRCode` component based on the Kibo UI shape:

- CSS matrix output using current text/card tokens
- robustness prop: `L | M | Q | H`
- responsive sizing
- client component for authenticator setup

Use it in `MFAEnrollmentForm` for TOTP setup.

## Authenticator App / TOTP Requirements

Authenticator support is a first-class core method, not a plugin and not an
external provider. Zero generates, stores, encrypts, and verifies TOTP secrets
itself. The authenticator app only receives the shared seed through the QR/manual
setup flow and independently computes time-based codes.

TOTP flow:

1. User or admin policy starts authenticator enrollment.
2. Backend creates a pending TOTP method with an encrypted secret.
3. Backend returns:
   - `methodId`
   - `otpauthUrl`
   - issuer/account label, where issuer defaults to `app.name`
   - QR robustness preference from config
4. Frontend displays the QR code and manual setup key.
5. User enters a code from their authenticator app.
6. Backend verifies the code with a small clock window.
7. Method becomes active and recovery codes are generated if enabled.

Login with authenticator:

1. Password is verified.
2. If TOTP MFA is required, backend returns `mfaChallengeRequired` with a
   short-lived `challengeToken`.
3. Frontend shows `MFAChallengeForm`.
4. User enters authenticator code.
5. Backend verifies TOTP against active method secrets.
6. Full access/refresh tokens are issued only after verification.

Authenticator security rules:

- TOTP secrets are encrypted at rest with `AUTH_TOTP_ENCRYPTION_KEY` or an
  equivalent configured app secret.
- If TOTP is enabled without an encryption key, startup/doctor should fail in
  strict mode and warn in non-strict mode.
- Resetting a user's authenticator method must revoke pending MFA challenges.
- Disabling the last MFA method should be blocked when policy requires MFA.
- Recovery codes are hashed and shown only once.

## Config Exposure

Extend `/auth/config`:

```ts
{
  account: {
    emailVerificationRequired: boolean;
    emailVerificationEnabled: boolean;
  },
  mfa: {
    enabled: boolean;
    policy: 'optional' | 'required' | 'admin-required';
    methods: ['email', 'totp'];
    allowUserChoice: boolean;
    allowMultipleMethods: boolean;
    rememberDevice: boolean;
  },
  branding: {
    appName: string;
    logoUrl?: string;
  }
}
```

Admin config should expose operational readiness:

- email provider ready
- public URL ready
- TOTP encryption secret configured
- MFA enabled methods
- default/enforced policy

## Observability and Doctor

Add observability codes for:

- email verification requested/sent/completed/failed
- MFA challenge created/sent/verified/failed/locked
- MFA method enrolled/disabled/reset
- recovery code generated/consumed

Doctor checks:

- verification required but email disabled
- account emails enabled but `app.publicUrl` missing
- TOTP enabled but encryption secret missing
- MFA required with no enabled method
- email OTP enabled but email provider disabled
- public reset/setup/verify routes missing from `publicPaths`
- auth UI pages missing when using protected-first route auth

## Testing

Backend tests:

- registration without verification keeps current behavior
- required verification blocks tokens before verification
- verification token verifies once
- expired/consumed verification token fails
- login blocks unverified users when required
- login returns MFA challenge when required
- email OTP challenge validates, expires, caps attempts, and consumes once
- TOTP enrollment creates secret/otpauth URL and activates only after valid code
- users can choose email OTP or authenticator when both are enabled
- the method chosen during enrollment is used as the login challenge
- TOTP login verification issues tokens
- recovery code works once
- admin can require/reset MFA
- config/doctor catches missing email/TOTP prerequisites

Frontend tests:

- register success displays verify-email state
- login displays MFA challenge state
- OTP input keyboard/paste/backspace works
- TOTP QR setup renders with token colors
- recovery codes are shown once and copyable
- auth layout backgrounds render in light/dark mode

## Implementation Phases

The feature ships before release-polish work. Release readiness is the final
verification pass after the auth feature is complete.

1. Complete: Auth config foundation for account email verification and MFA
   method/readiness settings.
2. Partial: Themeable auth email templates for setup/reset/verification are
   active; email OTP and MFA notices land with the challenge/management slices.
3. Complete: Email verification: migrations, service, routes, registration/login
   enforcement, resend flow, frontend states, docs, and tests.
4. Complete: QRCode and OTP UI primitives: existing `OTPInput`, tokenized
   `QRCode`, and no duplicate OTP component.
5. Complete: Self-hosted authenticator/TOTP: local TOTP service, encrypted seed storage,
   otpauth URL generation, QR/manual setup, verification window, method
   selection, primary-method persistence, docs, and tests.
6. Complete: MFA challenge flow: email OTP challenges, TOTP challenge
   verification, login intermediate states, and auth client support.
7. Partial: MFA management UI: enrollment form, current-user panel, admin
   user-management `mfaRequired` create/update controls, and polished auth
   screens are active. Clear/reset actions and recovery-code flows are reserved.
8. Release-readiness polish: client-side auth navigation links, graceful
   shutdown/runtime cleanup, platform doctor checks, LaunchBoard test wiring,
   end-to-end tests, docs, changelog, and version bump.

Each phase should update docs and tests before moving to the next phase.

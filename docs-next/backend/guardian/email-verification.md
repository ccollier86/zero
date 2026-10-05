---
id: zero.guardian.email-verification
type: how-to
audience: [developer, agent]
owner: guardian
status: draft
visibility: internal
system: guardian
feature: verification-resend-and-email-change
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

# Verify Email And Handle Identity Changes

[Guardian index](./index.md) · [Documentation index](../../index.md)

Email verification proves control of the canonical mailbox used by an account.
It is separate from username lookup, MFA email OTP, a company's domain claim
and ordinary editable user metadata.

## Require Verification

```ts
import { defineAuthConfig } from '@zero/framework/auth';

export const auth = defineAuthConfig({
  account: {
    requireEmailVerification: true,
    emailVerificationPath: '/verify-email',
    allowAdminMarkEmailVerified: false,
  },
});
```

The requirement defaults false. It gates ordinary registration and later login;
the installation bootstrap owner is exempt from the ordinary-registration
verification gate. Email service readiness is required before a registration
that must deliver verification can proceed.

`emailVerificationPath` is a public application page path used by the lifecycle
link. It does not rename the HTTP API endpoint. Ensure the page is reachable
while signed out and can finish the ceremony.

## Verify And Resume Authentication

`POST /auth/verify-email` accepts `{ token }`, admitting only a live
`email_verification` action token. Token consumption, verified state and
registration-intent completion occur together. The service then runs the
normal authentication completion policy: it may require MFA or tenant
selection instead of immediately returning access/refresh tokens.

The browser page cookie is synchronized only when completion issues a full
session; limited completion clears an older page session. Do not turn the
returned user object into a fabricated authenticated client session.

## Resend Without Losing Intent

`POST /auth/resend-verification` accepts `email`, optional
`nativeContinuation` and a compatibility `mfaEnrollment` field. The durable
server-side registration intent wins over new request input, preventing a
resend from dropping a requested enrollment or altering a native continuation.

Resend uses bounded outbox/cooldown behavior and an account-safe public
response. A request accepted for handling is not proof of provider delivery.
Expired/replayed action links must be inspected and completed through the
actual service, not decoded as unsigned browser state.

## Changing The Account Email

In this source, the account-email change surface is an authorized administrator
profile update, `PATCH /auth/admin/users/:userId` with `{ email }`. This is
not a dedicated self-service “change my email” endpoint.

Guardian canonicalizes the new address. A real identity change resets verified
state and applies the configured verification requirement, invalidates
credentials whose authentication boundary changed, and keeps older mailbox
proofs bound to the old email generation. Updating a string-valued user property
named `email` would not perform this lifecycle.

An administrator must deliberately send verification instructions after the
change when the user needs them. Never advertise arbitrary email editing as a
verified mailbox transition.

## Administrator Verification

Two administrator actions are available:

- `POST /auth/admin/users/:userId/send-verification-email` sends a real proof link.
- `POST /auth/admin/users/:userId/verify-email` marks verified only when
  `allowAdminMarkEmailVerified` is enabled and actor/target guards admit it.

Manual verification defaults disabled. Turning it on gives privileged operators
a deliberate proof-substitution power; it is not an ordinary tenant membership
permission and must be visible in operational policy/audits.

## Domain Onboarding Relationship

When configured, successful email-link verification can record a bounded
mailbox proof for verified-domain onboarding. The proof is bound to application,
user, email generation and expiry. A previously verified address does not
forever authorize joining an organization after a later email change.

[Verified domains](./verified-domains.md) adds domain ownership and membership
admission; email verification alone does not auto-create those memberships.

## Verification And Safe Presentation

Test ordinary registration gating, resend preservation, expired/replayed links,
MFA-required completion and email changes after verification. Old credentials
and old mailbox proofs must not retain authority after a real email change.
Check delivery failures without copying tokens/addresses into broad telemetry.

`AUTH_EMAIL_VERIFICATION_SENT`, `AUTH_EMAIL_VERIFIED` and delivery-failure codes
use Zero's standard observability pipeline. User-facing errors should distinguish
expired action links from service readiness without exposing raw provider errors.

## Related Guides And Next Steps

- [Configuration](./configuration.md) gives exact startup inputs and interactions.
- [Registration](./registration.md) describes durable verification intent.
- [Password recovery](./password-recovery.md) explains other action-token types.
- [MFA](./mfa.md) separates email OTP from mailbox verification.
- [Verified domains](./verified-domains.md) combines domain and mailbox proofs.

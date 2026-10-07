---
id: zero.guardian.contacts
type: reference
audience: [developer, agent, operator]
owner: guardian
status: verified
visibility: internal
system: guardian
feature: contact-possession
maturity: supported
applies_to: ["2.6.0"]
modes: [single-simple, single-advanced, multi-simple, multi-advanced, native]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "c5656b306051b04ec6adc641b7057a0672fd7a3e"
  snapshot: clean
  date: "2026-10-07"
  evidence_level: implementation-verified
---

# Contact Changes And Possession Verification

[Guardian index](./index.md) · [Own profiles](./user-profiles.md) · [Profile UI](../../frontend/guardian/profile-settings.md)

A formatted phone number, an administrator's attestation and a completed
possession challenge are different facts. Guardian keeps them distinct rather
than painting a verified badge from a legacy timestamp or an editable property.
These account ceremonies do not add SMS login, SMS MFA or social authentication.

## Enable Only What The App Can Deliver

```ts
import { defineAuthConfig } from '@zero/framework/auth';

export const auth = defineAuthConfig({
  userProfile: {
    contacts: {
      enabled: true,
      email: { verify: true, change: true },
      phone: { enabled: true, editable: true, verify: true },
      verificationPath: '/verify-contact',
      challengeTTL: '15m',
      resendCooldown: '1m',
      maxAttempts: 5,
    },
  },
});
```

Contacts are disabled by default and also depend on the parent profile feature.
Phone editing/verification requires `phone.enabled`. The verification page is a
safe local pathname. Attempts are bounded (maximum 10); challenge TTL and resend
cooldown are validated durations. Actual capabilities additionally depend on
the ready email outbox or trusted phone adapter, not just the configuration.

Render `ContactEmailVerification` on the configured path. Managed default public
paths include that enabled path; an explicit app `publicPaths` override still
owns its complete list. Do not require an app session just to redeem a mailed
proof, or use the proof as a session bearer token.

## Email

Verifying the current mailbox uses a distinct `profile_contact_verification`
action-token purpose and the existing durable email delivery path. Tokens are
one-time, generation-bound and never returned as a user-editable trusted field.
Admin verification of a login gate remains `administratively-attested`, not
`possession-verified`.

Changing email requires the current password. The requested address stays a
pending candidate; the old address remains the login identity until the new
mailbox proof is accepted. Activation validates live account/challenge/identity
state, changes the login address atomically and revokes the old session families.
The result is `{ verified: true, userId, requiresSignIn }`. An unrelated account
already signed into the browser is not logged out merely because a link for
another account was redeemed.

## Phone Adapter Boundary

The managed auth configuration accepts `phoneVerificationAdapter`, a trusted
server object implementing `PhoneVerificationAdapter` from
`@zero/framework/auth`. Its `id` is stable; `isReady()` reports readiness;
`start({ challengeId, phone, expiresAt, signal })` returns a private provider
reference; `verify({ ...request, reference, code })` returns a boolean. Optional
`cancel()` receives the same trusted request/reference.

Start must be idempotent by challenge ID, including retries after a restart.
Honor the supplied abort signal and the server's bounded provider wait. Do not
log codes, numbers, references or provider credentials. Browser payloads cannot
supply a provider reference or choose an adapter. Cancellation readiness is
projected independently from verify readiness.

Zero validates the number using the shared E.164 phone rules. Editing invalidates
old possession proof; accepting a new code verifies only the current generation
and does not resurrect an old number or challenge. No phone adapter means
verification is unavailable, not automatically successful.

## SDK, Revisions And UI

`client.userContacts` / `client.auth.contacts` expose `get`, `setPhone`,
`requestEmailVerification`, `requestEmailChange`, `requestPhoneVerification`,
`completePhone`, `cancelChallenge` and `completeEmail`. Account-bound methods
accept an optional abort signal and check the current response scope.

Authenticated routes live beneath `/auth/profile/contacts`. Ordinary mutations
carry `expectedRevision`; phone completion/cancellation also identify the exact
challenge. Email completion accepts its purpose-bound token anonymously.
Contact revisions are separate from profile/avatar revisions.

Contact admission also checks the shared [profile policy generation](./user-profiles.md#provisioning-and-safe-rollout).
A newer Guardian bootstrap retires an older contact service: its capabilities
become blocked, new ceremonies are rejected and a delayed adapter acceptance
cannot attach possession proof through that retired service. The final writer
rechecks the generation independently of contact revision and live session
authority. `AUTH_PROFILE_POLICY_CHANGED` (409) means use the current runtime;
restoring the old configuration does not revive its old in-flight callbacks.

Shutdown also retires contact admission before other workers drain and aborts
active phone-adapter requests. Retained handles report `AUTH_CONTACT_NOT_READY`;
an adapter that ignores abort cannot attach a late proof. The existing recovery
worker is still drained before Guardian storage disposal.

Snapshots distinguish `absent`, `unverified`, `pending`, `delivery-unavailable`,
`possession-verified` and `administratively-attested`. The packaged contact
section displays truthful proof badges, explicit phone Save/Cancel, the actual
pending candidate and separate code/reauthentication controls.

Per-channel `cancelReady` capabilities are independent of delivery readiness.
A permitted caller can still cancel a pending challenge when its email or phone
provider becomes unavailable. They do not grant cancellation to a read-only
native scope or another account.

Native callers require `profile`; email values additionally require `email`
and phone values require `phone`. A channel mutation also requires that channel's
read scope and explicit `contacts:write`. A generic profile read or
`profile:write` alone does not grant contact access. Existing native default
scopes are unchanged: register and request these additional ceilings explicitly.
An API key is not a contact-management session. A timeout is an ambiguous result:
retain the draft and review current state, rather than claim the write definitely
did not happen.

## Storage And Rollout

Migration 041 installs fixed private SYSTEM contact/proof/challenge storage and
the additional action-token purpose, preserving known constraints. It never
turns app-configured fields into arbitrary SQL. Migration-disabled or conflicting
storage is blocked without DDL or permissive fallback. Enabling the feature
does not infer possession from existing `emailVerifiedAt` values.

- [Email verification](./email-verification.md) documents the older login gate.
- [MFA](./mfa.md) remains a separate assurance ceremony.
- [Phone input](../../frontend/components/phone-input.md) owns formatting/UI only.
- [Errors](./errors.md) owns safe code presentation and observability.

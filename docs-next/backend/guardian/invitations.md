---
id: zero.guardian.invitations
type: how-to
audience: [developer, agent]
owner: guardian
status: draft
visibility: internal
system: guardian
feature: email-bound-invitations-and-acceptance
maturity: supported
applies_to: ["2.1.1 source; new documentation under review"]
modes: [multi-simple, multi-advanced]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Invite People Into An Organization

[Guardian index](./index.md) · [Documentation index](../../index.md)

An invitation is a durable, email-bound grant into one organization, with a
bounded role ceiling and one-time acceptance secret. It can join an existing
account or create the exact invited account when allowed. It does not grant
platform permissions merely because the user follows a link.

## Enable And Choose Delivery

Invitations are enabled by default in multi mode. Account creation defaults
true; lifetime defaults `7d`, maximum `30d`. Manual delivery is allowed by
default and is the selected default until email delivery is enabled.

```ts
import { defineAuthConfig } from '@zero/framework/auth';

export const auth = defineAuthConfig({
  tenancy: {
    mode: 'multi',
    onboarding: {
      invitations: {
        accountCreation: false,
        defaultTTL: '3d',
        maxTTL: '14d',
        delivery: { default: 'manual', allowManual: true },
      },
    },
  },
});
```

Email delivery requires enabled email capability, a public landing page
(default `/accept-invitation`), working app email/public URL and an
operator-owned 32-byte base64url wrapping key. Email outbox encryption is
distinct from password hashing, token signing and TOTP encryption.
During wrapping-key rotation, at most three distinct previous keys may be
provided for controlled rewrap; do not discard them while encrypted queued
work still depends on them.

## Issue And Review

The selected-org surface:

- `GET /auth/tenant/invitations`: filter pending/accepted/revoked/expired,
  bounded limit/cursor.
- `POST /auth/tenant/invitations`: `email`, optional `roles`,
  `expiresIn`, and `delivery: 'manual' | 'email'`.
- `DELETE /auth/tenant/invitations/:invitationId`: revoke.

Issuance requires `tenant.invitations:manage`; non-default role selection
also requires role-management authority and the actor's grant ceiling.
The default role is member in the ordinary org flow. Administration invitations
must deliberately select permitted roles; use the
[platform control plane](./control-plane.md) for its invitation operations.

Manual issuance returns `{ invitation, delivery, token }` with the raw token
once. Email issuance returns `delivery: { mode: 'email', status: 'queued' }`
and does not expose the raw token. Listing never recovers the secret.

Queue admission and invitation persistence are coordinated so a capacity/
readiness failure does not leave a silently undeliverable live invitation.
Provider retries are bounded outbox work, not browser-side resubmission loops.

## Inspect And Accept

`POST /auth/invitations/inspect` with `{ token }` returns the server-safe
invitation availability and intended organization context.

`POST /auth/invitations/accept` supports three request shapes:

| Shape | Identity proof |
| --- | --- |
| `{ token }` | Existing full session in Authorization. |
| `{ token, continuation }` | A valid pre-session identity continuation. |
| `{ token, username, email, password, firstName?, lastName?, mfaEnrollment? }` | Create the exact invited account when accountCreation permits it. |

The raw invitation token format is server-issued; do not invent or decode one.
The accepted identity must match the email-bound invitation, its current
account/security state and the granted organization. Acceptance is one-time,
scope-bound and checks retained grant validity against current policy.

## MFA And Completion

Invitation membership can create Administration/platform authority, so
completion re-enters the complete MFA decision after acceptance. Required
enrollment may first return `invitationAcceptancePending: true` alongside a
limited MFA flow. Completed acceptance reports
`invitationAccepted: true`, `acceptedTenant`, and the normal session/MFA/
tenant-completion result.

A pending invitation account is not an unrestricted signed-in user. Do not
treat `acceptedTenant` or an inspected role name as a completed token pair.
Use the auth client's supported continuation handling.

## Revocation And Verification

Expiration/revocation, issuer ceiling changes, target suspension and stale
policy can prevent acceptance. A retained invitation does not make its original
roles permanently grantable. The Administration Organization accepts app-only
and platform roles under their normal assignment rules; customer invitations
must never retain platform permissions.

Test wrong email, replay, concurrent acceptance, expired/revoked invitation,
changed grant ceiling, email queue failure, account-creation policy and required
MFA. Keep the raw token and email URL out of logs and analytics.

## Related Guides And Next Steps

- [Configuration](./configuration.md) gives exact startup inputs and interactions.
- [Registration](./registration.md) describes ordinary account creation separately.
- [RBAC](./rbac.md) explains grant ceilings and protected roles.
- [MFA](./mfa.md) covers deferred enrollment before full authority.
- [Join requests](./join-requests.md) is the applicant-initiated alternative.

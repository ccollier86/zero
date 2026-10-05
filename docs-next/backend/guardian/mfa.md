---
id: zero.guardian.mfa
type: how-to
audience: [developer, agent]
owner: guardian
status: draft
visibility: internal
system: guardian
feature: enrollment-challenges-and-assurance
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

# Enroll And Enforce Multi-Factor Authentication

[Guardian index](./index.md) · [Documentation index](../../index.md)

Guardian supports email OTP and authenticator TOTP enrollment and login
challenges. MFA is a durable assurance requirement on the admitted session,
not just a frontend switch that hides a submit button.

This guide includes an authorized development correction: reserved
`rememberDevice: true` and `recoveryCodes: true` now reject configuration with
`AUTH_CONFIG_UNSUPPORTED_FEATURE` (422). The corrected source is not yet a
release-qualified artifact. Omission/false remain compatible; this correction
does not implement remembered devices or recovery codes.

## Enable A Ready Method

```ts
import { defineAuthConfig } from '@zero/framework/auth';

const encryptionKey = process.env.APP_TOTP_ENCRYPTION_KEY;
if (!encryptionKey) throw new Error('TOTP encryption key is missing');

export const auth = defineAuthConfig({
  mfa: {
    enabled: true,
    policy: 'required',
    methods: ['totp'],
    totp: { issuer: 'Example Studio', encryptionKey },
  },
});
```

`APP_TOTP_ENCRYPTION_KEY` is an application-selected server environment name,
not an automatic Zero binding. Keep it durable and secret: existing encrypted
TOTP seeds cannot be decrypted by substituting a new unrelated key. Do not
rotate it as if it were a disposable session token.

Email OTP requires working account-email delivery. TOTP requires the configured
encryption key; seeds are encrypted at rest using AES-GCM. A configured method
and a ready method differ. `GET /auth/config` exposes safe configured methods,
`availableMethods` and `ready`, never the encryption key.

## Policy And Defaults

- MFA is disabled by default.
- Policy is `optional` by default; `required` enforces all users;
  `admin-required` enforces global admins and live Administration operators.
- A per-user `mfaRequired` flag can impose a requirement when MFA is enabled.
- Methods default to email + TOTP, user choice true, multiple methods false.
- Challenge TTL defaults `10m`, cooldown `1m`, maximum attempts 5.
- TOTP QR robustness defaults `M`; accepted values are L/M/Q/H.
- Remembered devices and recovery codes are not supported capabilities.

An Administration member holding only app roles is not automatically a
platform operator. Required-admin policy derives from actual authority,
not simply the organization's kind.

## Enforce It On An Existing App

You can enable required MFA for an account that has no enrolled method.
On the next successful password authentication, Guardian returns:

```json
{
  "mfaSetupRequired": true,
  "mfaSetupToken": "<limited setup credential>",
  "mfa": { "methods": ["totp"], "allowUserChoice": true }
}
```

The user can enroll before a full session is issued. It is not necessary to
pretend the user already has a method or to permanently reject their correct
password. A previously enrolled user instead receives a login challenge.
Existing sessions without required assurance must not retain unrestricted
access under the new policy.

Verify method readiness and the public enrollment UI before enforcing policy.
An optional enrollment rollout may still be useful operationally, but it is
not a required workaround for a missing login-time enrollment flow.

## Enrollment API

`POST /auth/mfa/setup` accepts:

```json
{"setupToken":"<mfaSetupToken>","method":"totp","label":"My authenticator"}
```

For a signed-in account's profile enrollment, omit setupToken and supply the
full session bearer credential. The response contains public `method`,
optional `challenge`, optional `totp` enrollment data and
`verificationToken`. TOTP setup data includes a secret and otpauth URL;
show them only in the enrollment ceremony, never in audit/log data.

Complete with `POST /auth/mfa/setup/verify`:
`{ verificationToken, code }`. Authentication-flow enrollment then completes
the normal session/tenant selection process; profile enrollment returns
`{ ok: true, method, methods }` and remains bound to the exact live initiating
session. Switching scope or losing authority before verification invalidates
that profile ceremony.

A method is not active simply because setup returned. Verification is the
commit that establishes it. Signing/delivery failure rolls back the precise
unfinished enrollment receipt.

## Login Challenge

With an active preferred method, authentication returns
`mfaChallengeRequired: true` and
`mfaChallenge: { method, challenge, challengeToken }`.
Submit `POST /auth/mfa/challenge/verify` with `{ challengeToken, code }`.

Successful verification produces durable `mfaVerifiedAt` assurance before
session completion. The short-lived challenge token is not an access JWT.
Wrong/expired codes, changed auth generation and stale profile authority are
rejected; retry/cooldown and attempt bounds are enforced by the challenge store.

`GET /auth/mfa/methods` requires a full session and returns public method
metadata plus the current `required` decision. Public metadata includes
method ID/type/label/status/primary and timestamps, never a persisted TOTP seed.
Do not claim unexposed self-service removal/primary-selection endpoints merely
because an internal method store can manipulate those rows.

## Administrator Requirement And Recovery

Under `/auth/admin/users/:userId/mfa`:

| Route | Effect |
| --- | --- |
| `GET /` (the base path) | Public-safe methods plus current requirement/source. |
| `POST /require` | Set the per-user requirement and invalidate existing sessions. |
| `POST /clear-requirement` | Clear only that per-user requirement; global policy remains. |
| `POST /reset` | Delete another eligible user's methods, invalidate challenges and revoke sessions. |

These actions require live platform user-management authority and target
guards. Reset is not a way to clear the global requirement; the next login
must re-enroll if policy still requires MFA. Protected owner/self-targeting
guards prevent unsafe administrative recovery.

## Verify And Observe

Test optional/required/admin-required policies, email readiness and TOTP key
readiness, unenrolled existing users, wrong/replayed codes, max attempts, async
delivery/signing failures, and revocation during profile enrollment. Check
scope replacement and native login preserve or demand current assurance.

Use standard `AUTH_MFA_*` and `AUTH_ADMIN_MFA_*` observability/audit events.
Never log codes, seeds, challenge/verification tokens or email bodies.

## Related Guides And Next Steps

- [Configuration](./configuration.md) gives exact startup inputs and interactions.
- [Login](./login.md) covers the earlier password/account gates.
- [Sessions](./sessions.md) explains durable assurance and token-family invalidation.
- [Control plane](./control-plane.md) defines administration recovery authority.
- [Native clients](./native-provider.md) use the same account/MFA policy.

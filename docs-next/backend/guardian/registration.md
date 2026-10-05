---
id: zero.guardian.registration
type: how-to
audience: [developer, agent]
owner: guardian
status: draft
visibility: internal
system: guardian
feature: self-service-registration
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

# Register Users And Their Initial Workspace

[Guardian index](./index.md) · [Documentation index](../../index.md)

Registration creates a canonical Guardian account. It may also create an
initial organization in multi mode, but it does not universally grant every
new account a workspace or immediately issue full authentication credentials.
Bootstrap, account verification, MFA policy and tenant selection each have
their own admission step.

## Ordinary Registration Policy

`auth.registration.mode` is `'public'` by default after bootstrap.

| Mode | Ordinary registration |
| --- | --- |
| `public` | Self-service accounts may register. |
| `admin-only` | Registration is closed; an authorized administrator creates accounts. |
| `disabled` | Registration is closed. |

Bootstrap uses its [own policy](./bootstrap.md), even when registration is
admin-only or disabled. Invitation acceptance has its own configured
account-creation policy; do not infer invitation availability solely from the
ordinary registration mode.

## Request Contract

`POST /auth/register` accepts:

| Field | Use |
| --- | --- |
| `username`, `email`, `password` | Required identity and password input. |
| `firstName`, `lastName` | Optional profile names. |
| `mfaEnrollment` | Optional request to enroll when MFA is enabled. |
| `organizationName`, `organizationSlug` | Optional one-step organization creation in multi mode; name required for multi bootstrap. |
| `nativeContinuation` | Continuation issued by the native authorization flow, not a client-invented redirect. |
| `bootstrapSecret` | Only for an empty installation using secret bootstrap. |

An ordinary account receives the normal global identity role, not the
application owner role. Application-specific property defaults are applied
by the server. The request does not accept arbitrary roles or trusted
authorization properties.

```http
POST /auth/register
Content-Type: application/json

{
  "username": "new-builder",
  "email": "builder@example.test",
  "password": "<user-chosen password>",
  "organizationName": "Example Studio",
  "mfaEnrollment": true
}
```

This example requires multi mode, permitted authenticated organization
creation, enabled MFA and at least one ready MFA method. Omit the organization
fields for an account that will join an existing organization. Supplying them
in single mode is rejected rather than ignored.

## Completion Is A State Machine

Do not treat every 200 response as “logged in.” The server may return:

- A verification-pending account when email verification is required.
- `mfaSetupRequired` and a short-lived `mfaSetupToken` for enrollment.
- `mfaChallengeRequired` and `mfaChallenge` transition information for an existing method.
- A tenant-selection or onboarding result when a multi-mode account does not
  yet have an admitted active membership.
- A completed identity with access/refresh tokens when all required gates pass.

Use Zero's auth client completion handling rather than manually assigning an
access token that may not exist. Limited MFA or tenant-selection credentials
are not API bearer tokens. Native continuation remains bound to the original
native authorization request throughout verification and enrollment.

Required email verification does not apply to the installation bootstrap
owner, preventing an unverified first-user lockout. It does apply to ordinary
registrations when configured, and requires working account-email delivery.
[Email verification](./email-verification.md) describes resends and completion.

## Organization Provisioning

When an ordinary multi-mode registration requests a new organization, the
configured creation policy is rechecked for the newly created user. The server
creates its owner membership and binds successful session completion to that
membership. The ordinary organization is distinct from the protected
Administration Organization created at bootstrap.

A provisioned organization can require Fabric readiness and identity anchors
before application writes. Do not bypass [identity projection](./identity-projection.md)
by assigning local application ownership to a guessed user ID or by creating
an unrelated tenant file from browser input.

## Atomicity And External Work

Registration first creates a provisional, leased server-owned provisioning
receipt. The service coordinates account, default properties, tenant ownership
and native continuation in its transaction. It then performs external
verification delivery or token signing and finalizes that receipt.

Failure is compensated using the exact provisioning receipt; crash recovery
does not blindly delete a username or organization that a later request may
have reused. Verification intent persists beyond the short compensation
receipt, including requested MFA enrollment and provisioned-tenant binding.

This is why applications should call the registration service/SDK rather than
directly insert into Guardian's system tables. A SQL user row alone is not a
completed account ceremony.

## Errors And Verification

`REGISTRATION_DISABLED` is a 403 policy result.
`BOOTSTRAP_*`, `TENANT_NAME_REQUIRED` and
`TENANT_CREATION_UNAVAILABLE` distinguish installation and topology errors.
Identity conflicts and validation failures are presented through the auth
error contract; do not expose raw database exception messages.

Verify public, admin-only and disabled policies separately; ordinary registration
must not acquire bootstrap ownership. Test verification delivery failure,
MFA-required completion and no-membership onboarding in disposable fixtures.
A multi-mode request that creates an organization must end with exactly that
organization's owner membership, not a global tenant-independent session.

## Related Guides And Next Steps

- [Configuration](./configuration.md) gives exact startup inputs and interactions.
- [Login](./login.md) describes credential gates after account creation.
- [MFA](./mfa.md) distinguishes enrollment from completed authentication.
- [Tenancy](./tenancy.md) covers create/select/switch behavior.
- [Invitations](./invitations.md) provides a different onboarding path.
- [User properties](./user-properties.md) describes configurable profile defaults.

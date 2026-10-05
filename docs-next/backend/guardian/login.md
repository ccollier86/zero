---
id: zero.guardian.login
type: how-to
audience: [developer, agent]
owner: guardian
status: draft
visibility: internal
system: guardian
feature: password-login
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

# Sign In And Complete Authentication

[Guardian index](./index.md) · [Documentation index](../../index.md)

Password login proves the user's current password and then evaluates live
account, MFA and tenant policy. A valid password alone does not bypass a
suspended account, verification requirement or missing organization membership.

## Request And Identity Lookup

`POST /auth/login` takes `{ username, password }`. Despite the field name,
`username` may contain the account's email address. Guardian recognizes email
identifiers and uses the canonical email identity lookup; other input uses
the username lookup.

```http
POST /auth/login
Content-Type: application/json

{"username":"builder@example.test","password":"<user password>"}
```

Login applies configured [request admission](./request-admission.md) before
credential verification. The service checks a password proof against the
current auth generation, reloads the user after the asynchronous password
check, and only then completes authentication. Do not cache a successful
password check across later suspension or password/security changes.

## Gates And Outcomes

The request rejects these current account states:

| Code | Status | Meaning |
| --- | --- | --- |
| `INVALID_CREDENTIALS` | 401 | Unknown identity or incorrect password. |
| `ACCOUNT_SUSPENDED` | 403 | The account is suspended. |
| `PASSWORD_CHANGE_REQUIRED` | 403 | A required password-change/setup flow must finish. |
| `EMAIL_VERIFICATION_REQUIRED` | 403 | Required email verification is unfinished. |

The generic credential error does not distinguish an unknown username from
a wrong password. Applications should not add an account-existence lookup
before login to make that distinction.

After these gates, login can return an MFA challenge, MFA setup requirement,
tenant selection/onboarding, or full session tokens. Follow the same
[completion state machine](./registration.md#completion-is-a-state-machine)
used by registration.

The user-property service applies missing configured defaults before projecting
the current user. This is not permission to let the login request set trusted
properties or roles.

## Page Sessions And The Client Session

Full browser completion synchronizes an HttpOnly page-session cookie alongside
the access/refresh family. This lets server-rendered protected pages resolve a
live identity on reload while the browser client restores its access token.

These are separate credentials with separate jobs:

- The page cookie is for safe page requests.
- Access tokens authenticate API calls.
- Refresh tokens rotate the browser session family.
- MFA setup/challenge tokens admit only their ceremony.

A logged-in page is not evidence that a hand-built API request has an
Authorization header. Use the authenticated Zero client for API calls and
allow its restoration lifecycle to complete. [Sessions](./sessions.md) explains
how to keep reload, logout and tenant switching consistent.

## Login Pages And Redirects

Managed routing uses the app-level `postLoginPath` (default `/`) as the fallback
after login and for already-authenticated visits to the login page. A safe
`redirect` return path takes precedence. Choose `/app` when that is the app's
authenticated landing page; postLoginPath must not resolve back to loginPath.
API login is not a generic
open-redirect endpoint, and the page-session cookie is not a substitute for
API authentication.

Never render stale authenticated rows behind an anonymous login screen.
Authorization readiness distinguishes “restoring,” “signed out” and a
ready authenticated data scope; a fully signed-out page must remain usable.

## Verification

With an active synthetic account, test username and email login, wrong
credentials, suspension, forced password change and required verification.
Enable required MFA for an unenrolled existing account and confirm that login
offers the enrollment flow rather than issuing a full session or permanently
locking out the user. In multi mode, verify the resulting active tenant is a
live admitted membership.

## Related Guides And Next Steps

- [Configuration](./configuration.md) gives exact startup inputs and interactions.
- [Sessions](./sessions.md) covers page cookies, restoration and revocation.
- [Password recovery](./password-recovery.md) handles forgotten/required passwords.
- [MFA](./mfa.md) covers setup and challenge completion.
- [Tenancy](./tenancy.md) explains no-membership and multiple-membership outcomes.

---
id: zero.guardian.password-recovery
type: how-to
audience: [developer, agent]
owner: guardian
status: draft
visibility: internal
system: guardian
feature: reset-setup-and-password-change
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

# Recover, Set Up And Change Passwords

[Guardian index](./index.md) · [Documentation index](../../index.md)

Guardian distinguishes forgotten-password recovery, administrator-created
first-password setup and a signed-in user's password change. Each has its own
proof and token lifecycle; an API key or page cookie does not substitute for
that proof.

## Forgotten Password

`POST /auth/forgot-password` accepts canonical `email` and optional
`nativeContinuation`. When reset email is enabled and delivery is ready, it
returns `{ ok: true }` without revealing whether an account exists.

The request queues bounded account-email outbox work rather than returning a
reset token to the anonymous caller. Queue failure emits the standard
`AUTH_EMAIL_OUTBOX_DEAD` code and still preserves the enumeration-resistant
public response. A 200 response means the request was accepted for public
handling, not that an email provider delivered a message.

Defaults: `auth.accountEmails.passwordReset: true`,
`actionTokenTTL: '1h'`, `requestCooldown: '5m'`,
`resetPath: '/reset-password'`. Delivery requires the app's email service.
Disabling reset email returns `PASSWORD_RESET_DISABLED` (403).

Complete a delivered reset using:

```http
POST /auth/reset-password
Content-Type: application/json

{"token":"<one-time action token>","newPassword":"<new user password>"}
```

This endpoint admits `password_reset` and `admin_password_reset` action types.
It checks the live user, consumes the exact one-time token and replaces the
password atomically. Suspension remains a rejection, not a way to recover
privileges through an old email.

Success returns `{ user, passwordUpdated: true, signInRequired: true }`.
It clears the page cookie and requires a new login; it does not issue a session
that bypasses MFA. The password/security transition invalidates previous
credentials.

## Administrator-Created First Password

An authorized administrator creates an account through
`POST /auth/admin/users`, using required `username`/`email` and optional
`password`, profile fields, configured properties and `sendSetupEmail`.
`auth.accountEmails.adminCreatedUser` defaults false; explicit
`sendSetupEmail` controls this request.

When setup delivery is requested, Guardian validates delivery readiness before
creating the account, generates provisional authority, binds an `account_setup`
action token, delivers setup instructions and finalizes the exact provisioning
receipt. Failure compensates that provisional account rather than silently
leaving a user who cannot complete setup.

`POST /auth/setup-password` accepts the same `{ token, newPassword }` shape
but only the `account_setup` action type. Success also requires a fresh login.
Do not use a reset token on the setup endpoint, or vice versa.

Requesting `passwordChangeRequired: true` on creation without setup delivery
is rejected with `PASSWORD_CHANGE_REQUIREMENT_REQUIRES_EMAIL` (409), preventing
an account that cannot reach a supported recovery ceremony.

## Inspect An Action Link

`GET /auth/action-token/:token` performs read-only inspection and returns
`valid`, action `type`, `expiresAt` and a limited user identity. Inspection
does not consume a token. Completion must still consume it exactly once and
recheck current account state.

These tokens are secrets despite appearing in link paths. Do not log the link,
send it to third-party analytics, cache its response publicly or persist it in
workflow scratch data.

## Signed-In Password Change

`POST /auth/change-password` requires a full live session and
`{ currentPassword, newPassword }`. It rechecks the current password and
session authority at commit, updates security generation and returns a fresh
`{ accessToken, refreshToken }` pair with a synchronized page cookie. In multi
mode the new pair preserves the admitted current tenant/membership binding.

`INVALID_PASSWORD` (400) means the current-password proof did not succeed.
Use the auth client's change-password handling to adopt the replacement
credentials; keeping the old access token after a successful update will not
preserve access.

## Administrator Recovery Actions

The session-only administrator surface provides:

| Endpoint below `/auth/admin/users/:userId` | Purpose |
| --- | --- |
| `POST /send-setup-email` | Start/restart supported first-password setup. |
| `POST /send-password-reset` | Send an administrator-initiated reset. |
| `POST /reset-password` with `{ password }` | Manual replacement when `manualPasswordReset` is enabled. |
| `POST /clear-password-change-requirement` | Clear an eligible recoverable requirement. |

Actor permissions, self-targeting/owner protections and current authority are
rechecked by the services. An organization manager's membership controls do
not automatically grant global password-reset authority.

Generic profile PATCH cannot newly set `passwordChangeRequired: true`.
Use the supported setup/reset email action so the user has a completion path.
Clearing a per-user condition is also not permission to disable a global policy.

`passwordChangedNotice` is reserved and resolves false in this source;
configuring it is not a supported committed-change email sender.

## Verify And Observe

Test expiration, replay, wrong action type, suspension during asynchronous
password hashing, failed delivery, and authority loss while an admin action
is pending. Accepted updates must invalidate old access/refresh/page authority,
and reset/setup must not skip required MFA at the next login.

Password reset completion emits `AUTH_PASSWORD_RESET_COMPLETED`; admin actions
emit their `AUTH_ADMIN_*` codes. Logs and audit records must not include
passwords, raw tokens or entire email URLs.

## Related Guides And Next Steps

- [Configuration](./configuration.md) gives exact startup inputs and interactions.
- [Login](./login.md) explains forced-change and verification gates.
- [Sessions](./sessions.md) explains replacement/revocation of credential families.
- [Email verification](./email-verification.md) uses a different action type.
- [Control plane](./control-plane.md) defines who may perform account actions.

# Platform Email And Account Lifecycle Plan

This plan extends Zero auth with platform email, password reset, forced
password-change flows, and production-ready admin user-management UI.

The first implementation is intentionally limited to system-owned auth/account
lifecycle email. The underlying provider boundary should be reusable later, but
Zero should not expose a broad developer-facing email/template API in this
slice.

## Decision

Zero should ship a platform email service with Resend as the default production
adapter.

The auth system must not depend directly on Resend. Auth depends on a small
platform `EmailProvider` interface. Apps can replace the provider with SES,
Postmark, SMTP, an internal service, a queue, or custom code without changing
auth routes.

## Implementation Status

Implemented foundation:

1. `EmailProvider` contract.
2. `EmailService` defaulting and validation wrapper.
3. Resend provider as the default when email is enabled.
4. Console, memory, and noop providers.
5. Process-wide email runtime configured by `createApp()`.
6. Server exports for providers, config, and runtime helpers.
7. Observability codes for configured/requested/sent/failed/preview events.
8. Auth action token storage with hash-only persistence.
9. Forgot-password, reset-password, setup-password, and action-token inspect routes.
10. Admin setup/reset email, suspend, and activate routes.
11. Forced password-change and suspended-account enforcement in login,
    refresh, auth middleware, and `requireAuth()` contexts.
12. SDK contracts for forgot/reset/setup flows.
13. `.env.example` and create-project env scaffolding for app identity,
    Resend, and auth token TTLs.
14. Production admin user-management UI, forgot/reset/setup components, and
    Platform Doctor checks for email-dependent auth config.
15. Canonical email identity across persistence, admin writes, login, and
    recovery, with enumeration-safe recovery responses and privacy-safe outcome
    events.
16. Delivery-only admin password gates, explicit stranded-gate recovery, and
    failed-delivery cleanup for action tokens, accounts, and email-MFA
    challenges.
17. Atomic, sessionless password reset/setup completion that requires a fresh
    login after the credential is committed.
18. Durable auth-email outbox for public recovery and verification-resend
    requests, with background eligibility lookup, just-in-time action tokens,
    provider idempotency keys, bounded retries, dead letters, and hot/file
    restart recovery.

Deferred:

1. Password-changed notification emails.
2. General app-owned email sending and runtime template management beyond the
   typed auth templates.

## Goals

1. Provide a default outbound email path for auth/account lifecycle.
2. Use Resend by default for production email delivery.
3. Let developers swap email delivery through dependency inversion.
4. Support admin-created users without exposing unsafe password handling by
   default.
5. Support user-initiated password reset from the login screen.
6. Support admin-triggered password reset/setup emails.
7. Force password change when an account is created or reset by an admin.
8. Wire the default admin user-management UI to real auth admin routes.
9. Keep login/register/reset UI aligned with `registration.mode` and email
   availability.
10. Keep the email boundary reusable for future platform-wide email features
    without exposing those features yet.

## Non-Goals

1. Marketing email campaigns.
2. Bulk newsletters.
3. General app/developer email sending APIs.
4. User-authored email template management.
5. User activity audit.
6. Full RBAC/tenant permissions.
7. SMS/OTP as the first implementation.

## Email Service Contract

The core service should live outside auth, likely under `src/email/`, because
email is a platform capability. In this slice, auth is the only consumer.

Recommended contract:

```ts
export interface EmailProvider {
  send(message: EmailMessage): Promise<EmailSendResult>;
}

export interface EmailMessage {
  to: string | string[];
  from?: string;
  replyTo?: string;
  subject: string;
  text: string;
  html?: string;
  tags?: Record<string, string>;
  metadata?: Record<string, unknown>;
}

export interface EmailSendResult {
  id?: string;
  provider: string;
  accepted: string[];
  rejected?: string[];
}
```

Default adapters:

| Adapter | Purpose |
| --- | --- |
| `ResendEmailProvider` | Default production adapter. Uses Resend API key/config. |
| `ConsoleEmailProvider` | Local development and tests. Emits through observability or captures in memory. |
| `NoopEmailProvider` | Explicitly disabled email. Useful for apps that do not want lifecycle emails. |
| Custom provider | User-supplied object implementing `EmailProvider`. |

When implementation starts, verify the current Resend SDK/API docs before
writing the adapter. The interface above should remain stable even if Resend's
SDK shape changes.

Do not add a public `client.email.send()` or broad server `email.send()`
developer API in this slice. Auth services should call the provider through an
internal account-email service so the first surface stays small and security
review stays focused.

## App Configuration

Zero needs basic app identity config because email subjects, sender names, and
links need app context.

Recommended `createApp()` shape:

```ts
createApp({
  app: {
    name: 'Acme CRM',
    publicUrl: 'https://crm.acme.test',
    supportEmail: 'support@acme.test',
  },

  email: {
    from: 'Acme CRM <noreply@acme.test>',
    provider: 'resend',
    resend: {
      apiKey: Bun.env.RESEND_API_KEY,
    },
  },

  auth: {
    registration: { mode: 'admin-only' },
    accountEmails: {
      adminCreatedUser: true,
      passwordReset: true,
      manualPasswordReset: false,
      actionTokenTTL: '1h',
      requestCooldown: '5m',
    },
  },
});
```

Provider override:

```ts
createApp({
  email: {
    from: 'Acme CRM <noreply@acme.test>',
    provider: {
      async send(message) {
        return myMailSystem.deliver(message);
      },
    },
  },
});
```

Configuration rules:

1. `email.provider: 'resend'` is the production default when email is enabled.
2. Apps may pass a custom provider object.
3. Tests and local development should be able to use a memory or console
   provider without a network call.
4. `accountEmails.passwordChangedNotice` remains reserved and resolves to
   `false` until password mutations have a committed-change notification sender.
5. `EMAIL_FROM`, `EMAIL_REPLY_TO`, and `RESEND_API_KEY` are runtime fallbacks
   when their explicit config values are omitted. Resend readiness requires a
   sender and API key; action-link email additionally requires `app.publicUrl`.
6. Production startup should warn or fail clearly when email-dependent auth
   features are enabled but no deliverable provider/from address exists. The
   platform doctor now performs these checks.
7. Email config should be exposed to admin UI only as safe capability flags,
   never API keys or provider secrets.

## Security Policy

Do not email raw passwords by default.

Admin-created users should receive an account setup email containing:

1. App name.
2. Username or email.
3. One-time setup link.
4. Expiration text.

The setup link lets the user set their password and then sign in. If the
platform keeps a temporary password path for legacy/manual workflows, it should
be opt-in and marked less secure.

Implemented delivery-only setup flow:

1. Admin creates user.
2. Zero validates real email readiness before creating the account.
3. User row is created without a password gate and Zero creates an
   `account_setup` action token for the next security generation.
4. The platform requires the provider boundary to accept the setup email's
   intended recipient.
5. Only successful delivery acceptance sets `password_change_required = 1`
   and revokes existing sessions. Failed delivery removes the token and the new
   account so the identity can be retried cleanly.
6. The user sets a password through the setup screen.
7. Zero atomically consumes the exact-cycle token, saves the password, clears
   the gate, revokes sessions, and returns a sessionless success response.
8. The user signs in with the new password; normal MFA policy runs during that
   fresh login.

For admin password reset:

1. Admin triggers reset.
2. Zero validates readiness, creates an exact-cycle one-time token, and sends
   the reset email before gating the account.
3. Only delivery acceptance sets `password_change_required = 1` and revokes
   sessions; failure deletes the token and leaves the existing account usable.
4. The user sets a new password through the reset screen, receives no session
   from that commit, and signs in again.
5. If an older deployment or operational mistake already stranded another
   account, an administrator can use the confirmed clear-requirement recovery
   action without changing the user's password.

For authenticated password change:

1. User submits current password and new password.
2. Platform changes the password and revokes refresh tokens.
3. Password-changed notification email remains deferred; the public config does
   not advertise it as ready.

For forgot password:

1. User submits email on login/forgot-password screen.
2. Zero trims/lowercases the email, durably enqueues the same class of local
   work for every valid address, and returns the same generic success response
   without waiting for account lookup or the email provider.
3. A background worker privately resolves eligibility, creates an action token
   only immediately before delivery, and removes that token after a failed
   attempt.
4. Transient failures use bounded exponential backoff. Provider rejection and
   exhausted retries become scrubbed dead letters; completed rows also discard
   the address and native continuation.
5. Unknown, suspended, cooldown-limited, provider-failed, and delivered
   outcomes are distinguished only through privacy-safe events that omit the
   submitted address, continuation, provider error text, and raw token.
6. Per-address request windows plus active and total queue caps bound abuse and
   storage. Expired leases recover after process failure, and both file and hot
   SQLite modes preserve pending work across a graceful restart.
7. Graceful shutdown aborts provider work, removes the undelivered action token,
   releases the job without consuming an attempt, and joins the worker before
   ReactiveDB or the owned SQLite service is disposed.

Public verification resend uses the same outbox. Registration, admin lifecycle,
and MFA delivery remain synchronous because those flows must know whether
delivery succeeded before committing an account gate or returning a challenge.

Delivery is intentionally at least once across an ambiguous provider/network
failure. Zero never persists a raw action token merely to make retries easier.
Instead it removes the uncertain attempt's token and retries with a fresh token
and a per-attempt provider idempotency key. A provider that accepted the first
request before its response was lost may therefore deliver two messages; the
older link is invalid and only the newest link works. This favors recoverability
without weakening hash-only token storage.

If the process exits before it can classify or clean the attempt, lease recovery
also creates and sends a fresh token. Outbox delivery bypasses the action-token
cooldown because the durable per-address request window is already its admission
control; otherwise a crash-left hash could silently suppress the retry. In that
narrow crash window both links can remain valid until a password transition or
email verification completes. Both transitions bump the account security
generation and invalidate every sibling link and pre-transition session.

The queue's per-address window and global active/total caps bound local work and
storage. The zero-configuration defaults admit 5,000 active jobs, retain at
most 50,000 total rows, and dead-letter after 10 delivery attempts. Capacity is
privately suppressed behind the same generic response. These instance caps
cannot fairly identify an attacker rotating arbitrary email
addresses. Production ingress should additionally rate-limit
`/auth/forgot-password` and `/auth/resend-verification` by a trusted client
source. Do that at the shared edge for multi-replica deployments. Zero must not
blindly trust a public `X-Forwarded-For` header because an attacker can forge it.
5. A delivery failure deletes the token so an immediate retry is not blocked by
   the cooldown.
6. Token consumption atomically sets the new password, clears any gate, revokes
   existing sessions, and requires a fresh login.

## Database Additions

Recommended user columns:

```sql
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN password_change_required INTEGER NOT NULL DEFAULT 0;
```

Current action token storage:

```sql
CREATE TABLE IF NOT EXISTS _zero_action_tokens (...);
```

Auth reset/setup links now use the generic platform action-token service.
`_auth_action_tokens` remains as a legacy compatibility table so previously
issued reset/setup emails can still be inspected and consumed until they expire.

Token types:

| Type | Purpose |
| --- | --- |
| `account_setup` | New admin-created user sets first password. |
| `password_reset` | User-initiated forgot-password flow. |
| `admin_password_reset` | Admin-triggered reset/forced change. |
| `email_verification` | Registration and resend-verification flow. |

Tokens must be opaque random values. Store only hashes. Expire tokens and mark
them consumed when used, and require the account's exact auth generation so an
older link cannot revive during a later recovery cycle. The action-token
service also enforces
`auth.accountEmails.requestCooldown` for active tokens of the same user and
type, opportunistically cleans expired/consumed records, and physically removes
an undelivered token so its cooldown does not block retry.

## Auth Route Additions

Public routes:

```txt
POST /auth/forgot-password
POST /auth/reset-password
GET  /auth/action-token/:token
POST /auth/setup-password
```

Admin routes:

```txt
POST /auth/admin/users/:userId/send-setup-email
POST /auth/admin/users/:userId/send-password-reset
POST /auth/admin/users/:userId/clear-password-change-requirement
POST /auth/admin/users/:userId/suspend
POST /auth/admin/users/:userId/activate
```

Existing admin direct reset remains available for compatibility and manual
workflows, but it is configurable through
`auth.accountEmails.manualPasswordReset`. The preferred admin action sends a
reset/setup email and forces password change instead of setting a permanent
password for the user.

## Login Behavior

Login must account for user status and forced password changes:

| State | Login behavior |
| --- | --- |
| `active` and no forced change | Normal token pair. |
| `active` with `password_change_required` | Return `PASSWORD_CHANGE_REQUIRED`; do not grant normal app access. The user must use a delivered setup/reset link or request a new reset email. |
| `suspended` | Reject with `ACCOUNT_SUSPENDED`; revoke refresh tokens when suspended. |
| deleted | User no longer exists; credentials and tokens cascade. |

The forced-change state is intentionally email-link-only. Login never issues a
token that could bypass proof of mailbox access. Administrators cannot newly
enable the state through a generic user PATCH; they use setup/reset delivery,
or explicitly clear an already-stranded gate for another user.

## Email Templates

Platform templates should be plain functions with typed inputs:

```ts
interface AccountEmailTemplateContext {
  appName: string;
  publicUrl: string;
  actionUrl: string;
  user: {
    userId: string;
    username: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  };
  actor?: {
    userId: string;
    email: string;
  };
  expiresAt: number;
}
```

Default templates:

1. Admin created your account.
2. Set up your password.
3. Reset your password.
4. Password changed.
5. Account suspended.
6. Account reactivated.

Apps should be able to override subject/text/html per template.

For this slice, template overrides should be limited to auth/account lifecycle
templates. A later platform-wide email system can add reusable developer
templates, template registries, previews, and app-level send APIs.

## Deferred: Platform-Wide Email

Later, Zero should promote email into a general platform feature:

1. Developer-defined email templates.
2. Template variables with typed context.
3. Preview/render helpers.
4. `server.email.send()` or equivalent server-side API.
5. Optional queue/retry/delivery status tracking.
6. Template-specific observability and delivery logs.
7. Optional user/admin UI for template configuration.

That future system should reuse the `EmailProvider` contract and Resend default
adapter created here, but it should be planned as a separate platform service.

## Admin UI Requirements

The reusable `UserManagement` organism is the default production admin surface.
It is intentionally not a page; apps embed it inside their own dashboards or
settings views. The organism should support:

1. Load users from `/auth/admin/users` with backend pagination, search, role
   filters, and status filters.
2. Load config from `/auth/admin/config`.
3. Create users.
4. Apply configured user property controls.
5. Show status (`active`, `suspended`).
6. Suspend and reactivate users.
7. Delete users with confirmation and last-admin protection.
8. Send setup email.
9. Send password reset email.
10. Confirm and clear an already-stranded password-change requirement.
11. Revoke sessions.
12. Show real email readiness rather than the configured switch alone.
13. Fall back cleanly when email is disabled or incomplete.

The UI should not show unavailable actions. For example, if email is disabled,
show manual password/reset controls or a clear disabled state instead of a
button that will fail.

## Auth UI Requirements

Login and account pages should support:

1. Registration link visibility based on `/auth/config`, with policy-aware UI
   waiting for config before exposing registration actions.
2. Forgot-password link only when password reset email is enabled, with the
   reset request form waiting for config before rendering.
3. Forgot-password form wired to `/auth/forgot-password`.
4. Reset-password form for emailed reset/setup tokens that blocks invalid or
   mode-mismatched tokens before submit.
5. A `PASSWORD_CHANGE_REQUIRED` login state that directs the user to the
   delivered link or forgot-password flow instead of a tokenless setup screen.
6. Password-changed success state that returns the user to login.
7. Clear generic reset messaging that does not reveal account existence.

## Observability

Add stable codes for:

1. Email send requested.
2. Email sent.
3. Email failed.
4. Email provider missing/misconfigured.
5. Auth action token created.
6. Auth action token consumed.
7. Auth action token rejected/expired.
8. Account suspended/reactivated.
9. Password reset requested.
10. Password reset delivered, suppressed, or failed delivery.
11. Password reset completed.
12. Administrator password gate set or explicitly recovered.

Do not log raw tokens, reset URLs, passwords, submitted recovery addresses, or
provider secrets.

## Implementation Phases

### Phase 1: Email Service Foundation

1. Add email config types.
2. Add `EmailProvider` contract.
3. Add Resend provider as default production adapter.
4. Add console/memory provider for development/tests.
5. Export provider types/helpers from the server barrel, but keep auth as the
   only built-in consumer.
6. Add observability codes and tests.

### Phase 2: Auth Action Tokens

Status: implemented.

1. Add migrations for `users.status`, `users.password_change_required`, and
   action token storage.
2. Add service methods for action token creation, verification, consumption,
   compatibility fallback, and cleanup.
3. Add service unit tests.

### Phase 3: Password Reset And Setup Routes

Status: implemented.

1. Add forgot-password route.
2. Add setup/reset-password routes.
3. Add generic responses and token expiration.
4. Send reset/setup emails through platform email service.
5. Update login behavior for forced password changes and suspended users.

### Phase 4: Admin Lifecycle Routes

Status: implemented.

1. Add suspend/reactivate routes.
2. Add send setup/reset email routes.
3. Keep direct admin `reset-password` as an explicitly configurable manual
   recovery path and add the confirmed gate-clear recovery route.
4. Revoke refresh tokens on reset/suspend.
5. Gate only after delivery acceptance and remove undelivered tokens/accounts.

### Phase 5: Frontend SDK And UI

Status: implemented.

1. Add SDK methods for forgot/reset/setup and admin email actions.
2. Wire `ForgotPasswordForm`.
3. Add reset/setup password screen component.
4. Convert default user-management UI from mock-backed to route-backed.
5. Keep auth UI registration/reset links aligned with config capabilities.

### Phase 6: Docs, Doctor, And Examples

1. Document Resend default config.
2. Document custom provider adapter.
3. Add platform doctor checks for missing `from`, missing public URL, and
   email-enabled auth flows without provider config.
4. Add example app config.
5. Update all auth/admin UI docs.
6. Call out that arbitrary app email sending and reusable template management
   are deferred to the platform-wide email phase.

### Final Documentation Pass

After the backend and frontend auth/account lifecycle work is complete, add a
high-level Start Here guide for new Zero apps. It should cover:

1. `createApp()` and the important app/auth/email/sync/storage options.
2. Registration modes and first-admin bootstrap.
3. Resend default email config and custom provider replacement.
4. Database model design.
5. Primary key requirements.
6. Natural identity/composite-key workaround patterns.
7. When to use configured user properties, storage, notifications, and sync.
8. Built-in platform services: cache/state, ReactiveDB/sync, file storage,
   workflows, notifications, rooms/presence, migrations, observability, auth,
   and system email.
9. How these built-ins reduce the need for separate app servers or services in
   common projects.
10. The recommended blank-app starting structure and config files.

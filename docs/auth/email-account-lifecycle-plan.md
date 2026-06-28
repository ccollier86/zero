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

Not implemented yet:

1. Real admin user-management UI wiring.
2. Forgot/reset/setup React components and route screens.
3. Platform doctor checks for email-dependent auth config.
4. Password-changed notification emails.

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
      passwordChangedNotice: true,
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
4. Production startup should warn or fail clearly when email-dependent auth
   features are enabled but no deliverable provider/from address exists. The
   platform doctor now performs these checks.
5. Email config should be exposed to admin UI only as safe capability flags,
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

Recommended default:

1. Admin creates user.
2. User row is created with `password_change_required = 1`.
3. Platform creates an `account_setup` action token.
4. Platform sends setup email with a direct link.
5. User sets password through the setup screen.
6. Platform clears `password_change_required` and issues normal tokens.

For admin password reset:

1. Admin triggers reset.
2. Existing refresh tokens are revoked.
3. `password_change_required = 1`.
4. Platform sends a reset email with a one-time token.
5. User sets new password through the reset screen.

For authenticated password change:

1. User submits current password and new password.
2. Platform changes the password and revokes refresh tokens.
3. Platform sends a password-changed notification email when configured.

For forgot password:

1. User submits email on login/forgot-password screen.
2. Platform always returns a generic success response.
3. If a user exists and email is enabled, platform sends a one-time reset link.
4. Token consumption sets the new password and revokes existing refresh tokens.

## Database Additions

Recommended user columns:

```sql
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN password_change_required INTEGER NOT NULL DEFAULT 0;
```

Recommended action token table:

```sql
CREATE TABLE IF NOT EXISTS _auth_action_tokens (
  token_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  metadata TEXT,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_auth_action_tokens_hash
  ON _auth_action_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_auth_action_tokens_user
  ON _auth_action_tokens(user_id);
```

Token types:

| Type | Purpose |
| --- | --- |
| `account_setup` | New admin-created user sets first password. |
| `password_reset` | User-initiated forgot-password flow. |
| `admin_password_reset` | Admin-triggered reset/forced change. |
| `email_verification` | Optional later email verification flow. |

Tokens must be opaque random values. Store only hashes. Expire tokens and mark
them consumed when used. The action-token service also enforces
`auth.accountEmails.requestCooldown` for active tokens of the same user and
type, and opportunistically cleans expired/consumed records.

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
| `active` with `password_change_required` | Return a structured `PASSWORD_CHANGE_REQUIRED` response or short-lived change token; do not grant normal app access. |
| `suspended` | Reject with `ACCOUNT_SUSPENDED`; revoke refresh tokens when suspended. |
| deleted | User no longer exists; credentials and tokens cascade. |

The exact forced-change flow should favor emailed action links, but a temporary
password login path can be supported if configured.

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

The default `UserManagementPage` should stop being mock-backed for production
usage and support:

1. Load users from `/auth/admin/users`.
2. Load config from `/auth/admin/config`.
3. Create users.
4. Apply configured user property controls.
5. Show status (`active`, `suspended`).
6. Suspend and reactivate users.
7. Delete users with confirmation and last-admin protection.
8. Send setup email.
9. Send password reset email.
10. Revoke sessions.
11. Show whether email is configured/enabled.
12. Fall back cleanly when email is disabled.

The UI should not show unavailable actions. For example, if email is disabled,
show manual password/reset controls or a clear disabled state instead of a
button that will fail.

## Auth UI Requirements

Login and account pages should support:

1. Registration link visibility based on `/auth/config`.
2. Forgot-password link only when password reset email is enabled.
3. Forgot-password form wired to `/auth/forgot-password`.
4. Reset-password form for emailed reset/setup tokens.
5. Forced password-change screen when login indicates it is required.
6. Password-changed success state.
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
10. Password reset completed.

Do not log raw tokens, reset URLs, passwords, or provider secrets.

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
   `_auth_action_tokens`.
2. Add store methods for action token creation, verification, consumption, and
   cleanup.
3. Add service unit tests.

### Phase 3: Password Reset And Setup Routes

Status: implemented for backend routes and SDK contracts; UI remains Phase 5.

1. Add forgot-password route.
2. Add setup/reset-password routes.
3. Add generic responses and token expiration.
4. Send reset/setup emails through platform email service.
5. Update login behavior for forced password changes and suspended users.

### Phase 4: Admin Lifecycle Routes

Status: implemented for backend routes; admin UI remains Phase 5.

1. Add suspend/reactivate routes.
2. Add send setup/reset email routes.
3. Decide whether existing direct admin `reset-password` remains, is renamed,
   or becomes explicitly manual-only.
4. Revoke refresh tokens on reset/suspend.

### Phase 5: Frontend SDK And UI

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

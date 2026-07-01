# Auth System

**Register. Login. It's reactive.**

A standalone authentication primitive — self-hosted, single Bun process, shared ReactiveDB. Register a user, they're immediately visible to every connected client. Change a role, every subscriber sees it instantly. Argon2id passwords, ES256 JWTs, stateless verification. No session cookies, no external auth service, no plumbing.

## The Full Loop

```ts
// ─── Server: auth + sync, shared database ─────────────

import { Elysia } from 'elysia';
import { createSyncPlugin } from './sync';
import { createAuthPlugin, createAuthMiddleware, getTokenService } from './auth';

const db = createReactiveDB({ mode: 'memory' });

new Elysia()
  .use(createAuthPlugin({ db }))
  .use(createAuthMiddleware(getTokenService))
  .use(createSyncPlugin({
    db,
    tables: {
      todos: { id: 'text primary key', title: 'text not null', done: 'integer default 0' },
    },
  }))
  .listen(3000);

// POST /auth/register, /auth/login, /auth/refresh, /auth/logout, /auth/change-password
// GET  /auth/me, /auth/jwks
// WS   /sync (reactive — users table changes broadcast to clients)
```

```ts
// ─── Client: register and use ─────────────────────────

// Register
const { accessToken, refreshToken, user } = await fetch('/auth/register', {
  method: 'POST',
  body: JSON.stringify({ username: 'alice', email: 'alice@example.com', password: 's3cret!' }),
}).then(r => r.json());

// user = { userId: 'u_...', username: 'alice', email: 'alice@example.com', role: 'user', ... }

// Use token for authenticated requests
const me = await fetch('/auth/me', {
  headers: { Authorization: `Bearer ${accessToken}` },
}).then(r => r.json());

// Refresh when access token expires
const { accessToken: newAccess, refreshToken: newRefresh } = await fetch('/auth/refresh', {
  method: 'POST',
  body: JSON.stringify({ refreshToken }),
}).then(r => r.json());
```

```tsx
// ─── React: user data is live ─────────────────────────

function UserProfile({ userId }: { userId: string }) {
  const { row: user } = useRow('users', userId);
  if (!user) return null;

  // Role changed by admin? This re-renders automatically.
  // Profile updated? Same — zero polling, zero manual refresh.
  return (
    <div>
      <h2>{user.first_name} {user.last_name}</h2>
      <span>{user.role}</span>
      <span>{user.email}</span>
    </div>
  );
}
```

Register a user — every client subscribed to the `users` table sees them appear. Admin changes a role — every subscriber reflects it instantly. No `refetch()`, no `invalidateQueries()`. The auth system writes to the same ReactiveDB that the sync engine broadcasts from.

## Core Properties

| Property | What it means |
|----------|--------------|
| **Argon2id passwords** | `Bun.password.hash()` — native, zero dependencies, memory-hard |
| **ES256 JWTs** | ECDSA P-256 via `jose` — compact, fast verification, JWKS-compatible |
| **Stateless verification** | Access tokens verified with public key only — no DB lookup per request |
| **Reactive user rows** | User profile and role changes use ReactiveDB; properties are joined into auth payloads |
| **Revocable refresh** | Refresh tokens are opaque UUIDs, SHA-256 hashed in DB, rotated on use |
| **Persistent sessions** | Browser clients restore from the stored refresh token, refresh access tokens on 401, and reconnect sync with the latest token |
| **Zero sensitive broadcast** | Password hashes live in `_credentials` (internal table) — never broadcast |

## Session Persistence

Access tokens are intentionally short-lived and kept only in memory. The
browser SDK stores the opaque refresh token in `localStorage` so a reload can
restore the session without making the user log in again.

The SDK handles the normal lifecycle:

1. On startup, it exchanges the stored refresh token for a fresh access token.
2. Authenticated HTTP calls retry once after a 401 by refreshing the access token.
3. The sync WebSocket reads the current access token whenever it opens or reconnects.
4. Login, registration, and refresh reconnect sync with the latest token.
5. Logout or an unrefreshable 401 clears auth state and resets local synced table/state data.

`AppProvider` also guards protected client routes when auth is enabled. If a
session cannot be restored or a refresh token is rejected, protected routes are
redirected to the configured login path with a `redirect` query string.
Configure public paths and the login route in `createApp()` or override them on
`<AppProvider publicPaths={...} loginPath="/login" />`.

## Route Auth Modes

Zero supports two page-route auth strategies when `auth` is enabled.

Protected-first apps use the default:

```ts
createApp({
  auth: true,
  routeAuth: 'protected-by-default',
  publicPaths: ['/login', '/register', '/forgot-password'],
  loginPath: '/login',
});
```

Every page route requires auth unless it matches `publicPaths`. This is best
for internal dashboards and admin tools.

Public-first apps should opt into route-owned auth:

```ts
createApp({
  auth: true,
  routeAuth: 'explicit',
  loginPath: '/login',
});
```

In explicit mode, pages are public unless a page or layout exports auth config:

```tsx
import type { RouteConfig } from '@zero/framework/react';

export const config: RouteConfig = {
  auth: 'required',
};
```

Use this for apps where `/` is public, such as appointment request, intake,
marketing, or token-resume flows, while `/dashboard/*` remains protected.

Layout/page `config.auth` is server-enforced before rendering. The browser
hydration runtime also tracks the matched route auth requirement. If the user
logs out, a refresh token is rejected, or auth becomes unauthenticated while on
a protected route, `AppProvider` removes the protected subtree from the screen
and redirects to `loginPath?redirect=<current-url>`.

## Stack

| Component | Technology | Role |
|-----------|-----------|------|
| Password hashing | `Bun.password` (Argon2id) | Native, zero deps — built into Bun runtime |
| JWT signing/verification | `jose` | ECDSA P-256, JWKS export, one dependency |
| Database | bun:sqlite (shared ReactiveDB) | Users, credentials, tokens, config — same instance as sync |
| HTTP framework | Elysia plugin | Routes, derive, lifecycle hooks, composable |

## What This Is

A **standalone auth primitive** that composes with the sync engine. It owns user identity (registration, login, password verification, JWT issuance) and stores user data in the same reactive database that powers real-time sync. When you change a user's role, every connected client sees it immediately — not because auth has special broadcast logic, but because it writes to ReactiveDB and the sync engine handles the rest.

**Designed for:**
- Applications already using the sync engine that need user identity
- Small teams (2–4 users) where a managed auth service is overkill
- Prototypes that need secure auth without infrastructure
- Any app where user state should be as reactive as application state

## What This Is NOT

- **Not an identity provider.** No OAuth flows, no SAML, no social login. It's username/password auth with JWTs. Add OAuth on top if you need it.
- **Not multi-tenant.** Single database, single namespace. All users share one `users` table.
- **Not a permissions framework.** It provides `role` on the user, configurable user properties, and `authContext` in middleware. Row-level access control and deeper RBAC policies remain application code on top.
- **Not a hosted admin product.** It ships admin user-management routes and a reusable `UserManagement` dashboard organism, but apps still choose where that component lives and how the rest of the admin dashboard is composed.

## Comparison

| | Firebase Auth | Lucia | This |
|---|--------------|-------|------|
| **Hosting** | Managed cloud | Self-hosted | Self-hosted, single process |
| **Database** | Proprietary | Any SQL/NoSQL | bun:sqlite (shared ReactiveDB) |
| **Reactivity** | Snapshot listeners | None built-in | Automatic — writes broadcast via sync engine |
| **Password hashing** | Managed | Configurable (bcrypt, scrypt, argon2) | Argon2id via Bun.password (native) |
| **Token format** | Proprietary | Session-based | Standard JWT (ES256), JWKS endpoint |
| **Dependencies** | Firebase SDK | lucia + adapter | jose (one dep) |
| **Scale** | Millions | Any | 2–4 concurrent users |
| **Result** | Same auth fundamentals for the target use case — secure identity with minimal code |

## Integration with Sync Engine

The auth system and sync engine share a **single ReactiveDB instance**. Auth defines its tables (`users`, `user_properties`, `_credentials`, `_refresh_tokens`, `_auth_config`) in the same database the sync engine uses, while only ReactiveDB-managed public tables broadcast as live table streams. No bridge, no event forwarding, no extra plumbing.

```
                    Shared ReactiveDB
                  ┌───────────────────────────────────────┐
                  │                                       │
  Auth Plugin ──► │  users (public)         ── broadcast  │ ◄── Sync Plugin
  defineTable()   │  user_properties        ── direct SQL │     onChange → publish
                  │  _credentials           ── internal   │
                  │  _refresh_tokens        ── internal   │
                  │  _auth_config           ── internal   │
                  │                                       │
  Sync Plugin ──► │  todos (public)         ── broadcast  │
  defineTable()   │  projects (public)      ── broadcast  │
                  │  _changes               ── internal   │
                  │                                       │
                  └───────────────────────────────────────┘
```

**Reactive public tables** (`users`, app tables, and other single-PK platform tables) — changes broadcast to subscribed WebSocket clients via the sync engine's `onChange → server.publish()` path.

`user_properties` is created with raw SQL because it uses a composite primary
key `(user_id, key)`. Auth joins those properties into `/auth/me`, login,
register, and admin user responses, but property mutations are not a standalone
ReactiveDB table stream.

**Internal tables** (`_` prefix) — changes tracked in the ring buffer for seq continuity but never broadcast. The `_` prefix convention is established by ReactiveDB's `_changes` table. Auth extends it to `_credentials`, `_refresh_tokens`, and `_auth_config`.

See [Architecture](./architecture.md) for the full component diagram and data flow.

## Design Documents

| Document | What it covers |
|----------|---------------|
| [Architecture](./architecture.md) | Plugin structure, Elysia integration, data flow, composition with sync engine |
| [User Store](./user-store.md) | SQLite schema, CRUD, properties KV, password hashing with Bun.password |
| [Token Service](./token-service.md) | JWT lifecycle, ECDSA keypair management, refresh rotation, JWKS |
| [Guards & Audit](./guards-and-audit.md) | Role-based route protection, automatic activity tracking (routes, data access, mutations, sessions) |
| [Admin User Management](./admin-user-management-plan.md) | Implemented registration policy, admin user routes, configured user properties, and UI gate contract |
| [Email And Account Lifecycle](./email-account-lifecycle-plan.md) | Platform email foundation, Resend default adapter, and planned reset/setup flows |
| [Metadata, Access Control, And Avatars Plan](./metadata-access-avatar-plan.md) | Planned configurable authz metadata, policy helpers, tenancy, adaptive admin UI, storage-backed avatars |

## File Organization

```
src/auth/
├── auth.plugin.ts              # Public auth routes, lifecycle, table setup
├── auth-admin.plugin.ts        # Admin-only user-management routes
├── auth.middleware.ts          # Stateless JWT verify, authContext, requireAuth/requireAdmin
├── auth-config.ts              # Auth config helper and normalization
├── auth-context.ts             # Authorization header to AuthContext helper
├── token-service.ts            # JWT signing/verification, keypair mgmt, refresh rotation
├── user-property-service.ts    # Configured user property validation/defaults
├── user-store.ts               # SQLite operations: users, credentials, properties, tokens
├── types.ts                    # AuthContext, UserRecord, TokenPair, config, AuthError
└── index.ts                # Public API: all exports
```

Single responsibility per file: routes stay in Elysia plugins, validation and
defaults live in services, and SQL stays in `UserStore`.

## Registration And Admin Users

The first account is a bootstrap path:

1. If there are zero users, `POST /auth/register` is always available.
2. The first registered user always receives role `admin`.
3. After bootstrap, `auth.registration.mode` controls public registration.

```ts
createApp({
  app: {
    name: 'Acme CRM',
    publicUrl: Bun.env.APP_PUBLIC_URL ?? 'http://localhost:3000',
  },
  email: Bun.env.RESEND_API_KEY
    ? {
        from: Bun.env.EMAIL_FROM ?? 'Acme CRM <noreply@example.com>',
        replyTo: Bun.env.EMAIL_REPLY_TO,
        provider: 'resend',
        resend: { apiKey: Bun.env.RESEND_API_KEY },
      }
    : false,
  auth: {
    registration: { mode: 'admin-only' },
    accountEmails: {
      adminCreatedUser: Boolean(Bun.env.RESEND_API_KEY),
      passwordReset: Boolean(Bun.env.RESEND_API_KEY),
      manualPasswordReset: Bun.env.AUTH_MANUAL_PASSWORD_RESET !== 'false',
      actionTokenTTL: Bun.env.AUTH_ACTION_TOKEN_TTL ?? '1h',
      requestCooldown: Bun.env.AUTH_ACCOUNT_EMAIL_COOLDOWN ?? '5m',
    },
  },
});
```

Supported post-bootstrap modes:

| Mode | Behavior |
| --- | --- |
| `public` | Public `/auth/register` remains open and creates `user` accounts. |
| `admin-only` | Public registration is closed; admins create users through `/auth/admin/users`. |
| `disabled` | Public and platform admin creation are closed after bootstrap. |

Public UI can read:

```txt
GET /auth/config
```

Admin UI can read and manage:

```txt
GET    /auth/admin/config
GET    /auth/admin/users?limit=50&offset=0&search=ops&role=user&status=active
GET    /auth/admin/users/:userId
POST   /auth/admin/users
PATCH  /auth/admin/users/:userId
DELETE /auth/admin/users/:userId
PUT    /auth/admin/users/:userId/properties/:key
PATCH  /auth/admin/users/:userId/properties
DELETE /auth/admin/users/:userId/properties/:key
POST   /auth/admin/users/:userId/reset-password
POST   /auth/admin/users/:userId/send-setup-email
POST   /auth/admin/users/:userId/send-password-reset
POST   /auth/admin/users/:userId/suspend
POST   /auth/admin/users/:userId/activate
POST   /auth/admin/users/:userId/revoke-sessions
```

Admin routes require an admin Bearer token. Deleting or demoting the last admin
is rejected. `GET /auth/admin/users` is paginated and supports `search`,
`role`, and `status` filters. Direct password resets remain available for
manual workflows by default, revoke existing refresh tokens, and can be disabled
with `auth.accountEmails.manualPasswordReset: false`. The preferred
email-driven reset/setup routes create one-time platform action tokens, send
account lifecycle email through the platform email service, mark the account as
requiring a password change, and revoke existing sessions.

The frontend barrel exports a ready-to-embed admin organism. It is not a page;
place it inside whatever dashboard, tab, or settings view the app owns:

```tsx
import { UserManagement } from '@zero/framework/react';

function AdminUsersPanel() {
  return <UserManagement className="h-[720px]" />;
}
```

`UserManagement` loads `/auth/admin/config` and `/auth/admin/users`, creates and
updates users, promotes admins through the `role` field, suspends/reactivates
accounts, deletes users with confirmation, revokes sessions, sends setup/reset
emails when configured, and adapts configured `auth.userProperties` into admin
property controls. In self-wired mode it uses backend pagination plus server
`search`, `role`, and `status` filters so users beyond the first page remain
reachable. For custom dashboards, `useAdminUsers()` exposes the same SDK-backed
state, page metadata, filters, and mutations without rendering the organism.
Manual password reset appears only when
`auth.accountEmails.manualPasswordReset` is enabled.

Public account lifecycle routes:

```txt
POST /auth/forgot-password
GET  /auth/action-token/:token
POST /auth/reset-password
POST /auth/setup-password
```

Email-driven routes validate delivery readiness before mutating user state.
If email is disabled they return `EMAIL_NOT_CONFIGURED`; if setup/reset links
cannot be built they return `EMAIL_PUBLIC_URL_REQUIRED`.

`POST /auth/forgot-password` always returns `{ ok: true }` when a ready email
config accepts the request, including unknown email addresses and cooldown
repeats, so it does not reveal whether an account exists. Reset/setup tokens
are opaque, stored only as hashes, expire according to
`auth.accountEmails.actionTokenTTL`, are rate-limited by
`auth.accountEmails.requestCooldown`, and are consumed once.

Login, refresh, auth middleware, and `requireAuth()` enforce account state:

| State | Behavior |
| --- | --- |
| `active` | Normal login and token use. |
| `active` with `passwordChangeRequired` | Login returns `PASSWORD_CHANGE_REQUIRED`; existing tokens no longer authenticate. |
| `suspended` | Login returns `ACCOUNT_SUSPENDED`; existing tokens no longer authenticate. |

The root `.env.example` documents the common auth/email environment variables:
`APP_NAME`, `APP_PUBLIC_URL`, `EMAIL_FROM`, `EMAIL_REPLY_TO`,
`RESEND_API_KEY`, `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL`,
`AUTH_ACTION_TOKEN_TTL`, `AUTH_ACCOUNT_EMAIL_COOLDOWN`,
`AUTH_MANUAL_PASSWORD_RESET`, and optional `AUTH_SIGNING_KEY`.

## Configured User Properties

Apps can configure known user property fields inline with `createApp()` today:

```ts
createApp({
  auth: {
    registration: { mode: 'admin-only' },
    userProperties: {
      department: {
        type: 'enum',
        values: ['accounting', 'operations', 'management'],
        editableBy: 'admin',
        useInPolicies: true,
      },
      notificationsEnabled: {
        type: 'boolean',
        default: true,
        editableBy: 'user',
      },
    },
  },
});
```

Configured defaults apply on registration/admin creation and are lazily
backfilled on login or `/auth/me` without overwriting existing values.
Configured fields validate type/options and edit authority:

| `editableBy` | Meaning |
| --- | --- |
| `user` | Current user and admins may edit through platform routes. |
| `admin` | Admin routes may edit; current-user routes reject writes. |
| `system` | Only internal service/system calls should write. |
| `none` | Protected from user/admin platform routes. |

Unknown property keys remain allowed by default for compatibility. Set
`strictUserProperties: true` to reject unknown current-user/admin property
writes through the platform routes.

Set `useInPolicies: true` only on fields that backend authorization policies
may use as trusted claims. Zero rejects this flag on `editableBy: 'user'`
fields, so self-editable preferences such as `theme` or
`notificationsEnabled` cannot accidentally become access-control inputs. See
[Phase 5: Resource And Policy API Plan](../framework/phase-5-resource-policy-plan.md).

`GET /auth/config` exposes only fields with `editableBy: 'user'` so public
account settings can adapt without leaking admin-only metadata policy. The
admin config endpoint exposes all configured fields for the `UserManagement`
organism.

```tsx
import {
  ChangePasswordForm,
  ForgotPasswordForm,
  LoginForm,
  PasswordActionForm,
  RegisterForm,
  UserPropertiesForm,
} from '@zero/framework/react';

function LoginPanel() {
  return <LoginForm forgotPasswordHref="/forgot-password" registerHref="/register" />;
}

function ResetPasswordPanel({ token }: { token: string }) {
  return <PasswordActionForm token={token} mode="auto" loginHref="/login" />;
}

function AccountSettings() {
  return (
    <>
      <UserPropertiesForm />
      <ChangePasswordForm />
    </>
  );
}
```

`LoginForm`, `RegisterForm`, and `ForgotPasswordForm` read auth config by
default. Policy-aware links/forms wait for `/auth/config` before showing
registration or password-reset actions, hide unavailable actions, keep
first-admin bootstrap visible, and surface lifecycle errors such as
`PASSWORD_CHANGE_REQUIRED` and `ACCOUNT_SUSPENDED` with UI-friendly messages.
`PasswordActionForm` inspects the emailed token first and only enables submit
when the token is valid and matches the requested `mode`.

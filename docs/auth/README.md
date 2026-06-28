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
| **Zero sensitive broadcast** | Password hashes live in `_credentials` (internal table) — never broadcast |

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
- **Not a full user management UI.** It ships admin user-management routes and a mock/admin page shell, but a production admin screen can be app-specific.
- **Not a permissions framework.** It provides `role` on the user and `authContext` in middleware. Row-level access control, RBAC policies — that's application code on top.

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
email-driven reset/setup routes create one-time action tokens, send account
lifecycle email through the platform email service, mark the account as
requiring a password change, and revoke existing sessions.

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

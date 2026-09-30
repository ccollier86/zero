# Auth System

**Register. Login. It's reactive.**

A standalone authentication primitive — self-hosted, single Bun process, shared ReactiveDB. Register a user, they're immediately visible to every connected client. Change a role, every subscriber sees it instantly. Argon2id passwords, ES256 JWTs, generation-aware Bearer verification, and a revocable HttpOnly page session for SSR. No external auth service, no plumbing.

Installed applications use the system-browser OIDC/PKCE flow documented in
[Desktop, Mobile, and Chrome Extension Authentication](./native-app-auth.md).
Choose the correct surface with the
[App Authentication SDK Guide](./app-auth-sdk-guide.md). The TypeScript
`@zero/framework/native` core is implemented in this tree. Rust/Tauri is an
independent Phase 0 design scaffold and `@zero/chrome-auth` is an independent
private MV3 preview; neither is a released package. Standalone SDK repositories
are deliberately excluded from the framework package and from applications
created or updated by the Zero CLI.

## The Full Loop

```ts
// ─── Server: auth + sync, shared database ─────────────

import { Elysia } from 'elysia';
import {
  createAuthPlugin,
  createAuthMiddleware,
  getTokenService,
  installAuthStopBarrier,
} from '@zero/framework/auth';
import { createReactiveDB, createSyncPlugin } from '@zero/framework/sync';

const db = createReactiveDB({ mode: 'memory' });

const app = installAuthStopBarrier(new Elysia()
  .use(createAuthPlugin({ db }))
  .use(createAuthMiddleware(getTokenService))
  .use(createSyncPlugin({
    db,
    tables: {
      todos: { id: 'text primary key', title: 'text not null', done: 'integer default 0' },
    },
  })));

app.listen(3000);

// During shutdown, the barrier joins auth email work before DB disposal:
// await app.stop();
// db.dispose();

// POST /auth/register, /auth/login, /auth/refresh, /auth/logout, /auth/change-password
// GET  /auth/me, /auth/jwks
// WS   /sync (reactive — users table changes broadcast to clients)
```

Install `installAuthStopBarrier()` after composing a standalone Elysia app.
Elysia invokes asynchronous plugin stop hooks without joining them, so the
barrier makes `await app.stop()` the safe point for disposing an injected
database. `createApp()` already installs the platform-wide equivalent.
Doctor's usage audit warns when it sees a directly composed public
`createAuthPlugin()` without an invoked barrier; ordinary `createApp()`
composition does not trigger that warning.

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
| **Generation-aware verification** | ES256 signatures verify token integrity; live user state and a per-user auth generation make security transitions immediately durable |
| **Reactive user rows** | User profile and role changes use ReactiveDB; properties are joined into auth payloads |
| **Revocable refresh** | Refresh tokens are opaque UUIDs, SHA-256 hashed in DB, rotated on use |
| **Persistent sessions** | Browser clients restore from the stored refresh token while direct page requests use a refresh-bound HttpOnly page session |
| **API boundary** | Page cookies authenticate only safe SSR page requests; APIs, mutations, and sync remain Bearer-authorized |
| **Zero sensitive broadcast** | Password hashes live in `_credentials` (internal table) — never broadcast |

## Web And Installed-App Identity

Web, desktop, mobile, and extension sessions resolve to the same live Zero
user. Native OIDC does not create a parallel account table or permissions
model. After bearer verification, the middleware re-reads the user and security
generation; native access additionally requires the registered client and
exact refresh-token family to remain active.

The normal `AuthContext` remains the authorization input:

```ts
interface AuthContext {
  userId: string;
  email: string;
  role: string;
  clientId?: string;
  sessionKind?: 'web' | 'native';
  scope?: readonly string[];
  sessionId?: string;
}
```

Use role, trusted user properties, ownership, middleware, endpoint auth, and
resource/Sync policy exactly as web routes do. `clientId` and `sessionKind` are
attribution fields for the uncommon route that needs to distinguish a shipped
client. `scope` contains OIDC identity claims (`openid`, `profile`, `email`),
not API permissions.

The installed app opens the normal Zero pages in the system browser, so
registration mode, first-user bootstrap, email verification, password
recovery, MFA, suspension, and administrator revocation remain authoritative.
Zero's packaged auth forms preserve a validated native continuation through
those flows. A password reset is deliberately sessionless: after changing the
password, the user signs in again before returning to native consent.

For setup, endpoints, redirects, SDK/broker APIs, secure-storage requirements,
Sync lifecycle, and release gates, read the
[native provider guide](./native-app-auth.md) and
[SDK onboarding guide](./app-auth-sdk-guide.md).

## Auth Request Bounds

Zero rejects oversized auth route fields with HTTP `422` and the stable
`AUTH_VALIDATION_FAILED` response before password hashing, token hashing/JWT
verification, or database lookup. The limits are deliberately much larger than
normal UI input so they protect expensive boundaries without constraining
ordinary accounts:

`src/auth/auth-request-limits.ts` is the single source of truth used by the
shared route schemas and flexible-property guards.

| Input | Maximum characters/items |
|-------|--------------------------|
| Canonical email, username, or login identifier | 254 characters |
| Current, new, setup, or administrator-set password | 1,024 characters |
| First or last name | 256 characters |
| Role | 128 characters |
| User ID route parameter | 128 characters |
| Bearer access, action, refresh, or MFA transition token | 8,192 characters |
| MFA verification code | 128 characters |
| MFA device label | 128 characters |
| Native authorization continuation | 512 characters |
| Administrator user search | 256 characters |
| User-property key | 128 characters |
| Bulk user-property write | 256 properties |
| One user-property value | 65,536 characters |
| One serialized bulk-property payload | 262,144 characters |

User-property writes retain the existing string, number, boolean, array, and
nested JSON behavior. Non-string values are serialized into the KV store and
returned through the auth user model as strings, so clients that use arrays or
objects should supply the normal `parse`/`serialize` functions to
`useUserProperty`. Only request size is bounded; applications do not need to
flatten normal profile metadata into separate keys.
These field limits complement, rather than replace, a reverse-proxy or Bun
server request-body limit for the deployment as a whole.

## Session Persistence

Access tokens are intentionally short-lived and kept only in memory. The
browser SDK stores the opaque refresh token in `localStorage` so a reload can
restore the session without making the user log in again.

In parallel, every completed auth session sets a signed HttpOnly
`__zero_page_session` cookie. It contains no raw refresh token and is bound to
the same revocable `_refresh_tokens` row. This lets a direct or refreshed
`GET`/`HEAD` page request pass the server route guard before browser JavaScript
runs. The cookie is never accepted by auth APIs, `route.ts` handlers,
mutations, server plugins, or WebSocket sync; those remain Bearer-only.

The SDK handles the normal lifecycle:

1. On startup, it exchanges the stored refresh token for a fresh access token,
   then loads `/auth/me`. `useAuth().isRestoring` is true only during this
   persisted-session recovery; `isLoading` also remains true.
2. Authenticated HTTP calls retry once after a 401 by refreshing the access token.
3. The sync WebSocket reads the current access token whenever it opens or reconnects.
4. Login, session-returning registration/email verification, MFA completion,
   and refresh set or rotate the page cookie.
5. Password reset/setup deliberately returns no session, clears the page cookie
   and browser auth state, and requires a fresh login with the new password.
6. Logout, rejected refresh, password/session revocation, and expiry clear or
   invalidate the page session.
7. Logout or an unrefreshable 401 clears client auth state and resets local
   synced table/state data.

Because refresh tokens rotate once, browsers with Web Locks serialize refreshes
per Zero server across tabs and workers. A waiting tab rereads the current
persisted token after acquiring the lock instead of submitting the token another
tab just replaced. In runtimes without Web Locks, the fallback serializes
concurrent refreshes only within the same JavaScript realm.

`AppProvider` also guards protected client routes when auth is enabled. If a
session cannot be restored or a refresh token is rejected, it withholds the
protected subtree and sends the browser to the configured `loginPath` with one
validated `redirect` query value. On a successful login or any authenticated
visit to the login route, that safe return path wins; otherwise Zero uses
`postLoginPath`, which defaults to `/`.

Configure these paths in `createApp()` or override them on
`<AppProvider publicPaths={...} loginPath="/login"
postLoginPath="/dashboard" />`. Packaged forms still invoke their existing
`onSuccess` callbacks, so callbacks used for analytics or other side effects
remain compatible. Under `AppProvider`, do not add a second callback solely to
duplicate the normal login navigation.

## Route Auth Modes

Zero supports two page-route auth strategies when `auth` is enabled.

Protected-first apps use the default:

```ts
createApp({
  auth: true,
  routeAuth: 'protected-by-default',
  publicPaths: ['/login', '/register', '/forgot-password', '/reset-password', '/setup-password', '/verify-email'],
  loginPath: '/login',
  postLoginPath: '/dashboard',
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
  postLoginPath: '/dashboard',
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
and redirects with one URL-encoded local return path. Client navigation can
retain pathname, query, and fragment; a direct server response retains pathname
and query because fragments never reach the server.

The `redirect` parameter must occur exactly once and resolve to a bounded,
root-relative local URL. External, scheme-relative, malformed, duplicate,
recursive, backslash/control-character, and canonicalization-unsafe values are
ignored. `/login` and `/login/` are equivalent for recursion checks. An explicit
`postLoginPath` resolving to the login route is rejected. For compatibility,
`loginPath: '/'` with the implicit default `postLoginPath: '/'` remains a no-op
for authenticated root visits instead of redirecting in a loop.

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

- **Not a federated identity broker.** Zero can issue OIDC sessions to registered native apps, but it does not provide SAML, social login, or upstream identity-provider federation.
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
| [Admin User Management](./admin-user-management-plan.md) | Implemented registration policy, user/security lifecycle routes, configured properties, and production admin UI |
| [Email And Account Lifecycle](./email-account-lifecycle-plan.md) | Platform email foundation, Resend adapter, and implemented verification/reset/setup flows |
| [App Authentication SDK Guide](./app-auth-sdk-guide.md) | Choose web, TypeScript native, Rust/Tauri, Chrome, or another client and follow the installed-app onboarding checklist |
| [Desktop, Mobile, And Chrome Extension Auth](./native-app-auth.md) | Public-client registration, system-browser OIDC + PKCE, redirects, secure storage, native SDKs, and packaged platform recipes |
| [Metadata, Access Control, And Avatars Plan](./metadata-access-avatar-plan.md) | Planned configurable authz metadata, policy helpers, tenancy, adaptive admin UI, storage-backed avatars |

## File Organization

```
src/auth/
├── auth.plugin.ts              # Composition root: lifecycle, derives, subplugins
├── auth-runtime.ts             # Auth service startup/shutdown and runtime getters
├── auth-schema.ts              # Auth table creation and compatibility upgrades
├── auth-session.plugin.ts      # Config/register/login/refresh/logout/me/jwks routes
├── auth-user-properties.plugin.ts # Current-user configurable property routes
├── auth-admin.plugin.ts        # Composition root for admin user-management routes
├── auth-admin-mfa.plugin.ts    # Admin MFA status/require/clear/reset routes
├── auth-admin-email-verification.plugin.ts # Admin verification delivery/override routes
├── auth-account.plugin.ts      # Forgot/reset/setup/email verification routes
├── auth-mfa.plugin.ts          # MFA setup/challenge routes
├── auth-mfa-response.ts        # Session-vs-MFA completion helper
├── auth-user-response.ts       # Public auth user response mapper
├── auth.middleware.ts          # JWT/account-generation resolution, requireAuth/requireAdmin
├── auth-config.ts              # Auth config helper and normalization
├── auth-context.ts             # Authorization header to AuthContext helper
├── token-service.ts            # JWT signing/verification, keypair mgmt, refresh rotation
├── user-property-service.ts    # Configured user property validation/defaults
├── auth-email-templates.ts     # Auth email template contracts/branding helper
├── mfa-challenge-service.ts    # MFA enrollment/challenge policy and OTP/TOTP verification
├── mfa-challenge-store.ts      # SQLite operations for MFA challenge rows
├── mfa-method-store.ts         # SQLite operations for enrolled MFA methods
├── mfa-secret-crypto.ts        # AES-GCM encryption for authenticator seeds
├── mfa-service.ts              # MFA config/readiness helper
├── mfa-totp.ts                 # RFC 6238 TOTP helpers
├── user-store.ts               # SQLite operations: users, credentials, properties, tokens
├── types.ts                    # AuthContext, UserRecord, TokenPair, config, AuthError
└── index.ts                # Public API: all exports
```

Single responsibility per file: `auth.plugin.ts` is only the composition root,
routes stay in named Elysia controllers, runtime service lifecycle lives in
`auth-runtime.ts`, table setup lives in `auth-schema.ts`, validation/defaults
live in services, and SQL stays in focused stores such as `UserStore`,
`MfaMethodStore`, and `MfaChallengeStore`.

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
    account: {
      requireEmailVerification: Bun.env.AUTH_REQUIRE_EMAIL_VERIFICATION === 'true',
      emailVerificationPath: Bun.env.AUTH_EMAIL_VERIFICATION_PATH ?? '/verify-email',
      allowAdminMarkEmailVerified: false,
    },
    mfa: {
      enabled: Bun.env.AUTH_MFA_ENABLED === 'true',
      policy: Bun.env.AUTH_MFA_POLICY ?? 'optional',
      methods: ['email', 'totp'],
      allowUserChoice: true,
      allowMultipleMethods: false,
      recoveryCodes: false, // reserved for a later recovery-code flow
      totp: {
        issuer: Bun.env.APP_NAME ?? 'Acme CRM',
        encryptionKey: Bun.env.AUTH_TOTP_ENCRYPTION_KEY,
      },
    },
    accountEmails: {
      adminCreatedUser: Boolean(Bun.env.RESEND_API_KEY),
      passwordReset: Boolean(Bun.env.RESEND_API_KEY),
      manualPasswordReset: Bun.env.AUTH_MANUAL_PASSWORD_RESET !== 'false',
      actionTokenTTL: Bun.env.AUTH_ACTION_TOKEN_TTL ?? '1h',
      requestCooldown: Bun.env.AUTH_ACCOUNT_EMAIL_COOLDOWN ?? '5m',
    },
    branding: {
      appName: Bun.env.APP_NAME ?? 'Acme CRM',
      logoUrl: Bun.env.APP_LOGO_URL,
      supportEmail: Bun.env.APP_SUPPORT_EMAIL,
      brandColor: Bun.env.AUTH_EMAIL_BRAND_COLOR,
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
POST   /auth/admin/users/:userId/clear-password-change-requirement
POST   /auth/admin/users/:userId/suspend
POST   /auth/admin/users/:userId/activate
POST   /auth/admin/users/:userId/revoke-sessions
GET    /auth/admin/users/:userId/mfa
POST   /auth/admin/users/:userId/mfa/require
POST   /auth/admin/users/:userId/mfa/clear-requirement
POST   /auth/admin/users/:userId/mfa/reset
POST   /auth/admin/users/:userId/send-verification-email
POST   /auth/admin/users/:userId/verify-email
```

The seven admin security/recovery routes return these exact top-level shapes:

| Route | Response |
| --- | --- |
| `GET .../:userId/mfa` | `{ methods, required, requirement }` |
| `POST .../:userId/mfa/require` | `{ user }` |
| `POST .../:userId/mfa/clear-requirement` | `{ user }` |
| `POST .../:userId/mfa/reset` | `{ ok: true, deletedMethods, invalidatedChallenges }` |
| `POST .../:userId/send-verification-email` | `{ ok: true }` |
| `POST .../:userId/verify-email` | `{ user }` |
| `POST .../:userId/clear-password-change-requirement` | `{ user }` |

MFA `requirement` is `user`, `global`, `admin-role`, or `none`. Requiring or
clearing a per-user MFA requirement and resetting enrolled MFA methods revoke
the user's existing sessions. The verification-email route uses the normal
one-time delivery flow. Directly marking an address verified is disabled by
default; opt in with `auth.account.allowAdminMarkEmailVerified: true`.
`/auth/admin/config` exposes the resolved setting as
`account.allowAdminMarkEmailVerified` and
`capabilities.adminMarkEmailVerified`, allowing custom and first-party UIs to
hide the override when it is unavailable.

Admin routes require an admin Bearer token. Deleting or demoting the last admin
is rejected. `GET /auth/admin/users` is paginated and supports `search`,
`role`, and `status` filters. Direct password resets remain available for
manual workflows by default, clear any password-change gate, revoke existing
sessions, and can be disabled with
`auth.accountEmails.manualPasswordReset: false`.

The preferred email-driven reset/setup routes use a delivery-only password
gate. Zero validates email readiness, serializes delivery for the target,
creates a one-time action token, and requires the provider boundary to accept
the intended recipient. Only after that succeeds does Zero set
`passwordChangeRequired` and revoke the user's sessions. A provider exception
or rejected recipient deletes the undelivered token and leaves an existing
account ungated. Admin creation with setup email is all-or-cleanup: failed
delivery removes the new account so the same identity can be retried.

Generic create/update payloads cannot newly set
`passwordChangeRequired: true` without setup-email delivery. If an older
deployment or operational mistake already stranded another user behind that
gate, use the confirmed
`POST .../:userId/clear-password-change-requirement` recovery action. It does
not change the password, cannot target the acting administrator, requires the
gate to exist, and invalidates sessions and outstanding action links. The
first-party admin UI exposes this as **Clear reset requirement** instead of a
raw profile checkbox.

Session revocation is durable across browser and API auth credentials. Zero
revokes persisted refresh tokens (which invalidates their bound page-session
cookies) and bumps a per-user auth generation. Access and short-lived
auth-transition tokens embed that generation and are rejected after it changes,
including after a suspended account is later reactivated.

The frontend barrel exports a ready-to-embed admin organism. It is not a page;
place it inside whatever dashboard, tab, or settings view the app owns:

```tsx
import { UserManagement } from '@zero/framework/react';

function AdminUsersPanel() {
  return <UserManagement className="h-[calc(100svh-5rem)] min-h-0" />;
}
```

`UserManagement` loads `/auth/admin/config` and `/auth/admin/users`. Its
readiness strip appears only for actionable email, verification, or MFA setup
problems. The selected-user security row likewise stays hidden for normal
verified/ready/optional states and surfaces only pending verification,
password-setup, MFA enrollment, enrolled methods, or load errors.
Capability-gated actions cover setup/reset email, manual password reset,
confirmed password-gate recovery, resend/manual verification, MFA
require/clear/reset, session revocation, suspension/reactivation, and confirmed
deletion. The UI serializes sensitive actions and applies self-action policy,
while server guards remain authoritative.

The organism also creates and updates users, promotes admins through the `role`
field, and adapts configured `auth.userProperties` into admin property controls.
Enum fields render as selects, boolean fields render as checkboxes, and
number/string fields render as typed inputs. Admin creation is unavailable when
the resolved registration mode is `disabled`.

When `strictUserProperties` is false, the same property panel also shows an
additional key/value editor for unconfigured custom properties. This lets an
admin add or edit ad-hoc Clerk-style metadata without changing app config.
When `strictUserProperties` is true, the additional editor is hidden and the
server rejects unknown property keys.

In self-wired mode it uses backend pagination plus server `search`, `role`, and
`status` filters so users beyond the first page remain reachable. For custom
dashboards, `useAdminUsers()` exposes the same SDK-backed state, page metadata,
filters, property mutations, and account lifecycle mutations without rendering
the organism. Manual password reset appears only when
`auth.accountEmails.manualPasswordReset` is enabled.

Recovery codes, per-device/session inventory and individual-session revocation,
administrator impersonation, bulk user actions, and full RBAC/tenant policy are
explicitly deferred. `UserManagement` does not imply those capabilities.

Public account lifecycle routes:

```txt
POST /auth/forgot-password
POST /auth/resend-verification
GET  /auth/action-token/:token
POST /auth/verify-email
POST /auth/reset-password
POST /auth/setup-password
```

Email-driven routes validate delivery readiness before mutating user state.
If email is disabled they return `EMAIL_NOT_CONFIGURED`; if setup/reset/verify
links cannot be built they return `EMAIL_PUBLIC_URL_REQUIRED`.

### Email Readiness And Failure Semantics

Email readiness reflects the runtime that can actually attempt delivery, not
just an enabled config switch. `email: true` and explicit Resend config both use
`EMAIL_FROM`, `EMAIL_REPLY_TO`, and `RESEND_API_KEY` as fallbacks when the
matching config value is omitted. The built-in Resend adapter is ready only
with a non-empty sender and API key. A custom provider object owns its own
credential checks but still requires a sender. Setup, reset, and verification
links additionally require `app.publicUrl`; email OTP does not.

Custom provider adapters used for auth delivery must pass
`message.idempotencyKey` to the provider's request-idempotency boundary and
honor `message.signal` when issuing network requests. The key is stable for one
outbox attempt, while the signal lets graceful shutdown or a lost lease cancel
work Zero no longer owns. An adapter that ignores either field can still be
used for ordinary email, but cannot preserve the durable auth outbox's
cancellation and duplicate-suppression guarantees.

`GET /auth/admin/config` exposes these resolved conditions through its email
state and capability flags, so the admin UI does not advertise an action that
only looks configured. Missing readiness fails before token/account/gate
mutation. If a provider call later throws or reports that the intended
recipient was not accepted, Zero fails closed and removes the undelivered
artifact: reset/verification action tokens are deleted, registration or
admin-created setup accounts are rolled back, and email-MFA challenges are
invalidated. Those cleanup paths permit an immediate retry rather than a silent
cooldown.

For durable public auth delivery, deterministic provider HTTP 4xx responses
dead-letter after one attempt with a stable, privacy-safe code. Request timeout
(`408`), Too Early (`425`), rate limit (`429`), network, abort, and provider 5xx
failures remain retryable. Provider response bodies and adapter-specific error
codes are not copied into outbox rows or observability metadata.

Set `auth.account.requireEmailVerification: true` to require post-bootstrap
public registrations to verify email before receiving access/refresh tokens.
The first bootstrap admin still receives a session immediately so an app can be
initialized before email delivery is configured. For normal public users,
`POST /auth/register` creates the account, sends an `email_verification` action
token, returns the user with `emailVerificationRequired: true`, and does not
return tokens. `POST /auth/verify-email` consumes the one-time token, marks
`emailVerifiedAt`, clears `emailVerificationRequired`, and then returns the
normal token pair. `POST /auth/resend-verification` always returns `{ ok: true
}` for unknown, already verified, suspended, or cooldown-limited users so it
does not disclose account existence.

When MFA is enabled, email verification is still the first gate. The auth flow
order is:

1. Registration creates the account.
2. If email verification is required, the user must verify the email token
   before receiving any app access/refresh tokens.
3. After email verification, or immediately after registration when email
   verification is not required, Zero evaluates MFA policy.
4. If MFA is required or the user requested optional MFA during signup, Zero
   returns `mfaSetupRequired` and a short-lived setup token.
5. If the user already has an active MFA method, login returns
   `mfaChallengeRequired` and a short-lived challenge token.
6. Only successful MFA setup/challenge verification returns and stores the
   normal app access/refresh token pair.

### Auth Email Templates

Zero ships branded default auth email templates. Apps can override individual
templates with plain functions while keeping the platform-owned token and
delivery flow:

```ts
// zero/auth-emails/password-reset.ts
import type { AuthEmailTemplate } from '@zero/framework/server';

export const passwordResetEmail: AuthEmailTemplate = (ctx) => ({
  subject: `Reset your ${ctx.branding.appName} password`,
  text: ctx.defaultText,
  html: ctx.defaultHtml,
});
```

```ts
// zero/auth-emails/index.ts
import { defineAuthEmailTemplates } from '@zero/framework/server';
import { passwordResetEmail } from './password-reset';

export const authEmailTemplates = defineAuthEmailTemplates({
  passwordReset: passwordResetEmail,
});
```

```ts
// zero/auth.ts or inline createApp auth config
import { defineAuthConfig } from '@zero/framework/server';
import { authEmailTemplates } from './auth-emails';

export default defineAuthConfig({
  branding: {
    appName: Bun.env.APP_NAME,
    logoUrl: Bun.env.APP_LOGO_URL,
    supportEmail: Bun.env.APP_SUPPORT_EMAIL,
    brandColor: Bun.env.AUTH_EMAIL_BRAND_COLOR,
  },
  emails: authEmailTemplates,
});
```

Active template keys today are `accountSetup`, `passwordReset`,
`emailVerification`, and `emailOtp`. The typed registry also reserves
`passwordChanged`, `mfaEnabled`, `mfaDisabled`, and
`recoveryCodesRegenerated` for MFA/account-notification slices.
`ctx.defaultSubject`, `ctx.defaultText`, and
`ctx.defaultHtml` let a custom template wrap or lightly edit the platform
default without copying the whole message body.

Email identities are canonicalized with `trim().toLowerCase()` during public
registration, admin creation/update, email-shaped login, and account recovery;
usernames remain case-sensitive. Lookups use that canonical identity and fail
closed if legacy rows contain an ambiguous canonical collision.

`POST /auth/forgot-password` always returns `{ ok: true }` after readiness is
established. It durably enqueues the same local work for every valid address
and does not wait for account lookup or the provider, so unknown, suspended,
cooldown, and delivery outcomes cannot change the public response. The default
UI therefore says: “If an account exists for that address, a reset link will
arrive shortly.” The background outbox creates action tokens just in time,
cleans them after failed attempts, retries transient failures with bounded
backoff, and recovers expired leases after restart. Privacy-safe observability
distinguishes delivered, suppressed, retried, and dead-letter outcomes without
recording the submitted address, native continuation, raw action token, or
provider error text. Public verification resend uses the same boundary.

If a provider may have accepted a request before its response was lost, Zero
uses at-least-once delivery: it revokes that attempt's token and retries with a
fresh token and per-attempt idempotency key. The user may receive an older
invalid message followed by the valid retry. Zero does not persist raw tokens
to avoid that edge case. If the process crashes before cleanup, lease recovery
still sends a fresh token instead of letting the crash-left token cooldown
suppress delivery. Both links may then work until a password transition or
email verification completes; both transitions advance the account security
generation and invalidate every sibling link and pre-transition session.
Queue caps bound local abuse; production should also
apply trusted-source rate limits for forgot-password and verification-resend at
the shared ingress, especially when several Zero replicas share traffic.
The built-in zero-configuration limits are 5,000 active jobs, 50,000 retained
rows, and 10 attempts per job; reaching them is privately suppressed behind the
same generic response. Graceful shutdown aborts and joins active delivery,
cleans its token, and returns the job to pending without spending an attempt
before the database lifecycle is released.

Reset/setup/verify tokens are opaque, stored only as hashes, bound to the
account's exact security generation, expire according to
`auth.accountEmails.actionTokenTTL`, are rate-limited by
`auth.accountEmails.requestCooldown`, and are consumed once. A later reset
cycle cannot resurrect an older link. Tokens issued by a pre-hardening Zero
version do not have the required identity/generation binding; resend any
pending setup, reset, or verification email after deploying the upgrade.

Login, refresh, auth middleware, and `requireAuth()` enforce account state:

| State | Behavior |
| --- | --- |
| `active` | Normal login and token use. |
| `active` with `passwordChangeRequired` | Login returns `PASSWORD_CHANGE_REQUIRED`; existing tokens no longer authenticate. |
| `active` with `emailVerificationRequired` and no `emailVerifiedAt` | Login returns `EMAIL_VERIFICATION_REQUIRED`; existing tokens no longer authenticate. |
| `suspended` | Login returns `ACCOUNT_SUSPENDED`; existing tokens no longer authenticate. |

## MFA

Zero has first-party MFA for email OTP and self-hosted authenticator/TOTP:

- `auth.mfa` config is normalized by `defineAuthConfig()` /
  `resolveAuthBehaviorConfig()`.
- `/auth/config` exposes public-safe MFA policy, enabled methods, readiness,
  and whether user choice/multiple methods are allowed.
- `/auth/admin/config` includes operational readiness such as email OTP
  readiness and whether the TOTP encryption secret is configured.
- `users.mfa_required` stores per-user/admin MFA enforcement.
- `_auth_mfa_methods`, `_auth_mfa_challenges`, and
  `_auth_mfa_recovery_codes` are framework-owned internal tables.
- `MfaMethodStore` persists the user's selected MFA method. For v1, the method
  the user enrolls becomes the active/preferred challenge method.
- `MfaService` keeps config/readiness response construction out of route
  handlers.
- `MfaChallengeService` owns setup/challenge policy, OTP delivery, TOTP
  verification, and method activation.
- Frontend auth components automatically route incomplete auth responses into
  shared MFA setup/challenge UI. Apps can also use `MFAEnrollmentForm`,
  `MFAChallengeForm`, `MFAContinuation`, `MFAManagementPanel`, and `QRCode`
  directly for account settings or custom auth pages.

Authenticator/TOTP is self-hosted by Zero. There is no external TOTP provider:
Zero will generate secrets, encrypt them at rest with
`AUTH_TOTP_ENCRYPTION_KEY`, create otpauth URLs, and verify authenticator codes
directly.

Required MFA does not issue app access/refresh tokens until setup or challenge
verification succeeds. Auth routes return short-lived transition tokens instead:

```txt
mfaSetupRequired: true
mfaSetupToken: "..."
```

or:

```txt
mfaChallengeRequired: true
mfaChallenge: {
  method,
  challenge,
  challengeToken
}
```

Clients use these routes:

```txt
GET  /auth/mfa/methods
POST /auth/mfa/setup
POST /auth/mfa/setup/verify
POST /auth/mfa/challenge/verify
```

`POST /auth/mfa/setup` accepts either a `setupToken` from registration/login or
an authenticated bearer token from account settings. Email setup sends a
six-digit code through the platform email provider and does not require
`app.publicUrl`. TOTP setup returns `{ secret, otpauthUrl, issuer, accountName }`
so the UI can render a QR code and verify the first authenticator code.

`POST /auth/mfa/challenge/verify` exchanges a valid challenge token and OTP/TOTP
code for the normal access/refresh token pair.

For v1 MFA method selection, a user has one active/preferred method. If both
`email` and `totp` are enabled, enrollment lets the user choose one. Later
versions can allow multiple active methods and a "try another way" fallback
without changing the table shape.

Recovery-code storage is reserved for a later MFA slice. Keep
`auth.mfa.recoveryCodes` false until recovery-code generation, display, and
verification routes are added.

The root `.env.example` documents the common auth/email environment variables:
`APP_NAME`, `APP_PUBLIC_URL`, `APP_LOGO_URL`, `APP_SUPPORT_EMAIL`,
`AUTH_EMAIL_BRAND_COLOR`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, `RESEND_API_KEY`,
`ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL`, `AUTH_ACTION_TOKEN_TTL`,
`AUTH_ACCOUNT_EMAIL_COOLDOWN`, `AUTH_MANUAL_PASSWORD_RESET`,
`AUTH_REQUIRE_EMAIL_VERIFICATION`, `AUTH_EMAIL_VERIFICATION_PATH`,
`AUTH_MFA_ENABLED`, `AUTH_MFA_POLICY`, `AUTH_MFA_METHODS`,
`AUTH_TOTP_ENCRYPTION_KEY`, and optional `AUTH_SIGNING_KEY`.

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

Configured defaults apply on public registration, first-admin bootstrap, and
admin user creation. Defaults are also lazily backfilled on login or `/auth/me`
without overwriting existing values.
Configured fields validate type/options and edit authority:

| `editableBy` | Meaning |
| --- | --- |
| `user` | Current user and admins may edit through platform routes. |
| `admin` | Admin routes may edit; current-user routes reject writes. |
| `system` | Only internal service/system calls should write. |
| `none` | Protected from user/admin platform routes. |

Unknown property keys remain allowed by default for compatibility and show in
the admin `UserManagement` additional-properties editor. Set
`strictUserProperties: true` to reject unknown current-user/admin property
writes through the platform routes and hide ad-hoc property editing from the
admin organism.

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
  EmailVerificationForm,
  LoginForm,
  MFAEnrollmentForm,
  MFAManagementPanel,
  PasswordActionForm,
  RegisterForm,
  UserPropertiesForm,
} from '@zero/framework/react';

function LoginPanel() {
  return (
    <LoginForm
      forgotPasswordHref="/forgot-password"
      identifierAutoComplete="email"
      identifierLabel="Email"
      registerHref="/register"
    />
  );
}

function ResetPasswordPanel({ token }: { token: string }) {
  return <PasswordActionForm token={token} mode="auto" loginHref="/login" />;
}

function ResetPasswordPastePanel() {
  return <PasswordActionForm mode="reset" loginHref="/login" />;
}

function AccountSettings() {
  return (
    <>
      <UserPropertiesForm />
      <MFAManagementPanel />
      <ChangePasswordForm />
    </>
  );
}
```

`LoginForm`, `RegisterForm`, and `ForgotPasswordForm` read auth config by
default. Policy-aware links/forms wait for `/auth/config` before showing
registration or password-reset actions, hide unavailable actions, keep
first-admin bootstrap visible, and surface lifecycle errors such as
`PASSWORD_CHANGE_REQUIRED`, `EMAIL_VERIFICATION_REQUIRED`, and
`ACCOUNT_SUSPENDED` with UI-friendly messages.
`RegisterForm` automatically switches to a check-your-email state when account
verification is required and exposes a resend action. When MFA policy is
optional and ready, it can request MFA setup during signup; required/admin MFA
is enforced by backend continuation responses.
`EmailVerificationForm` handles `email_verification` tokens from email links,
can render a token-paste fallback when no query token is present, signs the
user in after a successful verification, and continues into MFA setup when the
verification token carries an MFA enrollment request or policy requires MFA.
`PasswordActionForm` inspects the emailed token first and only enables submit
when the token is valid and matches the requested `mode`. Omit `token` to show
a token-paste step before inspection. Password reset/setup commit the token,
password replacement, gate clear, and session revocation atomically, then clear
the page-session cookie and return
`{ user, passwordUpdated: true, signInRequired: true }`. They never start MFA
delivery or issue a new session after the password commit. The form shows a
success state and sends the user back to login, where normal MFA policy runs on
the fresh credential.

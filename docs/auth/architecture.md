# Architecture

Four components, one shared database. Auth is an Elysia plugin that defines tables on the same ReactiveDB the sync engine uses.

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Elysia App                                  │
│                                                                      │
│  ┌────────────────┐   ┌───────────────────┐   ┌──────────────────┐  │
│  │  Auth Plugin    │   │  Auth Middleware   │   │  Sync Plugin     │  │
│  │                 │   │                   │   │                  │  │
│  │ POST /auth/*    │   │ derive authContext │   │ WS /sync         │  │
│  │ GET /auth/me    │   │ (live resolution) │   │ onChange→publish  │  │
│  │ GET /auth/jwks  │   │                   │   │                  │  │
│  └────────┬────────┘   └───────────────────┘   └────────┬─────────┘  │
│           │                                              │           │
│           │         ┌───────────────┐                    │           │
│           └────────►│  ReactiveDB   │◄───────────────────┘           │
│                     │  (shared)     │                                │
│                     │               │                                │
│                     │ users         │◄── broadcast (public)          │
│                     │ user_properties│◄── direct SQL (composite PK)   │
│                     │ _credentials  │◄── internal (no broadcast)     │
│                     │ _refresh_tkns │◄── internal (no broadcast)     │
│                     │ _auth_config  │◄── internal (no broadcast)     │
│                     │ _auth_email_outbox │◄── durable auth delivery  │
│                     │ todos         │◄── broadcast (app table)       │
│                     │ _changes      │◄── internal (ring buffer)      │
│                     └───────────────┘                                │
└──────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

### Auth Plugin (`auth.plugin.ts`)

Elysia composition root — owns plugin lifecycle wiring, shared auth error
mapping, global service derives, and subplugin registration.

**Owns:**
- Resolving auth behavior config once.
- Calling `startAuthRuntime()` and `stopAuthRuntime()` from Elysia lifecycle.
- Deriving runtime auth services into global Elysia context.
- Mounting session, account, admin, MFA, and current-user property route plugins.

**Does not own:**
- Table definitions (that's `auth-schema.ts`).
- Service construction details (that's `auth-runtime.ts`).
- Registration, login, refresh, logout, password-change, or `/me` route bodies (that's `auth-session.plugin.ts`).
- Current-user property routes (that's `auth-user-properties.plugin.ts`).
- JWT verification on arbitrary routes (that's the middleware).
- WebSocket broadcast (that's the sync engine via ReactiveDB onChange).
- Access control policies (that's application code).

### Auth Runtime (`auth-runtime.ts`)

Service lifecycle boundary for auth.

**Owns:**
- Creating `UserStore`, `TokenService`, `UserPropertyService`,
  `AuthActionTokenService`, `AccountEmailService`, `AuthEmailOutbox`,
  `MfaMethodStore`, `MfaService`, `MfaChallengeStore`, and
  `MfaChallengeService`.
- Enabling SQLite foreign keys and calling auth schema setup at startup.
- Resetting service singletons at shutdown.
- Exporting typed getters used by auth subplugins and middleware.

### Auth Schema (`auth-schema.ts`)

Schema setup boundary for auth.

**Owns:**
- Creating/upgrading `users`, `user_properties`, `_credentials`,
  `_refresh_tokens`, `_auth_action_tokens`, `_auth_email_outbox`,
  `_auth_mfa_methods`, `_auth_mfa_challenges`, `_auth_mfa_recovery_codes`, and
  `_auth_config`.
- Keeping raw SQL table setup out of route controllers.

### Auth Session Routes (`auth-session.plugin.ts`)

Elysia controller for core session and identity routes.

**Owns:**
- `/auth/config`, `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/change-password`, `/auth/me`, and `/auth/jwks`.
- Delegating MFA continuation decisions to `auth-mfa-response.ts`.
- Setting, rotating, revoking, or clearing the page cookie when session state changes.

### Auth Middleware (`auth.middleware.ts`)

JWT verification plus live user/session resolution — separate from the auth
plugin and applied as a cross-cutting concern.

**Owns:**
- Extracting Bearer token from `Authorization` header
- Verifying access token signature and expiry via TokenService
- Resolving `authContext` and auth guard helpers into Elysia context

**Does not own:**
- Token issuance (that's `TokenService`, called by session/account/MFA routes)
- Access control decisions (that's each route — middleware just provides context)
- Refresh token handling (that's `auth-session.plugin.ts`)
- Page-session cookie authentication (that's `page-session.ts` plus the page router)

**AuthContext shape:**

```ts
interface AuthContext {
  userId: string;
  email: string;
  role: 'user' | 'admin';
}
```

**Key design:** The middleware **does not throw while resolving identity**. It resolves `authContext: AuthContext | null` for unauthenticated requests and provides `requireAuth()` / `requireAdmin()` helpers for routes that need enforcement:

```ts
// Route that requires auth — throws if not present
.get('/api/me', ({ authContext }) => {
  if (!authContext) throw new AppError('Unauthorized', 'UNAUTHORIZED', 401);
  return authContext;
})

// Route that optionally uses auth — works either way
.get('/api/public', ({ authContext }) => {
  return { user: authContext?.userId ?? 'anonymous' };
})
```

This keeps the middleware simple and pushes authorization decisions to the edge — the route handler that knows what it needs.

### Page Session (`page-session.ts`)

Server-rendered pages have a separate ambient credential. Completed auth flows
set a host-only, HttpOnly, `SameSite=Lax` cookie containing a signed page JWT
with `sub` and the backing refresh-session ID (`sid`). The page router resolves
it only after ruling out an actual `route.ts` handler and only for `GET` or
`HEAD`. Any explicit `Authorization` header remains authoritative.

Validation verifies the dedicated `auth-page-session` issuer, then requires an
active, unexpired `_refresh_tokens` row and a currently eligible user. Rotation,
logout, password changes, suspension, deletion, and admin session revocation
therefore invalidate SSR identity immediately. Global middleware, auth APIs,
server extensions, unsafe methods, and WebSocket sync remain Bearer-only.

### User Store (`user-store.ts`)

SQLite operations on auth tables. Same prepared-statement pattern as `src/persistence/sqlite-hot-store.ts`.

**Owns:**
- User CRUD (create, read, update, delete)
- Credential management (hash storage, password verification)
- User properties KV (set, get, delete, list)
- Refresh token storage (insert, lookup by hash or session ID, revoke)
- Auth config storage (keypair persistence)

**Does not own:**
- Password hashing algorithm choice (uses `Bun.password` — the runtime decides Argon2id params)
- JWT logic (that's TokenService)
- Reactivity (that's ReactiveDB — UserStore writes through `db.insert()`/`db.update()`)

### Token Service (`token-service.ts`)

JWT signing, verification, keypair management, refresh rotation.

**Owns:**
- ECDSA P-256 keypair lifecycle (generate, persist, load)
- Access token signing and verification via `jose`
- Refresh token generation, hashing, rotation
- Dedicated page-session JWT issuance and live refresh-session validation
- JWKS public key export

**Does not own:**
- Token storage (refresh tokens stored via UserStore → `_refresh_tokens` table)
- User data (reads user claims from UserStore at signing time)
- HTTP transport (the plugin's routes call TokenService methods)

## Elysia Plugin Pattern

Same conventions as every other plugin in this codebase:

| Convention | Auth implementation | Existing precedent |
|------------|--------------------|--------------------|
| Factory function | `createAuthPlugin(config)` | `createIngestionQueuePlugin(getMemoryService)` |
| `onStart` / `onStop` lifecycle | Delegate to `auth-runtime.ts` for schema/services / cleanup | `persistence.plugin.ts` — init stores / dispose |
| `derive({ as: 'global' })` | Expose `authStore`, `tokenService` | `persistence.plugin.ts` — exposes `persistence` |
| Lazy getter export | `getAuthStore()`, `getTokenService()` | `getPersistenceColdStore()`, `getKnowledgeMemoryService()` |
| Named plugin | `new Elysia({ name: 'auth', prefix: '/auth' })` | `new Elysia({ name: 'persistence' })` |
| Route prefix | `/auth/*` routes scoped via plugin prefix | `session.routes.ts` — `/api/sessions` |
| TypeBox validation | `t.Object({ username: t.String(), ... })` on route bodies | All routes in `src/server/routes/` |

### Plugin Structure

```ts
// src/auth/auth.plugin.ts

export function createAuthPlugin(config: AuthPluginConfig) {
  const authConfig = resolveAuthBehaviorConfig(config);

  return new Elysia({ name: 'auth', prefix: '/auth' })
    .onStart(() => startAuthRuntime(config, authConfig))
    .onStop(() => stopAuthRuntime())
    .derive({ as: 'global' }, () => getAuthRuntimeContext())
    .use(createAuthSessionPlugin({ /* runtime getters */ }))
    .use(createAuthAccountPlugin({ /* runtime getters */ }))
    .use(createAuthMfaPlugin({ /* runtime getters */ }))
    .use(createAuthAdminPlugin({ /* runtime getters */ }))
    .use(createAuthUserPropertiesPlugin({ /* runtime getters */ }));
}
```

### Plugin Config

```ts
interface AuthPluginConfig {
  /** Shared ReactiveDB instance — auth defines its tables here */
  db: ReactiveDB;

  /** Access token TTL (default: '15m') */
  accessTokenTTL?: string;

  /** Refresh token TTL (default: '7d') */
  refreshTokenTTL?: string;

  /** PEM or base64 JWK signing key (optional — generates ECDSA P-256 if absent) */
  signingKey?: string;
}
```

### Environment Variables

Same pattern as `src/config/infrastructure.ts`:

```ts
// src/config/auth.ts

export const AUTH = {
  accessTokenTTL: '15m',
  accessTokenTTLEnvKey: 'ACCESS_TOKEN_TTL',
  refreshTokenTTL: '7d',
  refreshTokenTTLEnvKey: 'REFRESH_TOKEN_TTL',
  signingKeyEnvKey: 'AUTH_SIGNING_KEY',
};
```

| Env Var | Default | Description |
|---------|---------|-------------|
| `ACCESS_TOKEN_TTL` | `15m` | Access token expiry (jose duration format: `15m`, `1h`, `2d`) |
| `REFRESH_TOKEN_TTL` | `7d` | Refresh token expiry |
| `AUTH_SIGNING_KEY` | *(auto-generate)* | PEM or base64 JWK — overrides DB-stored keypair |

## Data Flow

### Registration

```
Client                    Auth Plugin               UserStore           TokenService
  │                           │                         │                    │
  │  POST /auth/register      │                         │                    │
  │  { username, email, pw }  │                         │                    │
  │ ─────────────────────────►│                         │                    │
  │                           │  createUser(...)        │                    │
  │                           │ ───────────────────────►│                    │
  │                           │                         │  Bun.password.hash │
  │                           │                         │  db.insert(users)  │
  │                           │                         │  db.exec(_creds)   │
  │                           │    UserRecord           │                    │
  │                           │ ◄───────────────────────│                    │
  │                           │                         │                    │
  │                           │  issueTokens(user)      │                    │
  │                           │ ────────────────────────┼───────────────────►│
  │                           │                         │                    │ sign JWT
  │                           │                         │                    │ gen refresh
  │                           │                         │  storeRefresh()    │
  │                           │                         │ ◄───────────────── │
  │                           │    { access, refresh }  │                    │
  │                           │ ◄───────────────────────┼────────────────────│
  │                           │                         │                    │
  │  { accessToken,           │                         │                    │
  │    refreshToken, user }   │                         │                    │
  │ ◄─────────────────────────│                         │                    │
  │                           │                         │                    │
  │         ┌─────── Meanwhile, ReactiveDB onChange fires ──────┐           │
  │         │  db.insert('users', ...) triggered change event   │           │
  │         │  Sync Plugin: server.publish('sync:users', row)   │           │
  │         │  All WS clients subscribed to 'users' see the     │           │
  │         │  new user appear instantly.                        │           │
  │         └───────────────────────────────────────────────────┘           │
```

### Login

```
Client                    Auth Plugin               UserStore           TokenService
  │                           │                         │                    │
  │  POST /auth/login         │                         │                    │
  │  { username, password }   │                         │                    │
  │ ─────────────────────────►│                         │                    │
  │                           │  getUserByUsername()     │                    │
  │                           │ ───────────────────────►│                    │
  │                           │    UserRecord           │                    │
  │                           │ ◄───────────────────────│                    │
  │                           │                         │                    │
  │                           │  verifyPassword()       │                    │
  │                           │ ───────────────────────►│                    │
  │                           │                         │  Bun.password      │
  │                           │                         │  .verify()         │
  │                           │    boolean              │                    │
  │                           │ ◄───────────────────────│                    │
  │                           │                         │                    │
  │                           │  issueTokens(user)      │                    │
  │                           │ ────────────────────────┼───────────────────►│
  │                           │    { access, refresh }  │                    │
  │                           │ ◄───────────────────────┼────────────────────│
  │                           │                         │                    │
  │  { accessToken,           │                         │                    │
  │    refreshToken, user }   │                         │                    │
  │ ◄─────────────────────────│                         │                    │
```

### Request with Auth

```
Client                  Auth Middleware            TokenService          Route Handler
  │                         │                          │                      │
  │  GET /api/todos         │                          │                      │
  │  Authorization: Bearer  │                          │                      │
  │   eyJhbGci...           │                          │                      │
  │ ───────────────────────►│                          │                      │
  │                         │  resolveAuthContext(jwt) │                      │
  │                         │ ────────────────────────►│                      │
  │                         │                          │  verify signature,   │
  │                         │                          │  expiry + issuer;    │
  │                         │                          │  load current user,  │
  │                         │                          │  generation/session  │
  │                         │    current authContext   │                      │
  │                         │ ◄────────────────────────│                      │
  │                         │                          │                      │
  │                         │  derive: authContext =    │                      │
  │                         │  { userId, email, role } │                      │
  │                         │ ─────────────────────────┼─────────────────────►│
  │                         │                          │                      │ handle
  │                         │                          │                      │ request
  │  response               │                          │                      │
  │ ◄────────────────────────────────────────────────────────────────────────│
```

Cryptographic JWT verification is stateless, but request authentication is
not. `resolveAuthContext()` rehydrates the current user, checks account gates
and `authGeneration`, and validates the live refresh family for native tokens.
This makes suspension, password/security transitions, native sign-out, and
native refresh-replay revocation effective without waiting for JWT expiry.

### Token Refresh

```
Client                    Auth Plugin               TokenService          UserStore
  │                           │                         │                    │
  │  POST /auth/refresh       │                         │                    │
  │  { refreshToken }         │                         │                    │
  │ ─────────────────────────►│                         │                    │
  │                           │  rotateRefresh(token)   │                    │
  │                           │ ───────────────────────►│                    │
  │                           │                         │  SHA-256(token)    │
  │                           │                         │  lookup hash       │
  │                           │                         │  in _refresh_tkns  │
  │                           │                         │  verify: exists,   │
  │                           │                         │  not expired,      │
  │                           │                         │  not revoked       │
  │                           │                         │                    │
  │                           │                         │  revoke old token  │
  │                           │                         │ ──────────────────►│
  │                           │                         │  (set revoked_at)  │
  │                           │                         │                    │
  │                           │                         │  issue new pair    │
  │                           │                         │  sign new JWT      │
  │                           │                         │  gen new refresh   │
  │                           │                         │  store new hash    │
  │                           │                         │ ──────────────────►│
  │                           │                         │                    │
  │                           │    { access, refresh }  │                    │
  │                           │ ◄───────────────────────│                    │
  │                           │                         │                    │
  │  { accessToken,           │                         │                    │
  │    refreshToken }         │                         │                    │
  │ ◄─────────────────────────│                         │                    │
```

Old refresh token is always revoked — even if the new one is generated. One-time use.

### Logout

`POST /auth/logout` accepts an optional refresh token in
`{ refreshToken? }`. It does not require Bearer auth: logout must remain able to
expire the HttpOnly page cookie even when the access token and browser-managed
refresh token have already been lost.

```
Client                    Auth Plugin               TokenService          UserStore
  │                           │                         │                    │
  │  POST /auth/logout        │                         │                    │
  │  Cookie: page-session     │                         │                    │
  │  { refreshToken?: "abc" } │                         │                    │
  │ ─────────────────────────►│                         │                    │
  │                           │  revoke optional raw    │                    │
  │                           │  refresh token and the  │                    │
  │                           │  cookie-bound session   │                    │
  │                           │ ───────────────────────►│  SET revoked_at    │
  │                           │                         │ ──────────────────►│
  │                           │                         │                    │
  │  Set-Cookie: expired      │                         │                    │
  │  { ok: true }             │                         │                    │
  │ ◄─────────────────────────│                         │                    │
```

The endpoint is idempotent. Possession of either credential only permits
revoking that same credential's backing refresh row; it cannot select another
user or session. The cookie is always expired in the response.

### Change Password

`POST /auth/change-password` requires auth (Bearer token). Takes `{ currentPassword, newPassword }` in JSON body.

```
Client                    Auth Plugin               UserStore
  │                           │                         │
  │  POST /auth/change-password│                        │
  │  Authorization: Bearer    │                         │
  │  { currentPassword,       │                         │
  │    newPassword }          │                         │
  │ ─────────────────────────►│                         │
  │                           │  verifyPassword(userId, │
  │                           │    currentPassword)     │
  │                           │ ───────────────────────►│
  │                           │    boolean              │
  │                           │ ◄───────────────────────│
  │                           │                         │
  │                           │  (if valid)             │
  │                           │  Bun.password.hash(     │
  │                           │    newPassword)         │
  │                           │  updateCredential()     │
  │                           │ ───────────────────────►│
  │                           │                         │
  │                           │  revokeAllUserTokens()  │
  │                           │ ───────────────────────►│  (force re-login)
  │                           │                         │
  │  { ok: true }             │                         │
  │ ◄─────────────────────────│                         │
```

After password change, all previous refresh-backed sessions are revoked. The
successful change-password response issues a fresh token pair and page cookie
for the current browser; other devices must log in again. Older JWTs can remain
cryptographically valid until `exp`, but Zero request authentication rejects
them immediately because the user's security generation changed.

### Session Expiration And Client Recovery

The implemented client recovery path is refresh-token based:

1. Access tokens are short-lived and stored only in memory.
2. Refresh tokens are opaque, stored hashed in `_refresh_tokens`, persisted by the browser SDK, and rotated on every refresh.
3. A signed HttpOnly page JWT is bound to the same refresh row and authenticates direct safe page requests during SSR.
4. Browser startup exchanges the stored refresh token for a fresh access token,
   then loads `/auth/me`. `useAuth().isRestoring` distinguishes only this
   persisted-session recovery from other auth loading states.
5. Authenticated HTTP calls that receive 401 call `/auth/refresh` and retry once.
6. The sync WebSocket reads the current access token every time it opens or reconnects, so login/restore/refresh cannot leave sync using a stale token.
7. Logout, rejected refresh, token replay, or an unrefreshable 401 clears auth state and resets local synced table/state data.

Browsers with Web Locks serialize one-time refresh-token rotation per Zero
server across tabs and workers. A waiter rereads the current token from
browser storage after acquiring the lock, so it does not submit the token a
different tab just rotated. Without Web Locks, Zero's fallback coordinates
only callers in the same JavaScript realm.

`AppProvider` provides the default UI safety net. When auth is enabled and the
client becomes unauthenticated on a protected route, it removes protected route
content and redirects to `loginPath` with one validated `redirect` query value.
The server router uses the same route-auth mode, layout/page `config.auth`,
`publicPaths`, `loginPath`, and `postLoginPath` settings during protected page
handling. A direct server redirect preserves the path and query; a client
redirect can also preserve the fragment. Once authenticated on the login route,
one safe return path wins, then `postLoginPath` (default `/`) is the fallback.
The guard uses replacement navigation and withholds the login subtree while
`isRestoring` is true.

Return paths must be bounded root-relative local URLs. Zero rejects external,
scheme-relative, malformed, duplicate, recursive, backslash/control-character,
and canonicalization-unsafe values. Trailing slashes are equivalent when
comparing a target with `loginPath`. An explicit post-login target resolving to
the login route is a configuration error; the legacy combination of
`loginPath: '/'` and an omitted, implicitly `/` post-login target remains a
no-op to avoid a redirect loop.

Push-based inactivity messages over a personal `auth:{userId}` WebSocket topic
belong to the deferred user-activity audit system. They are not part of the
current auth runtime contract.

## Shared ReactiveDB

The most important architectural decision: auth and sync share a **single ReactiveDB instance**. This is not a convenience — it's a fundamental property.

### Why shared

```
                     ┌─────────────────┐
                     │   ReactiveDB    │
                     │   (:memory:)    │
                     │                 │
  Auth writes ──────►│  users          │────── onChange fires
                     │  user_properties│         │
                     │                 │         ▼
  Sync reads ◄───────│                 │  server.publish('sync:users')
                     │                 │         │
                     │  todos          │         ▼
  App writes ───────►│  projects       │  All subscribed WS clients
                     │                 │  see the change instantly
                     └─────────────────┘
```

When `authStore.createUser()` calls `db.insert('users', row)`:

1. ReactiveDB writes the row, increments `seq`, records in `_changes`
2. ReactiveDB fires `onChange` with the change event
3. Sync plugin's `onChange` listener calls `server.publish('sync:users', changeJSON)`
4. Every WebSocket client subscribed to `sync:users` receives the new user row

No extra code. No event bridge. No manual notification. The existing sync engine onChange → publish path handles it. Auth just writes data.

### Table ownership

Both plugins define tables on the same database, but each plugin owns its own tables:

| Table | Defined by | Type | Broadcast |
|-------|-----------|------|-----------|
| `users` | Auth plugin | Public | Yes — profile data is safe to broadcast |
| `user_properties` | Auth plugin | Public | Yes — extensible metadata |
| `_credentials` | Auth plugin | Internal | No — password hashes stay server-side |
| `_refresh_tokens` | Auth plugin | Internal | No — token hashes are sensitive |
| `_auth_action_tokens` | Auth plugin | Internal | No — legacy reset/setup token hashes are sensitive |
| `_zero_action_tokens` | Platform token plugin | Internal | No — generic action token hashes are sensitive |
| `_zero_resume_tokens` | Platform token plugin | Internal | No — generic resume token hashes are sensitive |
| `_auth_config` | Auth plugin | Internal | No — signing keys are sensitive |
| `todos`, etc. | Sync plugin (app config) | Public | Yes — application data |
| `_changes` | ReactiveDB (auto) | Internal | No — ring buffer for replay |

### The `_` prefix convention

ReactiveDB's `onChange` listener skips tables starting with `_` when broadcasting. This convention is established by `_changes` (the ring buffer table). Auth extends it:

- **Public tables** (no `_` prefix): changes flow through `onChange → server.publish()`. Subscribed clients see them.
- **Internal tables** (`_` prefix): writes still go through ReactiveDB (seq tracking, ring buffer), but the `onChange` listener does not call `server.publish()` for them.

This means:
- `users` row changes → broadcast to subscribers
- `_credentials` row changes → recorded in ring buffer for seq continuity, but never published to any topic
- A client can never subscribe to `_credentials` or `_refresh_tokens` — the sync engine won't create topics for `_` tables

### Password hash isolation

The `users` table contains **no sensitive data**. Password hashes live in `_credentials` — an internal table that is never broadcast:

```sql
-- Public: safe to broadcast
CREATE TABLE IF NOT EXISTS users (
  user_id    TEXT PRIMARY KEY,
  username   TEXT UNIQUE NOT NULL,
  email      TEXT UNIQUE NOT NULL,
  first_name TEXT,
  last_name  TEXT,
  role       TEXT NOT NULL DEFAULT 'user',
  created_at INTEGER NOT NULL,
  updated_at INTEGER
);

-- Internal: never broadcast
CREATE TABLE IF NOT EXISTS _credentials (
  user_id       TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);
```

This is cleaner than stripping fields from broadcast payloads. The data separation is structural — not a filter that might be bypassed.

## Composition

### Plugin ordering

```ts
const app = installAuthStopBarrier(new Elysia()
  // 1. Auth plugin — defines users/credentials tables, provides /auth/* routes
  .use(createAuthPlugin({ db }))

  // 2. Auth middleware — verifies JWT and resolves live authContext on every request
  .use(createAuthMiddleware(getTokenService))

  // 3. Sync plugin — defines app tables, provides WS /sync with real-time broadcast
  .use(createSyncPlugin({ db, tables: { ... } }))

  // 4. App routes — can use both authContext and syncDB
  .get('/api/todos', ({ authContext, syncDB }) => { ... }));

app.listen(3000);
```

**Why this order:**
1. Auth plugin must run first — it defines tables and initializes services
2. Auth middleware must come after auth plugin — it needs `getTokenService()` to return a live instance
3. Sync plugin can come at any point — it just defines more tables on the shared DB
4. App routes come last — they consume derived context from both plugins

### Shared DB injection

The ReactiveDB is created **outside** any plugin and passed in:

```ts
const db = createReactiveDB({ mode: 'memory' });

const app = installAuthStopBarrier(new Elysia()
  .use(createAuthPlugin({ db }))
  .use(createSyncPlugin({ db, tables: { ... } })));

app.listen(3000);
```

Neither plugin creates the database. Neither plugin owns it. Both receive it. This is dependency inversion — the composition root (app.ts) decides the database strategy (memory vs. file), and plugins just use it.

For standalone composition, apply `installAuthStopBarrier()` to the finished
root app. It makes `await app.stop()` join auth email delivery before the
composition root disposes `db`. `createApp()` installs its own full-platform
barrier and does not need this helper.

### WebSocket auth

The auth middleware derives `authContext` on HTTP requests only. WebSocket
connections use the sync plugin's explicit auth bridge: the browser sync client
sends the latest access token in a `sync.auth` message immediately after the
WebSocket opens. The server does not subscribe the socket or process sync
messages until it replies with `sync.auth.ready`. Keeping bearer tokens out of
the URL prevents them from being copied into proxy and access logs.

```ts
createSyncPlugin({
  db,
  tables,
  auth: {
    required: true,
    getTokenVerifier: getTokenService,
  },
});
```

If the token is valid, sync resolves the current account and stores its auth
context on the socket. State sync and presence use that identity for per-user
behavior. Invalid or missing credentials close a required socket with code
`4001`. `createApp()` defaults sync to required whenever app auth is enabled;
an intentionally public app must opt in with `syncAuth: 'public'`.

The server revalidates authenticated sockets before inbound work and on a
short interval. Token expiry, suspension, forced password change, generation
revocation, or a change to property-derived table/row permissions closes the
socket and removes its subscriptions. Reconnect then performs a fresh auth and
policy evaluation. Legacy `?token=` handling exists only behind the sync
plugin's explicit temporary compatibility option and is disabled by default.

The sync engine's policy mechanism (see [Subscription And Mutation Policy](../realtime-sync/realtime-sync/README.md#subscription-and-mutation-policy)) uses the verified WebSocket identity when policy callbacks need user context. Auth provides `{ userId, email, role }`; sync derives readable tables through `SyncPolicy.canReadTable` and checks direct `sync.mutate` writes through `canMutateTable`, `canInsert`, `canUpdate`, and `canDelete`.

`createApp()` composes platform defaults with app policy. Platform-owned service tables such as users, notifications, notification receipts, rooms, workflows, and storage metadata are read-only over direct sync mutation by default.

## Separation of Concerns

| Component | Knows about | Does NOT know about |
|-----------|-------------|---------------------|
| **ReactiveDB** | Tables, SQL, change events, `_` prefix convention | Auth, users, sync, WebSockets |
| **Sync Plugin** | ReactiveDB, WS connections, topics, sync policy, `allowedTables` read state | Auth, passwords, JWTs, users |
| **Auth Plugin** | ReactiveDB, users, passwords, tokens | Sync, WS, broadcast, topics |
| **Auth Middleware** | JWT verification, `authContext` derivation | Users, passwords, refresh tokens, sync |
| **Guards** | `authContext.role` checking, 401/403 responses | Users, tokens, DB, sync — pure functions |
| **Audit Middleware** | Request lifecycle hooks, ReactiveDB listeners, `currentUser` threading | Auth logic, route logic, DB schema |
| **ActivityTracker** | In-memory audit sessions, event accumulation | Auth, sync, routes — just receives events |
| **Application** | All of the above — composes them | Implementation details of any component |

Each component does one thing. Auth doesn't know about WebSockets. Sync doesn't know about passwords. ReactiveDB doesn't know about either. The application layer composes them by passing the shared database and using Elysia's derive chain.

## File Organization

```
src/auth/
├── user-store.ts           # SQLite operations: users, properties, credentials, refresh tokens, legacy action tokens
├── token-service.ts        # JWT signing/verification, keypair mgmt, refresh rotation
├── action-token-service.ts # Auth wrapper over generic platform action tokens
├── account-email-service.ts # Auth lifecycle email delivery through platform email
├── auth.plugin.ts          # Composition root — lifecycle, derive, subplugin mounting
├── auth-runtime.ts         # Service startup/shutdown and runtime getters
├── auth-schema.ts          # Table creation and compatibility upgrades
├── auth-session.plugin.ts  # Config/register/login/refresh/logout/me/jwks routes
├── auth-user-properties.plugin.ts # Current-user property routes
├── auth-admin.plugin.ts    # Admin user-management routes
├── auth-account.plugin.ts  # Forgot/reset/setup routes
├── auth-mfa.plugin.ts      # MFA setup/challenge routes
├── auth-mfa-response.ts    # Session-vs-MFA completion helper
├── auth-user-response.ts   # Public auth user response mapper
├── auth.middleware.ts      # Elysia middleware — resolves authContext + guards
├── auth-config.ts          # Auth config normalization
├── auth-context.ts         # Shared Authorization header extraction
├── user-property-service.ts # Configured property validation/defaults
├── types.ts                # AuthContext, UserRecord, token/config/error types
└── index.ts                # Public API: all exports
```

| File | Responsibility | Est. lines |
|------|---------------|------------|
| `user-store.ts` | All SQLite operations for auth tables | ~300 |
| `token-service.ts` | JWT + keypair + refresh rotation | ~250 |
| `auth.plugin.ts` | Auth composition root only | ~90 |
| `auth-runtime.ts` | Auth service lifecycle and getters | ~130 |
| `auth-schema.ts` | Auth table setup and compatibility columns | ~180 |
| `auth-session.plugin.ts` | Core session and identity route controller | ~360 |
| `auth-user-properties.plugin.ts` | Current-user property route controller | ~130 |
| `auth.middleware.ts` | JWT verification and live auth-context middleware | ~80 |
| `guards.ts` | `requireAuth`, `requireAdmin` pure functions | ~20 |
| `activity-tracker.ts` | In-memory audit sessions, ReactiveDB listener | ~150 |
| `audit.middleware.ts` | Elysia hooks (onBefore/onAfter), wires tracker | ~60 |
| `types.ts` | All auth + audit type definitions | ~100 |
| `index.ts` | Barrel exports | ~20 |

See [Guards & Audit](./guards-and-audit.md) for the role guard and activity tracking design.

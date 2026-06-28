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
│  │ GET /auth/me    │   │ (stateless JWT)   │   │ onChange→publish  │  │
│  │ GET /auth/jwks  │   │                   │   │                  │  │
│  └────────┬────────┘   └───────────────────┘   └────────┬─────────┘  │
│           │                                              │           │
│           │         ┌───────────────┐                    │           │
│           └────────►│  ReactiveDB   │◄───────────────────┘           │
│                     │  (shared)     │                                │
│                     │               │                                │
│                     │ users         │◄── broadcast (public)          │
│                     │ user_properties│◄── broadcast (public)          │
│                     │ _credentials  │◄── internal (no broadcast)     │
│                     │ _refresh_tkns │◄── internal (no broadcast)     │
│                     │ _auth_config  │◄── internal (no broadcast)     │
│                     │ todos         │◄── broadcast (app table)       │
│                     │ _changes      │◄── internal (ring buffer)      │
│                     └───────────────┘                                │
└──────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

### Auth Plugin (`auth.plugin.ts`)

Elysia plugin — owns authentication logic, routes, and service lifecycle.

**Owns:**
- Table definitions for `users`, `user_properties`, `_credentials`, `_refresh_tokens`, `_auth_config`
- Registration, login, refresh, logout routes
- Service lifecycle (UserStore + TokenService creation in `onStart`, cleanup in `onStop`)
- Derived `authStore` and `tokenService` in global Elysia context

**Does not own:**
- The database (receives shared ReactiveDB via config)
- JWT verification on arbitrary routes (that's the middleware)
- WebSocket broadcast (that's the sync engine via ReactiveDB onChange)
- Access control policies (that's application code)

### Auth Middleware (`auth.middleware.ts`)

Stateless JWT verification — separate from the auth plugin. Cross-cutting concern.

**Owns:**
- Extracting Bearer token from `Authorization` header
- Verifying access token signature and expiry via TokenService
- Resolving `authContext` and auth guard helpers into Elysia context

**Does not own:**
- Token issuance (that's the auth plugin)
- Access control decisions (that's each route — middleware just provides context)
- Refresh token handling (that's the auth plugin's `/auth/refresh` route)

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

### User Store (`user-store.ts`)

SQLite operations on auth tables. Same prepared-statement pattern as `src/persistence/sqlite-hot-store.ts`.

**Owns:**
- User CRUD (create, read, update, delete)
- Credential management (hash storage, password verification)
- User properties KV (set, get, delete, list)
- Refresh token storage (insert, lookup by hash, revoke)
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
| `onStart` / `onStop` lifecycle | Define tables, init keypair, create services / cleanup | `persistence.plugin.ts` — init stores / dispose |
| `derive({ as: 'global' })` | Expose `authStore`, `tokenService` | `persistence.plugin.ts` — exposes `persistence` |
| Lazy getter export | `getAuthStore()`, `getTokenService()` | `getPersistenceColdStore()`, `getKnowledgeMemoryService()` |
| Named plugin | `new Elysia({ name: 'auth', prefix: '/auth' })` | `new Elysia({ name: 'persistence' })` |
| Route prefix | `/auth/*` routes scoped via plugin prefix | `session.routes.ts` — `/api/sessions` |
| TypeBox validation | `t.Object({ username: t.String(), ... })` on route bodies | All routes in `src/server/routes/` |

### Plugin Structure

```ts
// src/auth/auth.plugin.ts

import Elysia, { t } from 'elysia';
import { UserStore } from './user-store';
import { TokenService } from './token-service';
import type { AuthPluginConfig } from './types';

let _authStore: UserStore | null = null;
let _tokenService: TokenService | null = null;

/** Lazy getter — other plugins/routes access the UserStore */
export function getAuthStore(): UserStore | null {
  return _authStore;
}

/** Lazy getter — middleware and external services access the TokenService */
export function getTokenService(): TokenService | null {
  return _tokenService;
}

export function createAuthPlugin(config: AuthPluginConfig) {
  return new Elysia({ name: 'auth', prefix: '/auth' })

    // ─── Lifecycle ──────────────────────────────────────
    .onStart(async () => {
      // Define public tables on the shared ReactiveDB
      config.db.defineTable('users', {
        user_id:    'text primary key',
        username:   'text unique not null',
        email:      'text unique not null',
        first_name: 'text',
        last_name:  'text',
        role:       'text not null default \'user\'',
        created_at: 'integer not null',
        updated_at: 'integer',
      });
      config.db.defineTable('user_properties', {
        user_id: 'text not null',
        key:     'text not null',
        value:   'text',
      }, 'PRIMARY KEY (user_id, key)');

      // Internal tables — raw SQL for _ prefix
      config.db.exec(`
        CREATE TABLE IF NOT EXISTS _credentials (
          user_id TEXT PRIMARY KEY,
          password_hash TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS _refresh_tokens (
          token_id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          token_hash TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          revoked_at INTEGER,
          FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON _refresh_tokens(token_hash);
        CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON _refresh_tokens(user_id);
        CREATE TABLE IF NOT EXISTS _auth_config (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS _audit_log (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          event_type TEXT NOT NULL,
          data TEXT,
          ts INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_audit_log_user ON _audit_log(user_id);
        CREATE INDEX IF NOT EXISTS idx_audit_log_ts ON _audit_log(ts);
      `);

      // Create services
      _authStore = new UserStore(config.db);
      _tokenService = await TokenService.create({
        db: config.db,
        accessTokenTTL: config.accessTokenTTL,
        refreshTokenTTL: config.refreshTokenTTL,
      });

      console.log('[auth] Enabled');
    })

    .onStop(() => {
      _authStore = null;
      _tokenService = null;
      console.log('[auth] Stopped');
    })

    // ─── Derive: expose services to all routes/plugins ──
    .derive({ as: 'global' }, () => ({
      authStore: _authStore,
      tokenService: _tokenService,
    }))

    // ─── Routes ─────────────────────────────────────────
    .post('/register', ...)     // → { accessToken, refreshToken, user }
    .post('/login', ...)        // → { accessToken, refreshToken, user }
    .post('/refresh', ...)      // → { accessToken, refreshToken }
    .post('/logout', ...)       // → revoke refresh token (see Logout below)
    .post('/change-password', ...)  // → change password (requires auth)
    .get('/me', ...)            // → current user + properties (requires auth)
    .get('/jwks', ...)          // → public key in JWK Set format
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
  │                         │  verifyAccessToken(jwt)  │                      │
  │                         │ ────────────────────────►│                      │
  │                         │                          │  jose.jwtVerify()    │
  │                         │                          │  check exp, alg      │
  │                         │    payload               │                      │
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

No database lookup during verification. The access token carries all claims. Stateless.

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

`POST /auth/logout` requires **both** tokens:

- **Access token** in `Authorization: Bearer` header — verified by auth middleware, proves identity
- **Refresh token** in JSON body `{ refreshToken }` — identifies which token to revoke

```
Client                    Auth Plugin               TokenService          UserStore
  │                           │                         │                    │
  │  POST /auth/logout        │                         │                    │
  │  Authorization: Bearer    │                         │                    │
  │    eyJhbGci...            │                         │                    │
  │  { refreshToken: "abc" }  │                         │                    │
  │ ─────────────────────────►│                         │                    │
  │                           │  (middleware verified    │                    │
  │                           │   access token →         │                    │
  │                           │   authContext.userId)    │                    │
  │                           │                         │                    │
  │                           │  revokeByHash(hash)     │                    │
  │                           │ ───────────────────────►│                    │
  │                           │                         │  SET revoked_at    │
  │                           │                         │ ──────────────────►│
  │                           │                         │                    │
  │  { ok: true }             │                         │                    │
  │ ◄─────────────────────────│                         │                    │
```

Both required: the access token proves the caller is the user who owns the refresh token. Without the access token, anyone holding a stolen refresh token could selectively revoke tokens. Without the refresh token, the server wouldn't know which token to revoke (a user can have multiple active refresh tokens across devices).

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

After password change, all refresh tokens for the user are revoked — forces re-login on all devices. The current session's access token remains valid until it expires (stateless, no way to revoke), but the next refresh attempt will fail.

### Session Expiration Messages

The server publishes session expiration events to the `auth:{userId}` Bun pub/sub topic:

```ts
interface SessionExpiredMessage {
  type: 'auth.session-expired';
  reason: 'inactive' | 'revoked' | 'token-expired';
}
```

Published via `server.publish('auth:{userId}', JSON.stringify(message))`. Each client subscribes to their personal `auth:{userId}` topic when the WebSocket connection opens. The Client SDK listens on this topic, clears auth state, and fires the `onSessionExpired` callback:

```ts
// Client SDK — on receiving auth.session-expired
store.send({ type: 'auth.clear' });   // wipe tokens + user from state
ws.close();                            // drop the sync connection
onSessionExpired?.(msg.reason);        // app callback — e.g., redirect to /login
```

| Reason | Trigger |
|--------|---------|
| `'inactive'` | Audit middleware detected no activity for inactivityTimeoutMs |
| `'revoked'` | Admin force-revoked all tokens, or password changed on another device |
| `'token-expired'` | Refresh token expired naturally (7d TTL) and client attempted refresh |

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
| `_auth_config` | Auth plugin | Internal | No — signing keys are sensitive |
| `_audit_log` | Auth plugin | Internal | No — audit events are sensitive |
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
const app = new Elysia()
  // 1. Auth plugin — defines users/credentials tables, provides /auth/* routes
  .use(createAuthPlugin({ db }))

  // 2. Auth middleware — stateless JWT verify, resolves authContext and guard helpers on every request
  .use(createAuthMiddleware(getTokenService))

  // 3. Sync plugin — defines app tables, provides WS /sync with real-time broadcast
  .use(createSyncPlugin({ db, tables: { ... } }))

  // 4. App routes — can use both authContext and syncDB
  .get('/api/todos', ({ authContext, syncDB }) => { ... })

  .listen(3000);
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

const app = new Elysia()
  .use(createAuthPlugin({ db }))
  .use(createSyncPlugin({ db, tables: { ... } }))
  .listen(3000);
```

Neither plugin creates the database. Neither plugin owns it. Both receive it. This is dependency inversion — the composition root (app.ts) decides the database strategy (memory vs. file), and plugins just use it.

### WebSocket auth

The auth middleware derives `authContext` on HTTP requests only. WebSocket connections use the sync plugin's explicit auth bridge: the client passes the access token as `?token=...`, and sync calls the auth token verifier during the WebSocket `open` lifecycle.

```ts
createSyncPlugin({
  db,
  tables,
  auth: {
    required: false,
    getTokenVerifier: getTokenService,
  },
});
```

If the token is valid, sync stores `{ userId, email, role }` on `ws.data.authContext`. State sync and presence use that identity for per-user behavior. Invalid provided tokens close the socket with code `4001`; missing tokens are allowed unless sync auth is configured as required.

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
├── user-store.ts           # SQLite operations: users, _credentials, user_properties, _refresh_tokens
├── token-service.ts        # JWT signing/verification (jose), keypair mgmt, refresh rotation
├── auth.plugin.ts          # Elysia plugin — lifecycle, derive, routes
├── auth.middleware.ts       # Elysia middleware — stateless JWT verify, resolves authContext + guards
├── guards.ts               # requireAuth, requireAdmin — pure guard functions
├── activity-tracker.ts     # ActivityTracker class — in-memory audit sessions
├── audit.middleware.ts      # Elysia middleware — wires tracker into request lifecycle + ReactiveDB
├── types.ts                # AuthContext, UserRecord, TokenPair, AuditSession, AuditEvent, config
└── index.ts                # Public API: all exports
```

| File | Responsibility | Est. lines |
|------|---------------|------------|
| `user-store.ts` | All SQLite operations for auth tables | ~300 |
| `token-service.ts` | JWT + keypair + refresh rotation | ~250 |
| `auth.plugin.ts` | Elysia plugin (lifecycle, derive, 6 routes) | ~200 |
| `auth.middleware.ts` | Stateless JWT verification middleware | ~50 |
| `guards.ts` | `requireAuth`, `requireAdmin` pure functions | ~20 |
| `activity-tracker.ts` | In-memory audit sessions, ReactiveDB listener | ~150 |
| `audit.middleware.ts` | Elysia hooks (onBefore/onAfter), wires tracker | ~60 |
| `types.ts` | All auth + audit type definitions | ~100 |
| `index.ts` | Barrel exports | ~20 |

See [Guards & Audit](./guards-and-audit.md) for the role guard and activity tracking design.

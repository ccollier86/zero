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
| **Reactive user data** | User profile, role changes broadcast to all connected clients via ReactiveDB |
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
- **Not a user management UI.** It's an API. Build admin screens on top of the reactive data.
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

The auth system and sync engine share a **single ReactiveDB instance**. Auth defines its tables (`users`, `user_properties`, `_credentials`, `_refresh_tokens`, `_auth_config`) on the same database that the sync engine broadcasts from. No bridge, no event forwarding, no extra plumbing.

```
                    Shared ReactiveDB
                  ┌───────────────────────────────────────┐
                  │                                       │
  Auth Plugin ──► │  users (public)         ── broadcast  │ ◄── Sync Plugin
  defineTable()   │  user_properties        ── broadcast  │     onChange → publish
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

**Public tables** (`users`, `user_properties`, `todos`, etc.) — changes broadcast to subscribed WebSocket clients via the sync engine's `onChange → server.publish()` path.

**Internal tables** (`_` prefix) — changes tracked in the ring buffer for seq continuity but never broadcast. The `_` prefix convention is established by ReactiveDB's `_changes` table. Auth extends it to `_credentials`, `_refresh_tokens`, and `_auth_config`.

See [Architecture](./architecture.md) for the full component diagram and data flow.

## Design Documents

| Document | What it covers |
|----------|---------------|
| [Architecture](./architecture.md) | Plugin structure, Elysia integration, data flow, composition with sync engine |
| [User Store](./user-store.md) | SQLite schema, CRUD, properties KV, password hashing with Bun.password |
| [Token Service](./token-service.md) | JWT lifecycle, ECDSA keypair management, refresh rotation, JWKS |
| [Guards & Audit](./guards-and-audit.md) | Role-based route protection, automatic activity tracking (routes, data access, mutations, sessions) |
| [Metadata, Access Control, And Avatars Plan](./metadata-access-avatar-plan.md) | Planned configurable authz metadata, policy helpers, tenancy, adaptive admin UI, storage-backed avatars |

## File Organization

```
src/auth/
├── user-store.ts           # SQLite operations: users, _credentials, user_properties, _refresh_tokens
├── token-service.ts        # JWT signing/verification (jose), keypair mgmt, refresh rotation
├── auth.plugin.ts          # Elysia plugin — lifecycle, derive, routes
├── auth.middleware.ts       # Elysia middleware — stateless JWT verify, resolves authContext + guards
├── guards.ts               # requireAuth, requireAdmin — pure functions (~20 lines)
├── activity-tracker.ts     # ActivityTracker class — in-memory audit sessions (~150 lines)
├── audit.middleware.ts      # Elysia middleware — wires tracker into request lifecycle + ReactiveDB (~60 lines)
├── types.ts                # AuthContext, UserRecord, TokenPair, AuditSession, AuditEvent, config
└── index.ts                # Public API: all exports
```

Eight files. Each under 400 lines. Single responsibility per file.

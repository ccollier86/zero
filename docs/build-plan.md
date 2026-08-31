# Build Plan

**Four primitives. One SDK. One binary.**

Implementation order, dependency map, and file inventory for the platform.

> **Status (2026-06-28):** Historical implementation plan. All four phases are built and operational, but prototype-era examples in this file may mention lower-level sync names such as `useTable` or `useSyncStatus`. Current app-facing APIs are documented in [Frontend SDK](./frontend/sdk.md) and [SDK Reference](./sdk-reference.md): use `useCollection`, `useLazyCollection`, `useRow`, `useQuery`, and `useStatus` from `@zero/framework/react`.

Use the current SDK docs for copy-pasteable examples and public export names.

## Architecture Map

```
                         ┌──────────────────────────────────────────┐
                         │            createApp()                   │
                         │                                          │
                         │   ┌──────────┐ ┌───────┐ ┌───────────┐  │
                         │   │  Auth    │ │ State │ │  Router   │  │
                         │   │  Plugin  │ │ Sync  │ │  Plugin   │  │
                         │   └────┬─────┘ └───┬───┘ └─────┬─────┘  │
                         │        │           │           │         │
                         │        └─────┬─────┘           │         │
                         │              │                 │         │
                         │        ┌─────▼─────┐    ┌─────▼──────┐  │
                         │        │ Sync      │    │ React 19   │  │
                         │        │ Plugin    │    │ SSR +      │  │
                         │        │ (WS)      │    │ Hydration  │  │
                         │        └─────┬─────┘    └────────────┘  │
                         │              │                          │
                         │        ┌─────▼─────┐                    │
                         │        │ReactiveDB │                    │
                         │        │(bun:sqlite)│                   │
                         │        └───────────┘                    │
                         └──────────────────────────────────────────┘

                         ┌──────────────────────────────────────────┐
                         │         @platform/sdk (client)           │
                         │                                          │
                         │  createClient()                          │
                         │    ├── .collection<T>(name)  ← sync      │
                         │    ├── .auth                 ← auth      │
                         │    ├── .state                ← state sync│
                         │    └── .status               ← transport │
                         │                                          │
                         │  React Hooks                             │
                         │    ├── useTable, useRow, useQuery         │
                         │    ├── useAuth, useCurrentUser            │
                         │    ├── useServerState                     │
                         │    ├── useSyncStatus                      │
                         │    └── useParams, usePathname, Link       │
                         └──────────────────────────────────────────┘
```

## Dependency Graph

```
Phase 1: ReactiveDB
    └──▶ Phase 2: Sync Engine (plugin + client store)
             ├──▶ Phase 3a: Auth Plugin       ─┐
             └──▶ Phase 3b: State Sync         ─┼──▶ Phase 4: Frontend SDK + Router
                                                ─┘
```

- Phase 1 has zero dependencies (just bun:sqlite)
- Phase 2 depends on Phase 1
- Phases 3a and 3b depend on Phase 2, are independent of each other (parallel)
- Phase 4 depends on all prior phases

---

## Phase 1 — ReactiveDB

**What:** Standalone SQLite wrapper with change tracking. The foundation everything else builds on.

**Depends on:** bun:sqlite (built into Bun)

**External deps:** None

### Key Decisions (resolved in specs)

- **`_` prefix tables**: Still tracked in `_changes` ring buffer, still support `onChange`. Excluded from `server.publish()` by the sync plugin (not ReactiveDB). ReactiveDB has no concept of "internal."
- **Ring buffer prune**: Runs inside `db.transaction()`. Single atomic `DELETE`. No two-step.
- **`onChange` timing**: Callable anytime after construction. Sync plugin registers in `onStart` — before any connections.
- **Offline**: Connection is expected. No IndexedDB, no offline queue. Disconnected = offline banner via `useSyncStatus()`. Pending mutations in @xstate/store are lost if tab closes while disconnected. Reconnect sends `sync.subscribe` with `lastSeq` for catchup or fresh snapshot.

### Files to Build

```
src/sync/
├── reactive-db.ts          ~400 lines
│   ├── constructor(config: ReactiveDBConfig)
│   ├── defineTable(name, schema) → void
│   ├── insert(table, row) → Change
│   ├── update(table, id, partial) → Change
│   ├── delete(table, id) → Change
│   ├── query(table) → Row[]
│   ├── queryOne(table, id) → Row | null
│   ├── onChange(listener) → () => void
│   ├── getChangesAfter(seq) → Change[] | null
│   ├── transaction<T>(fn: () => T) → T
│   └── dispose() → void
│
├── types.ts                ~80 lines
│   ├── ReactiveDBConfig { mode, ringBufferDepth? }
│   ├── TableSchema = Record<string, string>
│   ├── Change { seq, table, op, rowId, row, ts }
│   └── TableDef (internal: columns, pk, prepared stmts)
│
└── index.ts                ~10 lines
    └── exports: createReactiveDB, types
```

**Total: ~490 lines, 3 files**

### SQL Created by ReactiveDB

```sql
-- Ring buffer (created in constructor)
CREATE TABLE IF NOT EXISTS _changes (
  seq     INTEGER PRIMARY KEY,
  tbl     TEXT NOT NULL,
  op      TEXT NOT NULL,
  row_id  TEXT NOT NULL,
  data    TEXT,
  ts      INTEGER NOT NULL
);

-- Per-table (created by defineTable())
CREATE TABLE IF NOT EXISTS {name} (
  {columns from schema}
);

-- PRAGMAs (constructor)
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA cache_size = -64000;
PRAGMA mmap_size = 268435456;
PRAGMA temp_store = MEMORY;
PRAGMA wal_autocheckpoint = 1000;
```

### Verification

- [ ] `defineTable()` creates table + prepared statements
- [ ] `insert/update/delete` write to table AND `_changes`
- [ ] `onChange` fires synchronously after every write
- [ ] `getChangesAfter(seq)` returns changes or null if seq is pruned
- [ ] `transaction()` wraps multiple writes atomically (one `onChange` per write, all or none committed)
- [ ] `dispose()` finalizes all prepared statements
- [ ] `:memory:` mode works (no file)
- [ ] WAL file mode works (durable)
- [ ] Ring buffer prunes in single transaction

---

## Phase 2 — Sync Engine

**What:** Elysia WebSocket plugin + @xstate/store client. Real-time table sync with optimistic mutations.

**Depends on:** Phase 1 (ReactiveDB)

**External deps:** `elysia`, `@xstate/store`, `react` (peer)

### Key Decisions (resolved in specs)

- **Subscribe**: Message-based only. Client sends `sync.subscribe { tables, lastSeq }` after connect. Query string is for `token` auth only.
- **Mutation flow**: Server writes → `server.publish(change)` to ALL → `ws.send(ack)` to originator. Order between change and ack doesn't matter — they serve different purposes.
- **`sync.change` origin field**: `origin: string` (connection ID). Originating client applies server's canonical row state (replacing optimistic — handles server-added timestamps etc). Non-originating clients just apply normally. `sync.ack` clears pending queue separately.
- **Catchup reducer**: Applies each change AND prunes matching pending mutations (`table + rowId` match = confirmed).
- **`SyncProvider` + `useSyncClient()`**: Defined. Provider creates client on mount, disconnects on unmount. Hook reads from context, throws if outside provider.
- **WS auth**: `open` handler verifies `ws.data.query.token`, derives authContext. Invalid → `ws.close(4001)`. No `beforeHandle`.
- **Pruned seq reconnect**: Server sends full `sync.snapshot` if `getChangesAfter(seq)` returns null.
- **Canonical message shape**: `{ type, seq, table, op, rowId, row, ts, origin }`. `row` is full object for INSERT/UPDATE, `null` for DELETE.

### Files to Build

```
src/sync/
├── reactive-db.ts          (Phase 1)
├── types.ts                (Phase 1, extended)
│   ├── + SyncPluginConfig { db: ReactiveDBConfig, tables }
│   ├── + SyncSocketData { subscribedTopics, lastSeq, authContext?, connectionId }
│   ├── + Message types (SyncSnapshot, SyncChange, SyncAck, SyncCatchup, SyncSubscribe, SyncMutate)
│   └── + ErrorCodes enum
│
├── sync.plugin.ts          ~300 lines
│   ├── createSyncPlugin(config) → Elysia
│   ├── onStart: defineTable() for each table, db.onChange() registration
│   ├── onStop: cleanup
│   ├── derive: { syncDB }
│   ├── .ws('/sync'): open, message, close handlers
│   └── getSyncDB() lazy getter
│
├── message-handler.ts      ~200 lines
│   ├── handleSubscribe(ws, msg, db) → send snapshot or catchup
│   ├── handleMutate(ws, msg, db, server) → write, ack, publish
│   └── routeMessage(ws, msg, db, server) → switch on type
│
├── index.ts                ~15 lines
│   └── exports: createSyncPlugin, getSyncDB, types
│
├── client/
│   ├── sync-client.ts      ~250 lines
│   │   ├── createSyncClient(config) → SyncClient
│   │   ├── connect() — WebSocket setup, reconnect logic
│   │   ├── send(msg) — buffered during reconnect
│   │   ├── insert/update/delete — optimistic + ws.send
│   │   └── disconnect()
│   │
│   ├── sync-store.ts       ~200 lines
│   │   ├── createSyncStore(tables) → { store }
│   │   ├── Reducers: sync.snapshot, sync.change, sync.ack, sync.catchup
│   │   ├── Optimistic reducers: {table}.optimistic-insert/update/delete
│   │   └── createTableSlice, createSlice
│   │
│   ├── hooks.ts            ~150 lines
│   │   ├── SyncProvider — context + createSyncClient on mount
│   │   ├── useSyncClient() → SyncClient (from context)
│   │   ├── useTable<T>(name) → UseTableResult<T>
│   │   ├── useRow<T>(name, id) → UseRowResult<T>
│   │   ├── useQuery<T>(name, filter) → T[]
│   │   └── useSyncStatus() → { connected, pending }
│   │
│   └── index.ts            ~10 lines
│       └── exports
```

**Total: ~1,225 lines, 8 files (including Phase 1 extensions)**

### Wire Protocol (Final)

```
Client → Server:
  sync.subscribe  { type, tables: string[], lastSeq: number }
  sync.mutate     { type, ref: string, table, op, rowId?, row? }

Server → Client:
  sync.snapshot   { type, tables: Record<string, Record<PK, Row>>, seq }
  sync.change     { type, seq, table, op, rowId, row, ts, origin }
  sync.ack        { type, ref, seq, ok, error? }
  sync.catchup    { type, changes: Change[], seq }
```

### Verification

- [ ] Plugin creates tables on start, registers onChange before any connections
- [ ] WS `open` validates auth token, assigns connectionId
- [ ] `sync.subscribe` sends snapshot (lastSeq=0) or catchup (gap within buffer) or snapshot (gap too large)
- [ ] `sync.mutate` writes to ReactiveDB, publishes change, sends ack
- [ ] `sync.change` includes `origin` field — originating client applies canonical row (replaces optimistic)
- [ ] `sync.ack` failure triggers rollback on client
- [ ] Reconnect with valid seq gets catchup, pruned seq gets full snapshot
- [ ] Backpressure handled (slow client doesn't crash server)
- [ ] Multiple tables with independent subscriptions
- [ ] `SyncProvider` + `useSyncClient()` work in React tree
- [ ] `useTable` returns `UseTableResult<T>` — `{ rows, isLoading, error, insert, update, delete, refetch }`

---

## Phase 3a — Auth Plugin

**What:** User registration, login, JWT tokens, role guards, activity audit. Elysia plugin sharing ReactiveDB with sync engine.

**Depends on:** Phase 2 (Sync Engine — auth tables are reactive, sync broadcasts user changes)

**External deps:** `jose` (JWT signing/verification)

**Parallel with:** Phase 3b (State Sync)

### Key Decisions (resolved in specs)

- **TokenServiceConfig**: `{ db: ReactiveDB, accessTokenTTL?: string, refreshTokenTTL?: string }`. Both TTLs are jose duration strings. Uses prepared statements on `_auth_config` table directly (no `getConfig()` method).
- **AuthContext**: `{ userId: string, email: string, role: 'user' | 'admin' }`. Defined in types.ts.
- **Table creation**: `users` and `user_properties` via `defineTable()` (reactive). `_credentials`, `_refresh_tokens`, `_auth_config`, `_audit_log` via `db.exec()` (internal).
- **Refresh token lookup**: `SELECT * WHERE token_hash = ?` returns all (including revoked). Check `revoked_at`/`expires_at` in code. Enables replay detection — reused revoked token → revoke ALL user tokens.
- **Inactivity**: `AuditConfig.onInactive?: (userId: string) => void` callback. Auth plugin wires it to revoke tokens + publish `auth.session-expired`. Clean DI — audit doesn't know about tokens.
- **Logout**: `POST /auth/logout` accepts an optional `{ refreshToken }` body and always clears/revokes the HttpOnly page session. Bearer auth is not required so logout can still clear the server-readable cookie after browser token state is lost.
- **SSR page session**: Successful auth completion also sets a refresh-bound HttpOnly `SameSite=Lax` cookie. The file router accepts it only for matched `GET`/`HEAD` pages; APIs, mutations, extensions, and sync remain Bearer-only.
- **`auth.session-expired`**: Published to `auth:{userId}` topic: `{ type, reason: 'inactive' | 'revoked' | 'token-expired' }`. Client clears auth state, fires `onSessionExpired`.

### Files to Build

```
src/auth/
├── user-store.ts           ~300 lines
│   ├── constructor(db: ReactiveDB) — prepared statements
│   ├── createUser(username, email, password, firstName?, lastName?) → UserRecord
│   ├── getUserById/ByUsername/ByEmail → UserRecord | null
│   ├── listUsers() → UserRecord[]
│   ├── updateUser(userId, partial) → UserRecord | null
│   ├── deleteUser(userId) → boolean
│   ├── verifyPassword(userId, password) → boolean
│   ├── updatePassword(userId, currentPassword, newPassword) → boolean
│   ├── setProperty/getProperty/getProperties/deleteProperty
│   ├── storeRefreshToken/getRefreshTokenByHash/revokeRefreshToken/revokeAllUserTokens
│   └── deleteExpiredTokens() → number
│
├── token-service.ts        ~250 lines
│   ├── static create(config: TokenServiceConfig) → TokenService
│   ├── signAccessToken(user) → string (JWT ES256)
│   ├── verifyAccessToken(token) → AccessTokenPayload | null
│   ├── createRefreshToken(userId) → { raw, tokenId }
│   ├── rotateRefreshToken(rawToken) → TokenPair | null
│   ├── getJWKS() → { keys: JWK[] }
│   └── private: loadOrGenerateKeypair(), hashToken()
│
├── auth.plugin.ts          ~200 lines
│   ├── createAuthPlugin(config: AuthPluginConfig) → Elysia
│   ├── onStart: define tables, init keypair, create services
│   ├── onStop: cleanup expired token cron
│   ├── POST /auth/register → createUser + issueTokens
│   ├── POST /auth/login → verify + issueTokens
│   ├── POST /auth/refresh → rotateRefreshToken
│   ├── POST /auth/logout → revokeRefreshToken
│   ├── POST /auth/change-password → verifyPassword + updatePassword
│   ├── GET  /auth/me → return user + properties
│   └── GET  /auth/jwks → return public key
│
├── auth.middleware.ts      ~50 lines
│   ├── createAuthMiddleware(getTokenService) → Elysia
│   └── derive: Authorization header → verifyAccessToken → authContext | null
│
├── guards.ts               ~30 lines
│   ├── requireAuth({ authContext }) — throws 401
│   └── requireAdmin({ authContext }) — throws 401/403
│
├── activity-tracker.ts     ~200 lines
│   ├── constructor(config: AuditConfig)
│   ├── startSession(userId, sessionId, meta?)
│   ├── endSession(userId, reason)
│   ├── trackRoute(userId, event)
│   ├── getActiveSessions() → Map
│   ├── dispose()
│   └── private: checkInactivity(), onInactive callback
│
├── audit.middleware.ts     ~60 lines
│   └── Elysia hooks — onBeforeHandle/onAfterHandle → trackRoute
│
├── types.ts                ~100 lines
│   ├── AuthContext { userId, email, role }
│   ├── UserRecord { userId, username, email, firstName, lastName, role, createdAt, updatedAt, properties }
│   ├── TokenPair { accessToken, refreshToken }
│   ├── RefreshTokenRecord { tokenId, userId, tokenHash, expiresAt, createdAt, revokedAt }
│   ├── AuthPluginConfig { db, accessTokenTTL?, refreshTokenTTL?, signingKey? }
│   ├── TokenServiceConfig { db, accessTokenTTL?, refreshTokenTTL? }
│   ├── AuditConfig { db, auditDir?, maxRecent?, flushIntervalMs?, inactivityTimeoutMs?, onInactive? }
│   ├── AuditSession { id, userId, startedAt, endedAt?, endReason?, events }
│   └── AuditEvent union (login, logout, route, data.read, data.write)
│
└── index.ts                ~20 lines
    └── exports: createAuthPlugin, createAuthMiddleware, guards, getAuthStore, getTokenService
```

**Total: ~1,210 lines, 9 files**

### SQL Schemas

```sql
-- Public (reactive, broadcast by sync plugin)
-- Created via db.defineTable()
users (user_id PK, username UNIQUE, email UNIQUE, first_name, last_name, role, created_at, updated_at)
user_properties (user_id + key composite PK, value, FK → users)

-- Internal (_ prefix, not broadcast)
-- Created via db.exec() in onStart
_credentials (user_id PK, password_hash, FK → users)
_refresh_tokens (token_id PK, user_id, token_hash, expires_at, created_at, revoked_at, FK → users)
_auth_config (key PK, value)
_audit_log (id PK, user_id, event_type, data, ts)
```

### HTTP Routes

| Method | Path | Auth | Request Body | Response |
|--------|------|------|-------------|----------|
| POST | /auth/register | No | `{ username, email, password, firstName?, lastName? }` | `{ accessToken, refreshToken, user }` |
| POST | /auth/login | No | `{ username, password }` | `{ accessToken, refreshToken, user }` |
| POST | /auth/refresh | No | `{ refreshToken }` | `{ accessToken, refreshToken }` |
| POST | /auth/logout | No | `{ refreshToken? }` | `{ ok: true }` |
| POST | /auth/change-password | Bearer | `{ currentPassword, newPassword }` | `{ ok: true }` |
| GET | /auth/me | Bearer | — | `{ user, properties }` |
| GET | /auth/jwks | No | — | `{ keys: JWK[] }` |

### Verification

- [ ] `POST /auth/register` creates user + credentials + issues tokens
- [ ] `POST /auth/login` verifies password, issues tokens, starts audit session
- [ ] `POST /auth/refresh` rotates token (old revoked, new issued). Replay detection: reuse of revoked token → revoke ALL user tokens
- [ ] `POST /auth/logout` revokes refresh token, ends audit session
- [ ] `POST /auth/change-password` verifies current password before updating
- [ ] Auth middleware derives `authContext` from Bearer header — does NOT throw (sets null)
- [ ] `requireAuth` guard throws 401 when `authContext` is null
- [ ] User changes broadcast via sync engine (users + user_properties are reactive tables)
- [ ] Password hashes stored in `_credentials` (internal, never broadcast)
- [ ] JWKS endpoint returns public key in standard format
- [ ] Inactivity timeout publishes `auth.session-expired` to user's auth topic

---

## Phase 3b — State Sync

**What:** Per-user reactive KV state. RAM + SQLite write-through. Rides existing sync WebSocket.

**Depends on:** Phase 2 (Sync Engine — uses same WS connection and pub/sub)

**External deps:** None (uses @xstate/store from Phase 2)

**Parallel with:** Phase 3a (Auth Plugin)

### Key Decisions (resolved in specs)

- **Error codes**: `state.ack { ok: false }` uses machine-readable codes: `VALUE_TOO_LARGE`, `TOO_MANY_KEYS`, `KEY_TOO_LONG`, `TOTAL_SIZE_EXCEEDED`, `UNAUTHORIZED`. Client rolls back on any failure.
- **No snapshot pagination V1**: Max 1000 keys, realistic <100KB. Warning logged if >1MB. Pagination is V2.
- **`auth.session-expired`**: Defined in auth spec. State sync client listens and clears local state.
- **Offline**: `set()` calls while disconnected are no-ops. Reconnect triggers fresh snapshot. No IndexedDB.

### Files to Build

```
src/sync/
├── state-manager.ts        ~200 lines
│   ├── constructor(db: Database) — prepared statements, RAM map
│   ├── getUserState(userId) → Map<string, JsonValue>
│   ├── set(userId, key, value) → { ok } | { ok, error }
│   ├── delete(userId, key) → void
│   ├── clear(userId) → void
│   └── private: validateLimits(), loadFromSQLite()
│
├── state-handler.ts        ~120 lines
│   ├── handleStateSubscribe(ws, userId, stateManager) → send snapshot
│   ├── handleStateSet(ws, msg, userId, stateManager, server) → persist + ack + publish
│   ├── handleStateDelete(ws, msg, userId, stateManager, server) → delete + ack + publish
│   └── handleStateClear(ws, msg, userId, stateManager, server) → clear + ack + publish
│
├── client/
│   ├── state-client.ts     ~180 lines
│   │   ├── constructor(sendMessage, store)
│   │   ├── set(key, value) → void (optimistic + send)
│   │   ├── get(key) / get(key, default) → JsonValue
│   │   ├── delete(key) → void
│   │   ├── getAll() → Record<string, JsonValue>
│   │   ├── getByPrefix(prefix) → Record<string, JsonValue>
│   │   ├── clear() → void
│   │   ├── subscribe(key, cb) / subscribe(cb) → () => void
│   │   └── readonly size, ready
│   │
│   ├── state-store.ts      ~120 lines
│   │   ├── createStateStore() → Store
│   │   └── Reducers: state.snapshot, state.change, state.optimistic-set/delete/clear, state.ack
│   │
│   └── state-hooks.ts      ~60 lines
│       ├── useServerState<T>(key, defaultValue) → [T, setter]
│       └── useServerStateReady() → boolean
```

**Total: ~680 lines, 5 files**

### Wire Protocol (adds to existing sync WS)

```
Client → Server:
  state.subscribe  { type }
  state.set        { type, ref, key, value }
  state.delete     { type, ref, key }
  state.clear      { type, ref }

Server → Client:
  state.snapshot   { type, entries: Record<string, JsonValue> }
  state.ack        { type, ref, ok, error? }
  state.change     { type, key, value, op: 'set'|'delete'|'clear' }
```

### SQL Schema

```sql
-- Internal (_ prefix, not broadcast)
CREATE TABLE IF NOT EXISTS _user_state (
  user_id    TEXT NOT NULL,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
);
CREATE INDEX IF NOT EXISTS idx_user_state_user ON _user_state(user_id);
```

### Verification

- [ ] `state.subscribe` loads from SQLite if RAM empty, sends snapshot
- [ ] `state.set` writes to RAM + SQLite, acks sender, publishes to other devices
- [ ] `state.delete` removes from RAM + SQLite, acks, publishes
- [ ] `state.clear` wipes all keys for user, acks, publishes
- [ ] Limits enforced: 64KB value, 1000 keys, 256 char key, 10MB total
- [ ] Limit violation returns `state.ack { ok: false, error }`, client rolls back
- [ ] Multi-device: change on one tab → `state.change` on all other tabs/devices
- [ ] Server restart: RAM empty, loads from SQLite on first subscribe
- [ ] `useServerState` works like `useState` — optimistic, persistent, synced
- [ ] Auth required — `state.subscribe` ignored if no `authContext`

---

## Phase 4 — Frontend SDK + Router

**What:** File-based router (React 19 SSR on Bun), unified client SDK, `createApp()` factory that wires everything together.

**Depends on:** All prior phases

**External deps:** `react`, `react-dom` (peer), `@elysiajs/static`

### Key Decisions (resolved in specs)

- **`useTable` return shape**: Always `UseTableResult<T>` — `{ rows: T[], isLoading, error, insert, update, delete, refetch }`. All examples destructure.
- **`stateSync` in AppConfig**: `stateSync?: boolean`. When true, state sync handler activates in WS router. Default: false.
- **`@platform/*` and `@app/*` imports**: tsconfig path aliases, NOT separate packages. `@zero/framework/react → src/frontend` (all app code: schema, hooks, components), `@zero/framework/server → src/frontend/server` (only for `app/server.ts`), `@platform/router → src/frontend/router`, `@platform/sync → src/sync`, `@platform/auth → src/auth`, `@/components/* → src/components/*`, `@app/* → app/*`. Always use aliases instead of relative paths -- see `docs/frontend/README.md` for full list.
- **SSR hooks**: WS-dependent hooks (`useTable`, `useServerState`) are not available during SSR. Server loads initial data, renders HTML, client hydrates, hooks take over with live data. `useAuth()` during SSR reads from request context.
- **DDL passthrough**: `Record<string, string>` table schemas are SQLite column definitions passed directly to `ReactiveDB.defineTable()`. No transformation.
- **404 handling**: `not-found.tsx` only. `error.tsx` is future (not V1). No `_error.tsx`.
- **`Collection<T>` type safety**: Generic T is a client-side type assertion. Server validates via schema. `createValidatedCollection<T>(name, schema)` adds client-side valibot validation.

### Client-Side Navigation (TanStack Router model)

The key insight: **table data is already live on the client via the sync engine**. Most navigations don't need data fetching. Navigation = swap component + update URL.

**First load (SSR):**
1. Server matches URL → loads route module + layouts → `renderToReadableStream`
2. HTML streams progressively (Suspense boundaries)
3. `bootstrapScripts` loads client bundle → `hydrateRoot()` → interactive
4. Sync engine connects → `useTable` hooks take over with live data

**Client navigation (SPA):**
1. `<Link>` intercepts click (preventDefault)
2. Client-side matcher resolves URL → route (same matcher as server)
3. Lazy-load route module if not cached: `await import('/chunks/dashboard-settings-[hash].js')`
4. If route exports a `loader`, call it (for non-synced data only)
5. Render page component — shared layouts stay mounted (React only re-renders changed subtree)
6. `history.pushState()` updates URL

**Preloading (hover intent):**
- `<Link prefetch="intent">` (default) — preload module + call loader on `mouseenter`/`focus`
- `<Link prefetch="render">` — preload when Link enters viewport (IntersectionObserver)
- `<Link prefetch="none">` — no preload
- By click time: module loaded, data ready → instant navigation

**Route loaders (optional — most pages don't need one):**
```tsx
// Only needed for data NOT in synced tables
export async function loader({ params, client }: LoaderContext) {
  return { stats: await client.rpc.dashboard.stats.get({ query: { teamId: params.teamId } }) };
}
export default function Dashboard({ data }: { data: Awaited<ReturnType<typeof loader>> }) {
  return <div>{data.stats.revenue}</div>;
}

// Synced data — NO loader needed, data is already live
export default function Todos() {
  const { rows, insert } = useTable<Todo>('todos');
  return <ul>{rows.map(t => <li key={t.id}>{t.title}</li>)}</ul>;
}
```

**Navigation state:**
```ts
useRouter() → {
  push(path): void;
  replace(path): void;
  back(): void;
  isNavigating: boolean;     // true while loading module + loader
  prefetch(path): void;      // manually trigger preload
}
```

**Scroll restoration:** Back/forward restores position. New navigation scrolls to top. Configurable per-route.

### Files to Build

**Router (server-side rendering):**

```
src/frontend/router/
├── scanner.ts              ~80 lines
│   ├── scanRoutes(appDir) → RawRoute[]
│   └── scanAPIRoutes(appDir) → RawRoute[]
│
├── route-tree.ts           ~120 lines
│   ├── buildRouteTree(routes) → RouteNode
│   └── buildAPIRouteTree(routes) → RouteNode
│
├── matcher.ts              ~100 lines
│   ├── matchURL(tree, path) → MatchResult | null
│   └── matchAPIRoute(tree, path) → MatchResult | null
│
├── renderer.ts             ~150 lines
│   ├── renderPage(match, request) → Response
│   ├── renderNotFound(tree) → Response
│   └── loadModule(mod) → React.ComponentType
│
└── types.ts                ~60 lines
    ├── RawRoute, RouteNode, RouteModule, MatchResult
    ├── APIRouteModule, RouterConfig
    └── APIRequest (extends Request with db, authContext)
```

**Server (app factory):**

```
src/frontend/server/
├── app-factory.ts          ~200 lines
│   ├── createApp(config: AppConfig) → Elysia
│   └── wires: auth plugin + auth middleware + sync plugin + router plugin + static files
│
├── router-plugin.ts        ~80 lines
│   ├── createRouterPlugin(config) → Elysia
│   ├── .all('/api/*') → API route handler
│   └── .get('*') → SSR catch-all
│
├── client-bundle.ts        ~60 lines
│   └── buildClientBundle(appDir, outDir) → Bun.build()
│
└── types.ts                ~80 lines
    └── AppConfig { db, tables, auth, stateSync?, appDir }
```

**Client (React hooks + providers):**

```
src/frontend/client/
├── app-provider.tsx        ~100 lines
│   ├── AppProvider — wraps SyncProvider + AuthProvider + RouterProvider + StateProvider
│   └── useClient() → Client
│
├── hooks.ts                ~120 lines
│   ├── useTable<T>(name) → UseTableResult<T>
│   ├── useRow<T>(name, id) → UseRowResult<T>
│   ├── useQuery<T>(name, filter) → T[]
│   ├── useAuth() → { user, isAuthenticated, login, register, logout }
│   ├── useCurrentUser() → User | null
│   ├── useSyncStatus() → 'connected' | 'disconnected' | 'reconnecting'
│   └── re-exports useServerState, useServerStateReady from state-hooks
│
├── link.tsx                ~80 lines
│   ├── <Link> — client-side navigation, hover preload, history.pushState
│   ├── prefetch="intent" | "render" | "none"
│   └── IntersectionObserver for viewport preloading
│
├── client-router.ts        ~150 lines
│   ├── ClientRouter — client-side route matching + navigation
│   ├── navigate(path) — lazy-load module, call loader, render, pushState
│   ├── prefetch(path) — preload module + loader data
│   ├── popstate handler — back/forward with scroll restoration
│   └── module cache (Map<path, Promise<RouteModule>>)
│
├── router-context.tsx      ~60 lines
│   ├── RouterProvider — pathname, params, isNavigating context
│   ├── useParams() → Record<string, string>
│   ├── usePathname() → string
│   └── useRouter() → { push, replace, back, isNavigating, prefetch }
│
└── hydrate-runtime.tsx     ~200 lines
    └── Browser hydration runtime used by .zero/generated/client-entry.tsx
```

**Public API:**

```
src/frontend/
└── index.ts                ~30 lines
    └── exports: createApp, AppProvider, all hooks, Link, types
```

**Total: ~1,510 lines, 15 files**

### Verification

- [ ] `bun run src/frontend/server/app-factory.ts` starts full server
- [ ] File in `app/page.tsx` renders at `/`
- [ ] File in `app/about/page.tsx` renders at `/about`
- [ ] Dynamic `app/blog/[slug]/page.tsx` renders at `/blog/hello` with `params.slug = 'hello'`
- [ ] `layout.tsx` wraps child routes
- [ ] Route groups `(marketing)/` don't create URL segments
- [ ] React 19 streaming — Suspense boundaries stream progressively
- [ ] Client hydration works — interactive after load
- [ ] `useTable('todos')` returns live data, updates on mutation
- [ ] `useAuth()` login/register/logout work
- [ ] `useServerState('theme', 'light')` persists across refresh
- [ ] `bun build --compile` produces single binary
- [ ] API routes at `app/api/todos/route.ts` handle GET/POST/PUT/DELETE
- [ ] Client-side navigation — `<Link>` click swaps component without full reload
- [ ] Shared layouts stay mounted across navigations
- [ ] Hover preload — module + loader prefetched on mouseenter
- [ ] Back/forward navigation restores scroll position
- [ ] Route loaders run for non-synced data, skipped for synced tables
- [ ] `useRouter().isNavigating` reflects loading state during navigation
- [ ] Offline banner shows via `useSyncStatus()` when disconnected

---

## Summary

| Phase | Files | Lines | External Deps | Delivers |
|-------|-------|-------|---------------|----------|
| 1 — ReactiveDB | 3 | ~490 | bun:sqlite | Change-tracked SQLite wrapper |
| 2 — Sync Engine | 8 | ~1,225 | elysia, @xstate/store | Real-time table sync (server + client) |
| 3a — Auth | 9 | ~1,210 | jose | Users, JWT, guards, audit |
| 3b — State Sync | 5 | ~680 | — | Per-user persistent KV |
| 4 — Frontend | 15 | ~1,510 | react, react-dom | Router (TanStack-style), SSR, SDK, createApp |
| **Total** | **40** | **~5,115** | | |

### Build Order

```
Week 1:  Phase 1 (ReactiveDB) → Phase 2 (Sync Engine)
Week 2:  Phase 3a (Auth) + Phase 3b (State Sync) in parallel
Week 3:  Phase 4 (Frontend SDK + Router)
Week 4:  Integration testing, single-binary compile, polish
```

Each phase produces a working, testable library. Phase 1 can run standalone tests with bun:sqlite. Phase 2 adds WebSocket tests. Phases 3a/3b add their own test suites. Phase 4 wires everything together and tests the full loop.

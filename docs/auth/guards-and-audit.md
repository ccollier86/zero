# Guards & Activity Audit

Route protection by role + automatic activity tracking. The guard is a one-liner per route group. The audit trail is wire-once, captures everything — routes visited, data read, data mutated, login/logout — grouped by session, stored in memory.

## Role Guard

### The Idea

Two roles: `admin` and `user`. Three access levels:

| Level | Who gets in | Used for |
|-------|------------|----------|
| `'public'` | Anyone (no auth required) | `/auth/login`, `/auth/register`, `/auth/forgot-password`, `/auth/jwks` |
| `'user'` | Any authenticated user (`user` or `admin`) | App routes — `/api/todos`, `/api/me`, `/sync` |
| `'admin'` | Admin only | `/admin/users`, user management |

`admin` is a superset of `user`. There's no role that `user` has but `admin` doesn't.

### Guard Functions

```ts
// src/auth/guards.ts

import type { AuthContext } from './types';

/** Throws 401 if not authenticated */
export function requireAuth({ authContext }: { authContext: AuthContext | null }) {
  if (!authContext) {
    throw new AppError('Unauthorized', 'UNAUTHORIZED', 401);
  }
}

/** Throws 401 if not authenticated, 403 if not admin */
export function requireAdmin({ authContext }: { authContext: AuthContext | null }) {
  if (!authContext) {
    throw new AppError('Unauthorized', 'UNAUTHORIZED', 401);
  }
  if (authContext.role !== 'admin') {
    throw new AppError('Forbidden', 'FORBIDDEN', 403);
  }
}
```

Two functions. No classes, no configuration, no middleware plugin. They read `authContext` (already derived by the auth middleware) and throw or don't.

### Usage: Route Groups

Elysia's `guard()` applies `beforeHandle` to every route in a group:

```ts
const app = new Elysia()
  .use(createAuthPlugin({ db }))
  .use(createAuthMiddleware(getTokenService))
  .use(createAuditMiddleware({ db }))
  .use(createSyncPlugin({ db, tables: { ... } }))

  // ─── Public routes (no guard) ─────────────────────
  // Auth plugin already handles /auth/login, /auth/register, /auth/jwks
  // Nothing extra needed — routes without a guard are public.

  // ─── User routes (any authenticated user) ─────────
  .guard({ beforeHandle: [requireAuth] }, app => app
    .get('/api/todos', ({ syncDB }) => syncDB!.query('todos'))
    .get('/api/me', ({ authContext }) => authContext)
    .post('/api/todos', ({ syncDB, body }) => {
      return syncDB!.insert('todos', body);
    })
  )

  // ─── Admin routes ─────────────────────────────────
  .guard({ beforeHandle: [requireAdmin] }, app => app
    .get('/admin/users', ({ authStore }) => authStore!.listUsers())
    .delete('/admin/users/:id', ({ authStore, params }) => {
      return authStore!.deleteUser(params.id);
    })
  )

  .listen(3000);
```

**Public by default, guarded by group.** Routes outside a `guard()` block are public. The auth middleware still runs (it derives `authContext`) but doesn't block — it just sets `authContext: null` for unauthenticated requests. The guard functions are what enforce.

### Usage: Per-Route

For one-off protection without a group:

```ts
.get('/api/sensitive', handler, { beforeHandle: [requireAdmin] })
```

### WebSocket Guard

The sync engine's WS endpoint verifies the access token during the WebSocket `open` lifecycle. HTTP middleware does not automatically populate WebSocket context, so sync receives a lazy token verifier from auth and stores the verified identity on `ws.data.authContext`.

```ts
createSyncPlugin({
  db,
  tables,
  auth: {
    required: true,
    getTokenVerifier: getTokenService,
  },
  policy: {
    canReadTable({ table, authContext }) {
      if (authContext?.role === 'admin') return true;
      return !table.startsWith('admin_');
    },
  },
});
```

Role can determine table visibility through `SyncPolicy.canReadTable`. Direct client writes are checked separately with `canMutateTable`, `canInsert`, `canUpdate`, and `canDelete` (see [Subscription And Mutation Policy](../realtime-sync/realtime-sync/README.md#subscription-and-mutation-policy)).

## Inactivity Timeout

No activity for X minutes → server kills the session, pushes a signal over the WS, SDK wipes auth state and redirects to login. Instant — the real-time connection is always there.

### How It Works

```
User idle for 30 min
        │
        ▼
┌── Server (periodic scan) ──────────────────────────────────────────┐
│                                                                     │
│  ActivityTracker: last event for u_alice was 30min ago              │
│    │                                                                │
│    ├── tracker.endSession('u_alice', 'inactive')  → audit file     │
│    ├── tokenService.revokeAllUserTokens('u_alice') → DB            │
│    │                                                                │
│    └── server.publish('auth:u_alice', {            → WS push       │
│          type: 'auth.session-expired',                              │
│          reason: 'inactive',                                        │
│        })                                                           │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
        │
        ▼ (WS delivers instantly — connection is always live)
┌── Client SDK ───────────────────────────────────────────────────────┐
│                                                                     │
│  routeMessage() receives 'auth.session-expired'                     │
│    │                                                                │
│    ├── store.send('auth.clear')  → wipe tokens + user from state   │
│    ├── ws.close()                → drop the sync connection         │
│    └── onSessionExpired()        → app callback → redirect /login  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Heartbeat vs. activity:** The WS connection stays alive via ping/pong (Bun handles this automatically). A user staring at a tab for 30 minutes has a live WebSocket but zero audit events — that's inactive. The inactivity check measures *application activity* (route hits, DB reads/writes, WS mutations), not connection liveness.

### Server Side

The periodic scan runs inside the audit middleware. Every 30 seconds, check each active session's last event timestamp:

```ts
// In audit middleware — onStart
const scanInterval = setInterval(() => {
  const now = Date.now();
  for (const [userId, session] of tracker.getActiveSessions()) {
    const lastEvent = session.events.at(-1);
    if (!lastEvent || now - lastEvent.ts < config.inactivityTimeoutMs) continue;

    // End the audit session
    tracker.endSession(userId, 'inactive');

    // Notify via callback — auth plugin handles token revocation + client push
    config.onInactive?.(userId);
  }
}, 30_000);

// In audit middleware — onStop
clearInterval(scanInterval);
```

**Personal auth topic:** Each client subscribes to `auth:{userId}` alongside the `sync:*` table topics when the WS connection opens. One extra `ws.subscribe()` call in the sync plugin's `open` handler:

```ts
// In sync plugin WS open handler
open(ws) {
  const authContext = (ws.data as Record<string, unknown>).authContext as AuthContext | null;
  if (authContext) {
    ws.subscribe(`auth:${authContext.userId}`);  // personal auth channel
  }
  // ... existing table topic subscriptions
}
```

Bun auto-unsubscribes on close. No cleanup needed.

### Client Side

The SDK routes the message like any other WS message. One new case in the switch:

```ts
// In SDK routeMessage()
case 'auth.session-expired':
  store.send({ type: 'auth.clear' });   // wipe tokens, user state
  ws.close();                            // drop WS connection
  onSessionExpired?.(msg.reason);        // app-provided callback
  break;
```

The app registers the callback at init:

```ts
const app = createApp({
  serverUrl: 'http://localhost:3000',
  tables: { ... },
  onSessionExpired: (reason) => {
    // reason: 'inactive' | 'forced' | 'expired'
    router.navigate('/login');
    toast.info('Session expired — please log in again');
  },
});
```

**What the user sees:** They're staring at a page. 30 minutes pass. Suddenly the page redirects to login. Their reactive data, auth-gated routes — all gone from memory. Clean slate. They log in, get a fresh session, the sync engine sends a fresh snapshot, everything rebuilds.

### Why This Is Reliable

The real-time WS connection is **always present** when the app is running. It's not optional infrastructure — it's the sync engine, the backbone. If the user has the app open, the WS is open. If the WS drops, the client reconnects automatically (exponential backoff). The auth signal rides the same connection that powers everything else.

No HTTP polling. No `setInterval` on the client checking token expiry. No "check auth on next route navigation." The server decides, the server pushes, the client reacts. One direction, one code path.

| Scenario | What happens |
|----------|-------------|
| User idle 30min, tab open | Server pushes `auth.session-expired` → SDK redirects to login |
| User idle 30min, tab backgrounded | Same — WS stays alive in background, push still delivered |
| User idle, WS drops and reconnects | On reconnect, server checks: session already ended → sends `auth.session-expired` immediately |
| Admin force-revokes user | Same push mechanism: `server.publish('auth:{userId}', ...)` → instant redirect |
| User's refresh token expires naturally | On next refresh attempt, server returns 401 → SDK triggers same `onSessionExpired` path |

## Activity Audit

### The Idea

Wire it up once. Every route hit, every DB read, every DB write, every login, every logout — captured automatically, grouped by user session, held in memory.

```ts
// Wire up — one line
.use(createAuditMiddleware({ db }))

// That's it. Everything below is automatic.
// Routes:  GET /api/todos → tracked
// Reads:   syncDB.query('todos') → tracked (table + record IDs)
// Writes:  syncDB.insert('todos', row) → tracked (table + record ID + op)
// Login:   POST /auth/login → session started
// Logout:  POST /auth/logout → session ended
```

No per-route instrumentation. No `audit.log()` calls in handlers. No decorators. The middleware hooks into Elysia's request lifecycle and ReactiveDB's event system. Route handlers don't know the audit exists.

### How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                     Audit Middleware                              │
│                                                                  │
│  onBeforeHandle                                                  │
│  ├── tracker.setCurrentUser(authContext?.userId)                  │
│  └── record request start time                                   │
│                                                                  │
│  During request handling (synchronous)                           │
│  ├── syncDB.query('todos')     → onQuery fires → tracker logs    │
│  ├── syncDB.insert('todos', r) → onChange fires → tracker logs   │
│  └── all DB ops attributed to currentUser (single-threaded)      │
│                                                                  │
│  onAfterHandle                                                   │
│  ├── tracker.trackRoute(method, path, status, duration)          │
│  └── tracker.setCurrentUser(null)                                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Why this works without AsyncLocalStorage:** bun:sqlite is synchronous. Bun's JS runs on a single thread. When a request handler calls `syncDB.query('todos')`, that query executes synchronously in the same call stack. The `onQuery` listener fires synchronously. `tracker.currentUser` is set before the handler runs and cleared after. There's no interleaving — request A's DB call can't overlap with request B's.

### ReactiveDB Hooks

ReactiveDB already has `onChange` for write tracking. The audit system needs one addition — `onQuery` for read tracking:

```ts
// Added to ReactiveDB
onQuery(listener: (event: QueryEvent) => void): () => void;

interface QueryEvent {
  table: string;
  type: 'getAll' | 'getOne';
  rowIds: string[];     // Primary key values of returned rows
  count: number;        // Number of rows returned
}
```

Same pattern as `onChange` — register a listener, get an unsubscribe function. Fires synchronously after every `query()` and `queryOne()` call. Error-isolated (listener throw doesn't propagate to caller).

`onChange` already provides everything needed for write tracking:

```ts
// Existing ReactiveDB onChange
interface Change {
  seq: number;
  table: string;
  op: 'INSERT' | 'UPDATE' | 'DELETE';
  rowId: string;
  row: Record<string, unknown> | null;
  ts: number;
}
```

The audit system registers both listeners once at startup. Combined with `currentUser`, every DB operation is attributed to the user who triggered it.

### Data Model

```ts
/** A user's activity from login to logout */
interface AuditSession {
  id: string;                    // Session ID (from auth — tied to refresh token)
  userId: string;
  startedAt: number;
  endedAt?: number;
  endReason?: 'logout' | 'expired' | 'forced' | 'inactive';
  events: AuditEvent[];
}

type AuditEvent =
  | LoginEvent
  | LogoutEvent
  | RouteEvent
  | DataReadEvent
  | DataWriteEvent;

interface LoginEvent {
  type: 'login';
  ts: number;
  ip?: string;
  userAgent?: string;
}

interface LogoutEvent {
  type: 'logout';
  ts: number;
  reason: 'manual' | 'expired' | 'forced' | 'inactive';
}

interface RouteEvent {
  type: 'route';
  ts: number;
  method: string;                // GET, POST, PUT, DELETE
  path: string;                  // /api/todos, /admin/users
  status: number;                // 200, 404, 500
  ms: number;                    // Response time
}

interface DataReadEvent {
  type: 'data.read';
  ts: number;
  table: string;                 // 'todos', 'users'
  recordIds: string[];           // ['uuid-1', 'uuid-2', ...] — PKs of returned rows
  count: number;                 // Number of records
}

interface DataWriteEvent {
  type: 'data.insert' | 'data.update' | 'data.delete';
  ts: number;
  table: string;
  recordId: string;              // PK of the affected row
}
```

**`recordIds` on reads is the key field.** When a user loads a list of records, the audit captures exactly which record IDs were returned. At any point you can answer: "what data did this user see at 2:34 PM?" — the audit session has the `data.read` event with the exact table and record IDs.

### ActivityTracker

In-memory for the hot path, drains to disk on session end. Active sessions accumulate events in a `Map`. When a session ends, the writer dumps it to a JSON file and it leaves memory.

```ts
class ActivityTracker {
  /** Active sessions — one per logged-in user */
  private active = new Map<string, AuditSession>();

  /** Recent completed sessions — small ring buffer for debugging only */
  private recent: AuditSession[] = [];
  private maxRecent: number;

  /** Write-only file drain */
  private writer: AuditWriter;

  /** Current request's user — set per-request, single-threaded safety */
  private currentUserId: string | null = null;

  private unsubChange: (() => void) | null = null;
  private unsubQuery: (() => void) | null = null;

  constructor(config: { db: ReactiveDB; auditDir?: string; maxRecent?: number }) {
    this.maxRecent = config.maxRecent ?? 50;
    this.writer = new AuditWriter(config.auditDir ?? 'data/audit');

    // ─── Wire into ReactiveDB — fires for ALL operations ──
    this.unsubChange = config.db.onChange((change) => {
      if (!this.currentUserId) return;
      if (change.table.startsWith('_')) return;  // Skip internal tables

      this.pushEvent(this.currentUserId, {
        type: `data.${change.op.toLowerCase()}` as DataWriteEvent['type'],
        ts: change.ts,
        table: change.table,
        recordId: change.rowId,
      });
    });

    this.unsubQuery = config.db.onQuery((event) => {
      if (!this.currentUserId) return;
      if (event.table.startsWith('_')) return;

      this.pushEvent(this.currentUserId, {
        type: 'data.read',
        ts: Date.now(),
        table: event.table,
        recordIds: event.rowIds,
        count: event.count,
      });
    });
  }

  /** Called by middleware — sets context for the current request */
  setCurrentUser(userId: string | null): void {
    this.currentUserId = userId;
  }

  /** Start a new audit session (called on login) */
  startSession(userId: string, sessionId: string, meta?: { ip?: string; ua?: string }): void {
    this.active.set(userId, {
      id: sessionId,
      userId,
      startedAt: Date.now(),
      events: [{
        type: 'login',
        ts: Date.now(),
        ip: meta?.ip,
        userAgent: meta?.ua,
      }],
    });
  }

  /** End an audit session (called on logout / expiry / force) */
  endSession(userId: string, reason: LogoutEvent['reason']): void {
    const session = this.active.get(userId);
    if (!session) return;

    session.endedAt = Date.now();
    session.endReason = reason;
    session.events.push({ type: 'logout', ts: Date.now(), reason });

    // Small recent buffer for debugging (not for querying)
    this.recent.push(session);
    if (this.recent.length > this.maxRecent) {
      this.recent.shift();
    }
    this.active.delete(userId);

    // Drain to disk — async, fire-and-forget
    this.writer.write(session).catch(err => {
      console.error('[audit] Failed to write session:', err);
    });
  }

  /** Track a route visit (called by onAfterHandle) */
  trackRoute(userId: string, event: Omit<RouteEvent, 'type'>): void {
    this.pushEvent(userId, { type: 'route', ...event });
  }

  dispose(): void {
    this.unsubChange?.();
    this.unsubQuery?.();
  }

  private pushEvent(userId: string, event: AuditEvent): void {
    const session = this.active.get(userId);
    if (!session) return;  // User not in an active audit session — skip
    session.events.push(event);
  }
}
```

### Middleware Plugin

```ts
// src/auth/audit.middleware.ts

export function createAuditMiddleware(config: AuditConfig) {
  const tracker = new ActivityTracker(config);

  return new Elysia({ name: 'audit' })

    .onStart(() => {
      console.log('[audit] Activity tracking enabled');
    })

    .onStop(() => {
      tracker.dispose();
      console.log('[audit] Stopped');
    })

    // Expose tracker for auth plugin (login/logout events) and admin routes
    .derive({ as: 'global' }, () => ({
      activityTracker: tracker,
    }))

    // ─── Automatic request tracking ─────────────────
    .onBeforeHandle(({ authContext, request }) => {
      tracker.setCurrentUser(authContext?.userId ?? null);
      // Stash start time on request for duration calc
      (request as Record<string, unknown>).__auditStart = performance.now();
    })

    .onAfterHandle(({ authContext, request, path, set }) => {
      if (authContext) {
        const start = (request as Record<string, unknown>).__auditStart as number;
        tracker.trackRoute(authContext.userId, {
          ts: Date.now(),
          method: request.method,
          path,
          status: (set.status as number) ?? 200,
          ms: Math.round(performance.now() - start),
        });
      }
      tracker.setCurrentUser(null);
    })

    .onError(({ authContext }) => {
      // Clear user context on error too
      tracker.setCurrentUser(null);
    });
}
```

**Wire once:**

```ts
const app = new Elysia()
  .use(createAuthPlugin({ db }))
  .use(createAuthMiddleware(getTokenService))
  .use(createAuditMiddleware({ db }))              // ← one line
  .use(createSyncPlugin({ db, tables: { ... } }))
  .listen(3000);
```

Everything after this line is tracked automatically. No route code changes. No `audit.log()` calls. Sit and forget.

### Auth Plugin Integration

The auth plugin calls `activityTracker.startSession()` on login and `endSession()` on logout. Since the tracker is derived globally, the auth plugin accesses it from context:

```ts
// Inside auth.plugin.ts

.post('/login', async ({ activityTracker, body, request }) => {
  // ... verify credentials, issue tokens ...

  activityTracker?.startSession(user.userId, sessionId, {
    ip: request.headers.get('x-forwarded-for') ?? undefined,
    ua: request.headers.get('user-agent') ?? undefined,
  });

  return { accessToken, refreshToken, user };
})

.post('/logout', ({ activityTracker, authContext, body }) => {
  // ... revoke refresh token ...

  if (authContext) {
    activityTracker?.endSession(authContext.userId, 'manual');
  }

  return { ok: true };
})
```

**Forced logout / inactivity:** If the server detects an expired refresh token (user didn't re-authenticate within the refresh window), it calls `endSession(userId, 'expired')`. If an admin revokes a user's tokens, it calls `endSession(userId, 'forced')`. Inactivity timeout (no requests for N minutes) can be checked via a periodic scan of active sessions — if `lastEventTs` exceeds the threshold, `endSession(userId, 'inactive')`.

### What Gets Captured (Example)

Alice logs in, browses todos, adds one, views users, logs out:

```ts
{
  id: 'sess_abc123',
  userId: 'u_alice',
  startedAt: 1709500000000,
  endedAt:   1709503600000,
  endReason: 'logout',
  events: [
    { type: 'login',       ts: 1709500000000, ip: '192.168.1.10', userAgent: 'Mozilla/5.0...' },
    { type: 'route',       ts: 1709500001000, method: 'GET',  path: '/api/todos', status: 200, ms: 3 },
    { type: 'data.read',   ts: 1709500001002, table: 'todos', recordIds: ['t_1', 't_2', 't_3'], count: 3 },
    { type: 'route',       ts: 1709500060000, method: 'POST', path: '/api/todos', status: 200, ms: 5 },
    { type: 'data.insert', ts: 1709500060003, table: 'todos', recordId: 't_4' },
    { type: 'route',       ts: 1709500120000, method: 'GET',  path: '/admin/users', status: 200, ms: 2 },
    { type: 'data.read',   ts: 1709500120001, table: 'users', recordIds: ['u_alice', 'u_bob'], count: 2 },
    { type: 'route',       ts: 1709503600000, method: 'POST', path: '/auth/logout', status: 200, ms: 1 },
    { type: 'logout',      ts: 1709503600000, reason: 'manual' },
  ]
}
```

**Answer any question about Alice's session:**
- What pages did she visit? → Filter `type: 'route'`
- What data did she see? → Filter `type: 'data.read'` — table `todos`, records `t_1, t_2, t_3`
- What did she change? → Filter `type: 'data.insert'` — added `t_4` to `todos`
- When did she leave? → `endedAt`, `endReason: 'logout'`

### WS Activity Tracking

WebSocket mutations through the sync engine are also tracked. The sync plugin's WS `message` handler runs synchronously — same single-threaded guarantee:

```
WS message arrives
  │
  ├── Sync plugin message handler
  │   ├── tracker.setCurrentUser(ws.data.authContext.userId)
  │   ├── db.insert('todos', row)  ← onChange fires, tracker logs data.insert
  │   └── tracker.setCurrentUser(null)
  │
  └── The audit event is captured — same as HTTP
```

The sync plugin just needs two lines at the start and end of its `message` handler:

```ts
message(ws, message) {
  const userId = (ws.data as Record<string, unknown>).authContext?.userId;
  tracker?.setCurrentUser(userId ?? null);

  // ... existing message routing (sync.subscribe, sync.mutate) ...

  tracker?.setCurrentUser(null);
}
```

### Storage

Two tiers: in-memory for the hot path (zero overhead per request), JSON files on disk for persistence (one file per session, folders per user).

```
                   In-Memory                              Disk
              ┌─────────────────┐                 ┌───────────────────────────┐
              │  active Map     │   endSession()  │  data/audit/              │
  events ────►│  (per user)     │ ───────────────►│  ├── u_alice/             │
              │                 │   write .json    │  │   ├── 2026-03-03/      │
              │  recent[]       │                  │  │   │   ├── sess_abc.json│
              │  (ring buffer)  │                  │  │   │   └── sess_def.json│
              └─────────────────┘                 │  │   └── 2026-03-02/      │
                query active                       │  │       └── sess_ghi.json│
                sessions here                      │  ├── u_bob/              │
                                                   │  │   └── 2026-03-03/     │
                                                   │  │       └── sess_jkl.json│
                                                   │  └── _active/            │
                                                   │      └── (crash recovery) │
                                                   └───────────────────────────┘
                                                     query historical sessions
                                                     by user, date, or both
```

| Tier | Contents | Writes | Lifetime |
|------|----------|--------|----------|
| `active` Map | One `AuditSession` per logged-in user | Every event (synchronous, in-process) | Until logout/expiry |
| `recent` array | Ring buffer of recently ended sessions (default 100) | On session end | Until evicted (FIFO) |
| JSON files | One file per completed session | On session end (async write) | Permanent |

**The in-memory tier is the working set.** Route handlers, ReactiveDB listeners, and the middleware all write here synchronously during request handling. Zero I/O on the hot path.

**The JSON files are the audit record.** When a session ends, the complete `AuditSession` object is written as a single JSON file into the user's date folder. The directory structure itself is the index — no database, no parsing needed to find sessions.

### Directory Structure

Folder per user, subfolder per date, file per session:

```
data/audit/
├── u_alice/
│   ├── 2026-03-03/
│   │   ├── sess_a1b2c3.json        ← morning session
│   │   └── sess_d4e5f6.json        ← afternoon session (re-login)
│   ├── 2026-03-02/
│   │   └── sess_g7h8i9.json
│   └── 2026-03-01/
│       └── sess_j0k1l2.json
├── u_bob/
│   ├── 2026-03-03/
│   │   └── sess_m3n4o5.json
│   └── 2026-03-01/
│       └── sess_p6q7r8.json
└── _active/
    ├── u_alice.json                 ← crash recovery snapshot
    └── u_bob.json
```

**The filesystem is the index.** No parsing needed for most queries:

| Question | Answer | How |
|----------|--------|-----|
| All of Alice's sessions? | `ls data/audit/u_alice/` | List user folder |
| Alice's sessions on March 3? | `ls data/audit/u_alice/2026-03-03/` | List date subfolder |
| All activity on March 3? | `ls data/audit/*/2026-03-03/` | Glob across users |
| All users who have audit data? | `ls data/audit/` | List root (skip `_active`) |
| Specific session details? | Read the one `.json` file | Direct file read |
| How many sessions total? | `find data/audit -name '*.json' | wc -l` | Count files |

No grep. No jq. No parsing. Just `ls` and `cat`.

### File Format

Each session file is a single, self-contained JSON object (not JSONL — one session = one file = one object):

```json
{
  "id": "sess_a1b2c3",
  "userId": "u_alice",
  "startedAt": 1709500000000,
  "endedAt": 1709503600000,
  "endReason": "logout",
  "events": [
    { "type": "login", "ts": 1709500000000, "ip": "192.168.1.10", "userAgent": "Mozilla/5.0..." },
    { "type": "route", "ts": 1709500001000, "method": "GET", "path": "/api/todos", "status": 200, "ms": 3 },
    { "type": "data.read", "ts": 1709500001002, "table": "todos", "recordIds": ["t_1", "t_2", "t_3"], "count": 3 },
    { "type": "route", "ts": 1709500060000, "method": "POST", "path": "/api/todos", "status": 200, "ms": 5 },
    { "type": "data.insert", "ts": 1709500060003, "table": "todos", "recordId": "t_4" },
    { "type": "route", "ts": 1709503600000, "method": "POST", "path": "/auth/logout", "status": 200, "ms": 1 },
    { "type": "logout", "ts": 1709503600000, "reason": "manual" }
  ]
}
```

**Why one file per session, not JSONL:**
- **The folder structure answers the common questions.** "Who?" = user folder. "When?" = date folder. "What?" = open the file. No parsing needed for navigation.
- **Each session is independently readable.** `cat sess_a1b2c3.json | jq .` — valid JSON, pretty-printable, no line extraction needed.
- **Trivially archivable.** Zip a user's folder. Zip a date folder. Ship to cold storage. Move old folders to S3.
- **Deletion is `rm`.** Remove a user's data? `rm -rf data/audit/u_alice/`. Remove a day? `rm -rf data/audit/*/2026-03-01/`. No database surgery.

**Why not a database:**
- Same reasons as before: zero hot-path overhead, no schema, no indexes, no transactions, no coupling.
- The folder-per-user structure gives you "indexed" access to user + date without maintaining actual indexes.

### AuditWriter

Write-only. The app drains sessions to disk and never reads them back. Audit files are consumed externally — `cat`, `jq`, `ls`, a separate admin tool, a log aggregator. Keeping the app write-only means there's no API surface to expose or tamper with audit data through the running application.

```ts
class AuditWriter {
  private dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  /** Write a completed session to its user/date/session.json path */
  async write(session: AuditSession): Promise<void> {
    const date = new Date(session.endedAt!).toISOString().slice(0, 10);
    const path = `${this.dir}/${session.userId}/${date}/${session.id}.json`;

    // Bun.write creates parent dirs automatically
    await Bun.write(path, JSON.stringify(session, null, 2));
  }
}
```

That's it. One class, one method, one `Bun.write()` call. The writer doesn't read, query, list, or delete anything. It creates files and nothing else.

**Why write-only:**
- **Tamper resistance.** The running application cannot read or modify audit data. A compromised app process can't enumerate sessions, alter records, or selectively delete evidence. The files are only accessible via filesystem tools or a separate trusted process.
- **Minimal attack surface.** No `/admin/audit` API routes that could leak session data. No query methods that could be abused for enumeration. The app doesn't even know how to parse its own audit files.
- **Separation of duties.** The app generates audit data. A separate tool/person reviews it. These are different roles with different access. The app shouldn't be in the business of serving its own audit trail.
- **Simplicity.** ~15 lines of code. Nothing to test except "did the file get created?"

### Crash Recovery

If the process crashes mid-session, active sessions haven't been written to disk yet. The `_active/` folder holds periodic snapshots:

```
data/audit/
└── _active/
    ├── u_alice.json     ← snapshot of Alice's in-progress session
    └── u_bob.json       ← snapshot of Bob's in-progress session
```

**Periodic flush (recommended):** Every N minutes, snapshot each active session to `_active/{userId}.json`. On startup, read `_active/` to recover in-flight sessions:

```ts
// Periodic flush — cron via Elysia or setInterval
private flushActive(): void {
  for (const [userId, session] of this.active) {
    // Overwrite — this is a snapshot of the current state
    Bun.write(
      `${this.dir}/_active/${userId}.json`,
      JSON.stringify(session, null, 2),
    );
  }
}

// On startup — recover crashed sessions
private async recoverActive(): Promise<void> {
  const glob = new Bun.Glob('*.json');
  for await (const file of glob.scan(`${this.dir}/_active`)) {
    const text = await Bun.file(`${this.dir}/_active/${file}`).text();
    const session: AuditSession = JSON.parse(text);

    // End as 'forced' — process crashed during this session
    session.endedAt = Date.now();
    session.endReason = 'forced';
    session.events.push({ type: 'logout', ts: Date.now(), reason: 'forced' });

    // Write to the user's permanent audit folder
    await this.writer.write(session);

    // Clean up snapshot
    await Bun.write(`${this.dir}/_active/${file}`, '');
  }
}
```

One snapshot file per active user — overwritten each flush cycle. On recovery, each snapshot is finalized as a 'forced' logout and moved to the user's permanent folder.

### Reading Audit Data

The app doesn't read its own audit files. Review happens externally — the filesystem is the query layer.

**CLI / shell — the directory IS the query:**

```bash
# Who has audit data?
ls data/audit/
# → u_alice/  u_bob/  _active/

# All of Alice's session dates
ls data/audit/u_alice/
# → 2026-03-01/  2026-03-02/  2026-03-03/

# Alice's sessions on March 3
ls data/audit/u_alice/2026-03-03/
# → sess_a1b2c3.json  sess_d4e5f6.json

# Read a specific session (it's just JSON)
cat data/audit/u_alice/2026-03-03/sess_a1b2c3.json | jq .

# All activity on March 3 across all users
cat data/audit/*/2026-03-03/*.json | jq .

# What data did Alice read today?
cat data/audit/u_alice/2026-03-03/*.json \
  | jq '.events[] | select(.type == "data.read")'

# All forced logouts across all users
find data/audit -name '*.json' -not -path '*/_active/*' \
  -exec grep -l '"endReason":"forced"' {} \;

# Total sessions per user
for u in data/audit/*/; do
  count=$(find "$u" -name '*.json' | wc -l)
  echo "$(basename $u): $count sessions"
done
```

### Configuration

```ts
interface AuditConfig {
  /** Shared ReactiveDB — for onChange/onQuery listeners */
  db: ReactiveDB;

  /** Root directory for audit files (default: 'data/audit') */
  auditDir?: string;

  /** Max recent completed sessions kept in memory (default: 100) */
  maxRecent?: number;

  /** Flush active sessions to _active/ every N ms (default: 60000 — 1 min) */
  flushIntervalMs?: number;

  /** Inactivity timeout — end session if no events for N ms (default: 1800000 — 30 min) */
  inactivityTimeoutMs?: number;

  /** Called when a user is detected as inactive — the auth plugin wires this to revoke tokens
   *  and publish `auth.session-expired`. Decouples audit from token service. */
  onInactive?: (userId: string) => void;
}
```

The `onInactive` callback decouples the audit system from the token service. The audit middleware detects inactivity; the auth plugin decides what to do about it. Wiring happens at the composition root:

```ts
// In app.ts — the auth plugin wires the callback
.use(createAuditMiddleware({
  db,
  onInactive: (userId) => {
    // Auth plugin handles token revocation + client notification
    getTokenService()?.revokeAllUserTokens(userId);
    server?.publish(`auth:${userId}`, JSON.stringify({
      type: 'auth.session-expired',
      reason: 'inactive',
    }));
  },
}))
```

| Env Var | Default | Description |
|---------|---------|-------------|
| `AUDIT_DIR` | `data/audit` | Root directory for audit file tree |
| `AUDIT_FLUSH_INTERVAL` | `60000` | Active session snapshot interval (ms) |
| `AUDIT_INACTIVITY_TIMEOUT` | `1800000` | End session after 30min of no activity |

### Disk Footprint

Each completed session is one JSON file. Size depends on activity:

| Session type | Events | File size | Per day (4 users) |
|-------------|--------|-----------|-------------------|
| Quick browse (5 min) | ~20 events | ~3 KB | ~12 KB |
| Normal workday (8 hrs) | ~500 events | ~60 KB | ~240 KB |
| Heavy use (8 hrs, lots of mutations) | ~2000 events | ~250 KB | ~1 MB |

A month of heavy use by 4 users: ~30 MB. A year: ~360 MB. Trivial — and neatly organized by user and date.

**Retention:** No built-in rotation — the files are small enough that years of data fit comfortably. To prune: `find data/audit -type d -name '2025-*' -exec rm -rf {} +` removes all of last year. Or archive: `tar czf audit-2025.tar.gz data/audit/*/2025-*/`.

## Composition

### Full Setup

```ts
import { Elysia } from 'elysia';
import { createReactiveDB } from './sync/reactive-db';
import { createSyncPlugin } from './sync';
import {
  createAuthPlugin,
  createAuthMiddleware,
  getTokenService,
  requireAuth,
  requireAdmin,
} from './auth';
import { createAuditMiddleware } from './auth/audit.middleware';

const db = createReactiveDB({ mode: 'memory' });

const app = new Elysia()
  // 1. Auth — users, credentials, login/register/refresh/logout
  .use(createAuthPlugin({ db }))

  // 2. Auth middleware — stateless JWT → authContext on every request
  .use(createAuthMiddleware(getTokenService))

  // 3. Audit — automatic activity tracking (sits on top of authContext)
  .use(createAuditMiddleware({ db }))

  // 4. Sync — reactive tables, WS broadcast
  .use(createSyncPlugin({
    db,
    tables: {
      todos:    { id: 'text primary key', title: 'text not null', done: 'integer default 0' },
      projects: { id: 'text primary key', name: 'text not null', owner_id: 'text' },
    },
  }))

  // ─── Public (no guard) ────────────────────────────
  // /auth/* routes are already public (handled by auth plugin)

  // ─── User routes ──────────────────────────────────
  .guard({ beforeHandle: [requireAuth] }, app => app
    .get('/api/todos', ({ syncDB }) => syncDB!.query('todos'))
    .post('/api/todos', ({ syncDB, body }) => syncDB!.insert('todos', body))
  )

  // ─── Admin routes ─────────────────────────────────
  .guard({ beforeHandle: [requireAdmin] }, app => app
    .get('/admin/users', ({ authStore }) => authStore!.listUsers())
  )

  .listen(3000);
```

### Plugin Order

```
  createAuthPlugin        → defines tables, provides /auth/* routes, login/logout call tracker
  createAuthMiddleware     → derives authContext (stateless JWT check)
  createAuditMiddleware    → derives activityTracker, hooks onBefore/onAfter, wires into ReactiveDB
  createSyncPlugin         → defines app tables, WS handler
  guard(requireAuth)       → beforeHandle on user routes
  guard(requireAdmin)      → beforeHandle on admin routes
```

Each layer reads from the one before it. Audit reads `authContext`. Guards read `authContext`. Sync reads `db`. Nothing is circular.

## File Organization (updated)

```
src/auth/
├── user-store.ts           # SQLite operations: users, _credentials, user_properties, _refresh_tokens
├── token-service.ts        # JWT signing/verification (jose), keypair mgmt, refresh rotation
├── auth.plugin.ts          # Elysia plugin — lifecycle, derive, routes
├── auth.middleware.ts       # Elysia middleware — stateless JWT verify, derives authContext
├── guards.ts               # requireAuth, requireAdmin — pure functions
├── activity-tracker.ts     # ActivityTracker class — in-memory audit sessions
├── audit.middleware.ts      # Elysia middleware — wires tracker into request lifecycle + ReactiveDB
├── types.ts                # AuthContext, UserRecord, TokenPair, AuditSession, AuditEvent, config
└── index.ts                # Public API: all exports
```

Eight files. `guards.ts` is ~20 lines. `audit.middleware.ts` is ~60 lines. `activity-tracker.ts` is ~150 lines. Everything else unchanged from the original auth design.

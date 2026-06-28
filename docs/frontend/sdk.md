# SDK

The developer-facing API for database, auth, real-time, and persistent state. Two layers: a **core client** (vanilla JS, no framework dependency) and **React hooks** (thin wrappers for components). Install one package, get typed CRUD, auth, live subscriptions, optimistic mutations, and per-user server-persisted state.

```ts
// Core client — works anywhere
const client = createClient({ url: 'http://localhost:3000', tables });

// Auth — top-level
await client.login('alice', 'password123');

// Auth admin — typed user-management helpers
const { users } = await client.listAuthAdminUsers();

// HTTP — authenticated JSON requests in one line
const { user } = await client.post('/api/users', { name: 'Alice' });
await client.patch('/api/users/1', { role: 'admin' });
await client.delete('/api/users/1');

// Collections — real-time sync with optimistic mutations
const todos = client.collection('todos');
todos.insert({ title: 'Buy milk', done: 0 });  // Auto-generates UUID PK

// React hooks — one hook for reads + writes
const { data, insert, update, remove } = useCollection<Todo>('todos');
```

---

## Client

### createClient

Factory for the SDK client. One client per app. Normally created internally by `AppProvider` -- you rarely call this directly.

```ts
import { createClient } from '@platform/frontend';

const client = createClient({
  url: 'http://localhost:3000',
  tables,          // Single tables object — auto-extracts what it needs
  auth: true,      // Omit or false for authless apps
  autoConnect: true,
});
```

**Config:**

```ts
interface ClientConfig {
  /** Server URL (HTTP or HTTPS). WebSocket URL derived automatically. */
  url: string;

  /** Table definitions. defineTable() output is accepted directly. */
  tables?: Record<string, ClientTableDef | { clientTable: ClientTableDef }>;

  /** Enable auth. Default: false, matching createApp(). */
  auth?: boolean;

  /** Enable per-user state sync. Requires auth: true. Default: false. */
  stateSync?: boolean;

  /** Connect WebSocket immediately on creation. Default: true */
  autoConnect?: boolean;

  /** Max reconnect attempts before giving up. Default: Infinity */
  maxReconnectAttempts?: number;

  /** Called on unrecoverable connection error. */
  onError?: (error: string) => void;

  /** Called after successful reconnect. */
  onReconnect?: () => void;
}
```

`auth` is opt-in on the raw SDK client. In a full-stack app, `AppProvider`
uses the server-injected platform config when `auth` or `stateSync` props are
omitted, so frontend defaults match `createApp()`.

**Returns:** `Client` instance.

**Singleton:** Only one client per process. Calling `createClient()` twice throws. Call `client.disconnect()` first to release.

### Client Interface

```ts
interface Client {
  /** Server URL this client is connected to */
  readonly url: string;

  // ─── Auth (top-level shortcuts) ──────────────────────────────
  readonly user: AuthUser | null;
  readonly isAuthenticated: boolean;
  readonly token: string | null;
  login(username: string, password: string): Promise<AuthUser>;
  register(params: RegisterParams): Promise<AuthUser>;
  getAuthConfig(): Promise<AuthPublicConfig>;
  forgotPassword(email: string): Promise<void>;
  inspectActionToken(token: string): Promise<AuthActionTokenInfo>;
  resetPassword(token: string, newPassword: string): Promise<AuthUser>;
  setupPassword(token: string, newPassword: string): Promise<AuthUser>;
  logout(): Promise<void>;
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
  refresh(): Promise<void>;
  setProperty(key: string, value: unknown): Promise<void>;
  getProperty(key: string): Promise<string | null>;
  getProperties(): Promise<Record<string, string>>;
  deleteProperty(key: string): Promise<void>;

  // ─── HTTP (JSON fetch; auth headers when auth is enabled) ─────
  /** Auto-prepends server URL, auto-JSON, auto-auth, throws FetchError on non-2xx */
  fetch<T = unknown>(path: string, init?: FetchInit): Promise<T>;
  get<T = unknown>(path: string): Promise<T>;
  post<T = unknown>(path: string, body?: unknown): Promise<T>;
  put<T = unknown>(path: string, body?: unknown): Promise<T>;
  patch<T = unknown>(path: string, body?: unknown): Promise<T>;
  delete<T = unknown>(path: string): Promise<T>;

  // ─── Data ────────────────────────────────────────────────────
  collection<T extends Row>(name: string): Collection<T>;
  readonly state: StateClient | null;
  readonly ephemeral: EphemeralClient;

  // ─── Connection ──────────────────────────────────────────────
  connect(): void;
  readonly connected: boolean;
  onConnectionChange(callback: (connected: boolean) => void): () => void;
  disconnect(): void;
}
```

### Auth Registration Config

`client.getAuthConfig()` reads `GET /auth/config` and is safe for public auth
UI decisions:

```ts
const config = await client.getAuthConfig();

if (config.registration.publicRegistrationEnabled) {
  // show register link/form
}
```

The built-in `LoginForm`, `RegisterForm`, and `ForgotPasswordForm` use the same
config by default. Policy-aware forms wait for config before exposing
registration or password-reset actions. After the first admin account exists,
`registration.mode: 'admin-only'` hides public registration UI while keeping
login available.

The auth component set is reusable and route-agnostic:

```tsx
import {
  ChangePasswordForm,
  ForgotPasswordForm,
  LoginForm,
  PasswordActionForm,
  RegisterForm,
  UserPropertiesForm,
} from '@platform/frontend';

<LoginForm forgotPasswordHref="/forgot-password" registerHref="/register" />
<RegisterForm loginHref="/login" fields={['email', 'username', 'password']} />
<ForgotPasswordForm loginHref="/login" />
<PasswordActionForm token={tokenFromUrl} mode="auto" loginHref="/login" />
<UserPropertiesForm />
<ChangePasswordForm />
```

`PasswordActionForm` inspects `/auth/action-token/:token` and calls the reset
or setup route based on token type. Invalid, expired, unsupported, or
mode-mismatched tokens keep submit disabled. `UserPropertiesForm` renders only
`editableBy: 'user'` property fields exposed by `/auth/config`.

### User Property Gates

Current-user properties are included in `user.properties`. The frontend barrel
exports lightweight UI gates:

```tsx
import { AdminGate, PropertyGate, HasFlag, SignedIn, SignedOut } from '@platform/frontend';

<PropertyGate propertyKey="department" allow={['accounting', 'management']}>
  <DepartmentTools />
</PropertyGate>

<HasFlag propertyKey="notificationsEnabled">
  <NotificationSettings />
</HasFlag>

<AdminGate>
  <AdminOnlyButton />
</AdminGate>

<SignedOut>
  <LoginForm />
</SignedOut>
```

These gates only control UI visibility. Protect sensitive data and actions
with backend route/query authorization as well.

### FetchError

Thrown by `client.fetch()` and its shortcuts (`get`, `post`, `patch`, `put`, `delete`) on non-2xx responses:

```ts
class FetchError extends Error {
  readonly status: number;   // HTTP status code (e.g. 403, 404, 500)
  readonly body: unknown;    // Parsed JSON response body
}
```

**Usage:**

```ts
try {
  const user = await client.updateAuthAdminUser(id, { role: 'admin' });
} catch (err) {
  if (err instanceof FetchError) {
    if (err.status === 403) toast.error('Not authorized');
    else toast.error(err.message);
  }
}
```

### FetchInit

```ts
interface FetchInit {
  method?: string;
  body?: unknown;                   // Auto-stringified, auto Content-Type
  headers?: Record<string, string>; // Merged with auth headers
  signal?: AbortSignal;             // Passed through to fetch()
  json?: boolean;                   // false = return raw Response (default: true)
}
```

**Connection lifecycle:**

1. `createClient({ autoConnect: true })` — opens WebSocket to `ws://{url}/sync`
2. Sends `sync.subscribe` with `tables`, `snapshot`, and `lastSeq: 0`
3. Server responds with `sync.snapshot` for tables requested in `snapshot`; lazy tables are omitted
4. Client stores the included snapshot tables in local @xstate/store
5. Live `sync.change` messages stream in as data changes
6. On disconnect: exponential backoff reconnect (1s, 2s, 4s... max 30s + jitter)
7. On reconnect: sends `sync.subscribe { tables, snapshot, lastSeq }` — server replays missed changes or sends fresh snapshot for requested snapshot tables

With `autoConnect: false`, the client creates stores but does not open a
WebSocket until `client.connect()` is called.

When auth is enabled, the WebSocket does not capture a one-time token at client
creation. It reads the current access token every time it opens or reconnects.
That keeps sync aligned with login, restore, refresh, and registration. If the
server rejects the socket for auth, the SDK attempts one refresh; if refresh is
rejected, auth state and local synced table/state data are cleared.

---

## Collections (Database)

A collection is a typed handle to a server table. It provides CRUD operations, queries, and real-time subscriptions.

### Getting a Collection

```ts
interface Todo {
  id: string;
  title: string;
  done: number;
}

const todos = client.collection<Todo>('todos');
```

The type parameter `<Todo>` flows through to all return types and mutation inputs. No codegen — pure TypeScript inference.

**Type safety note:** `client.collection<T>('todos')` — the generic `T` is a **client-side type assertion**. The server validates writes through the ReactiveDB table schema. Add client-side validation in your own form/action code when you want earlier UI feedback before an optimistic mutation is sent.

### Collection Interface

```ts
interface Collection<T extends Record<string, unknown>> {
  /** Table name */
  readonly name: string;

  // ─── Reads ───────────────────────────────────────────

  /** Get all rows. Returns a map keyed by primary key. */
  getAll(): Record<string, T>;

  /** Get a single row by primary key. Returns null if not found. */
  getOne(id: string): T | null;

  /** Get rows matching a filter function. */
  getMany(filter: (row: T) => boolean): T[];

  /** Get the count of all rows. */
  count(): number;

  // ─── Mutations (optimistic + server sync) ────────────

  /** Insert a new row. Applies optimistically, then sends to server. */
  insert(row: T): void;

  /** Return the deterministic sync id for a natural identity key. */
  identityKey(key: Record<string, unknown>): string;

  /** Get a single local row by natural identity. */
  getByIdentity(key: Record<string, unknown>): T | null;

  /** Insert or update by natural identity. */
  upsertByIdentity(row: T): void;

  /** Update by natural identity. */
  updateByIdentity(key: Record<string, unknown>, partial: Partial<T>): void;

  /** Delete by natural identity. */
  deleteByIdentity(key: Record<string, unknown>): void;

  /** Update a row by primary key. Partial merge. */
  update(id: string, partial: Partial<T>): void;

  /** Delete a row by primary key. */
  remove(id: string): void;

  // ─── Subscriptions ──────────────────────────────────

  /** Subscribe to all rows in this collection. */
  subscribe(callback: (rows: Record<string, T>) => void): () => void;

  /** Subscribe to a specific row by ID. */
  subscribeOne(id: string, callback: (row: T | null) => void): () => void;

  // ─── Lazy Loading ────────────────────────────────────

  /** Bulk-load rows into the local store (for lazy tables). Merges by default. */
  load(rows: T[], options?: { replace?: boolean }): void;

  /** Clear all rows from this table in the local store. No server delete. */
  clear(): void;
}
```

### Natural Identity Collections

ReactiveDB-managed sync tables use one string primary key. For join tables or
relationship tables that would normally have a composite primary key, declare a
natural identity in the table schema:

```ts
export const membershipTable = defineTable('memberships', {
  team_id: field.text({ required: true }),
  user_id: field.text({ required: true }),
  role: field.text(),
}, {
  pk: 'membership_id',
  identity: ['team_id', 'user_id'],
});
```

The collection can then derive and use the deterministic sync id from the
identity fields:

```ts
const memberships = client.collection('memberships');
const key = { team_id: 'team-1', user_id: 'user-1' };

memberships.insert({ ...key, role: 'admin' });
memberships.getByIdentity(key);
memberships.upsertByIdentity({ ...key, role: 'member' });
memberships.updateByIdentity(key, { role: 'admin' });
memberships.deleteByIdentity(key);
```

Identity fields must exist in the schema, cannot be the sync primary key, and
cannot be changed after insert. Identity values must be strings, finite
numbers, or booleans.

### Reads

```ts
const todos = client.collection<Todo>('todos');

// All rows — Record<string, Todo>
const all = todos.getAll();
// { 'abc': { id: 'abc', title: 'Buy milk', done: 0 }, 'def': { ... } }

// Single row — Todo | null
const one = todos.getOne('abc');
// { id: 'abc', title: 'Buy milk', done: 0 }

// Filtered — Todo[]
const incomplete = todos.getMany(row => row.done === 0);
// [{ id: 'abc', title: 'Buy milk', done: 0 }]

// Count — number
const total = todos.count();
// 2
```

**Reads are local.** They read from the in-memory store, not the server. The store is kept in sync via the WebSocket connection. Reads are synchronous and O(1) for `getOne`, O(n) for `getAll`/`getMany`.

### Mutations

```ts
const todos = client.collection<Todo>('todos');

// Insert — auto-generates UUID PK, no id needed
todos.insert({ title: 'Walk the dog', done: 0 });

// Update (partial merge)
todos.update('abc', { done: 1 });

// Delete
todos.remove('abc');
```

**Mutations are optimistic.** Every mutation follows this flow:

```
1. Client calls todos.insert(row)
   │
   ├─► Local store updates immediately (UI re-renders)
   ├─► WebSocket sends sync.mutate { ref, table, op, row }
   │
   ├─► Server validates and writes to ReactiveDB
   │   ├─► Success: sync.ack { ref, ok: true }
   │   │   └─► Client removes from pending queue. Done.
   │   └─► Failure: sync.ack { ref, ok: false, error: '...' }
   │       └─► Client rolls back to pre-mutation state. UI re-renders.
   │
   └─► Server broadcasts sync.change to all other clients
       └─► Their stores update, their UIs re-render
```

**Rollback on failure:** The client captures the previous state before applying the optimistic change. If the server rejects the mutation (validation error, constraint violation), the client restores the previous state. The UI briefly shows the optimistic state, then snaps back.

**Pending queue:** Each in-flight mutation is tracked with a `ref` (UUID). Mutations to the same row are serialized — the client waits for the first ack before sending the second. This prevents broken rollback chains.

**Timeout:** Mutations not acked within 10 seconds are treated as failures and rolled back.

### Subscriptions

```ts
const todos = client.collection<Todo>('todos');

// Subscribe to all changes
const unsub = todos.subscribe((rows) => {
  console.log(Object.values(rows));
});

// Subscribe to a single row
const unsub2 = todos.subscribeOne('abc', (row) => {
  console.log('Row changed:', row);
  // row: Todo | null (null if deleted)
});

// Cleanup
unsub();
unsub2();
```

Subscriptions are local — they watch the in-memory store, not the server directly. When a `sync.change` arrives over WebSocket, the store updates, and all matching subscriptions fire.

### Lazy Sync

By default, omitted table sync mode is `auto`: startup counts rows and keeps
small tables in full sync, then auto-resolves oversized tables to lazy sync.
Explicit `sync: 'full'` and `sync: 'lazy'` always win. Auto decisions are saved
in the app database so a table does not flip back and forth between modes.

**Declare a lazy table:**

```ts
import { defineTable, field } from '@platform/frontend';

export const attendanceTable = defineTable('attendance', {
  group_id: field.text({ required: true }),
  date: field.date({ required: true }),
  present: field.boolean(),
}, { sync: 'lazy' });
```

**Load data with `useLazyCollection`:**

The platform auto-registers `GET /api/data` for resolved lazy tables. Use the `useLazyCollection` hook:

```tsx
import { useLazyCollection } from '@platform/frontend';

function GroupAttendance({ groupId }: { groupId: string }) {
  const { data, isLoading, error, refresh } = useLazyCollection(
    'attendance',
    { group_id: groupId },
    { order: 'date', dir: 'desc', limit: 50 }
  );

  if (isLoading) return <p>Loading...</p>;
  return <ul>{data.map(a => <li key={a.id}>{a.date}</li>)}</ul>;
}
```

Filter format is `Record<string, string>` (object), not tuple arrays.

For manual lazy reads, `GET /api/data` accepts:

```text
table=attendance
filter=group_id:abc
filter=date:gte:2026-01-01
order=date
dir=desc
limit=50
offset=0
```

Filters are repeatable and ANDed together. `field:value` is equality; explicit
operators are `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `like`, `contains`, and
`in`. The response is `{ rows, page }`, where `page` includes `limit`, `offset`,
`count`, `hasMore`, and `nextOffset`.

The endpoint validates table/column names, parameterizes values, caps result
size, and enforces the same sync read policy used by WebSocket subscriptions.
Add SQLite indexes in migrations for columns used heavily in `filter` or
`order`.

**Manual load (advanced):**

```ts
const col = client.collection('attendance');
col.load(records);                      // Merge/upsert with existing rows
col.load(records, { replace: true });   // Replace ALL rows with these
col.clear();                            // Empty the local store (no server delete)
```

**Live changes still work:** Lazy tables subscribe to WebSocket change events. Once you `load()` a set of rows, they stay live — real-time updates from other users are reflected. You just don't get the initial dump of every row.

---

## Auth

### AuthClient Interface

```ts
interface AuthClient {
  /** Current authenticated user, or null */
  readonly user: UserRecord | null;

  /** Whether a user is currently authenticated */
  readonly isAuthenticated: boolean;

  /** Whether the current user has admin role */
  readonly isAdmin: boolean;

  /** Current access token (in memory, never persisted to disk) */
  readonly accessToken: string | null;

  // ─── Actions ─────────────────────────────────────────

  /** Register a new user. Automatically logs in on success. */
  register(params: RegisterParams): Promise<AuthResult>;

  /** Log in with username and password. */
  login(username: string, password: string): Promise<AuthResult>;

  /** Log out. Revokes refresh token server-side, clears local state. */
  logout(): Promise<void>;

  /** Refresh the access token using the stored refresh token. */
  refresh(): Promise<boolean>;

  /** Change password. Requires current password. Revokes all sessions. */
  changePassword(currentPassword: string, newPassword: string): Promise<void>;

  // ─── Events ──────────────────────────────────────────

  /** Listen for auth state changes */
  subscribe(callback: () => void): () => void;
}
```

### Register

```ts
const result = await client.register({
  username: 'alice',
  email: 'alice@example.com',
  password: 's3cret!',
  firstName: 'Alice',         // optional
  lastName: 'Johnson',        // optional
});

// result.user = { userId: 'u_...', username: 'alice', email: 'alice@example.com', role: 'user', ... }
// result.accessToken = 'eyJhbG...'
// result.refreshToken = 'a1b2c3d4-...'
```

**RegisterParams:**

```ts
interface RegisterParams {
  username: string;
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
}
```

**What happens:**

1. `POST /auth/register` with credentials
2. Server hashes password (Argon2id via `Bun.password.hash()`), creates user in `users` table, stores hash in `_credentials`
3. Server generates access token (ES256 JWT, 15min TTL) and refresh token (opaque UUID, SHA-256 hashed in `_refresh_tokens`, 7d TTL)
4. Returns tokens + user record
5. SDK stores access token in memory, refresh token in `localStorage`
6. SDK connects/reconnects WebSocket with the new token — server gates table subscriptions based on auth
7. Because `users` is a reactive table, every connected client sees the new user appear

**Errors:**

| Error | Code | When |
|-------|------|------|
| `Username taken` | `DUPLICATE_USERNAME` | Username already exists |
| `Email taken` | `DUPLICATE_EMAIL` | Email already registered |
| `Validation failed` | `VALIDATION_ERROR` | Missing/invalid fields |

### Login

```ts
const result = await client.login('alice', 's3cret!');

// result.user = { userId: 'u_...', username: 'alice', ... }
// result.accessToken = 'eyJhbG...'
// result.refreshToken = 'a1b2c3d4-...'
```

**What happens:**

1. `POST /auth/login` with username + password
2. Server looks up user by username, verifies password via `Bun.password.verify()`
3. On success: generates new token pair, returns with user record
4. SDK stores tokens, reconnects WebSocket with auth
5. `client.user` is now set, `client.isAuthenticated` is `true`
6. Any `onChange` listeners fire with the user

**Errors:**

| Error | Code | When |
|-------|------|------|
| `Invalid credentials` | `INVALID_CREDENTIALS` | Wrong username or password |
| `User not found` | `USER_NOT_FOUND` | Username doesn't exist |

### Logout

```ts
await client.logout();
```

**What happens:**

1. `POST /auth/logout` with the refresh token
2. Server revokes the refresh token in `_refresh_tokens` (sets `revoked_at`)
3. SDK clears access token from memory, refresh token from `localStorage`
4. SDK disconnects WebSocket (no more authenticated subscriptions)
5. `client.user` is `null`, `client.isAuthenticated` is `false`
6. Any `onChange` listeners fire with `null`

Logout is idempotent — calling it when already logged out is a no-op.

### Refresh

```ts
await client.refresh();
```

**What happens:**

1. Reads refresh token from `localStorage`
2. `POST /auth/refresh` with the refresh token
3. Server verifies: hash matches, not expired, not revoked
4. Server **rotates** — revokes old refresh token, issues new access + refresh pair
5. SDK stores the new access token in memory and the new refresh token in `localStorage`
6. Resolves when refresh completes

**Automatic refresh:** The SDK intercepts 401 responses from authenticated
HTTP calls and automatically refreshes before retrying once. The component
never sees a recoverable expired-access-token 401.

**Rotation:** Every refresh call produces a new refresh token and revokes the old one. If an old refresh token is reused (replay attack), the server detects the revocation and revokes the entire token family — forcing re-login on all devices.

**Errors:**

| Error | Code | When |
|-------|------|------|
| `Token expired` | `TOKEN_EXPIRED` | Refresh token past its TTL |
| `Token revoked` | `TOKEN_REVOKED` | Refresh token was already used or explicitly revoked |
| `No refresh token` | `NO_TOKEN` | No refresh token stored locally |

### Session Persistence And Expiry

The access token is short-lived and memory-only. The refresh token is persisted
in `localStorage`, rotated on every refresh, and used to restore the browser
session after reload.

The SDK keeps the user logged in across normal access-token expiry:

1. Startup with a stored refresh token calls `/auth/refresh`, then `/auth/me`.
2. Authenticated HTTP calls that receive 401 refresh and retry once.
3. Sync opens and reconnects with the latest access token instead of a stale token captured at startup.
4. Login, registration, and refresh reconnect sync when the auth token changes.
5. Logout, rejected refresh, revoked refresh token, or unknown 401 clears auth state and resets local synced table/state data.

When auth is enabled, `AppProvider` watches auth state on the client. If the
user becomes unauthenticated on a non-public route, it redirects to `loginPath`
and appends `?redirect=<current-url>`. Server rendering uses the same
`publicPaths` and `loginPath` config for protected route responses.

Configure those paths in `createApp()`:

```ts
createApp({
  auth: true,
  publicPaths: ['/login', '/register', '/forgot-password'],
  loginPath: '/login',
});
```

Or override them in the root provider:

```tsx
<AppProvider
  url={origin}
  tables={tables}
  auth
  publicPaths={['/login', '/forgot-password']}
  loginPath="/login"
>
  {children}
</AppProvider>
```

### User Record

```ts
interface UserRecord {
  userId: string;
  username: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;                  // 'user' | 'admin'
  status: 'active' | 'suspended';
  passwordChangeRequired: boolean;
  createdAt: number;             // Unix timestamp ms
  updatedAt: number | null;
  properties: Record<string, string>;  // Extensible KV metadata
}

interface AuthResult {
  user: UserRecord;
  accessToken: string;
  refreshToken: string;
}
```

### Token Storage

| Token | Storage | Why |
|-------|---------|-----|
| Access token | In-memory only (JS variable) | Short-lived (15min), stateless verification. Never touches disk — XSS can read `localStorage` but can't read a JS closure. |
| Refresh token | `localStorage` | Long-lived (7d), survives page refresh. Server stores only the SHA-256 hash — compromised token can be revoked. |

**Why not httpOnly cookies:** The sync engine WebSocket needs the token for connection auth. Browsers can't set cookies on WebSocket upgrade requests. The token goes as a query parameter on WS connect.

---

## Real-time

Real-time is not a separate feature — it's built into every collection read. When you call `todos.getAll()`, you're reading from a local store that's kept in sync via WebSocket. When another client writes, your store updates, your subscriptions fire.

### How It Works

```
Server (ReactiveDB)                           Client (SyncStore)
┌─────────────────┐                          ┌─────────────────┐
│ todos table     │                          │ todos store     │
│ ┌─────────────┐ │   sync.change            │ ┌─────────────┐ │
│ │ id:abc      │ │ ──────────────────────►  │ │ id:abc      │ │
│ │ title:Milk  │ │   (WebSocket)            │ │ title:Milk  │ │
│ │ done:0      │ │                          │ │ done:0      │ │
│ └─────────────┘ │                          │ └─────────────┘ │
│                 │   sync.mutate            │                 │
│                 │ ◄──────────────────────  │  optimistic     │
│                 │   (WebSocket)            │  apply first    │
└─────────────────┘                          └─────────────────┘
```

1. **Initial sync:** Client connects → sends `sync.subscribe { tables, snapshot, lastSeq }` → server sends `sync.snapshot` for the requested snapshot tables plus current seq number
2. **Live changes:** Server writes → `onChange` fires → `server.publish('sync:{table}', change)` → all clients receive `sync.change` → local stores update
3. **Client mutations:** Client calls `insert()`/`update()`/`remove()` → optimistic local apply → `sync.mutate` sent over WS → server validates, writes, acks → broadcast to all other clients
4. **Reconnect:** Client tracks `lastSeq`. On reconnect, sends `sync.subscribe { tables, snapshot, lastSeq }`. Server either replays missed changes (`sync.catchup`) or sends fresh snapshot for the requested snapshot tables if the gap is too large.

### Connection Status

```ts
// Current status
client.status;  // 'connected' | 'disconnected' | 'reconnecting'

// Listen for changes
const unsub = client.on('connected', () => console.log('Online'));
const unsub2 = client.on('disconnected', () => console.log('Offline'));
const unsub3 = client.on('reconnecting', (attempt) => console.log(`Attempt ${attempt}`));
```

### Reconnect Behavior

| Scenario | Server response | Client behavior |
|----------|----------------|----------------|
| Brief disconnect (gap within ring buffer) | `sync.catchup` — array of missed changes | Apply changes in order, resume |
| Long disconnect (gap exceeds buffer) | `sync.snapshot` — requested snapshot tables | Replace included table state, clear pending entries for those tables |
| Server restart | `sync.snapshot` (seq resets to 0) | Resync requested snapshot tables, clear matching pending entries |
| Max attempts exceeded | — | `client.status = 'disconnected'`, stops retrying |

Exponential backoff: 1s → 2s → 4s → 8s → ... → 30s max, with 0-20% random jitter to prevent thundering herd.

### Optimistic Update Lifecycle

```ts
// 1. Developer calls:
todos.insert({ id: 'new-1', title: 'Walk dog', done: 0 });

// 2. Immediately (synchronous):
//    - Store applies the row locally
//    - Any useCollection/subscribe callbacks fire
//    - UI shows the new row

// 3. Asynchronously:
//    - WS sends: { type: 'sync.mutate', ref: 'uuid', table: 'todos', op: 'INSERT', row: {...} }

// 4a. Server accepts:
//    - WS receives: { type: 'sync.ack', ref: 'uuid', ok: true, seq: 43 }
//    - Client removes mutation from pending queue
//    - No UI change (optimistic state was correct)

// 4b. Server rejects:
//    - WS receives: { type: 'sync.ack', ref: 'uuid', ok: false, error: 'title required' }
//    - Client restores previous state from pending queue
//    - UI snaps back (row disappears)
```

### Pending Queue

```ts
interface PendingMutation {
  ref: string;                      // Correlation UUID
  table: string;
  op: 'INSERT' | 'UPDATE' | 'DELETE';
  rowId: string;
  previousState: Row | null;        // For rollback
  optimisticState: Row | null;      // What we applied
  sentAt: number;                   // For timeout detection
}
```

**Rules:**
- Same-row mutations serialized — second mutation waits for first ack
- Timeout at 10s — treated as rejection, rolls back
- `sync.snapshot` clears pending entries and same-row queue tracking only for tables included in the snapshot. Lazy tables omitted from snapshots keep their pending mutations.
- Pending count available via `client.pending` (number)

---

## State (Per-User Persistent KV)

Server-persisted key-value state per user. No schema, no tables. Survives refresh, device switch, server restart. Full spec: [State Sync](../state-sync.md).

### client.state

```ts
// Set — optimistic, persisted, synced across devices
client.state.set('theme', 'dark');
client.state.set('sidebar.open', true);
client.state.set('intake-form.step2', {
  insurance: 'Blue Cross',
  memberId: 'BC-12345',
  groupNumber: '',
});

// Get — local read, no server round-trip
client.state.get('theme');                    // 'dark'
client.state.get('language', 'en');           // 'en' (default)

// Delete
client.state.delete('draft.newPost');

// Prefix scan
client.state.getByPrefix('draft.');           // all keys starting with 'draft.'

// All state
client.state.getAll();                        // flat Record<string, JsonValue>

// Clear everything
client.state.clear();

// Subscribe to a key
const unsub = client.state.subscribe('theme', (value) => {
  console.log('Theme changed:', value);
});

// Subscribe to all changes
const unsub2 = client.state.subscribe((event) => {
  // event.type: 'set' | 'delete' | 'clear'
  // event.key, event.value, event.source ('local' | 'remote')
});
```

**Interface:**

```ts
interface StateClient {
  set(key: string, value: JsonValue): void;
  get(key: string): JsonValue | undefined;
  get<T extends JsonValue>(key: string, defaultValue: T): T;
  delete(key: string): void;
  getAll(): Record<string, JsonValue>;
  getByPrefix(prefix: string): Record<string, JsonValue>;
  clear(): void;
  subscribe(key: string, callback: (value: JsonValue | undefined) => void): () => void;
  subscribe(callback: (event: StateChangeEvent) => void): () => void;
  readonly size: number;
  readonly ready: boolean;
}
```

**How it works:** RAM-backed Map on the server with SQLite write-through for durability. On connect, client receives a `state.snapshot` with all keys. Mutations are optimistic (local first, server ack/rollback). Multi-device sync via Bun pub/sub topic `state:{userId}` — same WebSocket as the sync engine. See [State Sync](../state-sync.md) for wire protocol, server implementation, and limits.

---

## React Hooks

Thin wrappers around the core client that integrate with React's rendering cycle via `useSyncExternalStore`. Every hook is live — when data changes on the server, the hook triggers a re-render.

### Provider

The root layout is the sole owner of `AppProvider`. `hydrate.tsx` provides only `RouterProvider` + `ErrorBoundary`.

```tsx
import { AppProvider } from '@platform/frontend';
import { tables } from '@app/lib/schemas';

// app/layout.tsx — root layout
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        <AppProvider
          url={typeof window !== 'undefined' ? window.location.origin : ''}
          tables={tables}
          auth
        >
          {children}
        </AppProvider>
      </body>
    </html>
  );
}
```

`AppProvider` creates the client internally, auto-extracts what it needs from
the `tables` object, connects the WebSocket, and provides all contexts (sync,
auth, router). `__PLATFORM_CONFIG__` no longer carries `tables`; it carries
runtime server settings such as `auth`, `stateSync`, and resolved
`tableSyncModes` so omitted provider props and auto-lazy decisions match the
backend.

### Hook organization

Zero exposes hooks from `@platform/frontend`, but the implementation is split
by responsibility:

- `client-context.tsx` owns `ClientProvider`, `useClient`, `useClientMaybe`, and SSR fallback checks.
- `auth-hooks.ts` owns `useAuth`, `useAuthConfig`, `useCurrentUser`, `useRequireAuth`, and `useUserProperty`.
- `data-hooks.ts` owns `useCollection`, `useLazyCollection`, `useRow`, `useQuery`, and `useStatus`.
- `data-composition-hooks.ts` owns `useDataPage`, `useRecord`, and `useRecordByIdentity`.
- `data-selection-hooks.ts` owns reusable selected-row state for tables and detail views.
- `mutation-hooks.ts` and `connection-health-hooks.ts` own mutation lifecycle and sync/auth health state.
- `presence-list-hooks.ts` and `typing-indicator-hooks.ts` own display-ready room presence and ephemeral typing state.
- `preference-hooks.ts` owns `usePreference` and `useFormDraft` over server state sync.
- `workflow-run-hooks.ts` owns the composed `useWorkflowRun` helper.
- `src/storage/upload-queue-hooks.ts`, `src/storage/upload-dropzone-hooks.ts`, `src/storage/storage-file-hooks.ts`, and `src/storage/storage-browser-hooks.ts` own storage queue, dropzone, file, and browser composition.
- `src/hooks/*` owns generic React primitives such as `useDisclosure`, `useAsyncAction`, `useDebouncedValue`, `useDebouncedCallback`, `useThrottledValue`, `useClickAway`, `useCopyToClipboard`, `useIdle`, `useOs`, `useTextSelection`, `useMediaQuery`, and `useHotkey`.
- `use-stick-to-bottom` is re-exported directly as `StickToBottom`, `useStickToBottom`, and `useStickToBottomContext` for smooth AI/chat/log panels.

App code should still import from `@platform/frontend`. Use the lower-level
files only when working inside the platform source. See [Frontend Hooks](./hooks.md).

### useUserProperty

Read and update one current-user KV property through the auth client:

```tsx
const theme = useUserProperty('theme', {
  defaultValue: 'system',
});

void theme.setValue('dark');
```

The server remains authoritative. If a configured property is admin-only,
system-only, or non-editable, user writes are rejected by auth routes. Use this
hook for UI preferences and visibility convenience, not backend authorization.

### useCollection

Subscribe to a full-sync table. Returns array/map reads plus optimistic mutation functions. Re-renders when the local collection changes.

```tsx
function TodoList() {
  const { data, insert, update, remove } = useCollection<Todo>('todos');

  return (
    <ul>
      {data.map(todo => (
        <li key={todo.id}>
          <input
            type="checkbox"
            checked={!!todo.done}
            onChange={() => update(todo.id, { done: todo.done ? 0 : 1 })}
          />
          {todo.title}
          <button onClick={() => remove(todo.id)}>Delete</button>
        </li>
      ))}
      <button onClick={() => insert({ title: 'New todo', done: 0 })}>
        Add
      </button>
    </ul>
  );
}
```

**Signature:**

```ts
function useCollection<T extends Record<string, unknown>>(name: string): CollectionResult<T>;

interface CollectionResult<T> {
  /** All rows as an array. Live, updates on every change. */
  data: T[];
  /** All rows keyed by primary key. */
  byId: Record<string, T>;
  /** Current local row count. */
  count: number;

  /** Optimistic insert. Auto-generates the primary key when omitted. */
  insert(row: T): void;

  /** Optimistic partial update by primary key. Merges into existing row. */
  update(id: string, partial: Partial<T>): void;

  /** Optimistic delete by primary key. */
  remove(id: string): void;

  /** Load rows into the local store. Used by lazy tables. */
  load(rows: T[], options?: { replace?: boolean }): void;
  /** Clear local rows without deleting server rows. */
  clear(): void;
}
```

Full-sync tables receive an initial WebSocket snapshot. For large tables, let
Zero auto-lazy the table or mark it lazy and use `useLazyCollection`.

### useLazyCollection

Fetch a lazy table through `GET /api/data`, load the result into the local
collection, then keep loaded rows live through WebSocket changes.

```tsx
function AttendanceList({ groupId }: { groupId: string }) {
  const { data, isLoading, error, refresh } = useLazyCollection<Attendance>(
    'attendance',
    { group_id: groupId },
    { order: 'date', dir: 'desc', limit: 50 },
  );

  if (isLoading) return <p>Loading...</p>;
  if (error) return <p>{error.message}</p>;

  return (
    <ul>
      {data.map(row => <li key={row.id}>{row.date}</li>)}
      <button onClick={refresh}>Refresh</button>
    </ul>
  );
}
```

**Signature:**

```ts
function useLazyCollection<T extends Record<string, unknown>>(
  table: string,
  filters?: Record<string, string>,
  options?: {
    order?: string;
    dir?: 'asc' | 'desc';
    limit?: number;
    offset?: number;
  },
): CollectionResult<T> & {
  isLoading: boolean;
  error: Error | null;
  refresh(): void;
};
```

Filters are sent to `/api/data` as equality filters. The backend validates table
and column names against the schema, enforces sync read policy, caps result
size, and applies configured sorting/pagination.

### useRow

Subscribe to a single row by primary key. Only re-renders when that specific row changes.

```tsx
function TodoItem({ id }: { id: string }) {
  const row = useRow<Todo>('todos', id);
  const { update, remove } = useCollection<Todo>('todos');

  if (!row) return null;  // Row was deleted

  return (
    <div>
      <input
        type="checkbox"
        checked={!!row.done}
        onChange={() => update({ done: row.done ? 0 : 1 })}
      />
      <span>{row.title}</span>
      <button onClick={() => remove()}>Delete</button>
    </div>
  );
}
```

**Signature:**

```ts
function useRow<T extends Record<string, unknown>>(name: string, id: string): T | null;
```

**Re-render behavior:** Only re-renders when this specific row changes. Other rows in the same table changing does not trigger a re-render. Uses referential equality on `store.context[table][id]`.

### useQuery

Filtered view of a table. Returns matching rows. Memoized — only re-renders when the filtered result actually changes.

```tsx
function IncompleteTodos() {
  const incomplete = useQuery<Todo>('todos', row => row.done === 0);

  return (
    <div>
      <h2>{incomplete.length} remaining</h2>
      {incomplete.map(todo => (
        <TodoItem key={todo.id} id={todo.id} />
      ))}
    </div>
  );
}
```

**Signature:**

```ts
function useQuery<T extends Record<string, unknown>>(
  name: string,
  filter: (row: T) => boolean,
): T[];
```

**Re-render behavior:** The filter runs on every store change, but the hook only re-renders if the filtered result changes (shallow array comparison — same items in same order = same reference).

**Important:** The filter function should be stable — wrap in `useCallback` or define outside the component. A new function reference on every render defeats the memoization.

### useStatus

Connection state for the shared SDK WebSocket.

```tsx
function ConnectionIndicator() {
  const { connected } = useStatus();
  return <div className={connected ? 'online' : 'offline'} />;
}
```

```ts
function useStatus(): { connected: boolean };
```

### useServerState

Like `useState`, but persisted on the server and synced across devices.

```tsx
function ThemeToggle() {
  const [theme, setTheme] = useServerState('theme', 'light');

  return (
    <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
      Current: {theme}
    </button>
  );
}
```

```tsx
function IntakeForm() {
  const [formData, setFormData] = useServerState('intake.demographics', {
    name: '', dob: '', address: '', phone: '',
  });

  const updateField = (field: string, value: string) => {
    setFormData({ ...formData, [field]: value });
  };

  return (
    <form>
      <input value={formData.name} onChange={e => updateField('name', e.target.value)} />
      <input value={formData.dob} onChange={e => updateField('dob', e.target.value)} />
    </form>
  );
  // User fills out name. Phone dies. Opens laptop. Name is there.
}
```

**Signature:**

```ts
function useServerState<T extends JsonValue>(
  key: string,
  defaultValue: T,
): [T, (value: T) => void];
```

**Behavior:**
- Same API as `useState` — `[value, setter]`
- `value` reads from the server-synced KV store. Returns `defaultValue` if key doesn't exist.
- `setter` calls `client.state.set(key, value)` — optimistic, persisted, synced across devices
- Re-renders when value changes (local set OR remote push from another device/tab)
- Uses `useSyncExternalStore` — tear-free reads

Full state sync spec: [State Sync](../state-sync.md).

### useAuth

Full auth state and actions. Reads from AuthContext, mutations call the auth API.

```tsx
function LoginPage() {
  const { login, isAuthenticated, user } = useAuth();
  const [error, setError] = useState<string | null>(null);

  if (isAuthenticated) {
    redirect('/dashboard');
    return null;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.target as HTMLFormElement);
    try {
      await login(form.get('username') as string, form.get('password') as string);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <input name="username" required />
      <input name="password" type="password" required />
      {error && <p className="error">{error}</p>}
      <button type="submit">Login</button>
    </form>
  );
}
```

**Signature:**

```ts
function useAuth(): AuthHookResult;

interface AuthHookResult {
  /** Current user record, or null if not authenticated. Reactive — re-renders on change. */
  user: UserRecord | null;

  /** Whether a user is currently authenticated. */
  isAuthenticated: boolean;

  /** Whether the current user has 'admin' role. */
  isAdmin: boolean;

  /** Register a new user. Automatically logs in on success. Throws on validation/duplicate errors. */
  register(params: RegisterParams): Promise<void>;

  /** Log in with username and password. Throws on invalid credentials. */
  login(username: string, password: string): Promise<void>;

  /** Request a password reset email. Does not reveal account existence. */
  forgotPassword(email: string): Promise<void>;

  /** Inspect a setup/reset token without consuming it. */
  inspectActionToken(token: string): Promise<AuthActionTokenInfo | null>;

  /** Complete password reset/setup from an emailed token. */
  resetPassword(token: string, newPassword: string): Promise<void>;
  setupPassword(token: string, newPassword: string): Promise<void>;

  /** Log out. Revokes server-side refresh token, clears local state. */
  logout(): Promise<void>;

  /** Manually refresh the access token. Usually automatic — call this only if needed. */
  refresh(): Promise<void>;
}
```

**Reactive user:** `user` is backed by `useRow('users', userId)` — it reads from the sync engine's reactive `users` table. If an admin changes this user's role, the component re-renders with the new role. No polling, no refetch.

**Session expiry:** When the refresh token can no longer restore the session,
the hook reflects the cleared auth state. `user` becomes `null`,
`isAuthenticated` becomes `false`, and `AppProvider` redirects protected
client routes to the configured login path. You can still add local guards when
you want a component-specific fallback:

```tsx
// app/dashboard/layout.tsx
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) { redirect('/login'); return null; }
  return <main>{children}</main>;
}
```

### useCurrentUser

Convenience hook — just the reactive user record.

```tsx
function UserBadge() {
  const user = useCurrentUser();
  if (!user) return null;

  return (
    <div>
      <span>{user.firstName} {user.lastName}</span>
      <span className="badge">{user.role}</span>
    </div>
  );
}
```

**Signature:**

```ts
function useCurrentUser(): UserRecord | null;
```

Equivalent to `useAuth().user`, but slightly cheaper — only subscribes to the user row, not the full auth state.

### SSR Hook Behavior

Hooks behave differently during server-side rendering (`renderToReadableStream`) vs. after client hydration.

**During SSR (server):**
- Public frontend hooks are SSR-safe and return empty/default values while there
  is no browser SDK client.
- Server rendering should load data directly from ReactiveDB or route loaders
  when the first HTML needs data.
- In the browser, hooks throw a clear provider error if used outside
  `<AppProvider>` or `<ClientProvider>`.

**After hydration (client):**
- `AppProvider` creates the SDK client, connects the WebSocket, and provides
  auth/sync/router context.
- `useCollection` reads the full-sync snapshot and then stays live through
  change events.
- `useLazyCollection` fetches its first page through `/api/data`, loads those
  rows locally, and then keeps loaded rows live through change events.
- `useServerState` reads from the @xstate/store populated by `state.snapshot`.

**Pattern for synced tables:**

```
Server SSR:
  1. Server does db.query('todos') during render
  2. Passes rows as initial data in the HTML

Client hydration:
  3. hydrateRoot() attaches React to server HTML
  4. Sync engine connects, receives sync.snapshot
  5. useCollection('todos') takes over with live updates
  6. If data unchanged since SSR → no re-render, no flash
```

```tsx
// app/todos/page.tsx
// Server renders with initial DB query. Client hydrates. useCollection takes over.
export default function Todos() {
  const { data } = useCollection<Todo>('todos');
  return <ul>{data.map(t => <li key={t.id}>{t.title}</li>)}</ul>;
}
```

### useParams

Route parameters from the matched file-based route. See [Router](./router.md).

```tsx
// app/blog/[slug]/page.tsx
export default function BlogPost() {
  const { slug } = useParams<{ slug: string }>();
  return <article>Post: {slug}</article>;
}
```

```ts
function useParams<T extends Record<string, string | string[]>>(): T;
```

### usePathname

Current URL pathname. Re-renders on client-side navigation.

```ts
function usePathname(): string;
```

### useRouter

Programmatic navigation. See [Router: Client-Side Navigation](./router.md#client-side-navigation) for the full navigation model.

```ts
function useRouter(): Router;

interface Router {
  /** Navigate to a path, add to history stack. */
  push(path: string): void;

  /** Navigate to a path, replace current history entry. */
  replace(path: string): void;

  /** Go back in history. Equivalent to history.back(). */
  back(): void;

  /** True while loading a route module + running its loader. */
  isNavigating: boolean;

  /** Manually trigger preload for a path (fetch JS chunk + call loader). */
  prefetch(path: string): void;
}
```

### Link

Client-side navigation component. Intercepts clicks, navigates without full page reload, preserves shared layouts. Preloads route modules on hover by default.

```tsx
import { Link } from '@platform/frontend';

<Link href="/dashboard/settings">Settings</Link>
<Link href="/blog/hello-world" prefetch="render">Read more</Link>
<Link href="/login" replace>Login</Link>
```

**Props:**

```ts
interface LinkProps {
  href: string;
  prefetch?: 'intent' | 'render' | 'none';  // default: 'intent'
  replace?: boolean;     // Replace history entry instead of push
  className?: string;
  children: React.ReactNode;
}
```

| Prefetch mode | Behavior |
|---------------|----------|
| `'intent'` (default) | Preload on `mouseenter` / `focus` |
| `'render'` | Preload when Link enters viewport |
| `'none'` | Only load on click |

---

## Validation

Valibot schemas for validating mutations, route params, and API inputs. One schema validates on both client and server.

### Mutation Validation

Validate before the optimistic apply — bad data never enters the local store.

```tsx
import { useCollection } from '@platform/frontend';
import * as v from 'valibot';

const TodoSchema = v.object({
  id: v.string(),
  title: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
  done: v.number(),
});

function AddTodo() {
  const { insert } = useCollection<v.InferOutput<typeof TodoSchema>>('todos');
  const [issues, setIssues] = useState<v.BaseIssue<unknown>[]>([]);

  const handleAdd = (title: string) => {
    const row = { title, done: 0 };  // Auto-PK generates UUID
    const result = v.safeParse(TodoSchema, row);
    if (!result.success) {
      setIssues(result.issues);
      return;
    }
    insert(result.output);
  };

  return <button onClick={() => handleAdd('New todo')}>Add</button>;
}
```

For reusable forms, keep validation in the form or action component so invalid
data never enters the optimistic store. The server schema still remains the
authoritative validation boundary.

### Route Param Validation

Validate dynamic route segments before the page component renders.

```tsx
// app/blog/[slug]/page.tsx
import * as v from 'valibot';

export const validate = {
  params: v.object({
    slug: v.pipe(v.string(), v.minLength(1), v.maxLength(100), v.regex(/^[a-z0-9-]+$/)),
  }),
};

// params.slug is guaranteed to match the schema — invalid slugs render the not-found page
export default function BlogPost({ params }: { params: { slug: string } }) {
  return <article>Post: {params.slug}</article>;
}
```

The router checks for an exported `validate` object. If present, it validates before rendering. On validation failure, the router renders the `not-found.tsx` page.

### API Route Validation

Validate request bodies in API route handlers.

```ts
// app/api/todos/route.ts
import * as v from 'valibot';

const CreateTodoBody = v.object({
  title: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
});

export async function POST(req: APIRequest) {
  const body = v.parse(CreateTodoBody, await req.json());
  // body.title is validated — throws ValiError with details if invalid
  req.db.insert('todos', { title: body.title, done: 0 });  // Auto-PK generates UUID
  return Response.json({ ok: true }, { status: 201 });
}
```

Valibot throws `ValiError` with structured `issues` on failure. The framework's error handler catches it and returns a 400 with the issues array.

---

## Typed RPC (Eden Treaty)

For requests outside the sync engine — one-off queries, file uploads, streaming, server actions. Eden Treaty generates a fully typed client from the Elysia server type.

```ts
// lib/api.ts
import { treaty } from '@elysiajs/eden';
import type { App } from '../server';

export const api = treaty<App>(window.location.origin);
```

```tsx
import { api } from '@/lib/api';

// Fully typed — autocomplete for every route, param, response
const { data, error } = await api.api.todos.get();
const { data: created } = await api.api.todos.post({ title: 'New' });
const { data: transcript } = await api.api.sessions[sessionId].transcript.get();
```

**When to use sync hooks vs. Eden:**

| Scenario | Use |
|----------|-----|
| Data that should be live (todos, users, messages) | `useCollection` / `useRow` — synced automatically |
| Mutation that should be optimistic + live | `insert()` / `update()` / `remove()` from hooks |
| One-off action (send email, trigger export) | Eden RPC |
| File upload | Eden RPC |
| Streaming response (AI generation, large export) | Eden RPC with streaming |
| Data that doesn't need real-time (reports, analytics) | Eden RPC |

Both paths end up in ReactiveDB. An Eden RPC that calls `syncDB.insert()` on the server triggers the same broadcast as a sync mutation from the client. The difference is where the write originates — not where it ends up.

---

## Server Configuration

### createApp

Server-side factory. Wires auth, sync, routing, audit, static files into one Elysia instance. `@platform/server` is only needed in `app/server.ts`.

```ts
import { resolveConfig, createApp } from '@platform/server';
import { tables } from './lib/schemas';

const config = resolveConfig({
  db: { mode: 'memory' },
  tables,  // defineTable() output — auto-extracts server definitions
  auth: true,
  audit: { dir: './data/audit' },
  appDir: './app',
});

const app = createApp(config);

app.listen(3000);
export type App = typeof app;
```

**AppConfig:**

```ts
interface AppConfig {
  /** Database — ':memory:' for RAM, file path for durable */
  db: { mode: 'memory' } | { mode: string };

  /** Table definitions — column name → SQL type string */
  tables: Record<string, Record<string, string>>;

  /** Auth — true for defaults, or configure TTLs. Omit to disable. */
  auth?: boolean | {
    accessTokenTTL?: string;      // Default: '15m'
    refreshTokenTTL?: string;     // Default: '7d'
    inactivityTimeout?: string;   // Default: '30m'
    signingKey?: string;          // PEM or base64 JWK (auto-generates if absent)
  };

  /** Per-user persistent KV state sync. Requires auth: true because state is
   *  keyed by authenticated user. Default: false. See docs/state-sync.md. */
  stateSync?: boolean;

  /** Sync defaults for tables that omit _sync. Default: auto lazy protection. */
  syncDefaults?: {
    defaultMode?: 'auto' | 'full' | 'lazy'; // Default: 'auto'
    autoLazy?: {
      rowLimit?: number;                   // Default: 1000
      action?: 'lazy' | 'warn' | 'reject'; // Default: 'lazy'
      persist?: boolean;                   // Default: true
    };
    tables?: Record<string, 'auto' | 'full' | 'lazy' | {
      mode?: 'auto' | 'full' | 'lazy';
      rowLimit?: number;
      action?: 'lazy' | 'warn' | 'reject';
      persist?: boolean;
    }>;
  };

  /** Observability — logs, warnings, errors, frontend reports. Enabled by default. */
  observability?: false | {
    maxEvents?: number;           // Default: 1000
    console?: boolean;            // Default: true
    endpoint?: false | {
      enabled?: boolean;          // Default: true
      basePath?: string;          // Default: '/api/_zero/observability'
      read?: 'admin' | 'development' | 'admin-or-dev' | 'disabled';
      frontendIngest?: boolean;   // Default: true
    };
    trace?: false | {
      enabled?: boolean;          // Default: false
      slowRequestMs?: number;     // Default: 500
      slowLifecycleMs?: number;   // Default: 100
    };
  };

  /** File-based route directory. Default: './app' */
  appDir?: string;

  /** Client bundle output. Default: './.build' */
  outDir?: string;

  /** UI library pre-registration. */
  ui?: { library: string };
}
```

**DDL passthrough:** The `tables` config passes its `Record<string, string>` values directly to `ReactiveDB.defineTable()`. The string values **are** SQLite column definitions — no transformation occurs. ReactiveDB builds `CREATE TABLE` SQL by joining them:

```ts
// Config:
tables: {
  todos: { id: 'text primary key', title: 'text not null', done: 'integer default 0' }
}

// ReactiveDB generates:
// CREATE TABLE IF NOT EXISTS todos (id text primary key, title text not null, done integer default 0)
```

**What it wires:**

| Step | Plugin | What it provides |
|------|--------|-----------------|
| 1 | ReactiveDB | Shared in-memory or durable SQLite database |
| 2 | Auth plugin | `POST /auth/register`, `/login`, `/refresh`, `/logout`. `GET /auth/me`, `/jwks`. `users`, `user_properties` tables on the shared DB. |
| 3 | Auth middleware | `authContext` derived on every request — `{ userId, email, role }` or `null` |
| 4 | Observability plugin | Stable event codes, default console + memory store, protected `/api/_zero/observability/events`, frontend ingest |
| 5 | Scheduler/domain plugins | Scheduler, notifications, rooms, workflows, storage |
| 6 | Data query plugin | `/api/data` for lazy synced tables with sync read policy |
| 7 | Router plugin | File-based routing from `appDir` — SSR with React 19 `renderToReadableStream`, layouts, dynamic segments |
| 8 | Client bundle | `Bun.build()` on startup |

**Plugin order matters.** `createApp()` composes sync first so the shared
ReactiveDB exists for dependent plugins. Auth and auth middleware mount before
domain plugins and observability event reads. Router mounts last as the
catch-all route.

---

## Data Flow: Page Load → Live

```
1. GET /dashboard
   ├─► Router matches app/dashboard/page.tsx
   ├─► Server reads from ReactiveDB (todos, current user)
   ├─► renderToReadableStream — HTML streams to browser
   ├─► Includes: __ROUTE_DATA__, __AUTH_DATA__, __TABLE_DEFS__
   └─► User sees content (server-rendered)

2. Client bundle loads
   ├─► hydrateRoot() — React attaches to server HTML
   ├─► AppProvider mounts:
   │     ├─► Creates Client, connects WS to /sync
   │     ├─► WS sends sync.subscribe { lastSeq: 0 }
   │     ├─► Server responds with sync.snapshot
   │     ├─► Store populated — hooks see data
   │     └─► If data unchanged since SSR → no re-render
   └─► App is interactive

3. Steady state
   ├─► Client A: insert() → optimistic → WS sync.mutate
   ├─► Server: validates → writes → sync.ack to A → broadcast to all
   ├─► Client B: store updates → useCollection re-renders
   └─► No polling. No refetch. No invalidation. Live.
```

---

## Full Example

Three files. Auth, real-time data, optimistic mutations, SSR, file-based routing.

**app/lib/schemas/index.ts:**

```ts
import { defineTable, field } from '@platform/frontend';

export const todoTable = defineTable('todos', {
  title: field.text({ required: true }),
  done: field.boolean(),
});

export const tables = { todos: todoTable };
```

**app/server.ts:**

```ts
import { resolveConfig, createApp } from '@platform/server';
import { tables } from './lib/schemas';

const config = resolveConfig({
  db: { mode: 'memory' },
  tables,
  auth: true,
});

const app = createApp(config);
app.listen(3000);
export type App = typeof app;
```

**app/layout.tsx:**

```tsx
import { AppProvider } from '@platform/frontend';
import { tables } from './lib/schemas';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        <AppProvider
          url={typeof window !== 'undefined' ? window.location.origin : ''}
          tables={tables}
          auth
        >
          {children}
        </AppProvider>
      </body>
    </html>
  );
}
```

**app/page.tsx:**

```tsx
import { useCollection, useAuth, useCurrentUser, Link, InferRow } from '@platform/frontend';
import { todoTable } from '@app/lib/schemas';

type Todo = InferRow<typeof todoTable>;

export default function Home() {
  const { isAuthenticated, login, register, logout } = useAuth();
  const user = useCurrentUser();
  const { data: todos, insert, update, remove } = useCollection<Todo>('todos');

  if (!isAuthenticated) {
    return (
      <div>
        <h1>Welcome</h1>
        <button onClick={() => register({
          username: 'alice', email: 'alice@test.com', password: 'secret123',
        })}>
          Register as Alice
        </button>
        <button onClick={() => login('alice', 'secret123')}>
          Login as Alice
        </button>
      </div>
    );
  }

  return (
    <div>
      <h1>Hello, {user?.firstName ?? user?.username}</h1>
      <button onClick={() => logout()}>Logout</button>

      <h2>Todos ({todos.length})</h2>
      <ul>
        {todos.map(todo => (
          <li key={todo.id}>
            <input
              type="checkbox"
              checked={!!todo.done}
              onChange={() => update(todo.id, { done: !todo.done })}
            />
            {todo.title}
            <button onClick={() => remove(todo.id)}>x</button>
          </li>
        ))}
      </ul>
      <button onClick={() => insert({ title: `Todo #${todos.length + 1}` })}>
        Add Todo
      </button>
    </div>
  );
}
```

Run `bun app/server.ts`. Open two browser tabs. Register in one, data appears in both. Add a todo, it appears in both. Check it off, both update. Optimistic -- feels instant. Auth, real-time, SSR, routing. Four files (three app, one schema).

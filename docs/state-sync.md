# State Sync

**Set a key. It persists. Switch devices. It's there.**

Per-authorized-scope user reactive KV state that lives on the server. No app
schema or migrations are required. Keys are strings, values are JSON, and the
state survives refresh, device switch, and server restart. It uses the same
WebSocket as the sync engine. Single mode keeps one keyspace per user; multi
mode derives a distinct tenant + user keyspace from the authenticated session.

## What This Solves

Applications have two kinds of state:

1. **Application data** — todos, contacts, projects. Structured, relational, and shared with policy-authorized collaborators. That's the [sync engine](./realtime-sync/realtime-sync/README.md) with ReactiveDB.
2. **Client state** — theme preference, sidebar open/closed, form draft half filled out, wizard step, or last visited page. Unstructured, private to one user inside the current authorization scope, and not worth an app SQL table.

Most frameworks punt on #2. It lives in `localStorage`, vanishes on cache clear, doesn't sync across devices, and is gone if the user switches machines. State Sync moves it to the server. Same WebSocket pipe as the sync engine, same reconnect logic, same optimistic apply. But no schema — just a bag of keys.

## The Full Loop

```ts
// ─── Server: state sync enabled alongside sync engine ──

import { resolveConfig, createApp } from '@zero/framework/server';
import { tables } from './lib/schemas';

const config = resolveConfig({
  db: { mode: 'file', path: './data/app.sqlite' },
  // State Sync is Zero-owned user state, so durability and shared-runtime
  // coordination follow the separate system database.
  systemDb: { mode: 'file', path: './data/zero.system.sqlite' },
  tables,
  auth: true,          // Required: state is keyed by authenticated scope + user
  stateSync: true,     // Enables scoped-user KV state
});

const app = await createApp(config);
app.listen(3000);
```

```tsx
// ─── Client: public reactive state hooks ───────────────

'use client';

import {
  useFormDraft,
  useServerState,
  useServerStateReady,
} from '@zero/framework/react';

function Sidebar() {
  const [open, setOpen] = useServerState('sidebar.open', true);
  const ready = useServerStateReady();

  if (!ready) return <LoadingSpinner />;

  return (
    <aside className={open ? 'expanded' : 'collapsed'}>
      <button onClick={() => setOpen(!open)}>Toggle</button>
      <nav>...</nav>
    </aside>
  );
}

function IntakeForm() {
  const { draft, setField } = useFormDraft('intake', {
    insurance: '',
    memberId: '',
    groupNumber: '',
  });

  return (
    <input
      value={draft.memberId}
      onChange={(event) => setField('memberId', event.target.value)}
    />
  );
}
```

User state is restored after the authenticated State snapshot is ready. No
`localStorage`, cookies, or manual token handling is involved. `AppProvider`
owns the internal State client; the public application `Client` has no State
field, and the hooks expose scope-safe reads and writes.

## Core Properties

| Property | What it means |
|----------|--------------|
| **Per-scope user keyspace** | Single mode keeps the historical per-user namespace. A multi-mode tenant session uses a server-derived tenant + user namespace, so the same user has independent state in each organization. |
| **Schemaless** | Keys are strings, values are any JSON-serializable type. No defineTable, no migrations. |
| **Server-persisted** | SQLite is authoritative. File mode survives server restart; memory mode is intentionally ephemeral. |
| **Device-synced** | The same user in the same authorization scope sees updates across devices/tabs. Different tenants stay isolated. |
| **Optimistic** | `set()` applies locally first (instant), then syncs to server. Same pattern as sync engine mutations. |
| **Same transport** | Rides the existing sync WebSocket. No additional connection. |

## Public React API

The application-facing `Client` deliberately does not expose its provider-owned
`StateClient`. In a Zero React application, use these exports from
`@zero/framework/react` beneath `AppProvider` or `ClientProvider`:

- `useServerState()` for an arbitrary JSON value;
- `useServerStateReady()` for the initial authoritative-snapshot boundary;
- `usePreference()` for a named preference with a reset action;
- `useFormDraft()` for object-shaped drafts with field and partial-update
  helpers.

Set `stateSync: true` on the server and provider/client configuration. Full-stack
apps can inherit the server-injected setting instead of repeating it.

### `useServerState(key, defaultValue)`

Like `useState`, but persisted on the server and synchronized across devices
inside the current authorization scope:

```tsx
'use client';

import {
  useServerState,
  useServerStateReady,
} from '@zero/framework/react';

function ThemeToggle() {
  const ready = useServerStateReady();
  const [theme, setTheme] = useServerState('theme', 'light');

  if (!ready) return <LoadingSpinner />;

  return (
    <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
      Current: {theme}
    </button>
  );
}
```

Signature:

```ts
function useServerState<T extends JsonValue>(
  key: string,
  defaultValue: T,
): [T, (value: T) => void];
```

The returned value is a local, tear-free snapshot. The setter applies
optimistically, sends one `state.set` operation, and rolls back if the server
rejects it. Other authorized devices in the same exact scope receive the
committed value.

Values must be complete JSON values. JavaScript callers can bypass TypeScript,
so the server repeats strict runtime validation of the ref, key, and value.
Invalid or oversized values receive `INVALID_REQUEST` and the optimistic write
rolls back.

Keys are flat strings up to 256 characters. Dots are a naming convention, not
nested-path syntax. Names such as `__proto__`, `constructor`, and `toString`
are ordinary keys because both server and client dictionaries are
prototype-free.

Setting an existing key replaces its whole value; it does not deep-merge:

```tsx
function Preferences() {
  const [preferences, setPreferences] = useServerState('preferences', {
    theme: 'dark',
    language: 'en',
  });

  // The stored value becomes exactly { theme: 'light', language: 'en' }.
  const useLightTheme = () => {
    setPreferences({ ...preferences, theme: 'light' });
  };

  return <button onClick={useLightTheme}>Use light theme</button>;
}
```

For object updates, spread the prior value or use `useFormDraft()`. The public
hook setter accepts a JSON value; it does not use `undefined` as a deletion
sentinel.

### `useServerStateReady()`

Returns `true` only after the authoritative State snapshot for the current
authenticated scope has loaded:

```tsx
function Dashboard() {
  const ready = useServerStateReady();

  if (!ready) return <LoadingSpinner />;
  return <DashboardContent />;
}
```

```ts
function useServerStateReady(): boolean;
```

State Sync does not perform a per-user SQLite read during React server
rendering. The server snapshot for `useSyncExternalStore` is the supplied
default and readiness is `false`. After hydration and the authenticated
WebSocket baseline, the authoritative value replaces that default. Render a
loading boundary whenever showing the default early would be misleading.

### `usePreference(key, defaultValue)`

Adds a stable `preferences.` namespace and an explicit reset-to-default
operation:

```tsx
'use client';

import { usePreference } from '@zero/framework/react';

function DensityControl() {
  const { value, setValue, reset } = usePreference(
    'table-density',
    'comfortable',
  );

  return (
    <>
      <button onClick={() => setValue('compact')}>Compact</button>
      <button onClick={reset}>Reset</button>
      <span>{value}</span>
    </>
  );
}
```

`reset()` writes the supplied default value. It does not expose the internal
whole-key deletion operation.

### `useFormDraft(key, initialValue, options?)`

Persists one object-shaped draft and supplies safe whole-value update helpers:

```tsx
'use client';

import { useFormDraft } from '@zero/framework/react';

function IntakeForm() {
  const {
    draft,
    setField,
    updateDraft,
    resetDraft,
  } = useFormDraft('patient-intake', {
    name: '',
    dateOfBirth: '',
    insurance: '',
  });

  return (
    <form>
      <input
        value={draft.name}
        onChange={(event) => setField('name', event.target.value)}
      />
      <button
        type="button"
        onClick={() => updateDraft({ insurance: 'Blue Cross' })}
      >
        Use insurer
      </button>
      <button type="button" onClick={resetDraft}>Reset</button>
    </form>
  );
}
```

The default namespace is `drafts`; pass `{ namespace: 'intake' }` when an app
needs a different stable prefix. `resetDraft()` writes the complete initial
object.

### Scope and provider boundary

The hooks subscribe through React's external-store contract and re-render for
local optimistic writes and committed remote changes. They also bind callbacks
to the current authorization boundary. During logout, account replacement, or
tenant switching, the old keyspace is hidden and writes are frozen until the
new authenticated baseline arrives.

Do not cast `useClient()` or a public `Client` to reach `state`. The
provider-managed `StateClient` is intentionally internal to the integrated
SDK. `@zero/framework/sync/client` exports lower-level store and client
primitives for authors assembling a standalone Sync provider, but those
primitives require explicit message routing and lifecycle ownership; they are
not a hidden field on `createClient()`.

The integrated `createClient({ stateSync: true })` transport sends
`state.subscribe` immediately after every accepted socket-auth handshake,
including reconnects, so the provider-owned state store receives a fresh
snapshot. Low-level `createSyncClient()` keeps table-only behavior by default;
pass `stateSync: true` to opt its socket into that same wire subscription, then
route state messages from `onMessage()` into the state store you own.

The wire protocol still defines `state.delete` and `state.clear` for that
low-level transport and framework lifecycle work. Their presence does not add
delete or clear methods to the public application `Client`.

## Wire Protocol

State sync adds four client request types and three server response types to the
existing sync WebSocket. No new connection — same pipe.

### Client → Server

#### `state.subscribe`

Sent on WebSocket connect (after auth). Requests the user's full state.

```json
{
  "type": "state.subscribe"
}
```

No table list, no lastSeq. The server knows which user from the auth token. Sends back a snapshot.

#### `state.set`

Set a key.

```json
{
  "type": "state.set",
  "ref": "abc-123",
  "key": "theme",
  "value": "dark"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `ref` | `string` | Non-empty client correlation ID, at most 128 characters (the bundled client uses a UUID) |
| `key` | `string` | The key to set |
| `value` | `JsonValue` | The value (JSON-serializable) |

#### `state.delete`

Delete a key.

```json
{
  "type": "state.delete",
  "ref": "def-456",
  "key": "draft.newPost"
}
```

#### `state.clear`

Delete all keys.

```json
{
  "type": "state.clear",
  "ref": "ghi-789"
}
```

### Server → Client

#### `state.snapshot`

Full state sent on initial subscribe. One flat object with all keys.

```json
{
  "type": "state.snapshot",
  "entries": {
    "theme": "dark",
    "sidebar.open": true,
    "draft.newPost": { "title": "Hello", "body": "..." }
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `entries` | `Record<string, JsonValue>` | All key-value pairs for this user |

The client replaces its local state entirely with the snapshot contents. This
is authoritative — the same principle as `sync.snapshot` for tables. The
bundled client copies entries into a prototype-free dictionary before exposing
them.

#### `state.ack`

Acknowledgment of a set/delete/clear operation.

```json
{
  "type": "state.ack",
  "ref": "abc-123",
  "ok": true
}
```

```json
{
  "type": "state.ack",
  "ref": "abc-123",
  "ok": false,
  "error": "VALUE_TOO_LARGE"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `ref` | `string` | Correlation ID from the request |
| `ok` | `boolean` | Whether the operation succeeded |
| `error` | `string?` | Error code if rejected (see below) |

**Error codes:**

| Code | Meaning |
|------|---------|
| `INVALID_REQUEST` | Malformed ref, key, or non-JSON value |
| `VALUE_TOO_LARGE` | Value exceeds 64 KiB when JSON-serialized |
| `TOO_MANY_KEYS` | Scoped user keyspace has exceeded the 1,000 key limit |
| `KEY_TOO_LONG` | Key exceeds 256 characters |
| `TOTAL_SIZE_EXCEEDED` | Total state exceeds 10 MiB for this scoped user keyspace |
| `UNAUTHORIZED` | No authenticated user or no valid application/tenant data scope on the connection |

State messages are validated before any SQLite transaction or change-log
append. Rejected messages do not allocate a sequence. For malformed refs the
stable error ack uses an empty `ref`, because no valid correlation ID is
available.

On `ok: true`, the optimistic change is confirmed. On `ok: false`, the client rolls back to the previous value.

#### `state.change`

Pushed to other devices/tabs when the state changes. Same user and authorization
scope, different connection.

```json
{
  "type": "state.change",
  "key": "theme",
  "value": "dark",
  "op": "set"
}
```

```json
{
  "type": "state.change",
  "key": "draft.newPost",
  "op": "delete"
}
```

```json
{
  "type": "state.change",
  "key": null,
  "op": "clear"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `key` | `string \| null` | The affected key (null for clear) |
| `value` | `JsonValue?` | New value for `set`; omitted for delete/clear |
| `op` | `'set' \| 'delete' \| 'clear'` | Operation type |

---

## Server Implementation

### Storage and commit boundary

SQLite is the sole server-side source of truth. State Sync does not retain a
per-principal RAM projection. Snapshots, reads, and limit validation load the
current SQLite rows, so memory use does not grow with every principal a
runtime has ever seen and a second runtime cannot make the first runtime's
cache stale.

```sql
CREATE TABLE IF NOT EXISTS _user_state (
  user_id    TEXT NOT NULL,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,      -- JSON-serialized
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
);
CREATE INDEX IF NOT EXISTS idx_user_state_user ON _user_state(user_id);
```

`_` prefix makes this an internal table, so it is never exposed as an ordinary
table-sync payload. The historical
`user_id` column stores Zero's server-derived principal; in multi mode that
value includes the tenant scope rather than a caller-supplied tenant field.

Every `set`, `delete`, and `clear` runs under ReactiveDB's SQLite writer lock.
The manager reads the authoritative rows for limit validation, mutates
`_user_state`, allocates the database-wide sequence, and appends exactly one
logical `_changes` event in the same transaction. If event recording fails,
the state row and sequence allocation roll back too.

The current durable session/tenant authority validator runs synchronously
*inside* that same writer transaction, immediately before any mutation. A
revocation racing an earlier asynchronous token check therefore returns an
`UNAUTHORIZED` ack without changing `_user_state`, allocating a sequence, or
writing an event.

`state.subscribe` reads `_user_state` and the represented durable cursor from
one SQLite read snapshot. A concurrent commit is therefore either included in
the snapshot or remains available to the ordered change dispatcher; a pending
event already represented by the snapshot is not delivered again. The same
current-authority validator executes inside this read boundary. If it fails,
no snapshot is sent.

### Elysia Integration

State sync integrates into the existing sync WebSocket handler — not a separate endpoint.

The sync client sends its bearer token in the first `sync.auth` WebSocket
message and waits for `sync.auth.ready` before subscribing. A valid token
populates `ws.data.authContext`. State Sync derives its storage and delivery
principal from that server-validated identity: the user ID in single mode, or
`tenant:<tenantId>:user:<userId>` in multi mode. It never accepts a tenant ID
from a state message. Without a valid scope, `state.subscribe` is ignored and
mutating state messages return an unauthorized ack. Auth-enabled
`createApp()` deployments default sync to required, and revalidation closes a
socket when its current account or property-derived permissions change.

`createApp()` rejects `stateSync: true` unless auth is enabled. Use `auth: true` or an auth config object whenever server-persisted state is enabled.

```ts
// Condensed shape of the State path inside the sync plugin.

case 'state.subscribe': {
  const principal = resolveStatePrincipal(ws.data.authContext, tenancyMode);
  if (!principal) break;  // Auth and a valid data scope are required

  const snapshot = stateManager.getUserStateSnapshot(
    principal,
    validateCurrentAuthority,
  );
  if (!snapshot) break;

  ws.data.stateSubscribed = true;
  ws.data.statePrincipal = principal;
  ws.data.stateLastSeq = snapshot.seq;

  if (!sendSyncWire(ws, {
    type: 'state.snapshot',
    entries: snapshot.entries,
  })) {
    // A dropped snapshot must not leave a socket marked as subscribed.
    ws.data.stateSubscribed = false;
    ws.data.statePrincipal = null;
    ws.data.stateLastSeq = 0;
  }
  break;
}

case 'state.set': {
  // The router first validates ref, key, and the complete JSON value.
  const principal = resolveStatePrincipal(ws.data.authContext, tenancyMode);
  if (!principal) return sendUnauthorizedAck(ws, msg.ref);

  const result = withStateMutationOrigin(ws, mutationOrigin, () =>
    stateManager.set(
      principal,
      msg.key,
      msg.value,
      validateCurrentAuthority, // executes inside the write transaction
    )); // helper restores the prior origin in finally
  if (!result.ok) {
    sendSyncWire(ws, {
      type: 'state.ack', ref: msg.ref, ok: false, error: result.error,
    });
    break;
  }

  // The ordered onChange path has already considered other recipients. The
  // origin is excluded, so this socket receives only its operation ack.
  sendSyncWire(ws, { type: 'state.ack', ref: msg.ref, ok: true });
  break;
}

// state.delete and state.clear use the same ref/key validation, mutation-origin
// exclusion, in-transaction authority fence, ordered event, and ack path.
```

### Multi-Device and Multi-Runtime Delivery

State Sync does not use a blind Bun state topic. Local and external commits use
the same ordered ReactiveDB `onChange` path. For each active socket, delivery
requires all of these conditions at the last boundary before send:

1. The socket completed `state.subscribe`.
2. Its bound `statePrincipal` exactly equals the event's stored principal.
3. The event sequence is newer than the snapshot/change cursor already sent.
4. Re-deriving the principal from the current auth context still produces the
   same value.
5. Synchronous durable authority validation still succeeds.
6. For a local client mutation, the socket is not the originating connection.

Only then does `sendSyncWire` queue `state.change`. A successful queue advances
that socket's state cursor. A dropped send closes the socket instead of
silently claiming delivery.

```
User Alice — Desktop (Tab 1)  ──┐
User Alice — Desktop (Tab 2)  ──┤── exact-principal, authority-fenced recipients
User Alice — Phone             ──┘

Alice sets theme=dark on Tab 1:
  1. Tab 1 sends state.set { key: 'theme', value: 'dark' }
  2. SQLite commits the row and its ordered internal event atomically
  3. The ordered listener excludes Tab 1 and revalidates Tab 2 and Phone
  4. Tab 2 and Phone receive state.change; Tab 1 receives only state.ack
  5. Their local stores update and useServerState re-renders
```

The sender already applied its optimistic value, so a successful operation is
confirmed by its ack rather than echoed as a change.

For multiple Zero runtimes sharing one file-mode SQLite database, `_user_state`
events travel through the same ordered durable dispatcher as table changes.
The receiving runtime decodes the event and applies the same per-socket checks
listed above. There is no process-local state projection to update. Internal
state events never pass through generic table broadcast.

This is a shared-file topology boundary. It does not relay State Sync between
separate SQLite files or hosts without a shared filesystem, and `memory`/`hot`
mode remains process-local.

### Prepared Statements

```ts
const stmts = {
  getUserState: db.prepare('SELECT key, value FROM _user_state WHERE user_id = ?'),
  upsertState: db.prepare(`
    INSERT INTO _user_state (user_id, key, value, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `),
  deleteState: db.prepare('DELETE FROM _user_state WHERE user_id = ? AND key = ?'),
  clearUserState: db.prepare('DELETE FROM _user_state WHERE user_id = ?'),
};
```

All statements are prepared once on plugin start and finalized when the State
Manager is disposed. Raw writes run inside a ReactiveDB transaction that also
records the logical internal event.

### Limits

| Limit | Default | Why |
|-------|---------|-----|
| Max value size | 64 KiB of UTF-8 JSON bytes | Prevents abuse — state values should be small. A form draft is usually about 1 KiB. |
| Max keys per scoped user | 1,000 | Prevents unbounded growth. 1000 keys covers any reasonable app state. |
| Max key length | 256 chars | Keys are paths like `'draft.post-123.body'` — 256 is generous. |
| Total state per scoped user | 10 MiB of UTF-8 bytes | Sum of key bytes and serialized JSON value bytes. Circuit breaker. |

Exceeding a limit returns `state.ack { ok: false, error: '...' }`. The optimistic local change rolls back.

### Transport bounds

V1 deliberately sends one complete snapshot rather than paginating it. The
10 MiB state limit counts raw UTF-8 key bytes plus already JSON-serialized value
bytes. At most 1,000 keys of at most 256 characters can add JSON key escaping
and object punctuation; even the worst allowed snapshot wire encoding remains
below 12 MiB. The WebSocket's **outgoing** backpressure capacity is therefore a
bounded 16 MiB, and every snapshot uses the checked `sendSyncWire` path.

The **incoming** WebSocket payload limit remains 1 MiB. State writes are much
smaller because a single serialized value is limited to 64 KiB. Raising the
outgoing capacity does not allow clients to submit larger messages. If the
state/key limits change enough that the worst encoded snapshot no longer fits
safely below 16 MiB, the protocol must gain bounded pagination before those
limits are raised.

---

## Client Implementation

### @xstate/store Integration

The state sync client uses its own @xstate/store instance, separate from the sync engine's table store.

```ts
interface StateStoreContext {
  // Always a null-prototype dictionary; user keys cannot collide with
  // Object.prototype.
  entries: Record<string, JsonValue>;
  ready: boolean;
  pending: PendingStateOp[];
}
```

**Events:**

| Event | Payload | Effect |
|-------|---------|--------|
| `state.snapshot` | `{ entries }` | Replace all entries, set `ready = true`, clear pending |
| `state.change` | `{ key, value, op }` | Apply change to entries |
| `state.optimistic-set` | `{ key, value, ref }` | Set key, add to pending |
| `state.optimistic-delete` | `{ key, ref }` | Delete key, add to pending |
| `state.optimistic-clear` | `{ ref }` | Clear all, add to pending |
| `state.ack` | `{ ref, ok, error? }` | Remove from pending. On failure: rollback. |

**Reducers:**

```ts
const emptyEntries = () => Object.create(null) as Record<string, JsonValue>;

const copyEntries = (source?: Readonly<Record<string, JsonValue>>) => {
  const entries = emptyEntries();
  if (source) {
    for (const key of Object.keys(source)) entries[key] = source[key];
  }
  return entries;
};

const readEntry = (entries: Readonly<Record<string, JsonValue>>, key: string) =>
  Object.hasOwn(entries, key) ? entries[key] : undefined;

const reducers = {
  'state.snapshot': (ctx, { entries }) => ({
    entries: copyEntries(entries),
    ready: true,
    pending: [],
  }),

  'state.change': (ctx, { key, value, op }) => {
    const entries = copyEntries(ctx.entries);
    switch (op) {
      case 'set': entries[key] = value; break;
      case 'delete': delete entries[key]; break;
      case 'clear': return { ...ctx, entries: emptyEntries() };
    }
    return { ...ctx, entries };
  },

  'state.optimistic-set': (ctx, { key, value, ref }) => {
    const entries = copyEntries(ctx.entries);
    entries[key] = value;
    return {
      entries,
      ready: ctx.ready,
      pending: [...ctx.pending, {
        ref, op: 'set', key,
        previousValue: readEntry(ctx.entries, key),  // For rollback
      }],
    };
  },

  'state.optimistic-delete': (ctx, { key, ref }) => {
    const entries = copyEntries(ctx.entries);
    const previousValue = readEntry(entries, key);
    delete entries[key];
    return {
      entries,
      ready: ctx.ready,
      pending: [...ctx.pending, { ref, op: 'delete', key, previousValue }],
    };
  },

  'state.ack': (ctx, { ref, ok }) => {
    if (ok) {
      return {
        ...ctx,
        pending: ctx.pending.filter(p => p.ref !== ref),
      };
    }
    // Rollback
    const op = ctx.pending.find(p => p.ref === ref);
    if (!op) return ctx;
    const entries = copyEntries(ctx.entries);
    if (op.previousValue !== undefined) {
      entries[op.key] = op.previousValue;
    } else {
      delete entries[op.key];
    }
    return {
      entries,
      ready: ctx.ready,
      pending: ctx.pending.filter(p => p.ref !== ref),
    };
  },
};
```

### Public hook composition

```tsx
import { useServerState } from '@zero/framework/react';

export function useSidebarState() {
  return useServerState('sidebar.open', true);
}
```

Applications compose the exported hook rather than reaching into the public
`Client`. Internally, Zero's provider-owned implementation uses
`useSyncExternalStore`, the private State context, and the authorization-scope
boundary to provide tear-free reads, change-detected subscriptions, and a
stable scope-fenced setter.

---

## Comparison with Sync Engine

| | Sync Engine (ReactiveDB) | State Sync |
|---|-------------------------|------------|
| **Data model** | Relational tables with schema | Flat KV, no schema |
| **Scope** | Shared with policy-authorized collaborators | Per authorized-scope user (isolated keyspaces) |
| **Definition** | `defineTable()` with column types | No definition needed — just set keys |
| **Queries** | SQL-like reads, filtered views | Key lookup, prefix scan |
| **Mutations** | `insert(table, row)` / `update(table, id, partial)` | Public hook setter replaces one key's value; low-level transport also supports delete/clear |
| **Optimistic** | Yes — pending queue with rollback | Yes — same pattern |
| **Broadcast** | Eligible policy-authorized subscribers | Same scoped user's other devices |
| **Persistence** | SQLite (ReactiveDB tables) | SQLite (`_user_state` table) |
| **React hook** | `useCollection()`, `useRow()`, `useQuery()` | `useServerState()` |
| **Transport** | Same WebSocket | Same WebSocket |
| **Use case** | Todos, contacts, projects, records | Theme, sidebar, form drafts, game state |

They complement each other. Both ride the same WebSocket. Both use @xstate/store. Both do optimistic mutations. The difference is structured shared data vs unstructured state private to one user in the current authorization scope.

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Set value exceeds 64 KiB | `state.ack { ok: false }`, optimistic rollback |
| Key count exceeds 1,000 | `state.ack { ok: false }`, optimistic rollback |
| Not authenticated | `state.subscribe` ignored, no snapshot sent |
| Server restart | File mode reads the authoritative SQLite rows on `state.subscribe`; memory mode intentionally starts empty. |
| WebSocket disconnect | Local state preserved in @xstate/store. On reconnect, `state.subscribe` → fresh snapshot reconciles. |
| Concurrent set from two runtimes | SQLite serializes writers. Limit checks use authoritative rows under the writer lock; last committed write wins and the ordered durable log fans it out. |

### Multi-tenant boundary

The wire protocol still sends only logical state keys. The server derives the durable
principal from the validated socket identity: single mode uses the existing user ID, while
multi mode stores and publishes under `tenant:<tenantId>:user:<userId>`. A tenant ID is
never accepted from a state message. A multi-mode application/selection session without a
live membership receives `UNAUTHORIZED` for writes and no snapshot for subscriptions.

Changing the active tenant therefore changes the complete state keyspace. The browser auth
transition clears the old in-memory state before reconnecting, and the new socket receives
only the selected tenant's snapshot.

### Offline Behavior

Connection is expected. State sync does not have an offline-first design.

- **When disconnected:** `useServerState` continues to return cached values from the @xstate/store (last known state). The UI does not break — reads work normally from the local store.
- **Writes while disconnected:** `set()` calls while disconnected are no-ops. The optimistic apply still updates the local store, but the WebSocket send silently fails. No writes are queued for later replay.
- **When reconnected:** The client sends `state.subscribe`, and the server responds with a fresh `state.snapshot`. This replaces the local store entirely, reconciling any drift from failed writes during the disconnection.
- **No IndexedDB persistence.** State lives in the @xstate/store (memory) on the client and in SQLite on the server. If the user closes the tab while disconnected, any unsynced local changes are lost. The next page load gets a fresh snapshot from the server.

---

## Future: Multi-User Shared State

V1 is scoped-user only. Future versions could support shared keyspaces:

```ts
// Future API — NOT V1
const game = client.sharedState('game:room-123');
game.set('board', [null,null,null,null,'X',null,null,null,null]);
game.set('turn', 'O');

// Both players subscribed to 'game:room-123' see the same state
```

This would require a server-derived shared principal, an explicit access policy
for joining the room, and the same ordered, authority-fenced delivery path. The
wire protocol and client-side store patterns could remain similar, but this is
designed for later and is not part of V1.

# State Sync

**Set a key. It persists. Switch devices. It's there.**

Per-user reactive KV state that lives on the server. No schema, no tables, no migrations. Keys are strings, values are JSON. Survives refresh, device switch, server restart. Uses the same WebSocket the sync engine already has.

## What This Solves

Applications have two kinds of state:

1. **Application data** — todos, users, projects. Structured, relational, shared between users. That's the [sync engine](./realtime-sync/realtime-sync/README.md) with ReactiveDB.
2. **Client state** — theme preference, sidebar open/closed, form draft half filled out, wizard step, last visited page, game board between two players. Unstructured, per-user, doesn't belong in a SQL table.

Most frameworks punt on #2. It lives in `localStorage`, vanishes on cache clear, doesn't sync across devices, and is gone if the user switches machines. State Sync moves it to the server. Same WebSocket pipe as the sync engine, same reconnect logic, same optimistic apply. But no schema — just a bag of keys.

## The Full Loop

```ts
// ─── Server: state sync enabled alongside sync engine ──

import { resolveConfig, createApp } from '@platform/server';
import { tables } from './lib/schemas';

const config = resolveConfig({
  db: { mode: 'memory' },
  tables,
  auth: true,          // Required: state is keyed by authenticated user
  stateSync: true,     // Enables per-user KV state
});

const app = createApp(config);
app.listen(3000);
```

```ts
// ─── Client: set state, it persists everywhere ─────────

import { createClient } from '@platform/frontend';

const client = createClient({ url: 'http://localhost:3000', tables });
await client.login('alice', 'secret');

// Set some state
client.state.set('theme', 'dark');
client.state.set('sidebar.open', true);
client.state.set('dashboard.lastTab', 'analytics');
client.state.set('intake-form.step2', {
  insurance: 'Blue Cross',
  memberId: 'BC-12345',
  groupNumber: '',   // partially filled
});

// Close laptop. Open phone. Login.
client.state.get('theme');              // 'dark'
client.state.get('intake-form.step2');  // { insurance: 'Blue Cross', ... }
// Exactly where they left off.
```

```tsx
// ─── React: reactive state hook ────────────────────────

function Sidebar() {
  const [open, setOpen] = useServerState('sidebar.open', true);

  return (
    <aside className={open ? 'expanded' : 'collapsed'}>
      <button onClick={() => setOpen(!open)}>Toggle</button>
      <nav>...</nav>
    </aside>
  );
}

// User toggles sidebar on desktop → opens phone → sidebar is in the same position.
// No localStorage. No cookies. Server-persisted, device-synced.
```

## Core Properties

| Property | What it means |
|----------|--------------|
| **Per-user keyspace** | Each authenticated user gets an isolated KV namespace. Users cannot see each other's state. |
| **Schemaless** | Keys are strings, values are any JSON-serializable type. No defineTable, no migrations. |
| **Server-persisted** | State lives in server memory (Map) with SQLite backing for durability. Survives server restart. |
| **Device-synced** | Same user on multiple devices/tabs sees the same state. Change on one, updates on all. |
| **Optimistic** | `set()` applies locally first (instant), then syncs to server. Same pattern as sync engine mutations. |
| **Same transport** | Rides the existing sync WebSocket. No additional connection. |

## Client API

### state.set(key, value)

Set a key in the user's state. Value must be JSON-serializable.

```ts
client.state.set('theme', 'dark');
client.state.set('sidebar.open', false);
client.state.set('wizard.currentStep', 3);
client.state.set('draft.newPost', {
  title: 'Hello World',
  body: 'This is a draft...',
  tags: ['intro', 'first-post'],
});
```

**Behavior:**
1. Validates value is JSON-serializable
2. Updates local @xstate/store immediately (optimistic)
3. Sends `state.set { key, value }` over WebSocket
4. Server persists to KV store, acks
5. If user has other devices/tabs connected, server pushes `state.change` to them

**Key format:** Flat strings. Dots are convention for grouping but have no special meaning — `'sidebar.open'` is just a string key, not a nested path.

**Overwrite:** Setting an existing key replaces the value entirely. No deep merge.

```ts
client.state.set('prefs', { theme: 'dark', lang: 'en' });
client.state.set('prefs', { theme: 'light' });
client.state.get('prefs');  // { theme: 'light' } — lang is gone
```

### state.get(key)

Read a key from the user's state. Returns `undefined` if not set.

```ts
const theme = client.state.get('theme');         // 'dark'
const missing = client.state.get('nonexistent');  // undefined
```

**Reads are local.** Reads come from the in-memory store, not a server round-trip. The store is populated from the server snapshot on connect and kept current via WebSocket changes.

### state.get(key, defaultValue)

Read with a default. Returns the default if the key doesn't exist.

```ts
const theme = client.state.get('theme', 'light');     // 'dark' (exists)
const lang = client.state.get('language', 'en');       // 'en' (doesn't exist, returns default)
```

### state.delete(key)

Remove a key from the user's state.

```ts
client.state.delete('draft.newPost');
client.state.get('draft.newPost');  // undefined
```

**Behavior:**
1. Removes from local store immediately
2. Sends `state.delete { key }` over WebSocket
3. Server removes from KV, acks
4. Other devices see the key disappear

### state.getAll()

Get the entire state as a flat object.

```ts
const all = client.state.getAll();
// {
//   'theme': 'dark',
//   'sidebar.open': true,
//   'wizard.currentStep': 3,
//   'draft.newPost': { title: '...', body: '...', tags: [...] },
// }
```

Returns a shallow copy. Mutating the returned object does not affect the store.

### state.getByPrefix(prefix)

Get all keys matching a prefix.

```ts
client.state.set('draft.post-1', { title: 'Draft 1' });
client.state.set('draft.post-2', { title: 'Draft 2' });
client.state.set('theme', 'dark');

const drafts = client.state.getByPrefix('draft.');
// {
//   'draft.post-1': { title: 'Draft 1' },
//   'draft.post-2': { title: 'Draft 2' },
// }
```

### state.clear()

Remove all keys. Nuclear option — wipes the user's entire state.

```ts
client.state.clear();
client.state.getAll();  // {}
```

### state.subscribe(key, callback)

Subscribe to changes on a specific key. Fires when the value changes (from any source — local set, server push from another device).

```ts
const unsub = client.state.subscribe('theme', (value) => {
  console.log('Theme changed:', value);
  // value is the new value, or undefined if deleted
});

// Later
unsub();
```

### state.subscribe(callback)

Subscribe to all state changes.

```ts
const unsub = client.state.subscribe((event) => {
  console.log(event.type, event.key, event.value);
  // type: 'set' | 'delete' | 'clear'
  // key: the affected key (null for 'clear')
  // value: new value (undefined for 'delete', null for 'clear')
});
```

### Full Client Interface

```ts
interface StateClient {
  /** Set a key. Optimistic — applies locally, syncs to server. */
  set(key: string, value: JsonValue): void;

  /** Get a key. Local read — no server round-trip. */
  get(key: string): JsonValue | undefined;
  get<T extends JsonValue>(key: string, defaultValue: T): T;

  /** Delete a key. */
  delete(key: string): void;

  /** Get all keys as a flat object. */
  getAll(): Record<string, JsonValue>;

  /** Get all keys matching a prefix. */
  getByPrefix(prefix: string): Record<string, JsonValue>;

  /** Remove all keys. */
  clear(): void;

  /** Subscribe to a specific key's changes. */
  subscribe(key: string, callback: (value: JsonValue | undefined) => void): () => void;

  /** Subscribe to all state changes. */
  subscribe(callback: (event: StateChangeEvent) => void): () => void;

  /** Number of keys in the store. */
  readonly size: number;

  /** Whether the state has been loaded from the server (snapshot received). */
  readonly ready: boolean;
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

interface StateChangeEvent {
  type: 'set' | 'delete' | 'clear';
  key: string | null;
  value: JsonValue | undefined;
  source: 'local' | 'remote';  // Did this change originate from this client or another device?
}
```

---

## React Hook

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

**Signature:**

```ts
function useServerState<T extends JsonValue>(
  key: string,
  defaultValue: T,
): [T, (value: T) => void];
```

**Behavior:**
- Returns `[currentValue, setter]` — same API as `useState`
- `currentValue` reads from the server-synced store. If the key doesn't exist, returns `defaultValue`.
- `setter` calls `client.state.set(key, value)` — optimistic, persisted, synced
- Re-renders when the value changes (from local set OR remote push from another device/tab)
- Uses `useSyncExternalStore` internally — tear-free reads

**SSR:** During server-side rendering, `useServerState` reads from the user's persisted state (loaded from SQLite). The server-rendered HTML includes the correct value. On hydration, the client store is populated from the snapshot — no flash of default values.

### useServerState with objects

```tsx
function IntakeForm() {
  const [formData, setFormData] = useServerState('intake.demographics', {
    name: '',
    dob: '',
    address: '',
    phone: '',
  });

  const updateField = (field: string, value: string) => {
    setFormData({ ...formData, [field]: value });
  };

  return (
    <form>
      <input value={formData.name} onChange={e => updateField('name', e.target.value)} />
      <input value={formData.dob} onChange={e => updateField('dob', e.target.value)} />
      <input value={formData.address} onChange={e => updateField('address', e.target.value)} />
      <input value={formData.phone} onChange={e => updateField('phone', e.target.value)} />
    </form>
  );
}

// User fills out name and DOB. Phone dies. Opens laptop. Name and DOB are there.
```

**Important:** `setFormData` replaces the entire value (same as `state.set`). For objects, spread the previous value and override the changed field.

### useServerStateReady

Check if the state snapshot has been loaded from the server.

```tsx
function App() {
  const ready = useServerStateReady();

  if (!ready) return <LoadingSpinner />;
  return <Dashboard />;
}
```

```ts
function useServerStateReady(): boolean;
```

On initial page load, there's a brief moment between hydration and WebSocket connect where the state snapshot hasn't arrived yet. `useServerState` returns the default value during this window. `useServerStateReady` lets you show a loading state if needed. For most apps this gap is <100ms and the SSR-rendered values are correct, so this hook is rarely needed.

---

## Wire Protocol

State sync adds four message types to the existing sync WebSocket. No new connection — same pipe.

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
| `ref` | `string` | Client-generated UUID for ack correlation |
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

The client replaces its local state entirely with the snapshot contents. This is authoritative — same principle as `sync.snapshot` for tables.

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
| `VALUE_TOO_LARGE` | Value exceeds 64KB when JSON-serialized |
| `TOO_MANY_KEYS` | User has exceeded the 1,000 key limit |
| `KEY_TOO_LONG` | Key exceeds 256 characters |
| `TOTAL_SIZE_EXCEEDED` | Total state exceeds 10MB per user |
| `UNAUTHORIZED` | No authenticated user on the connection |

On `ok: true`, the optimistic change is confirmed. On `ok: false`, the client rolls back to the previous value.

#### `state.change`

Pushed to other devices/tabs when the state changes. Same user, different connection.

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
  "value": null,
  "op": "delete"
}
```

```json
{
  "type": "state.change",
  "key": null,
  "value": null,
  "op": "clear"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `key` | `string \| null` | The affected key (null for clear) |
| `value` | `JsonValue \| null` | New value (null for delete/clear) |
| `op` | `'set' \| 'delete' \| 'clear'` | Operation type |

---

## Server Implementation

### Storage

Two-tier: RAM for speed, SQLite for durability.

**Hot path (RAM):**

```ts
// Per-user state held in a Map
const userStates: Map<string, Map<string, JsonValue>> = new Map();
```

All reads and writes go to the Map first. Nanosecond access. The Map is the source of truth during runtime.

**Cold path (SQLite):**

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

`_` prefix — internal table, never broadcast by the sync engine.

**Write-through:** Every `state.set` and `state.delete` writes to both the Map and SQLite in the same operation. SQLite uses WAL mode — writes don't block reads.

**Load on connect:** When a user connects and sends `state.subscribe`, the server checks the Map first. If empty (server restarted since last connection), loads from SQLite into the Map, then sends the snapshot.

```ts
function getUserState(userId: string): Map<string, JsonValue> {
  let state = userStates.get(userId);
  if (!state) {
    // Load from SQLite
    state = new Map();
    const rows = stmts.getUserState.all(userId);
    for (const row of rows) {
      state.set(row.key, JSON.parse(row.value));
    }
    userStates.set(userId, state);
  }
  return state;
}
```

### Elysia Integration

State sync integrates into the existing sync WebSocket handler — not a separate endpoint.

The sync WebSocket resolves `?token=...` through the auth token verifier when auth is configured. A valid token populates `ws.data.authContext`, and state sync uses `authContext.userId` as the per-user keyspace. Without a valid auth context, `state.subscribe` is ignored and mutating state messages return an unauthorized ack.

`createApp()` rejects `stateSync: true` unless auth is enabled. Use `auth: true` or an auth config object whenever server-persisted state is enabled.

```ts
// Inside the sync plugin's .ws('/sync') message handler:

case 'state.subscribe': {
  const userId = ws.data.authContext?.userId;
  if (!userId) break;  // Auth required for state sync

  const state = getUserState(userId);
  ws.send(JSON.stringify({
    type: 'state.snapshot',
    entries: Object.fromEntries(state),
  }));

  // Subscribe to user's state topic for multi-device sync
  ws.subscribe(`state:${userId}`);
  break;
}

case 'state.set': {
  const userId = ws.data.authContext?.userId;
  if (!userId) break;

  const state = getUserState(userId);

  // Validate size
  const serialized = JSON.stringify(msg.value);
  if (serialized.length > 65536) {
    ws.send(JSON.stringify({ type: 'state.ack', ref: msg.ref, ok: false, error: 'Value too large (max 64KB)' }));
    break;
  }

  // Write to Map + SQLite
  state.set(msg.key, msg.value);
  stmts.upsertState.run(userId, msg.key, serialized, Date.now());

  // Ack the sender
  ws.send(JSON.stringify({ type: 'state.ack', ref: msg.ref, ok: true }));

  // Push to other devices/tabs via topic
  server.publish(`state:${userId}`, JSON.stringify({
    type: 'state.change',
    key: msg.key,
    value: msg.value,
    op: 'set',
  }));
  break;
}

case 'state.delete': {
  const userId = ws.data.authContext?.userId;
  if (!userId) break;

  const state = getUserState(userId);
  state.delete(msg.key);
  stmts.deleteState.run(userId, msg.key);

  ws.send(JSON.stringify({ type: 'state.ack', ref: msg.ref, ok: true }));
  server.publish(`state:${userId}`, JSON.stringify({
    type: 'state.change',
    key: msg.key,
    value: null,
    op: 'delete',
  }));
  break;
}

case 'state.clear': {
  const userId = ws.data.authContext?.userId;
  if (!userId) break;

  userStates.set(userId, new Map());
  stmts.clearUserState.run(userId);

  ws.send(JSON.stringify({ type: 'state.ack', ref: msg.ref, ok: true }));
  server.publish(`state:${userId}`, JSON.stringify({
    type: 'state.change',
    key: null,
    value: null,
    op: 'clear',
  }));
  break;
}
```

### Multi-Device Delivery

Uses the same Bun pub/sub as the sync engine. Each user gets a topic `state:{userId}`. All of a user's connections (tabs, devices) subscribe to that topic.

```
User Alice — Desktop (Tab 1)  ──┐
User Alice — Desktop (Tab 2)  ──┤── all subscribed to topic 'state:u_alice'
User Alice — Phone             ──┘

Alice sets theme=dark on Tab 1:
  1. Tab 1 sends state.set { key: 'theme', value: 'dark' }
  2. Server persists, acks Tab 1
  3. server.publish('state:u_alice', state.change { key: 'theme', value: 'dark' })
  4. Tab 2 and Phone receive the change
  5. Their local stores update, useServerState re-renders
```

`server.publish()` delivers to ALL subscribers on the topic including the sender. The sender's local store already has the optimistic value — the change is a no-op (same key, same value). Other connections apply the change.

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
  deleteByPrefix: db.prepare('DELETE FROM _user_state WHERE user_id = ? AND key LIKE ? || \'%\''),
};
```

All prepared once on plugin start, reused per call. Same pattern as every other SQLite layer in the codebase.

### Limits

| Limit | Default | Why |
|-------|---------|-----|
| Max value size | 64 KB | Prevents abuse — state values should be small. A form draft is ~1KB. |
| Max keys per user | 1,000 | Prevents unbounded growth. 1000 keys covers any reasonable app state. |
| Max key length | 256 chars | Keys are paths like `'draft.post-123.body'` — 256 is generous. |
| Total state per user | 10 MB | Sum of all serialized values. Circuit breaker. |

Exceeding a limit returns `state.ack { ok: false, error: '...' }`. The optimistic local change rolls back.

**Snapshot pagination:** V1 does not paginate snapshots. With a max of 1,000 keys at realistic value sizes, a typical snapshot is under 100KB. If a snapshot exceeds 1MB, the server logs a warning. Pagination is a V2 concern.

---

## Client Implementation

### @xstate/store Integration

The state sync client uses its own @xstate/store instance, separate from the sync engine's table store.

```ts
interface StateStoreContext {
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
const reducers = {
  'state.snapshot': (ctx, { entries }) => ({
    entries,
    ready: true,
    pending: [],
  }),

  'state.change': (ctx, { key, value, op }) => {
    const entries = { ...ctx.entries };
    switch (op) {
      case 'set': entries[key] = value; break;
      case 'delete': delete entries[key]; break;
      case 'clear': return { ...ctx, entries: {} };
    }
    return { ...ctx, entries };
  },

  'state.optimistic-set': (ctx, { key, value, ref }) => ({
    entries: { ...ctx.entries, [key]: value },
    ready: ctx.ready,
    pending: [...ctx.pending, {
      ref, op: 'set', key,
      previousValue: ctx.entries[key],  // For rollback
    }],
  }),

  'state.optimistic-delete': (ctx, { key, ref }) => {
    const entries = { ...ctx.entries };
    const previousValue = entries[key];
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
    const entries = { ...ctx.entries };
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

### useServerState Implementation

```ts
function useServerState<T extends JsonValue>(
  key: string,
  defaultValue: T,
): [T, (value: T) => void] {
  const client = useClient();

  const value = useSyncExternalStore(
    (cb) => client.state.subscribe(key, cb),
    () => client.state.get(key, defaultValue),
  );

  const setValue = useCallback(
    (newValue: T) => client.state.set(key, newValue),
    [client, key],
  );

  return [value as T, setValue];
}
```

Same `useSyncExternalStore` pattern as the sync hooks. Tear-free reads, change-detected subscriptions, stable setter reference.

---

## Comparison with Sync Engine

| | Sync Engine (ReactiveDB) | State Sync |
|---|-------------------------|------------|
| **Data model** | Relational tables with schema | Flat KV, no schema |
| **Scope** | Shared between all users | Per-user (isolated keyspaces) |
| **Definition** | `defineTable()` with column types | No definition needed — just set keys |
| **Queries** | SQL-like reads, filtered views | Key lookup, prefix scan |
| **Mutations** | `insert(table, row)` / `update(table, id, partial)` | `set(key, value)` / `delete(key)` |
| **Optimistic** | Yes — pending queue with rollback | Yes — same pattern |
| **Broadcast** | All subscribed clients (multi-user) | Same user's other devices (single-user) |
| **Persistence** | SQLite (ReactiveDB tables) | SQLite (`_user_state` table) |
| **React hook** | `useCollection()`, `useRow()`, `useQuery()` | `useServerState()` |
| **Transport** | Same WebSocket | Same WebSocket |
| **Use case** | Todos, users, projects, records | Theme, sidebar, form drafts, game state |

They complement each other. Both ride the same WebSocket. Both use @xstate/store. Both do optimistic mutations. The difference is structured shared data vs unstructured per-user state.

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Set value exceeds 64KB | `state.ack { ok: false }`, optimistic rollback |
| Key count exceeds 1,000 | `state.ack { ok: false }`, optimistic rollback |
| Not authenticated | `state.subscribe` ignored, no snapshot sent |
| Server restart | Map is empty, loads from SQLite on first `state.subscribe` |
| WebSocket disconnect | Local state preserved in @xstate/store. On reconnect, `state.subscribe` → fresh snapshot reconciles. |
| Concurrent set from two devices | Last-write-wins. Both apply optimistically on their own device, server processes in arrival order, both get the final state via `state.change`. |

### Offline Behavior

Connection is expected. State sync does not have an offline-first design.

- **When disconnected:** `useServerState` continues to return cached values from the @xstate/store (last known state). The UI does not break — reads work normally from the local store.
- **Writes while disconnected:** `set()` calls while disconnected are no-ops. The optimistic apply still updates the local store, but the WebSocket send silently fails. No writes are queued for later replay.
- **When reconnected:** The client sends `state.subscribe`, and the server responds with a fresh `state.snapshot`. This replaces the local store entirely, reconciling any drift from failed writes during the disconnection.
- **No IndexedDB persistence.** State lives in the @xstate/store (memory) on the client and in SQLite on the server. If the user closes the tab while disconnected, any unsynced local changes are lost. The next page load gets a fresh snapshot from the server.

---

## Future: Multi-User Shared State

V1 is per-user only. Future versions could support shared keyspaces:

```ts
// Future API — NOT V1
const game = client.sharedState('game:room-123');
game.set('board', [null,null,null,null,'X',null,null,null,null]);
game.set('turn', 'O');

// Both players subscribed to 'game:room-123' see the same state
```

This would use a different topic pattern (`shared:{roomId}` instead of `state:{userId}`) and require access control (who can join a room). The wire protocol and client-side store patterns would be identical — just different scoping. Designed for later, not now.

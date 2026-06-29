# Platform SDK Reference

Everything you need to build full-stack reactive apps with one import.

```ts
import {
  createClient, AppProvider, useAuth, useCollection, useLazyCollection,
  defineTable, field, InferRow, CrudPage, ...
} from '@zero/framework/react';
```

---

## Table of Contents

- [Quick Start](#quick-start)
- [Architecture Overview](#architecture-overview)
- [Schema Builder](#schema-builder)
- [Client SDK](#client-sdk)
- [Authentication](#authentication)
- [Real-Time Data (Collections)](#real-time-data-collections)
- [CrudPage](#crudpage)
- [Server State Sync](#server-state-sync)
- [Forms](#forms)
- [Data Table](#data-table)
- [Routing](#routing)
- [Theme](#theme)
- [Notifications](#notifications)
- [Storage](#storage)
- [Scheduler](#scheduler)
- [UI Components](#ui-components)
- [Animated Components (animate-ui)](#animated-components)
- [Animated Icons](#animated-icons)
- [Server (createApp)](#server)
- [Hooks Reference](#hooks-reference)
- [Full Export List](#full-export-list)

---

## Quick Start

> **Import aliases:** Use `@zero/framework/react` for app code (schema, hooks, components), and `@zero/framework/icons` for Zero's default animated icon pack. Use `@zero/framework/server` only in `app/server.ts` (for `resolveConfig`, `createApp`). Use `@app/*` for your app code. Never use relative `../../../` paths. See [Path Aliases](frontend/README.md#path-aliases) for the full list.

### 1. Define your schema

```ts
// app/lib/schemas/todo.ts
import { defineTable, field } from '@zero/framework/react';

export const todoTable = defineTable('todos', {
  title: field.text({ required: true, label: 'Title' }),
  done:  field.boolean({ label: 'Completed' }),
  priority: field.enum(['low', 'medium', 'high'] as const, { label: 'Priority' }),
});

// app/lib/schemas/index.ts — single export for both server and client
export const tables = { todos: todoTable };
```

### 2. Create the server

```ts
import { resolveConfig } from '@zero/framework/server/types';
import { tables } from './lib/schemas';

// defineTable() output is auto-detected — no .serverTable extraction needed
const config = resolveConfig({
  db: { mode: 'myapp.db' },
  tables,
  auth: true,
});
```

### 3. Wire up the client

```tsx
// app/layout.tsx
import { AppProvider } from '@zero/framework/react';
import { tables } from './lib/schemas';

// defineTable() output is auto-detected — no .clientTable extraction needed
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppProvider
      url={typeof window !== 'undefined' ? window.location.origin : ''}
      tables={tables}
      auth
      stateSync
    >
      {children}
    </AppProvider>
  );
}
```

### 4. Build features

```tsx
import { useCollection, AutoForm, DataTableView, CrudPage } from '@zero/framework/react';

function TodoApp() {
  const { data, insert, update, remove } = useCollection('todos');

  return (
    <div>
      <button onClick={() => insert({ title: 'Buy milk', done: false })}>Add</button>
      <AutoForm schema={todoTable.schema} collection="todos" />
      <DataTableView schema={todoTable.schema} collection="todos" editable={['done']} />
    </div>
  );
}

// Or skip all the wiring — CrudPage gives you a full CRUD interface from schema:
function TodoPage() {
  return (
    <CrudPage
      table="todos"
      schema={todoTable.schema}
      columns={['title', 'priority', 'done']}
    />
  );
}
```

---

## Architecture Overview

```
Browser                          Server
┌─────────────────────┐         ┌─────────────────────┐
│  AppProvider         │         │  createApp()         │
│  ├─ RouterProvider   │         │  ├─ ReactiveDB       │
│  ├─ ClientProvider   │◄──ws──►│  ├─ Auth (JWT)       │
│  ├─ NotifyProvider   │         │  ├─ Notifications    │
│  └─ SyncProvider     │         │  ├─ Storage          │
│     └─ @xstate/store │         │  ├─ State Store      │
│                      │         │  ├─ Scheduler        │
│                      │         │  └─ File Router      │
└─────────────────────┘         └─────────────────────┘
```

- **Single WebSocket** — all data, auth, state, and notifications flow through one connection
- **Optimistic mutations** — writes apply locally first, sync to server in background
- **@xstate/store** — tear-free reactive state via `useSyncExternalStore`
- **Schema-driven** — define once, get forms + tables + DB + validation
- **Real-time notifications** — server writes broadcast instantly to all clients via sync layer
- **Centralized scheduler** — any plugin can register cron jobs, admin API for visibility/control

---

## Schema Builder

Define your data model once. The schema produces valibot validation, SQL column definitions, and UI metadata.

### `field` builders

| Builder | DB Type | Description |
|---------|---------|-------------|
| `field.text(opts?)` | `text` | String field. Options: `required`, `minLength`, `maxLength`, `label`, `placeholder` |
| `field.email(opts?)` | `text` | Email-validated string |
| `field.url(opts?)` | `text` | URL-validated string |
| `field.password(opts?)` | `text` | Password with min 8 chars, hidden from tables |
| `field.number(opts?)` | `real`/`integer` | Number. Options: `min`, `max`, `integer` |
| `field.boolean(opts?)` | `integer` | Boolean stored as 0/1 |
| `field.select(options, opts?)` | `text` | Single-select from `{label, value}[]` |
| `field.multiSelect(options, opts?)` | `text` | Multi-select, stored as JSON |
| `field.enum(values, opts?)` | `text` | Like select but from string literal array |
| `field.textarea(opts?)` | `text` | Long text, renders as textarea |
| `field.date(opts?)` | `text` | ISO date string |
| `field.datetime(opts?)` | `text` | ISO timestamp |
| `field.json(opts?)` | `text` | Arbitrary JSON, renders as code textarea |
| `field.hidden(opts?)` | `text` | Not rendered in forms or tables |
| `field.tags(opts?)` | `text` | Tag/chip input, stored as JSON `string[]`. Options: `maxTags` |
| `field.combobox(options, opts?)` | `text` | Searchable dropdown. Options: `multiple`, `searchable`, `optionIcon`, `optionDescription` |
| `field.dateRange(opts?)` | `text` | Date range, stored as JSON `["start","end"]` ISO strings |

Structured field values use schema codecs. Forms and editable table cells work
with UI-native values (`boolean`, arrays, objects), while collection writes
store ReactiveDB-safe values (`0/1` booleans and JSON text for structured
`text` fields).

### Common field options

```ts
{
  label?: string;         // Display label (auto-generated from field name if omitted)
  placeholder?: string;
  description?: string;   // Help text shown below field
  required?: boolean;     // Default: false
  defaultValue?: T;
  tableVisible?: boolean; // Show in DataTable columns (default: true)
  sortable?: boolean;     // Default: true
  filterable?: boolean;   // Default: true
  columnWidth?: number;   // px hint for table column
  // Tags-specific
  maxTags?: number;       // Max number of tags allowed
  // Combobox-specific
  searchable?: boolean;   // Show search input (default: true)
  multiple?: boolean;     // Multi-select mode
  optionIcon?: boolean;   // Hint that options have icons
  optionDescription?: boolean; // Hint that options have descriptions
}
```

### `defineSchema(fields)`

Returns a `SchemaDescriptor` with:
- `schema` — valibot object schema
- `fields` — `ReadonlyMap<string, FieldMeta>`
- `fieldNames` — ordered field names
- `validate(data)` — full validation
- `getFieldSchema(name)` — per-field valibot schema
- `getDefaults()` — default values for all fields
- `decodeField(name, value)` / `encodeField(name, value)` — one field codec
- `decodeRow(row)` / `encodeRow(row)` — row-level codec helpers
- `toTableSchema()` — SQL column definitions for ReactiveDB
- `toClientTableDef()` — client table config for `createClient()`

### `defineTable(name, fields, opts?)`

Convenience wrapper:

```ts
const todoTable = defineTable('todos', {
  title: field.text({ required: true }),
  done: field.boolean(),
});

const attendanceTable = defineTable('attendance', {
  group_id: field.text({ required: true }),
  date: field.date({ required: true }),
}, { sync: 'lazy' });

// Both createApp() and AppProvider auto-detect the defineTable() output.
// No manual .serverTable or .clientTable extraction needed.
// Forms:  todoTable.schema  →  SchemaDescriptor
```

`opts.sync` accepts:

- omitted or `'auto'` — server startup resolves the table to full or lazy sync
  using `createApp({ syncDefaults })`. This is the default.
- `'full'` — always include the table in websocket snapshots. Explicit config
  wins even if the table is large; startup logs a warning.
- `'lazy'` — never include the table in websocket snapshots. Load rows on
  demand through `useLazyCollection()` or `/api/data`.

### Type inference

```ts
import type { InferRow } from '@zero/framework/react';

// Derive row types directly from a table definition — no hand-written interfaces
type Todo = InferRow<typeof todoTable>;
// { id: string; title: string; done: boolean }
```

For custom primary keys, `InferRow` uses the configured `pk`:

```ts
const accountTable = defineTable('accounts', {
  name: field.text({ required: true }),
}, { pk: 'account_id' });

type Account = InferRow<typeof accountTable>;
// { account_id: string; name: string }
```

### Natural identity for relationship tables

ReactiveDB intentionally keeps one string sync primary key per row. For tables
that would normally use a composite primary key, declare a natural identity
instead. The platform creates a deterministic sync id from those fields and
adds a unique database index for them.

```ts
export const membershipTable = defineTable('memberships', {
  team_id: field.text({ required: true }),
  user_id: field.text({ required: true }),
  role: field.enum(['member', 'admin'] as const),
}, {
  pk: 'membership_id',
  identity: ['team_id', 'user_id'],
});
```

This gives you most of the composite-key benefit without making the sync
protocol, optimistic store, or websocket payloads understand multi-column row
ids.

Rules:

- `identity` fields must be real table fields.
- The sync primary key cannot also be an identity field.
- Identity fields are immutable after insert.
- Identity values must be strings, finite numbers, or booleans.
- Duplicate identity values are rejected unless you use an identity upsert path.

Client code can insert without a primary key:

```ts
const memberships = client.collection('memberships');

memberships.insert({
  team_id: 'team-1',
  user_id: 'user-1',
  role: 'admin',
});
```

The generated `membership_id` is deterministic, so every client derives the same
sync id for `{ team_id: 'team-1', user_id: 'user-1' }`.

Use the identity helpers when the natural key is the thing your app cares about:

```ts
const key = { team_id: 'team-1', user_id: 'user-1' };

const id = memberships.identityKey(key);
const existing = memberships.getByIdentity(key);

memberships.upsertByIdentity({ ...key, role: 'admin' });
memberships.updateByIdentity(key, { role: 'member' });
memberships.deleteByIdentity(key);
```

For full-sync tables and lazy rows that have already been loaded,
`getByIdentity()`, `upsertByIdentity()`, `updateByIdentity()`, and
`deleteByIdentity()` can find rows even if older data used a non-deterministic
sync id. For rows that have not been loaded yet, the deterministic id is used.

---

## Client SDK

### `createClient(config)`

Creates the singleton SDK client. Call once at app startup. Normally created by `AppProvider` -- you rarely call this directly.

```ts
const client = createClient({
  url: 'http://localhost:3000',
  tables,                     // Single tables object — auto-extracts what it needs
  auth: true,                  // Omit or false for authless apps
  stateSync: true,
  autoConnect: true,          // default: true
  maxReconnectAttempts: 10,   // default: Infinity
  onError: (msg) => console.error(msg),
  onReconnect: () => console.log('Reconnected'),
});
```

### Client API

```ts
// ─── Auth (top-level) ──────────────────────────────────
client.user              // AuthUser | null
client.isAuthenticated   // boolean
client.token             // Current JWT
await client.login('alice', 'pass')      // → AuthUser
await client.register({ username, email, password })  // → AuthUser
await client.logout()
await client.refresh()                  // Refresh access token when auth is enabled

// ─── HTTP (JSON fetch; auth headers when auth is enabled) ─────
await client.get('/api/users')                           // → parsed JSON
await client.post('/api/users', { name: 'Alice' })       // → parsed JSON
await client.patch('/api/users/1', { role: 'admin' })    // → parsed JSON
await client.put('/api/users/1', body)                   // → parsed JSON
await client.delete('/api/users/1')                      // → parsed JSON
await client.fetch('/api/custom', { method: 'POST', body, headers })

// ─── Data ──────────────────────────────────────────────
client.collection<T>('todos')  // Get typed collection
client.state               // StateClient (null if stateSync disabled)
client.ephemeral           // EphemeralClient (shared KV, always available)

// ─── Connection ────────────────────────────────────────
client.url                 // Server URL
client.connected           // WebSocket connected?
client.connect()           // Open WebSocket when autoConnect was false
client.onConnectionChange(cb)  // Subscribe to connection state
client.disconnect()            // Tear everything down
```

`auth` defaults to false on the raw SDK client, matching `createApp()`. In
full-stack apps, `AppProvider` reads the server-injected platform config when
`auth` or `stateSync` props are omitted. Auth actions throw a clear
configuration error when auth is disabled.

When auth is enabled, sessions persist through the refresh token. The SDK keeps
the access token in memory, stores the refresh token locally, refreshes and
retries authenticated HTTP calls after an expired access-token 401, and
reconnects sync with the latest access token. If refresh is rejected, it clears
auth state plus local synced table/state data.

### FetchError

All HTTP shortcuts throw `FetchError` on non-2xx responses:

```ts
import { FetchError } from '@zero/framework/react';

try {
  await client.patch('/api/users/1', { role: 'admin' });
} catch (err) {
  if (err instanceof FetchError) {
    console.log(err.status);  // 403
    console.log(err.body);    // { error: 'Forbidden' }
    console.log(err.message); // 'Forbidden'
  }
}
```

### Collection API

```ts
const col = client.collection<Todo>('todos');

col.getAll()                    // Record<string, Todo>
col.getOne(id)                  // Todo | null
col.getMany(row => row.done)    // Todo[]
col.count()                     // number

col.insert({ title: 'Buy milk', done: false });  // Auto-generates UUID PK
col.update(id, { done: true }); // Partial update
col.remove(id);                 // Delete

// Natural-identity tables
col.identityKey({ team_id: 'team-1', user_id: 'user-1' });
col.getByIdentity({ team_id: 'team-1', user_id: 'user-1' });
col.upsertByIdentity({ team_id: 'team-1', user_id: 'user-1', role: 'admin' });
col.updateByIdentity({ team_id: 'team-1', user_id: 'user-1' }, { role: 'member' });
col.deleteByIdentity({ team_id: 'team-1', user_id: 'user-1' });

col.subscribe(rows => { ... })      // All changes
col.subscribeOne(id, row => { ... }) // Single row changes
```

All mutations are **optimistic** — they apply locally first, then sync to server via WebSocket. If the server rejects, changes roll back.

---

## Authentication

### React hooks

```tsx
function LoginPage() {
  const { user, isAuthenticated, isLoading, error, login, logout, register } = useAuth();

  if (isAuthenticated) {
    return (
      <div>
        <p>Hello, {user!.username} ({user!.role})</p>
        <button onClick={logout}>Logout</button>
      </div>
    );
  }

  return <button onClick={() => login('admin', 'pass')}>Login</button>;
}
```

### Available auth hooks

| Hook | Returns | Description |
|------|---------|-------------|
| `useAuth()` | `AuthState & AuthActions` | Full auth state + login/logout/register/refresh |
| `useAuthConfig()` | `AuthConfigState` | Public registration/bootstrap config for auth UI |
| `useCurrentUser()` | `AuthUser \| null` | Just the user object |
| `useRequireAuth(redirectTo?)` | `AuthUser \| null` | Redirects to `/login` if not authenticated |

`AppProvider` also owns the default client-side protected-route behavior when
auth is enabled. If a restored or refreshed session fails and the current path
is not public, it redirects to `loginPath` with a `redirect` query parameter.
The defaults come from `createApp()` and can be overridden with
`<AppProvider publicPaths={...} loginPath="/login" />`.

### AuthUser shape

```ts
interface AuthUser {
  userId: string;
  username: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  properties: Record<string, string>;
}
```

### Vanilla JS auth

```ts
const client = createClient({ ... });

// Top-level (recommended) — most common auth operations
await client.login('alice', 'password123');
await client.register({ username: 'bob', email: 'bob@example.com', password: 'secret' });
const authConfig = await client.getAuthConfig();
await client.forgotPassword('alice@example.com');
const action = await client.inspectActionToken('emailed-token');
await client.resetPassword('emailed-token', 'new-password123');
await client.setupPassword('emailed-token', 'first-password123');
await client.logout();
console.log(client.user);            // AuthUser | null
console.log(client.isAuthenticated); // boolean

// Additional auth operations
await client.changePassword('old', 'new');
await client.setProperty('theme', 'dark');
await client.setProperty('notificationsEnabled', false);
const theme = await client.getProperty('theme');
await client.refresh();
```

Property gates are exported from the frontend barrel for UI-only visibility:

```tsx
<PropertyGate propertyKey="department" allow={['accounting', 'management']}>
  <DepartmentTools />
</PropertyGate>
```

Use backend checks for sensitive routes or data access; property gates only
control what is rendered.

---

## Real-Time Data (Collections)

All data hooks are reactive — they re-render when data changes (from local mutations or WebSocket updates from other users).

### `useCollection(name)`

The primary mutation API. Full CRUD for a table with live updates.

```tsx
function TodoList() {
  const { data, insert, update, remove } = useCollection<Todo>('todos');

  return (
    <div>
      <p>{data.length} items</p>
      <ul>
        {data.map(todo => (
          <li key={todo.id}>
            <input
              type="checkbox"
              checked={todo.done}
              onChange={() => update(todo.id, { done: !todo.done })}
            />
            {todo.title}
            <button onClick={() => remove(todo.id)}>Delete</button>
          </li>
        ))}
      </ul>
      <button onClick={() => insert({ title: 'New todo', done: false })}>
        Add
      </button>
    </div>
  );
}
```

No need for `useClient()` + `client.collection()` -- `useCollection` is the one-stop hook for reads and writes. Auto-PK means you never need `id: crypto.randomUUID()` in insert calls.

### `useLazyCollection(name, filter?, opts?)`

Platform-level hook for resolved lazy tables, whether they were explicitly
marked `sync: 'lazy'` or auto-resolved by the server. Handles loading, error,
and refresh automatically.

```tsx
function ClientNotes({ clientId }: { clientId: string }) {
  const { data, isLoading, error, refresh } = useLazyCollection('session_notes', {
    client_id: clientId,
  }, {
    order: 'created_at',
    dir: 'desc',
    limit: 50,
  });

  if (isLoading) return <p>Loading...</p>;
  if (error) return <p>Error: {error.message}</p>;

  return <ul>{data.map(n => <li key={n.id}>{n.content}</li>)}</ul>;
}
```

The filter format is `Record<string, string>` (object), not tuple arrays. The platform auto-registers `GET /api/data` for lazy tables, so you do not need to create manual REST endpoints.

`opts` supports:

| Option | Description |
|--------|-------------|
| `order` | Column to sort by |
| `dir` | `asc` or `desc`; backend default is `desc` when `order` is present |
| `limit` | Max rows to fetch; backend caps the result |
| `offset` | Rows to skip for offset pagination |

### `useRow(name, id)`

Subscribe to a single row.

```tsx
function TodoDetail({ id }: { id: string }) {
  const todo = useRow<Todo>('todos', id);
  if (!todo) return <p>Not found</p>;
  return <h1>{todo.title}</h1>;
}
```

### `useQuery(name, predicate)`

Filtered reactive list.

```tsx
function CompletedTodos() {
  const done = useQuery<Todo>('todos', t => t.done === true);
  return <ul>{done.map(t => <li key={t.id}>{t.title}</li>)}</ul>;
}
```

---

## CrudPage

Full CRUD interface generated from a schema. Two layout modes.

### Table layout (default)

```tsx
import { CrudPage } from '@zero/framework/react';

function ClientsPage() {
  return (
    <CrudPage
      table="clients"
      schema={clientTable.schema}
      columns={['first_name', 'last_name', 'email', 'status']}
    />
  );
}
```

Renders a `DataTable` with create/edit modals powered by `AutoForm`. Sorting, filtering, pagination, inline editing included.

`CrudPage` reads `schema.primaryKey`, so tables defined with
`defineTable(..., { pk: 'account_id' })` update and delete by `account_id`
instead of assuming `id`. Create flows generate that primary key before the
optimistic insert, and edit flows strip the primary key from update partials.

### Master-detail layout

```tsx
<CrudPage
  table="clients"
  schema={clientTable.schema}
  columns={['first_name', 'last_name', 'status']}
  layout="master-detail"
  detailHeader={({ item }) => <ClientAvatar client={item} />}
  detailFooter={(client) => client && <ClientNotes clientId={client.id} />}
  navigationActions={(client) => client ? [
    { label: 'Message', icon: <Mail />, onClick: () => openChat(client) },
  ] : []}
  primaryAction={{ label: 'New Client', onClick: openCreateModal }}
/>
```

Split-panel: list on the left, detail/edit on the right. Click a row, the detail panel loads.

### Standalone master-detail view

Use `MasterDetailView` when you want the same list/detail organism without the
full CRUD wrapper. `MasterDetailPage` remains as a backwards-compatible alias.
See [docs/frontend/master-detail.md](./frontend/master-detail.md) for the full
organism guide and the lower-level detail primitives.

```tsx
import { MasterDetailView } from '@zero/framework/react';

<MasterDetailView
  schema={clientTable.schema}
  collection="clients"
  listColumns={['first_name', 'last_name', 'status']}
  editableFields={['first_name', 'last_name', 'status', 'notes']}
  detailHeader={({ item }) => <ClientAvatar client={item} />}
  navigationActions={(client) => client ? [
    { label: 'Archive', icon: <Archive />, onClick: () => archiveClient(client) },
  ] : []}
/>
```

For full-sync tables, `collection` subscribes through the reactive DB and
auto-wires generated detail-form updates back to the collection. For lazy
tables or external sources, pass `data` and `onUpdate`.

```tsx
const clients = useLazyCollection<Client>('clients', { status: 'active' });

<MasterDetailView
  schema={clientTable.schema}
  data={clients.data}
  listColumns={['first_name', 'last_name', 'status']}
  selectedId={selectedClientId}
  onSelectedIdChange={(id) => setSelectedClientId(id)}
  onUpdate={(id, changes) => clients.update(id, changes)}
  renderDetail={(client, ctx) => (
    <ClientProfile client={client} onSave={ctx.update} />
  )}
/>
```

### Lazy tables

```tsx
<CrudPage
  table="clients"
  schema={clientTable.schema}
  columns={['first_name', 'last_name']}
  lazy
/>
```

When `lazy` is set, `CrudPage` uses the platform's auto `/api/data` endpoint
for initial data loading. Loading and error states are rendered by the page;
late responses from older filter/order requests are ignored.

---

## Lazy Sync (Large Tables)

By default, omitted table sync mode is `auto`: startup counts rows and keeps
small tables in full sync, then auto-resolves oversized tables to lazy sync.
Explicit `sync: 'full'` and `sync: 'lazy'` always win. Auto decisions are saved
in the app database so a table does not flip back and forth between modes.

### Declaring a lazy table

You can still pin a table as lazy in `defineTable`:

```ts
import { defineTable, field } from '@zero/framework/react';

export const attendanceTable = defineTable('attendance', {
  group_id: field.text({ required: true }),
  date: field.date({ required: true }),
  present: field.boolean(),
}, { sync: 'lazy' });
```

### Loading data on demand

The platform auto-registers `GET /api/data` for lazy tables. Use the `useLazyCollection` hook:

```tsx
const { data, isLoading, refresh } = useLazyCollection(
  'attendance',
  { group_id: 'abc' },
  { order: 'date', dir: 'desc', limit: 50 }
);
```

Or load manually via the collection API:

```ts
const col = client.collection<Attendance>('attendance');
const { rows, page } = await client.get<{
  rows: Attendance[];
  page: { limit: number; offset: number; count: number; hasMore: boolean; nextOffset: number | null };
}>('/api/data?table=attendance&filter=group_id:abc&order=date&dir=desc&limit=50');
col.load(rows);
```

`/api/data` filter parameters are repeatable and ANDed together:

```text
filter=field:value          # equality, kept for the simple/common case
filter=field:eq:value
filter=field:ne:value
filter=field:gt:value
filter=field:gte:value
filter=field:lt:value
filter=field:lte:value
filter=field:like:value     # raw SQLite LIKE pattern
filter=field:contains:value # escaped contains search
filter=field:in:a,b,c       # up to 50 values
```

The endpoint validates table names and columns against the app schema, uses
parameterized values, caps result size, and enforces the same sync read policy
used by WebSocket subscriptions. When a lazy table is registered with
`defineResource()`, `/api/data` also enforces that resource's `list` policy and
adds safe owner constraints to the SQL query. For large lazy tables, add SQLite
indexes in migrations for columns you filter, sort, or constrain by frequently.

For registered resources, unconstrained `list` policy uses the normal full-sync
fast path. Owner-only or otherwise row-constrained resource lists use
per-connection row filters for snapshots, catchup, and live changes.

### Load options

```ts
const col = client.collection('attendance');

col.load(records);                      // Merge/upsert with existing rows
col.load(records, { replace: true });   // Replace ALL rows with these
col.clear();                            // Empty the local store (no server delete)
```

### How live changes work with lazy tables

Lazy tables still subscribe to WebSocket change events. When another user inserts, updates, or deletes a row:

- **INSERT:** The new row appears in the local store (and in any reactive hooks watching this table)
- **UPDATE:** If the row is already in the local store, it updates. If not, it's ignored.
- **DELETE:** If the row is in the local store, it's removed. If not, it's ignored.

This means: once you `load()` an authorized set of rows, those rows stay live.
For row-constrained resource tables, sync changes are filtered per connection;
when an update moves a row out of scope, the client receives a delete for that
row.

---

## Server State Sync

Per-user key-value state, persisted on the server and synced across devices.

```tsx
function Sidebar() {
  const [open, setOpen] = useServerState('sidebar.open', true);
  return <button onClick={() => setOpen(!open)}>{open ? 'Close' : 'Open'}</button>;
}
```

Like `useState`, but:
- Persisted on server
- Synced across devices/tabs
- Survives page refresh
- Optimistic (instant local update, background sync)

**Requires** `stateSync: true` and `auth: true` in AppProvider/createClient config, plus `auth: true` in the server config. In full-stack apps, omitted `AppProvider` props are filled from the server-injected platform config. Server-persisted state is keyed by authenticated user.

```tsx
const ready = useServerStateReady(); // true once initial state loaded from server
```

---

## Forms

### `<AutoForm>`

Schema-driven form. Zero manual field wiring.

```tsx
<AutoForm
  schema={todos.schema}
  collection="todos"
  mode="create"
  layout="vertical"    // 'vertical' | 'horizontal' | 'inline'
  columns={2}          // CSS grid columns
  card={{ title: 'New Todo', description: 'Create a new item' }}
  fields={{
    title: { autoFocus: true },
    notes: { hidden: true },
  }}
  submitLabel="Create"
  showReset
  onSuccess={() => console.log('Created!')}
  onError={(msg) => console.error(msg)}
/>
```

### `useForm(options)`

Headless form hook for custom layouts.

```tsx
function CustomForm() {
  const form = useForm<Todo>({
    schema: todos.schema,
    collection: 'todos',
    mode: 'create',
    onSuccess: () => alert('Done!'),
  });

  return (
    <form onSubmit={form.handleSubmit}>
      <input {...form.register('title')} />
      {form.errors.title && <span>{form.errors.title}</span>}

      <label>
        <input type="checkbox" {...form.register('done')} />
        Done
      </label>

      <button type="submit" disabled={form.isSubmitting}>
        {form.isSubmitting ? 'Saving...' : 'Save'}
      </button>
    </form>
  );
}
```

**Edit mode** — loads existing data from collection:

```tsx
const form = useForm<Todo>({
  schema: todos.schema,
  collection: 'todos',
  mode: 'edit',
  editId: 'abc-123',
});
```

### `<FieldRenderer>`

Renders a single field based on schema metadata. Used internally by AutoForm, but available for custom layouts.

```tsx
<FieldRenderer
  name="title"
  meta={schema.fields.get('title')!}
  registration={form.register('title')}
  overrides={{ autoFocus: true }}
/>
```

---

## Data Table

### `<DataTableView>` / `<DataTable>`

Schema-aware table organism built on TanStack Table. `DataTableView` is the
preferred organism name; `DataTable` remains as the backwards-compatible alias.
See [docs/frontend/data-table.md](./frontend/data-table.md) for the full source,
toolbar, editing, and override guide.

```tsx
<DataTableView
  schema={todos.schema}
  collection="todos"          // Live-updating from collection
  columns={['title', 'priority', 'done']}
  primaryKey="id"             // Optional override; defaults to schema.primaryKey
  editable={['title', 'priority', 'done']}
  actions={[
    { label: 'Delete', icon: Trash2, onClick: (row) => remove(row.todo_id), variant: 'destructive' },
    { label: 'Edit', icon: Pencil, onClick: (row) => push(`/todos/${row.todo_id}`) },
  ]}
  searchable            // Global search bar
  sortable              // Column header sorting
  filterable            // Per-column filters
  paginated={{ pageSize: 20 }}
  selectable            // Checkbox column
  onSelectionChange={(ids) => console.log('Selected:', ids)}
  onCellEdit={(rowId, col, val) => console.log('Edited:', rowId, col, val)}
  showToolbar            // Force toolbar rendering for actions/export/columns only
  exportFilename="todos.csv"
/>
```

Row IDs, selection IDs, inline-edit IDs, and highlighted rows all use
`schema.primaryKey` unless `primaryKey` is provided.

#### Data sources

Full-sync table:

```tsx
<DataTableView schema={todoTable.schema} collection="todos" />
```

Lazy `/api/data` table:

```tsx
<DataTableView
  schema={auditLogTable.schema}
  source={{
    type: 'lazy',
    table: 'audit_log',
    filters: { user_id: currentUser.userId },
    options: { order: 'created_at', dir: 'desc', limit: 100 },
  }}
/>
```

Caller-owned rows:

```tsx
<DataTableView
  schema={reportSchema}
  data={rows}
  onCellEdit={(id, field, value) => saveCell(id, field, value)}
/>
```

Custom data source with mutation actions:

```tsx
<DataTableView
  schema={reportSchema}
  source={{
    type: 'data',
    data: rows,
    isLoading,
    error,
    refresh,
    actions: {
      update: (id, changes) => saveRow(id, changes),
    },
  }}
  editable={['status']}
/>
```

Toolbar behavior:

- `searchable` or `filterable` renders the toolbar automatically.
- `toolbarActions` also renders the toolbar so custom controls are not hidden.
- Set `showToolbar` when an app only wants built-in export or column visibility controls.
- Set `showExport={false}` or `showColumnVisibility={false}` to hide those default controls.

#### Column overrides

Use `columnOverrides` when schema defaults are close but a column needs custom
rendering or behavior.

```tsx
<DataTableView
  schema={clientTable.schema}
  collection="clients"
  columns={['name', 'status', 'last_contacted_at']}
  columnOverrides={{
    status: {
      header: 'Status',
      width: 140,
      cell: ({ value }) => <StatusBadge status={String(value)} />,
    },
    last_contacted_at: {
      header: 'Last Contact',
      sortable: true,
      filterable: false,
    },
  }}
/>
```

Editable cells decode values for display/editing and encode the changed field
before calling collection updates. For example, a `field.tags()` cell edits a
`string[]` but stores JSON text in the row.

**Features:**
- **Inline editing** — click a cell to edit, Enter to save, Escape to cancel, Tab to move
- **Full-sync source** — `collection="table"` subscribes through the reactive DB
- **Lazy source** — `source={{ type: 'lazy', table }}` fetches `/api/data`, then stays live for loaded rows
- **Caller-owned source** — `data` or `source={{ type: 'data' }}` for external backends
- **Generated filters** — `filterable` renders field-aware inputs for schema columns
- **Real-time cell flash** — when another user changes a value, the cell briefly highlights blue
- **Row animations** — new rows slide in, deleted rows fade out (via AnimatePresence)
- **CSV export** — built into toolbar
- **Column visibility** — toggle columns from dropdown menu

### Sub-components

Available for composing custom table layouts:

| Component | Description |
|-----------|-------------|
| `DataTableColumnHeader` | Sortable column header with sort indicator |
| `DataTableToolbar` | Search, filter badges, column visibility, CSV export |
| `DataTablePagination` | Page controls, rows-per-page selector |
| `DataTableRowActions` | Per-row action dropdown menu |
| `AnimatedCell` | Cell wrapper that flashes on value change |
| `EditableCell` | Cell with inline edit mode |

### `useDataTable(options)`

Headless hook for full table state control. Pass `primaryKey` to override
`schema.primaryKey` when adapting legacy data.

---

## Routing

File-based routing with SSR support. Routes are registered from `pages/` directory.

### Hooks

| Hook | Returns | Description |
|------|---------|-------------|
| `useParams()` | `Record<string, string>` | URL parameters (e.g., `/todos/:id` → `{ id: '123' }`) |
| `usePathname()` | `string` | Current URL pathname |
| `useRouter()` | `{ push, replace, go, back, forward }` | Navigation methods |

### `<Link>`

Client-side navigation link.

```tsx
<Link href="/todos">All Todos</Link>
<Link href={`/todos/${todo.id}`}>Edit</Link>
```

### Advanced router API

```ts
import { registerRoute, matchClientRoute, navigateTo, prefetchRoute } from '@zero/framework/react';

registerRoute('/custom', { default: CustomPage, loader: myLoader });
navigateTo('/custom');
prefetchRoute('/custom');
```

---

## Theme

### `<ThemeProvider>`

Wraps your app with dark/light/system theme support (via next-themes). Zero's
platform stylesheet is built and linked by `createApp()`, and the default theme
follows the user's system preference unless overridden.

```tsx
<ThemeProvider defaultTheme="system" storageKey="my-app-theme">
  <App />
</ThemeProvider>
```

The platform stylesheet defines the shared UI token contract used by base
components and Animate UI wrappers: `background`, `card`, `popover`, `muted`,
`accent`, `input`, `border`, `ring`, and semantic state colors. Apps can
retheme by overriding those CSS variables, while keeping component classes on
tokens instead of one-off color literals.

Core cards and overlays are designed around an 8px-or-smaller radius scale,
subtle borders, and restrained shadows. When changing reusable UI primitives,
verify both light and dark mode with a screenshot pass.

### `<ThemeTogglerButton>`

Animated button that cycles through light → dark → system.

```tsx
<ThemeTogglerButton variant="ghost" size="icon" />
```

---

## Notifications

Real-time notification system with rich targeting, read receipts, and auto-toast. Notifications flow through the existing reactive sync layer — zero extra infrastructure.

### Server Setup

```ts
import { createSchedulerPlugin } from './scheduler';
import { createNotificationPlugin } from './notifications';

// Mount scheduler first (notifications register a cleanup job)
app.use(createSchedulerPlugin());
app.use(createNotificationPlugin({ db }));
```

### Client Setup

```ts
import { createClient } from '@zero/framework/react';

const client = createClient({
  url: 'http://localhost:3000',
  tables: myTables,
});
```

```tsx
import { AppProvider, NotificationProvider, Toaster } from '@zero/framework/react';

<AppProvider url="http://localhost:3000" tables={myTables} auth>
  <NotificationProvider>
    <Toaster />
    <App />
  </NotificationProvider>
</AppProvider>
```

### Sending Notifications (Server)

```ts
import { getNotificationService } from './notifications';

const notifier = getNotificationService()!;

// Broadcast to everyone
notifier.broadcast({ title: 'Server maintenance at 2am' });

// Single user
notifier.notify('u_abc', { title: 'Your report is ready', actionUrl: '/reports/123' });

// Multiple users
notifier.notifyUsers(['u_abc', 'u_def'], { title: 'Team meeting in 5m', priority: 'high' });

// All users with a specific role
notifier.notifyRole('admin', { title: 'New user registered', type: 'info' });
```

#### `CreateNotificationParams`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `title` | `string` | *required* | Notification title |
| `body` | `string` | — | Optional body text |
| `type` | `'info' \| 'warning' \| 'success' \| 'error' \| 'system'` | `'info'` | Notification type |
| `priority` | `'low' \| 'normal' \| 'high' \| 'urgent'` | `'normal'` | Priority level |
| `actionUrl` | `string` | — | URL to navigate on click |
| `metadata` | `Record<string, unknown>` | — | Arbitrary extra data (JSON-serialized) |
| `expiresAt` | `number` | — | Unix ms timestamp for auto-cleanup |

### Hooks

#### `useNotifications()`

Full notification state + actions for the current user. Automatically filters by target (user, role, broadcast) and excludes dismissed.

```tsx
function NotificationList() {
  const {
    notifications,    // NotificationWithStatus[] — sorted by created_at DESC
    unreadCount,      // number
    unseenCount,      // number
    markSeen,         // (notificationId: string) => void
    markRead,         // (notificationId: string) => void
    dismiss,          // (notificationId: string) => void
    markAllRead,      // () => void
    markAllSeen,      // () => void
  } = useNotifications();

  return (
    <ul>
      {notifications.map(n => (
        <li key={n.notification_id} onClick={() => markRead(n.notification_id)}>
          {!n.read && <span>NEW</span>}
          <strong>{n.title}</strong>
          <p>{n.body}</p>
          <button onClick={() => dismiss(n.notification_id)}>X</button>
        </li>
      ))}
    </ul>
  );
}
```

#### `useUnreadCount()`

Lightweight hook for badge — just the unread count.

```tsx
<Badge>{useUnreadCount()}</Badge>
```

#### `useOnNewNotification(callback)`

Fires when a new notification arrives for this user. Uses deduplication to prevent re-firing on reconnect/remount.

```tsx
useOnNewNotification((n) => {
  console.log('New notification:', n.title);
  // Play sound, show custom UI, etc.
});
```

#### `useNotificationContext()`

Access notification state from context (must be inside `<NotificationProvider>`). Same return shape as `useNotifications()`.

```tsx
const { unreadCount, markAllRead } = useNotificationContext();
```

### `<NotificationProvider>`

Wraps children with notification context and optionally fires Sonner toasts for new notifications.

```tsx
<NotificationProvider
  autoToast={true}       // Fire toast on new notification (default: true)
  toastDuration={5000}   // Toast duration ms (default: 5000)
  renderToast={(n) => `${n.title}: ${n.body}`}  // Custom toast content
>
  <App />
</NotificationProvider>
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `autoToast` | `boolean` | `true` | Show Sonner toast on new notification |
| `toastDuration` | `number` | `5000` | Toast display duration (ms) |
| `renderToast` | `(n: Notification) => ReactNode` | — | Custom toast renderer. Return `null` to suppress. |

### Platform Tables

The frontend SDK automatically merges notification, room, workflow, and storage
tables into each client. App code should pass only its app tables to
`createClient()` or `AppProvider`.

### Receipt System

Receipts track per-user notification state. Client actions call authenticated notification routes; the service writes `notification_receipts` through ReactiveDB, and the receipt changes broadcast back over sync in real time.

| State | Meaning | Trigger |
|-------|---------|---------|
| No receipt | Unseen + unread | Default |
| `seen_at` set | Appeared in user's view | `markSeen()` or `markAllSeen()` |
| `read_at` set | User clicked/interacted | `markRead()` or `markAllRead()` |
| `dismissed_at` set | Explicitly dismissed | `dismiss()` |

Receipt IDs are deterministic (`r_{notificationId}_{userId}`) so service-side upserts are idempotent. Direct client `sync.mutate` writes to notification tables are blocked by the platform sync policy.

### REST API

All routes prefixed with `/notifications`. Auth middleware required.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/` | user | List notifications for current user |
| `GET` | `/unread-count` | user | Get unread count |
| `POST` | `/` | admin | Create notification (body includes target) |
| `POST` | `/broadcast` | admin | Broadcast to all users |
| `POST` | `/notify/:userId` | admin | Notify single user |
| `POST` | `/notify-role/:role` | admin | Notify all users with role |
| `GET` | `/:id` | user | Get single notification |
| `POST` | `/:id/seen` | user | Mark seen |
| `POST` | `/:id/read` | user | Mark read |
| `POST` | `/:id/dismiss` | user | Dismiss |
| `POST` | `/read-all` | user | Mark all read |
| `POST` | `/seen-all` | user | Mark all seen |
| `GET` | `/:id/receipts` | admin | Receipt audit trail |
| `DELETE` | `/:id` | admin | Delete notification |

### Data Flow

```
Server:  notifier.notify('u_abc', { title: 'Report ready' })
  → db.insert('notifications', ...)
  → ReactiveDB onChange → sync pub/sub → all WS clients
  → SyncClient store update → useCollection re-render
  → useNotifications() filters by target match
  → NotificationProvider detects new → toast('Report ready')
  → User clicks → markRead() → POST /notifications/:id/read
  → NotificationService updates receipt → sync broadcast
  → Admin: getReceipts(id) shows who read in real-time
```

---

## Storage

Authenticated file storage with drive metadata in ReactiveDB and blob bytes
behind a storage adapter. Local filesystem storage is the default adapter.

Storage metadata tables are registered as platform tables, so clients can read
drive/object metadata through sync, but direct `sync.mutate` writes to
`storage_drives` and `storage_objects` are blocked by the platform sync policy.
Use the storage HTTP routes for all writes so auth and permission checks run.

### Hooks

```tsx
const { drives } = useStorageDrives();
const { items, refresh } = useStorageFolder(driveId, '/reports');
const { upload, progress } = useUpload();
const actions = useStorageActions();

await actions.createDrive('Reports', { public: false });
await upload(driveId, file, { path: '/reports/q2.pdf', overwrite: true });
```

Storage hooks use the SDK client for authenticated transport. JSON routes call
`client.fetch()`, so Authorization headers and 401 refresh behavior match the
rest of the frontend SDK. Uploads still use `XMLHttpRequest` for progress
events, but they read the SDK client's in-memory access token and retry once
after `client.refresh()` if the server returns 401.

### Server Service API

Backend code can use the grouped storage service when it owns the authorization
context:

```ts
import { getStorageService } from '@zero/framework/server';

const storage = getStorageService();
if (!storage) throw new Error('Storage is not enabled.');

const drive = storage.drives.create(user.userId, { name: 'Reports' });
storage.objects.createFolder(drive.drive_id, '/q2', user.userId);
storage.permissions.grant(drive.drive_id, {
  grantType: 'role',
  grantValue: 'manager',
  permission: 'read',
});
```

The older method names such as `createDrive()`, `listFolder()`, and
`grantPermission()` remain supported.

### Storage Management Component

For admin or owner dashboards, Zero exports an embeddable storage organism:

```tsx
import { StorageManagement } from '@zero/framework/react';

function FilesPanel() {
  return <StorageManagement className="h-[42rem]" />;
}
```

`StorageManagement` composes smaller drive-list, file-browser, drive-header,
and file-detail components. It uses the storage hooks above, so it must be
rendered inside `AppProvider` or `ClientProvider`.

### REST API

All routes are prefixed with `/storage`.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/drives` | optional | List current user's drives, or public drives when anonymous |
| `POST` | `/drives` | user | Create a drive |
| `GET` | `/drives/:driveId` | optional | Get public drive info, or private drive info for an authorized user |
| `PATCH` | `/drives/:driveId` | owner/admin | Update drive settings |
| `DELETE` | `/drives/:driveId` | owner/admin | Delete a drive |
| `GET` | `/drives/:driveId/usage` | read | Drive usage stats |
| `POST` | `/drives/:driveId/upload` | write | Multipart file upload |
| `GET` | `/drives/:driveId/files/*` | read/public | Download file, with Range and ETag support |
| `GET` | `/drives/:driveId/list` | read | List folder contents |
| `POST` | `/drives/:driveId/folders` | write | Create folder |
| `POST` | `/drives/:driveId/move` | write | Move or rename file/folder |
| `POST` | `/drives/:driveId/copy` | write | Copy a file |
| `DELETE` | `/drives/:driveId/files/*` | write | Delete file/folder |
| `PATCH` | `/drives/:driveId/visibility` | owner/admin | Change drive or object visibility |
| `POST` | `/drives/:driveId/permissions` | admin | Grant drive/object permission |
| `DELETE` | `/permissions/:permissionId` | admin | Revoke permission |
| `POST` | `/drives/:driveId/presign` | read/write | Create a presigned URL |
| `GET` | `/presigned/:token` | token | Presigned download |
| `PUT` | `/presigned/:token` | token | Presigned upload |
| `GET` | `/drives/:driveId/info/*` | read/public | Get file/folder metadata |

### Standalone Server Mount

`createApp()` wires storage automatically. If you mount storage yourself, mount
auth first; the storage plugin declares `createAuthMiddleware(getTokenService)`
internally so route handlers have typed `authContext` and `requireAuth()`.

```ts
import { Elysia } from 'elysia';
import {
  createAuthPlugin,
  createStoragePlugin,
} from '@zero/framework/server';

new Elysia()
  .use(createAuthPlugin({ db }))
  .use(createStoragePlugin({ db, localDir: '.storage' }));
```

---

## Scheduler

Generic centralized scheduler using `croner`. Any plugin can register cron jobs. Admin API for visibility and control.

### Server Setup

```ts
import { createSchedulerPlugin } from '@zero/framework/server';

// Mount early (before plugins that register jobs)
app.use(createSchedulerPlugin());
// OR with custom prefix:
app.use(createSchedulerPlugin({ prefix: '/admin/scheduler' }));
```

### Registering Jobs

```ts
import { getScheduler } from '@zero/framework/server';

const scheduler = getScheduler()!;

scheduler.create({
  name: 'cleanup-expired-sessions',
  pattern: '0 */15 * * * *',   // every 15 minutes (6-field cron with seconds)
  run: () => sessionStore.deleteExpired(),
});

scheduler.create({
  name: 'daily-report',
  pattern: '0 0 9 * * *',      // 9:00 AM daily
  run: async () => {
    await generateReport();
    notifier.notifyRole('admin', { title: 'Daily report ready' });
  },
  timezone: 'America/New_York',
});

scheduler.create({
  name: 'manual-only-job',
  pattern: '0 0 * * * *',
  run: () => doWork(),
  paused: true,    // Only runs when triggered via API
});
```

### `JobDefinition`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | `string` | *required* | Unique job identifier |
| `pattern` | `string` | *required* | 6-field cron expression (seconds supported) or `@daily`/`@hourly` |
| `run` | `() => void \| Promise<void>` | *required* | The work to execute |
| `timezone` | `string` | system | IANA timezone |
| `paused` | `boolean` | `false` | Start paused — must be resumed manually |
| `protect` | `boolean` | `true` | Prevent overlapping runs |
| `catchErrors` | `boolean` | `true` | Catch errors instead of crashing |

### Service API

```ts
const scheduler = getScheduler()!;

scheduler.create(def)            // Register new job
scheduler.delete('name')         // Stop + remove job → boolean
scheduler.pause('name')          // Pause → boolean
scheduler.resume('name')         // Resume → boolean
scheduler.run('name')            // Run immediately → boolean
scheduler.has('name')            // Check if registered → boolean
scheduler.get('name')            // Single job status → JobStatus | null
scheduler.list()                 // All jobs → JobStatus[]
scheduler.stop()                 // Stop everything (called on shutdown)
```

Compatibility aliases remain supported: `register()`, `unregister()`,
`trigger()`, `getStatus()`, `listJobs()`, and `stopAll()`.

### `JobStatus`

```ts
interface JobStatus {
  name: string;
  pattern: string;
  running: boolean;      // Currently scheduled and active
  paused: boolean;       // Paused (not running, not stopped)
  stopped: boolean;      // Permanently stopped
  busy: boolean;         // Currently executing
  nextRun: string | null;      // ISO timestamp
  previousRun: string | null;  // ISO timestamp
}
```

### Admin REST API

All routes prefixed with `/scheduler` (configurable). Admin auth required.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | List all registered jobs |
| `GET` | `/:name` | Get single job status |
| `POST` | `/:name/pause` | Pause a job |
| `POST` | `/:name/resume` | Resume a paused job |
| `POST` | `/:name/trigger` | Trigger job immediately |

### Built-in Jobs

The notification plugin automatically registers a cleanup job:

| Job Name | Pattern | Description |
|----------|---------|-------------|
| `notification-cleanup` | `0 0 * * * *` (hourly) | Deletes expired notifications (`expires_at < now`) |

---

## UI Components

All base components are exported from `@zero/framework/react`. They follow the
shadcn pattern: composable, `data-slot` attributes, Tailwind styling, `cn()` for
className merging, and tokenized light/dark/system surfaces. Buttons, inputs,
selects, tables, badges, cards, dialogs, popovers, dropdowns, and tabs share
the same radius, border, focus-ring, and surface vocabulary.

### Layout & Container

| Component | Description |
|-----------|-------------|
| `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter` | Card container with semantic sections |
| `ScrollArea`, `ScrollBar` | Custom scrollable container |
| `Separator` | Horizontal/vertical divider |
| `Skeleton` | Loading placeholder with pulse animation |

### Inputs

| Component | Description |
|-----------|-------------|
| `Button`, `buttonVariants` | Primary, secondary, ghost, outline, destructive, link variants |
| `Input` | Text input with focus ring |
| `Textarea` | Multi-line text input |
| `Label` | Form label (Radix) |
| `Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem`, `SelectGroup`, `SelectLabel`, `SelectSeparator` | Full dropdown select |
| `Calendar` | Standalone calendar display (react-day-picker). Supports single, multi, and range modes. |
| `DatePicker` | Date input + animated Popover + Calendar. Props: `value?: Date`, `onChange?`, `placeholder?`, `disabled?`, `transition?` |
| `DateRangePicker` | Range variant with two months. Props: `value?: DateRange`, `onChange?`. Auto-closes on complete range. |
| `Combobox` | Searchable select with cmdk. Props: `options: ComboboxOption[]`, `multiple?`, `searchable?`, `placeholder?`. Supports icons, groups, descriptions, multi-select with animated tag chips. |
| `TagInput` | Chip-based tag input with keyboard support. Props: `value?: string[]`, `onChange?`, `maxTags?`, `allowDuplicates?`, `delimiter?`, `suggestions?`, `onSearch?`. Animated add/remove (spring 300/25). |
| `Command`, `CommandDialog`, `CommandInput`, `CommandList`, `CommandEmpty`, `CommandGroup`, `CommandItem`, `CommandSeparator`, `CommandShortcut` | cmdk-based command palette. `CommandDialog` uses animated Dialog (Pattern B: 3D flip). |

### Data Display

| Component | Description |
|-----------|-------------|
| `Badge`, `badgeVariants` | Status tags: default, secondary, destructive, outline |
| `Avatar`, `AvatarImage`, `AvatarFallback` | User avatar with image/initials fallback |
| `Table`, `TableHeader`, `TableBody`, `TableFooter`, `TableRow`, `TableHead`, `TableCell`, `TableCaption` | Semantic HTML table |
| `Pagination`, `PaginationContent`, `PaginationItem`, `PaginationLink`, `PaginationPrevious`, `PaginationNext`, `PaginationEllipsis` | Pagination controls |

### Form Layout

| Component | Description |
|-----------|-------------|
| `FormField` | Field wrapper with context (name, error) |
| `FormLabel` | Label connected to FormField |
| `FormControl` | Injects aria attributes into child input |
| `FormDescription` | Help text below field |
| `FormMessage` | Error message from validation |

### Feedback

| Component | Description |
|-----------|-------------|
| `Toaster` | Theme-aware toast notification container (via Sonner) |
| `toast()` | Trigger toast: `toast('Saved!')`, `toast.error('Failed')`, `toast.success('Done')` |
| `NotificationProvider` | Auto-fires toasts for new persistent notifications (see [Notifications](#notifications)) |

### Notification UI

Modular notification components that compose together. Use individually or via `NotificationCenter`.

| Component | Description |
|-----------|-------------|
| `NotificationBadge` | Animated counter overlay. Props: `count?`, `max?` (99), `dot?`, `variant?` ('default'\|'destructive'\|'warning'\|'success'), `pulse?`, `position?`. Wraps children. |
| `NotificationItem` | Single notification row with type-colored border, icon/avatar, title, body, relative time, unread dot, dismiss button. Types: 'info'\|'warning'\|'success'\|'error'\|'system'. Animated enter/exit. |
| `NotificationList` | Scrollable list of `NotificationItem`s. Groups by day (Today/Yesterday/Earlier). Empty state with inbox icon. Props: `items`, `maxHeight?`, `grouped?`, `emptyMessage?`. |
| `NotificationDropdown` | Popover containing header (title, count, mark-all-read, settings buttons), `NotificationList`, optional footer. Pattern C animation (spring 300/25). Props: `children` (trigger), `items`, `width?`, `align?`. |
| `NotificationCenter` | Drop-in composed component: Bell icon + animated badge + dropdown. Props: `items`, `onMarkAllRead?`, `onOpen?`, `onItemClick?`, `onItemRead?`, `onItemDismiss?`, `footer?`, `trigger?`, `buttonVariant?`, `badgeVariant?`, `badgePulse?`. |

```tsx
// Minimal usage — one component in your header
<NotificationCenter
  items={notifications}
  onMarkAllRead={markAllRead}
  onItemRead={markRead}
  onItemDismiss={dismiss}
  onOpen={markAllSeen}
  footer={<Link to="/notifications">View all</Link>}
/>

// Or compose from atoms
<NotificationDropdown items={items} onItemDismiss={dismiss}>
  <Button variant="ghost" size="icon">
    <NotificationBadge count={3} variant="destructive">
      <BellIcon />
    </NotificationBadge>
  </Button>
</NotificationDropdown>

// Just the badge on anything
<NotificationBadge count={unreadCount} pulse>
  <InboxIcon />
</NotificationBadge>
```

---

## Animated Components

From the [animate-ui](https://animate-ui.com) library. Import directly from component paths.

### Radix Components (Animated)

Animated wrappers around Radix UI primitives. All include enter/exit transitions.

```tsx
import { Dialog, DialogContent, DialogTrigger } from '@/components/animate-ui/components/radix/dialog';
```

| Component | Sub-exports |
|-----------|-------------|
| **Accordion** | `Accordion`, `AccordionItem`, `AccordionTrigger`, `AccordionContent` |
| **AlertDialog** | `AlertDialog`, `AlertDialogTrigger`, `AlertDialogContent`, `AlertDialogHeader`, `AlertDialogFooter`, `AlertDialogTitle`, `AlertDialogDescription`, `AlertDialogAction`, `AlertDialogCancel` |
| **Checkbox** | `Checkbox` (animated check indicator) |
| **Dialog** | `Dialog`, `DialogTrigger`, `DialogClose`, `DialogContent`, `DialogHeader`, `DialogFooter`, `DialogTitle`, `DialogDescription` |
| **DropdownMenu** | `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuGroup`, `DropdownMenuItem`, `DropdownMenuCheckboxItem`, `DropdownMenuRadioGroup`, `DropdownMenuRadioItem`, `DropdownMenuLabel`, `DropdownMenuSeparator`, `DropdownMenuShortcut`, `DropdownMenuSub`, `DropdownMenuSubTrigger`, `DropdownMenuSubContent` |
| **Files** | `Files`, `FolderItem`, `FolderTrigger`, `FolderContent`, `FileItem`, `SubFiles` |
| **HoverCard** | `HoverCard`, `HoverCardTrigger`, `HoverCardContent` |
| **Popover** | `Popover`, `PopoverTrigger`, `PopoverContent`, `PopoverClose` |
| **PreviewLinkCard** | `PreviewLinkCard`, `PreviewLinkCardTrigger`, `PreviewLinkCardContent`, `PreviewLinkCardImage` |
| **Progress** | `Progress` (animated bar) |
| **RadioGroup** | `RadioGroup`, `RadioGroupItem` |
| **Sheet** | `Sheet`, `SheetTrigger`, `SheetClose`, `SheetContent`, `SheetHeader`, `SheetFooter`, `SheetTitle`, `SheetDescription` |
| **Sidebar** | `Sidebar`, `SidebarProvider`, `SidebarTrigger`, `SidebarContent`, `SidebarHeader`, `SidebarFooter`, `SidebarMenu`, `SidebarMenuItem`, `SidebarMenuButton`, `SidebarGroup`, `SidebarGroupLabel`, `SidebarGroupContent`, `SidebarRail`, `SidebarInset`, `useSidebar` |
| **Switch** | `Switch` (animated toggle) |
| **Tabs** | `Tabs`, `TabsList`, `TabsTrigger`, `TabsContents`, `TabsContent` |
| **Toggle** | `Toggle`, `toggleVariants` |
| **ToggleGroup** | `ToggleGroup`, `ToggleGroupItem` |
| **Tooltip** | `Tooltip`, `TooltipTrigger`, `TooltipContent` |

### Animated Buttons

```tsx
import { LiquidButton } from '@/components/animate-ui/components/buttons/liquid';
```

| Component | Description |
|-----------|-------------|
| `Button` | Animated base button |
| `CopyButton` | Click-to-copy with checkmark animation |
| `FlipButton`, `FlipButtonFront`, `FlipButtonBack` | 3D flip effect |
| `GitHubStarsButton` | Shows repo star count with animation |
| `IconButton` | Icon-only button variant |
| `LiquidButton` | Liquid/blob hover effect |
| `RippleButton` | Material Design ripple effect |
| `ThemeTogglerButton` | Animated sun/moon/monitor theme toggle |

### Background Effects

```tsx
import { GradientBackground } from '@/components/animate-ui/components/backgrounds/gradient';
```

| Component | Description |
|-----------|-------------|
| `BubbleBackground` | Floating bubbles |
| `FireworksBackground` | Firework particles |
| `GradientBackground` | Animated gradient mesh |
| `GravityStarsBackground` | Gravity-affected stars |
| `HexagonBackground` | Hexagon grid pattern |
| `HoleBackground` | Black hole effect |
| `StarsBackground` | Twinkling star field |

### Community Components

```tsx
import { FlipCard } from '@/components/animate-ui/components/community/flip-card';
```

| Component | Description |
|-----------|-------------|
| `FlipCard` | 3D card flip on hover/click |
| `ManagementBar` | Animated management/action bar |
| `MotionCarousel` | Smooth scroll carousel |
| `NotificationList` | Animated notification stack |
| `PinList`, `PinListItem` | Pinterest-style pinned list |
| `PlayfulTodolist` | Animated todo list with physics |
| `RadialIntro` | Radial reveal intro animation |
| `RadialMenu` | Circular popup menu |
| `RadialNav`, `RadialNavItem` | Radial navigation ring |
| `ShareButton` | Animated share button with social icons |
| `UserPresenceAvatar` | Avatar with online/typing status indicators |

### Text Animations

```tsx
import { TypingText } from '@/components/animate-ui/primitives/texts/typing';
```

| Component | Description |
|-----------|-------------|
| `CountingNumber` | Animated number counter |
| `GradientText` | Text with animated gradient |
| `HighlightText` | Text with highlight/marker effect |
| `MorphingText` | Morphs between strings |
| `RollingText` | Rolling/slot-machine text |
| `RotatingText` | Rotating text carousel |
| `ShimmeringText` | Shimmer/shine sweep effect |
| `SlidingNumber` | Slot-style number transition |
| `SplittingText` | Per-character/word stagger animations |
| `TypingText` | Typewriter effect with cursor |

### Visual Effects

```tsx
import { Magnetic } from '@/components/animate-ui/primitives/effects/magnetic';
```

| Component | Description |
|-----------|-------------|
| `AutoHeight` | Animated height transitions |
| `Blur`, `Blurs` | Blur enter/exit effect |
| `Click` | Click ripple/particle effect |
| `Fade`, `Fades` | Fade enter/exit |
| `Highlight` | Highlight/marker effect |
| `ImageZoom` | Click-to-zoom image lightbox |
| `Magnetic` | Element follows cursor with magnetic pull |
| `Particles` | Particle system effect |
| `Shine` | Shine/glare sweep |
| `Slide`, `Slides` | Slide enter/exit from any direction |
| `Tilt`, `TiltContent` | 3D tilt on hover |
| `Zoom`, `Zooms` | Scale zoom enter/exit |

### Animation Utilities

| Component | Description |
|-----------|-------------|
| `AvatarGroup`, `AvatarGroupTooltip` | Overlapping avatar stack with tooltips |
| `Code`, `CodeBlock`, `CodeTabs` | Syntax-highlighted code blocks with animations |
| `CursorProvider`, `Cursor`, `CursorFollow` | Custom animated cursor |
| `MotionGrid` | Animated CSS grid |
| `ScrollProgress` | Scroll position indicator |
| `Spring`, `SpringProvider` | Physics-based spring animations |

---

## Animated Icons

64 animated Lucide icons. This is Zero's default platform icon pack. Use it for
app and platform UI by default, and use `lucide-react` directly only when Zero
does not ship the icon shape yet.

```tsx
import { AnimateIcon, Check, Heart, ZeroIcon } from '@zero/framework/icons';

<Heart animateOnHover className="size-6" />
<Check animate className="size-6 text-green-500" />

<AnimateIcon animateOnHover>
  <Heart size={20} />
</AnimateIcon>

<ZeroIcon name="arrow-right" size={18} animateOnHover />
```

Direct named icon imports come from `@zero/framework/icons`. The main
`@zero/framework/react` barrel exports `AnimateIcon`, `ZeroIcon`, and registry
helpers only so icon names like `Link` do not collide with router components.

### Complete Icon List

| Icon | Import Path |
|------|-------------|
| AlarmClock | `icons/alarm-clock` |
| ArrowDown | `icons/arrow-down` |
| ArrowLeft | `icons/arrow-left` |
| ArrowRight | `icons/arrow-right` |
| ArrowUp | `icons/arrow-up` |
| Bell | `icons/bell` |
| ChartBar | `icons/chart-bar` |
| ChartLine | `icons/chart-line` |
| Check | `icons/check` |
| ChevronDown | `icons/chevron-down` |
| ChevronLeft | `icons/chevron-left` |
| ChevronRight | `icons/chevron-right` |
| ChevronUp | `icons/chevron-up` |
| CircleCheck | `icons/circle-check` |
| CircleX | `icons/circle-x` |
| Clipboard | `icons/clipboard` |
| Clock | `icons/clock` |
| Compass | `icons/compass` |
| Copy | `icons/copy` |
| Download | `icons/download` |
| ExternalLink | `icons/external-link` |
| Heart | `icons/heart` |
| Key | `icons/key` |
| Layers | `icons/layers` |
| Lightbulb | `icons/lightbulb` |
| Link | `icons/link` |
| Link2 | `icons/link-2` |
| List | `icons/list` |
| Loader | `icons/loader` |
| Lock | `icons/lock` |
| LogIn | `icons/log-in` |
| LogOut | `icons/log-out` |
| MapPin | `icons/map-pin` |
| Maximize | `icons/maximize` |
| Menu | `icons/menu` |
| MessageCircle | `icons/message-circle` |
| MessageSquare | `icons/message-square` |
| Minimize | `icons/minimize` |
| Moon | `icons/moon` |
| Paperclip | `icons/paperclip` |
| Pause | `icons/pause` |
| Pin | `icons/pin` |
| Play | `icons/play` |
| Plus | `icons/plus` |
| Radio | `icons/radio` |
| RotateCw | `icons/rotate-cw` |
| Scissors | `icons/scissors` |
| Search | `icons/search` |
| Send | `icons/send` |
| Settings | `icons/settings` |
| Signal | `icons/signal` |
| Star | `icons/star` |
| Sun | `icons/sun` |
| Terminal | `icons/terminal` |
| ThumbsUp | `icons/thumbs-up` |
| Timer | `icons/timer` |
| Trash | `icons/trash` |
| Upload | `icons/upload` |
| User | `icons/user` |
| Users | `icons/users` |
| Volume2 | `icons/volume-2` |
| Wifi | `icons/wifi` |
| X | `icons/x` |

All icons can be imported by name from `@zero/framework/icons`.

For config-driven UI, use the registry helpers:

```tsx
import {
  getZeroAnimatedIcon,
  hasZeroAnimatedIcon,
  resolveZeroAnimatedIcon,
  zeroAnimatedIconNames,
} from '@zero/framework/icons';
```

---

## Server

### `createApp(config)`

Creates an Elysia server with built-in auth, sync, file routing, and static serving.

```ts
import { resolveConfig, createApp } from '@zero/framework/server';
import { tables } from './lib/schemas';

const config = resolveConfig({
  tables,  // defineTable() output — auto-extracts server definitions
  auth: true,
});
const app = createApp(config);

app.listen(3000);
```

`@zero/framework/server` is only needed here in `app/server.ts`. All other app code imports from `@zero/framework/react`.

The server provides:
- `/sync` — WebSocket endpoint for real-time data sync, WebSocket token auth, sync policy, and registered resource read/mutation policy
- `/api/auth/*` — JWT authentication endpoints
- `/api/_zero/observability/events` — protected recent event read + frontend event ingest
- `/notifications/*` — Notification CRUD + receipt tracking (via `createNotificationPlugin`)
- `/storage/*` — Authenticated drive and file storage routes (via `createStoragePlugin`)
- `/scheduler/*` — Admin job management (via `createSchedulerPlugin`)
- File-based routing from `pages/` directory
- Static file serving from `public/`
- SSR with streaming (React 19 `renderToReadableStream`)

#### Sync Defaults

`createApp()` treats omitted table sync mode as `auto` by default. Configure the
row limit globally or per table:

```ts
const config = resolveConfig({
  db: { mode: ':memory:' },
  tables,
  syncDefaults: {
    autoLazy: {
      rowLimit: 2000,
      action: 'lazy', // default: 'lazy'; also supports 'warn' or 'reject'
      persist: true,  // default
    },
    tables: {
      audit_log: { mode: 'lazy' },
      countries: { mode: 'full', rowLimit: 10000 },
    },
  },
});
```

Resolved lazy tables are excluded from websocket snapshots server-side, even if
an old client asks for them. `AppProvider` receives the resolved table modes via
`__PLATFORM_CONFIG__`, so the browser client builds the same snapshot list as
the server.

#### Sync Policy

`createApp()` installs platform defaults that protect service-owned tables from direct `sync.mutate` writes. App-owned tables remain writable over sync unless you pass stricter policy.

```ts
import { createDefaultSyncPolicy } from '@platform/sync';

const config = resolveConfig({
  db: { mode: ':memory:' },
  tables,
  auth: true,
  syncPolicy: createDefaultSyncPolicy({
    readProtectedTables: ['admin_notes'],
    writeProtectedTables: ['audit_log'],
  }),
});
```

For custom rules, pass a `SyncPolicy` with `canReadTable`, `canMutateTable`, `canInsert`, `canUpdate`, or `canDelete`. Mutation callbacks receive `table`, `op`, `rowId`, `row`, and `authContext`, so row ownership checks can live in app policy without changing the sync engine.

Registered resources add higher-level policy on top of sync policy. If a
resource `list` policy allows all rows for the current user, the table uses the
normal fast WebSocket path. If the resource `list` policy returns row
constraints, such as owner-only data, Zero applies a per-connection row filter
to snapshots, catchup, and live changes. Direct `sync.mutate` writes against
registered resources evaluate `create`, `update`, and `delete` policy
server-side, including owner create stamping.

#### Observability

`createApp()` enables observability by default: console output, a bounded
in-memory event store, and a protected event endpoint.

```ts
const config = resolveConfig({
  db: { mode: './data/app.db' },
  tables,
  observability: {
    maxEvents: 1000,
    endpoint: {
      basePath: '/api/_zero/observability',
      read: 'admin-or-dev',
      frontendIngest: true,
    },
    trace: {
      enabled: true,
      slowRequestMs: 500,
      slowLifecycleMs: 100,
    },
  },
});
```

Read recent events with `GET /api/_zero/observability/events`. Browser events
are accepted with `POST /api/_zero/observability/events` when frontend ingest
is enabled. See [Observability](observability.md).

#### Plugins

```ts
import { createApp, createSchedulerPlugin, createNotificationPlugin } from '@zero/framework/server';

const app = createApp(config);

// Mount order: scheduler → notifications (notifications register cleanup job)
app.use(createSchedulerPlugin());
app.use(createNotificationPlugin({ db: app.decorator.db }));

app.listen(3000);
```

---

## Hooks Reference

### Data Hooks

| Hook | Signature | Description |
|------|-----------|-------------|
| `useCollection` | `<T>(name) => { data, insert, update, remove }` | Primary mutation API -- all rows + CRUD, re-renders on any change |
| `useLazyCollection` | `(name, filter?) => { data, isLoading, error, refresh }` | Lazy table hook with loading/error/refresh |
| `useDataPage` | `(table, options?) => DataPageResult` | `/api/data` pagination, sorting, filters, loading/error, and refresh |
| `useRow` | `<T>(name, id) => T \| null` | Single row, re-renders when it changes |
| `useRecord` | `(table, id) => RecordResult` | Single row plus update/delete helpers |
| `useRecordByIdentity` | `(table, identity) => IdentityRecordResult` | Natural-identity lookup plus upsert/update/delete helpers |
| `useDataSelection` | `(items, options?) => UseDataSelectionReturn` | Reusable single/multiple selected-row state for data views |
| `useQuery` | `<T>(name, predicate) => T[]` | Filtered rows, re-renders on matching changes |
| `useStatus` | `() => { connected: boolean }` | WebSocket connected? |
| `useConnectionHealth` | `() => ConnectionHealth` | Auth/sync/pending-mutation health for app banners |
| `useMutation` | `(action, options?) => UseMutationReturn` | SDK-backed command lifecycle with observability errors |

### Auth Hooks

| Hook | Signature | Description |
|------|-----------|-------------|
| `useAuth` | `() => AuthState & AuthActions` | Full auth state + actions |
| `useAuthConfig` | `() => AuthConfigState` | Public auth registration/bootstrap/user-property config |
| `useCurrentUser` | `() => AuthUser \| null` | Current user shorthand |
| `useRequireAuth` | `(redirectTo?) => AuthUser \| null` | Guard: redirects if not authed |
| `useUserProperty` | `(key, options?) => UseUserPropertyResult` | Current-user KV property reader/writer for UI settings and gates |

### State Hooks

| Hook | Signature | Description |
|------|-----------|-------------|
| `useServerState` | `<T>(key, default) => [T, (v: T) => void]` | Server-persisted per-user state |
| `useServerStateReady` | `() => boolean` | Initial state loaded from server? |
| `usePreference` | `(key, defaultValue) => UsePreferenceResult` | Named server-state wrapper for user preferences |
| `useFormDraft` | `(key, initialValue, options?) => UseFormDraftResult` | Object-shaped synced form draft helper |

### Collection Hooks

| Hook | Signature | Description |
|------|-----------|-------------|
| `useCollection` | `(name) => CollectionResult` | Full-sync table data and mutations |
| `useLazyCollection` | `(name, filters?, options?) => LazyCollectionResult` | `/api/data` fetch plus live loaded rows |
| `useRow` | `(name, id) => row \| null` | Single row subscription |
| `useQuery` | `(name, predicate) => rows[]` | Local filtered collection view |
| `useStatus` | `() => { connected }` | WebSocket connection status |

### Notification Hooks

| Hook | Signature | Description |
|------|-----------|-------------|
| `useNotifications` | `() => UseNotificationsResult` | Full notification state + actions for current user |
| `useUnreadCount` | `() => number` | Lightweight unread badge count |
| `useOnNewNotification` | `(cb: (n) => void) => void` | Fires on new notification arrival |
| `useNotificationContext` | `() => UseNotificationsResult` | Context consumer (inside NotificationProvider) |

### Room And Presence Hooks

| Hook | Signature | Description |
|------|-----------|-------------|
| `useRoom` | `(roomId) => UseRoomResult` | Live room plus members |
| `useRoomMembers` | `(roomId) => RoomMemberRecord[]` | Live room members |
| `useRooms` | `(userId) => RoomRecord[]` | Rooms for a user |
| `useRoomActions` | `() => RoomActions` | Create/join/leave/delete room actions |
| `useRoomData` | `(roomId, tableName) => rows[]` | Live table rows filtered by `room_id` |
| `usePresence` | `(roomId, data?) => UsePresenceResult` | Low-level ephemeral presence heartbeat |
| `usePresenceList` | `(roomId, options?) => UsePresenceListReturn` | Display-ready presence list with stale filtering |
| `useTypingIndicator` | `(scope, options?) => UseTypingIndicatorReturn` | Ephemeral typing state with TTL and current typing users |

### Storage Hooks

| Hook | Signature | Description |
|------|-----------|-------------|
| `useUpload` | `() => UseUploadReturn` | Multipart upload with progress |
| `useUploadQueue` | `() => UseUploadQueueReturn` | Sequential multi-file upload queue |
| `useUploadDropzone` | `(options) => UseUploadDropzoneReturn` | `react-dropzone` bindings wired to Zero storage uploads |
| `useStorageFile` | `(driveId, path) => UseStorageFileReturn` | One file/folder metadata, URL, delete, visibility, refresh |
| `useStorageFolder` | `(driveId, path?) => UseStorageFolderReturn` | Folder listing |
| `useStorageBrowser` | `(driveId, initialPath?) => UseStorageBrowserReturn` | Folder navigation, selection, uploads, and common actions |
| `useStorageDrives` | `() => UseStorageDrivesReturn` | Accessible drive list |
| `useDriveUsage` | `(driveId) => UseDriveUsageReturn` | Drive usage stats |
| `useDriveQuota` | `(driveId) => UseDriveQuotaReturn` | Drive usage plus derived quota flags |
| `usePresignedUrl` | `() => UsePresignedUrlReturn` | Create presigned URLs |
| `useStorageActions` | `() => StorageActions` | Drive/file mutation helpers |

Storage hooks must run inside `AppProvider` or `ClientProvider` so they can use
the platform SDK client. JSON actions use `client.fetch()`; multipart uploads
use SDK auth headers with an automatic refresh-and-retry on 401.

### Workflow Hooks

| Hook | Signature | Description |
|------|-----------|-------------|
| `useWorkflow` | `(instanceId) => UseWorkflowResult` | Live workflow instance and steps |
| `useWorkflowList` | `(filter?) => UseWorkflowListResult` | Live workflow instances by status/name |
| `useWorkflowActions` | `() => WorkflowActions` | Start/cancel/pause/resume/send-event actions |
| `useWorkflowRun` | `(name, options?) => UseWorkflowRunResult` | Start one workflow by name and watch live progress |

### Router Hooks

| Hook | Signature | Description |
|------|-----------|-------------|
| `useParams` | `() => Record<string, string>` | Route params |
| `usePathname` | `() => string` | Current pathname |
| `useRouter` | `() => { push, replace, go, back, forward }` | Navigation |

### Form Hook

| Hook | Signature | Description |
|------|-----------|-------------|
| `useForm` | `<T>(opts) => UseFormReturn<T>` | Schema-driven form state + validation |

### Table Hook

| Hook | Signature | Description |
|------|-----------|-------------|
| `useDataTable` | `<T>(opts) => UseDataTableReturn<T>` | TanStack Table state management |
| `useDataTableSource` | `<T>(opts) => DataTableSourceState<T>` | DataTable source resolver for static, full-sync, and lazy sources |

### Generic UI Hooks

| Hook | Signature | Description |
|------|-----------|-------------|
| `useAsyncAction` | `(action, options?) => { pending, error, result, run, reset }` | Async button/form action lifecycle |
| `useAutoHeight` | `(deps?, options?) => { ref, height }` | Element height measurement for animated layout |
| `useConfirm` | `() => (options) => Promise<boolean>` | Promise-based confirmation dialog inside `ConfirmProvider` |
| `useControlledState` | `(props) => [value, setValue]` | Controlled/uncontrolled component state |
| `useDataState` | `(key, ref?, onChange?) => [value, ref]` | `data-*` attribute observer for low-level UI primitives |
| `useDebouncedCallback` | `(callback, delayOrOptions) => callback & { flush, cancel, isPending }` | Debounced callbacks with lifecycle controls |
| `useDebouncedValue` | `(value, delayMs) => value` | Debounced UI state |
| `useDisclosure` | `(options?) => { isOpen, setOpen, open, close, toggle }` | Dialog/drawer/popover open state |
| `useClickAway` | `(handler, options?) => ref` | Outside-interaction handler for menus, popovers, and dialogs |
| `useCopyToClipboard` | `(options?) => { copied, value, error, copy, reset }` | Clipboard copy lifecycle state |
| `useHotkey` | `(combo, handler, options?) => void` | Keyboard shortcuts such as `mod+k` |
| `useIdle` | `(timeoutMs?, options?) => boolean` | User inactivity state |
| `useInterval` | `(callback, delayMs, options?) => void` | Pausable interval callback |
| `useIsInView` | `(ref, options?) => { ref, isInView }` | Viewport visibility state |
| `useIsMobile` | `() => boolean` | Zero default mobile breakpoint |
| `useMediaQuery` | `(query, options?) => boolean` | SSR-safe `matchMedia` hook |
| `useMounted` | `() => boolean` | Hydration/mount state |
| `useMotionValueState` | `(motionValue) => number` | MotionValue to React state bridge |
| `useOs` | `(options?) => OperatingSystem` | SSR-safe OS detection |
| `usePrevious` | `(value) => previousValue` | Previous render value |
| `useStableCallback` | `(callback) => callback` | Stable identity, latest implementation callback |
| `useTextSelection` | `() => Selection \| null` | Current non-collapsed page text selection |
| `useThrottledCallback` | `(callback, waitMs, options?) => callback & { cancel, flush, isPending }` | Throttled callbacks |
| `useThrottledValue` | `(value, waitMs?, options?) => value` | Throttled UI state |
| `useTimeout` | `(callback, delayMs) => void` | Pausable one-shot timeout |

See [Frontend Hooks](frontend/hooks.md) for usage examples and hook boundary rules.

---

## Full Export List

Everything available from `@zero/framework/react`:

### Functions & Classes
`createClient`, `getClient`, `AuthClient`, `registerRoute`, `matchClientRoute`, `navigateTo`, `prefetchRoute`, `defineSchema`, `defineTable`, `field`, `toast`, `formatRelativeTime`, `buildDataTableLazyQuery`, `buildDataPageQuery`, `getOS`, `getZeroAnimatedIcon`, `hasZeroAnimatedIcon`, `resolveZeroAnimatedIcon`

### React Components
`AppProvider`, `ClientProvider`, `RouterProvider`, `NotificationProvider`, `ConfirmProvider`, `Link`, `AnimateIcon`, `ZeroIcon`, `StickToBottom`, `Toaster`, `ThemeProvider`, `ThemeTogglerButton`, `AutoForm`, `FieldRenderer`, `CrudPage`, `MasterDetailView`, `MasterDetailPage`, `DataTableView`, `DataTable`, `DataTableColumnHeader`, `DataTableToolbar`, `DataTablePagination`, `DataTableRowActions`, `UserManagement`, `StorageManagement`, `StorageDriveList`, `StorageDropzone`, `StorageFileBrowser`, `StorageDriveDetailHeader`, `StorageFileDetailPanel`, `Button`, `Input`, `Label`, `Textarea`, `Badge`, `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`, `Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem`, `SelectGroup`, `SelectLabel`, `SelectSeparator`, `Table`, `TableHeader`, `TableBody`, `TableFooter`, `TableRow`, `TableHead`, `TableCell`, `TableCaption`, `ScrollArea`, `ScrollBar`, `Separator`, `Skeleton`, `Avatar`, `AvatarImage`, `AvatarFallback`, `FormField`, `FormLabel`, `FormControl`, `FormDescription`, `FormMessage`, `Pagination`, `PaginationContent`, `PaginationItem`, `PaginationLink`, `PaginationPrevious`, `PaginationNext`, `PaginationEllipsis`, `Calendar`, `DatePicker`, `DateRangePicker`, `Command`, `CommandDialog`, `CommandInput`, `CommandList`, `CommandEmpty`, `CommandGroup`, `CommandItem`, `CommandSeparator`, `CommandShortcut`, `Combobox`, `TagInput`, `NotificationBadge`, `NotificationItem`, `NotificationList`, `NotificationDropdown`, `NotificationCenter`, `ValidationRules`, `ValidationMeter`

### React Hooks
`useClient`, `useClientMaybe`, `useIsServer`, `useCollection`, `useLazyCollection`, `useDataPage`, `useDataSelection`, `useRow`, `useRecord`, `useRecordByIdentity`, `useQuery`, `useStatus`, `useConnectionHealth`, `useMutation`, `useAuth`, `useAuthConfig`, `useCurrentUser`, `useRequireAuth`, `useUserProperty`, `useServerState`, `useServerStateReady`, `usePreference`, `useFormDraft`, `useNotifications`, `useUnreadCount`, `useOnNewNotification`, `useNotificationContext`, `useRoom`, `useRoomMembers`, `useRooms`, `useRoomActions`, `useRoomData`, `usePresence`, `usePresenceList`, `useTypingIndicator`, `useUpload`, `useUploadQueue`, `useUploadDropzone`, `useStorageFile`, `useStorageFolder`, `useStorageBrowser`, `useStorageDrives`, `useDriveUsage`, `useDriveQuota`, `usePresignedUrl`, `useStorageActions`, `useWorkflow`, `useWorkflowList`, `useWorkflowActions`, `useWorkflowRun`, `useParams`, `usePathname`, `useRouter`, `useForm`, `useDataTable`, `useDataTableSource`, `useAdminUsers`, `useAsyncAction`, `useAutoHeight`, `useClickAway`, `useConfirm`, `useControlledState`, `useCopyToClipboard`, `useDataState`, `useDebouncedCallback`, `useDebouncedValue`, `useDisclosure`, `useHotkey`, `useIdle`, `useInterval`, `useIsInView`, `useIsMobile`, `useMediaQuery`, `useMounted`, `useMotionValueState`, `useOs`, `usePrevious`, `useStableCallback`, `useStickToBottom`, `useStickToBottomContext`, `useTextSelection`, `useThrottledCallback`, `useThrottledValue`, `useTimeout`

### Constants
`STORAGE_TABLES`, `zeroAnimatedIconNames`, `zeroAnimatedIcons`

### Types
`Client`, `Collection`, `ClientConfig`, `SyncClient`, `AuthUser`, `RegisterParams`, `AppProviderProps`, `ClientProviderProps`, `NotificationProviderProps`, `LinkProps`, `AnimateIconContextValue`, `AnimateIconProps`, `IconProps`, `IconWrapperProps`, `ZeroAnimatedIconComponent`, `ZeroAnimatedIconName`, `ZeroIconProps`, `ThemeProviderProps`, `ThemeTogglerButtonProps`, `AuthState`, `AuthActions`, `AuthConfigState`, `UseUserPropertyOptions`, `UseUserPropertyResult`, `CollectionResult`, `LazyCollectionResult`, `LazyCollectionOptions`, `ConnectionHealth`, `DataFilterExpression`, `DataFilterOperator`, `DataFilterPrimitive`, `DataFilterValue`, `DataPageFilters`, `DataPageInfo`, `DataPageOptions`, `DataPageResult`, `DataPageSort`, `DataSelectionMode`, `UseDataSelectionOptions`, `UseDataSelectionReturn`, `IdentityRecordResult`, `RecordResult`, `UseFormDraftOptions`, `UseFormDraftResult`, `UseMutationOptions`, `UseMutationReturn`, `UsePreferenceResult`, `WorkflowActions`, `UseWorkflowResult`, `UseWorkflowListResult`, `UseWorkflowRunOptions`, `UseWorkflowRunResult`, `WorkflowProgress`, `InferRow`, `Register`, `TableNames`, `RegisteredTableRow`, `Notification`, `NotificationReceipt`, `NotificationWithStatus`, `UseNotificationsResult`, `NotificationType`, `NotificationPriority`, `NotificationTarget`, `PresenceMember`, `PresenceListMember`, `TypingIndicatorMember`, `UsePresenceResult`, `UsePresenceListOptions`, `UsePresenceListReturn`, `UseTypingIndicatorOptions`, `UseTypingIndicatorReturn`, `Animation`, `GetTargetScrollTop`, `ScrollElements`, `ScrollToBottom`, `ScrollToBottomOptions`, `SpringAnimation`, `StickToBottomContext`, `StickToBottomInstance`, `StickToBottomOptions`, `StickToBottomProps`, `StickToBottomState`, `StopScroll`, `UploadState`, `UseUploadReturn`, `UploadFileOptions`, `UseUploadQueueReturn`, `UploadQueueFilesOptions`, `UploadQueueItem`, `UploadQueueItemStatus`, `UseUploadDropzoneOptions`, `UseUploadDropzoneReturn`, `UseStorageFileReturn`, `UseStorageFolderReturn`, `UseStorageBrowserReturn`, `StorageBrowserActions`, `UseStorageDrivesReturn`, `UseDriveUsageReturn`, `UseDriveQuotaReturn`, `UsePresignedUrlReturn`, `StorageActions`, `DriveRecord`, `FileInfo`, `DriveUsage`, `StorageManagementProps`, `StorageManagementView`, `StorageDriveRow`, `StorageDriveListProps`, `StorageDropzoneProps`, `StorageFileBrowserProps`, `StorageDriveDetailHeaderProps`, `StorageFileDetailPanelProps`, `RouteModule`, `RouteNode`, `MatchResult`, `LoaderContext`, `ApiHandler`, `PageMeta`, `RouterConfig`, `SchemaDescriptor`, `TableDefinition`, `FieldType`, `FieldMeta`, `FieldDef`, `UseFormOptions`, `UseFormReturn`, `MasterDetailPageProps`, `MasterDetailRenderContext`, `DataTableCellContext`, `DataTableColumnOverride`, `DataTableColumnOverrides`, `DataTableFilters`, `DataTableFilterValue`, `DataTableInitialState`, `DataTableProps`, `DataTableSource`, `DataTableSourceActions`, `DataTableSourceState`, `UseDataTableOptions`, `UseDataTableReturn`, `UseDataTableSourceOptions`, `RowAction`, `CrudPageProps`, `CalendarProps`, `DatePickerProps`, `DateRangePickerProps`, `ComboboxProps`, `ComboboxOption`, `TagInputProps`, `NotificationBadgeProps`, `NotificationItemProps`, `NotificationItemType`, `NotificationListProps`, `NotificationListItem`, `NotificationDropdownProps`, `NotificationCenterProps`, `ValidationRule`, `ValidationRulesProps`, `ValidationMeterProps`, `AutoHeightOptions`, `ClickAwayEvent`, `CommonControlledStateProps`, `ConfirmOptions`, `DataStateValue`, `HotkeyHandler`, `HotkeyOptions`, `OperatingSystem`, `OSDetectionInput`, `UseAsyncActionOptions`, `UseAsyncActionReturn`, `UseClickAwayOptions`, `UseCopyToClipboardOptions`, `UseCopyToClipboardReturn`, `UseDebouncedCallbackOptions`, `UseDebouncedCallbackReturn`, `UseDisclosureOptions`, `UseDisclosureReturn`, `UseIdleOptions`, `UseIntervalOptions`, `UseIsInViewOptions`, `UseMediaQueryOptions`, `UseOsOptions`, `UseOsReturnValue`, `UseThrottledCallbackOptions`, `UseThrottledCallbackReturn`, `UseThrottledValueOptions`

Server-only (from `@zero/framework/server`): `App`, `AppConfig`, `ResolvedConfig`, `AuthPluginConfig`, `JobDefinition`, `JobStatus`, `SchedulerPluginConfig`, `StoragePluginConfig`, `StorageAdapter`, `StorageDriveApi`, `StorageObjectApi`, `StoragePermissionApi`, `ObservabilityConfig`, `PlatformEvent`, `PlatformSink`, `createApp`, `resolveConfig`, `createAuthPlugin`, `createAuthMiddleware`, `getTokenService`, `createSchedulerPlugin`, `getScheduler`, `createNotificationPlugin`, `createStoragePlugin`, `getStorageService`, `emitPlatformCode`, `createObservabilityPlugin`

Sync-only (from `@platform/sync`): `createDefaultSyncPolicy`, `combineSyncPolicies`, `allowAllSyncPolicy`, `getReadableSyncTables`, `evaluateSyncReadPolicy`, `evaluateSyncMutationPolicy`, `SyncPolicy`, `SyncReadPolicyContext`, `SyncMutationPolicyContext`

### CVA Variant Functions
`buttonVariants`, `badgeVariants`

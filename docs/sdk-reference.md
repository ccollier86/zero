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
  - [Installed app authentication](#installed-app-authentication)
- [Real-Time Data (Collections)](#real-time-data-collections)
- [CrudPage](#crudpage)
- [Server State Sync](#server-state-sync)
- [Forms](#forms)
- [Data Table](#data-table)
- [Kanban Board](#kanban-board)
- [Routing](#routing)
- [Theme](#theme)
- [Notifications](#notifications)
- [Storage](#storage)
- [Scheduler](#scheduler)
- [UI Components](#ui-components)
- [Animated Components (animate-ui)](#animated-components)
- [Animated Icons](#animated-icons)
- [Server (createApp)](#server)
  - [ReactiveDB Fabric: Actor-Backed Multi-Database Tenancy](#reactivedb-fabric-actor-backed-multi-database-tenancy)
- [Hooks Reference](#hooks-reference)
- [Selected Export Reference](#selected-export-reference)

---

## Quick Start

> **Import aliases:** Use `@zero/framework/react` for browser-safe schema,
> hooks, and components, and `@zero/framework/icons` for Zero's default
> animated icon pack. Use `@zero/framework/server` only in server-owned files
> such as `app/server.ts`, `server/plugins`, `server/middleware`,
> `server/endpoints`, and `server/routes`. Use `@app/*` for your app code. See
> [Package Imports And App Aliases](frontend/README.md#package-imports-and-app-aliases)
> for the full list.

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
// app/server.ts
import { createApp, resolveConfig } from '@zero/framework/server';
import { tables } from './lib/schemas';

// defineTable() output is auto-detected — no .serverTable extraction needed
const config = resolveConfig({
  db: { mode: './data/myapp.db' },
  tables,
  auth: true,
  loginPath: '/login',
  postLoginPath: '/dashboard',
});

const app = await createApp(config);
app.listen(config.port);
```

### 3. Wire up the client

```tsx
'use client';

// app/layout.tsx
import { AppProvider } from '@zero/framework/react';
import { tables } from './lib/schemas';
import type { ReactNode } from 'react';

// defineTable() output is auto-detected — no .clientTable extraction needed
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <AppProvider
      url={typeof window !== 'undefined' ? window.location.origin : ''}
      tables={tables}
    >
      {children}
    </AppProvider>
  );
}
```

`postLoginPath` is a top-level server option and an optional `AppProvider` prop.
The provider normally receives its resolved value from the injected server
configuration, so the root layout does not need to repeat it.

### 4. Build features

```tsx
'use client';

import {
  AutoForm,
  CrudPage,
  DataTableView,
  useCollection,
} from '@zero/framework/react';
import { todoTable } from './lib/schemas/todo';

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

- **Single live channel** — policy-authorized app data, state, and scoped notifications share one Bearer-authenticated WebSocket; physical tenant mode multiplexes independent default/control and tenant data-plane cursors on that channel, while login/session APIs remain HTTP
- **Optimistic mutations** — writes apply locally first, sync to server in background
- **@xstate/store** — tear-free reactive state via `useSyncExternalStore`
- **Schema-driven** — define once, get forms + tables + DB + validation
- **Scoped real-time notifications** — target policy is enforced before Sync delivers a notification or receipt row
- **Centralized scheduler** — any plugin can register cron jobs, admin API for visibility/control

---

## Schema Builder

Define your data model once. The schema produces Valibot validation, SQL column
definitions, UI metadata, and a server-only logical mutation validator.

### `field` builders

| Builder | DB Type | Description |
|---------|---------|-------------|
| `field.text(opts?)` | `text` | String field. Options: `required`, `minLength`, `maxLength`, `label`, `placeholder` |
| `field.email(opts?)` | `text` | Email-validated string |
| `field.url(opts?)` | `text` | URL-validated string |
| `field.password(opts?)` | `text` | Password with min 8 chars, hidden from tables |
| `field.number(opts?)` | `real`/`integer` | Number. Options: `min`, `max`, `integer` |
| `field.boolean(opts?)` | `integer` | Logical `boolean` in app code, stored as 0/1 |
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
with UI-native values (`boolean`, arrays, objects) and encode structured `text`
fields for ReactiveDB. Schema-generated collections also encode logical boolean
writes to `0/1` and decode stored `0/1` values back to `boolean` on reads.

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

`toTableSchema()` carries its logical validator as symbol metadata. SQL column
enumeration and JSON serialization ignore that metadata, so it is available to
the server Sync plugin without becoming a database column or client config.

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

The returned `TableDefinition` also exposes `mutationValidator` for lower-level
server composition. With normal `createApp({ tables })` usage, Zero preserves
and installs it automatically.

For WebSocket INSERT and UPDATE mutations on schema-generated tables, the
server:

1. runs Sync/resource authorization and applies any trusted policy stamp;
2. rejects incoming fields outside the schema (except its configured primary
   key);
3. decodes SQLite wire values into the logical field types;
4. validates a complete logical row with the schema; and
5. encodes the validated result before entering the write transaction.

Partial UPDATEs are merged with the current stored row for full validation, but
only submitted/stamped fields are written. A client cannot change the primary
key through UPDATE. Failed validation produces a negative Sync acknowledgement
and no database change.

Raw `TableSchema` objects keep their existing SQL-constraint behavior and do
not gain logical validation implicitly. Prefer `defineTable()`, or attach an
explicit `mutationValidator` when wrapping a hand-authored server table.

`opts.sync` accepts:

- omitted or `'auto'` — server startup resolves the table to full or lazy sync
  using `createApp({ syncDefaults })`. This is the default.
- `'full'` — always include the table in websocket snapshots. Explicit config
  wins even if the table is large; startup logs a warning.
- `'lazy'` — never include the table in websocket snapshots. Load rows on
  demand through `useLazyCollection()` or `/api/data`.

### Type inference

```ts
import type { InferInsert, InferRow, InsertInput } from '@zero/framework/react';

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

// The runtime generates account_id, so creation inputs may omit only that key.
type NewAccount = InferInsert<typeof accountTable>;
const input: NewAccount = { name: 'Acme' };
const sameContract: InsertInput<Account> = input;
```

`InsertInput<T>` derives the primary key automatically for `InferRow` types.
For hand-written row types with a custom primary key, pass the key as the
second generic to `client.collection<T, 'account_id'>()` or
`useCollection<T, 'account_id'>()`.

### Natural identity for relationship tables

ReactiveDB intentionally keeps one single-column sync primary key per row. Its
declared SQLite affinity must be `TEXT` or `INTEGER`; the default generated
sync key uses `TEXT`, while an explicitly numeric safe `INTEGER` value is
canonicalized to a string row ID at the Sync and Fabric boundaries. `REAL`,
`BLOB`, `NUMERIC`, typeless, and composite primary keys are rejected. For
tables that would normally use a composite primary key, declare a natural
identity instead. The platform creates a deterministic text sync id from those
fields and adds a unique database index for them.

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
import { createClient } from '@zero/framework/react';
import { tables } from '@app/lib/schemas';

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

In a full-stack Zero app, `AppProvider` receives the server-authored Sync table
catalog through `window.__PLATFORM_CONFIG__`. When physical tenant storage is
enabled, it automatically supplies `tableSyncPlanes` to the client, removes
known HTTP-only/internal resources from the Sync schema, and keeps framework
tables on the `default` plane. Do not hand-author this map in application UI.
The low-level `createClient({ tableSyncPlanes })` option exists for generated or
standalone composition and must contain exactly one `default` or `tenant`
entry for every configured application table.

One client and one WebSocket still back the app. The Sync client maintains
independent cursor, epoch, authorization scope, baseline, and reset state for
the default/control and tenant planes; a reconnect sends both cursors. A
browser `plane` value is only an assertion. The server always routes a table
from its validated Resource/realm catalog.

### Client API

```ts
// ─── Auth (top-level) ──────────────────────────────────
client.user              // AuthUser | null
client.isAuthenticated   // boolean
client.token             // Current in-memory access JWT (compatibility/diagnostics)
await client.login('alice', 'password123') // → session or continuation
await client.register({ username, email, password })  // → AuthRegistrationResult
// Fresh install only: include bootstrapSecret when /auth/config says the
// secret-gated bootstrap ceremony is required and available.
await client.logout()
await client.refresh()                  // Refresh access token when auth is enabled

// ─── Guardian user API-key management ────────────────
await client.apiKeys.self.list({ limit: 25 })
await client.apiKeys.self.issue({ label: 'automation', ttl: '7d' })
await client.apiKeys.applicationAdmin.listUser(userId)
await client.apiKeys.tenantAdmin.listMember(membershipId)
await client.apiKeys.platformAdmin.list({ tenantId })

// ─── HTTP (JSON fetch; auth headers when auth is enabled) ─────
await client.get('/api/users')                           // → parsed JSON
await client.post('/api/users', { name: 'Alice' })       // → parsed JSON
await client.patch('/api/users/1', { role: 'admin' })    // → parsed JSON
await client.put('/api/users/1', body)                   // → parsed JSON
await client.delete('/api/users/1')                      // → parsed JSON
await client.fetch('/api/custom', { method: 'POST', body, headers })

// ─── Data ──────────────────────────────────────────────
client.collection<T>('todos')  // Get typed collection
client.resource<T>('todos')    // Generated resource-route client

// ─── Connection ────────────────────────────────────────
client.url                 // Server URL
client.connected           // WebSocket connected?
client.connect()           // Open WebSocket when autoConnect was false
client.onConnectionChange(cb)  // Subscribe to connection state
client.disconnect()            // Tear everything down
```

`client.resource(name)` can reach only registered resources whose server-owned
exposure is `http` or `all`. `internal` and `sync` resources deliberately look
unknown to generated HTTP CRUD.

Resource mutation methods accept an optional `idempotencyKey` alongside their
abort signal. The client generates and sends a bounded header-safe key when it
is omitted. A failed mutation throws `ResourceMutationError`, which preserves
the exact sent key even when the network loses the response:

```ts
import { ResourceMutationError } from '@zero/framework/react';

const todos = client.resource<Todo>('todos');
try {
  await todos.update('todo-1', { done: true });
} catch (error) {
  if (error instanceof ResourceMutationError) {
    const body = error.body as {
      requiresSameIdempotencyKey?: boolean;
    } | undefined;

    // Apply your retry/backoff policy. If the transport lost the response or
    // Zero reports an uncertain outcome, preserve this exact key and payload.
    if (error.status === undefined || body?.requiresSameIdempotencyKey) {
      await todos.update(
        'todo-1',
        { done: true },
        { idempotencyKey: error.idempotencyKey },
      );
    }
  }
}
```

`ResourceMutationError.status` and `.body` mirror the underlying `FetchError`
when an HTTP response exists, and `.cause` retains the original transport
error. Explicit keys must contain 1–128 ASCII letters, digits, `.`, `_`, `:`,
or `-`, beginning with a letter or digit. Never reuse one key for different
input, resource, action, row, tenant, or principal. `useResourceClient()`,
`useResourceRecord()` mutation methods, and `useResourceActions()` accept the
same optional mutation options, so a React caller can recover and replay the
key without dropping the hook's authorization-scope or abort fencing.

Every generated Resource mutation persists its private operation receipt
atomically with the effect. `tenant-database` mode uses the actor ledger inside
that tenant file; global and shared-row Resources use an equivalent ledger in
the pinned default ReactiveDB. A physical actor `503` response with code
`resource-mutation-outcome-unknown` or a committed-readback recovery response
sets `requiresSameIdempotencyKey: true`. Retrying the exact action with the
same key returns the canonical committed row/preimage after current policy and
authority are revalidated; it does not substitute a later row read. Reusing a
key with different canonical input returns `409` with code
`resource-idempotency-key-reused`. Resource policy, current allowed fields, and
tenant authority remain server-side on both the first attempt and replay. CAS
preconditions execute with the mutation on its first execution; an exact
replay does not read or mutate the later row and instead authorizes the
immutable receipt preimage and canonical result again.

Each ledger retains at most 10,000 full receipt results and 64 MiB of encoded
retained results, compacting the oldest full results to permanent tombstones
until both limits fit. Actor receipts allow up to 8 MiB of encoded JSON per
result; default/shared-row Resource receipts preserve their existing 4 MiB
canonical-effect limit. Older keys can never become misses: an exact retry
after its result expires returns non-retryable `409` with code
`resource-idempotency-result-expired`.

Permanent identities are also bounded at 1,000,000 per database. At that
ceiling, an unseen default/shared-row mutation is rejected before its effect
runs with non-retryable `503`, code
`resource-idempotency-capacity-exhausted`, and fixed message
`Resource idempotency receipt capacity is exhausted`; exact replay, expired
lookup, and changed-key conflict behavior remain available. Monitor aggregate
key usage and plan a deliberate database lifecycle before exhaustion. The
public Resource constants are `RESOURCE_DEFAULT_RECEIPT_MAX_KEYS`,
`RESOURCE_DEFAULT_RECEIPT_RETAINED_LIMIT`,
`RESOURCE_DEFAULT_RECEIPT_MAX_RESULT_BYTES`, and
`RESOURCE_DEFAULT_RECEIPT_MAX_RETAINED_BYTES`. Read the authoritative Resource
state before deciding whether to submit new work with a new key. Do not retry
an expired key or assume the original write failed.

Actor/database failures are normalized before generated Resource HTTP
responses. Raw SQLite/IPC messages, paths, tenant/database references, SQL,
bind values, receipt keys, and internal `DatabaseError.details` are never
reflected:

| Condition | Generated Resource response |
| --- | --- |
| live authority changed | `403 resource-authority-changed` |
| invalid actor-backed read/write payload | `400 invalid-resource-query` or `400 invalid-resource-input` |
| compare-and-swap row changed | `409 resource-row-changed` |
| primary-key or other state conflict | `409 resource-conflict` |
| receipt key reused for different logical work | `409 resource-idempotency-key-reused` |
| full receipt result expired | non-retryable `409 resource-idempotency-result-expired` |
| permanent receipt-key capacity reached | non-retryable `503 resource-idempotency-capacity-exhausted` |
| permanent managed-file capacity reached | non-retryable `503 database-capacity-exhausted` |
| dispatched mutation outcome unknown | `503 resource-mutation-outcome-unknown` with `requiresSameIdempotencyKey: true` |
| committed mutation cannot produce a safe canonical readback | `503 resource-mutation-readback-failed` with `requiresSameIdempotencyKey: true` |
| other actor/database availability failure | `503 database-unavailable` |

Physical-tenant `/api/data` is read-only and uses its own equally bounded
public mapping: authority changes are `403 resource-authority-changed`, query
validation and actor-rejected invalid operations are consistently
`400 invalid-data-query`, read conflicts are
`409 data-query-conflict`, permanent capacity is
`503 database-capacity-exhausted`, and all other actor availability failures
are `503 database-unavailable`. The exact internal `DatabaseErrorCode` remains
server-internal; 5xx classifications emit it to app-local observability, and
it is never returned in the HTTP body.

The public `Client` deliberately does not expose the internal sync, state, or
ephemeral clients. React apps use `useServerState()`, room/presence hooks, and
the other public hooks instead. `client.api` is the authenticated Eden Treaty
surface for typed app routes.

Do not copy `client.token` into ordinary application requests. The official
`client.api`, `client.fetch`, HTTP helpers, generated resource clients, and
upload hooks own session restoration, refresh/retry, multipart authorization,
and authorization-scope fencing. Reading and attaching the token manually can
race restoration or tenant replacement and bypass those guarantees. The token
property remains public for compatibility and narrowly reviewed integrations.
Credential-bearing browser requests are restricted to the configured Zero
server origin. An absolute cross-origin target fails locally with
`AUTH_REQUEST_ORIGIN_MISMATCH` before the request transport reads or attaches
an access credential.

`auth` defaults to false on the raw SDK client, matching `createApp()`. In
full-stack apps, `AppProvider` reads the server-injected platform config when
`auth` or `stateSync` props are omitted. Auth actions throw a clear
configuration error when auth is disabled.

When auth is enabled, sessions persist through the refresh token. The SDK keeps
the access token in memory, stores the refresh token locally, refreshes and
retries authenticated HTTP calls after an expired access-token 401, and
reconnects sync with the latest access token. If refresh is rejected, it clears
auth state plus local synced table/state data.

`useAuth().isRestoring` is true only while startup recovery rotates the stored
refresh token and loads `/auth/me`; `isLoading` is also true during that
interval. Browsers with Web Locks serialize rotation per Zero server across
tabs and workers, and a waiter rereads the persisted token after acquiring the
lock. Without Web Locks, Zero uses a bounded, expiring `localStorage` bakery
lock across tabs when browser storage is available. The in-process queue is the
final same-JavaScript-realm fallback for runtimes without either facility.

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

Use the [Auth System](auth/README.md) as the canonical documentation map for
installation bootstrap, the four tenancy/authorization profiles, permission
declarations, administration, onboarding, browser state, audit, and installed
app authentication. This reference concentrates on callable SDK surfaces; the
focused auth manuals define their security and lifecycle contracts.
User-bound credential configuration, explicit app-route admission, the four
management namespaces, and one-time-secret handling are documented in
[Guardian User API Keys](auth/api-keys.md).

### Installed app authentication

First choose a supported surface in the
[App Authentication SDK Guide](auth/app-auth-sdk-guide.md). The implemented
TypeScript core is exported from `@zero/framework/native`. The independently
versioned Rust/Tauri and Chrome packages are functional private `0.0.0`
previews; neither is a released package or bundled with generated apps.

#### `createZeroNativeAuthBroker(options)`

Create the preferred process-wide TypeScript credential owner. The public
`clientId` has no secret. Zero owns discovery, Authorization Code + PKCE,
state/nonce/issuer checks, ES256 ID-token verification, refresh rotation, safe
state, and same-origin authenticated fetch. The host owns the system browser,
callback capture, and OS vault.

```ts
import {
  createNativeSyncAuth,
  createZeroNativeAuthBroker,
  type NativeCallbackAdapter,
  type NativeSecureVault,
  type NativeSystemBrowser,
} from '@zero/framework/native';

declare const browser: NativeSystemBrowser;
declare const callback: NativeCallbackAdapter;
declare const secureStorage: NativeSecureVault;

const auth = createZeroNativeAuthBroker({
  serverUrl: 'https://app.example.com',
  clientId: 'example-desktop',
  browser,
  callback,
  secureStorage,
  scopes: ['profile', 'email'],
});

await auth.initialize();
await auth.signIn({ loginHint: 'person@example.com' });
const user = auth.getUser();
const response = await auth.fetch('/api/private');
```

The broker registry is keyed by `storageNamespace`. Repeating the same setup in
one JavaScript process returns the existing owner. The default namespace is
derived from issuer and client, while an explicit namespace remains fixed;
changing issuer, client, redirect, scopes, or timeouts for an already-owned
namespace throws
`NATIVE_BROKER_CONFIG_CONFLICT` rather than racing the vault.

`createZeroNativeAuth(options)` creates a direct owner without process-wide
deduplication. Reserve it for a trusted host that already guarantees exactly
one instance. `createNativeAuthClient(options)` is the lower-level issuer-based
constructor; ordinary Zero apps should prefer the `serverUrl` facade.

#### `ZeroNativeAuthOptions`

| Option | Type/default | Purpose |
|---|---|---|
| `serverUrl` | required string | Exact HTTPS Zero app origin or its `/auth` issuer; loopback HTTP is development-only |
| `clientId` | required string | Registered 1–128 character public client identifier |
| `browser` | `NativeSystemBrowser` | Opens the validated authorization URL in the system browser |
| `callback` | `NativeCallbackAdapter` | Arms and returns one loopback, claimed-HTTPS, or private-scheme callback session before the browser opens |
| `secureStorage` | `NativeSecureVault` | Async OS keychain/keystore storage for versioned session and pending records |
| `redirectUri` | optional string | Fixed registered redirect supplied to the callback adapter, normally used on mobile |
| `scopes` | `['profile', 'email']` | Requested identity claims; `openid` is always added |
| `storageNamespace` | derived from issuer/client | Vault prefix; changing it creates a different credential slot |
| `authorizationTimeoutMs` | `900000` | Full system-browser transaction deadline |
| `networkTimeoutMs` | `15000` | Discovery/token/revocation operation deadline |
| `clockSkewSeconds` | `30` | ID-token validation skew, from 0 through 300 seconds |
| `fetch` | global `fetch` | Injectable standards-compatible transport |
| `crypto` | global WebCrypto adapter | Injectable PKCE entropy/hash adapter; global WebCrypto is still required for JOSE verification |
| `now` | `Date.now` | Testable time source |

The runtime requires global `fetch`, `URL`, `TextEncoder`, and WebCrypto with
`getRandomValues` and `subtle`. React Native and Expo compatibility is not
implied; validate discovery and ES256/JWKS verification on each runtime.

#### `NativeAuthClient`

| Member | Result and behavior |
|---|---|
| `state` | Current `NativeAuthState` |
| `initialize()` | Discovers the provider, loads the vault, and rotates a stored session before reporting it authenticated |
| `signIn(options?)` | Runs one system-browser sign-in transaction |
| `signUp(options?)` | Runs the same transaction with Zero registration requested |
| `completeAuthorization(url, signal?)` | Completes a durable cold-launch callback |
| `refresh()` | Forces serialized refresh rotation when a stored session exists |
| `listTenants()` | Uses the credential owner's refresh proof to list safe live tenant summaries when discovery advertises the v1 tenant-session capability |
| `switchTenant(tenantId)` | Atomically replaces the native refresh family with one bound to the selected live membership and returns state containing the new safe `activeTenant` summary |
| `getUser()` | Returns validated identity claims or `null` |
| `getAccessToken()` | Returns a usable short-lived token or `null`; trusted integrations only |
| `fetch(input, init?)` | Same-origin Bearer fetch, proactive refresh, and one 401 refresh/retry; ambient cookies and automatic redirects are disabled |
| `signOut()` | Clears local pending/session state and attempts family revocation; a storage/revocation failure is reported even though memory state is signed out |
| `subscribe(listener)` | Observes safe state and returns an unsubscribe function |

States are `uninitialized`, `anonymous`, `authorizing`, `authenticated`, and
`error`. Only `authenticated` is a usable session. `identity` is the validated,
explicitly allowlisted OIDC projection (`sub` plus allowed profile/email
claims); unknown/private JWT claims are discarded before persistence or broker
IPC, and identity is not a substitute for fresh server authorization. Failures are `NativeAuthError` values with safe
`code`, `message`, and optional `status` fields.

`NativeTenantSummary` is the exact safe display projection
`{ tenantId, kind, slug, name, role }`. The required server-derived `kind` is
`'administration'` for the protected platform control plane and
`'organization'` for customer scope. Clients use it to keep navigation and
customer-only workflows in the correct realm; server authorization remains
authoritative.

#### Platform adapter contracts

```ts
interface NativeSecureVault {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

interface NativeSystemBrowser {
  open(url: string, options?: { signal?: AbortSignal }): Promise<void>;
  close?(): Promise<void>;
}

interface NativeCallbackAdapter {
  prepare(options: {
    redirectUri?: string;
    signal?: AbortSignal;
  }): Promise<NativeCallbackSession>;
}

interface NativeCallbackSession {
  readonly redirectUri: string;
  waitForCallback(signal?: AbortSignal): Promise<string>;
  dispose(): Promise<void>;
}
```

`prepare()` must finish arming capture before it resolves. Use the system
browser, never an embedded credential-collecting webview. Store session and
pending data in Keychain, Credential Manager/DPAPI, Keystore-backed encrypted
storage, or Secret Service—not renderer storage, ordinary preferences, or a
plain database/file.

The [desktop and mobile adapter recipes](../examples/native-auth/README.md)
provide dependency-free host interfaces. The desktop TypeScript recipe assumes
a trusted JavaScript owner such as Electron main or a deliberately secured
sidecar. Tauri's Rust process cannot directly host it; use the standalone
Rust/Tauri preview's Rust-owned engine and deny-by-default plugin boundary,
together with app-supplied audited OS vault, browser, callback, and
single-instance adapters.

#### Broker IPC

Keep one broker beside the vault, then expose only
`NativeAuthBrokerTransport.request()` and `subscribeState()` through trusted
IPC. Renderers create `createNativeAuthBrokerClient({ transport, serverUrl })`.
The proxy applies monotonically increasing broker revisions so an old response
cannot restore signed-out state. It can obtain short-lived access tokens for
its own authenticated fetch and Sync, but it never receives the refresh token
or vault interface. Call `dispose()` when the renderer/window closes.

Do not log serialized broker requests. Do not add vault, arbitrary URL-fetch,
or raw refresh commands to the fixed transport. Its
`completeAuthorization` command still passes through the SDK's exact callback,
state, and issuer validation; source cold-launch callbacks from the trusted host
when the platform permits rather than treating a renderer URL as trusted.

#### Sync integration

```ts
import { createNativeSyncAuth } from '@zero/framework/native';
import { createSyncClient } from '@zero/framework/sync/client';

const syncAuth = createNativeSyncAuth(auth);
const sync = createSyncClient({
  url: 'wss://app.example.com/sync',
  tables,
  ...syncAuth,
});
```

Spread all of `syncAuth` into `createSyncClient()` or `SyncProvider`. Its
`getToken` reads current access, `refreshAuth` rotates after a 4001 auth close,
and `bindAuthLifecycle` prevents unauthenticated cold-start connections, purges
local rows/mutations on sign-out or subject change, and reconnects only after a
valid identity appears.

#### Chrome and Rust/Tauri status

The separate private `@zero/chrome-auth` preview centralizes the native broker
in one MV3 service worker, uses `chrome.identity.launchWebAuthFlow()`, and gives
privileged extension pages a fixed revision-ordered message protocol with no
token or arbitrary-fetch command. Chrome extension storage is not worker-only,
so every privileged extension page and its CSP are inside the credential
boundary. Session mode targets Chrome 116+; opt-in local persistence targets
Chrome 140+. It is not a released package and still requires a versioned
framework peer, real-Chrome end-to-end testing, and security review.

The standalone Rust `zero-native-auth` and `tauri-plugin-zero-auth` crates are
functional private `0.0.0` previews. They implement strict OIDC/PKCE,
callback and ID-token validation, rotating refresh state through a required
secure-store adapter, tenant list/switch, bounded same-origin authenticated
HTTP, revisioned secret-free state, and explicitly permissioned Tauri commands.
They do not bundle OS keychain, browser, callback/deep-link, or single-instance
adapters and make no real-platform certification claim yet.

See [Desktop, Mobile, and Chrome Extension Authentication](auth/native-app-auth.md)
for registration, provider endpoints, redirect rules, continuation flows,
revocation, and deployment checks.

### React hooks

```tsx
'use client';

import { useAuth } from '@zero/framework/react';

function LoginPage() {
  const {
    user,
    isAuthenticated,
    isLoading,
    isRestoring,
    error,
    login,
    logout,
    register,
  } = useAuth();

  if (isRestoring) return null;

  if (isAuthenticated) {
    return (
      <div>
        <p>Hello, {user!.username} ({user!.role})</p>
        <button onClick={logout}>Logout</button>
      </div>
    );
  }

  return <button onClick={() => login('admin', 'password123')}>Login</button>;
}
```

### Available auth hooks

| Hook | Returns | Description |
|------|---------|-------------|
| `useAuth()` | `AuthState & AuthActions` | Full auth state, including persisted-session `isRestoring`, plus login/logout/register/refresh |
| `useAuthConfig()` | `AuthConfigState` | Shared client-scoped public registration/bootstrap/user-property config with explicit load/error/retry state |
| `useCurrentUser()` | `AuthUser \| null` | Just the user object |
| `useRequireAuth(redirectTo?)` | `AuthUser \| null` | Redirects to `/login` if not authenticated |
| `useUserProperty(key, options?)` | `UseUserPropertyResult<T>` | One configured current-user property plus its mutation state |
| `useAuthorization()` | `UseAuthorizationResult` | Active tenant and application authorization snapshots, plus permission checks |
| `useHasPermission(permission)` | `boolean` | Checks one permission across the active tenant and additive application scopes |
| `useHasAllPermissions(permissions)` | `boolean` | Checks every permission across the active tenant and additive application scopes |
| `useHasAnyPermission(permissions)` | `boolean` | Checks for any permission across the active tenant and additive application scopes |
| `useAuthorizationScopeBoundary()` | `AuthorizationScopeBoundary` | Stable boundary key for discarding work from a previous identity or tenant scope |
| `useAuthApiKeys(options)` | `UseAuthApiKeysResult` | Scope-fenced user API-key listing, pagination, issue/rotate/revoke, and exact server-projected mutation capability state |
| `useApplicationAccess(options?)` | `UseApplicationAccessResult` | Single/advanced application-role assignments and ownership actions |
| `useAuthAudit(options)` | `UseAuthAuditResult` | Paginated control-plane audit access for the active authority |
| `usePlatformAdministration(options?)` | `UsePlatformAdministrationResult` | Administration Organization members, invitations, roles, and ownership actions |
| `usePlatformTenants(options?)` | `UsePlatformTenantsResult` | Customer-organization directory, lifecycle actions, and safe member drill-in |
| `useTenantMembers(options?)` | `UseTenantMembersResult` | Active-organization member administration |
| `useTenantOnboardingAdministration(options?)` | `UseTenantOnboardingAdministrationResult` | Active-organization invitations and retained join requests |
| `useTenantSwitcher()` | `UseTenantSwitcherResult` | Tenant list, switching state, and session-transition fencing |
| `useTenantAppShellWorkspaces(options?)` | `AppShellWorkspaceConfig \| undefined` | Tenant choices projected for the packaged app shell |
| `useTenantDomainAdministration(options?)` | tenant domain administration state/actions | Active-tenant exact-domain claims and fixed-role request policy |
| `useDomainOnboarding(options?)` | mailbox-proof/request state/actions | Generic-before-proof request-to-join flow |

`UsePlatformAdministrationResult` exposes independently fenced config,
member, and invitation slices. Prefer `isLoadingConfig`/`configError`/
`reloadConfig()`, `isLoadingMembers`/`isMutatingMembers`/`membersError`/
`reloadMembers()`, and `isLoadingInvitations`/`isMutatingInvitations`/
`invitationsError`/`reloadInvitations()`. Public invitation policy is reported
through `invitationPolicyStatus`, nullable `invitationsEnabled`,
`invitationDelivery`, and `invitationConfigError`. Aggregate `isLoading`,
`isMutating`, `error`, and `reload()` fields are retained for compatibility.
Member pagination uses `memberPage`, `isLoadingMoreMembers`, and
`loadMoreMembers()`; invitation pagination independently uses
`invitationPage`, `isLoadingMoreInvitations`, and `loadMoreInvitations()`.
`isMutatingMembers` covers member and ownership writes only, while
`isMutatingInvitations` covers invitation writes only.

`UseTenantOnboardingAdministrationResult` independently reports invitation
and join-request loading, mutation, error, permission-denied, pagination, and
reload state. The independent protected-config slice uses `config`,
`isLoadingConfig`, `isConfigPermissionDenied`, `configError`, and
`reloadConfig()` and still loads when public onboarding features are disabled.
Public-policy state is available through `authConfigStatus`, `authConfigError`,
nullable `invitationsEnabled`, and nullable `joinRequestsEnabled`. Disabled or
unresolved capabilities do not issue their corresponding feature transport
requests. Invitation and join-request paging use their matching
`invitationPage`/`joinRequestPage`, `isLoadingMore*`, `loadMore*`, and `reload*`
fields. The compatibility aggregates are retained, but no single aggregate
list request backs this hook.

`useAuthConfig()` returns `status: 'unknown' | 'loading' | 'ready' | 'error'`,
`config`, `isLoading`, `error`, the derived `canRegister` and
`bootstrapRequired` flags, and `reload()`. Consumers of the same concrete auth
client share one immutable snapshot and coalesced ordinary load request; distinct
clients remain isolated. `reload()` forces a live read and fences superseded
responses. A failed load publishes `status: 'error'`, clears `config`, exposes
a browser-safe error, and resolves the reload so callers retry or render from
state rather than catching transport details. In contrast, the imperative
`useAuth().getConfig()` action uses that same shared controller and publishes
the same safe state, but rejects its original current transport, server, or
validation failure to preserve the established action contract. A superseded
imperative refresh rejects with `AbortError` and cannot publish stale config.
A successful
`useAuth().register()` invalidates the shared snapshot and starts a best-effort
replacement load because bootstrap may have changed registration policy.
Treat `unknown` and initial `loading` with no config as fail-closed. During a
forced reload, `loading` may retain the previous immutable config. The server
remains authoritative; public config is only a UI capability projection.

### Verified company-domain onboarding

The browser package exports strict request-only DTOs and transports,
`useTenantDomainAdministration`, `useDomainOnboarding`,
`TenantDomainManagement`, and `DomainOnboarding`, backed by the matching
server routes, DNS/mailbox proof services, and retained join requests. The
public capability appears only when multi-tenant verified-domain onboarding
and its email/public-URL dependencies are operational; otherwise the components
fail closed. No browser API accepts tenant, domain, or role authority during
user admission, and `/start` does not accept an email. Tenant administration
also exposes owner-default `releaseTenantDomainClaim()` and
`useTenantDomainAdministration().releaseClaim()`: both require current opaque
revisions and exact normalized-domain confirmation, preserve history, and
enforce a seven-day cross-tenant quarantine. Read
[Verified Company-Domain Onboarding](auth/verified-domain-onboarding.md) for
the exact contract, state fencing, configuration, and deliberate exclusions.

`AppProvider` also owns the default client-side protected-route behavior when
auth is enabled. If a restored or refreshed session fails and the current path
is protected, it removes protected route content and redirects to `loginPath`
with exactly one validated local `redirect` value. Client navigation can retain
path, query, and fragment; a direct server redirect retains path and query only.
After authentication on the login route, that deep link wins, then
`postLoginPath` (default `/`) is used. The defaults come from `createApp()` and
can be overridden with `<AppProvider routeAuth="explicit" publicPaths={...}
loginPath="/login" postLoginPath="/dashboard" />`.

Return paths that are external, scheme-relative, malformed, duplicate,
recursive, backslash/control-character, or canonicalization-unsafe are ignored.
Trailing slashes are equivalent when checking the login route. An explicit
same-route post-login fallback is rejected; `loginPath: '/'` with the implicit
default `/` fallback remains a compatibility no-op. Packaged/custom success
callbacks still run, but inside `AppProvider` they need not duplicate login
navigation.

### AuthUser shape

```ts
interface AuthUser {
  userId: string;
  username: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  status: 'active' | 'suspended';
  passwordChangeRequired: boolean;
  emailVerifiedAt: number | null;
  emailVerificationRequired: boolean;
  mfaRequired: boolean;
  properties: Record<string, string>;
  createdAt: number;
  updatedAt: number | null;
}
```

Login, registration, email actions, and password actions return
`AuthCompletionResult`: a session, an MFA setup/challenge continuation, a
tenant-selection/onboarding continuation, a password-updated result, or a
pending email-verification registration. The
email-verification variant has no access or refresh token:

`startMfaSetup({ method, label })` starts account-settings/profile enrollment
from the current session; `startMfaSetup({ setupToken, method, label })`
continues pre-session authentication. For profile enrollment,
`verifyMfaSetup({ verificationToken, code })` automatically sends the current
access bearer and the server requires it to resolve to the exact same live
web/native session that started setup. A different login—even for the same
user—or a changed/revoked authority returns `AUTH_STATE_CHANGED` (409), and the
caller should discard that setup result and restart enrollment. Custom HTTP
clients must likewise attach the originating bearer to
`POST /auth/mfa/setup/verify`; auth-flow setup remains bearer-optional.

```ts
interface AuthEmailVerificationRequiredResult {
  user: AuthUser & {
    emailVerifiedAt: null;
    emailVerificationRequired: true;
  };
}

const result = await client.register(params);
if (isAuthEmailVerificationRequiredResult(result)) {
  showCheckYourEmail(result.user.email);
}
```

Registration has the additive `AuthRegistrationResult` contract:

```ts
interface RegisterParams {
  username: string;
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  mfaEnrollment?: boolean;
  nativeContinuation?: string;
  bootstrapSecret?: string;
  organizationName?: string;
  organizationSlug?: string;
}

interface AuthRegistrationTenant {
  tenantId: string;
  kind: 'administration' | 'organization';
  membershipId: string;
  slug: string;
  name: string;
  role: string | null;
}

type AuthRegistrationResult = AuthCompletionResult & {
  tenant?: AuthRegistrationTenant;
};
```

When public auth config reports `tenancy.mode: 'multi'`, the initial bootstrap
requires `organizationName`; `organizationSlug` remains optional. The server
derives a slug when omitted and atomically creates the user, credential, first
protected `kind: 'administration'` organization, protected `owner`
membership, global/platform `admin` role, and durable bootstrap marker. Later
customer organizations use `kind: 'organization'`. This invariant applies
even if the configured later creation policy is `platform-admin` or
`disabled`.

After bootstrap, `organizationName` is optional. Omitting it registers only the
identity and, after any email/MFA gate, returns `tenantOnboardingRequired` with
no application credential. When email verification is pending, registration
does not issue an onboarding or tenant-creation proof; successful verification
runs completion and issues a fresh proof when the live policy permits creation.
That proof is hashed at rest, expiring, app-bound, and single-use. Supplying an
organization keeps the optional one-step create flow, but it is authorized
against the resulting identity and never means “join an existing organization.”

The packaged `RegisterForm` uses configured terminology, requires the tenant
only during bootstrap, and otherwise offers explicit optional creation only to
an eligible ordinary registrant. `AuthFlowContinuation` renders
`TenantCreationForm` for an eligible zero-membership result, or useful
invite/platform-admin guidance when creation is unavailable.

`result.tenant` is returned for the one-step organization-creating registration
flow. It is a safe summary, not tenant-session authority. The completed browser
session exposes `activeTenant`; call `listTenants()` and
`switchTenant(tenantId)` for live refresh-family-backed choices and atomic
switching. Multi-membership login uses
`selectTenant(continuation, tenantId)` and issues no app credential before that
one-time exchange. Zero-membership completion uses:

```ts
await client.createTenant({
  name: 'Acme Practice',
  continuation: result.onboarding.tenantCreation.continuation,
});

// An already signed-in eligible user omits continuation. The SDK supplies
// current refresh-family proof and activates the newly created tenant.
await client.createTenant({ name: 'Second Practice', slug: 'second-practice' });
```

For both proof forms, tenant, protected owner, proof consumption/rotation,
tenant-bound parent, and refresh issuance commit atomically. The SDK applies
the same authorization-scope barrier used for switching: it purges scoped
Sync/state/ephemeral data, pending work, and Zero-owned hook caches; rejects
stale response bodies; clears global overlays; and remounts or reloads the app
subtree before exposing replacement-scope UI. App-owned caches should key or
purge on `useAuthorizationScopeBoundary().key`.
Active-tenant member/role administration is available through
`getTenantAdministrationConfig()`, `listTenantMembers()`,
`addTenantMember()`, `updateTenantMember()`, `removeTenantMember()`, and
`transferTenantOwnership()`. The server derives tenant authority from the live
Bearer scope; these methods never send a tenant ID. See
[Tenant Member Administration](./auth/tenant-member-administration.md).

For `single/advanced`, application roles use the separate namespaced surface:

```ts
const config = await client.applicationAdmin.getConfig();
const users = await client.applicationAdmin.listUsers({ limit: 25 });
const target = users.users.find((user) => user.identity.userId === userId)!;
await client.applicationAdmin.replaceUserRoles(
  userId,
  ['reader'],
  target.roleRevision,
);
await client.applicationAdmin.transferOwnership(userId);
```

The same API is available through `useApplicationAccess()` and the packaged
`ApplicationAccessManagement` component. It never exposes or changes the
global platform role or account-security state. See
[Application Access Administration](./auth/application-access-administration.md).

For either multi profile, switch the live session into the protected
Administration Organization before using the platform namespace:

```ts
const config = await client.platformAdmin.getConfig();
const tenants = await client.platformAdmin.listTenants({
  status: 'active',
  search: 'acme',
  limit: 25,
});

if (config.capabilities.canCreateTenants) {
  await client.platformAdmin.createTenant({
    name: 'Acme Health',
    ownerEmail: 'owner@acme.example',
  });
}

await client.platformAdmin.addMember({
  email: 'operator@platform.example',
  roles: ['administrator'],
});
await client.platformAdmin.issueInvitation({
  email: 'auditor@platform.example',
  roles: ['access-manager'],
  delivery: 'email',
});
```

`client.platformAdmin` also manages administration members/invitations and
ownership, suspends/reactivates customer organizations with generation
fencing, and exposes capability-gated read-only customer-member drill-in. It
never accepts the administration tenant ID. Its add-member, role-replacement,
and invitation contracts use `AuthPlatformRoleSelection`, a non-empty tuple;
they cannot accidentally default to or clear into a customer role. A direct
role replacement also requires the target's `expectedRoleRevision`; the React
hook obtains and injects it from its current fenced member view. React consumers
can use
`usePlatformAdministration()`, `usePlatformTenants()`,
`PlatformAdministrationManagement`, and `PlatformTenantManagement`. See
[Platform Administration Organization](./auth/platform-administration.md).

### Vanilla JS auth

```ts
const client = createClient({ ... });

// Top-level (recommended) — most common auth operations
await client.login('alice', 'password123');
await client.register({ username: 'bob', email: 'bob@example.com', password: 'secret123' });
const authConfig = await client.getAuthConfig();
console.log(authConfig.tenancy?.mode ?? 'single');
console.log(authConfig.authorization?.mode ?? 'simple');
await client.forgotPassword('alice@example.com');
const action = await client.inspectActionToken('emailed-token');
await client.resetPassword('emailed-token', 'new-password123');
await client.setupPassword('emailed-token', 'first-password123');
await client.createTenant({ name: 'New Workspace' });
await client.logout();
console.log(client.user);            // AuthUser | null
console.log(client.isAuthenticated); // boolean

// Sanitized live UI hint; server routes remain authoritative.
const authorization = await client.getAuthorization();
console.log(authorization?.scope?.permissions ?? []);
console.log(authorization?.applicationScope?.permissions ?? []);
await client.refreshAuthorization();

// Additional auth operations
await client.changePassword('old-password', 'new-password123');
await client.setProperty('theme', 'dark');
await client.setProperty('notificationsEnabled', false);
const theme = await client.getProperty('theme');
await client.refresh();
```

In multi mode, `authorization.scope` remains the active tenant/membership
projection. An Administration Organization session additionally projects its
application permissions through additive `applicationScope`. The exported
permission helpers and `PermissionGate` check both planes; `TenantGate` checks
only the active tenant scope. The opaque top-level revision covers both scope
revisions and the installed authorization-registry version.

The capability fields are additive for mixed-version compatibility; absence
means `single/simple`. All four profiles normalize. Public tenancy config also
contains safe `terminology` and `creation.mode` values. `multi` enables current
tenant/membership persistence, bound browser sessions, selection/switching,
creation/onboarding, and registered-resource isolation. `advanced` enables a
validated server-only permission/role registry and pure authorization kernel;
durable application/tenant assignments and their packaged administration
surfaces are implemented. Multi mode also includes the protected
Administration Organization plus the `client.platformAdmin` namespace,
platform hooks, and packaged customer-organization lifecycle UI. Upstream
enterprise SSO remains separate future work, as do break-glass,
tenant-custom roles, broader populated-app discovery/migration tooling beyond
exact pre-024 administration reconciliation, and
verified-domain autojoin/aliases/direct transfer. The resource registry now
has independent server-owned client-exposure and field-access axes. Managed
file-mode runtimes sharing one SQLite database relay tracked Sync changes and
auth/session invalidations across active sockets. Under shared-row isolation,
multi-mode startup also validates actual non-partial tenant-leading indexes,
tenant-scoped business uniqueness, and composite tenant consistency for foreign
keys between registered tenant Resources; physical tenant isolation validates
the actor realm instead.

The live browser authorization projection, imperative subscription APIs, React
permission hooks, credential-free `useAuthorizationScopeBoundary()` cache key,
and packaged `PermissionGate`, `TenantGate`, `AdministrationScopeGate`, and
`PlatformAdminGate` are documented in
[Browser Authorization Snapshot and Gates](./auth/browser-authorization.md).
`AdministrationScopeGate` requires the active protected Administration
Organization. `PlatformAdminGate` checks the distinct legacy global
identity-admin role; neither gate grants or implies the other form of
authority.
See [Platform Administration Organization](./auth/platform-administration.md)
for the exact `client.platformAdmin`, `usePlatformAdministration`,
`usePlatformTenants`, and packaged-control contracts.

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

No need for `useClient()` + `client.collection()` -- `useCollection` is the
one-stop hook for reads and writes. Its `insert()` and `load()` inputs use
`InsertInput<T>`, so the generated primary key may be omitted while every other
required field remains required.

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
auto-wires generated detail-form updates back to the collection. For large
tables, use the same lazy `source` contract as `DataTableView`.

```tsx
<MasterDetailView
  schema={clientTable.schema}
  source={{
    type: 'lazy',
    table: 'clients',
    filters: { status: 'active' },
    options: { limit: 100, order: 'created_at', dir: 'desc' },
  }}
  listColumns={['first_name', 'last_name', 'status']}
  selectedId={selectedClientId}
  onSelectedIdChange={(id) => setSelectedClientId(id)}
  renderDetail={(client, ctx) => (
    <ClientProfile client={client} onSave={ctx.update} />
  )}
/>
```

For external sources, pass `source={{ type: 'data', data, actions, isLoading,
error, refresh }}` or use the legacy `data` plus `onUpdate` props.

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

The platform registers `GET /api/data` for eligible lazy tables. A registered
resource must permit HTTP (`http` or `all`) for this endpoint. If it also uses
lazy or auto-lazy Sync hydration, declare `exposure: 'all'`; `sync` alone
cannot reach `/api/data`. Use the `useLazyCollection` hook:

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
adds safe owner and mandatory tenant-realm constraints to the SQL query. After
an asynchronous resource policy, Zero re-resolves bearer and trusted-property
authority, then repeats the durable authority/property check inside the same
SQLite transaction as the resource query. For large lazy tables, add SQLite
indexes in migrations for columns you filter, sort, or constrain by frequently.
Server-owned policy and tenant constraints compare both SQLite storage class
and `BINARY` value, so column affinity or `COLLATE NOCASE` cannot broaden an
owner or tenant match. User-authored `filter=` expressions retain the table's
normal SQLite comparison behavior, but remain ANDed with those exact security
constraints.

The query-string contract is explicitly bounded before planning: table and
order identifiers are at most 128 characters, a request may contain at most
64 `filter` parameters, each filter is at most 4,096 characters, and `dir` is
at most four characters (`asc` or `desc`). Generated Resource list routes use
the same bounds. A rejected `/api/data` shape returns the fixed
`400 invalid-data-query` response; a rejected generated Resource list shape
returns `400 invalid-resource-query`. Neither validation response reflects the
rejected query value.

Registered resources may declare a shared field contract:

```ts
const attendanceFields = defineResourceFields({
  read: ['id', 'group_id', 'date', 'status'],
  create: ['group_id', 'date', 'status'],
  update: ['date', 'status'],
  filter: ['id', 'group_id', 'date', 'status'],
  sort: ['date', 'status'],
});

defineResource({
  table: attendanceTable,
  exposure: 'all',
  fields: attendanceFields,
  policy: authenticatedOnly(),
});
```

With `fields` present, only `read` leaves CRUD, `/api/data`, or Sync;
`create`/`update` reject every other raw client field; and filter/sort fields
must be readable. Server policy and realm fields are evaluated before
projection. The exposed primary key must be readable, is accepted as create
protocol identity, and is never updateable. `defineResourceFields()` is
client-safe, so the complete value can be passed to `CrudPage.resourceFields`.
For custom `AutoForm`/`useForm` composition, pass the appropriate field list to
`includeFields`, such as `attendanceFields.create` or
`attendanceFields.update`. See
[Resource Policy Core](./framework/resource-policy.md#field-projection-and-client-writes).

Use `authorizationPolicy(requirement)` inside a server-only resource
declaration to apply the same structured RBAC requirement used by route
`auth` and `context.access`:

```ts
defineResource({
  table: attendanceTable,
  exposure: 'all',
  realm: tenantRealm(),
  policy: {
    list: authorizationPolicy({
      tenant: 'required',
      permission: 'attendance:read',
    }),
    create: authorizationPolicy({
      tenant: 'required',
      permission: 'attendance:write',
    }),
  },
});
```

Zero validates the permission keys at startup and resolves live simple or
advanced roles for generated CRUD, lazy reads, and WebSocket Sync. Assignment
changes participate in the normal request/transaction or socket authority
fence. Other resource exposure choices are `internal`, `http`, and `sync`;
multi mode requires an explicit choice, while omitted exposure retains legacy
`all` behavior only in single mode. A `sync`-only resource must resolve to full
Sync rather than lazy loading. Omitted `actions` enables the standard five
operations, while explicit `actions: []` enables none. Per-action policy maps
reject unknown keys and actions not present in that declared set.

For registered resources, unconstrained `list` policy uses the normal full-sync
fast path. Owner-only or otherwise row-constrained resource lists use
per-connection row filters for snapshots, catchup, and live changes.
Registered creates use non-replacing inserts. Updates/deletes compare the exact
row snapshot evaluated by policy, while Zero's durable authority/property check
shares the SQLite transaction with the conditional write.

### Load options

```ts
const col = client.collection('attendance');

col.load(records);                      // Merge/upsert with existing rows
col.load(records, { replace: true });   // Replace ALL rows with these
col.clear();                            // Empty the local store (no server delete)
```

### How live changes work with lazy tables

Lazy mode omits the initial table snapshot; it does not create a live query
subscription for the HTTP filters passed to `useLazyCollection()`. Authorized
WebSocket inserts and updates for the subscribed table are applied to the local
collection by row id even when that row was not in the last `/api/data`
response, and deletes remove the local row when present. Resource row policy
still filters what each connection may receive.

Consequently, treat `useLazyCollection()` filters as the initial/paginated
load, not as a permanent client-side membership boundary. If a screen must
continue showing only matching rows, derive that view locally with
`useQuery()` or use `useDataPage()`/`useResourceList()` and refresh the page as
appropriate. Multiple filtered `useLazyCollection()` calls for the same table
share one local collection; a filtered load uses replacement semantics for
that table.

This means: once you `load()` an authorized set of rows, those rows stay live.
For row-constrained resource tables, sync changes are filtered per connection;
when an update moves a row out of scope, the client receives a delete for that
row.

---

## Server State Sync

Per-authorized-scope user key-value state, persisted on the server and synced
across devices. Single mode uses the user identity; multi mode derives an
isolated tenant + user principal from the live session.

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

**Requires** `stateSync: true` and `auth: true` in AppProvider/createClient config, plus `auth: true` in the server config. In full-stack apps, omitted `AppProvider` props are filled from the server-injected platform config. Single mode keys state by authenticated user; multi mode derives an isolated tenant + user principal from the live session.

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
    done: { useSwitch: true },
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

`collection` may be a collection object or a collection name. A collection name
requires `<AppProvider>` or `<ClientProvider>` so Zero can resolve the SDK
client. Forms that provide only `onSubmit`, or pass a collection object
directly, can run without a client provider.

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

## Kanban Board

`KanbanBoard` is a tokenized drag-and-drop board organism for records grouped
by caller-owned columns. It is controlled: pass `columns` and `items`, then
persist completed drops in `onItemMove`. Use `onItemClick` with Zero's
`modals.open` manager for edit/detail surfaces so modal behavior stays
consistent with the rest of the platform.

See [docs/frontend/kanban.md](./frontend/kanban.md) for the full reactive DB
wiring guide and custom card examples.

```tsx
import { KanbanBoard, useCollection } from '@zero/framework/react';

function TaskBoard({ columns }) {
  const tasks = useCollection('tasks');

  return (
    <KanbanBoard
      columns={columns}
      items={tasks.data}
      getColumnId={(column) => column.id}
      getColumnTitle={(column) => column.title}
      getItemId={(task) => task.id}
      getItemColumnId={(task) => task.column_id}
      getItemTitle={(task) => task.title}
      onItemClick={(task) => {
        console.log('edit card', task.id);
      }}
      onItemMove={(move) => {
        for (const columnId of new Set([move.fromColumnId, move.toColumnId])) {
          const itemIds = move.orderedColumnItemIds[columnId] ?? [];
          for (const [index, itemId] of itemIds.entries()) {
            tasks.update(itemId, { column_id: columnId, sort_order: index });
          }
        }
      }}
    />
  );
}
```

Use `zero add components/kanban` when an app needs editable component source.

### Radial Menu

Zero exposes the animated radial context menu through a package-safe subpath:

```tsx
import { RadialMenu } from '@zero/framework/components/radial-menu';
import { Copy, Settings, Trash } from '@zero/framework/icons';

<RadialMenu
  menuItems={[
    { id: 1, label: 'Edit', icon: Settings },
    { id: 2, label: 'Duplicate', icon: Copy },
    { id: 3, label: 'Delete', icon: Trash },
  ]}
  onSelect={(item) => runAction(item.id)}
>
  <button type="button">Right-click me</button>
</RadialMenu>
```

Use it for compact item-level actions such as sidebar records, board items, or
canvas nodes. Keep destructive behavior behind a confirmation modal.

---

## Routing

File-based routing is registered from the configured `app/` directory
(`appDir`, default `./app`). A page/layout chain containing a literal
`'use client'` directive is emitted into the browser manifest and mounted with
`createRoot()`. A chain without a client boundary is streamed on the server and
ships no route JavaScript; navigating to one of those server-only routes uses a
normal document request.

### Hooks

| Hook | Returns | Description |
|------|---------|-------------|
| `useParams()` | `Record<string, string>` | URL parameters (e.g., `/todos/[id]` → `{ id: '123' }`) |
| `usePathname()` | `string` | Current URL pathname |
| `useRouter()` | `{ push, replace, back, prefetch, isNavigating }` | Client-route navigation state/actions |

### `<Link>`

Client-side navigation link.

```tsx
import { Link } from '@zero/framework/react';

<Link href="/todos">All Todos</Link>
<Link href={`/todos/${todo.id}`} prefetch="intent">Edit</Link>
```

`Link` defaults to `prefetch="none"`. `prefetch="intent"` loads a registered
client route on pointer hover. The currently accepted `"render"` value does not
trigger eager or viewport prefetching; call `useRouter().prefetch(path)` when
you need explicit preload behavior. Unknown and server-only routes fall back to
a full document navigation when clicked.

### Advanced router API

```ts
import { registerRoute, matchClientRoute, navigateTo, prefetchRoute } from '@zero/framework/react';

registerRoute('/custom', () => import('@app/custom/page'));
const loaded = await navigateTo('/custom');
prefetchRoute('/custom');
```

These low-level functions manage the generated client-route registry and
module cache. `navigateTo()` loads a match and returns its page, layouts, and
params; it does not update browser history. Normal application navigation
should use `Link` or `useRouter()`.

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
<ThemeTogglerButton variant="ghost" size="default" modes={['light', 'dark']} />
```

### `<Toaster>`

Zero's Sonner host for app feedback and notification toasts. Mount it once in
the root layout under `ThemeProvider`. The default host uses Zero's token
contract for popover surfaces, borders, shadows, semantic state rails, and
state icons, so `toast.success`, `toast.error`, `toast.warning`, and
`toast.info` match the rest of the component system.

```tsx
import { ThemeProvider, Toaster } from '@zero/framework/react';

<ThemeProvider defaultTheme="system" storageKey="zero-theme">
  <App />
  <Toaster />
</ThemeProvider>
```

Apps can still pass normal Sonner props when they need a different position,
duration, icon set, or class override.

---

## Notifications

Real-time notification system with rich targeting, read receipts, and auto-toast. Notifications flow through the existing reactive sync layer — zero extra infrastructure.

### Server Setup

`createApp()` mounts auth, Scheduler, and Notifications in dependency order.
Do not mount them a second time in a normal Zero app. The following is only for
a low-level standalone Elysia composition that already owns a `ReactiveDB`:

```ts
import { Elysia } from 'elysia';
import {
  createAuthPlugin,
  createNotificationPlugin,
  createSchedulerPlugin,
  installAuthStopBarrier,
} from '@zero/framework/server';

const app = installAuthStopBarrier(
  new Elysia()
    .use(createAuthPlugin({ db }))
    .use(createSchedulerPlugin())
    .use(createNotificationPlugin({ db })),
);
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
import { getNotificationService } from '@zero/framework/server';

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

The frontend SDK automatically merges platform table schemas/types needed by
notification, room, workflow, and Storage integrations. Schema availability
does not make rows readable: default `createApp()` policy scopes notification,
room, and workflow execution rows and keeps Storage metadata private from
generic Sync. App code should pass only its app tables to `createClient()` or
`AppProvider`.

### Receipt System

Receipts track per-user notification state. Client actions call authenticated
notification routes; the service writes `notification_receipts` through
ReactiveDB, and Sync returns a receipt change only to its owning user.

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
| `GET` | `/:id` | target user | Get an actually targeted notification; inaccessible and missing IDs both return 404 |
| `POST` | `/:id/seen` | target user | Mark seen |
| `POST` | `/:id/read` | target user | Mark read |
| `POST` | `/:id/dismiss` | target user | Dismiss |
| `POST` | `/read-all` | user | Mark all read |
| `POST` | `/seen-all` | user | Mark all seen |
| `GET` | `/:id/receipts` | admin | Receipt audit trail |
| `DELETE` | `/:id` | admin | Delete notification |

### Data Flow

```
Server:  notifier.notify('u_abc', { title: 'Report ready' })
  → db.insert('notifications', ...)
  → ReactiveDB onChange → platform row policy checks each subscription
  → only u_abc's eligible connection receives the notification row
  → SyncClient store update → useCollection re-render
  → useNotifications() renders the already-scoped collection
  → NotificationProvider detects new → toast('Report ready')
  → User clicks → markRead() → POST /notifications/:id/read
  → NotificationService verifies target again and updates u_abc's receipt
  → receipt row returns only to u_abc through scoped Sync
  → Admin: getReceipts(id) reads the protected HTTP audit projection
```

Administrator receipt audit is not a generic live receipt subscription. Refetch
or poll `getReceipts(id)` when that view needs later updates; generic Sync sends
each receipt row only to its owning user.

---

## Storage

Authenticated file storage with drive metadata in ReactiveDB and blob bytes
behind a storage adapter. Local filesystem storage is the default adapter.

Storage metadata tables are registered as platform client types, but default
`createApp()` composition keeps `storage_drives` and `storage_objects` private
from generic Sync reads and writes. The official Storage hooks use the
permission-aware HTTP API for metadata and file operations. This avoids both
cross-user metadata exposure and per-socket scans of a global object table.

Presigned URLs and scoped upload grants use one HMAC capability key. Managed
`createApp()` configuration accepts `storage.signingSecret` (or
`ZERO_STORAGE_SIGNING_SECRET`) and `storage.defaultPresignedTTL`. If no secret
is supplied, Zero generates 32 random bytes once and stores the key in the
private app config table, so capabilities survive a durable-database restart
and work across runtimes sharing that database. Set an explicit shared secret
for ephemeral databases or replicas with separate databases. Changing the
secret invalidates outstanding capabilities.

### Hooks

```tsx
const { drives } = useStorageDrives();
const { items, refresh } = useStorageFolder(driveId, '/reports', {
  type: 'file',
  sortBy: 'updated_at',
  sortDir: 'desc',
});
const { capabilities } = useDriveCapabilities(driveId);
const permissions = useStoragePermissions(capabilities?.canAdmin ? driveId : null);
const { upload, progress } = useUpload();
const actions = useStorageActions();

await actions.createDrive('Reports', { public: false });
await upload(driveId, file, { path: '/reports/q2.pdf', overwrite: true });
await actions.grantPermission(driveId, {
  grantType: 'property',
  grantKey: 'department',
  grantValue: 'accounting',
  permission: 'read',
});
```

Property grants are authorization policy, not profile convenience fields. The
`grantKey` must name an `auth.userProperties` field with
`useInPolicies: true`, and that field must be editable only by `admin`,
`system`, or `none`. Unknown and user-editable keys are rejected. Persisted
legacy grants with an unsafe key no longer grant access.

Storage hooks use the SDK client for authenticated transport. JSON routes call
`client.fetch()`, so session restoration, bearer injection, 401 refresh, and
authorization-scope fencing match the rest of the frontend SDK. Uploads still
use `XMLHttpRequest` for progress events, but each attempt receives its bearer
from the same auth controller, waits for restoration, retries once after a
successful refresh, and aborts when the account or tenant boundary changes.

Storage drive responses include an `access` object for the current caller:
`effectiveAccess`, `canRead`, `canWrite`, `canAdmin`, `isOwner`,
`isPlatformAdmin`, and `isPublic`. Use that for UI state only; the backend still
enforces every action.

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
const grants = storage.permissions.list(drive.drive_id);
```

`createStoragePlugin()` supplies the policy-trust validator from the live auth
configuration. Code that constructs `new StorageService(...)` directly and
uses property grants must inject the equivalent callback:

```ts
const storage = new StorageService(db, adapter, {
  isPolicyTrustedProperty: (key) => trustedPolicyKeys.has(key),
});
```

Without that callback, direct-service role and user grants continue to work,
but property grants deliberately fail closed. Audit existing persisted
property grants before upgrading; unsafe or unrecognized keys are ignored.

For public intake, resume-token, avatar, or guest document flows, backend code
can issue a scoped upload grant. The grant lets an unauthenticated browser
upload to one exact path, while the uploaded object stays private unless
`public: true` is set:

```ts
import { t } from 'elysia';
import { defineEndpoint } from '@zero/framework/server';

export default defineEndpoint({
  method: 'POST',
  path: '/api/intake/:id/upload-grant',
  auth: false,
  params: t.Object({ id: t.String({ minLength: 1, maxLength: 100 }) }),
  body: t.Object({
    resumeToken: t.String({ minLength: 32, maxLength: 4096 }),
  }),
  handler: async ({ body, params, zero }) => {
    if (!zero.storage || !zero.tokens) {
      return Response.json({ error: 'Service unavailable' }, { status: 503 });
    }

    try {
      zero.tokens.verifyResumeToken(body.resumeToken, {
        flow: 'intake',
        resource: { type: 'intake', id: params.id },
      });
    } catch {
      // Keep public failures generic and never log or return the raw token.
      return Response.json(
        { error: 'Invalid or expired continuation' },
        { status: 403 },
      );
    }

    const grant = await zero.storage.uploads.create('drv_private_intake', {
      path: `/intakes/${params.id}/insurance-front.png`,
      expiresIn: 15 * 60,
      maxSize: 5 * 1024 * 1024,
      contentTypes: ['image/png', 'image/jpeg', 'application/pdf'],
      metadata: { intakeId: params.id, kind: 'insurance-front' },
      flow: 'intake',
      resource: { type: 'intake', id: params.id },
    });

    return grant;
  },
});
```

The path parameter only selects the candidate intake; it is not authority.
The reusable resume token must match both the expected flow and exact resource
before the server creates the short-lived, single-path upload capability. Add
the app's normal public-endpoint rate limit as well. Do not place the resume or
upload-grant token in logs, metadata, or URLs that analytics/proxies retain.

The browser then uploads with:

```ts
await fetch(`/storage/upload-grants/${grant.token}`, {
  method: 'PUT',
  headers: { 'content-type': file.type },
  body: file,
});
```

Upload grants are signed storage capabilities. They do not grant read access,
they default to no overwrite, and they add `storageUploadGrantId` plus optional
flow/resource metadata to the stored object.

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

`StorageManagement` composes smaller drive-list, settings, permission,
file-browser, drive-header, dropzone, and file-detail components. It uses the
storage hooks above, so it must be rendered inside `AppProvider` or
`ClientProvider`.

The management organism shows effective access, disables write/admin controls
when the backend says the user lacks capability, manages role/user/property
permission grants, filters/sorts folder contents, uploads through
`StorageDropzone`, and creates presigned download links for private files.

### REST API

All routes are prefixed with `/storage`.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/drives` | optional | List current user's drives, or public drives when anonymous |
| `POST` | `/drives` | user | Create a drive |
| `GET` | `/drives/:driveId` | optional | Get public drive info, or private drive info for an authorized user |
| `GET` | `/drives/:driveId/capabilities` | read | Current caller's effective storage access |
| `PATCH` | `/drives/:driveId` | admin | Update drive settings |
| `DELETE` | `/drives/:driveId` | admin | Delete a drive |
| `GET` | `/drives/:driveId/usage` | read | Drive usage stats |
| `POST` | `/drives/:driveId/upload` | write | Multipart file upload |
| `GET` | `/drives/:driveId/files/*` | read/public | Download file, with Range and ETag support |
| `GET` | `/drives/:driveId/list` | read | List folder contents |
| `POST` | `/drives/:driveId/folders` | write | Create folder |
| `POST` | `/drives/:driveId/move` | write | Move or rename file/folder |
| `POST` | `/drives/:driveId/copy` | write | Copy a file |
| `DELETE` | `/drives/:driveId/files/*` | write | Delete file/folder |
| `PATCH` | `/drives/:driveId/visibility` | admin | Change drive or object visibility |
| `GET` | `/drives/:driveId/permissions` | admin | List drive/object permissions |
| `POST` | `/drives/:driveId/permissions` | admin | Grant drive/object permission |
| `DELETE` | `/permissions/:permissionId` | admin | Revoke permission |
| `POST` | `/drives/:driveId/presign` | read/write | Create a presigned URL |
| `GET` | `/presigned/:token` | token | Presigned download |
| `PUT` | `/presigned/:token` | token | Presigned upload |
| `POST` | `/drives/:driveId/upload-grants` | write | Create a scoped public upload grant |
| `PUT` | `/upload-grants/:token` | token | Execute a scoped public upload grant |
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
  installAuthStopBarrier,
} from '@zero/framework/server';

const app = installAuthStopBarrier(new Elysia()
  .use(createAuthPlugin({ db }))
  .use(createStoragePlugin({ db, localDir: '.storage' })));

app.listen(3000);
// Later: await app.stop(); db.dispose();
```

Standalone `createStoragePlugin()` uses the same database-backed generated key
when `signingSecret` is omitted. Pass `signingSecret` explicitly when separate
plugin runtimes must share capabilities without sharing their database.

---

## Scheduler

Generic centralized scheduler using `croner`. Any plugin can register cron jobs. Admin API for visibility and control.

### Server Setup

`createApp()` already mounts Scheduler before dependent platform plugins. Only
standalone Elysia compositions should mount `createSchedulerPlugin()`
themselves:

```ts
import { createSchedulerPlugin } from '@zero/framework/server';

// Standalone Elysia only: mount after auth and before dependent plugins.
app.use(createSchedulerPlugin());
// Or choose a custom admin route prefix:
app.use(createSchedulerPlugin({ prefix: '/admin/scheduler' }));
```

Choose one of those two mounts, not both.

### Registering Jobs

```ts
// server/plugins/report-jobs.ts
import { defineZeroPlugin } from '@zero/framework/server';

export default defineZeroPlugin({
  name: 'report-jobs',
  setup({ app, zero }) {
    return app.onStart(() => {
      zero.scheduler?.create({
        name: 'daily-report',
        pattern: '0 0 9 * * *', // 9:00 AM daily (six fields, including seconds)
        timezone: 'America/New_York',
        run: async () => {
          await generateReport();
          zero.notifications?.notifyRole('admin', {
            title: 'Daily report ready',
          });
        },
      });
    });
  },
});
```

Scheduler services are initialized during application start, so register jobs
from `onStart` (or after `app.listen()`), not at module-import time.

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

For the layered component map, source-folder status, and known overlap cleanup
targets, see [Component Inventory](frontend/component-inventory.md).

### Layout & Container

| Component | Description |
|-----------|-------------|
| `AppShell`, `AppShellHeader`, `AppShellBreadcrumbs`, `AppShellSidebar` | App-ready dashboard/admin shell with Animate UI/Radix sidebar, optional breadcrumbs/header content, workspace switcher, nested nav, item action menus, footer user menu, and shell presets |
| `SidebarProvider`, `Sidebar`, `SidebarInset`, `SidebarTrigger`, `SidebarContent`, `SidebarHeader`, `SidebarFooter`, `SidebarRail`, `SidebarMenu`, `SidebarMenuButton`, `SidebarMenuAction` | Low-level sidebar primitives for custom shells |
| `ResizableNavbar`, `Hero`, `FeaturesSection`, `CodeBlock`, `CtaSection`, `FooterSection`, `Faq`, `ExpandableCards`, `BentoGrid`, `AnimatedList` | Public route sections for landing pages, docs, content pages, and public flows |
| `Breadcrumb`, `BreadcrumbList`, `BreadcrumbItem`, `BreadcrumbLink`, `BreadcrumbPage`, `BreadcrumbSeparator`, `BreadcrumbEllipsis` | Tokenized breadcrumb primitives used by `AppShellBreadcrumbs` |
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
| `DatePicker` | Typed date input + animated Popover + Calendar. `M/D/YYYY` and `M-D-YYYY` (one- or two-digit month/day, four-digit year) normalize to the long display and select the same calendar date. Props include `value?`, `onChange?`, `placeholder?`, `disabled?`, `transition?`, and `calendarProps?` for bounded month/year navigation and disabled dates. |
| `DateRangePicker` | Range variant with two months. Props: `value?: DateRange`, `onChange?`. Auto-closes on complete range. |
| `TimePicker` | Token-aware hour/minute/period control. Emits canonical `HH:mm`; supports `minuteStep?`, `disabled?`, `name?`, and accessible labels. |
| `Combobox` | Searchable select with cmdk. Props: `options: ComboboxOption[]`, `multiple?`, `searchable?`, `placeholder?`. Supports icons, groups, descriptions, multi-select with animated tag chips. |
| `TagInput` | Chip-based tag input with keyboard support. Props: `value?: string[]`, `onChange?`, `maxTags?`, `allowDuplicates?`, `delimiter?`, `suggestions?`, `onSearch?`. Animated add/remove (spring 300/25). |
| `Command`, `CommandDialog`, `CommandInput`, `CommandList`, `CommandEmpty`, `CommandGroup`, `CommandItem`, `CommandSeparator`, `CommandShortcut` | cmdk-based command palette. `CommandDialog` uses animated Dialog (Pattern B: 3D flip). |

### Data Display

| Component | Description |
|-----------|-------------|
| `Badge`, `badgeVariants` | Status tags: default, secondary, destructive, warning, outline |
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
| `Toaster` | Zero-themed toast notification container with Sonner behavior |
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

From the [animate-ui](https://animate-ui.com) library. App code should import
from Zero's public package paths, not internal source aliases.

### Radix Components (Animated)

Animated wrappers around Radix UI primitives. All include enter/exit transitions.

```tsx
import { Sidebar, SidebarProvider } from '@zero/framework/components/sidebar';
import { DropdownMenu, DropdownMenuTrigger } from '@zero/framework/components/dropdown-menu';
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
| **Sidebar** | `Sidebar`, `SidebarProvider`, `SidebarTrigger`, `SidebarContent`, `SidebarHeader`, `SidebarFooter`, `SidebarMenu`, `SidebarMenuItem`, `SidebarMenuButton`, `SidebarMenuAction`, `SidebarMenuSub`, `SidebarMenuSubButton`, `SidebarGroup`, `SidebarGroupLabel`, `SidebarGroupContent`, `SidebarRail`, `SidebarInset`, `useSidebar` |
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

`RadialMenu` is also available from
`@zero/framework/components/radial-menu` for package-mode apps.

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

Named icon imports are animation-capable. Zero's shared `Button` automatically
drives nested Zero icons on hover and tap. Outside `Button`, icons stay static
unless `animate`, `animateOnHover`, `animateOnTap`, or an `AnimateIcon` parent
drives them.

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
  db: { mode: 'memory' },
  tables,  // defineTable() output — auto-extracts server definitions
  auth: true,
});
const app = await createApp(config);

app.listen(3000);
```

Import `@zero/framework/server` only from server-owned code: the server entry,
discovered backend extensions under `server/`, and server-only route handlers.
Browser pages/components import from `@zero/framework/react`.

The server always provides:

- `/sync` — WebSocket endpoint for real-time data sync, first-message Bearer auth, sync policy, and registered resource read/mutation policy
- `zero.tokens` — server-side generic action/resume token service for secure links and public continuation flows
- `/scheduler/*` — Admin job management (via `createSchedulerPlugin`)
- File-based routing from the configured `app/` directory
- streaming SSR for server-only page chains

Configuration adds routes and services conditionally:

- `auth` adds `/auth/*`, Notifications, Rooms, Workflows, Storage, and their authenticated routes. With auth disabled, those auth-dependent plugins are not mounted.
- `pdf` adds the server-only `zero.pdf` service; Zero does not mount a public PDF route.
- `ai`, `vector`, and `sitemap` add their respective configured services/routes.
- Observability enables `/api/_zero/observability/events` by default; `observability: false` or a disabled endpoint removes that HTTP surface.
- `resourceRoutes: false` disables only generated `/api/resources/*` CRUD
  routes. Registered `exposure` still controls `/api/data` and Sync.
- KV is enabled by default and provides `zero.kv`, `zero.counter`, and `zero.limiter`; `kv: false` disables those services.

Client page/layout chains containing `'use client'` mount in the browser with
`createRoot()`. Server-only chains stream with React 19
`renderToReadableStream` and ship no route JavaScript.

#### Auth Capability Configuration

`defineAuthConfig()` preserves the authored type while
`resolveAuthBehaviorConfig()` deterministically normalizes the two independent
axes. Omitted values mean `tenancy: 'single'` and `authorization: 'simple'`;
`multi` and `advanced` are also recognized and normalized.

The object form of `authorization` accepts a server-only permission registry
and static role templates:

```ts
const auth = defineAuthConfig({
  tenancy: 'multi',
  authorization: {
    mode: 'advanced',
    registryVersion: 1,
    permissions: {
      'records:read': { label: 'Read records' },
      'records:write': { label: 'Edit records' },
    },
    roles: {
      reviewer: { permissions: ['records:read'] },
      owner: { allPermissions: true, system: true },
    },
  },
});
```

Permission keys must be lowercase namespaced keys; role keys are lowercase
stable identifiers. Unknown fields, invalid keys, duplicate role-permission
references, undeclared permissions, and `allPermissions` mixed with explicit
permissions are rejected during normalization. `registryVersion` defaults to
`1` and must increase before a same-profile change to permission/role
semantics. Migration `027` persists its semantic fingerprint; same-version
drift or rollback fails startup with
`AUTHORIZATION_REGISTRY_VERSION_REQUIRED`, and a retired role key cannot
silently reactivate retained assignments. Label/description-only changes do
not require a bump. Public `/auth/config` exposes only safe capability data:
the tenancy and authorization modes plus configured tenant terminology and
creation mode. It never exposes the registry version/fingerprint, permission
registry, role templates, or other server-only policy internals. See
[Platform Configuration](./platform-configuration.md#installed-auth-profile-and-mode-upgrades)
for deployment and stale-runtime behavior.

`createAuthorizationKernel(resolvedAuth)` returns the transport-neutral policy
engine. Its primary methods are `compile(requirement, parent?)`,
`merge(parent, child)`, `evaluate(requirement, subject)`,
`authorize(requirement, subject)`, `isValidScopeSnapshot(scope)`, and the exact
`single/simple` compatibility helper `synthesizeSingleSimpleScope(input)`.
Structured requirements can express platform role, required tenant, scope role,
all/any permissions, and policy-trusted user-property matchers. Parent/child
merges are monotonic.

The kernel remains pure; the request, file-router, resource, data-query, Sync,
token, and page-session adapters hydrate its live subject and scope. Multi-mode
tenant/membership persistence, durable tenant-bound sessions,
selection/switching, optional creation, registered-resource isolation, durable
advanced assignments, and active-tenant member/role administration are
present. Exact-email invitations, invitation-bound account creation, retained
join-request review/re-admission, and their packaged hooks/components are also
present; see
[Tenant Invitations and Join Requests](./auth/tenant-invitations-and-join-requests.md).
Opt-in request-only verified-domain onboarding is backed by exact DNS
and current-mailbox proof, retained provenance, server routes/configuration,
and the packaged browser surface.

The [Auth And Data-Plane Capability Matrix](./auth/auth-data-plane-capability-matrix.md)
maps each official transport and service to its enforcement owner, live scope
source, focused tests, and deliberate trusted escape hatch. Use the
[implementation checklist](./auth/multi-tenant-auth-implementation-checklist.md)
for the unreleased candidate's final delivery and release gates.

#### ReactiveDB Fabric: Actor-Backed Multi-Database Tenancy

ReactiveDB Fabric is the conceptual name for Zero's isolated multi-database
runtime. `ReactiveDB` names each reactive database; Fabric owns routing,
actors, concurrency, isolation, and lifecycle across many databases. The
typed configuration surface is `databaseTopology`.

`databaseTopology` adds bounded actor-owned SQLite files without changing the
default database API. Omitting it preserves single-database behavior. In
physical tenant mode, the existing `db` remains the pinned control/default
database for identity, sessions, memberships, role assignments, platform
tables, and global/shared app resources; each selected tenant's application
resources use a separate actor-owned database whose placement is file/WAL or a
bounded hot snapshot runtime.

Define the tenant schema as a side-effect-free actor realm and branch the same
server entry before ordinary app startup:

```ts
import {
  authenticatedOnly,
  createApp,
  defineDatabaseRealm,
  defineResource,
  defineZeroConfig,
  runDatabaseActorIfRequested,
  tenantRealm,
} from '@zero/framework/server';
import { documentTable, tables } from './lib/schemas';

const tenantServerTables = {
  documents: documentTable.serverTable,
};

const tenantData = defineDatabaseRealm({
  name: 'my-app-tenant-data',
  version: '1',
  tables: tenantServerTables,
  migrations: [],
  // Optional actor-local synchronous handlers, called by registered name:
  queries: {
    'documents.countOpen': ({ database }) => {
      const row = database.prepare(`
        SELECT count(*) AS count
        FROM documents
        WHERE status = ?
      `).get('open') as { count: number };
      return { count: row.count };
    },
  },
  commands: {
    'documents.archive': ({ db }, input) => {
      const { documentId } = input as { documentId: string };
      const change = db.update('documents', documentId, {
        status: 'archived',
      });
      return { updated: change !== null };
    },
  },
});

const config = defineZeroConfig({
  db: { mode: 'file', path: './data/control.db' },
  tables,
  auth: { tenancy: 'multi' },
  resources: [
    defineResource({
      table: 'documents',
      realm: tenantRealm(),
      exposure: 'all',
      policy: authenticatedOnly(),
    }),
  ],
  databaseTopology: {
    mode: 'multiple',
    rootDirectory: './data/tenant-databases',
    realm: tenantData,
    actors: {
      launch: { kind: 'source', entrypoint: import.meta.path },
      // env: { ALLOWLISTED_NAME: Bun.env.ALLOWLISTED_NAME ?? '' },
    },
    tenantIsolation: 'tenant-database',
    placement: 'file',
    maxDatabases: 16,
    maxDatabaseFiles: 10_000,
    maxTenantSyncDatabases: 15,
    maxTenantSyncBindingsPerDatabase: 64,
    readers: true,
  },
});

if (!await runDatabaseActorIfRequested({ realm: tenantData })) {
  const app = await createApp(config);
  app.listen(config.port);
}
```

Every actor-realm table must declare exactly one primary-key column with SQLite
`TEXT` or `INTEGER` affinity. `TEXT` is recommended; stored integer keys must
remain JavaScript safe integers and cross Fabric/Sync as canonical string row
IDs. `defineDatabaseRealm()` rejects `REAL`, `BLOB`, `NUMERIC`, typeless, and
composite primary keys with `DATABASE_CONFIG_INVALID` before opening an actor
or database file. Each schema value must remain one isolated column definition;
top-level separators, injected table constraints, ambiguous quoted multi-token
declared types, and unterminated quotes or comments fail before SQL generation.

Every other actor-realm column must have `TEXT`, `INTEGER`, `REAL`, or
`NUMERIC` affinity. `BLOB`, typeless, and generated columns are rejected because
Fabric rows and receipts use the canonical JSON-compatible actor value
contract, while generated columns are not writable by ReactiveDB. Column
foreign keys may use `RESTRICT` or `NO ACTION`; `CASCADE`, `SET NULL`, and
`SET DEFAULT` are rejected in favor of explicit tracked command writes. Realm
table names may not use `sqlite_`, `_zero_`, `idx_zero_`, `_changes`,
`_change_sequence`, or `_migrations`, and an `_identity` index name may not
collide with a table or reserved object. These known incompatibilities fail
from `defineDatabaseRealm()` with `DATABASE_CONFIG_INVALID`; actor startup
still compiles the full SQLite schema and independently verifies its physical
shape.

The `database` field in a registered query is a
`DatabaseReadQueryConnection`, not a Bun SQLite handle. Its complete public
surface is:

| Capability | Read-only methods |
| --- | --- |
| `DatabaseReadQueryConnection` | `query(sql)`, `prepare(sql, params?)` |
| `DatabaseReadQueryStatement` | `all(...)`, `get(...)`, `iterate(...)`, `values(...)`, `raw(...)` |

Only one `SELECT` or read-only `WITH ... SELECT` statement is accepted. SQL
comments, statement separators, mutation/DDL/PRAGMA statements, extension
loading, every quoted or unquoted `pragma_*` token (including the literal
spelling), and invocations of file helper functions are rejected. File-helper
function names remain usable as ordinary columns, aliases, or string literals
when they are not invoked. The capability exposes no database path, `run`,
`exec`, transaction,
handle, native statement, or extension-loading surface. Reader actors use their
readonly SQLite connection; file writer queries reuse the already
identity-verified writer handle inside a serialized SQLite `query_only`
boundary, so they never reopen its pathname; hot writer queries use a readonly
snapshot.
Query handlers are synchronous, so consume an `iterate()` result inside the
handler rather than retaining it. Zero finalizes all statements and closes
owned snapshots immediately after the handler.

The `db` field in a registered command is a
`DatabaseWriteCommandCapability`, not a `ReactiveDB` or Bun SQLite handle.
`DatabaseWriteCommandCapability`, `DatabaseWriteCommandContext`, and
`DatabaseWriteCommandHandler` are server-only exports. The capability is a
frozen, null-prototype facade with this complete surface:

| Group | Tracked methods |
| --- | --- |
| CRUD | `insert`, `create`, `createStrict`, `createScoped`, `update`, `updateIfCurrent`, `updateScoped`, `delete`, `deleteIfCurrent`, `deleteScoped` |
| Reads | `query`, `list`, `queryOne`, `get`, `getScoped` |
| Natural identity | `getIdentity`, `identityKey`, `queryByIdentity`, `upsertByIdentity`, `updateByIdentity`, `deleteByIdentity` |
| Transaction lifecycle | `transaction`, `afterCommit` |

It intentionally omits `exec`, `prepare`, raw database/service handles, schema
definition, listeners, lifecycle controls, and internal-change APIs. Zero
constructs the context inside the writer and runs the handler and result
validation in one transaction. Nested `transaction()` calls remain in that
managed transaction; `afterCommit()` retains ReactiveDB's best-effort,
synchronous callback contract. Zero revokes the facade after result validation
and before post-commit callbacks run, so retained reads, writes, transactions,
and post-commit registration fail with `DATABASE_CLOSED`, including from an
`afterCommit()` callback.

Registered query/command inputs and returned values must satisfy
`DatabaseSerializableValue` and the normal payload/result budgets. Invalid
caller input is a `DATABASE_PAYLOAD_*` error; invalid or oversized handler
output is `DATABASE_RESULT_LIMIT` on both reader and writer lanes. Application
callers invoke the registered query name through `zero.data.query(...)`; they
never submit SQL. Registered writes use the same name-only boundary and require
the normal durable idempotency key:

```ts
const openDocuments = await zero.data.query('documents.countOpen', null);

const archived = await zero.data.command(
  'documents.archive',
  { documentId },
  { idempotencyKey: `archive-document:${operationId}` },
);

return {
  openCount: (openDocuments.value as { count: number }).count,
  updated: (archived.value as { updated: boolean }).updated,
};
```

`databaseTopology.rootDirectory` is an exclusively managed Fabric location.
It must not overlap `outDir`, the effective default/control SQLite source, hot
snapshot, or deterministic WAL/SHM/journal companion paths, the object-storage
root in a containing direction, or `storageDir/tmp` / `storageDir/blobs`. A
dedicated unowned child such as `storageDir/databases` is allowed. Zero
validates both lexical configuration
and existing filesystem aliases before any build or storage startup side
effect.

Path ownership comparisons are deliberately case-insensitive and
Unicode-normalized on every platform. Do not distinguish storage domains only
by case or alternate Unicode spellings, even when developing on a
case-sensitive filesystem.

Fabric separates active actor capacity from durable file growth:

All count limits carried by Fabric observability are bounded to
`2_147_483_647`. This applies equally to direct coordinator configuration and
`createApp()` topology normalization, including `maxDatabaseFiles`,
`maxBlockedDatabases`, `maxTenantSyncBindingsPerDatabase`,
`maxQueuedPerDatabase`, and `maxQueuedTotal`.

- `maxDatabases` (default `16`) bounds simultaneously active database entries.
- `maxDatabaseFiles` (default `10_000`) hard-limits new canonical managed main
  files. Existing files remain openable at or above the limit. File/WAL
  databases and canonical hot-placement snapshot images are both counted;
  sidecars, internal ownership state, and unrelated files are not.
  A denied creation returns non-retryable `DATABASE_CAPACITY_EXHAUSTED` with
  `outcome: 'not-started'`, `capacityType: 'files'`, and the positive aggregate
  `capacityLimit` before any file or entry is created.
- `maxTenantSyncDatabases` bounds distinct databases pinned by persistent
  physical-tenant Sync. It defaults to one less than `maxDatabases` when at
  least two slots exist, reserving an actor slot for normal request/background
  work. A one-slot topology defaults to one so Sync remains usable; Doctor
  warns that it cannot reserve separate capacity. Set it to `0` to disable
  persistent tenant Sync admission.
- `maxTenantSyncBindingsPerDatabase` (default `64`) bounds persistent Sync
  capabilities for one database. Another binding for an already-admitted
  database does not consume a distinct-database allowance.

The complete public `AppMultipleDatabaseTopologyConfig` surface and defaults
are:

| Field | Default / contract |
| --- | --- |
| `mode` | Required literal `'multiple'`. Omitting `databaseTopology` preserves single-database behavior. |
| `rootDirectory` | Required private Fabric root; normalized to an absolute path and ownership/overlap checked before startup. |
| `realm` | Required side-effect-free `DatabaseRealm`; its schema, migrations, queries, and commands execute inside actors. |
| `actors.launch` | Required `source`, `bundle`, or explicit shell-free `command-prefix` launch. |
| `actors.env` | Empty by default. This is the actor's complete environment allowlist; the parent environment is never inherited implicitly. |
| `actors.executor` | Optional subprocess bounds. Defaults: `maxInFlight: 64`, startup/operation `5,000`/`30,000` ms, shutdown acknowledgement/exit `5,000`/`5,000` ms, then SIGTERM/SIGKILL waits `2,000`/`2,000` ms. |
| `tenantIsolation` | `'shared-row'`; `'tenant-database'` requires multi-tenant auth and a realm whose tables exactly match a subset of app tables. |
| `placement` | `'file'`; accepts bounded `'hot'` shorthand or an explicit file/hot selector policy. |
| `sqlite` | Optional actor-local SQLite/ReactiveDB tuning; defaults are listed below. |
| `maxDatabases` | `16` active database entries. |
| `maxDatabaseFiles` | `10,000` managed durable main files. |
| `maxBlockedDatabases` | `1,024` retained permanent-open failures. |
| `maxTenantSyncDatabases` | `maxDatabases - 1` when at least two slots exist; otherwise `1`. Set `0` to disable persistent tenant Sync admission. |
| `maxTenantSyncBindingsPerDatabase` | `64`. |
| `readers` | `true`; file placement receives a separate read-only WAL actor, while hot placement remains writer-only. |
| `maxQueuedPerDatabase` / `maxQueuedTotal` | `128` / `1,024` undispatched operations. |
| `queueTimeoutMs` / `operationTimeoutMs` | `15,000` ms waiting for dispatch / `30,000` ms after dispatch. |
| `restart` | Per-database actor replacement policy: `initialDelayMs: 10`, `maxDelayMs: 1,000`, `circuitFailureThreshold: 5`, and `circuitCooldownMs: 5,000`. |
| `idleTimeoutMs` | `60,000` ms before an unused entry becomes evictable. |
| `sweepIntervalMs` | `min(30,000, max(1,000, ceil(idleTimeoutMs / 2)))`; `30,000` ms with defaults. `false` disables automatic idle sweeps. |

`sqlite` uses the same validated persistence defaults inside each actor:

| SQLite/ReactiveDB field | Default |
| --- | ---: |
| `cacheSize` | `-262144` |
| `mmapSize` | `1073741824` bytes for file placement |
| `walAutocheckpoint` | `1000` pages for file placement |
| `pageSize` | `4096` bytes |
| `synchronous` | `'NORMAL'` for file placement |
| `tempStore` | `'MEMORY'` |
| `busyTimeout` | `5000` ms |
| `statementCacheSize` | `1000` prepared statements |
| `bufferPool` | enabled with `maxPoolSize: 100`, `preallocate: true`; set `false` to disable |
| `ringBufferDepth` | `1000` durable-change entries |

Hot actors intentionally override file-only journal/mmap/WAL behavior while
retaining the applicable common tuning. The app-level
`operationTimeoutMs` is the deadline passed for coordinator-dispatched work;
the executor policy also bounds transport requests used outside that explicit
deadline. Keep them aligned unless a shorter transport fail-fast boundary is
deliberate and tested.

The restart count belongs to one physical database entry. Replacement delays
double from `initialDelayMs` up to `maxDelayMs`; at and beyond
`circuitFailureThreshold`, one half-open attempt is allowed after each
`circuitCooldownMs`. A successful complete bind resets the count. Releasing
the entry's last lease or shutting down cancels a pending delay. Recovery
waiters continue to obey `maxQueuedPerDatabase`, `maxQueuedTotal`, their own
`queueTimeoutMs`, and their `AbortSignal`; the mutation which first discovered
an unknown outcome is never automatically re-executed. Per-entry coordinator
diagnostics expose the bounded `restartRetryCount` and derived
`restartCircuitOpen` flag; they do not expose filesystem or actor-process
identities.

Physical-file and persistent-Sync admission are serialized before creation or
lease pinning. Sync-capacity overflow is retryable `DATABASE_BACKPRESSURE` and
does not create a file, entry, or actor. The coordinator diagnostics expose
both configured limits and current file/distinct-Sync/binding counts.
`DATABASE_BACKPRESSURE` represents transient queue, actor-slot, binding, or
snapshot-session pressure; it is not used for permanent file/receipt ceilings.

Every managed main file also carries an immutable internal binding containing
its opaque database reference, instance UUID, and stable realm name. Zero
creates it transactionally only for a pristine file reserved by the current
coordinator. A legacy/nonempty unbound image, a copied image under another
tenant filename, a hardlink, or a device/inode mismatch fails closed. Ordinary
realm migrations do not rewrite this identity. Hot snapshots may replace the
physical inode, but Zero refreshes that physical proof only after the prior
actor has exact settlement and the replacement image proves the same instance.
During hot actor startup, migration and initial-durability image replacements
use the same handoff: the old admitted descriptor remains retained until the
new inode and logical binding are verified, and the final guard remains live
through the readiness checks.

Actor restart fencing uses a private rollback-journal liveness database. Bound
actors hold SHARED leases; coordinator startup requires a zero-timeout EXCLUSIVE
probe which transactionally rotates a private generation token. A surviving
actor from a crashed parent therefore blocks replacement startup with retryable
`DATABASE_CONFLICT` / `outcome: 'not-started'` until it exits, while a bind
buffered before the crash is rejected if it arrives after replacement startup.
The error and telemetry never include paths, logical references, generation or
instance IDs, or inode/device values.

The filesystem is a trusted deployment boundary. Bun SQLite opens by pathname,
so Zero combines a retained `O_NOFOLLOW` descriptor with immediate pre/post-open
device/inode checks and the durable logical binding, but cannot atomically pass
that descriptor into Bun SQLite. Keep the Fabric root and its ancestors private
to the Zero service OS identity, use local SQLite-compatible storage, and use
OS/container isolation against hostile same-UID or privileged processes.

`placement` accepts `'file'`, `'hot'`, or an explicit policy. `'file'` is the
default. `'hot'` is shorthand for on-write durability with a 64 MiB logical
SQLite image bound. Use the object form for explicit limits, another durability
contract, or hybrid selection. The object requires `hot.maxBytes` whenever its
default is hot or it includes any selector:

```ts
import {
  createNamedDatabaseRef,
  createTenantDatabaseRef,
  type AppDatabasePlacementConfig,
} from '@zero/framework/server';

const hotDatabaseRefs = new Set([
  createTenantDatabaseRef('tenant_acme'),
  createNamedDatabaseRef('reporting-preview'),
]);

const placement = {
  default: 'file',
  select: ({ databaseRef }) =>
    hotDatabaseRefs.has(databaseRef) ? 'hot' : 'file',
  hot: {
    durability: 'on-write',
    maxBytes: 32 * 1024 * 1024,
  },
} satisfies AppDatabasePlacementConfig;
```

The selector is synchronous and receives only a frozen, opaque `databaseRef`.
It never receives the raw tenant/name, path, request, or user. Use the helper
matching the manager binding namespace; `createDatabaseRef(rawTenantId)` does
not produce the tenant binding ref. Zero validates the selector result and
fails closed unless it is exactly `'file'` or `'hot'`.

`databaseRef` is a deterministic, unkeyed pseudonymous correlation ID. It is
not a secret or an authorization capability, and a low-entropy source ID may
be dictionary-correlated. Do not publish it as user-facing data or use it in
place of an authority check.

Placement is pinned to the active coordinator entry and inherited by its crash
replacement generations. A clean idle/requested eviction lets the next open
evaluate the selector again. Changing an allowlist does not move a live
database, and there is no online promotion/demotion or automatic spill API.

The actor realm must be a schema-identical subset of `createApp({ tables })`.
Once Resource modules are loaded, its table set must exactly equal every
registered tenant resource assigned to physical storage, including `internal`
and HTTP-only resources. Startup fails on missing/extra realm tables, schema
drift, single-tenant auth, or inconsistent Resource ownership. This prevents a
tenant table from falling through to a same-named shadow table in the control
database.

Resource declarations drive both storage and client exposure:

| Declaration | Physical tenant behavior |
| --- | --- |
| `realm: tenantRealm()` | The selected database capability is the mandatory tenant boundary; the usual realm field is not injected or filtered. |
| `exposure: 'internal'` | Actor/server use only; no generated HTTP or Sync access. |
| `exposure: 'http'` | Generated Resource CRUD and `/api/data`; omitted from `AppProvider`'s Sync catalog. |
| `exposure: 'sync'` | WebSocket snapshot/catch-up/mutations only; must use explicit full Sync. |
| `exposure: 'all'` | Generated HTTP plus WebSocket Sync. |

Physical tenant tables normally omit `tenant_id`; retaining such a field is a
business/export choice, not an authorization boundary. Zero derives the file
only from the live authenticated tenant scope. URL parameters, headers,
request bodies, WebSocket messages, and browser state cannot select it.

Backend route code receives a bound asynchronous capability as `zero.data`
when a committed tenant session and physical topology are active:

```ts
if (!zero.data) throw new Error('A tenant data scope is required');

const projects = await zero.data.list(
  'projects',
  { limit: 50 },
  { consistency: { mode: 'snapshot' } },
);

await zero.data.mutate(
  { type: 'update', table: 'projects', id: projectId, patch: { status: 'done' } },
  { idempotencyKey: `project-status:${operationId}` },
);
```

`zero.data` is promise-based because it crosses an actor boundary. It exposes
structured `get`, `list`, `find`, registered `query`, `mutate`, atomic `batch`,
and registered `command` operations—never raw SQL, paths, a database manager,
or a tenant selector. Reads support `snapshot`, `read-your-writes` with a prior
sequence token, and `strong` consistency. The historical synchronous
`zero.db`, `zero.syncDB`, `zero.sql`, and `zero.sqlite` identities continue to
refer only to the pinned default database.

`list(table, { limit, after? })` reads 1–500 rows in declared-primary-key
ascending order. `after` is an exclusive primary-key cursor, so passing the
last row ID from one page cannot duplicate it in the next page. Use `find()`
for projection, filtering, ordering, or offset pagination.

`mutate()` accepts exactly four exported `DatabaseMutation` shapes:

| Mutation | Contract |
| --- | --- |
| `{ type: 'create', table, row }` | Strict insert; conflicts when the primary key already exists. |
| `{ type: 'upsert', table, row }` | Primary-key upsert through ReactiveDB's canonical create/insert path. |
| `{ type: 'update', table, id, patch }` | Partial update of the named primary-key row; the primary key itself is immutable. |
| `{ type: 'delete', table, id }` | Delete the named primary-key row. |

Table/column identifiers are at most 128 characters and must use the portable
SQLite identifier form (`[A-Za-z_][A-Za-z0-9_]*`). Registered query/command
names also allow `.`, `-`, and an initial ASCII letter. Primary-key IDs are
bounded to 1,024 UTF-8 bytes. Mutation, batch, and command idempotency keys are
1–128 characters, begin with an ASCII letter or digit, and otherwise allow
letters, digits, `.`, `_`, `:`, and `-`. Reuse the exact key only for the exact
same logical work and payload.

`find()` accepts the exported `DatabaseFindInput` contract. Every referenced
table and field must exist in the actor realm catalog; there is no raw SQL or
caller-supplied expression escape hatch:

```ts
const result = await zero.data.find('projects', {
  select: ['id', 'name', 'status', 'created_at'],
  filters: [{
    type: 'allOf',
    filters: [
      { type: 'field', field: 'status', operator: 'in', value: ['open', 'held'] },
      { type: 'field', field: 'name', operator: 'contains', value: 'intake' },
    ],
  }],
  order: [{ field: 'created_at', direction: 'desc' }],
  limit: 50,
  offset: 0,
});
```

| `DatabaseFindInput` field | Contract |
| --- | --- |
| `select?` | Non-empty unique projection; at most 128 registered fields. Omitting it still requires the table catalog itself to fit that bound. |
| `filters?` | Top-level predicates are ANDed. A predicate is a field filter or a non-empty nested `allOf`/`anyOf` group. |
| field operators | `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `like`, `contains`, and `in`. `like`/`contains` require strings; ordered comparisons reject `null`; `in` accepts 1–50 scalars. |
| `match?: 'exact'` | Reserved exact storage-class/BINARY comparison for framework-owned `eq`/`ne` authorization constraints. |
| `order?` | Non-empty unique registered fields; at most 8 terms. The actor adds the primary key as the deterministic tie-breaker. |
| `limit` / `offset?` | `limit` is 1–1,001; `offset` is 0–1,000,000. |

One find admits at most 64 total filter nodes, 8 levels of filter-group
nesting, and 256 generated SQLite parameters. The normal operation envelope
also caps payload depth at 16, total scalar/container nodes at 10,000, encoded
payload size at 1 MiB, one string at 256 KiB, one object at 1,024 properties,
and one array at 10,000 items. Invalid shape is
`DATABASE_PAYLOAD_INVALID`; an exceeded hard budget is
`DATABASE_PAYLOAD_LIMIT`.

`batch()` accepts exported `DatabaseAssertion` preconditions evaluated in the
same transaction, in declaration order, before its mutations:

| Assertion | Meaning |
| --- | --- |
| `{ type: 'row-exists', table, id }` | Require the primary-key row to exist. |
| `{ type: 'row-missing', table, id }` | Require the primary-key row to be absent. |
| `{ type: 'row-equals', table, id, row }` | Require exact canonical equality with the current row. |
| `{ type: 'sequence-equals', sequence }` | Require the durable database sequence to equal the supplied token. |

Each assertions array and mutations array is bounded to 256 entries, and the
whole batch remains subject to the operation payload limits. A failed
assertion aborts the batch without applying a partial mutation.

Generated Resource CRUD and `/api/data` use the same physical capability while
retaining Resource policy, advanced-RBAC context, field projection, authority
revalidation, strict create semantics, and compare-and-swap update/delete.
One Resource request holds one private binding across receipt lookup, policy
pre-read, commit, and canonical result authorization, then releases it in
`finally`.

Generated mutations use equivalent private receipt ledgers on both storage
planes. Physical tenant Resources persist the receipt with the actor effect in
the tenant database; global and shared-row Resources persist the canonical
receipt with the ReactiveDB effect in the pinned default database. Lookup
happens before a mutable row pre-read. Exact replay returns the stored canonical
effect, then rechecks current authority and the original policy shape:
update/delete use the immutable preimage while create receives its original
logical input. Current field projection is reapplied whenever the canonical
response contains a committed row. The public async client and `zero.data`
never expose the trusted receipt writer.

The physical actor ledger keeps at most 10,000 full results and 64 MiB of
encoded full-result JSON, with an 8 MiB individual encoded-result ceiling.
Before inserting another, Zero atomically converts the oldest retained results,
by durable insertion order, to permanent compact tombstones until both count
and bytes fit. Tombstones retain the key and realm/operation fingerprints but
not the result or final sequence. They are never deleted.

One physical database admits at most 1,000,000 permanent actor receipt keys.
At that bound an unseen write fails before its mutation starts with
non-retryable `DATABASE_CAPACITY_EXHAUSTED`, `outcome: 'not-started'`,
`capacityType: 'receipts'`, and the positive aggregate `capacityLimit`; replay
of a retained key and exact expired-key lookup continue to work. With the same
fingerprint, an expired physical actor key reports non-retryable
`DATABASE_OUTCOME_UNKNOWN` with `receiptState: 'expired'`; the Resource HTTP
surface normalizes an expired result to
`409 resource-idempotency-result-expired`. A different fingerprint remains an
idempotency-key-reuse conflict. The exported actor bounds are
`DATABASE_WRITER_MAX_RECEIPT_KEYS`, `DATABASE_WRITER_MAX_RECEIPTS`,
`DATABASE_WRITER_MAX_RECEIPT_RESULT_BYTES`, and
`DATABASE_WRITER_MAX_RETAINED_RECEIPT_BYTES`. See
[receipt semantics](./framework/multi-database-architecture.md#idempotency-failure-and-restart)
for migration, statistics, telemetry, and operator guidance.

Realtime remains one authenticated `/sync` socket. The server splits the
subscription into `default` and `tenant` planes, each with an independent
sequence, epoch, authorization scope, snapshot/catch-up decision, and reset.
The tenant plane holds a persistent authority-bound actor lease for that
socket. `AppProvider` consumes the server-injected table-plane catalog and
configures the browser automatically; applications should not manually wire
`tableSyncPlanes`. A tenant selection change replaces the authorization scope,
freezes pending work, reconnects, and purges the old tenant baseline.

Sync also validates read authority at the final delivery boundary. A Resource
or platform filter/projector must supply a comparable fingerprint plus a
synchronous live validator; custom filtered/projected adapters without both
fail closed. Zero rechecks after asynchronous reads/drains and after projector
code, immediately before snapshot chunks, catch-up/live/deferred rows, and
row-bearing mutation acknowledgements are sent. Membership, role/property, or
policy revision changes therefore close and purge the stale scope instead of
delivering a row authorized by an earlier subscription decision.

Full tenant baselines materialize one immutable actor snapshot at durable head
`H`, release its SQLite transaction before IPC, and then stream retry-safe
100-row actor pages through exact-size-bounded `begin`/`chunk`/`end` frames no
larger than 900 KiB each. The browser stages the chunks and replaces that plane
atomically only at the end frame; only then does Sync accept `H` and replay every
durable change after it. Empty selections use the same exact head protocol. The
session is generation/owner/table-selection bound and is aborted on completion,
binding release, authority reset, actor recovery, or close. No complete tenant
baseline is returned as one actor result or one WebSocket frame. A single
projected row which cannot fit in one frame is a terminal data-contract error (`4004`),
reported without a reconnect loop so the operator can correct the row or
projection.
Malformed actor begin/page results and non-retryable actor response-size
violations are terminal in this snapshot context as well; the client does not
reconnect into the same invalid staged contract.

Permanent managed-file exhaustion while establishing the tenant binding also
closes once with terminal code `4004` and the fixed reason
`Tenant Sync database capacity is exhausted`; the browser reports it through
`onError` and does not reconnect. Durable-receipt exhaustion encountered by a
tenant mutation is different: the socket stays open and receives a negative
acknowledgement with `SYNC_MUTATION_CAPACITY_EXHAUSTED`, allowing the optimistic
change to roll back without treating permanent capacity as a transport error.

Snapshot sessions allow 8 active sessions, 50,000 rows, 64 MiB per snapshot and
64 MiB across active snapshots, 1 MiB/10,000 nodes per source row, 100 rows/4
MiB/18,000 nodes per actor page, and a 30-second monotonic elapsed lifetime.
These values are exported as `DATABASE_TENANT_SYNC_SNAPSHOT_*` constants from
`@zero/framework/server`. Transient session/aggregate-byte pressure reports
retryable `DATABASE_BACKPRESSURE`; intrinsic row/snapshot overflow reports
non-retryable `DATABASE_PAYLOAD_LIMIT`; expiry reports
`DATABASE_TRANSACTION_EXPIRED`. Metadata contains only a bounded
`snapshotReason`, never capabilities, paths, table names, SQL, raw errors, or
row data.

The socket bridge applies a second whole-transfer work budget: at most 512
actor page attempts (including adaptive retries), 50,000 observed source rows,
64 MiB across the encoded source rows plus their encoded projected forms, and
the same 30-second monotonic elapsed deadline. Even an unchanged projection
counts both the source and projected representation. Exceeding a bridge budget
closes once with terminal code `4004`, emits only its bounded reason category,
and does not reconnect-loop. See
[ReactiveDB Fabric](./framework/multi-database-architecture.md#reactivedb-and-realtime).

Physical tables declared with `sync: 'auto'` resolve conservatively to lazy
because no count from the shared control database can represent independently
sized tenant files. Explicit `full` and `lazy` still win. Lazy hydration
requires HTTP exposure (`all` for a table which also participates in Sync).

Concurrency is per physical database. File placement uses one FIFO writer and,
when `readers: true`, a separate read-only actor that can overlap committed WAL
reads with the writer. Hot placement is writer-only; its reads share that
actor's lane. Different tenant databases can occupy different writer
subprocesses and write concurrently, bounded by `maxDatabases`, queue limits,
and actor capacity. One app coordinator owns a database root; sharing that root
between independent app replicas is rejected because Zero does not yet provide
a distributed writer/authority coordinator.

Every explicit hot policy requires `maxBytes`. This is a hard logical SQLite
image/page limit—not a process RSS limit—and it is enforced through restore,
migration/schema setup, writes, and snapshot serialization. The `'hot'`
shorthand uses 64 MiB. Budget actor/runtime overhead separately; if all active
entries can be hot, `maxDatabases * maxBytes` is the maximum configured image
budget, not the total memory ceiling.

A write that would cross the active hot image budget fails before commit with
`DATABASE_PAYLOAD_LIMIT`, `outcome: 'not-committed'`, and only the closed safe
detail `reason: 'max-bytes'`. Actor and coordinator normalization preserve that
classifier while discarding SQLite messages, paths, SQL, row data, and measured
sizes. The existing app-local `database.operation.failed` event then includes
`failureReason: 'hot-max-bytes'`; no separate high-cardinality event or raw
error detail is emitted.

Hot durability is explicit:

| `durability` | Contract |
| --- | --- |
| `on-write` | Atomic snapshot and filesystem durability complete before every non-replayed commit is acknowledged. This is the default and the recommended hot policy when acknowledged-write loss is unacceptable. |
| `periodic` | The first uncovered commit marks the actor dirty before response and starts a snapshot immediately. Later writes do not extend the oldest dirty deadline; writes during I/O force a follow-up. The parent retires the generation if acknowledged state remains uncovered for `snapshotIntervalMs`, while `snapshotTimeoutMs` separately bounds one I/O operation. A crash or runtime durability failure may lose acknowledged writes not covered by the latest image within that configured window. |
| `final` | Writes are acknowledged without snapshots; a clean actor close must publish a final image. A crash may lose every write since the last durable image. |

Periodic cadence defaults to 30 seconds. `snapshotTimeoutMs` must be at least
the cadence and defaults to twice it with a two-minute floor. All configuration
and per-call values which feed JavaScript timers are capped at
`2_147_483_647` ms; this includes queue, operation, sweep, actor-lifecycle, and
periodic snapshot timers. `idleTimeoutMs` is only an elapsed-time threshold.

On a periodic runtime snapshot failure or missed oldest-dirty deadline, Fabric
settles and retires the failed generation, reopens the last durable image, and
resets tenant Sync to the new authority. Uncovered acknowledgements may be
absent after that reset, and ordinary HTTP callers can observe the rolled-back
state. Periodic mode is bounded-loss, not lossless. A periodic or final
graceful-close snapshot failure instead quarantines the entry because clean
shutdown durability was not proven. The quarantine is process-local rather
than a durable poison marker; a whole-app restart reopens the last durable
image under the selected crash-loss contract. Use `on-write` when that fallback
is not acceptable.

Run Doctor after configuring the topology:

```sh
bun run doctor -- --config ./zero.config.ts --strict
```

Doctor reports active-database and durable-file capacity, disabled readers,
physical tenant boundaries, retained tenant fields, unsafe root overlap with
build output or object storage, file/hot selection, hot image capacity,
writer-only hot reads, and periodic/final loss contracts. For physical-tenant
Sync it also reports actor-capacity reservation and the bounded snapshot
transport contract. Receipt findings explain both the full-result retention
budget and permanent idempotency-key ceiling for physical databases and for
generated default/shared Resource mutations. Use a dedicated persistent local
volume and plan for child processes, file descriptors, WAL/SHM companions,
graceful shutdown, and WAL-aware backup.

In `tenant-database` mode, Doctor explains that application tables do not need
a managed `tenant_id` discriminator. If one is retained for business/export
meaning, it is ordinary data and never routing authority. Shared-row mode keeps
the existing tenant-column and tenant-leading-index checks.

The pinned default/control database remains outside Fabric placement and keeps
identity, auth, memberships, platform administration, and global/shared
resources. Splitting Zero-owned control/logging/metrics/plugin realms is future
work. The current feature branch also does not provide online placement
migration, automatic heat/spill policy, distributed owners, operator-grade
fleet backup/restore or tenant lifecycle administration, or a completed
supported package/OS release matrix. See
[Multi-Database Architecture](./framework/multi-database-architecture.md) for
the runtime, security, recovery, deployment, and release contracts.

#### Protected Multipart Endpoints

Zero-compiled server extensions apply auth before parsing protected multipart
bodies. A `defineEndpoint()` with `auth: 'user'` or `auth: 'admin'` receives an
automatic `onRequest` guard; a `defineRouter()` applies the same behavior to
its inherited nested routes using the complete mounted prefix.

```ts
import { t } from 'elysia';
import { defineEndpoint } from '@zero/framework/server';

export default defineEndpoint({
  method: 'POST',
  path: '/api/documents/parse',
  auth: 'user',
  body: t.Object({ file: t.File() }),
  handler: async ({ body, user }) => ({
    uploadedBy: user.userId,
    bytes: body.file.size,
  }),
});
```

Invalid credentials return stable `401 UNAUTHORIZED`, `403 FORBIDDEN`, or `503
AUTH_NOT_READY` JSON before Elysia consumes the file. The usual route guard
still covers non-multipart requests, and `false`/`optional` routes remain
public. The official `client.api` Eden instance waits for auth restoration,
injects the Bearer token, and can refresh/retry a replayable `FormData` body.
Never set its multipart `Content-Type` manually.

Raw Elysia routes must install the early hook before the route and retain the
normal macro guard:

```ts
app
  .onRequest(createProtectedMultipartRequestGuard(getTokenService, {
    requirement: 'user',
    method: 'POST',
    path: '/api/documents/parse',
  }))
  .post('/api/documents/parse', handler, {
    zeroAuth: 'user',
    body: t.Object({ file: t.File() }),
  });
```

The app must already have `createAuthMiddleware()` in scope. Use matching
`admin` requirements for administrator-only routes. Auth resolution is cached
by request and app-local token service, so the early hook and ordinary guard do
not perform competing identity restorations.

#### PDF Rendering

Enable `pdf: true` in `zero.config.ts`, then run `bun run pdf:install` once per
machine or deployment image. Backend handlers use `zero.pdf.render()` for
bytes or `zero.pdf.renderToStorage()` for a private stored object. The default
Chromium renderer supports modern layout and print CSS, disables JavaScript,
denies remote and local resources, and enforces queue, timeout, input, and
output limits. Zero mounts no public PDF endpoint. See
[PDF Rendering](./pdf.md).

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

`createApp()` composes app policy with deny-wins platform defaults. Private
framework tables (`users`, workflow definitions, and Storage metadata) are not
generic Sync reads. Notifications/receipts, rooms/members, and workflow
execution rows use target, membership, or owner filters across snapshot,
catch-up, and live delivery. Framework-owned tables also reject direct
`sync.mutate` writes. App-owned tables keep their declared resource policy and
remain writable unless you add stricter policy.

```ts
import { createDefaultSyncPolicy } from '@zero/framework/sync';

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

For a physical tenant resource, those same checks run around actor reads and
writes. The tenant database capability replaces only the mandatory tenant-row
predicate; discretionary Resource policy, advanced RBAC, field projection,
strict creates, conditional updates/deletes, and commit-time authority
revalidation remain in force. Actor-backed Sync also uses durable logical
mutation receipts. If the write may have committed but no safe acknowledgement
can be produced, Zero reconnects without a negative ack so the client can
replay the same mutation reference after its new baseline.

If that reference has only a permanent expired-result tombstone, the fresh
baseline is authoritative: Zero sends a negative acknowledgement with
`SYNC_MUTATION_RECEIPT_EXPIRED`, clears the old optimistic/pending mutation,
and neither reconnects nor re-executes it.

#### Ephemeral Topic Policy

Auth-enabled `createApp()` instances fail closed for unclassified ephemeral
topics. Zero provides room-aware `presence:<roomId>` and `typing:<roomId>` plus
personal `user:<currentUserId>:<name>` topics. Add `ephemeralPolicy` for other
collaboration names:

```ts
import type { EphemeralTopicPolicy } from '@zero/framework/server';

const ephemeralPolicy: EphemeralTopicPolicy = {
  async authorize({ topic, operation, key, authContext }) {
    const projectId = topic.startsWith('cursor:') ? topic.slice(7) : '';
    if (!projectId || !authContext) {
      return {
        ok: false,
        code: 'EPHEMERAL_TOPIC_UNCLASSIFIED',
        reason: 'Cursor topic is not available',
      };
    }
    if (operation !== 'subscribe' && key !== `user:${authContext.userId}`) {
      return {
        ok: false,
        code: 'EPHEMERAL_KEY_NOT_OWNED',
        reason: 'Cursor key must match the authenticated user',
      };
    }
    return {
      ok: true,
      namespace: `project:${projectId}:cursors`,
      keyOwnership: 'actor',
    };
  },
};

const config = resolveConfig({
  db: { mode: 'memory' },
  tables,
  auth: true,
  ephemeralPolicy,
});
```

The namespace is server-side only and Zero scopes app decisions under an
internal `app:` prefix. The default `actor` ownership prevents another
principal from replacing or deleting an existing key; choose `unrestricted`
only when cross-user replacement is deliberate. The policy is async and runs
for subscribe, set, delete, and live revalidation. Authless standalone apps
retain legacy unrestricted topics.

See the [ephemeral wire protocol](./realtime-sync/realtime-sync/protocol.md#ephemeral-collaboration-channel)
for limits, messages, and stable error codes.

#### Platform Tokens

`createApp()` mounts Zero's generic token service automatically. It is available
from app-owned server code as `zero.tokens`, from `getPlatformTokenService()`,
and from the `@zero/framework/tokens` subpath.

Use action tokens for consume-once actions:

```ts
const action = zero.tokens?.createActionToken({
  purpose: 'intake.email.verify',
  subject: { type: 'intake-draft', id: draftId },
  scope: 'clinic-intake',
  ttl: '30m',
});

zero.tokens?.consumeActionToken(token, {
  purposes: ['intake.email.verify'],
  scope: 'clinic-intake',
});
```

Use resume tokens for long public flows:

```ts
const resume = zero.tokens?.createResumeToken({
  flow: 'clinic-intake',
  resource: { type: 'intake-draft', id: draftId },
  ttl: '14d',
});

zero.tokens?.verifyResumeToken(token, {
  flow: 'clinic-intake',
  resource: { type: 'intake-draft', id: draftId },
});
```

See [Platform Tokens](./tokens.md).

#### Platform KV/cache

`createApp()` mounts durable memory-first KV/cache by default. App-owned
backend routes can use `zero.kv` for values and namespaces, `zero.counter` for
counters, and `zero.limiter` for common rate-limit shapes.

```ts
await zero.kv?.set('draft:123', { step: 4 }, { ttlMs: 86_400_000 });
await zero.counter?.increment('draft:saves');

const result = await zero.limiter?.fixedWindow('login:ip:127.0.0.1', {
  limit: 5,
  windowMs: 60_000,
});
```

Omit `kv` to use durable defaults under `./data/kv`, set `kv: false` to
disable, or pass `kv: { durability: 'always' }` for stronger per-write fsync.
See [Platform KV/cache](./kv.md).

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

`createApp()` already mounts Scheduler before Notifications, plus Rooms,
Workflows, and the other enabled platform plugins in their required order. Do
not mount duplicate platform plugins or reach into Elysia decorators for a
database handle. App-owned extensions belong in `server/plugins`,
`server/middleware`, `server/endpoints`, and `server/routes`, or in the matching
explicit directory options. Use low-level plugin factories only when building
a standalone Elysia composition without `createApp()`.

---

## Hooks Reference

### Data Hooks

| Hook | Signature | Description |
|------|-----------|-------------|
| `useCollection` | `<T>(name) => { data, insert, update, remove }` | Primary mutation API -- all rows + CRUD, re-renders on any change |
| `useLazyCollection` | `(name, filters?, options?) => { data, isLoading, error, refresh }` | Lazy table hook with loading/error/refresh |
| `useDataPage` | `(table, options?) => DataPageResult` | `/api/data` pagination, sorting, filters, loading/error, and refresh |
| `useRow` | `<T>(name, id) => T \| null` | Single row, re-renders when it changes |
| `useRecord` | `(table, id) => RecordResult` | Single row plus update/delete helpers |
| `useRecordByIdentity` | `(table, identity) => IdentityRecordResult` | Natural-identity lookup plus upsert/update/delete helpers |
| `useResourceClient` | `(resource, options?) => ResourceClient \| null` | Generated-resource HTTP client after browser mount |
| `useResourceList` | `(resource, options?) => ResourceListHookResult` | Request-driven resource list with page/filter/sort state |
| `useResourceRecord` | `(resource, id: string \| null, options?) => ResourceRecordResult` | Request-driven record plus update/delete helpers |
| `useResourceActions` | `(resource, options?) => ResourceActionsResult` | Generated-resource create/update/delete lifecycle |
| `useDataSelection` | `(items, options?) => UseDataSelectionReturn` | Reusable single/multiple selected-row state for data views |
| `useQuery` | `<T>(name, predicate) => T[]` | Local filtered rows; recomputes when the table map changes |
| `useStatus` | `() => { connected: boolean }` | WebSocket connected? |
| `useConnectionHealth` | `() => ConnectionHealth` | Auth/sync/pending-mutation health for app banners |
| `useMutation` | `(action, options?) => UseMutationReturn` | SDK-backed command lifecycle with observability errors |

### Auth Hooks

| Hook | Signature | Description |
|------|-----------|-------------|
| `useAuth` | `() => AuthState & AuthActions` | Full auth state, persisted-session `isRestoring`, and actions |
| `useAuthConfig` | `() => AuthConfigState` | Shared client-scoped public registration/bootstrap/user-property config with unknown/loading/ready/error and reload state |
| `useCurrentUser` | `() => AuthUser \| null` | Current user shorthand |
| `useRequireAuth` | `(redirectTo?) => AuthUser \| null` | Guard: redirects if not authed |
| `useUserProperty` | `(key, options?) => UseUserPropertyResult` | Current-user KV property reader/writer for UI settings and gates |
| `useAuthorizationScopeBoundary` | `(clientOverride?: Client \| null) => AuthorizationScopeBoundary` | Credential-free opaque key/readiness boundary for app-owned cache isolation; never server authority |
| `isAuthorizationScopeCallbackCurrent` | `(currentKey: string, ready: boolean, capturedKey: string) => boolean` | Pure late-callback fence for source-installed components and app-owned async adapters |
| `useAuthorization` | `() => UseAuthorizationResult` | Sanitized live authorization snapshot and refresh lifecycle |
| `useHasPermission` | `(permission: string) => boolean` | Fail-closed one-permission UI hint |
| `useHasAllPermissions` | `(permissions: readonly string[]) => boolean` | Fail-closed all-permissions UI hint |
| `useHasAnyPermission` | `(permissions: readonly string[]) => boolean` | Fail-closed any-permission UI hint |
| `useAuthApiKeys` | `(options: UseAuthApiKeysOptions) => UseAuthApiKeysResult` | Scope-fenced user API-key pagination and lifecycle actions for custom or packaged management UI |
| `useApplicationAccess` | `(options?) => UseApplicationAccessResult` | Single/advanced application-role administration with cursor paging and ownership transfer |
| `useAuthAudit` | `(options: UseAuthAuditOptions) => UseAuthAuditResult` | Authorized tenant/platform control-plane audit pagination and export |
| `usePlatformAdministration` | `(options?) => UsePlatformAdministrationResult` | Independently fenced Administration Organization config, people, and invitation state |
| `usePlatformTenants` | `(options?) => UsePlatformTenantsResult` | Customer-organization directory, lifecycle, creation, and safe member drill-in |
| `useTenantMembers` | `(options?) => UseTenantMembersResult` | Active-tenant member, role, status, and ownership administration |
| `useTenantOnboardingAdministration` | `(options?) => UseTenantOnboardingAdministrationResult` | Independently fenced active-tenant config, invitations, and retained join-request review |
| `useTenantDomainAdministration` | `(options?) => UseTenantDomainAdministrationResult` | Active-tenant verified-domain claim and policy controls |
| `useDomainOnboarding` | `(options?) => UseDomainOnboardingResult` | Non-enumerating mailbox-proof/request-to-join flow |
| `useTenantSwitcher` | `() => UseTenantSwitcherResult` | Refresh-family-backed active-tenant choices and switching |
| `useTenantAppShellWorkspaces` | `(options?) => AppShellWorkspaceConfig \| undefined` | Official tenant-session projection for AppShell workspaces, including committed selection, pending/error/retry, announcements, and focus restoration |

The onboarding hook's invitation and join-request lifecycle is documented in
[Tenant Invitations and Join Requests](./auth/tenant-invitations-and-join-requests.md).
The audit hook's event, authorization, retention, query, and export boundary is
documented in
[Durable Authorization and Control-Plane Audit](./auth/control-plane-audit.md).

### State Hooks

| Hook | Signature | Description |
|------|-----------|-------------|
| `useServerState` | `<T>(key, default) => [T, (v: T) => void]` | Server-persisted state for the current authorized-scope user |
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
| `useRoomActions` | `() => RoomActions` | Create/confirm-admission/leave/delete room actions |
| `useRoomData` | `(roomId, tableName) => rows[]` | Client-side live `room_id` filter; app table still requires server read/write policy |
| `usePresence` | `(roomId, data?) => UsePresenceResult` | Low-level ephemeral presence heartbeat |
| `usePresenceList` | `(roomId, options?) => UsePresenceListReturn` | Display-ready presence list with stale filtering |
| `useTypingIndicator` | `(roomId, options?) => UseTypingIndicatorReturn` | Membership-authorized ephemeral typing state with TTL and current typing users |
| `useEphemeralErrors` | `(listener) => void` | Observe stable topic authorization and validation failures |

`presence:{roomId}` and `typing:{roomId}` are reserved, server-enforced topic
families. The current user must have a live `RoomService` membership, and
writes/deletes must use `user:{currentUserId}`. Membership changes revalidate
and revoke the live subscription. An explicit `options.topic` outside the
reserved families requires an app `ephemeralPolicy`; it is not automatically
authorized merely because a hook requested it.

Room lifecycle is server-controlled. Creating a room adds its creator as the
owner. Reads require membership, and the default `join(roomId)` call only
returns an already admitted membership; invitation, domain, or approval logic
must call `RoomService.join()` from trusted server code. Owners cannot leave
(`409 ROOM_OWNER_CANNOT_LEAVE`) and must delete the room. A global admin may
delete a room as a control-plane action, but that authority does not grant
room data-plane read access.

### Storage Hooks

| Hook | Signature | Description |
|------|-----------|-------------|
| `useUpload` | `() => UseUploadReturn` | Multipart upload with progress |
| `useUploadQueue` | `() => UseUploadQueueReturn` | Sequential multi-file upload queue |
| `useUploadDropzone` | `(options) => UseUploadDropzoneReturn` | `react-dropzone` bindings wired to Zero storage uploads |
| `useStorageFile` | `(driveId, path) => UseStorageFileReturn` | One file/folder metadata, URL, delete, visibility, refresh |
| `useStorageFolder` | `(driveId, path?, options?) => UseStorageFolderReturn` | Folder listing with type, cursor, limit, and sort options |
| `useStorageBrowser` | `(driveId, initialPath?) => UseStorageBrowserReturn` | Folder navigation, selection, uploads, and common actions |
| `useStorageDrives` | `() => UseStorageDrivesReturn` | Accessible drive list |
| `useDriveCapabilities` | `(driveId, path?) => UseDriveCapabilitiesReturn` | Backend-resolved current-user storage access |
| `useStoragePermissions` | `(driveId, objectPath?) => UseStoragePermissionsReturn` | Admin permission grant listing |
| `useDriveUsage` | `(driveId) => UseDriveUsageReturn` | Drive usage stats |
| `useDriveQuota` | `(driveId) => UseDriveQuotaReturn` | Drive usage plus derived quota flags |
| `usePresignedUrl` | `() => UsePresignedUrlReturn` | Create presigned URLs |
| `useStorageActions` | `() => StorageActions` | Drive/file mutation helpers |

Storage hooks must run inside `AppProvider` or `ClientProvider` so they can use
the platform SDK client. JSON actions use `client.fetch()`; multipart uploads
use the same auth controller for restoration, bearer injection, one 401
refresh/retry, and authorization-scope cancellation.

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
| `useRouter` | `() => { push, replace, back, prefetch, isNavigating, ... }` | Client-route navigation and preload state |

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

## Selected Export Reference

Common exports from `@zero/framework/react`. This is a curated reference, not a
generated or exhaustive inventory; use TypeScript autocomplete and the package
barrel for the exact installed-version surface.

### Functions & Classes
`createClient`, `getClient`, `AuthClient`, `ResourceMutationError`, `isAuthEmailVerificationRequiredResult`, `registerRoute`, `matchClientRoute`, `navigateTo`, `prefetchRoute`, `defineSchema`, `defineTable`, `field`, `toast`, `formatRelativeTime`, `buildDataTableLazyQuery`, `buildDataPageQuery`, `groupKanbanItemIds`, `projectKanbanMove`, `getOS`, `getZeroAnimatedIcon`, `hasZeroAnimatedIcon`, `resolveZeroAnimatedIcon`

### React Components
`AppProvider`, `ClientProvider`, `RouterProvider`, `NotificationProvider`, `ConfirmProvider`, `Link`, `LoginForm`, `RegisterForm`, `ForgotPasswordForm`, `PasswordActionForm`, `ChangePasswordForm`, `EmailVerificationForm`, `UserPropertiesForm`, `AuthFlowContinuation`, `TenantSelectionForm`, `TenantCreationForm`, `TenantSwitcher`, `ApiKeyManagement`, `SelfApiKeyManagement`, `ApplicationUserApiKeyManagement`, `TenantMemberApiKeyManagement`, `PlatformApiKeyManagement`, `ApplicationAccessManagement`, `PlatformAdministrationManagement`, `PlatformTenantManagement`, `TenantMemberManagement`, `TenantOnboardingManagement`, `TenantDomainManagement`, `DomainOnboarding`, `TenantInvitationForm`, `TenantJoinRequestForm`, `ControlPlaneAuditViewer`, `PermissionGate`, `TenantGate`, `AdministrationScopeGate`, `PlatformAdminGate`, `AnimateIcon`, `ZeroIcon`, `StickToBottom`, `Toaster`, `ThemeProvider`, `ThemeTogglerButton`, `ResizableNavbar`, `Hero`, `FeaturesSection`, `CodeBlock`, `CtaSection`, `FooterSection`, `Faq`, `ExpandableCards`, `BentoGrid`, `AnimatedList`, `AutoForm`, `FieldRenderer`, `CrudPage`, `MasterDetailView`, `MasterDetailPage`, `DataTableView`, `DataTable`, `DataTableColumnHeader`, `DataTableToolbar`, `DataTablePagination`, `DataTableRowActions`, `KanbanBoard`, `KanbanTaskCard`, `PlatformUserManagement`, `UserManagement`, `StorageManagement`, `StorageDriveList`, `StorageDriveDetail`, `StorageDriveSettingsPanel`, `StorageDrivePermissionsPanel`, `StorageDropzone`, `StorageFileBrowser`, `StorageDriveDetailHeader`, `StorageFileDetailPanel`, `Button`, `Input`, `Label`, `Textarea`, `Badge`, `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`, `Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem`, `SelectGroup`, `SelectLabel`, `SelectSeparator`, `Table`, `TableHeader`, `TableBody`, `TableFooter`, `TableRow`, `TableHead`, `TableCell`, `TableCaption`, `ScrollArea`, `ScrollBar`, `Separator`, `Skeleton`, `Avatar`, `AvatarImage`, `AvatarFallback`, `FormField`, `FormLabel`, `FormControl`, `FormDescription`, `FormMessage`, `Pagination`, `PaginationContent`, `PaginationItem`, `PaginationLink`, `PaginationPrevious`, `PaginationNext`, `PaginationEllipsis`, `Calendar`, `DatePicker`, `DateRangePicker`, `Command`, `CommandDialog`, `CommandInput`, `CommandList`, `CommandEmpty`, `CommandGroup`, `CommandItem`, `CommandSeparator`, `CommandShortcut`, `Combobox`, `TagInput`, `NotificationBadge`, `NotificationItem`, `NotificationList`, `NotificationDropdown`, `NotificationCenter`, `ValidationRules`, `ValidationMeter`

### React Hooks
`useClient`, `useClientMaybe`, `useIsServer`, `useCollection`, `useLazyCollection`, `useDataPage`, `useDataSelection`, `useRow`, `useRecord`, `useRecordByIdentity`, `useResourceClient`, `useResourceList`, `useResourceRecord`, `useResourceActions`, `useQuery`, `useStatus`, `useConnectionHealth`, `useMutation`, `useAuth`, `useAuthConfig`, `useAuthApiKeys`, `useCurrentUser`, `useRequireAuth`, `useUserProperty`, `isAuthorizationScopeCallbackCurrent`, `useAuthorizationScopeBoundary`, `useAuthorization`, `useHasPermission`, `useHasAllPermissions`, `useHasAnyPermission`, `useApplicationAccess`, `usePlatformAdministration`, `usePlatformTenants`, `useAuthAudit`, `useTenantMembers`, `useTenantOnboardingAdministration`, `useTenantDomainAdministration`, `useDomainOnboarding`, `useTenantSwitcher`, `useTenantAppShellWorkspaces`, `useServerState`, `useServerStateReady`, `usePreference`, `useFormDraft`, `useNotifications`, `useUnreadCount`, `useOnNewNotification`, `useNotificationContext`, `useRoom`, `useRoomMembers`, `useRooms`, `useRoomActions`, `useRoomData`, `usePresence`, `usePresenceList`, `useTypingIndicator`, `useUpload`, `useUploadQueue`, `useUploadDropzone`, `useStorageFile`, `useStorageFolder`, `useStorageBrowser`, `useStorageDrives`, `useDriveCapabilities`, `useStoragePermissions`, `useDriveUsage`, `useDriveQuota`, `usePresignedUrl`, `useStorageActions`, `useWorkflow`, `useWorkflowList`, `useWorkflowActions`, `useWorkflowRun`, `useParams`, `usePathname`, `useRouter`, `useForm`, `useDataTable`, `useDataTableSource`, `useAdminUsers`, `useAsyncAction`, `useAutoHeight`, `useClickAway`, `useConfirm`, `useControlledState`, `useCopyToClipboard`, `useDataState`, `useDebouncedCallback`, `useDebouncedValue`, `useDisclosure`, `useHotkey`, `useIdle`, `useInterval`, `useIsInView`, `useIsMobile`, `useMediaQuery`, `useMounted`, `useMotionValueState`, `useOs`, `usePrevious`, `useStableCallback`, `useStickToBottom`, `useStickToBottomContext`, `useTextSelection`, `useThrottledCallback`, `useThrottledValue`, `useTimeout`

### Constants
`STORAGE_TABLES`, `zeroAnimatedIconNames`, `zeroAnimatedIcons`

### Types
`Client`, `Collection`, `ClientConfig`, `SyncClient`, `ResourceClient`, `ResourceClientOptions`, `ResourceListResult`, `ResourceMutationOptions`, `ResourceRowResult`, `ResourceDeleteResult`, `AuthUser`, `AuthCompletionResult`, `AuthRegistrationResult`, `AuthRegistrationTenant`, `AuthPlatformAdministrationConfig`, `AuthPlatformAdminSdkSurface`, `AuthPlatformTenant`, `AuthPlatformTenantPage`, `AuthEmailVerificationRequiredResult`, `RegisterParams`, `LoginFormProps`, `AppProviderProps`, `ClientProviderProps`, `NotificationProviderProps`, `LinkProps`, `AnimateIconContextValue`, `AnimateIconProps`, `IconProps`, `IconWrapperProps`, `ZeroAnimatedIconComponent`, `ZeroAnimatedIconName`, `ZeroIconProps`, `ThemeProviderProps`, `ThemeTogglerButtonProps`, `PlatformUserManagementProps`, `PlatformAdministrationManagementProps`, `PlatformTenantManagementProps`, `UserManagementProps`, `AuthState`, `AuthActions`, `AuthConfigState`, `AuthConfigStatus`, `AuthorizationScopeBoundary`, `UseAuthorizationResult`, `UseUserPropertyOptions`, `UseUserPropertyResult`, `UseApplicationAccessOptions`, `UseApplicationAccessResult`, `UsePlatformAdministrationOptions`, `UsePlatformAdministrationResult`, `UsePlatformTenantsOptions`, `UsePlatformTenantsResult`, `UseAuthAuditOptions`, `UseAuthAuditResult`, `UseTenantMembersOptions`, `UseTenantMembersResult`, `UseTenantOnboardingAdministrationOptions`, `UseTenantOnboardingAdministrationResult`, `UseTenantDomainAdministrationOptions`, `UseTenantDomainAdministrationResult`, `UseDomainOnboardingOptions`, `UseDomainOnboardingResult`, `UseTenantSwitcherResult`, `CollectionResult`, `LazyCollectionResult`, `LazyCollectionOptions`, `ConnectionHealth`, `DataFilterExpression`, `DataFilterOperator`, `DataFilterPrimitive`, `DataFilterValue`, `DataPageFilters`, `DataPageInfo`, `DataPageOptions`, `DataPageResult`, `DataPageSort`, `DataSelectionMode`, `UseDataSelectionOptions`, `UseDataSelectionReturn`, `IdentityRecordResult`, `RecordResult`, `UseFormDraftOptions`, `UseFormDraftResult`, `UseMutationOptions`, `UseMutationReturn`, `UsePreferenceResult`, `WorkflowActions`, `UseWorkflowResult`, `UseWorkflowListResult`, `UseWorkflowRunOptions`, `UseWorkflowRunResult`, `WorkflowProgress`, `InferRow`, `InferInsert`, `InsertInput`, `PrimaryKeyOf`, `Register`, `TableNames`, `RegisteredTableRow`, `Notification`, `NotificationReceipt`, `NotificationWithStatus`, `UseNotificationsResult`, `NotificationType`, `NotificationPriority`, `NotificationTarget`, `PresenceMember`, `PresenceListMember`, `TypingIndicatorMember`, `UsePresenceResult`, `UsePresenceListOptions`, `UsePresenceListReturn`, `UseTypingIndicatorOptions`, `UseTypingIndicatorReturn`, `Animation`, `GetTargetScrollTop`, `ScrollElements`, `ScrollToBottom`, `ScrollToBottomOptions`, `SpringAnimation`, `StickToBottomContext`, `StickToBottomInstance`, `StickToBottomOptions`, `StickToBottomProps`, `StickToBottomState`, `StopScroll`, `UploadState`, `UseUploadReturn`, `UploadFileOptions`, `UseUploadQueueReturn`, `UploadQueueFilesOptions`, `UploadQueueItem`, `UploadQueueItemStatus`, `UseUploadDropzoneOptions`, `UseUploadDropzoneReturn`, `UseStorageFileReturn`, `UseStorageFolderReturn`, `UseStorageBrowserReturn`, `StorageBrowserActions`, `UseStorageDrivesReturn`, `UseDriveCapabilitiesReturn`, `UseStoragePermissionsReturn`, `UseDriveUsageReturn`, `UseDriveQuotaReturn`, `UsePresignedUrlReturn`, `StorageActions`, `CreateUploadGrantParams`, `GrantPermissionParams`, `ListPermissionsOptions`, `StorageAccessCapabilities`, `StorageUploadGrant`, `DriveRecord`, `DriveRecordWithAccess`, `PermissionRecord`, `FileInfo`, `DriveUsage`, `StorageManagementProps`, `StorageManagementView`, `StorageDriveRow`, `StorageDriveListProps`, `StorageDriveDetailProps`, `StorageDriveSettingsPanelProps`, `StorageDrivePermissionsPanelProps`, `StorageDropzoneProps`, `StorageFileBrowserProps`, `StorageDriveDetailHeaderProps`, `StorageFileDetailPanelProps`, `RouteModule`, `RouteNode`, `MatchResult`, `LoaderContext`, `ApiHandler`, `PageMeta`, `RouterConfig`, `SchemaDescriptor`, `TableDefinition`, `FieldType`, `FieldMeta`, `FieldDef`, `UseFormOptions`, `UseFormReturn`, `MasterDetailPageProps`, `MasterDetailRenderContext`, `DataTableCellContext`, `DataTableColumnOverride`, `DataTableColumnOverrides`, `DataTableFilters`, `DataTableFilterValue`, `DataTableInitialState`, `DataTableProps`, `DataTableSource`, `DataTableSourceActions`, `DataTableSourceState`, `UseDataTableOptions`, `UseDataTableReturn`, `UseDataTableSourceOptions`, `RowAction`, `KanbanBoardProps`, `KanbanItemMove`, `KanbanTaskCardProps`, `KanbanTarget`, `ProjectKanbanMoveInput`, `ProjectKanbanMoveResult`, `CrudPageProps`, `CalendarProps`, `DatePickerProps`, `DateRangePickerProps`, `ComboboxProps`, `ComboboxOption`, `TagInputProps`, `NotificationBadgeProps`, `NotificationItemProps`, `NotificationItemType`, `NotificationListProps`, `NotificationListItem`, `NotificationDropdownProps`, `NotificationCenterProps`, `ValidationRule`, `ValidationRulesProps`, `ValidationMeterProps`, `AutoHeightOptions`, `ClickAwayEvent`, `CommonControlledStateProps`, `ConfirmOptions`, `DataStateValue`, `HotkeyHandler`, `HotkeyOptions`, `OperatingSystem`, `OSDetectionInput`, `UseAsyncActionOptions`, `UseAsyncActionReturn`, `UseClickAwayOptions`, `UseCopyToClipboardOptions`, `UseCopyToClipboardReturn`, `UseDebouncedCallbackOptions`, `UseDebouncedCallbackReturn`, `UseDisclosureOptions`, `UseDisclosureReturn`, `UseIdleOptions`, `UseIntervalOptions`, `UseIsInViewOptions`, `UseMediaQueryOptions`, `UseOsOptions`, `UseOsReturnValue`, `UseThrottledCallbackOptions`, `UseThrottledCallbackReturn`, `UseThrottledValueOptions`

Guardian user API-key types in the browser-safe barrel:
`AuthApiKeyApplicationAdminSdkSurface`, `AuthApiKeyCreatedVia`,
`AuthApiKeyIssueInput`, `AuthApiKeyListQuery`,
`AuthApiKeyManagementCapabilities`, `AuthApiKeyPage`,
`AuthApiKeyPlatformAdminSdkSurface`, `AuthApiKeyScopeKind`,
`AuthApiKeySdkSurface`, `AuthApiKeySelfSdkSurface`, `AuthApiKeyStatus`,
`AuthApiKeySummary`, `AuthApiKeyTenantAdminSdkSurface`,
`AuthPlatformApiKeyListQuery`, `IssuedAuthApiKey`, `UseAuthApiKeysOptions`,
`UseAuthApiKeysResult`, `ApiKeyManagementCommonProps`,
`ApiKeyManagementProps`, `SelfApiKeyManagementProps`,
`ApplicationUserApiKeyManagementProps`, `TenantMemberApiKeyManagementProps`,
and `PlatformApiKeyManagementProps`.

`StorageUploadGrantResource` is a server/storage contract rather than a React
barrel export. Import it from `@zero/framework/storage` or
`@zero/framework/server`.

Native-only (from `@zero/framework/native`): `createZeroNativeAuth`,
`createZeroNativeAuthBroker`, `createNativeAuthClient`,
`createNativeAuthBroker`, `createNativeAuthBrokerClient`,
`createNativeSyncAuth`, `NativeAuthError`, `NativeAuthClient`,
`NativeAuthClientOptions`, `NativeAuthState`, `NativeAuthStatus`,
`NativeTenantSummary`, `NativeTenantListResult`, `NativeAuthErrorInfo`,
`NativeAuthStateListener`, `NativeSignInOptions`,
`NativeSignUpOptions`, `NativeIdentityScope`, `NativeAuthBroker`,
`NativeAuthBrokerClient`, `NativeAuthBrokerClientOptions`,
`NativeAuthBrokerRequest`, `NativeAuthBrokerResponse`,
`NativeAuthBrokerTransport`, `NativeAuthBrokerSnapshot`,
`NativeAuthBrokerStateListener`, `ZeroNativeAuth`, `ZeroNativeAuthOptions`,
`NativeSecureVault`, `NativeSystemBrowser`, `NativeCallbackAdapter`,
`NativeCallbackSession`, `NativeCryptoAdapter`, `NativeFetch`,
`NativeSyncAuthConfig`, `NativeIdTokenClaims`, and `NativeOidcMetadata`.

Server-only (from `@zero/framework/server`): `App`, `AppConfig`, `AppStorageConfig`, `ResolvedConfig`, `ResolvedAppStorageConfig`, `AppDatabaseTopologyConfig`, `AppSingleDatabaseTopologyConfig`, `AppMultipleDatabaseTopologyConfig`, `AppDatabaseActorConfig`, `AppDatabaseHotPlacementConfig`, `AppDatabasePlacementConfig`, `AppDatabasePlacementPolicyConfig`, `AppTenantDataIsolation`, `ResolvedAppDatabaseTopologyConfig`, `ResolvedAppSingleDatabaseTopologyConfig`, `ResolvedAppMultipleDatabaseTopologyConfig`, `DatabaseCoordinatorRestartPolicy`, `NormalizedDatabaseCoordinatorRestartPolicy`, `DatabaseRealm`, `DatabaseRealmDefinition`, `DatabaseReadQueryConnection`, `DatabaseReadQueryContext`, `DatabaseReadQueryStatement`, `DatabaseActorLaunch`, `DatabaseActorSourceLaunch`, `DatabaseActorBundleLaunch`, `DatabaseActorCommandPrefixLaunch`, `DatabaseActorExecutorPolicy`, `DatabaseActorSQLiteConfig`, `RunDatabaseActorIfRequestedOptions`, `AsyncDatabaseClient`, `DatabaseOperationRow`, `DatabaseSerializableValue`, `DatabaseListPage`, `DatabaseListPageOptions`, `DatabaseFindInput`, `DatabaseFindRows`, `DatabaseFindFilter`, `DatabaseFindFieldFilter`, `DatabaseFindFilterGroup`, `DatabaseFindFilterOperator`, `DatabaseFindOrder`, `DatabaseMutation`, `DatabaseMutationOptions`, `DatabaseAssertion`, `DatabaseBatchInput`, `DatabaseReadOptions`, `DatabaseReadConsistency`, `DatabaseReadResult`, `DatabaseCommitResult`, `DatabaseSequenceToken`, `DatabaseTenantSyncSnapshotPage`, `DatabaseTenantSyncSnapshotSession`, `DatabaseError`, `DatabaseErrorCode`, `DatabaseRef`, `DatabasePlacement`, `DatabasePlacementPolicy`, `DatabasePlacementSelector`, `DatabasePlacementSelectorContext`, `DatabaseHotDurability`, `DatabaseHotPlacementConfig`, `DATABASE_ACTOR_CHILD_FLAG`, `DATABASE_HOT_DEFAULT_DURABILITY`, `DATABASE_HOT_DEFAULT_SNAPSHOT_INTERVAL_MS`, `DATABASE_HOT_MIN_SNAPSHOT_TIMEOUT_MS`, `DATABASE_HOT_MAX_SNAPSHOT_INTERVAL_MS`, `DATABASE_HOT_MAX_SNAPSHOT_TIMEOUT_MS`, `DATABASE_HOT_SHORTHAND_MAX_BYTES`, `DATABASE_TENANT_SYNC_SNAPSHOT_MAX_ROWS`, `DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SESSIONS`, `DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SOURCE_BYTES`, `DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SOURCE_ROW_BYTES`, `DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SOURCE_ROW_NODES`, `DATABASE_TENANT_SYNC_SNAPSHOT_PAGE_MAX_NODES`, `DATABASE_TENANT_SYNC_SNAPSHOT_PAGE_MAX_ROWS`, `DATABASE_TENANT_SYNC_SNAPSHOT_PAGE_MAX_SOURCE_BYTES`, `DATABASE_TENANT_SYNC_SNAPSHOT_TTL_MS`, `DATABASE_WRITER_MAX_RECEIPT_KEYS`, `DATABASE_WRITER_MAX_RECEIPT_RESULT_BYTES`, `DATABASE_WRITER_MAX_RECEIPTS`, `DATABASE_WRITER_MAX_RETAINED_RECEIPT_BYTES`, `defaultDatabaseHotSnapshotTimeoutMs`, `createDatabaseRef`, `createNamedDatabaseRef`, `createTenantDatabaseRef`, `AuthPluginConfig`, `AuthTenancyMode`, `AuthTenancyConfig`, `AuthTenancyOptions`, `ResolvedAuthTenancyConfig`, `AuthAuthorizationMode`, `AuthAuthorizationConfig`, `AuthAuthorizationOptions`, `AuthPermissionConfig`, `ResolvedAuthPermissionConfig`, `AuthRoleTemplateConfig`, `ResolvedAuthRoleTemplateConfig`, `ResolvedAuthAuthorizationConfig`, `NormalizedAuthBehaviorConfig`, `ResolvedAuthBehaviorConfig`, `PermissionKey`, `AuthorizationKernel`, `AuthorizationKernelConfig`, `AccessRequirement`, `StructuredAccessRequirement`, `CompiledAccessRequirement`, `AuthorizationSubjectSnapshot`, `AuthorizationScopeSnapshot`, `AuthorizationDecision`, `ProtectedMultipartRequestGuardOptions`, `ZeroElysiaAuthRequirement`, `NativeAuthConfig`, `NativeAuthorizationRequestPolicyConfig`, `NativeAuthorizationSourceResolver`, `NativeRefreshRotationPolicyConfig`, `JobDefinition`, `JobStatus`, `SchedulerPluginConfig`, `StoragePluginConfig`, `StorageAdapter`, `StorageDriveApi`, `StorageObjectApi`, `StoragePermissionApi`, `StorageUploadGrantApi`, `StorageServiceOptions`, `CreateUploadGrantTokenOptions`, `VerifiedUploadGrant`, `PdfConfig`, `PdfRenderInput`, `PdfRenderResult`, `PdfService`, `PdfStorageTarget`, `PlatformTokenService`, `PlatformActionTokenRecord`, `PlatformResumeTokenRecord`, `ObservabilityConfig`, `PlatformEvent`, `PlatformSink`, `createApp`, `resolveConfig`, `defineDatabaseRealm`, `runDatabaseActorIfRequested`, `defineAuthConfig`, `resolveAuthBehaviorConfig`, `createAuthorizationKernel`, `compileAccessRequirement`, `mergeAccessRequirements`, `validateAuthorizationRegistry`, `defineNativeAuthConfig`, `resolveNativeAuthConfig`, `createAuthPlugin`, `installAuthStopBarrier`, `createAuthMiddleware`, `createProtectedMultipartRequestGuard`, `getTokenService`, `createPlatformTokenPlugin`, `getPlatformTokenService`, `createPdfPlugin`, `getPdfService`, `requirePdfService`, `createSchedulerPlugin`, `getScheduler`, `createNotificationPlugin`, `createStoragePlugin`, `getStorageService`, `createUploadGrantToken`, `verifyUploadGrantToken`, `emitPlatformCode`, `createObservabilityPlugin`

The server-only Fabric realm contracts also export
`DatabaseReadQueryHandler`, `DatabaseReadQueryRegistry`,
`DatabaseWriteCommandCapability`, `DatabaseWriteCommandContext`,
`DatabaseWriteCommandHandler`, and `DatabaseWriteCommandRegistry` for typed
registered operations.

Guardian user API-key configuration and credential policy types from that
server barrel: `AuthApiKeyConfig`, `AuthApiKeyOptions`,
`ResolvedAuthApiKeyConfig`, and `AuthorizationCredentialKind`.

Sync-only (from `@zero/framework/sync`): `createDefaultSyncPolicy`, `combineSyncPolicies`, `allowAllSyncPolicy`, `getReadableSyncTables`, `evaluateSyncReadPolicy`, `evaluateSyncMutationPolicy`, `SYNC_ACK_ERROR_CODES`, `SyncAckErrorCode`, `SyncPolicy`, `SyncReadPolicyContext`, `SyncMutationPolicyContext`

### CVA Variant Functions
`buttonVariants`, `badgeVariants`

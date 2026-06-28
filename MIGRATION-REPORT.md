# SDK Migration Report

All changes are in the platform at `/home/catalyst/Downloads/platform/`. The IOP tracker at `projects/ioptracker/` needs its copied platform files replaced and its app code updated.

---

## DX Overhaul: 6 Improvements (2026-03-17)

Eliminates ~60 duplicate type interfaces, ~30 manual UUID calls, a 50-line app-level hook, a 66-line app-level API route, the two-line collection dance in 12+ files, and ~200 lines of CRUD boilerplate per page.

### 1. Auto-PK on Insert

`collection.insert()` and `useCollection().insert()` now auto-generate a UUID for the primary key if not provided.

```tsx
// BEFORE — every insert, every file
collection.insert({ id: crypto.randomUUID(), title: 'Buy milk', done: 0 });

// AFTER — just the data
collection.insert({ title: 'Buy milk', done: 0 });
```

**Files changed:** `src/frontend/client/sdk.ts` (Collection.insert), `src/sync/client/sync-client.ts` (SyncClient.insert)

### 2. InferRow Type — No More Duplicate Interfaces

Derive TypeScript row types from `defineTable()` output. Replaces hand-written interfaces in every page file.

```ts
// BEFORE — copy-pasted in 6 files, drifts from schema
interface ClientRow { id: string; first_name: string; last_name: string; ... }

// AFTER — one line, always matches schema
import { type InferRow } from '@platform/frontend';
type ClientRow = InferRow<typeof clientTable>;
```

**Files changed:** `src/schema/infer.ts`, `src/schema/index.ts`, `src/frontend/index.ts`

### 3. Auto `/api/data` Endpoint for Lazy Tables

Platform auto-registers `GET /api/data` for tables marked `sync: 'lazy'`. Apps no longer need to hand-write query routes.

- Validates table name against allowed set (lazy tables only)
- Validates column names against known schema (SQL injection prevention)
- Parameterized queries for all filter values
- Limit capped at 1000
- Auth enforced when auth is enabled

**Files changed:** `src/sync/data-query.plugin.ts` (new), `src/frontend/server/types.ts`, `src/frontend/server/app-factory.ts`

**IOP migration:** Delete `app/api/data/route.ts` — the platform handles it now.

### 4. Platform `useLazyCollection` Hook

Absorbs the app-level `useLazyCollection` into the SDK. Adds loading state, error state, and refresh.

```tsx
// BEFORE — app-level hook, silent error swallowing, tuple filters
import { useLazyCollection } from '@app/hooks/use-lazy-collection';
const screens = useLazyCollection<ScreenRow>('drug_screens', [['client_id', id]]);

// AFTER — platform hook, error/loading states, object filters
import { useLazyCollection } from '@platform/frontend';
const { data, isLoading, error, refresh } = useLazyCollection<ScreenRow>('drug_screens', {
  client_id: id,
});
```

**Files changed:** `src/frontend/client/hooks.ts`, `src/frontend/index.ts`

**IOP migration:** Delete `app/hooks/use-lazy-collection.ts`. Update all 13 files that import it:
- Change import from `'@app/hooks/use-lazy-collection'` to `'@platform/frontend'`
- Change filter format from `[['field', value]]` to `{ field: value }`

### 5. `useCollection` as Primary API

`useCollection()` already returns `insert`/`update`/`remove` — no need for the `useClient()` + `client.collection()` two-liner. JSDoc updated to make this the documented primary pattern.

```tsx
// BEFORE — two lines, manual PK
const client = useClient();
const collection = client.collection('clients');
collection.insert({ id: crypto.randomUUID(), first_name: 'Jane', ... });

// AFTER — one hook, auto PK
const { data, insert } = useCollection<ClientRow>('clients');
insert({ first_name: 'Jane', ... });
```

**Files changed:** `src/frontend/client/hooks.ts` (JSDoc only)

### 6. CrudPage — Full CRUD Interface from Schema

A single component that composes DataTable + AutoForm + modals + collections into a complete CRUD page. Eliminates the ~200 lines of boilerplate per page (form state, modal wiring, insert/update/delete handlers, toast notifications, loading states).

```tsx
// BEFORE — 250+ lines per page
const clients = useLazyCollection<ClientRow>('clients');
const client = useClient();
const collection = client.collection('clients');
// ... form state, modal open handlers, create/edit/delete callbacks, JSX

// AFTER — one component
import { CrudPage } from '@platform/frontend';
import { clientTable } from '@app/lib/schemas/client';

export default function ClientsPage() {
  return (
    <CrudPage
      table="clients"
      schema={clientTable.schema}
      columns={['first_name', 'last_name', 'status']}
      lazy
      title="Clients"
      createLabel="Add Client"
      searchable
    />
  );
}
```

Supports customization via props: `onRowClick`, `rowActions`, `onBeforeCreate`, `onBeforeUpdate`, `createFields`/`editFields` (hide fields from forms), `toolbar`, `emptyState`, `filters`, `modalSize`, `paginated`, `sortable`.

**Files added:** `src/components/crud-page/crud-page.tsx`, `src/components/crud-page/index.ts`
**Files changed:** `src/frontend/index.ts` (barrel export)

### Schema Import Path

`defineTable` and `field` are now exported from `@platform/frontend` (client-safe). Schema files should import from here:

```ts
import { defineTable, field } from '@platform/frontend';
```

Not from `@platform/server` (which pulls in bun:sqlite and breaks the client bundler).

---

## Critical Fix: "Unknown table" Bug (2026-03-17)

### Root Cause

`hydrate.tsx` wrapped the entire app in `AppProvider`, passing tables from `__PLATFORM_CONFIG__`. But `__PLATFORM_CONFIG__.tables` contained **server table schemas** (SQL column defs like `{ id: 'text primary key' }`), not `ClientTableDef` objects (which require `_pk: 'id'`).

The SDK singleton pattern meant the first `createClient()` call (from hydrate.tsx) created the client with wrong table format. The layout's `AppProvider` then called `getClient()` which returned the existing broken client -- never calling `createClient()` with correct tables. Result: `tableDefs['clients']._pk` was `undefined`, throwing "Unknown table: clients" on any insert.

### What Changed

**Platform files (sync these to IOP):**

| File | Change |
|------|--------|
| `src/frontend/client/hydrate.tsx` | No longer wraps in AppProvider. Only RouterProvider + ErrorBoundary. |
| `src/frontend/client/app-provider.tsx` | Detects existing RouterProvider via `useHasRouter()`. Accepts `defineTable()` output in `tables` prop. |
| `src/frontend/client/sdk.ts` | `createClient()` normalizes tables -- auto-extracts `.clientTable` from `defineTable()` output. New `TableInput` type. |
| `src/frontend/client/router-context.tsx` | Exports `useHasRouter()` for nested provider detection. |
| `src/frontend/server/client-bundle.ts` | Cleans stale `.js`/`.js.map` from `.build/` before each build. |
| `src/frontend/server/types.ts` | `AppConfig.tables` accepts `defineTable()` output directly. |
| `src/frontend/server/app-factory.ts` | `platformConfig` no longer includes `tables`. |
| `src/frontend/router/renderer.ts` | `PlatformConfig` no longer has `tables` field. |

**IOP app files (already updated):**

| File | Change |
|------|--------|
| `app/lib/schemas/index.ts` | Exports single `tables` object (full `defineTable()` output). Old `serverTables`/`clientTables` removed. |
| `app/layout.tsx` | `import { tables }` instead of `import { clientTables }` |
| `app/server.ts` | `import { tables }` instead of `import { serverTables }`. `platformConfig` no longer includes `tables`. |

### New Table API Pattern

Apps no longer need to manually extract `.serverTable` / `.clientTable`:

```ts
// app/lib/schemas/index.ts -- BEFORE (fragile)
export const serverTables = { clients: clientTable.serverTable, ... };
export const clientTables = { clients: clientTable.clientTable, ... };

// app/lib/schemas/index.ts -- AFTER (just pass the table objects)
export const tables = { clients: clientTable, groups: groupTable, ... };
```

Both `createApp({ tables })` and `<AppProvider tables={tables}>` auto-detect `defineTable()` output and extract what they need.

### Rsync After This Fix

```bash
rsync -av --delete --exclude='node_modules' --exclude='.build' \
  src/ projects/ioptracker/src/
```

Then restart the dev server. The `.build/` directory is auto-cleaned on startup.

### Schema Import Path Fix

`defineTable` and `field` are now re-exported from `@platform/frontend` (the client barrel). Schema files should import from here — NOT from `@platform/server` (which pulls in `bun:sqlite` and breaks the client bundler).

```ts
// CORRECT — client-safe, works everywhere
import { defineTable, field } from '@platform/frontend';

// WRONG — pulls in bun:sqlite via createApp → reactive-db
import { defineTable, field } from '@platform/server';
```

The old `@platform/schema` alias still works but `@platform/frontend` is now the canonical single import for all app code.

### Dead Code Removed

- `serverTables` and `clientTables` exports deleted from `app/lib/schemas/index.ts`
- `schema?: { clientTables }` option removed from `ClientConfig` — one way to pass tables, not two

---

## Files to Copy (Platform → IOP Tracker)

Copy these files from the platform `src/` to `projects/ioptracker/src/`, replacing existing versions:

### Core SDK (4 files)
```
src/frontend/client/sdk.ts          → projects/ioptracker/src/frontend/client/sdk.ts
src/frontend/client/hooks.ts        → projects/ioptracker/src/frontend/client/hooks.ts
src/frontend/client/app-provider.tsx → projects/ioptracker/src/frontend/client/app-provider.tsx
src/frontend/index.ts               → projects/ioptracker/src/frontend/index.ts
```

### Sync Layer (5 files)
```
src/sync/types.ts                   → projects/ioptracker/src/sync/types.ts
src/sync/client/sync-store.ts       → projects/ioptracker/src/sync/client/sync-store.ts
src/sync/client/sync-client.ts      → projects/ioptracker/src/sync/client/sync-client.ts
src/sync/message-handler.ts         → projects/ioptracker/src/sync/message-handler.ts
src/sync/client/state-client.ts     → projects/ioptracker/src/sync/client/state-client.ts
src/sync/client/ephemeral-client.ts → projects/ioptracker/src/sync/client/ephemeral-client.ts
```

### Schema (3 files — 1 new)
```
src/schema/define-schema.ts         → projects/ioptracker/src/schema/define-schema.ts
src/schema/index.ts                 → projects/ioptracker/src/schema/index.ts
src/schema/registry.ts              → projects/ioptracker/src/schema/registry.ts  (NEW FILE)
```

### Internal SDK files (5 files)
```
src/frontend/client/auth-client.ts        → projects/ioptracker/src/frontend/client/auth-client.ts
src/frontend/client/room-hooks.ts         → projects/ioptracker/src/frontend/client/room-hooks.ts
src/frontend/client/notification-hooks.ts → projects/ioptracker/src/frontend/client/notification-hooks.ts
src/frontend/client/workflow-hooks.ts     → projects/ioptracker/src/frontend/client/workflow-hooks.ts
src/hooks/use-form.ts                     → projects/ioptracker/src/hooks/use-form.ts
```

### Component (1 file)
```
src/components/data-table/data-table.tsx → projects/ioptracker/src/components/data-table/data-table.tsx
```

**This was the original count. See [Consolidated File Copy List](#consolidated-file-copy-list) at the bottom for the complete updated list: 94 files (27 new + 67 updated).**

---

## App Code Changes Required

After copying the platform files, the IOP tracker's own app code needs updating. Every file below is in `projects/ioptracker/app/`.

### 1. Hook Renames (every page/component using data hooks)

Find and replace across ALL `.tsx` files in `app/`:

| Old | New |
|-----|-----|
| `useLiveCollection` | `useCollection` |
| `useLiveRow` | `useRow` |
| `useLiveQuery` | `useQuery` |
| `useConnectionStatus` | `useStatus` |
| `LiveCollectionResult` | `CollectionResult` |

### 2. Return Shape Changes (every component using useCollection)

The `useCollection` (formerly `useLiveCollection`) return shape changed:

| Old Property | New Property | Type |
|-------------|-------------|------|
| `.rows` | `.byId` | `Record<string, T>` |
| `.list` | `.data` | `T[]` |

Find and replace across ALL `.tsx` files:

```
.rows  →  .byId     (when accessing the Record<string, T> map)
.list  →  .data     (when accessing the T[] array)
```

**IMPORTANT:** Many IOP tracker files call `.rows.filter()` or `.rows.map()` as if `.rows` were an array. It was always a Record — this worked by accident or was a bug. These should use `.data.filter()` / `.data.map()` instead.

### 3. Delete Duplicate Row Interfaces

The IOP tracker defines row interfaces (e.g., `interface ClientRow`, `interface GroupRow`) in almost every page file. These should be defined ONCE and imported. After the schema registry is set up, types flow automatically from the schema.

Files with duplicate interfaces to clean up:
- `app/dashboard/page.tsx` — ClientRow, GroupRow, SessionRow, ScreenRow
- `app/reports/page.tsx` — ClientRow, GroupRow, SessionRow, AttendanceRow, DrugScreenRow, DrVisitRow
- `app/clients/page.tsx` — ClientRow
- `app/clients/client-assignments.tsx` — ClientRow, GroupRow, ProgramRow
- `app/groups/page.tsx` — GroupRow
- `app/schedule/page.tsx` — SessionRow, GroupRow
- `app/groups/session-attendance.tsx` — AttendanceRow, ClientRow
- `app/lib/notification-triggers.ts` — ClientRow, DrugScreenRow

**Recommended approach:** Create a single `app/lib/types.ts` that exports all row types, or use the schema Register pattern for automatic inference.

### 4. Client API Changes

**`client.auth` is removed from the public interface.** These methods are now top-level:

| Old | New |
|-----|-----|
| `client.auth.login(u, p)` | `client.login(u, p)` |
| `client.auth.logout()` | `client.logout()` |
| `client.auth.register(params)` | `client.register(params)` |
| `client.auth.user` | `client.user` |
| `client.auth.isAuthenticated` | `client.isAuthenticated` |
| `client.auth.accessToken` | `client.token` |
| `client.auth.changePassword(old, new)` | `client.changePassword(old, new)` |
| `client.auth.refresh()` | `client.refresh()` |
| `client.auth.setProperty(k, v)` | `client.setProperty(k, v)` |
| `client.auth.getProperty(k)` | `client.getProperty(k)` |
| `client.auth.getProperties()` | `client.getProperties()` |
| `client.auth.deleteProperty(k)` | `client.deleteProperty(k)` |

**`client.state` and `client.ephemeral` are removed from the public interface.** The hooks (`useServerState`, `useEphemeral`, `usePresence`) still work — they access these internally. If app code directly uses `client.state.set(...)` or `client.ephemeral.set(...)`, cast to `InternalClient` first:
```ts
import type { InternalClient } from '../src/frontend';
const internal = client as InternalClient;
internal.state?.set('key', value);
```

### 5. Schema Updates (app/lib/schemas/index.ts)

~~The `clientTables` definition currently uses ugly manual spreads for `_sync`.~~ **SUPERSEDED** by the 2026-03-17 fix above. The new pattern is a single `tables` export:

```ts
// app/lib/schemas/index.ts — current pattern
export const tables = {
  programs: programTable,
  groups: groupTable,
  clients: clientTable,
  // ... all tables as defineTable() output
};
```

Both `createApp({ tables })` (server) and `<AppProvider tables={tables}>` (client) auto-detect `defineTable()` output and extract `.serverTable` / `.clientTable` respectively. No manual extraction needed.

Each schema file should still pass `{ sync: 'lazy' }` to defineTable for lazy-synced tables:
- `app/lib/schemas/client.ts` — `defineTable('clients', { ... }, { sync: 'lazy' })`
- `app/lib/schemas/client-note.ts` — `{ sync: 'lazy' }`
- `app/lib/schemas/insurance-review.ts` — `{ sync: 'lazy' }`
- `app/lib/schemas/session.ts` — `{ sync: 'lazy' }`
- `app/lib/schemas/attendance.ts` — `{ sync: 'lazy' }`
- `app/lib/schemas/drug-screen.ts` — `{ sync: 'lazy' }`
- `app/lib/schemas/dr-visit.ts` — `{ sync: 'lazy' }`
- `app/lib/schemas/intake.ts` — `{ sync: 'lazy' }`
- `app/lib/schemas/group-history.ts` — `{ sync: 'lazy' }`

### 6. Lazy Table Data Loading

Lazy tables (`_sync: 'lazy'`) are NOT sent on WebSocket connect. Every component that reads a lazy table needs to fetch data via REST and call `collection.load()`.

**Pattern:**
```tsx
const { data, load } = useCollection<ClientRow>('clients');

useEffect(() => {
  client.get<{ records: ClientRow[] }>('/api/clients')
    .then(res => load(res.records, { replace: true }));
}, []);
```

**Components that need this pattern:**
- Every page using `useCollection('clients')`, `useCollection('sessions')`, `useCollection('session_attendance')`, `useCollection('drug_screens')`, `useCollection('dr_visits')`, `useCollection('client_notes')`, `useCollection('insurance_reviews')`, `useCollection('intakes')`, `useCollection('group_history')`

**REST endpoints needed:** The server needs API routes to serve filtered data for each lazy table. These do not exist yet and need to be created. Example routes:
- `GET /api/clients` — all active clients
- `GET /api/sessions?group_id=X` — sessions for a group
- `GET /api/attendance?session_id=X` — attendance for a session
- `GET /api/client-notes?client_id=X` — notes for a client
- `GET /api/drug-screens?client_id=X` — screens for a client
- `GET /api/dr-visits?client_id=X` — visits for a client

---

## What Changed and Why

### Backwards Compat Removal
- `client.auth` removed from public interface (still works internally)
- `typeof sub === 'function'` dead code checks removed (6 locations)
- Old sync hook re-exports removed (`useTable`, `useRow`, `useQuery`, `useSyncStatus`)
- Raw `fetch()` with manual auth headers replaced with `client.post()`/`client.delete()` in room-hooks and workflow-hooks
- Server `sync.subscribe` handler no longer falls back to all tables when `snapshot` field missing — `snapshot` is now required

### Lazy Sync Bug Fixes
- **Reconnect bug fixed:** Ring buffer miss was sending ALL tables including lazy ones. Now correctly sends only full-sync tables.
- **Pending mutation fix:** `sync.snapshot` no longer clears pending mutations for lazy tables that weren't in the snapshot.
- **Load + pending fix:** `sync.load` with `replace: true` now re-applies pending optimistic mutations instead of dropping them.

### SDK DX Overhaul
- `schema()` function for one-call multi-table definition
- `defineTable()` now accepts `{ sync: 'lazy' }` option
- Register pattern for global type inference (table names autocomplete, row types auto-inferred)
- Hooks renamed: `useLiveCollection` → `useCollection`, `useLiveRow` → `useRow`, `useLiveQuery` → `useQuery`, `useConnectionStatus` → `useStatus`
- Return shape: `.rows` → `.byId`, `.list` → `.data`
- `InternalClient` type for SDK-internal access to auth/state/ephemeral

### Eden Treaty (Typed API Client)
- `@elysiajs/eden` added as dependency
- `client.api` — fully typed Eden Treaty proxy for all server routes
- Auth headers injected lazily (supports token refresh), 401 auto-retry via `authClient.fetchWithAuth`
- `unwrap()` helper exported — converts Eden `{ data, error }` response to value-or-throw
- `useRoomActions` and `useWorkflowActions` now use `client.api` instead of `client.post()`
- `client.get/post/put/patch/delete` still available as escape hatch for app-specific routes

**New files to copy:**
```
src/frontend/client/api.ts → projects/ioptracker/src/frontend/client/api.ts (NEW)
```

**Updated files (already in copy list):**
- `src/frontend/client/sdk.ts` — adds `api` property to Client interface
- `src/frontend/client/room-hooks.ts` — uses `client.api.rooms` instead of `client.post('/rooms')`
- `src/frontend/client/workflow-hooks.ts` — uses `client.api.workflows` instead of `client.post('/workflows')`
- `src/frontend/index.ts` — exports `Api` type and `unwrap()`

**App code migration:**
```ts
// OLD — untyped, manual path strings
const data = await client.post<{ room: RoomRecord }>('/rooms', { name: 'Room' });

// NEW — typed, auto-completed
import { unwrap } from '../src/frontend';
const data = unwrap(await client.api.rooms.post({ name: 'Room' }));

// Dynamic path params use bracket syntax
unwrap(await client.api.rooms[roomId].join.post());
unwrap(await client.api.workflows[instanceId].cancel.post());
```

### Reference Docs
Read these for full API details:
- `docs/sdk-reference.md` — comprehensive SDK reference
- `docs/frontend/sdk.md` — detailed SDK internals
- `docs/platform-overview.md` — architecture overview

---

## Breaking: Barrel Export Split (Server vs Client)

The platform barrel `src/frontend/index.ts` has been split into **two** entrypoints to prevent `bun:sqlite` from being bundled into client code.

### What Changed

**`src/frontend/index.ts`** — now **CLIENT-SAFE ONLY**. All server-only exports (anything that touches `bun:sqlite`) have been removed from this file.

**`src/frontend/server.ts`** — new file containing all **SERVER-ONLY** exports.

### Removed from `src/frontend/index.ts` (moved to `server.ts`)

These exports were removed from the client barrel because they pull in `bun:sqlite` through their import chains:

| Export | Moved To |
|--------|----------|
| `createApp` | `src/frontend/server` |
| `AuthError`, `AUTH_DEFAULTS` | `src/frontend/server` |
| `createRoomPlugin`, `getRoomService`, `PresenceService` | `src/frontend/server` |
| `ROOM_TABLES` | `src/frontend/server` |
| `NOTIFICATION_TABLES` | `src/frontend/server` |
| `createSchedulerPlugin`, `getScheduler` | `src/frontend/server` |
| `createWorkflowPlugin`, `getWorkflowService`, `getWorkflowRegistry` | `src/frontend/server` |

**Note:** `defineSchema`, `defineTable`, `schema`, `field` were moved BACK to `src/frontend/index.ts` (2026-03-17). They have zero server dependencies — the schema module only uses `import type` from sync/types.

### How to Update App Code

**Server entry (app.ts):**
```ts
// OLD — imported everything from one barrel
import { createApp, NOTIFICATION_TABLES, ROOM_TABLES, createSchedulerPlugin } from '../src/frontend';

// NEW — server-only imports from server barrel
import { createApp, NOTIFICATION_TABLES, ROOM_TABLES, createSchedulerPlugin } from '../src/frontend/server';
```

**Schema imports (app/lib/schemas/):**
```ts
// All schema imports come from the client barrel — they're client-safe
import { defineTable, field } from '@platform/frontend';
```

**Client/page code (app/pages/, app/components/) — NO CHANGES NEEDED.**
All React hooks, providers, UI components, and client utilities remain in `src/frontend/index.ts`.

### Files to Copy (New + Updated)

Add these to the copy list:

```
src/frontend/index.ts                  → projects/ioptracker/src/frontend/index.ts (UPDATED — server exports removed)
src/frontend/server.ts                 → projects/ioptracker/src/frontend/server.ts (NEW — server-only barrel)
src/frontend/client/app-provider.tsx   → projects/ioptracker/src/frontend/client/app-provider.tsx (UPDATED — ErrorBoundary added)
src/frontend/client/hooks.ts           → projects/ioptracker/src/frontend/client/hooks.ts (UPDATED — SSR-safe hooks)
src/frontend/client/error-boundary.tsx → projects/ioptracker/src/frontend/client/error-boundary.tsx (NEW)
src/frontend/router/renderer.ts        → projects/ioptracker/src/frontend/router/renderer.ts (UPDATED — styled error pages)
```

### App Import Updates Required

After copying platform files, find and replace imports in the IOP tracker's **server-side code only** (`app.ts` and schema files):

```
# In app.ts (server entry):
import { createApp } from '../src/frontend';
→ import { createApp } from '../src/frontend/server';

# In app.ts (if importing NOTIFICATION_TABLES, ROOM_TABLES, etc.):
import { NOTIFICATION_TABLES, ROOM_TABLES } from '../src/frontend';
→ import { NOTIFICATION_TABLES, ROOM_TABLES } from '../src/frontend/server';

# In app/lib/schemas/ (if importing defineSchema, defineTable, etc.):
import { defineSchema, defineTable } from '../../src/frontend';
→ import { defineSchema, defineTable } from '../../src/frontend/server';

# In any server plugin setup:
import { createSchedulerPlugin, createWorkflowPlugin } from '../src/frontend';
→ import { createSchedulerPlugin, createWorkflowPlugin } from '../src/frontend/server';
```

**Client page/component code does NOT need any import changes.** All hooks, providers, and UI components are still exported from `src/frontend/index.ts`.

---

## SSR Fixes: All Hooks Now SSR-Safe

### What Changed

All client hooks now return safe defaults during SSR instead of throwing. Apps no longer need `<ClientOnly>` wrappers.

| Hook | SSR Behavior |
|------|-------------|
| `useClient()` | Returns `null` (no throw) — only throws on client if no provider |
| `useClientMaybe()` | New — always returns `Client \| null`, never throws |
| `useIsServer()` | New — returns `true` during SSR |
| `useAuth()` | Returns `{ isLoading: true, user: null }` with no-op actions |
| `useCollection()` | Returns `{ data: [], byId: {}, count: 0 }` with no-op mutations |
| `useRow()` | Returns `null` |
| `useQuery()` | Returns `[]` |
| `useStatus()` | Returns `{ connected: false }` |

### What This Means for Apps

- **Remove any `<ClientOnly>` wrappers** — they're no longer needed
- Components that use `useAuth()`, `useCollection()`, etc. now render safely during SSR
- SSR output shows loading states, client hydration fills in real data
- The Next.js-like pattern works: server-render the layout + static content, client hooks activate after hydration

### New Exports

| Export | Description |
|--------|------------|
| `useClientMaybe()` | Safe `Client \| null` — use in components that render on server + client |
| `useIsServer()` | Boolean — `true` during SSR |
| `ErrorBoundary` | Platform error boundary with styled error pages |
| `NotFoundPage` | Styled 404 page component |

---

## Error Handling: Platform ErrorBoundary

### What Changed

`AppProvider` now wraps all children in a platform `ErrorBoundary`. Apps get styled error pages automatically.

**Development mode:** Shows error message, full stack trace, "Try Again" and "Reload" buttons.
**Production mode:** Shows generic error message with "Try Again" and "Reload" buttons.

### Server-Side Error Pages

The SSR renderer now returns styled HTML error pages instead of plain text:
- **404:** Styled "Page not found" page with "Go Home" button
- **500:** Styled error page with stack trace in dev mode

### Custom Error Fallback

Apps can override the default error page:

```tsx
<AppProvider
  url="http://localhost:3000"
  tables={clientTables}
  errorFallback={({ error, reset }) => (
    <div>
      <h1>Oops!</h1>
      <p>{error.message}</p>
      <button onClick={reset}>Try Again</button>
    </div>
  )}
>
  <App />
</AppProvider>
```

### What to Remove from Apps

- Delete any app-level `<ClientOnly>` components — the platform handles SSR boundaries
- Delete any app-level error boundary implementations — the platform provides one
- Delete any manual `typeof window === 'undefined'` guards around hook usage

---

## Server Components: Selective Hydration

### What Changed

Pages are now **server components by default**. Only pages that explicitly declare `"use client"` at the top of the file ship JavaScript to the browser and hydrate on the client.

**Server pages (default — no directive):**
- Rendered to HTML on the server via `renderToReadableStream`
- **Zero JS shipped** — no `<script>` tags, no hydration, pure HTML
- Links work as standard HTML `<a>` tags (full page navigation)
- Ideal for: static content, reports, about pages, terms of service, documentation

**Client pages (`"use client"` directive):**
- Rendered to HTML on the server (SSR for fast first paint)
- Client JS bundle loaded, page hydrates with full interactivity
- SPA-style navigation between client pages (no full reload)
- Navigation from a client page TO a server page triggers a full page request
- Ideal for: dashboards, forms, data tables, interactive UIs

### How to Use

**Server page (default — zero JS):**
```tsx
// app/about/page.tsx
// No "use client" directive — this is a server component.
// It renders to HTML on the server and ships ZERO JS.

export const meta = { title: 'About Us' };

export default function AboutPage() {
  return (
    <div>
      <h1>About Our Platform</h1>
      <p>This page is pure HTML. No JavaScript.</p>
    </div>
  );
}
```

**Client page (interactive — ships JS):**
```tsx
// app/dashboard/page.tsx
"use client"

import { useCollection, useAuth, DataTable } from '../../src/frontend';

export default function DashboardPage() {
  const { user } = useAuth();
  const { data } = useCollection('clients');

  return (
    <div>
      <h1>Welcome, {user?.name}</h1>
      <DataTable data={data} columns={columns} />
    </div>
  );
}
```

### What This Means for Apps

**Most IOP tracker pages should add `"use client"`** — they use hooks (`useCollection`, `useAuth`, etc.) and interactive components. Add this as the very first line of the file:

```tsx
"use client"
```

Pages that are purely informational (no hooks, no event handlers, no state) can omit the directive and benefit from zero JS overhead.

### Files to Copy (New + Updated)

Add to the copy list:
```
src/frontend/router/scanner.ts         → projects/ioptracker/src/frontend/router/scanner.ts (UPDATED — hasUseClientDirective)
src/frontend/server/client-bundle.ts   → projects/ioptracker/src/frontend/server/client-bundle.ts (UPDATED — selective manifest)
src/frontend/router/renderer.ts        → projects/ioptracker/src/frontend/router/renderer.ts (UPDATED — conditional JS injection)
src/frontend/client/hydrate.tsx        → projects/ioptracker/src/frontend/client/hydrate.tsx (UPDATED — selective hydration)
src/frontend/server/router-plugin.ts   → projects/ioptracker/src/frontend/server/router-plugin.ts (UPDATED — middleware + ISR)
src/frontend/router/types.ts           → projects/ioptracker/src/frontend/router/types.ts (UPDATED — RouteConfig, enriched LoaderContext)
src/frontend/server.ts                 → projects/ioptracker/src/frontend/server.ts (UPDATED — RouteConfig export)
src/frontend/index.ts                  → projects/ioptracker/src/frontend/index.ts (UPDATED — RouteConfig type export)
src/frontend/server/app-factory.ts     → projects/ioptracker/src/frontend/server/app-factory.ts (UPDATED — dynamic URL)
```

---

## Route-Level Middleware: Auth Guards, Redirects, ISR

### What Changed

Page and API route modules can now export a `config` object to declare route-level behavior. The router plugin reads this config and applies middleware BEFORE the loader or handler runs.

### RouteConfig Options

```tsx
import type { RouteConfig } from '../../src/frontend/server';

export const config: RouteConfig = {
  // Auth guard — redirect to /login if not authenticated
  auth: 'required',

  // Admin-only — returns 403 if user.role !== 'admin'
  // auth: 'admin',

  // ISR — cache rendered HTML for 60 seconds
  revalidate: 60,

  // Custom middleware — runs before loader/render
  middleware: async (ctx) => {
    // Return a Response to short-circuit (e.g., redirect)
    if (someCondition) {
      return ctx.redirect('/somewhere-else');
    }
    // Return void to continue to loader/render
  },
};
```

### Enriched LoaderContext

Page loaders now receive a richer context:

```tsx
export async function loader(ctx: LoaderContext) {
  // Auth context from Elysia's resolve chain
  const userId = ctx.auth?.userId;
  const role = ctx.auth?.role;

  // Redirect helper
  if (!userId) {
    return ctx.redirect('/login');
  }

  // If loader returns a Response, it short-circuits rendering
  // If loader returns data, it's passed to the page as `data` prop
  return { user: await getUser(userId) };
}
```

### ISR (Incremental Static Regeneration)

Pages with `revalidate` in their config are cached after first render. Subsequent requests within the revalidation window serve the cached HTML instantly.

```tsx
// app/reports/monthly/page.tsx
export const config: RouteConfig = {
  revalidate: 300, // Cache for 5 minutes
};

export default function MonthlyReport({ data }: { data: ReportData }) {
  return <Report data={data} />;
}
```

### Dynamic Platform URL

The `platformConfig.url` is now derived from each request's origin instead of being hardcoded to `http://localhost:PORT`. This means the platform works correctly behind reverse proxies, with HTTPS, and in production deployments.

### App Code Migration

**For protected pages, add a config export:**
```tsx
// app/dashboard/page.tsx
"use client"

import type { RouteConfig } from '../../src/frontend/server';

export const config: RouteConfig = { auth: 'required' };

// ... page component
```

**For admin-only pages:**
```tsx
export const config: RouteConfig = { auth: 'admin' };
```

**For cached/static pages:**
```tsx
export const config: RouteConfig = { revalidate: 3600 }; // 1 hour
```

**For loaders that need auth:**
```tsx
export async function loader(ctx: LoaderContext) {
  if (!ctx.auth) return ctx.redirect('/login');

  const data = await fetchDataForUser(ctx.auth.userId);
  return data;
}
```

---

## Built-in File Storage

### What It Is

A complete file storage layer built into the platform. Drives, files, folders, permissions, presigned URLs, content deduplication, server-side MIME detection, Range request support, ETag caching — all included. No S3 needed.

### Architecture

```
src/storage/
├── types.ts              # All types + STORAGE_TABLES for client sync
├── local-adapter.ts      # Content-addressable blob storage (SHA-256 sharding)
├── mime.ts               # Server-side MIME detection from magic bytes
├── presigned.ts          # HMAC-SHA256 presigned URL tokens
├── storage-service.ts    # Full CRUD + permissions + blob ref counting + dedup
├── storage.plugin.ts     # Elysia plugin — all routes under /storage/*
├── storage-hooks.ts      # 6 React hooks for client-side
├── index.ts              # Barrel exports

src/pages/storage/
├── drive-schema.ts       # Schema for drive fields (MasterDetail form generation)
├── drive-detail-header.tsx  # Drive header with usage bar
├── storage-management-page.tsx  # Admin page: drive list + file browser
├── index.ts              # Barrel exports
```

### Key Features

- **Content-addressable dedup**: Files stored by SHA-256 checksum with 2-level directory sharding (`blobs/aa/bb/aabb...`). Upload the same file twice = one copy on disk.
- **Blob ref counting**: `_storage_blobs` table tracks references. Bytes only deleted when ref_count hits 0.
- **Server-side MIME detection**: Magic byte analysis — never trusts client Content-Type. 50+ file types.
- **Range requests**: `Bun.file().slice()` for zero-copy byte ranges. Video seeking, download resume work out of the box.
- **ETag caching**: SHA-256 checksum as ETag. Returns HTTP 304 when content hasn't changed.
- **Presigned URLs**: HMAC-SHA256 signed tokens for auth-free upload/download links with expiry.
- **Permission system**: Grant by role, user ID, or user property KV pairs. Drive-level or per-file/folder.
- **Upload progress**: XHR-based (fetch API doesn't support upload progress).

### How to Enable

Storage is automatically enabled when auth is enabled. Add `storageDir` to customize the storage location:

```ts
const app = await createApp({
  db: { mode: './data.db' },
  tables: { ...myTables },
  auth: true,
  storageDir: './uploads',  // Default: '.storage'
});
```

### API Routes (all under `/storage`)

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/storage/drives` | Required | Create a drive |
| GET | `/storage/drives` | Optional | List drives (user's accessible) |
| GET | `/storage/drives/:id` | Optional | Get drive info |
| DELETE | `/storage/drives/:id` | Owner/Admin | Delete a drive |
| GET | `/storage/drives/:id/usage` | Read | Drive usage stats |
| POST | `/storage/drives/:id/upload` | Write | Multipart file upload |
| GET | `/storage/drives/:id/files/*` | Read | Stream download (Range + ETag) |
| GET | `/storage/drives/:id/list` | Read | List folder contents |
| POST | `/storage/drives/:id/folders` | Write | Create a folder |
| POST | `/storage/drives/:id/move` | Write | Move/rename file or folder |
| POST | `/storage/drives/:id/copy` | Write | Copy a file |
| DELETE | `/storage/drives/:id/files/*` | Write | Delete file or folder |
| PATCH | `/storage/drives/:id/visibility` | Admin | Set public/private |
| POST | `/storage/drives/:id/permissions` | Admin | Grant a permission |
| DELETE | `/storage/permissions/:id` | Auth | Revoke a permission |
| POST | `/storage/drives/:id/presign` | Read/Write | Create presigned URL |
| GET | `/storage/presigned/:token` | None | Execute presigned download |
| PUT | `/storage/presigned/:token` | None | Execute presigned upload |
| GET | `/storage/drives/:id/info/*` | Read | Get file/folder info |

### React Hooks

```tsx
import {
  useUpload,
  useStorageFolder,
  useStorageDrives,
  useDriveUsage,
  usePresignedUrl,
  useStorageActions,
} from '../src/frontend';
```

**`useUpload()`** — file upload with progress tracking:
```tsx
const { upload, uploading, progress, error, result, reset } = useUpload();

await upload('drv_xxx', file, {
  path: '/docs/report.pdf',
  overwrite: true,
  onProgress: (pct) => console.log(`${pct}%`),
});
```

**`useStorageFolder(driveId, path?)`** — list folder contents:
```tsx
const { items, total, loading, error, refresh } = useStorageFolder('drv_xxx', '/docs');
```

**`useStorageDrives()`** — list accessible drives:
```tsx
const { drives, loading, error, refresh } = useStorageDrives();
```

**`useDriveUsage(driveId)`** — drive usage stats:
```tsx
const { usage, loading } = useDriveUsage('drv_xxx');
// usage.totalBytes, usage.maxBytes, usage.fileCount, usage.percentUsed
```

**`usePresignedUrl()`** — generate presigned URLs:
```tsx
const { getUrl } = usePresignedUrl();
const downloadUrl = await getUrl('drv_xxx', '/path/to/file.pdf');
const uploadUrl = await getUrl('drv_xxx', '/path/to/upload.pdf', 'upload');
```

**`useStorageActions()`** — CRUD operations:
```tsx
const actions = useStorageActions();
await actions.createDrive('My Drive', { maxSize: 1e9, public: true });
await actions.createFolder('drv_xxx', '/docs');
await actions.moveFile('drv_xxx', '/old/path.pdf', '/new/path.pdf');
await actions.copyFile('drv_xxx', '/a.pdf', '/b.pdf');
await actions.deleteFile('drv_xxx', '/path.pdf');
await actions.setVisibility('drv_xxx', true, '/path.pdf');
const url = actions.getFileUrl('drv_xxx', '/path.pdf');
```

### Admin Page

A pre-built storage management page, same pattern as the user management page:

```tsx
import { StorageManagementPage } from '../src/frontend';

// Drop into your admin layout — drives list (MasterDetail) + file browser
export default function AdminStoragePage() {
  return <StorageManagementPage />;
}
```

Features:
- Drive list with MasterDetail layout (create, edit, delete, toggle visibility)
- File browser with folder navigation, breadcrumbs, upload, download
- File detail panel showing size, type, checksum, visibility, actions (rename, delete, download)
- Drive detail header with usage bar (color-coded: green → yellow → red)

### Files to Copy

```
src/storage/types.ts                → (NEW)
src/storage/local-adapter.ts        → (REWRITTEN — content-addressable)
src/storage/mime.ts                 → (NEW)
src/storage/presigned.ts            → (existing, no changes)
src/storage/storage-service.ts      → (REWRITTEN — dedup, blob refs, MIME detect)
src/storage/storage.plugin.ts       → (NEW — Elysia plugin)
src/storage/storage-hooks.ts        → (NEW — React hooks)
src/storage/index.ts                → (NEW — barrel)
src/pages/storage/drive-schema.ts   → (NEW)
src/pages/storage/drive-detail-header.tsx → (NEW)
src/pages/storage/storage-management-page.tsx → (NEW)
src/pages/storage/index.ts          → (NEW)
src/frontend/server/app-factory.ts  → (UPDATED — storage plugin wired)
src/frontend/server/types.ts        → (UPDATED — storageDir config)
src/frontend/server.ts              → (UPDATED — storage exports)
src/frontend/index.ts               → (UPDATED — hooks + admin page exports)
```

---

## Hydration & Auth Session Restoration Fixes

Three bugs that caused broken page loads: client JS failing to parse, stale cache headers silently dropped, and login sessions not surviving page reloads.

### Fix 1: ESM Bootstrap (`renderer.ts`)

**Problem:** `src/frontend/server/client-bundle.ts` builds the client bundle with `format: 'esm'`, but `renderer.ts` used `bootstrapScripts` in `renderToReadableStream`. React's `bootstrapScripts` emits `<script src="...">` (no `type="module"`), which causes the browser to reject ESM `import`/`export` syntax with "Cannot use import statement outside a module". Hydration never runs — SSR defaults persist (stuck spinners, dead buttons).

**Fix:** Changed `bootstrapScripts` to `bootstrapModules` on line 138 of `renderer.ts`. React 19's streaming SSR supports `bootstrapModules`, which emits `<script type="module">` — browsers parse ESM correctly.

```typescript
// OLD
bootstrapScripts: isClientPage && clientEntry ? [clientEntry] : undefined,

// NEW
bootstrapModules: isClientPage && clientEntry ? [clientEntry] : undefined,
```

### Fix 2: `_build` Static Handler (`router-plugin.ts`)

**Problem:** Two issues in the `/_build/*` route:

1. **Path traversal** — `resolve(buildDir, untrustedInput)` could escape the build directory (e.g., `/_build/../../etc/passwd`).
2. **Headers silently dropped** — Elysia does NOT merge `set.headers` into raw `Response` objects. The `Cache-Control: immutable` header was set via `set.headers` but never reached the browser, causing re-fetches of immutable JS chunks on every navigation.

**Fix:** Added `filePath.startsWith(outDir + '/')` path traversal guard. Moved headers from `set.headers` to the `Response` constructor so they're actually sent.

```typescript
.get('/_build/*', async ({ params }) => {
  const outDir = resolve('.build');
  const filePath = resolve(outDir, (params as any)['*']);
  if (!filePath.startsWith(outDir + '/')) {
    return new Response('Forbidden', { status: 403 });
  }
  const file = Bun.file(filePath);
  if (await file.exists()) {
    return new Response(file, {
      headers: {
        'Content-Type': file.type,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  }
  return new Response('Not Found', { status: 404 });
})
```

### Fix 3: Auth Session Restoration (`auth-client.ts`)

**Problem:** On page reload, `AuthClient` found the stored refresh token and called `_doRefresh()`, which only updated tokens via the `auth.refresh` store event — it never fetched the user profile. The `user` field stayed `null`, so `isAuthenticated` was `false` and every protected page redirected to login. Additionally, the constructor didn't set `isLoading: true` before starting the async refresh, so components briefly rendered a "logged out" state before the refresh completed.

**Fix:** Constructor now sends `auth.loading` immediately. Added `restoreSession()` method that: (1) refreshes tokens, (2) calls `GET /auth/me` to load the full user profile, (3) sends `auth.success` with user + tokens. On failure, clears tokens and sends `auth.logout`.

```typescript
constructor(baseUrl: string) {
  // ...
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem(REFRESH_TOKEN_KEY);
    if (stored) {
      this.send('auth.loading', {});
      this.send('auth.refresh', { accessToken: '', refreshToken: stored });
      this.restoreSession().catch(() => {
        localStorage.removeItem(REFRESH_TOKEN_KEY);
        this.send('auth.logout', {});
      });
    }
  }
}

private async restoreSession(): Promise<void> {
  const refreshed = await this.refresh();
  if (!refreshed) { /* logout + clear */ return; }
  const res = await this.fetchWithAuth(`${this.baseUrl}/auth/me`);
  if (!res.ok) { /* logout + clear */ return; }
  const user = await res.json();
  this.send('auth.success', {
    user,
    accessToken: this.ctx.accessToken!,
    refreshToken: this.ctx.refreshToken!,
  });
}
```

### Files to Copy (Updated)

These three files need to be rsynced to replace existing versions:

```
src/frontend/router/renderer.ts        → (UPDATED — bootstrapModules fix)
src/frontend/server/router-plugin.ts   → (UPDATED — _build path traversal + response headers)
src/frontend/client/auth-client.ts     → (UPDATED — session restoration on page reload)
```

No new dependencies, no API changes, no consumer migration steps. Just copy the files.

---

## Database Migration System & WAL Safety

### Problem

Three related issues:

1. **No standalone migration runner** — schema only applied when the full server booted. If the server didn't start (crash, misconfigured env), migrations never ran.
2. **No migration versioning** — `CREATE TABLE IF NOT EXISTS` can't handle `ALTER TABLE`, column additions, or index changes. Every schema change required manual SQL and hoping the server restarted cleanly.
3. **WAL not flushed on exit** — `ReactiveDB.dispose()` relied on `db.close()` for implicit WAL checkpoint. If the process was killed (SIGINT, SIGTERM, OOM, container stop) before `onStop` hooks fired, WAL pages could remain unflushed. Data appeared lost until the next startup (SQLite recovers WAL on open), but if the WAL file was deleted or corrupted, data was gone.

### What Was Built

#### Migration System (`src/migrations/`)

```
src/migrations/
├── migrator.ts                      # Core Migrator class — standalone, no Elysia needed
├── index.ts                         # Ordered migration registry
├── run.ts                           # CLI runner
└── definitions/
    └── 001_initial_schema.ts        # Baseline: all current tables (auth, notifications,
                                     #   workflows, rooms, storage)
```

**Key properties:**
- **Standalone** — `Migrator` only needs `bun:sqlite` and a file path. No Elysia, no plugins, no server.
- **Atomic per-migration** — each migration runs in its own SQLite transaction. Failure rolls back that single migration; previously applied migrations remain.
- **Version tracking** — `_migrations` table records: version, description, applied_at, checksum, duration_ms.
- **Checksum detection** — if a migration's source code changes after being applied, the checksum mismatch is detectable.
- **Explicit WAL checkpoint** — `PRAGMA wal_checkpoint(TRUNCATE)` runs after every migration batch completes, flushing all WAL pages to the main database file.
- **Idempotent baseline** — migration 001 uses `CREATE TABLE IF NOT EXISTS` throughout, so existing databases get the `_migrations` table without breaking anything.

#### CLI Usage

```bash
# Apply all pending migrations
bun run src/migrations/run.ts

# Show what's applied and what's pending
bun run src/migrations/run.ts --status

# Apply up to a specific version only
bun run src/migrations/run.ts --to 003

# Force WAL checkpoint without running migrations
bun run src/migrations/run.ts --checkpoint

# Use a custom database path
bun run src/migrations/run.ts --db ./data/myapp.db

# Default database path: DATABASE_PATH env var, or ./data/platform.db
```

**Recommended deployment pattern:**
```bash
# In Dockerfile entrypoint or CI pipeline — BEFORE server starts
bun run src/migrations/run.ts
bun run src/server.ts
```

#### Adding New Migrations

1. Create a file in `src/migrations/definitions/`:

```typescript
// src/migrations/definitions/002_add_user_phone.ts
import type { Database } from 'bun:sqlite';
import type { Migration } from '../migrator';

export const migration: Migration = {
  version: '002',
  description: 'Add phone column to users table',
  up(db: Database) {
    db.run('ALTER TABLE users ADD COLUMN phone TEXT');
    db.run('CREATE INDEX IF NOT EXISTS idx_user_phone ON users(phone)');
  },
  down(db: Database) {
    // SQLite doesn't support DROP COLUMN before 3.35.0
    // For older versions, this would need table recreation
    db.run('DROP INDEX IF EXISTS idx_user_phone');
  },
};
```

2. Register it in `src/migrations/index.ts`:

```typescript
import { migration as m001 } from './definitions/001_initial_schema';
import { migration as m002 } from './definitions/002_add_user_phone';

export const migrations: Migration[] = [m001, m002];
```

**Rules:**
- Version strings sort lexicographically — use zero-padded numbers (`001`, `002`, `010`)
- Migrations MUST be appended, never reordered or removed
- Each migration's `up()` receives the raw `bun:sqlite` `Database` handle — full SQL access
- `down()` is optional (SQLite DDL is often irreversible anyway)

### WAL Safety Fixes

#### 1. Explicit checkpoint in `ReactiveDB.dispose()` (`src/sync/reactive-db.ts`)

Before:
```typescript
dispose(): void {
  // ...finalize statements...
  this.db.close(); // implicit checkpoint — maybe
}
```

After:
```typescript
dispose(): void {
  // ...finalize statements...
  try {
    this.db.run('PRAGMA wal_checkpoint(TRUNCATE)');
  } catch {
    // Best effort — database may already be in an error state
  }
  this.db.close();
}
```

`TRUNCATE` mode writes all WAL pages to the main database file AND truncates the WAL file to zero bytes. This is stronger than the implicit checkpoint in `close()`, which only does a `PASSIVE` checkpoint (skips busy pages).

#### 2. Process-level graceful shutdown (`src/frontend/server/app-factory.ts`)

Added `SIGINT`/`SIGTERM` handlers that call `app.stop()` before `process.exit()`:

```typescript
let shuttingDown = false;
const gracefulShutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[app] ${signal} received — shutting down...`);
  await app.stop();  // Triggers onStop hooks → ReactiveDB.dispose() → WAL checkpoint
  process.exit(0);
};
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
```

Without this, Ctrl+C or Docker `SIGTERM` could kill the process before Elysia's `onStop` hooks ran, meaning `ReactiveDB.dispose()` never executed and WAL data was only recovered on next startup.

#### 3. Auto-migrate on server start (`src/frontend/server/app-factory.ts`)

Migrations run automatically when `createApp()` is called with a file-backed database:

```typescript
if (config.db.mode !== 'memory' && config.migrate) {
  const migrator = new Migrator({ dbPath: config.db.mode, migrations });
  try {
    migrator.run();   // Applies pending migrations
  } finally {
    migrator.dispose(); // WAL checkpoint + close
  }
}
```

- Skipped for `:memory:` databases (they start fresh every time)
- Disable with `migrate: false` in `AppConfig` if running migrations separately via CLI
- The migrator opens its own database connection, runs migrations, checkpoints, and closes — before ReactiveDB opens its connection

#### 4. `migrate` config option (`src/frontend/server/types.ts`)

```typescript
interface AppConfig {
  // ...existing options...

  /**
   * Run database migrations on startup. Default: true for file-backed DBs.
   * Set to false to skip migrations (e.g., if running migrations via CLI separately).
   */
  migrate?: boolean;
}
```

### Files to Copy

```
src/migrations/migrator.ts                    → (NEW — standalone migration runner)
src/migrations/index.ts                       → (NEW — migration registry)
src/migrations/run.ts                         → (NEW — CLI entrypoint)
src/migrations/definitions/001_initial_schema.ts → (NEW — baseline migration)
src/sync/reactive-db.ts                       → (UPDATED — explicit WAL checkpoint in dispose)
src/sync/sync.plugin.ts                       → (UPDATED — log message update)
src/frontend/server/app-factory.ts            → (UPDATED — auto-migrate + graceful shutdown)
src/frontend/server/types.ts                  → (UPDATED — migrate config option)
```

### What This Means for Apps

- **Existing databases:** Run `bun run src/migrations/run.ts` once. Migration 001 is all `IF NOT EXISTS` — safe on existing data. Creates the `_migrations` table to track future migrations.
- **New databases:** Migrations create the full schema automatically. No need to start the server first.
- **Server startup:** Migrations run before plugins load (if `migrate: true`, the default). Schema is guaranteed to be up-to-date before any `defineTable()` calls.
- **Shutdown:** Ctrl+C, `kill`, Docker stop — all trigger `app.stop()` → WAL checkpoint. Data is flushed to the main DB file.
- **Crash recovery:** If the process is killed without clean shutdown (kill -9, OOM), SQLite automatically replays the WAL on next open. The migrator's `TRUNCATE` checkpoint minimizes how much WAL data accumulates between checkpoints.

---

## Visual Upgrades: Animate-UI Icons Across UI Components

### What Changed

Replaced Lucide React icons with the platform's built-in animate-ui icon library across all auth forms, data infrastructure, and admin pages. Icons now animate on interaction (hover, click, state change) instead of being static SVGs.

### Error Banner Pattern

All auth forms now share a consistent error display pattern:

```tsx
<AnimatePresence>
  {error && (
    <motion.div
      initial={{ opacity: 0, height: 0, y: -4 }}
      animate={{ opacity: 1, height: 'auto', y: 0, x: [0, -6, 6, -4, 4, 0] }}
      exit={{ opacity: 0, height: 0, y: -4 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="overflow-hidden"
    >
      <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5" role="alert">
        <AnimateIcon animate>
          <CircleX size={16} className="mt-px flex-shrink-0 text-destructive" />
        </AnimateIcon>
        <p className="text-xs font-medium leading-relaxed text-destructive">{error}</p>
      </div>
    </motion.div>
  )}
</AnimatePresence>
```

Features: slide-in animation, horizontal shake, animated X icon, destructive-themed border/background, input fields highlight red on error.

### Files Updated

**Auth forms:**
- `src/components/auth/login-form.tsx` — CircleX error icon, Loader spinner, error banner, input highlighting
- `src/components/auth/register-form.tsx` — same pattern
- `src/components/auth/forgot-password-form.tsx` — CircleCheck success icon (replaces hand-rolled SVG), Send icon on button, error banner
- `src/components/auth/otp-verification.tsx` — Loader spinner, error banner

**Forms infrastructure:**
- `src/components/forms/wizard.tsx` — Check icon (animated on step complete), ChevronRight (hover-animated), Loader spinner
- `src/components/forms/auto-form.tsx` — Loader spinner

**Notifications:**
- `src/components/ui/notification-center.tsx` — Bell icon (animates on hover)
- `src/components/ui/notification-dropdown.tsx` — Settings icon (animates on hover)

**Data table:**
- `src/components/data-table/data-table-toolbar.tsx` — Search icon, Download icon (hover-animated)
- `src/components/data-table/editable-cell.tsx` — removed unused Lucide Check/X imports

**Admin pages:**
- `src/pages/storage/storage-management-page.tsx` — Trash, Eye/EyeOff, Plus, Upload, Download, ArrowLeft (all animate-ui)
- `src/pages/users/user-management-page.tsx` — Trash icon (hover-animated)

**Cleanup:**
- `src/components/ui/validation-rules.tsx` — removed unused CircleCheck Lucide import

### No Migration Steps Required

All changes are internal — same component props, same exports. Drop-in file replacements.

---

## Missing `'use client'` Directives — Bulk Fix

### Problem

14 files used React hooks (useState, useEffect, useRef, useCallback, useMemo, useSyncExternalStore, useContext) but didn't have the `'use client'` directive. In the platform's selective hydration architecture, any component using hooks MUST declare `'use client'` at the top — without it, the renderer treats it as a server component and strips the JS bundle, breaking interactivity.

### Files Fixed

**Components (5 files):**
```
src/components/forms/auto-form.tsx
src/components/data-table/editable-cell.tsx
src/components/data-table/data-table-toolbar.tsx
src/components/data-table/animated-cell.tsx
src/components/data-table/data-table.tsx
```

**Client SDK (5 files):**
```
src/frontend/client/app-provider.tsx
src/frontend/client/hydrate.tsx
src/frontend/client/link.tsx
src/frontend/client/notification-provider.tsx
src/frontend/client/router-context.tsx
```

**Hooks & Utilities (4 files):**
```
src/hooks/use-controlled-state.tsx
src/hooks/use-is-in-view.tsx
src/hooks/use-motion-value-state.tsx
src/lib/get-strict-context.tsx
```

### Fix Applied

Added `'use client';` as line 1 of each file. No other changes.

### `useSyncExternalStore` Performance Fix

`src/frontend/client/room-hooks.ts` — the `usePresence()` hook's `getSnapshot` callback returned a new array on every call. Since `useSyncExternalStore` compares snapshots by reference (`Object.is`), this caused re-renders on every check cycle.

**Fix:** Added `prevSnapshotRef` to cache the previous result. `getSnapshot` now compares `userId`, `status`, and `lastSeen` fields before returning a new array — only allocates when data actually changed. Server-side snapshot also stabilized with `useMemo(() => [], [])`.

### Files to Copy

```
src/components/forms/auto-form.tsx               → (UPDATED — 'use client')
src/components/data-table/editable-cell.tsx       → (UPDATED — 'use client')
src/components/data-table/data-table-toolbar.tsx  → (UPDATED — 'use client')
src/components/data-table/animated-cell.tsx       → (UPDATED — 'use client')
src/components/data-table/data-table.tsx          → (UPDATED — 'use client')
src/frontend/client/app-provider.tsx              → (UPDATED — 'use client')
src/frontend/client/hydrate.tsx                   → (UPDATED — 'use client')
src/frontend/client/link.tsx                      → (UPDATED — 'use client')
src/frontend/client/notification-provider.tsx     → (UPDATED — 'use client')
src/frontend/client/router-context.tsx            → (UPDATED — 'use client')
src/hooks/use-controlled-state.tsx                → (UPDATED — 'use client')
src/hooks/use-is-in-view.tsx                      → (UPDATED — 'use client')
src/hooks/use-motion-value-state.tsx              → (UPDATED — 'use client')
src/lib/get-strict-context.tsx                    → (UPDATED — 'use client')
src/frontend/client/room-hooks.ts                 → (UPDATED — useSyncExternalStore perf fix)
```

No new dependencies, no API changes. Drop-in replacements.

---

## Platform Auto-Registration: Tables, Error Boundary, Internal Abstraction Leak Fix

### Problem

The platform exported high-level hooks (`useNotifications`, `useRoom`, `useWorkflow`) but forced app developers to understand and manually wire low-level internals — specifically, importing and spreading `*_TABLES` constants into `createClient()`. If an app forgot to spread `ROOM_TABLES`, `useRoom()` crashed with `Error: Unknown table: rooms`. Workflows were worse — `WORKFLOW_TABLES` didn't even exist as an export, so `useWorkflow()` was completely broken.

This is the "abstraction leak" pattern: the platform provides high-level APIs but forces developers to manage low-level details.

### What Was Fixed

#### 1. Auto-register ALL platform tables in `createClient()` (`src/frontend/client/sdk.ts`)

All platform-internal tables are now automatically merged into every client. Apps only need to pass their own app-specific tables.

```typescript
const PLATFORM_TABLES: Record<string, ClientTableDef> = {
  ...NOTIFICATION_TABLES,  // notifications, notification_receipts
  ...ROOM_TABLES,          // rooms, room_members
  ...WORKFLOW_TABLES,      // workflow_instances, workflow_steps, workflow_events
  ...STORAGE_TABLES,       // storage_drives, storage_objects
};

// In createClient():
const tables = {
  ...PLATFORM_TABLES,                              // platform tables always present
  ...(schemaObj?.clientTables ?? rawTables ?? {}),  // app tables spread last (can override)
};
```

**Before (app developer had to do this):**
```tsx
import { NOTIFICATION_TABLES } from '../src/notifications/types';
import { ROOM_TABLES } from '../src/rooms/types';
// WORKFLOW_TABLES didn't even exist!

<AppProvider tables={{ ...NOTIFICATION_TABLES, ...ROOM_TABLES, ...myTables }} />
```

**After (just pass your own tables):**
```tsx
<AppProvider tables={myTables} />
```

#### 2. Created `WORKFLOW_TABLES` export (`src/workflows/types.ts`)

Workflow tables had no client-side table definitions — `useWorkflow()` was completely broken. Added all 4 workflow tables:

- `workflow_definitions` — definition_id PK, name, version, steps_json, input_schema, timestamps
- `workflow_instances` — instance_id PK, all columns matching plugin schema
- `workflow_steps` — step_id PK, all columns matching plugin schema
- `workflow_events` — event_id PK, all columns matching plugin schema

Also exported `WORKFLOW_TABLES` from barrel files for consistency:
- `src/workflows/index.ts` — added `export { WORKFLOW_TABLES } from './types'`
- `src/frontend/server.ts` — added `export { WORKFLOW_TABLES } from '../workflows'`

#### 3. Improved error boundary (`src/frontend/client/error-boundary.tsx`)

- Card widened from 36rem → 48rem for better readability
- Error name displayed in **red monospace** (e.g. `TypeError`, `Error`)
- Error message displayed in **amber/yellow** — clearly distinct from the name
- Both wrapped in a dark panel with subtle border
- Stack trace: lighter color, smaller font, taller max-height (24rem), first line stripped (already shown above)
- Server-side HTML error page updated to match the same color coding and width

### Files to Copy

```
src/frontend/client/sdk.ts             → (UPDATED — auto-register all platform tables)
src/frontend/client/error-boundary.tsx  → (UPDATED — wider card, color-coded errors)
src/workflows/types.ts                  → (UPDATED — added WORKFLOW_TABLES with all 4 tables)
src/workflows/index.ts                  → (UPDATED — barrel export for WORKFLOW_TABLES)
src/frontend/server.ts                  → (UPDATED — export WORKFLOW_TABLES)
```

### What Apps Should Remove

After copying, apps can **delete** any manual `*_TABLES` spreading in their layout/provider:

```diff
- import { NOTIFICATION_TABLES } from '../src/notifications/types';
- import { ROOM_TABLES } from '../src/rooms/types';
- import { STORAGE_TABLES } from '../src/storage/types';

  <AppProvider
    url="..."
-   tables={{ ...NOTIFICATION_TABLES, ...ROOM_TABLES, ...STORAGE_TABLES, ...myTables }}
+   tables={myTables}
  />
```

### Impact

| Feature | Before | After |
|---------|--------|-------|
| Notifications | Crashed unless app spread NOTIFICATION_TABLES | Auto-registered |
| Rooms | Crashed unless app spread ROOM_TABLES | Auto-registered |
| Workflows | Broken — no WORKFLOW_TABLES export existed | Auto-registered (all 4 tables) |
| Storage | Required manual STORAGE_TABLES spread | Auto-registered |
| Error boundary | Narrow, monochrome error text | Wide, color-coded (red name, amber message) |

No new dependencies, no API changes beyond auto-registration. All imports are client-safe (`import type` only).

### Full Audit Results

A comprehensive audit was run to verify no other abstraction leaks remain:

| Check | Result |
|-------|--------|
| All `useCollection`/`useRow`/`useQuery` table names covered by PLATFORM_TABLES | Pass |
| `hydrate.tsx` works with auto-merge (empty tables default is safe) | Pass |
| No `bun:sqlite` or `node:*` imports in client code | Pass |
| All platform plugins auto-mounted by `createApp()` | Pass |
| `usePresence()` uses ephemeral (no table registration needed) | Pass |
| `NotificationProvider` requires no manual setup | Pass |
| All `*_TABLES` exports consistent across barrels (`index.ts`, `frontend/server.ts`) | Pass |
| `workflow_definitions` included for reactive workflow picker UI | Pass |

---

## Modal Manager (NEW)

### Overview

A Mantine-inspired modal manager has been added to the platform. It provides a centralized, event-driven API for opening/closing modals from anywhere in the app — no prop drilling, no local Dialog state, no direct Dialog imports needed.

### New Files to Copy

```
src/modals/modal.types.ts      → projects/ioptracker/src/modals/modal.types.ts      (NEW)
src/modals/modal-store.ts      → projects/ioptracker/src/modals/modal-store.ts      (NEW)
src/modals/modal-events.ts     → projects/ioptracker/src/modals/modal-events.ts     (NEW)
src/modals/hold-button.tsx     → projects/ioptracker/src/modals/hold-button.tsx     (NEW)
src/modals/confirm-modal.tsx   → projects/ioptracker/src/modals/confirm-modal.tsx   (NEW)
src/modals/modal-manager.tsx   → projects/ioptracker/src/modals/modal-manager.tsx   (NEW)
src/modals/index.ts            → projects/ioptracker/src/modals/index.ts            (NEW)
```

### Updated Files to Copy

```
src/frontend/index.ts               → (already in list — now exports modal manager)
src/frontend/client/app-provider.tsx → (already in list — now wraps children in ModalManager)
```

### SDK Changes

Three things changed at the platform SDK level:

#### 1. `AppProvider` now includes `ModalManager` automatically

`ModalManager` was added as the innermost provider in the composition chain. Apps that use `<AppProvider>` get the modal portal for free — no wrapping, no setup.

```
ErrorBoundary > Router > Client > Sync > ModalManager > children
```

**Before:** Apps had to import Dialog components, manage open/close state, and render dialogs inline in every page.

**After:** `modals.open()` / `modals.confirm()` work anywhere — even outside React components — because `ModalManager` renders the portal at the provider level.

#### 2. New exports from `src/frontend/index.ts`

| Export | Type | Description |
|--------|------|-------------|
| `ModalManager` | Component | Portal renderer — already in AppProvider, only needed for custom setups |
| `modals` | Object | Event API: `open()`, `confirm()`, `close()`, `closeLast()`, `closeAll()`, `update()` |
| `HoldButton` | Component | Standalone hold-to-confirm button with progress fill |
| `ModalManagerProps` | Type | Props for ModalManager |
| `ModalSize` | Type | `'xs' \| 'sm' \| 'md' \| 'lg' \| 'xl' \| 'full'` |
| `ModalType` | Type | `'content' \| 'confirm' \| 'context'` |
| `ModalOverflow` | Type | `'auto' \| 'scroll' \| 'hidden' \| 'visible'` |
| `ModalCustomSize` | Type | `{ width?, maxWidth?, height?, maxHeight?, overflow? }` |
| `ModalInstance` | Type | Full modal instance shape |
| `ConfirmModalOptions` | Type | Options for `modals.confirm()` |
| `OpenModalOptions` | Type | Options for `modals.open()` |
| `OpenConfirmOptions` | Type | Options for `modals.confirm()` |
| `HoldButtonProps` | Type | Props for HoldButton |

#### 3. `useConfirm` / `ConfirmProvider` — deprecated

The existing `useConfirm` hook and `ConfirmProvider` still work but are **superseded** by `modals.confirm()`. Key differences:

| | `useConfirm()` (old) | `modals.confirm()` (new) |
|---|---|---|
| Requires provider? | Yes — `<ConfirmProvider>` | No — uses `ModalManager` in `AppProvider` |
| Works outside React? | No — hook only | Yes — plain function call |
| Hold-to-confirm? | No | Yes — `holdToConfirm: true` |
| Custom content? | No — title/description only | Yes — `modals.open()` for arbitrary content |
| Stacking? | No — one at a time | Yes — multiple modals |
| Animation? | AlertDialog flip | Dialog flip (same primitive) |

**Migration:** Replace `useConfirm()` calls with `modals.confirm()`:

```tsx
// OLD
const confirm = useConfirm();
const ok = await confirm({ title: 'Sure?', variant: 'destructive' });

// NEW
import { modals } from '@platform/frontend';
const ok = await modals.confirm({ title: 'Sure?', variant: 'destructive' });
```

Apps can remove `<ConfirmProvider>` from their layout once all `useConfirm()` calls are migrated. The exports remain in the barrel for backwards compatibility.

### Features

- **Size presets**: `xs` (20rem), `sm` (24rem), `md` (32rem, default), `lg` (40rem), `xl` (48rem), `full`
- **Custom sizing**: Override width, maxWidth, height, maxHeight, overflow
- **All sizes use `w-[min(size,calc(100vw-2rem))]`** — no more `w-full max-w-lg` breakage
- **Hold-to-delete button**: `requestAnimationFrame`-based progress fill, configurable duration
- **Confirm dialog**: Promise-based, supports `holdToConfirm: true` for destructive actions
- **Stacked modals**: Multiple modals can be open simultaneously
- **Animated**: Uses existing `motion`-based dialog primitives (flip animation)
- **Event-driven API**: `modals.open()`, `modals.confirm()`, `modals.close()` — works outside React
- **@xstate/store** state management (already a dependency)
- **Auto-integrated**: `ModalManager` is now part of `AppProvider` — no setup needed

### API Reference

```tsx
import { modals } from '@platform/frontend';

// ── Content modal ──────────────────────────────────────────────
const id = modals.open({
  title: 'Edit User',
  size: 'lg',                       // xs | sm | md (default) | lg | xl | full
  from: 'top',                      // flip animation direction: top | bottom | left | right
  showCloseButton: true,            // default: true
  closeOnClickOutside: true,        // default: true
  closeOnEscape: true,              // default: true
  className: 'custom-class',        // extra CSS class on content
  onClose: () => console.log('closed'),
  content: <UserEditForm userId={123} />,
});

// Close by ID
modals.close(id);

// Close the topmost modal
modals.closeLast();

// Update an open modal's props
modals.update(id, { title: 'Updated Title' });

// ── Confirm dialog (promise-based) ─────────────────────────────
const confirmed = await modals.confirm({
  title: 'Delete client?',
  description: 'This action cannot be undone.',
  variant: 'destructive',           // default | destructive
  confirmLabel: 'Delete',           // default: 'Confirm'
  cancelLabel: 'Keep',              // default: 'Cancel'
  holdToConfirm: true,              // enables hold-to-delete button
  holdDuration: 1500,               // ms, default: 1500
  size: 'sm',                       // default: 'sm'
});
if (confirmed) deleteClient(clientId);

// ── Custom sizing ──────────────────────────────────────────────
modals.open({
  content: <LargeTable />,
  customSize: {
    width: '90vw',                  // overrides size preset
    maxWidth: '1200px',
    height: '600px',
    maxHeight: '80vh',              // default: 'calc(100vh - 2rem)'
    overflow: 'scroll',             // auto | scroll | hidden | visible
  },
});

// ── Close all ──────────────────────────────────────────────────
modals.closeAll();
```

### Standalone HoldButton

The `HoldButton` is also exported individually for use outside the modal manager:

```tsx
import { HoldButton } from '@platform/frontend';

<HoldButton
  onConfirm={handleDelete}
  holdDuration={2000}
  label="Hold to Remove"
  holdingLabel="Removing..."
  icon={<Trash2 className="size-4" />}  // default: Trash2
  fillClass="bg-destructive"             // default
  textClass="text-destructive"           // before 40% fill
  textFilledClass="text-destructive-foreground"  // after 40% fill
/>
```

### Also Fixed

- **AlertDialog**: `w-full max-w-lg` → `w-[min(32rem,calc(100vw-2rem))]` (same fix as Dialog)
- **Sheet**: Added `text-foreground` to content for dark theme text inheritance

---

## Migrating All Dialog Usage to Modal Manager

### Pattern 1: Create/Edit Form Dialog → `modals.open()`

This is the most common pattern. 5 files in the IOP tracker use Dialog to show a form with header + fields + footer buttons.

**Before (example from `app/admin/users/page.tsx`):**
```tsx
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/animate-ui/components/radix/dialog';

// State:
const [dialogOpen, setDialogOpen] = useState(false);
const [form, setForm] = useState({ username: '', email: '', password: '' });

// Open:
<Button onClick={() => setDialogOpen(true)}>Create User</Button>

// JSX — somewhere in the return:
<Dialog open={dialogOpen} onOpenChange={(next) => { if (!next) close(); }}>
  <DialogContent>
    <DialogHeader><DialogTitle>Create New User</DialogTitle></DialogHeader>
    <form onSubmit={submit} className="space-y-4">
      {/* fields */}
      <DialogFooter>
        <Button variant="outline" onClick={close}>Cancel</Button>
        <Button type="submit">Create</Button>
      </DialogFooter>
    </form>
  </DialogContent>
</Dialog>
```

**After:**
```tsx
import { modals } from '@platform/frontend';

// No dialogOpen state needed. Extract form into its own component:
function CreateUserForm({ onSuccess }: { onSuccess: () => void }) {
  const [form, setForm] = useState({ username: '', email: '', password: '' });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await createUser(form);
    onSuccess();
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      {/* same fields */}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={() => modals.closeLast()}>Cancel</Button>
        <Button type="submit">Create</Button>
      </div>
    </form>
  );
}

// Open:
function handleCreateUser() {
  const id = modals.open({
    title: 'Create New User',
    content: <CreateUserForm onSuccess={() => modals.close(id)} />,
  });
}

// Trigger:
<Button onClick={handleCreateUser}>Create User</Button>

// No Dialog JSX in the page return — it renders via ModalManager
```

**What to remove:**
- `useState` for `dialogOpen` / `setDialogOpen`
- All Dialog/DialogContent/DialogHeader/DialogTitle/DialogFooter imports (if no other usage)
- The `<Dialog>...</Dialog>` JSX block

### Pattern 2: Hold-to-Delete Confirmation → `modals.confirm({ holdToConfirm: true })`

Used in 3 files. Each has `deleteOpen`/`setDeleteOpen` state + `<DeleteConfirmDialog>` JSX.

**Before (example from `app/clients/page.tsx`):**
```tsx
import { DeleteConfirmDialog } from '@app/components/hold-to-delete';

const [deleteOpen, setDeleteOpen] = useState(false);
const [deleteTarget, setDeleteTarget] = useState<ClientRow | null>(null);

function triggerDelete(client: ClientRow) {
  setDeleteTarget(client);
  setDeleteOpen(true);
}

function handleDeleteConfirm() {
  if (deleteTarget) deleteRow('clients', deleteTarget.id);
  setDeleteTarget(null);
}

// JSX:
<DeleteConfirmDialog
  open={deleteOpen}
  onOpenChange={(open) => { setDeleteOpen(open); if (!open) setDeleteTarget(null); }}
  onConfirm={handleDeleteConfirm}
  title="Delete Client"
  description="This will permanently delete this client..."
/>
```

**After:**
```tsx
import { modals } from '@platform/frontend';

async function triggerDelete(client: ClientRow) {
  const confirmed = await modals.confirm({
    title: 'Delete Client',
    description: `This will permanently delete ${client.first_name} ${client.last_name}...`,
    variant: 'destructive',
    holdToConfirm: true,
  });
  if (confirmed) deleteRow('clients', client.id);
}

// No state, no JSX block, no DeleteConfirmDialog import
```

**What to remove:**
- `useState` for `deleteOpen`, `deleteTarget`
- `handleDeleteConfirm` function
- `DeleteConfirmDialog` import
- The `<DeleteConfirmDialog>` JSX block

### Pattern 3: Simple Confirm → `modals.confirm()`

For non-destructive confirmations (no hold button needed).

```tsx
const confirmed = await modals.confirm({
  title: 'End Session?',
  description: 'This will finalize attendance records.',
  confirmLabel: 'End Session',
});
if (confirmed) endSession();
```

### File-by-File Migration Checklist

#### `app/admin/users/page.tsx`
- [ ] Extract create-user form into `CreateUserForm` component (or inline via `modals.open()`)
- [ ] Replace `dialogOpen` state + `<Dialog>` block with `modals.open()` call
- [ ] Remove Dialog imports
- [ ] Remove `dialogOpen`/`setDialogOpen` state

#### `app/clients/page.tsx`
- [ ] Extract create-client form into component or inline
- [ ] Replace `createOpen` state + `<Dialog>` block with `modals.open()` call
- [ ] Replace `deleteOpen`/`deleteTarget` state + `<DeleteConfirmDialog>` with `modals.confirm({ holdToConfirm: true })`
- [ ] Remove Dialog imports and `DeleteConfirmDialog` import
- [ ] Remove `createOpen`, `deleteOpen`, `deleteTarget` state

#### `app/clients/insurance-reviews.tsx`
- [ ] Replace `dialogOpen` state + `<Dialog>` block with `modals.open()` call for add-review form
- [ ] Remove Dialog imports
- [ ] Remove `dialogOpen` state

#### `app/groups/page.tsx`
- [ ] Extract create-group form into component or inline
- [ ] Replace `createOpen` state + `<Dialog>` block with `modals.open()` call
- [ ] Replace `deleteTarget` state + `<DeleteConfirmDialog>` with `modals.confirm({ holdToConfirm: true })`
- [ ] Remove Dialog imports and `DeleteConfirmDialog` import
- [ ] Remove `createOpen`, `deleteTarget` state

#### `app/groups/group-sessions.tsx`
- [ ] Replace `dialogOpen` state + `<Dialog>` block with `modals.open()` call for start-session form
- [ ] Remove Dialog imports
- [ ] Remove `dialogOpen`, `chapterNumber`, `sessionTitle` state (move into form component)

#### `app/programs/page.tsx`
- [ ] Extract create-program form into component or inline
- [ ] Replace `createOpen` state + `<Dialog>` block with `modals.open()` call
- [ ] Replace `deleteTarget` state + `<DeleteConfirmDialog>` with `modals.confirm({ holdToConfirm: true })`
- [ ] Remove Dialog imports and `DeleteConfirmDialog` import
- [ ] Remove `createOpen`, `deleteTarget` state

#### `app/components/hold-to-delete.tsx`
- [ ] **DELETE THIS FILE** — functionality replaced by `modals.confirm({ holdToConfirm: true })` and platform's `HoldButton` component

### Summary of State Eliminated

After migration, these `useState` declarations are removed from the IOP tracker:

| File | State Removed |
|------|--------------|
| `admin/users/page.tsx` | `dialogOpen` |
| `clients/page.tsx` | `createOpen`, `deleteOpen`, `deleteTarget` |
| `clients/insurance-reviews.tsx` | `dialogOpen` |
| `groups/page.tsx` | `createOpen`, `deleteTarget` |
| `groups/group-sessions.tsx` | `dialogOpen` |
| `programs/page.tsx` | `createOpen`, `deleteTarget` |

**Total: 10 useState calls eliminated, 6 Dialog JSX blocks removed, 3 DeleteConfirmDialog JSX blocks removed, 1 file deleted.**

---

## Dark Theme Contrast Fixes (22 component files)

### Problem

Multiple UI components had insufficient contrast in dark mode. Root causes:

1. **Stacked opacity** — `text-muted-foreground` (55% opacity) combined with additional `/40` modifiers produced effective opacity as low as 22%. Text was barely visible.
2. **`dark:bg-input/30`** — input backgrounds at 30% of an already dim token rendered at ~4.5% effective opacity. Invisible against dark backgrounds.
3. **`border-border`** — default border token at 6% opacity produced invisible dividers.
4. **`bg-muted` fallbacks** — avatar fallback and secondary buttons used `bg-muted` which matched the page background, making them invisible.
5. **`w-full max-w-lg` on fixed elements** — dialog/alert-dialog width constraint broken because `max-width` doesn't constrain `width: 100%` on `position: fixed` elements (they size relative to the viewport, not a parent).

### Design Token Approach

Rather than per-component `dark:` overrides, the IOP tracker's `globals.css` was updated to raise the baseline contrast of shared tokens:

| Token | Old Value | New Value | Reason |
|-------|-----------|-----------|--------|
| `--color-border` | `oklch(... / 6%)` | `oklch(... / 12%)` | Invisible dividers |
| `--color-border-strong` | `oklch(... / 10%)` | `oklch(... / 18%)` | Used by buttons, inputs |
| `--color-foreground` | `oklch(... / 92%)` | `oklch(... / 95%)` | Low heading contrast |
| `--color-muted-foreground` | `oklch(... / 55%)` | `oklch(... / 65%)` | Subtext hard to read |
| `--color-secondary` | `#181828` | `#1e1e30` | Invisible on bg |
| `--color-muted` | `#181828` | `#1e1e30` | Same issue |
| `--color-input` | `oklch(... / 10%)` | `oklch(... / 15%)` | Input fields invisible |
| `--color-popover` | `#12121e` | `#14142a` | Too close to bg |

Added `@layer base` rule to `globals.css` so `<body>` inherits `color: var(--color-foreground)` and `background-color: var(--color-background)`. Without this, text defaults to black (browser default) instead of the theme foreground.

### Component-Level Fixes

These changes are in **platform source** (`src/`) — apps get them by copying the updated files.

#### UI Components (`src/components/ui/`)

| File | Change |
|------|--------|
| `button.tsx` | Secondary: added `border border-border-strong`. Outline dark: `dark:bg-input/30` → `dark:bg-input/50`, `dark:border-input` → `dark:border-border-strong` |
| `input.tsx` | `dark:bg-input/30` → `dark:bg-input/50` |
| `textarea.tsx` | `dark:bg-input/30` → `dark:bg-input/50` |
| `avatar.tsx` | Fallback: `bg-muted` → `bg-secondary text-secondary-foreground font-medium` |
| `separator.tsx` | `bg-border` → `bg-border-strong` |
| `scroll-area.tsx` | Thumb: `bg-border` → `bg-border-strong` |
| `table.tsx` | Head: `text-muted-foreground` → `text-foreground/70` |
| `select.tsx` | Chevron: `opacity-50` → `opacity-70` |
| `calendar.tsx` | Nav: `opacity-50` → `opacity-70`. Today: `bg-accent` → `bg-primary/15 text-primary font-medium`. Outside: `opacity-50` → `opacity-60`. Disabled: `opacity-50` → `opacity-60` |

#### Animate-UI Buttons (`src/components/animate-ui/components/buttons/`)

| File | Change |
|------|--------|
| `button.tsx` | `dark:bg-input/30 dark:border-input` → `dark:bg-input/50 dark:border-border-strong dark:hover:bg-input/70` |
| `copy.tsx` | Same |
| `github-stars.tsx` | Same |
| `icon.tsx` | Same |

#### Animate-UI Radix (`src/components/animate-ui/components/radix/`)

| File | Change |
|------|--------|
| `dialog.tsx` | Width: `w-full max-w-lg` → `w-[min(32rem,calc(100vw-2rem))]`. Added `text-foreground` |
| `alert-dialog.tsx` | Width: `w-full max-w-[calc(100%-2rem)] sm:max-w-lg` → `w-[min(32rem,calc(100vw-2rem))]`. Added `text-foreground` |
| `sheet.tsx` | Added `text-foreground` to content |
| `tabs.tsx` | `dark:border-input dark:bg-input/30` → `dark:border-border-strong dark:bg-input/50` |
| `radio-group.tsx` | `dark:bg-input/30` → `dark:bg-input/50` |

### Files to Copy

```
src/components/ui/button.tsx                           → (UPDATED)
src/components/ui/input.tsx                            → (UPDATED)
src/components/ui/textarea.tsx                         → (UPDATED)
src/components/ui/avatar.tsx                           → (UPDATED)
src/components/ui/separator.tsx                        → (UPDATED)
src/components/ui/scroll-area.tsx                      → (UPDATED)
src/components/ui/table.tsx                            → (UPDATED)
src/components/ui/select.tsx                           → (UPDATED)
src/components/ui/calendar.tsx                         → (UPDATED)
src/components/animate-ui/components/buttons/button.tsx       → (UPDATED)
src/components/animate-ui/components/buttons/copy.tsx         → (UPDATED)
src/components/animate-ui/components/buttons/github-stars.tsx → (UPDATED)
src/components/animate-ui/components/buttons/icon.tsx         → (UPDATED)
src/components/animate-ui/components/radix/dialog.tsx         → (UPDATED)
src/components/animate-ui/components/radix/alert-dialog.tsx   → (UPDATED)
src/components/animate-ui/components/radix/sheet.tsx          → (UPDATED)
src/components/animate-ui/components/radix/tabs.tsx           → (UPDATED)
src/components/animate-ui/components/radix/radio-group.tsx    → (UPDATED)
```

### IOP Tracker globals.css

The IOP tracker's `globals.css` at `projects/ioptracker/src/frontend/styles/globals.css` needs the token value updates listed above plus the `@layer base` block. This file is NOT copied from platform — it's app-specific. The changes must be applied manually or the file replaced.

### No API Changes

All changes are CSS class swaps inside components. Same props, same exports. Drop-in file replacements.

---

## Consolidated File Copy List

This is the **complete** list of all files that need to be copied from platform `src/` to `projects/ioptracker/src/` across all sections of this report.

### New Files (create these — they don't exist in the IOP tracker yet)

```
src/modals/modal.types.ts
src/modals/modal-store.ts
src/modals/modal-events.ts
src/modals/hold-button.tsx
src/modals/confirm-modal.tsx
src/modals/modal-manager.tsx
src/modals/index.ts
src/frontend/client/error-boundary.tsx
src/frontend/client/api.ts
src/frontend/server.ts
src/schema/registry.ts
src/storage/types.ts
src/storage/local-adapter.ts
src/storage/mime.ts
src/storage/presigned.ts
src/storage/storage-service.ts
src/storage/storage.plugin.ts
src/storage/storage-hooks.ts
src/storage/index.ts
src/pages/storage/drive-schema.ts
src/pages/storage/drive-detail-header.tsx
src/pages/storage/storage-management-page.tsx
src/pages/storage/index.ts
src/migrations/migrator.ts
src/migrations/index.ts
src/migrations/run.ts
src/migrations/definitions/001_initial_schema.ts
```

**Total new: 27 files**

### Updated Files (replace existing versions)

```
# Core SDK & Frontend
src/frontend/index.ts
src/frontend/client/app-provider.tsx
src/frontend/client/sdk.ts
src/frontend/client/hooks.ts
src/frontend/client/auth-client.ts
src/frontend/client/hydrate.tsx
src/frontend/client/link.tsx
src/frontend/client/notification-provider.tsx
src/frontend/client/router-context.tsx
src/frontend/client/room-hooks.ts
src/frontend/client/workflow-hooks.ts
src/frontend/router/renderer.ts
src/frontend/router/scanner.ts
src/frontend/router/types.ts
src/frontend/server/router-plugin.ts
src/frontend/server/app-factory.ts
src/frontend/server/client-bundle.ts
src/frontend/server/types.ts

# Sync
src/sync/types.ts
src/sync/reactive-db.ts
src/sync/sync.plugin.ts
src/sync/client/sync-store.ts
src/sync/client/sync-client.ts
src/sync/message-handler.ts
src/sync/client/state-client.ts
src/sync/client/ephemeral-client.ts

# Schema
src/schema/define-schema.ts
src/schema/index.ts

# Workflows
src/workflows/types.ts
src/workflows/index.ts

# Hooks & Utilities
src/hooks/use-form.ts
src/hooks/use-controlled-state.tsx
src/hooks/use-is-in-view.tsx
src/hooks/use-motion-value-state.tsx
src/lib/get-strict-context.tsx

# UI Components (dark theme + icon fixes)
src/components/ui/button.tsx
src/components/ui/input.tsx
src/components/ui/textarea.tsx
src/components/ui/avatar.tsx
src/components/ui/separator.tsx
src/components/ui/scroll-area.tsx
src/components/ui/table.tsx
src/components/ui/select.tsx
src/components/ui/calendar.tsx
src/components/ui/notification-center.tsx
src/components/ui/notification-dropdown.tsx
src/components/ui/validation-rules.tsx

# Animate-UI Components
src/components/animate-ui/components/buttons/button.tsx
src/components/animate-ui/components/buttons/copy.tsx
src/components/animate-ui/components/buttons/github-stars.tsx
src/components/animate-ui/components/buttons/icon.tsx
src/components/animate-ui/components/radix/dialog.tsx
src/components/animate-ui/components/radix/alert-dialog.tsx
src/components/animate-ui/components/radix/sheet.tsx
src/components/animate-ui/components/radix/tabs.tsx
src/components/animate-ui/components/radix/radio-group.tsx

# Auth Forms
src/components/auth/login-form.tsx
src/components/auth/register-form.tsx
src/components/auth/forgot-password-form.tsx
src/components/auth/otp-verification.tsx

# Data Table
src/components/data-table/data-table.tsx
src/components/data-table/data-table-toolbar.tsx
src/components/data-table/editable-cell.tsx
src/components/data-table/animated-cell.tsx

# Forms
src/components/forms/auto-form.tsx
src/components/forms/wizard.tsx

# Admin Pages
src/pages/users/user-management-page.tsx
```

**Total updated: 67 files**

### Grand Total: 94 files (27 new + 67 updated)

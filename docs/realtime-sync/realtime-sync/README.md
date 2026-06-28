# Real-Time Sync Engine

**Define a table. It's live.**

A Convex-like real-time sync engine — self-hosted, single Bun process, SQLite in RAM, @xstate/store on the client. Define a table, it's instantly live. Mutate data anywhere, every connected client reflects it immediately. No polling, no manual invalidation, no WebSocket plumbing. Just data that's always current.

## The Full Loop

```ts
// ─── Server: one plugin, everything is live ──────────

import { Elysia } from 'elysia';
import { createSyncPlugin } from './sync';

new Elysia()
  .use(createSyncPlugin({
    db: { mode: 'memory' },        // or { mode: './data.db' } for durable
    tables: {
      todos: { id: 'text primary key', title: 'text not null', done: 'integer default 0' },
    },
  }))
  .listen(3000);

// That's it. WebSocket live at ws://localhost:3000/sync
// syncDB available in all route handlers via derive()
```

```tsx
// ─── Client: connect and use ──────────────────────────

import { createSyncClient } from '@sync/client';
import { useTable, useRow, useQuery } from '@sync/react';

const client = createSyncClient({
  url: 'ws://localhost:3000/sync',
  tables: {
    todos: { _pk: 'id', id: 'string', title: 'string', done: 'number' },
  },
});

// ─── React: it just works ─────────────────────────────

function TodoList() {
  const { rows, insert } = useTable('todos');
  const incomplete = useQuery('todos', row => !row.done);

  return (
    <div>
      <p>{incomplete.length} remaining</p>
      {Object.values(rows).map(todo => (
        <TodoItem key={todo.id} id={todo.id} />
      ))}
      <button onClick={() => insert({ id: crypto.randomUUID(), title: 'New todo', done: 0 })}>
        Add
      </button>
    </div>
  );
}

function TodoItem({ id }: { id: string }) {
  const { row, update, remove } = useRow('todos', id);
  if (!row) return null;

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

Insert a todo on one client. Every other connected client sees it instantly. Check it off — reflected everywhere. No `refetch()`, no `invalidateQueries()`, no `useEffect` subscriptions. The data is always current.

## Core Properties

| Property | What it means |
|----------|--------------|
| **RAM-speed** | SQLite in `:memory:` mode — writes are sub-microsecond, reads are pointer lookups |
| **Real-time** | Every mutation broadcasts to all connected clients over WebSocket within milliseconds |
| **Type-safe** | Table schemas flow through to TypeScript types — client code is fully typed |
| **Optimistic** | Client mutations apply locally first, confirm/rollback on server response |
| **Zero-boilerplate** | `defineTable()` on server, `useTable()` on client — no API routes, no fetch calls |
| **Reconnect-safe** | Sequence-tracked changes replay on reconnect — no stale state, no manual refresh |

## Stack

| Component | Technology | Role |
|-----------|-----------|------|
| Runtime | Bun | Single binary, fast startup, native SQLite |
| Database | bun:sqlite (`:memory:` or WAL file) | All data lives here — source of truth |
| HTTP/WS | Elysia plugin | WebSocket handler, derive(), lifecycle hooks, composable |
| Client store | @xstate/store | Reactive state, pure reducers, change-detected subscriptions |
| React | useSyncExternalStore | Zero-copy binding from store to components |

## What This Is

A **real-time sync layer for small teams** (2–4 concurrent users). Think of it as a live, reactive database that every client shares. When anyone writes, everyone sees the change instantly. It's what you'd get if SQLite and a WebSocket pub/sub had a baby, and that baby understood React.

**Designed for:**
- Internal tools where 2–4 people collaborate on shared data
- Prototypes that need real-time without the infrastructure
- Any app where "user A changes something, user B should see it immediately" is the core UX

## What This Is NOT

- **Not a database.** It's a sync layer on top of SQLite. Don't store 10 million rows.
- **Not for large scale.** It's optimized for datasets that fit comfortably in RAM (think thousands of rows, not millions).
- **Not multi-region.** Single process, single machine. If you need geo-distribution, use Convex/Supabase/Firebase.
- **Not a general-purpose backend.** It syncs tables. Business logic lives in your mutation handlers, but this isn't a framework for building APIs.

## Convex Comparison

| | Convex | This |
|---|--------|------|
| **Reactivity model** | Server-side reactive queries re-evaluate on mutation, push new results | Table-level reactivity — mutations broadcast row changes, client-side selectors for derived views |
| **Hosting** | Managed cloud | Self-hosted, single Bun process |
| **Database** | Custom (persistent, distributed) | bun:sqlite (RAM or file, single-node) |
| **Scale** | Millions of users | 2–4 concurrent users |
| **Type safety** | Schema → TypeScript codegen | Schema → TypeScript generics (no codegen step) |
| **Optimistic updates** | Built-in | Built-in |
| **Result** | Same DX for the target use case — data that's always current |

The key insight: for small datasets that fit in RAM, table-level change broadcasting achieves the same end result as Convex's reactive query re-evaluation. Simpler implementation. Zero infrastructure.

## Design Documents

| Document | What it covers |
|----------|---------------|
| [Architecture](./architecture.md) | System layers, Elysia plugin design, data flow, component responsibilities |
| [Wire Protocol](./protocol.md) | Message types, sequencing, reconnect, optimistic updates |
| [ReactiveDB](./reactive-db.md) | Server-side SQLite wrapper, defineTable, change tracking, transactions |
| [SyncStore](./sync-store.md) | Client-side @xstate/store integration, React hooks, selectors |
| [Subscription And Mutation Policy](#subscription-and-mutation-policy) | Application-level control over reads and direct sync writes |

## Subscription And Mutation Policy

The sync engine does not own app authorization rules. It owns the transport mechanism: table subscriptions, snapshots, catchup, mutations, and broadcasts. Apps provide policy through `SyncPolicy`.

```ts
import { createDefaultSyncPolicy } from '@platform/sync';

createSyncPlugin({
  db,
  tables,
  policy: createDefaultSyncPolicy({
    readProtectedTables: ['admin_notes'],
    writeProtectedTables: ['audit_log'],
  }),
});
```

A client sends `sync.subscribe { tables, snapshot, lastSeq }`. The sync plugin intersects `tables` and `snapshot` with the connection's readable table set, which is derived from `SyncPolicy.canReadTable` during WebSocket open. The client never receives tables it cannot read.

`sync.mutate` is checked separately with `SyncPolicy.canMutateTable` and the optional `canInsert`, `canUpdate`, and `canDelete` callbacks. This matters because many platform and app tables should be readable in realtime but writable only through a domain service or HTTP route.

When using `createApp()`, Zero composes app policy with platform defaults. The built-in defaults make service-owned platform tables read-only over direct sync mutation while preserving standalone allow-all behavior for app tables unless you configure stricter rules.

## Proven Patterns from This Codebase

This design doesn't invent new patterns — it composes proven ones already working in production:

| Pattern | Existing implementation | Reuse in sync engine |
|---------|----------------------|---------------------|
| Elysia plugin lifecycle | `src/server/plugins/persistence.plugin.ts` — `onStart`/`onStop`, `derive({ as: 'global' })`, lazy getter export | `createSyncPlugin()` — same lifecycle, derive, getter pattern |
| Factory function plugin | `createIngestionQueuePlugin(getMemoryService)` — accepts dependencies via lazy getters | `createSyncPlugin(config)` — accepts DB config and table schemas |
| WS handler in plugin | `src/server/ws/audio-handler.ts` — `new Elysia({ name }).ws()`, TypeBox validation, per-socket data | Sync plugin `.ws('/sync', { ... })` with typed `SyncSocketData` |
| Prepared-statements-in-constructor | `src/persistence/sqlite-hot-store.ts` — all statements prepared in constructor, reused per call | ReactiveDB prepares all CRUD statements per table at define time |
| WAL PRAGMAs | `src/persistence/sqlite-hot-store.ts` — WAL, NORMAL sync, 64MB cache, 256MB mmap | Same PRAGMA stack for durable mode |
| @xstate/store + createSlice | `packages/sdk/src/store/store.ts` — `createStore()` with typed events, `createSlice()` for change-detected subscriptions | SyncStore auto-generates store from table definitions, same slice pattern |
| Bun native pub/sub | Bun `server.publish(topic)` / `ws.subscribe(topic)` — replaces manual `Set<Connection>` broadcast | onChange → `server.publish('sync:{table}')` — zero connection tracking code |
| WS message routing | `packages/sdk/src/transport/ws-bridge.ts` — `routeMessage()` switch-on-type → `store.send()` dispatch | SyncClient routes `sync.*` messages the same way |

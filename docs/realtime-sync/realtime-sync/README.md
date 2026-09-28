# Real-Time Sync Engine

**Define a table. It's live.**

> **Advanced engine docs:** This page documents the standalone sync engine and
> its lower-level React bindings. Most Zero apps should use
> `AppProvider`, `useCollection`, `useLazyCollection`, `useRow`, `useQuery`, and
> `useStatus` from `@zero/framework/react`; see
> [Frontend SDK](../../frontend/sdk.md). Use the hooks here only when mounting
> the sync engine directly without the full Zero frontend SDK.

A Convex-like real-time sync engine—self-hosted Bun runtimes, SQLite in RAM or a
WAL file, and @xstate/store on the client. Each runtime is one in-process
deployment unit; file-mode runtimes can share one local SQLite database and
relay its durable row and State Sync log. Define a standalone public table and
its subscribers see authorized changes without manual invalidation or WebSocket
plumbing. Production apps can add Bearer auth plus table/resource/row policy;
`createApp()` installs platform protections automatically.

## The Full Loop

```ts
// ─── Server: one plugin, everything is live ──────────

import { Elysia } from 'elysia';
import { createSyncPlugin } from '@zero/framework/sync';

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
// This minimal example is intentionally public/allow-all. Add auth + policy
// before using private data, or compose through createApp().
```

```tsx
// ─── Client: connect and use ──────────────────────────

import {
  createSyncClient,
  useQuery,
  useRow,
  useTable,
} from '@zero/framework/sync/client';

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

In this deliberately public example, insert a todo on one client and every
subscribed client sees it. With policy enabled, only eligible subscribers see
the row. No `refetch()`, `invalidateQueries()`, or manual `useEffect`
subscription is required.

## Core Properties

| Property | What it means |
|----------|--------------|
| **RAM-speed** | SQLite in `:memory:` mode — writes are sub-microsecond, reads are pointer lookups |
| **Real-time** | Eligible mutations reach authorized subscribed clients over WebSocket within milliseconds |
| **Type-safe** | Table schemas flow through to TypeScript types — client code is fully typed |
| **Optimistic** | Client mutations apply locally first, confirm/rollback on server response |
| **Zero-boilerplate** | `defineTable()` on the standalone sync plugin, low-level `useTable()` on the client — no API routes, no fetch calls |
| **Reconnect-safe** | Sequence-tracked changes replay on reconnect — no stale state, no manual refresh |
| **Policy-scoped collaboration** | Ephemeral presence, typing, and custom topics resolve through server-owned namespaces with live authorization |

## Stack

| Component | Technology | Role |
|-----------|-----------|------|
| Runtime | Bun | Single binary, fast startup, native SQLite |
| Database | bun:sqlite (`:memory:` or WAL file) | All data lives here — source of truth |
| HTTP/WS | Elysia plugin | WebSocket handler, derive(), lifecycle hooks, composable |
| Client store | @xstate/store | Reactive state, pure reducers, change-detected subscriptions |
| React | useSyncExternalStore | Zero-copy binding from store to components |

## What This Is

A **real-time sync layer for small teams** (2–4 concurrent users). It turns
ReactiveDB changes into per-connection projections: public standalone apps can
share a whole table, while authenticated apps can narrow tables and rows. It's
what you would get if SQLite and WebSocket delivery understood React and an
authorization policy.

**Designed for:**
- Internal tools where 2–4 people collaborate on shared data
- Prototypes that need real-time without the infrastructure
- Any app where "user A changes something, user B should see it immediately" is the core UX

## What This Is NOT

- **Not a database.** It's a sync layer on top of SQLite. Don't store 10 million rows.
- **Not for large scale.** It's optimized for datasets that fit comfortably in RAM (think thousands of rows, not millions).
- **Not multi-region.** Multiple runtimes may share one local file-mode SQLite
  database, but separate databases, cross-host messaging, and RAM-only topics
  need external coordination. If you need geo-distribution, use a distributed
  system such as Convex, Supabase, or Firebase.
- **Not a general-purpose backend.** It syncs tables. Business logic lives in your mutation handlers, but this isn't a framework for building APIs.

## Convex Comparison

| | Convex | This |
|---|--------|------|
| **Reactivity model** | Server-side reactive queries re-evaluate on mutation, push new results | Table-level reactivity — mutations broadcast row changes, client-side selectors for derived views |
| **Hosting** | Managed cloud | Self-hosted Bun runtime; same-file local replicas supported |
| **Database** | Custom (persistent, distributed) | bun:sqlite (RAM or file; one shared-file boundary) |
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
import { createDefaultSyncPolicy } from '@zero/framework/sync';

createSyncPlugin({
  db: { mode: 'app.db' },
  tables,
  policy: createDefaultSyncPolicy({
    readProtectedTables: ['admin_notes'],
    writeProtectedTables: ['audit_log'],
  }),
});
```

A client authenticates with `sync.auth { token }`, waits for
`sync.auth.ready`, then sends
`sync.subscribe { tables, snapshot, lastSeq, epoch, scope }`. The epoch prevents
pre-restart cursors from being treated as current; the opaque scope prevents
cached data from crossing an identity or read-policy boundary.
The sync plugin intersects `tables` and `snapshot` with the connection's
readable table set, which is derived from the live account and
`SyncPolicy.canReadTable` and recomputed during revalidation. The client never
receives tables it cannot read.

Before each committed live change is sent, authenticated sockets also pass a
synchronous durable-authority fence. Zero re-resolves the captured secret-free
session authority and closes/reset-clears a stale socket before delivery if
the user, session, tenant, membership, generation, or advanced-role revision
changed. Multi-tenant Sync requires a verifier implementing both
`captureAuthContextAuthority()` and `resolveAuthContextAuthority()` and fails
closed when that contract is unavailable. Periodic revalidation still
recomputes the complete table/row policy for policy changes that are not
represented solely by identity generations.

Managed auth also publishes a monotonic `_auth_authority_revision` through
SQLite triggers. File-mode runtimes sharing that database poll the revision and
promptly revalidate their local sockets when another runtime changes an
account, session, tenant, membership, or role. This complements the final-send
authority fence; it never places bearer credentials in a process bus.

`sync.mutate` is checked separately with `SyncPolicy.canMutateTable` and the optional `canInsert`, `canUpdate`, and `canDelete` callbacks. This matters because many platform and app tables should be readable in realtime but writable only through a domain service or HTTP route.

When using `createApp()`, Zero composes app policy with deny-wins platform
defaults. Private framework tables (`users`, workflow definitions, and Storage
metadata) are not generic Sync reads. Notifications/receipts, rooms/members,
and workflow execution rows use target, membership, or owner filters across
snapshot, catch-up, and live delivery. Framework-owned tables are also
protected from direct Sync mutation. Registered app resources participate only
when their server-owned exposure is `sync` or `all`; realm and policy still
apply after that transport gate. Direct `createSyncPlugin()` composition
preserves standalone allow-all behavior unless it is given auth/policy.

File-mode plugins also tail the shared durable, explicitly versioned `_changes`
log. Its strict state singleton owns the monotonic sequence and pruning
watermark; a seq-0 sentinel and immutable-log triggers fence older writers.
The first fenced upgrade is therefore a coordinated stop-all operation. A
commit made by another runtime is delivered through the same row
filter/projector and socket path as a local commit. One dispatcher orders local
and external rows by their durable sequence, so a local `N+1` cannot overtake
an unobserved remote `N`. Retention/continuity/format gaps synchronously reset
incremental authorization-policy caches, then close sockets so reconnect
performs an authoritative snapshot. An unsafe policy reset or invalid durable
log state latches the runtime closed until repair and restart. Snapshot and catch-up payloads
bind their rows and cursor to one SQLite read view. Hot,
ephemeral, separate-database, and ephemeral-topic replication remain outside
this shared-file mechanism.

## Ephemeral Collaboration Topics

Ephemeral topics share the Sync WebSocket but are RAM-only and TTL-bound. They
are intended for presence, typing, cursors, and other collaboration state that
must disappear automatically instead of becoming durable application data.

Auth-enabled `createApp()` instances install a fail-closed topic policy:

- `presence:<roomId>` and `typing:<roomId>` require current `RoomService`
  membership. Writes and deletes use the server-verified
  `user:<currentUserId>` key.
- `user:<currentUserId>:<name>` is a personal authenticated topic.
- Every other shared topic is rejected unless `ephemeralPolicy` explicitly
  classifies it and returns a server-side namespace.

Policies run for subscribe, set, delete, periodic revalidation, and delivery.
A revoked room membership therefore removes the live subscription before
further changes cross the socket. Authless standalone `createSyncPlugin()`
keeps the original unrestricted topic behavior for compatibility; adding auth
without a policy fails closed.

See [Wire Protocol](./protocol.md#ephemeral-collaboration-channel) for message
shapes, limits, ownership rules, and stable error codes.

## Current Implementation Map

The current sync implementation is split by responsibility:

| Responsibility | Current implementation |
|----------------|------------------------|
| Elysia plugin lifecycle and `/sync` WebSocket | `src/sync/sync.plugin.ts` |
| SQLite runtime, connection setup, and statement cache | `src/persistence/platform-sqlite.ts`, `src/persistence/sqlite-connection.ts`, `src/persistence/statement-cache.ts` |
| Reactive tables, prepared CRUD statements, transactions, and change events | `src/sync/reactive-db.ts` |
| Server message dispatch | `src/sync/message-handler.ts` |
| Subscription selection and snapshots | `src/sync/sync-subscribe-handler.ts`, `src/sync/sync-snapshot-response.ts` |
| Per-socket row-policy projection and live delivery | `src/sync/row-filter.ts`, `src/sync/sync-change-delivery.ts` |
| Client WebSocket routing and reconnect | `src/sync/client/sync-socket-message-router.ts`, `src/sync/client/sync-reconnect-scheduler.ts` |
| @xstate/store state and React bindings | `src/sync/client/sync-store.ts`, `src/sync/client/hooks.ts` |

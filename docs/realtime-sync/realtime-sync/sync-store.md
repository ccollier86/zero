# SyncStore — Client-Side Design

@xstate/store integration that makes server data feel local. Define your tables once, get a fully typed reactive store with optimistic mutations, reconnect, and React hooks.

> **Advanced engine docs:** This page describes the standalone sync client and
> lower-level React hooks exported from `@platform/sync/client`. App code that
> uses the full Zero frontend should prefer `@platform/frontend` hooks:
> `useCollection`, `useLazyCollection`, `useRow`, `useQuery`, and `useStatus`.

## Overview

SyncStore is the client-side counterpart to [ReactiveDB](./reactive-db.md). Where ReactiveDB wraps SQLite with change events, SyncStore wraps @xstate/store with server synchronization. Together they form the two halves of the sync engine.

**Pattern source:** `packages/sdk/src/store/store.ts` — the SDK store uses `createStore()` with typed events and `createSlice()` for change-detected subscriptions. SyncStore follows the same pattern, auto-generating the store shape from table definitions.

## `createSyncStore()`

The entry point. Pass table definitions, get a fully wired store.

```ts
import { createSyncStore } from '@platform/sync/client';

const { store, tables } = createSyncStore({
  todos: { _pk: 'id', id: 'string', title: 'string', done: 'number' },
  users: { _pk: 'id', id: 'string', name: 'string', role: 'string' },
});
```

**What it generates:**

### Store Context

```ts
interface SyncStoreContext {
  // One record per table — keyed by primary key
  todos: Record<string, { id: string; title: string; done: number }>;
  users: Record<string, { id: string; name: string; role: string }>;

  // Sync metadata
  _sync: {
    connected: boolean;
    lastSeq: number;
    pending: PendingMutation[];
  };
}
```

Each table is stored as `Record<PrimaryKey, Row>` — an object keyed by the primary key value. This gives O(1) lookup by ID and makes the `useRow()` hook trivial.

### Store Events

The store handles two categories of events:

**Server events** (from WebSocket, routed by the message handler):

| Event | Payload | Effect |
|-------|---------|--------|
| `sync.snapshot` | `{ tables, seq }` | Replace included table contents, clear pending entries for those tables, update `lastSeq` |
| `sync.change` | `{ seq, table, op, rowId, row, origin }` | Apply server's canonical row state, update `lastSeq`. `origin` is not checked — every change updates the row unconditionally. |
| `sync.ack` | `{ ref, ok, error?, seq? }` | Resolve pending mutation (confirm or rollback) |
| `sync.catchup` | `{ changes, seq }` | Apply array of changes in order, update `lastSeq` |

**Local events** (from mutation actions, applied optimistically):

| Event | Payload | Effect |
|-------|---------|--------|
| `{table}.optimistic-insert` | `{ row, ref }` | Add row to table record |
| `{table}.optimistic-update` | `{ rowId, partial, ref }` | Merge partial into existing row |
| `{table}.optimistic-delete` | `{ rowId, ref }` | Remove row from table record |

**Connection events:**

| Event | Payload | Effect |
|-------|---------|--------|
| `sync.connected` | `{}` | Set `_sync.connected = true` |
| `sync.disconnected` | `{}` | Set `_sync.connected = false` |

### Reducers

All reducers are **pure functions** — they take context and event, return new context. Same pattern as `packages/sdk/src/store/store.ts`.

```ts
// Conceptual — the actual implementation generates these from table definitions
const reducers = {
  // Snapshot is authoritative for tables included in the payload.
  // Lazy tables are normally omitted, so their pending mutations stay active.
  'sync.snapshot': (ctx, { tables, seq }) => {
    const snapshotTables = new Set(Object.keys(tables));
    return {
      ...ctx,
      ...tables,            // Replace included table contents
      _sync: {
        ...ctx._sync,
        lastSeq: seq,
        pending: ctx._sync.pending.filter(p => !snapshotTables.has(p.table)),
      },
    };
  },

  // Apply server's canonical row state regardless of origin.
  // For the originating client, this replaces the optimistic version with what the server
  // actually wrote (which may differ if the server added timestamps, defaults, etc.).
  // For non-originating clients, this is a normal new row.
  // The `origin` field is NOT checked here — every change updates the row unconditionally.
  // The `sync.ack` reducer handles clearing the pending queue separately.
  'sync.change': (ctx, { seq, table, op, rowId, row }) => {
    const tableData = { ...ctx[table] };
    switch (op) {
      case 'INSERT':
      case 'UPDATE':
        tableData[rowId] = row;
        break;
      case 'DELETE':
        delete tableData[rowId];
        break;
    }
    return {
      ...ctx,
      [table]: tableData,
      _sync: { ...ctx._sync, lastSeq: seq },
    };
  },

  'sync.ack': (ctx, { ref, ok, error }) => {
    if (ok) {
      // Remove from pending — optimistic state is confirmed
      return {
        ...ctx,
        _sync: {
          ...ctx._sync,
          pending: ctx._sync.pending.filter(p => p.ref !== ref),
        },
      };
    }
    // Rollback — restore previous state
    const mutation = ctx._sync.pending.find(p => p.ref === ref);
    if (!mutation) return ctx;
    const tableData = { ...ctx[mutation.table] };
    if (mutation.previousState) {
      tableData[mutation.rowId] = mutation.previousState;
    } else {
      delete tableData[mutation.rowId];
    }
    return {
      ...ctx,
      [mutation.table]: tableData,
      _sync: {
        ...ctx._sync,
        pending: ctx._sync.pending.filter(p => p.ref !== ref),
      },
    };
  },

  'sync.catchup': (ctx, { changes, seq }) => {
    let newCtx = { ...ctx };
    let pending = [...newCtx._sync.pending];
    for (const change of changes) {
      const tableData = { ...newCtx[change.table] };
      switch (change.op) {
        case 'INSERT':
        case 'UPDATE':
          tableData[change.rowId] = change.row;
          break;
        case 'DELETE':
          delete tableData[change.rowId];
          break;
      }
      newCtx = { ...newCtx, [change.table]: tableData };
      // If a pending mutation matches this table + rowId, it was confirmed by the server — remove it
      pending = pending.filter(p => !(p.table === change.table && p.rowId === change.rowId));
    }
    return {
      ...newCtx,
      _sync: { ...newCtx._sync, lastSeq: seq, pending },
    };
  },

  // Per-table optimistic mutations (generated for each table)
  'todos.optimistic-insert': (ctx, { row, ref }) => ({
    ...ctx,
    todos: { ...ctx.todos, [row.id]: row },
    _sync: {
      ...ctx._sync,
      pending: [...ctx._sync.pending, {
        ref, table: 'todos', op: 'INSERT',
        rowId: row.id,
        previousState: ctx.todos[row.id] ?? null,  // Capture existing row for correct rollback
        optimisticState: row,
        sentAt: Date.now(),
      }],
    },
  }),

  // ... similar for optimistic-update, optimistic-delete per table
};
```

## Table Slices

`createTableSlice()` extracts a single table from the store as a `Slice<Record<string, Row>>`. Same pattern as `createSlice()` in `packages/sdk/src/store/store.ts` — only notifies subscribers when the selected value actually changes (referential equality).

```ts
import { createTableSlice } from '@platform/sync/client';

const todosSlice = createTableSlice(store, 'todos');

// Get current value
const todos = todosSlice.get();  // Record<string, TodoRow>

// Subscribe to changes
const unsub = todosSlice.subscribe((todos) => {
  console.log('Todos changed:', Object.keys(todos).length, 'items');
});
```

**Implementation:**

```ts
function createTableSlice<T>(
  store: SyncStore,
  tableName: string
): Slice<Record<string, T>> {
  return createSlice(store, (ctx) => ctx[tableName]);
}
```

Identical to the SDK's `createSlice()`:

```ts
function createSlice<T>(store: SyncStore, selector: (ctx: SyncStoreContext) => T): Slice<T> {
  return {
    get() {
      return selector(store.getSnapshot().context);
    },
    subscribe(fn: (value: T) => void) {
      let prev = selector(store.getSnapshot().context);
      const subscription = store.subscribe(() => {
        const next = selector(store.getSnapshot().context);
        if (next !== prev) {
          prev = next;
          fn(next);
        }
      });
      return () => subscription.unsubscribe();
    },
  };
}
```

## React Hooks

Three hooks cover all common patterns. All use `useSyncExternalStore` for tear-free reads.

### `useTable(tableName)`

Subscribe to an entire table. Returns all rows plus mutation functions.

```tsx
function TodoList() {
  const { rows, insert, update, remove } = useTable('todos');

  return (
    <ul>
      {Object.values(rows).map(todo => (
        <li key={todo.id}>
          {todo.title}
          <button onClick={() => update(todo.id, { done: 1 })}>Done</button>
          <button onClick={() => remove(todo.id)}>Delete</button>
        </li>
      ))}
      <button onClick={() => insert({ id: crypto.randomUUID(), title: 'New', done: 0 })}>
        Add
      </button>
    </ul>
  );
}
```

**Return type:**

```ts
interface UseTableResult<Row> {
  rows: Record<string, Row>;      // All rows, keyed by PK
  insert: (row: Row) => void;     // Optimistic insert + WS send
  update: (id: string, partial: Partial<Row>) => void;
  remove: (id: string) => void;
}
```

**Implementation:**

```ts
function useTable<Row>(tableName: string): UseTableResult<Row> {
  const client = useSyncClient();  // From context provider

  const rows = useSyncExternalStore(
    (cb) => client.store.subscribe(cb),  // Subscribe
    () => client.store.getSnapshot().context[tableName],  // Snapshot
  );

  // Mutation functions are stable refs (useCallback with empty deps + client ref)
  const insert = useCallback((row: Row) => client.insert(tableName, row), [client, tableName]);
  const update = useCallback((id: string, partial: Partial<Row>) =>
    client.update(tableName, id, partial), [client, tableName]);
  const remove = useCallback((id: string) =>
    client.delete(tableName, id), [client, tableName]);

  return { rows, insert, update, remove };
}
```

**Re-render behavior:** Re-renders when *any* row in the table changes. For large tables with frequent updates, use `useRow()` or `useQuery()` instead.

### `useRow(tableName, id)`

Subscribe to a single row. Only re-renders when that specific row changes.

```tsx
function TodoItem({ id }: { id: string }) {
  const { row, update, remove } = useRow('todos', id);

  if (!row) return null;  // Row deleted

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

**Return type:**

```ts
interface UseRowResult<Row> {
  row: Row | null;                 // The row, or null if it doesn't exist
  update: (partial: Partial<Row>) => void;
  remove: () => void;
}
```

**Implementation:**

```ts
function useRow<Row>(tableName: string, id: string): UseRowResult<Row> {
  const client = useSyncClient();

  const row = useSyncExternalStore(
    (cb) => client.store.subscribe(cb),
    () => client.store.getSnapshot().context[tableName]?.[id] ?? null,
  );

  const update = useCallback((partial: Partial<Row>) =>
    client.update(tableName, id, partial), [client, tableName, id]);
  const remove = useCallback(() =>
    client.delete(tableName, id), [client, tableName, id]);

  return { row, update, remove };
}
```

**Re-render behavior:** Only re-renders when this specific row changes. If another row in the same table changes, this component doesn't re-render. The `useSyncExternalStore` snapshot selector returns `ctx[table][id]`, which is referentially stable unless that specific row is updated.

### `useQuery(tableName, filterFn)`

Client-side filtered view. Memoized — only re-renders when the filtered result changes.

```tsx
function IncompleteTodos() {
  const incomplete = useQuery('todos', (row) => !row.done);

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

**Return type:** `Row[]` — array of matching rows.

**Implementation:**

```ts
function useQuery<Row>(
  tableName: string,
  filterFn: (row: Row) => boolean
): Row[] {
  const client = useSyncClient();

  // Memoize the selector to avoid recomputing on every render
  const selector = useMemo(
    () => (ctx: SyncStoreContext) => {
      const table = ctx[tableName] as Record<string, Row>;
      return Object.values(table).filter(filterFn);
    },
    [tableName, filterFn]
  );

  // Use a ref to track the previous result for shallow comparison
  const prevRef = useRef<Row[]>([]);

  return useSyncExternalStore(
    (cb) => client.store.subscribe(cb),
    () => {
      const next = selector(client.store.getSnapshot().context);
      // Shallow array comparison — same items in same order = same reference
      if (shallowArrayEqual(prevRef.current, next)) {
        return prevRef.current;
      }
      prevRef.current = next;
      return next;
    },
  );
}
```

**Re-render behavior:** Only re-renders when the filtered result changes. Uses shallow array comparison — if the same rows pass the filter in the same order, the reference is stable.

**Caveat:** The filter function should be stable (wrapped in `useCallback` or defined outside the component). If a new function reference is passed on every render, the memoization breaks.

## SyncClient

The connection manager. Handles WebSocket lifecycle, message routing, optimistic mutations, and reconnect.

### Creation

```ts
import { createSyncClient } from '@platform/sync/client';

const client = createSyncClient({
  url: 'ws://localhost:3000/sync',
  tables: {
    todos: { _pk: 'id', id: 'string', title: 'string', done: 'number' },
    users: { _pk: 'id', id: 'string', name: 'string', role: 'string' },
  },
  onError?: (error: string) => void,
  onReconnect?: () => void,
});
```

### Internal Structure

```ts
interface SyncClient {
  readonly store: SyncStore;
  readonly connected: boolean;

  // Mutations (optimistic + WS send)
  insert(table: string, row: Row): void;
  update(table: string, id: string, partial: Partial<Row>): void;
  delete(table: string, id: string): void;

  // Lifecycle
  disconnect(): void;
}
```

### Message Routing

Same pattern as `packages/sdk/src/transport/ws-bridge.ts` — a `routeMessage()` function that switches on `msg.type` and dispatches to `store.send()`:

```ts
function routeMessage(store: SyncStore, msg: ServerMessage): void {
  switch (msg.type) {
    case 'sync.snapshot':
      store.send({ type: 'sync.snapshot', tables: msg.tables, seq: msg.seq });
      break;

    case 'sync.change':
      store.send({
        type: 'sync.change',
        seq: msg.seq, table: msg.table, op: msg.op,
        rowId: msg.rowId, row: msg.row,
      });
      break;

    case 'sync.ack':
      store.send({
        type: 'sync.ack',
        ref: msg.ref, ok: msg.ok, error: msg.error, seq: msg.seq,
      });
      break;

    case 'sync.catchup':
      store.send({ type: 'sync.catchup', changes: msg.changes, seq: msg.seq });
      break;
  }
}
```

WebSocket listener:

```ts
ws.onmessage = (event) => {
  if (typeof event.data !== 'string') return;
  try {
    const msg = JSON.parse(event.data);
    routeMessage(store, msg);
  } catch {
    // Malformed JSON — ignore
  }
};
```

### Mutation Flow

When the user calls `client.insert('todos', row)`:

```ts
insert(table: string, row: Row): void {
  const ref = crypto.randomUUID();
  const pk = this.tableDefs[table]._pk;  // Known from table definition
  const rowId = String(row[pk]);

  // 1. Apply optimistically
  this.store.send({
    type: `${table}.optimistic-insert`,
    row, ref,
  });

  // 2. Send to server
  this.ws.send(JSON.stringify({
    type: 'sync.mutate',
    ref, table, op: 'INSERT', row,
  }));
}
```

The optimistic apply happens synchronously — the store updates, React re-renders, user sees the change instantly. The WS send is fire-and-forget; the `sync.ack` response handles confirmation or rollback.

**Same-row serialization:** If a mutation is already pending for a given `(table, rowId)`, the client queues the new mutation locally and does not send it until the first one is acked. This prevents broken rollback chains where mutation B's `previousState` depends on mutation A having been applied.

### Reconnect

When the WebSocket disconnects:

1. `store.send({ type: 'sync.disconnected' })` — UI can show connection status
2. Start exponential backoff reconnect timer (1s, 2s, 4s, max 30s)
3. On reconnect:
   a. Open new WS connection
   b. `store.send({ type: 'sync.connected' })`
   c. Send `sync.subscribe` with `lastSeq` from store context
   d. Server responds with `sync.catchup` or `sync.snapshot`
   e. If `sync.snapshot` → included table state is replaced and matching pending entries are cleared
   f. If `sync.catchup` → changes applied, pending mutations that overlap with catchup data are confirmed
   g. Store updates — UI is current

### Pending Mutation Timeout

Mutations that haven't been acked within 10 seconds (configurable) are treated as failures:

```ts
// Checked on an interval (every 2 seconds)
const now = Date.now();
for (const mutation of this.store.getSnapshot().context._sync.pending) {
  if (now - mutation.sentAt > this.ackTimeout) {
    this.store.send({
      type: 'sync.ack',
      ref: mutation.ref,
      ok: false,
      error: 'Mutation timeout',
    });
  }
}
```

## Context Provider

### `SyncProvider`

React context provider that creates a `SyncClient` on mount, exposes it via context, and disconnects on unmount. Takes `url` and `tables` as props.

```tsx
import { createContext, useContext, useEffect, useRef } from 'react';
import { createSyncClient, type ClientTableDef, type SyncClient } from '@platform/sync/client';

const SyncContext = createContext<SyncClient | null>(null);

interface SyncProviderProps {
  url: string;
  tables: Record<string, ClientTableDef>;
  token?: string;
  children: React.ReactNode;
}

function SyncProvider({ url, tables, token, children }: SyncProviderProps) {
  const clientRef = useRef<SyncClient | null>(null);

  // Create client once on mount
  if (!clientRef.current) {
    clientRef.current = createSyncClient({ url, tables, token });
  }

  useEffect(() => {
    // Disconnect on unmount
    return () => {
      clientRef.current?.disconnect();
      clientRef.current = null;
    };
  }, []);

  return (
    <SyncContext.Provider value={clientRef.current}>
      {children}
    </SyncContext.Provider>
  );
}
```

### `useSyncClient()`

Hook that reads the `SyncClient` from context. Throws if used outside a `SyncProvider`.

```ts
function useSyncClient(): SyncClient {
  const client = useContext(SyncContext);
  if (!client) {
    throw new Error('useSyncClient must be used within a <SyncProvider>');
  }
  return client;
}
```

### Usage

```tsx
import { SyncProvider } from '@platform/sync/client';

function App() {
  return (
    <SyncProvider
      url="ws://localhost:3000/sync"
      tables={{
        todos: { _pk: 'id', id: 'string', title: 'string', done: 'number' },
      }}
    >
      <TodoList />
    </SyncProvider>
  );
}
```

The provider creates the SyncClient on mount, connects, and makes it available to `useTable`/`useRow`/`useQuery` via context. On unmount, it disconnects.

## Connection Status

```tsx
function ConnectionBadge() {
  const { connected, pending } = useSyncStatus();

  return (
    <div>
      {connected ? 'Connected' : 'Reconnecting...'}
      {pending > 0 && ` (${pending} pending)`}
    </div>
  );
}
```

`useSyncStatus()` reads from the `_sync` portion of the store context. Uses a ref for memoization — `useSyncExternalStore` compares by `Object.is`, so returning a new object every time would cause re-renders on every store change:

```ts
function useSyncStatus() {
  const client = useSyncClient();
  const prevRef = useRef({ connected: false, pending: 0 });

  return useSyncExternalStore(
    (cb) => client.store.subscribe(cb),
    () => {
      const sync = client.store.getSnapshot().context._sync;
      const next = { connected: sync.connected, pending: sync.pending.length };
      if (next.connected === prevRef.current.connected &&
          next.pending === prevRef.current.pending) {
        return prevRef.current;
      }
      prevRef.current = next;
      return next;
    },
  );
}
```

## Type Safety

Table definitions flow through to TypeScript types at every level:

```ts
// Definition — _pk tells the client which field is the primary key
const client = createSyncClient({
  tables: {
    todos: { _pk: 'id', id: 'string', title: 'string', done: 'number' },
  },
});

// Hook — rows is Record<string, { id: string; title: string; done: number }>
const { rows, insert } = useTable('todos');

// insert is typed — TypeScript enforces the row shape
insert({ id: '1', title: 'Buy milk', done: 0 });  // OK
insert({ id: '1', title: 'Buy milk' });            // Error: missing 'done'
insert({ id: '1', title: 'Buy milk', extra: 1 });  // Error: excess property

// useRow — row is { id: string; title: string; done: number } | null
const { row } = useRow('todos', '1');

// useQuery — filter function is typed
const incomplete = useQuery('todos', (row) => !row.done);  // row is TodoRow
```

Type mapping from schema definition to TypeScript:

| Schema type | TypeScript type |
|-------------|----------------|
| `'string'` | `string` |
| `'number'` | `number` |
| `'boolean'` | `boolean` |

The `_pk` field is metadata — it designates which field is the primary key. It's stripped from the row type (you don't get `_pk` as a column). The PK must be `'string'` — the store keys records by PK as `Record<string, Row>`, and the wire protocol always sends `rowId` as a string.

No codegen. No build step. Generic inference only.

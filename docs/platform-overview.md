# Platform Overview

A full-stack reactive application framework that ships as a single Bun binary. One import, one server, everything in-process. No microservices, no Redis, no external queue. SQLite + WebSockets + React — wired end to end.

```
Browser (React)  <->  WebSocket /sync  <->  Bun Server (Elysia)
     SDK hooks          pub/sub              ReactiveDB (SQLite)
```

---

## Core Engine: ReactiveDB + Real-Time Sync

Every write to SQLite automatically broadcasts to every connected client via WebSocket pub/sub. No polling, no manual event emission. Insert a row on the server — every browser tab sees it instantly.

**How it works:**
1. Client calls `collection.insert(row)` — applies optimistically to local @xstate/store
2. Mutation sent over WebSocket as `sync.mutate`
3. Server checks sync mutation policy, writes to bun:sqlite (synchronous), triggers onChange listener
4. onChange publishes `sync.change` to Bun pub/sub — all subscribers get it
5. Originating client gets `sync.ack` — confirms or rolls back the optimistic write
6. Other clients receive the change, apply to their local store, React re-renders

**Auto/lazy sync for large tables:** Omitted table sync mode defaults to `auto`.
Startup counts rows, keeps small tables in full websocket snapshots, and
auto-resolves oversized tables to lazy sync. Tables with `_sync: 'lazy'` or a
resolved lazy mode skip the initial snapshot and load on demand via
`collection.load()` or `useLazyCollection()`. Live changes still stream once
rows are present locally.

**Ring buffer reconnect:** If a client disconnects briefly, it sends its last `seq` on reconnect. Server replays missed changes from an in-memory ring buffer (default 1000 entries). No full re-download unless the gap exceeds buffer depth.

**Transactions:** Batch writes with deferred change emission — clients see them atomically.

**Optimistic mutation guarantees:**
- Same-row serialization queue — two rapid edits to the same row don't create broken rollback chains
- Ack timeout detection (10s) — if the server goes silent, the client treats it as a rejection
- Send buffer — mutations while disconnected are queued and flushed on reconnect

**Sync policy:** WebSocket auth verifies `?token=...` during connection open when auth is enabled. Readable tables are derived from `SyncPolicy.canReadTable`; direct client writes are checked separately through `canMutateTable`, `canInsert`, `canUpdate`, and `canDelete`. `createApp()` protects service-owned platform tables from direct sync mutation by default, while app-owned tables keep the fast optimistic write path unless you configure stricter policy.

**Migrations:** Zero uses explicit migration files plus first-class tooling for
schema history, drift detection, draft migration planning, rollback, and
destructive-change backups. See [Migrations](./migrations.md).

**Observability:** Logs, warnings, errors, frontend reports, and platform
events flow through stable Zero event codes and configurable sinks. The default
runtime writes to console, keeps a bounded in-memory event store, and exposes a
protected `/api/_zero/observability/events` endpoint. See
[Observability](./observability.md).

---

## Authentication

`createAuthPlugin()` gives you a complete auth system:

- **User registration** with username/email/password
- **JWT access + refresh tokens** with rotation
- **Role-based middleware:** `requireAuth()` and `requireAdmin()` — fully typed, zero casts
- **User properties:** arbitrary KV per user (`setProperty`, `getProperty`)
- **React integration:** `useAuth()` returns full state + actions in one call
- **Top-level SDK access:** `client.login()`, `client.logout()`, `client.user` — no namespace required

```tsx
// React hook
function LoginPage() {
  const { user, isAuthenticated, login, logout } = useAuth();
  if (isAuthenticated) return <p>Hello, {user!.username}</p>;
  return <button onClick={() => login('admin', 'pass')}>Login</button>;
}

// Vanilla JS (same client)
await client.login('admin', 'pass');
console.log(client.user);     // AuthUser
console.log(client.isAuthenticated); // true
```

**Pre-built auth UI blocks:**

| Component | What it does |
|-----------|-------------|
| `<LoginForm>` | Email/password login with social providers, forgot password link |
| `<RegisterForm>` | Registration with field selection, password strength meter |
| `<ForgotPasswordForm>` | Password reset flow |
| `<OTPVerification>` | OTP input with auto-focus |
| `<PasswordInput>` | Password field with show/hide toggle |
| `<PasswordStrength>` | Real-time password strength indicator |
| `<SocialLoginGroup>` | Google, GitHub, Microsoft, Apple OAuth buttons |
| `<AuthLayout>` | Centered card layout for auth pages |
| `<Gate allow={['admin']}>` | Role-based conditional rendering |

---

## State Sync — Per-User Persistent KV

Like `useState` but persisted on the server and synced across all of a user's devices.

```tsx
function Sidebar() {
  const [open, setOpen] = useServerState('sidebar.open', true);
  return <button onClick={() => setOpen(!open)}>{open ? 'Close' : 'Open'}</button>;
}
```

Open the sidebar on your laptop, it opens on your phone. Optimistic writes — instant local update, background sync. Two-tier storage: RAM (fast reads) + SQLite (persistence). 64KB per value, 1000 keys, 10MB per user.

---

## Ephemeral KV — High-Frequency Shared State

Shared between all users, no persistence, no SQLite writes. Pure RAM + pub/sub. Fire-and-forget — no ack, no rollback. If an update is lost, the next one corrects it.

```tsx
function LivePoll() {
  const [votes, setVotes] = useEphemeral('poll:best-framework', 'votes', {});
  const vote = (choice: string) => setVotes({ ...votes, [me.id]: choice });
}
```

**Built-in throttle** for high-frequency updates:
```ts
// Send cursor at ~15fps, not every mousemove
client.ephemeral.setThrottled('cursors', 'alice', { x, y }, 66);
```

**Use cases:** Cursor positions, typing indicators, live poll votes, drag positions, game state during a match.

---

## Rooms — Collaborative Spaces

Scoped collaboration with membership tracking. A room is a namespace that groups users and filters shared data.

```tsx
function GameLobby({ roomId }) {
  const { room, members } = useRoom(roomId);
  const moves = useRoomData<GameMove>(roomId, 'game_moves');
  const { insert } = useCollection('game_moves');

  const makeMove = (pos: number) => {
    insert({ room_id: roomId, player: me.id, position: pos });  // Auto-PK
  };

  return <Board moves={moves} players={members} onMove={makeMove} />;
}
```

**The key insight:** `useRoomData<T>(roomId, tableName)` makes any table with a `room_id` column collaborative. No new protocol, no new sync mechanism — it's `useQuery` with a pre-applied filter. The data lives in regular ReactiveDB tables and syncs like everything else.

**Server:** `createRoomPlugin()` provides REST routes (`/rooms/*`) — create, join, leave, delete, list members.

**Hooks:**

| Hook | Returns |
|------|---------|
| `useRoom(roomId)` | Room details + member list, live |
| `useRoomMembers(roomId)` | Just the member list |
| `useRooms(userId)` | All rooms user belongs to |
| `useRoomActions()` | `{ create, join, leave, deleteRoom }` |
| `useRoomData<T>(roomId, table)` | Rows from any table filtered by room_id |

---

## Presence — Who's Online

Built on ephemeral KV. Convention: topic `presence:{roomId}`, key `user:{userId}`. Auto-heartbeat every 10s, auto-expire after 30s, disconnect = gone.

```tsx
function Canvas({ roomId }) {
  const { members, update } = usePresence(roomId);

  return (
    <div onMouseMove={e => update({ cursor: { x: e.clientX, y: e.clientY } })}>
      {members.map(m => (
        <Cursor key={m.userId} pos={m.custom?.cursor} color={m.custom?.color} />
      ))}
    </div>
  );
}
```

Each `PresenceMember` carries: `userId`, `status` (online/idle/away), `lastSeen`, and arbitrary `custom` data (cursor position, avatar, status message — whatever you want).

---

## Notifications

Targeted notifications with delivery receipts and real-time updates.

```tsx
const { notifications, markRead, dismiss } = useNotifications();
const unread = useUnreadCount();
```

**Targeting:** Broadcast to all, target by user, by user list, or by role.

**Receipt tracking:** seen/read/dismissed state per user per notification, with admin audit trail. Receipt actions use authenticated notification routes and then broadcast the updated receipt rows through sync.

**Pre-built UI:**

| Component | What it does |
|-----------|-------------|
| `<NotificationCenter>` | Full notification panel |
| `<NotificationDropdown>` | Dropdown with notification list |
| `<NotificationBadge>` | Unread count badge |
| `<NotificationItem>` | Individual notification with actions |
| `<NotificationList>` | Scrollable notification list |

**Auto-cleanup:** Scheduler job expires old notifications hourly.

---

## Storage

Authenticated drive and file storage with local filesystem blobs by default.

```tsx
const { drives } = useStorageDrives();
const { upload, progress } = useUpload();
const actions = useStorageActions();

await actions.createDrive('Reports');
await upload(driveId, file, { path: '/q2.pdf' });
```

**Access model:** storage HTTP routes use the same auth middleware as the rest
of the backend. Public drives/files can be read anonymously, but private reads
and all writes go through server-side permission checks.

**Frontend model:** storage hooks use the platform SDK client for auth. JSON
actions go through `client.fetch()` and multipart uploads use the SDK access
token with one refresh retry on 401 while preserving upload progress events.

**Sync model:** storage metadata tables are readable through sync for reactive
UI, but direct client `sync.mutate` writes to storage tables are blocked by
default. Use storage actions/routes for creates, uploads, permissions, and
visibility changes.

**Standalone server:** `createApp()` mounts storage automatically. If you mount
`createStoragePlugin()` yourself, mount `createAuthPlugin({ db })` first; the
storage plugin declares its own auth middleware dependency for typed
`authContext` and `requireAuth()`.

---

## Workflows — Durable Multi-Step Processes

Define workflows as step graphs with conditions, branching, retry with exponential backoff, event-based waiting, and crash recovery.

```tsx
const { workflow, steps } = useWorkflow(workflowId);
const { start, cancel, pause, resume, sendEvent } = useWorkflowActions();

await start('onboarding', { userId: 'alice' });
```

SQLite-backed — state survives server restart. Scheduler polls for retries and timeouts every minute.

---

## Schema System

Define your data model once, use it everywhere -- database tables, client sync, form generation, validation, DataTable columns.

```ts
import { defineTable, field } from '@platform/frontend';

export const todoTable = defineTable('todos', {
  title: field.text({ required: true, label: 'Title', placeholder: 'What needs done?' }),
  priority: field.select([
    { label: 'Low', value: 'low' },
    { label: 'Medium', value: 'medium' },
    { label: 'High', value: 'high' },
  ], { label: 'Priority', filterable: true }),
  due: field.date({ label: 'Due Date' }),
  done: field.boolean({ label: 'Complete' }),
  tags: field.tags({ label: 'Tags', maxTags: 5 }),
});

// Single tables export — both server and client auto-detect what they need
export const tables = { todos: todoTable };
```

**One schema drives:**
- `resolveConfig({ tables })` -- auto-extracts server DDL (SQLite)
- `<AppProvider tables={tables}>` -- auto-extracts client sync definitions
- `todoTable.schema.validate(data)` -- Valibot validation
- `<AutoForm schema={todoTable.schema} />` -- Full form with all field types
- `<DataTable schema={todoTable.schema} collection="todos" />` -- Full data table
- `<CrudPage table="todos" schema={todoTable.schema} columns={[...]} />` -- Full CRUD page
- `InferRow<typeof todoTable>` -- TypeScript type inference (no hand-written interfaces)

**18 field types:** text, email, url, password, number, boolean, select, multiSelect, textarea, date, datetime, dateRange, json, enum, tags, combobox, hidden. Each carries metadata for labels, placeholders, validation rules, table visibility, sortability, and filterability.

---

## Forms

### AutoForm — Zero-Config Form Generation

```tsx
<AutoForm
  schema={todoSchema}
  collection={client.collection('todos')}
  mode="create"
  layout="vertical"
  columns={2}
  card={{ title: 'New Todo', description: 'Add a task' }}
  onSuccess={() => toast.success('Created!')}
/>
```

Generates the full form from the schema: inputs, validation, error messages, submit/reset buttons. Supports create and edit modes. Grid layout with configurable columns. Optional Card wrapper.

### Wizard — Multi-Step Forms

```tsx
<Wizard
  schema={onboardingSchema}
  steps={[
    { fields: ['name', 'email'], title: 'Basics' },
    { fields: ['company', 'role'], title: 'Work' },
    { fields: ['avatar', 'bio'], title: 'Profile' },
  ]}
  onComplete={submitOnboarding}
/>
```

Per-step validation, animated transitions, progress bar with step indicators, back/next/complete navigation.

### useForm Hook — Full Control

```tsx
const form = useForm({
  schema: todoSchema,
  collection: 'todos',
  mode: 'create',
  onSuccess: () => navigate('/todos'),
});

return (
  <form onSubmit={form.handleSubmit}>
    {form.fieldNames.map(name => (
      <FieldRenderer
        key={name}
        name={name}
        meta={form.getFieldMeta(name)!}
        registration={form.register(name)}
      />
    ))}
    <Button type="submit" disabled={form.isSubmitting}>Save</Button>
  </form>
);
```

Per-field validation on blur, full validation on submit, dirty tracking, first-error focus, collection auto-save.

---

## DataTable

Full-featured data table with live collection binding.

```tsx
<DataTable
  schema={todoSchema}
  collection="todos"
  editable={['title', 'done', 'priority']}
  searchable
  sortable
  filterable
  paginated={{ pageSize: 25 }}
  actions={[
    { label: 'Delete', variant: 'destructive', onClick: (row) => remove(row.id) },
  ]}
/>
```

**Features:**
- **Live binding:** Point it at a collection name, it auto-updates as data changes
- **Inline editing:** Click a cell, edit in-place, Tab to next — changes sync instantly
- **Sorting/filtering:** Column headers with sort toggles and filter inputs
- **Row actions:** Dropdown menu per row with custom actions
- **Selection:** Checkbox selection with `onSelectionChange` callback
- **Pagination:** Configurable page size
- **Global search:** Filter across all columns
- **Animated transitions:** Smooth cell updates via framer-motion

### MasterDetailPage — List + Detail Layout

```tsx
<MasterDetailPage
  schema={userSchema}
  collection="users"
  listColumns={['name', 'email', 'role']}
  editableFields={['name', 'email', 'role', 'bio']}
  searchable
  paginated={{ pageSize: 20 }}
  detailHeader={({ item }) => <UserAvatar user={item} />}
  navigationActions={(user) => [
    { label: 'Message', icon: <Mail />, onClick: () => openChat(user) },
  ]}
/>
```

DataTable on the left, auto-generated edit form on the right. Click a row, the detail panel loads. Edit fields, changes sync to all clients. Responsive — detail panel slides up on mobile.

---

## UI Component Library

Full shadcn/ui set plus domain-specific components:

### Core Primitives (35 components)
Button (6 variants), Input, Label, Textarea, Select, Badge, Card (Header/Title/Description/Content/Footer), FormField (Label/Control/Description/Message), Table, ScrollArea, Separator, Skeleton, Avatar (with fallback), Breadcrumb, Pagination, Calendar, Command palette, Combobox (searchable), DatePicker, DateRangePicker, TagInput, StatCard, Chart, ValidationMeter, ValidationRules.

### Animated Components (174 components)
Built on framer-motion + radix-ui:

- **Buttons:** Standard, flip, liquid, ripple, copy, icon, GitHub stars, theme toggler
- **Radix primitives (animated):** Accordion, AlertDialog, Checkbox, Dialog, DropdownMenu, Files, HoverCard, Popover, PreviewLinkCard, Progress, RadioGroup, Sheet, Sidebar, Switch, Tabs, Toggle, ToggleGroup, Tooltip
- **Effects:** AutoHeight, Blur, Highlight, Particles, ThemeToggler
- **Text animations:** CountingNumber, ScrollingNumber, SlidingNumber
- **Backgrounds:** Bubble, Fireworks, Gradient, GravityStars, Hexagon, Hole, Stars
- **Community components:** FlipCard, ManagementBar, MotionCarousel, NotificationList, PinList, PlayfulTodolist, RadialIntro, RadialMenu, RadialNav, ShareButton, UserPresenceAvatar

### Layout Components
- `<ListDetailLayout>` — animated two-column split
- `<DetailPanel>` — right-side detail view
- `<RecordNavigationBar>` — toolbar with actions for the current record

---

## Routing

### File-Based Router (Server)

```
app/
  page.tsx          -> /
  layout.tsx        -> wraps all routes
  route.ts          -> API handlers (GET, POST, PUT, DELETE)
  not-found.tsx     -> 404 fallback
  todos/
    page.tsx        -> /todos
    [id]/
      page.tsx      -> /todos/:id
  (marketing)/      -> route group (no URL segment)
    about/
      page.tsx      -> /about
```

**Route modules export:**
- `default` — React component (page or layout)
- `loader` — server-side data loading
- `meta` — page metadata (title, description)
- `GET/POST/PUT/DELETE/PATCH` — API route handlers

**SSR:** Server renders pages with React, hydrates on the client. Build artifacts cached with 1-year max-age.

### Client Router
- `useRouter()` — `{ push, replace, back, prefetch, isNavigating }`
- `usePathname()` — current URL path
- `useParams()` — URL parameters
- History-based navigation via `pushState`
- Prefetch support for instant transitions

---

## Utility Hooks

| Hook | What it does |
|------|-------------|
| `useHotkey('mod+k', handler)` | Keyboard shortcuts (mod = Cmd/Ctrl) |
| `useConfirm()` | `await confirm({ title, description, variant })` |
| `useMobile()` | `boolean` — is viewport mobile width? |
| `useIsInView(ref)` | Intersection observer hook |
| `useAutoHeight(ref)` | Auto-resize textarea to content |

---

## What You Can Build

| App | Complexity | Platform Features |
|-----|-----------|-------------------|
| CRUD Admin Panel | ~20 lines | Schema + DataTable + AutoForm + Auth |
| Collaborative Todo | ~30 lines | Rooms + useRoomData + useCollection |
| Real-Time Dashboard | ~40 lines | useQuery + StatCard + Chart |
| Multiplayer Game | ~50 lines | Rooms + Ephemeral + Presence |
| Chat App | ~40 lines | Rooms + useRoomData + Presence |
| Live Whiteboard | ~30 lines | Ephemeral + Presence + Canvas |
| Multi-Step Onboarding | ~20 lines | Wizard + Schema + Auth |
| Notification Center | ~5 lines | NotificationCenter component |
| Document Editor | ~60 lines | Rooms + State Sync + Presence |

---

## Server Setup

```ts
// app/server.ts — the ONLY file that imports from @platform/server
import { resolveConfig, createApp } from '@platform/server';
import { tables } from './lib/schemas';

const config = resolveConfig({
  db: { mode: ':memory:' },
  tables,  // defineTable() output — auto-extracts server definitions
  auth: true,
  stateSync: true,
});

const app = createApp(config);
app.listen(3000);
```

This single call wires up: ReactiveDB, WebSocket sync, auth (JWT + user store), state sync, ephemeral KV, rooms, notifications, workflows, scheduler, file-based router, auto `/api/data` endpoint for lazy tables, SSR, and static file serving.

To make app-owned tables read-only or role-gated over direct sync writes, pass a `syncPolicy`. Platform defaults still compose with your policy using deny-wins semantics.

```ts
import { createDefaultSyncPolicy } from '@platform/sync';

const config = resolveConfig({
  db: { mode: ':memory:' },
  tables,
  auth: true,
  syncPolicy: createDefaultSyncPolicy({
    writeProtectedTables: ['audit_log'],
  }),
});
```

---

## Client Setup

The root layout provides `AppProvider` with the single `tables` object. No manual `createClient` call needed.

```tsx
// app/layout.tsx
import { AppProvider } from '@platform/frontend';
import { tables } from './lib/schemas';

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

```tsx
// In any page — useCollection is the primary mutation API
import { useCollection } from '@platform/frontend';

const { data: todos, insert, update, remove } = useCollection('todos');
insert({ title: 'Buy milk' });  // Auto-generates UUID PK
```

For imperative use outside React:

```ts
await client.login('alice', 'password123');
const { users } = await client.get('/api/admin/users');
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Bun |
| Server | Elysia |
| Database | bun:sqlite (synchronous, in-process) |
| Real-time | Bun WebSocket pub/sub |
| Client state | @xstate/store |
| Validation | Valibot |
| Styling | Tailwind CSS |
| UI primitives | Radix UI |
| Animation | Framer Motion |
| Icons | Lucide React |

Everything runs in one process. Zero network hops between components. SQLite write -> onChange -> pub/sub broadcast completes synchronously before yielding the event loop.

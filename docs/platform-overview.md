# Platform Overview

A full-stack reactive application framework that ships as a single Bun binary. One import, one server, everything in-process. No microservices, no Redis, no external queue. SQLite + WebSockets + React — wired end to end.

For the practical app setup path, start with [Start Here](./start-here.md).

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

**Sync policy:** The client sends bearer auth in the first WebSocket message,
never in the URL, and waits for `sync.auth.ready` before subscribing. Readable
tables are derived from `SyncPolicy.canReadTable`; direct client writes are
checked separately through `canMutateTable`, `canInsert`, `canUpdate`, and
`canDelete`. Auth-enabled apps default to required sync auth. Connected sockets
periodically re-resolve account and property-derived read policy, closing when
permissions change. `createApp()` protects service-owned platform tables from
direct sync mutation by default, while app-owned tables keep the fast
optimistic write path unless you configure stricter policy. If an app table is
registered with `defineResource()`, WebSocket sync also enforces resource
policy: unconstrained `list` policies use the normal fast path, row-constrained
lists use per-connection row filters, and direct `sync.mutate` writes evaluate
resource create/update/delete policy.

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
- **Persistent browser sessions:** coordinated refresh-token restore,
  `isRestoring`, 401 retry, sync reconnect with fresh tokens, and safe login
  return paths
- **Role-based middleware:** `requireAuth()` and `requireAdmin()` — fully typed, zero casts
- **User properties:** arbitrary KV per user (`setProperty`, `getProperty`)
- **Platform tokens:** generic one-time action tokens plus resumable public-flow tokens
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
| `<LoginForm>` | Username/email login with auth config-aware links and lifecycle error states |
| `<RegisterForm>` | Registration with field selection, password strength meter, and policy-aware loading/closure states |
| `<ForgotPasswordForm>` | SDK-backed password reset email request with policy-aware loading/disabled states |
| `<EmailVerificationForm>` | Email verification link/token flow that signs users in after verification |
| `<PasswordActionForm>` | Reset/setup password flow for valid emailed action tokens |
| `<ChangePasswordForm>` | Current-user password change form |
| `<UserPropertiesForm>` | Current-user editable property settings from `/auth/config` |
| `<MFAContinuation>` | Shared MFA setup/challenge branch for incomplete auth responses |
| `<MFAEnrollmentForm>` | Email OTP or authenticator enrollment flow |
| `<MFAChallengeForm>` | Login MFA challenge verification flow |
| `<MFAManagementPanel>` | Current-user MFA status and setup panel |
| `<OTPVerification>` | OTP input with auto-focus |
| `<QRCode>` | Token-aware QR primitive used for authenticator setup |
| `<PasswordInput>` | Password field with show/hide toggle |
| `<PasswordStrength>` | Real-time password strength indicator |
| `<SocialLoginGroup>` | Google, GitHub, Microsoft, Apple OAuth buttons |
| `<AuthLayout>` | Tokenized centered auth page shell with logo/image slot, static backgrounds, responsive form card, and shared full-card entrance motion |
| `<SignedIn>` / `<SignedOut>` | Auth-state visibility gates |
| `<PropertyGate>` / `<HasFlag>` | UI-only visibility gates based on current-user properties |
| `<Gate allow={['admin']}>` / `<AdminGate>` | Role-based conditional rendering |

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
import { StorageManagement } from '@zero/framework/react';

export function FilesPanel() {
  return <StorageManagement className="h-[42rem]" />;
}
```

Or compose the lower-level hooks yourself:

```tsx
const { drives } = useStorageDrives();
const { upload, progress } = useUpload();
const { capabilities } = useDriveCapabilities(driveId);
const actions = useStorageActions();

await actions.createDrive('Reports');
await upload(driveId, file, { path: '/q2.pdf' });
```

**Access model:** storage HTTP routes use the same auth middleware as the rest
of the backend. Public drives and public objects can be read anonymously, but
private reads and all writes go through server-side permission checks. Drives
support owner access plus explicit grants by role, exact user ID, or trusted
auth user-property key/value. The drive list and `useDriveCapabilities()` expose
effective `read`, `write`, and `admin` capabilities so UI can disable controls
without duplicating backend policy.
For public intake or resume-token flows, backend code can create scoped upload
grants with `zero.storage.uploads.create()`. Those grants allow a browser to
upload one file to one path without granting read access or opening the drive.

**Admin UI:** `StorageManagement` is a full dashboard organism. It lists
accessible drives, shows effective access, manages settings, lists/adds/revokes
permission grants, browses files, filters/sorts folders, uploads through
`StorageDropzone`, and creates presigned download links for protected files.

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
`authContext` and `requireAuth()`. Apply `installAuthStopBarrier()` to the final
standalone Elysia app so `await app.stop()` joins auth delivery before the
composition root disposes its injected database. `createApp()` already owns
that lifecycle ordering. All active `createApp()` instances share one
SIGINT/SIGTERM dispatcher; normal stops unregister from it, and a process signal
joins every registered app before one final exit.

---

## Platform Tokens

`createApp()` mounts a generic token service for secure links and public
continuation flows. Use action tokens for consume-once verification or approval
links, and resume tokens for long forms that users may continue later.

```ts
const verification = zero.tokens?.createActionToken({
  purpose: 'intake.email.verify',
  subject: { type: 'intake-draft', id: draftId },
  scope: 'clinic-intake',
  ttl: '30m',
});

const resume = zero.tokens?.createResumeToken({
  flow: 'clinic-intake',
  resource: { type: 'intake-draft', id: draftId },
  ttl: '14d',
});
```

Tokens are hash-only in SQLite, emit through observability, and are available
from `zero.tokens`, `getPlatformTokenService()`, and `@zero/framework/tokens`.
See [Platform Tokens](./tokens.md).

---

## Platform KV/Cache

`createApp()` mounts a server-side KV/cache service by default. It is
memory-first for active reads and uses journal/checkpoint files under
`./data/kv` for restart recovery.

```ts
await zero.kv?.set('intake:draft:123', formState, { ttlMs: 14 * 24 * 60 * 60 * 1000 });
await zero.counter?.increment('intake:draft-saves');

const allowed = await zero.limiter?.fixedWindow('email:verify:ip:1.2.3.4', {
  limit: 5,
  windowMs: 60_000,
});
```

Use it for server cache values, counters, rate limits, workflow coordination,
and recoverable app scratch state. Use SQL, object storage, or vector storage
when data should be queried relationally, stored as files, or searched by
embedding. See [Platform KV/cache](./kv.md).

---

## Vector Store

Local zvec-backed vector storage is available when enabled with
`createApp({ vector })`. It stores app-owned embeddings, text, and metadata in
process without a separate vector server.

```ts
import { createAIVectorBridge, getAI, getVectorStore } from '@zero/framework/server';

const ai = getAI();
const vectors = getVectorStore();
if (!ai || !vectors) throw new Error('AI/vector services are not enabled.');

const docs = createAIVectorBridge({ ai, vectors })
  .scope('knowledge', { bucket: 'docs' });

await docs.embedAndUpsert({
  id: 'docs:chunk-1',
  text: 'Zero combines AI embeddings with local vector search.',
});
```

The vector service owns storage and search only. AI owns embeddings. Scoped
helpers make bucket, tenant, room, or session isolation simple without forcing
a multi-tenant auth model into every app. Persisted zvec collections recover
through zvec's native WAL when Zero reopens an existing index path. See
[Vector Store](./vector.md).

---

## PDF Rendering

Zero can render modern HTML and print CSS into PDF without a separate Python
service or internal HTTP hop. Enable `pdf: true`, install the pinned Chromium
runtime with `bun run pdf:install`, and call the server-only `zero.pdf` service
from an endpoint, workflow, job, or app service.

```ts
const document = await zero.pdf?.renderToStorage(
  {
    html: '<article class="consent">...</article>',
    css: '@page { size: Letter; margin: 0.5in; }',
    document: { title: 'Consent to treatment' },
  },
  {
    driveId: 'patient-documents',
    path: `/intakes/${intakeId}/consent.pdf`,
    public: false,
  }
);
```

The default Chromium adapter supports Grid, Flexbox, web fonts, print media,
CSS page sizing, page breaks, backgrounds, headers/footers, and tagged PDFs.
Rendering is bounded by input/output, timeout, concurrency, and queue limits.
Remote resources and JavaScript are denied by default, and no public PDF route
is mounted. See [PDF Rendering](./pdf.md).

---

## Workflows — Durable Versioned Graphs

Register trusted, versioned activities and code definitions with
`AppConfig.workflows.register`. The small TypeScript DSL covers ordered steps,
persisted choices, concurrent branches with deterministic joins, bounded
per-item fan-out, durable event waits, and channel-neutral human/external
interactions. It compiles into the same canonical JSON graph used by immutable
database versions, the admin API, agents, and future visual editors. A database
definition can invoke only activities explicitly registered with
`databaseCallable: true`; publication also validates schema snapshots and
rejects output references that are not guaranteed on every path to their
consumer.

```tsx
const {
  instance,
  steps,
  activeSteps,
  interactions,
  isWaitingForInput,
  isRunningInParallel,
} = useWorkflow(workflowId);
const { start, submitResponse } = useWorkflowActions();

await start(
  'onboarding',
  { userId: 'alice' },
  { version: 2 },
);

const approval = interactions.find((item) => item.status === 'open');
if (approval) {
  await submitResponse(
    approval.instance_id,
    approval.interaction_id,
    { approved: true },
  );
}
```

Workflow definitions and each new run are fingerprinted and pinned to immutable
history. SQLite/ReactiveDB stores topology decisions, item snapshots, attempt
fences, deadlines, open interactions, and private `ctx.memory`; recovery
validates that state before re-driving work. Activity scratch writes commit
atomically with successful node completion, while external effects use the
stable `ctx.idempotencyKey` for at-least-once safety.

Durable runtime JSON values are capped at 1 MiB. Persisted run/step/fan-out,
scratch-memory, interaction-definition, and interaction-response values share
a 32 MiB per-run budget; each interaction also has bounded unique-submission
and byte totals. Durable event delivery has separate per-run pending and
retained count/byte quotas. Pass storage IDs through the graph instead of
embedding large files or unbounded event streams.

Human/external responses default to the workflow starter. Apps that need
Guardian organization or role decisions can install one fail-closed
`workflows.interactionAuthority` adapter for both direct and event-delivered
responses. A direct response submitted while paused fails with retryable
`WORKFLOW_DRAINING` and must be retried after resume; named events can remain
buffered during the pause. Event actor roles/claims are authenticated send-time
snapshots for restart parity, so policies that require current membership or
revocation state must reload it inside the authority callback.

Authorized clients receive safe `workflow_instances`, `workflow_steps`,
`workflow_events`, and `workflow_interactions` changes over ReactiveDB Sync,
so they can watch nodes, branches, fan-out items, retries, and waits in real
time without polling. Executable graph JSON, memory, interaction bodies, and
other coordination state stay server-only; graph event payloads and all graph
instance/step input, output, and raw error values are redacted from browser
projections. See
[Durable Workflows](./workflows.md).

---

## Schema System

Define your data model once, use it everywhere -- database tables, client sync, form generation, validation, DataTable columns.

```ts
import { defineTable, field } from '@zero/framework/react';

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

Generates the full form from the schema: inputs, validation, error messages, submit/reset buttons. Supports create and edit modes. Grid layout with configurable columns. Optional Card wrapper. `collection` can be a collection object or table name, and boolean fields can use the animated switch renderer with `fields={{ enabled: { useSwitch: true } }}`.

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

Per-field validation on blur, full validation on submit, structural dirty tracking for arrays/plain objects, first-error focus, and collection auto-save. Custom-submit forms can omit `collection` and use `onSubmit` without requiring `AppProvider`.

---

## DataTable / DataTableView

Schema-aware data table built on TanStack Table, with first-class Zero data
sources. See the full guide in [DataTableView](./frontend/data-table.md).

```tsx
<DataTableView
  schema={todoSchema}
  collection="todos"
  editable={['title', 'done', 'priority']}
  searchable
  sortable
  filterable
  paginated={{ pageSize: 25 }}
  actions={[
    { label: 'Delete', variant: 'destructive', onClick: (row) => remove(row.todo_id) },
  ]}
/>
```

Full-sync tables use `collection="todos"` and write inline edits back through
the reactive DB automatically. Lazy tables can fetch through Zero's `/api/data`
endpoint without hand-writing a hook; when the table is a registered resource,
its `list` policy is enforced on those reads too:

```tsx
<DataTableView
  schema={auditLogSchema}
  source={{
    type: 'lazy',
    table: 'audit_log',
    filters: { user_id: userId },
    options: { order: 'created_at', dir: 'desc', limit: 100 },
  }}
  columns={['created_at', 'event', 'severity']}
  searchable
  filterable
/>
```

Caller-owned data stays simple:

```tsx
<DataTableView
  schema={reportSchema}
  data={rows}
  columns={['name', 'total']}
  onCellEdit={(id, field, value) => updateReportRow(id, { [field]: value })}
/>
```

**Features:**
- **Live binding:** Point it at a collection name, it auto-updates as data changes
- **Lazy backend reads:** Use `source={{ type: 'lazy', table }}` for `/api/data` with sync/resource policy enforcement
- **Inline editing:** Click a cell, edit in-place, Tab to next — changes sync instantly
- **Sorting/filtering:** Column headers with sort toggles and filter inputs
- **Composable toolbar:** Search, filters, export, column visibility, and app actions can be shown independently
- **Row actions:** Dropdown menu per row with custom actions
- **Selection:** Checkbox selection with `onSelectionChange` callback
- **Pagination:** Configurable page size
- **Global search:** Filter across all columns
- **Column overrides:** Override labels, renderers, widths, sorting, filtering, and editability
- **Animated transitions:** Smooth cell updates via Motion

### KanbanBoard

`KanbanBoard` provides a tokenized drag-and-drop board for records grouped by
caller-owned columns. Use it for pipelines, task boards, queues, intake triage,
and workflow lanes. It is controlled, so apps persist drops through
`onItemMove` with `useCollection().update()` or another data source.

```tsx
<KanbanBoard
  columns={columns}
  items={tasks}
  getColumnId={(column) => column.id}
  getColumnTitle={(column) => column.title}
  getItemId={(task) => task.id}
  getItemColumnId={(task) => task.column_id}
  getItemTitle={(task) => task.title}
  onItemMove={(move) => updateTask(move.itemId, { column_id: move.toColumnId })}
/>
```

See [KanbanBoard](./frontend/kanban.md) for reactive DB wiring and source-copy
usage.

### MasterDetailView / MasterDetailPage — List + Detail Layout

See the full organism and low-level detail primitive guide in
[MasterDetailView](./frontend/master-detail.md).

```tsx
<MasterDetailView
  schema={userSchema}
  collection="users"
  listColumns={['name', 'email', 'role']}
  editableFields={['name', 'email', 'role', 'bio']}
  searchable
  paginated={{ pageSize: 20 }}
  detailHeader={({ item }) => <UserAvatar user={item} />}
  navigationActions={(user) => user ? [
    { label: 'Message', icon: <Mail />, onClick: () => openChat(user) },
  ] : []}
/>
```

DataTable on the left, auto-generated edit form on the right. Click a row, the detail panel loads. Edit fields, changes sync to all clients. Responsive — detail panel slides up on mobile.

For full-sync tables, `collection="users"` is the fastest path: the component
subscribes once through the reactive DB, feeds both the list and detail panel,
and writes detail-form updates back to the collection unless `onUpdate` is
provided.

For lazy tables, use the same source contract as `DataTableView` so
`MasterDetailView` can issue the bounded `/api/data` read and keep loaded rows
live:

```tsx
<MasterDetailView
  schema={userSchema}
  source={{
    type: 'lazy',
    table: 'users',
    filters: { department: 'ops' },
    options: { limit: 100, order: 'created_at', dir: 'desc' },
  }}
  listColumns={['name', 'email', 'role']}
/>
```

Use `renderDetail` when the right panel should be a custom read model instead
of the generated form:

```tsx
<MasterDetailView
  schema={clientSchema}
  collection="clients"
  listColumns={['name', 'status']}
  renderDetail={(client, ctx) => (
    <ClientOverview client={client} onArchive={() => ctx.update({ status: 'archived' })} />
  )}
/>
```

---

## UI Component Library

Full shadcn/ui set plus domain-specific components:

Zero's platform stylesheet is generated by `createApp()` and linked into SSR
HTML automatically. The default token contract supports light, dark, and system
themes through `ThemeProvider`, and `ThemeTogglerButton` provides the animated
mode switch.

The browser client entry and route manifest are generated into `.zero/generated`
before bundling. This keeps app-owned route glue outside framework source and is
the first step toward package-mode apps where Zero lives in `node_modules`.

### Core Primitives (35 components)
Button (6 variants), Input, Label, Textarea, Select, Badge, Card (Header/Title/Description/Content/Footer), FormField (Label/Control/Description/Message), Table, ScrollArea, Separator, Skeleton, Avatar (with fallback), Breadcrumb, Pagination, Calendar, Command palette, Combobox (searchable), DatePicker, DateRangePicker, TagInput, StatCard, Chart, ValidationMeter, ValidationRules.

### Animated Components (174 components)
Built on Motion + radix-ui:

- **Buttons:** Standard, flip, liquid, ripple, copy, icon, GitHub stars, theme toggler
- **Radix primitives (animated):** Accordion, AlertDialog, Checkbox, Dialog, DropdownMenu, Files, HoverCard, Popover, PreviewLinkCard, Progress, RadioGroup, Sheet, Sidebar, Switch, Tabs, Toggle, ToggleGroup, Tooltip
- **Effects:** AutoHeight, Blur, Highlight, Particles, ThemeToggler
- **Text animations:** CountingNumber, ScrollingNumber, SlidingNumber
- **Backgrounds:** Bubble, Fireworks, Gradient, GravityStars, Hexagon, Hole, Stars
- **Community components:** FlipCard, ManagementBar, MotionCarousel, NotificationList, PinList, PlayfulTodolist, RadialIntro, RadialMenu, RadialNav, ShareButton, UserPresenceAvatar

### Layout Components
- `<AppShell>` — app-ready dashboard/admin shell with Animate UI/Radix sidebar, optional breadcrumbs/header content, workspace switcher, nested nav, item action menus, and footer user menu
- `<AppShellBreadcrumbs>` — shell breadcrumb renderer backed by Zero's breadcrumb primitive
- Sidebar primitives — `SidebarProvider`, `Sidebar`, `SidebarInset`, `SidebarTrigger`, menu groups, nested menu, rail, and action slots for custom shells
- Public sections — `ResizableNavbar`, `Hero`, `FeaturesSection`, `CodeBlock`, `CtaSection`, `FooterSection`, `Faq`, `ExpandableCards`, `BentoGrid`, and `AnimatedList` for public websites, docs, landing pages, and content routes
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
// app/server.ts — the ONLY file that imports from @zero/framework/server
import { resolveConfig, createApp } from '@zero/framework/server';
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

This single call wires up: ReactiveDB, WebSocket sync, auth (JWT + user store),
state sync, platform KV/cache, ephemeral KV, rooms, notifications, workflows,
scheduler, file-based router, resource policy, auto `/api/data` endpoint for
lazy tables, SSR, and static file serving.

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
import { AppProvider } from '@zero/framework/react';
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

When auth is enabled, `AppProvider` also handles client-side auth loss on
protected routes. If a stored refresh token is rejected or an authenticated call
cannot refresh, it clears local synced data, removes protected route content,
and sends the user to `loginPath` with one safe, URL-encoded `redirect` return
path. The client can retain pathname, query, and fragment; direct server guards
retain pathname and query only. Once the login route is authenticated, that
deep link wins, then `postLoginPath` (default `/`) is the fallback.

`routeAuth`, `publicPaths`, `loginPath`, and `postLoginPath` come from
`createApp()` and can be overridden on the provider. Redirect values must be a
single bounded root-relative local URL. External, scheme-relative, malformed,
duplicate, recursive, backslash/control-character, and canonicalization-unsafe
values are ignored. Trailing-slash-equivalent login targets are treated as the
same route. An explicit same-route `postLoginPath` is rejected; the legacy
`loginPath: '/'` plus implicit `/` fallback remains a no-op.

`useAuth().isRestoring` is true only while a persisted browser session is being
refreshed and `/auth/me` is loading, and `AppProvider` withholds login UI during
that interval. Browsers with Web Locks serialize one-time refresh rotation per
Zero server across tabs and workers and reread the persisted token inside the
lock. The no-Web-Locks fallback coordinates only the current JavaScript realm.

```tsx
// In any page — useCollection is the primary mutation API
import { useCollection } from '@zero/framework/react';

const { data: todos, insert, update, remove } = useCollection('todos');
insert({ title: 'Buy milk' });  // Auto-generates UUID PK
```

For imperative use outside React:

```ts
await client.login('alice', 'password123');
const { users } = await client.listAuthAdminUsers();
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
| Icons | Animate UI animated Lucide icons via `@zero/framework/icons`; raw `lucide-react` only for missing shapes |

Everything runs in one process. Zero network hops between components. SQLite write -> onChange -> pub/sub broadcast completes synchronously before yielding the event loop.

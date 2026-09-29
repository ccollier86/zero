# Platform Overview

A full-stack reactive application framework whose deployment unit is a single
Bun binary with its services in-process. The normal shape is one server; file
mode also supports multiple runtimes sharing one local SQLite database for
durable Sync, State Sync, and authorization invalidation. No microservices,
Redis, or external queue are required. SQLite + WebSockets + React are wired end
to end.

For the practical app setup path, start with [Start Here](./start-here.md).

```
Browser (React)  <->  WebSocket /sync  <->  Bun Server (Elysia)
     SDK hooks          pub/sub              ReactiveDB (SQLite)
```

---

## Core Engine: ReactiveDB + Real-Time Sync

ReactiveDB changes can update eligible subscribed clients over WebSocket
without polling or manual invalidation. Delivery is not global: table policy,
resource policy, row filters, the requested subscription, and snapshot mode all
constrain what each connection may receive.

**How it works:**
1. Client calls `collection.insert(row)` — applies optimistically to local @xstate/store
2. Mutation sent over WebSocket as `sync.mutate`
3. Server checks sync mutation policy and writes a durably sequenced change to bun:sqlite (synchronous)
4. The ordered dispatcher evaluates the change for each eligible subscribed connection
5. Originating client gets `sync.ack` — confirms or rolls back the optimistic write
6. Other authorized subscribers receive the change, apply it to their local store, and React re-renders

**Auto/lazy sync for large tables:** Omitted table sync mode defaults to `auto`.
Startup counts rows, keeps small tables in full websocket snapshots, and
auto-resolves oversized tables to lazy sync. Tables with `_sync: 'lazy'` or a
resolved lazy mode skip the initial snapshot and load on demand via
`collection.load()` or `useLazyCollection()`. Live changes still stream once
rows are present locally.

**Retained-log reconnect:** If a client disconnects briefly, it sends its last
`seq` on reconnect. The server replays missed changes from the retained,
explicitly versioned SQLite `_changes` log (default 1000 positive entries).
`_zero_sync_log_state` owns its monotonic cursor and pruning watermark, while a
seq-0 sentinel fences pre-format binaries. File-mode runtimes sharing that
database also poll the same ordered log for each other's commits. A
retention/format/corruption gap closes the socket so reconnect receives an
authoritative replacement snapshot. First adoption of the fence requires the
documented stop-all upgrade in the release guide.

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
registered with `defineResource()` and exposed to Sync, WebSocket sync also
enforces resource policy: unconstrained `list` policies use the normal fast
path, row-constrained lists use per-connection row filters, and direct
`sync.mutate` writes evaluate resource create/update/delete policy. The
server-owned resource `exposure` value independently selects `internal`,
`http`, `sync`, or `all`; multi mode requires an explicit choice.

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
- **Persistent browser sessions:** refresh-token restore, 401 retry, sync reconnect with fresh tokens
- **Role-based middleware:** `requireAuth()` and `requireAdmin()` — fully typed, zero casts
- **Four additive profiles:** `single/simple`, `single/advanced`,
  `multi/simple`, and `multi/advanced` through one authorization kernel
- **Multi-tenant sessions and controls:** tenant selection/switching, member
  administration, invitations/join requests, and request-only verified domains
- **Platform administration:** protected Administration Organization,
  capability-gated people/invitations, customer-organization directory and
  lifecycle, plus read-only customer-member drill-in
- **Advanced RBAC:** app-declared permissions and static role templates with
  durable application/tenant assignments and packaged administration UI
- **Control-plane audit:** bounded append-only authorization/security events,
  authorized query/export, retention, hooks, and packaged viewer
- **User properties:** arbitrary KV per user (`setProperty`, `getProperty`)
- **Platform tokens:** generic one-time action tokens plus resumable public-flow tokens
- **React integration:** `useAuth()` returns full state + actions in one call
- **Top-level SDK access:** `client.login()`, `client.logout()`, `client.user` — no namespace required

See [Platform Administration Organization](./auth/platform-administration.md)
for the multi-mode bootstrap and operator control-plane contract.

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
| `<SocialLoginGroup>` | Caller-wired provider buttons; Zero supplies presentation, not social OAuth integration |
| `<AuthLayout>` | Tokenized centered auth page shell with logo/image slot, static backgrounds, responsive form card, and shared full-card entrance motion |
| `<SignedIn>` / `<SignedOut>` | Auth-state visibility gates |
| `<PropertyGate>` / `<HasFlag>` | UI-only visibility gates based on current-user properties |
| `<Gate allow={['admin']}>` / `<AdminGate>` | Role-based conditional rendering |
| `<PermissionGate>` / `<TenantGate>` / `<AdministrationScopeGate>` / `<PlatformAdminGate>` | Browser-safe visibility gates over the live authorization snapshot; server enforcement is still required |
| `<AuthFlowContinuation>` | Shared account-gate, tenant-selection/creation, invitation, and onboarding continuation |
| `<TenantSwitcher>` / `<TenantSelectionForm>` / `<TenantCreationForm>` | Refresh-proof-backed tenant scope selection and creation controls |
| `<TenantMemberManagement>` / `<TenantOnboardingManagement>` | Active-tenant member, role, invitation, and join-request administration |
| `<TenantDomainManagement>` / `<DomainOnboarding>` | Exact-domain claim administration and request-to-join onboarding |
| `<ApplicationAccessManagement>` | `single/advanced` application role administration |
| `<ControlPlaneAuditViewer>` | Authorized bounded tenant/platform control-plane audit view and export |

`SocialLoginGroup` renders caller-provided labels, icons, and click handlers.
Provider redirects, callbacks, account linking, and Google/GitHub/Microsoft/Apple
OAuth integration are not built in. `AdministrationScopeGate` requires the
active protected Administration Organization, while `PlatformAdminGate`
checks the separate legacy global identity-admin role; neither implies the
other.

Zero-owned hooks and the app subtree are fenced across account/tenant
replacement. App-owned caches can key or purge on the opaque,
credential-free `useAuthorizationScopeBoundary()` result and should hide
scope-sensitive UI while its `ready` flag is false. The key is cache metadata,
not server authority.

---

## State Sync — Per-Authorized-Scope User Persistent KV

Like `useState` but persisted on the server and synced across the user's
devices in the same authorization scope. Single mode keeps one per-user
keyspace; multi mode derives an independent tenant + user keyspace.

```tsx
function Sidebar() {
  const [open, setOpen] = useServerState('sidebar.open', true);
  return <button onClick={() => setOpen(!open)}>{open ? 'Close' : 'Open'}</button>;
}
```

Open the sidebar on your laptop, it opens on your phone in the same scope.
Optimistic writes are instant locally and persist in the background. SQLite is
authoritative; a file-mode database supports ordered state fanout across Zero
runtimes sharing that file. Limits are 64KB per value, 1,000 keys, and 10MB per
scoped user keyspace.

---

## Ephemeral KV — High-Frequency Shared State

Shared by connections that choose the same topic, with no persistence or
SQLite writes. It is pure RAM + pub/sub and fire-and-forget—no ack or rollback.
If an update is lost, the next one corrects it.

> **Current security boundary:** auth-enabled `createApp()` rejects
> unclassified topics. It reserves membership-checked
> `presence:<roomId>`/`typing:<roomId>` and user-owned
> `user:<currentUserId>:<name>` families; define `ephemeralPolicy` for other
> app topics. Authless standalone Sync retains unrestricted compatibility
> behavior. A raw caller-selected topic is never authority by itself.

The `poll:*` example below therefore assumes either an authless standalone
Sync plugin or an app `ephemeralPolicy` that derives and authorizes that poll
namespace from trusted server state.

```tsx
function LivePoll() {
  const [votes, setVotes] = useEphemeral('poll:best-framework', 'votes', {});
  const vote = (choice: string) => setVotes({ ...votes, [me.id]: choice });
}
```

**Built-in throttle** for high-frequency updates:
```tsx
import { usePresence, useThrottledCallback } from '@zero/framework/react';

function SharedCanvas({ roomId }: { roomId: string }) {
  const presence = usePresence(roomId);
  const publishCursor = useThrottledCallback((x: number, y: number) => {
    presence.update({ cursor: { x, y } });
  }, 66);

  return (
    <canvas
      onPointerMove={(event) => publishCursor(event.clientX, event.clientY)}
    />
  );
}
```

This sends cursor presence at roughly 15 fps without exposing the
provider-owned ephemeral client. The room hook also keeps the write inside the
built-in membership-checked topic and actor-owned key contract.

**Use cases:** Cursor positions, typing indicators, live poll votes, drag positions, game state during a match.

---

## Rooms — Collaborative Spaces

Membership-tracked collaboration primitives. The built-in room policy scopes
`rooms` and `room_members`; app-owned room content needs its own server-side
resource/Sync row and mutation policy.

```tsx
function GameLobby({ roomId }) {
  const { room, members } = useRoom(roomId);
  const moves = useRoomData<GameMove>(roomId, 'game_moves');
  const { insert } = useCollection('game_moves');

  const makeMove = (pos: number) => {
    // This table's server policy must validate membership and room_id.
    insert({ room_id: roomId, player: me.id, position: pos });
  };

  return <Board moves={moves} players={members} onMove={makeMove} />;
}
```

`useRoomData<T>(roomId, tableName)` is a client-side `useQuery` convenience
with a pre-applied `room_id` filter. It does **not** authorize the table, prove
membership, prevent a raw subscription, or validate writes. Declare a
server-side read-row policy and insert/update/delete policy for `game_moves`;
the server should validate or stamp `room_id`. Only then does the hook provide
the convenient collaborative view.

**Server:** `createRoomPlugin()` provides authenticated REST routes under
`/rooms`. Creating a room makes its creator the owner and first member. Reading
a room or its members requires membership; an unauthorized or missing room is
reported as `404` to avoid an ID oracle. The default `POST /rooms/:id/join`
does not admit arbitrary authenticated users—it only confirms an existing
membership. Apps implement invitation/domain/approval admission in trusted
server code with `RoomService.join()`, then the HTTP action is idempotent.
Non-owners may leave; the owner must delete the room and receives
`409 ROOM_OWNER_CANNOT_LEAVE` from `leave`. In `single`, the creator or global
admin may delete a room. In `multi`, the creator or a live tenant owner,
`allPermissions` role, or role with `rooms:manage` may delete it; a global
platform admin who is only a tenant member has no tenant room authority.
Unauthorized and cross-tenant IDs return the same `404` as missing IDs.

**Hooks:**

| Hook | Returns |
|------|---------|
| `useRoom(roomId)` | Room details + member list, live |
| `useRoomMembers(roomId)` | Just the member list |
| `useRooms(userId)` | All rooms user belongs to |
| `useRoomActions()` | `{ create, join, leave, deleteRoom }`; `join` confirms prior server-side admission |
| `useRoomData<T>(roomId, table)` | Client-side `room_id` filter; server policy still required |

---

## Presence — Who's Online

Built on ephemeral KV. Convention: topic `presence:{roomId}`, key
`user:{userId}`. Auto-heartbeat every 10s, auto-expire after 30s, disconnect =
gone. In managed authenticated apps, the server resolves the room through the
app-local `RoomService`, requires current membership, owns the `user:{userId}`
key, and prefixes the internal namespace with the validated application/tenant
scope. Authless standalone Sync retains its explicitly unrestricted legacy
topic behavior.

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

**Targeting:** Broadcast to all, target by user, by user list, or by role. In
`multi`, create/broadcast/target/audit/delete operations require live tenant
owner, `allPermissions`, or `notifications:manage` authority. A global
platform admin does not inherit that tenant authority. Role targets match the
complete current tenant-role assignment set, including additive advanced
roles; they never match `users.role` or a stale retained membership role.

**Receipt tracking:** seen/read/dismissed state per user per notification, with
an admin audit trail. Receipt actions use authenticated notification routes;
Sync projects an updated receipt row only to its owning user. The admin audit
trail is protected HTTP and must be refetched or polled for later changes.
Cross-tenant, unauthorized, and nonexistent notification IDs use
non-enumerating `404` responses once management authority is established.

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
In `multi`, owner and grant authority is limited to the active tenant. Role
grants use the complete live tenant assignment set in advanced mode; neither a
global platform-admin role nor the retained membership role is an implicit
grant. Guessed private drive or permission IDs outside the active tenant return
the same `404` as missing IDs. Explicitly public drive/object reads remain
public capabilities.
For public intake or resume-token flows, backend code can create scoped upload
grants with `zero.storage.uploads.create()`. Those grants allow a browser to
upload one file to one path without granting read access or opening the drive.

**Admin UI:** `StorageManagement` is a full dashboard organism. It lists
accessible drives, shows effective access, manages settings, lists/adds/revokes
permission grants, browses files, filters/sorts folders, uploads through
`StorageDropzone`, and creates presigned download links for protected files.

**Frontend model:** storage hooks use the platform SDK client for auth. JSON
actions go through `client.fetch()`, while multipart uploads obtain each
attempt's bearer from the same auth controller, wait for restoration, retry
once after a successful refresh, and abort on an account/tenant scope change
while preserving upload progress events.

**Sync model:** default `createApp()` keeps Storage drive/object metadata
private from generic Sync reads and blocks direct `sync.mutate` writes. The
official authenticated Storage hooks and actions/routes are the supported path
for listing, creates, uploads, permissions, downloads, and visibility changes.

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

## Workflows — Durable Multi-Step Processes

Define workflows as step graphs with conditions, branching, retry with exponential backoff, event-based waiting, and crash recovery.

```tsx
const { workflow, steps } = useWorkflow(workflowId);
const { start, cancel, pause, resume, sendEvent } = useWorkflowActions();

await start('onboarding', { userId: 'alice' });
```

SQLite-backed — state survives server restart. Each instance retains a private,
MAC-protected actor or explicit system-authority seal. Zero revalidates the
session/account/tenant/membership/role revision before dispatch and again before
accepting async output, so stale work cannot commit after authorization changes.
Scheduler polls for retries and timeouts every minute; those global scans do not
bypass the per-instance authority gate.

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

Generates the full form from the schema: inputs, validation, error messages, submit/reset buttons. Supports create and edit modes. Grid layout with configurable columns. Optional Card wrapper. `collection` can be a collection object or table name, and boolean fields can use the animated switch renderer with `fields={{ enabled: { useSwitch: true } }}`. `includeFields={resourceFields.create}` (or `.update`) restricts rendering, validation, and submitted data to one shared resource allow-list; `CrudPage resourceFields={resourceFields}` wires this automatically.

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
it must permit HTTP (`http` or `all`), and its `list` policy is enforced on
those reads too. Use `all` when the same resource also participates in lazy
Sync:

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
- **Lazy backend reads:** Use `source={{ type: 'lazy', table }}` for eligible `/api/data` tables with resource policy enforcement; registered resources must permit HTTP, and lazy Sync resources use `exposure: 'all'`
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
  schema={contactSchema}
  collection="contacts"
  listColumns={['name', 'email', 'role']}
  editableFields={['name', 'email', 'role', 'bio']}
  searchable
  paginated={{ pageSize: 20 }}
  detailHeader={({ item }) => <ContactAvatar contact={item} />}
  navigationActions={(contact) => contact ? [
    { label: 'Message', icon: <Mail />, onClick: () => openChat(contact) },
  ] : []}
/>
```

DataTable on the left, auto-generated edit form on the right. Click a row, the
detail panel loads. Edits sync to connections authorized for that app row.
Responsive — the detail panel slides up on mobile.

For full-sync app tables, `collection="contacts"` is the fastest path: the component
subscribes once through the reactive DB, feeds both the list and detail panel,
and writes detail-form updates back to the collection unless `onUpdate` is
provided.

For lazy tables, use the same source contract as `DataTableView` so
`MasterDetailView` can issue the bounded `/api/data` read and keep loaded rows
live:

```tsx
<MasterDetailView
  schema={contactSchema}
  source={{
    type: 'lazy',
    table: 'contacts',
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

const app = await createApp(config);
app.listen(3000);
```

This single call wires up: ReactiveDB, WebSocket sync, auth (JWT + user store),
state sync, platform KV/cache, ephemeral KV, rooms, notifications, workflows,
scheduler, file-based router, resource policy, auto `/api/data` endpoint for
eligible lazy tables, SSR, and static file serving.

To make app-owned tables read-only or role-gated over direct sync writes, pass a `syncPolicy`. Platform defaults still compose with your policy using deny-wins semantics.

```ts
import { createDefaultSyncPolicy } from '@zero/framework/sync';

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
cannot refresh, it clears the local synced data, removes protected route
content, and redirects to `loginPath` with a `redirect` query parameter.
`routeAuth`, `publicPaths`, and `loginPath` come from `createApp()` and can be
overridden on the provider.

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

Within one runtime, Zero's services communicate in-process with no component
network hop. Local commits enter the same ordered dispatcher synchronously;
file-mode peer runtimes observe committed rows by polling the shared SQLite
log. `hot`/`ephemeral` databases, separate files, and RAM-only ephemeral topics
remain process-local unless an application supplies external coordination.

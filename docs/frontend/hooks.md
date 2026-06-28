# Frontend Hooks

Zero exposes two hook layers from `@platform/frontend`:

1. Generic React hooks for common UI state and browser behavior.
2. Platform hooks that compose Zero auth, sync, storage, notifications, rooms, workflows, router, and server state.

Generic hooks live under `src/hooks`. Platform hooks live under `src/frontend/client` and delegate transport to the SDK client. Do not add `fetch()`, token reads, WebSocket protocol code, or backend authorization decisions to hooks.

## Generic Hooks

Import generic hooks from `@platform/frontend`:

```tsx
import {
  useAsyncAction,
  useClickAway,
  useCopyToClipboard,
  useDebouncedCallback,
  useDebouncedValue,
  useDisclosure,
  useHotkey,
  useIdle,
  useMediaQuery,
  useThrottledValue,
} from '@platform/frontend';
```

| Hook | Use it for |
|------|------------|
| `useAsyncAction(action, options?)` | Button/form action lifecycle: `pending`, `error`, `result`, `run`, `reset` |
| `useAutoHeight(deps?, options?)` | Measuring an element height for animated layout |
| `useConfirm()` | Promise-based confirmation UI inside `ConfirmProvider` |
| `useControlledState(props)` | Controlled/uncontrolled component internals |
| `useDataState(key, ref?, onChange?)` | Watching `data-*` attributes from low-level UI primitives |
| `useDebouncedCallback(callback, delayOrOptions)` | Delayed callbacks with `flush`, `cancel`, and `isPending` controls |
| `useDebouncedValue(value, delayMs)` | Search inputs, filters, and low-frequency derived state |
| `useDisclosure(options?)` | Dialog, drawer, popover, and expandable open/closed state |
| `useClickAway(handler, options?)` | Close menus, popovers, and dialogs when the user interacts outside a ref |
| `useCopyToClipboard(options?)` | Clipboard copy flows with copied/error state and automatic reset |
| `useHotkey(combo, handler, options?)` | Keyboard shortcuts such as `mod+k` and `escape` |
| `useIdle(timeoutMs?, options?)` | User inactivity detection for idle warnings, auto-lock UI, and paused polling |
| `useInterval(callback, delayMs, options?)` | Polling and repeated UI timers; pass `null` to pause |
| `useIsInView(ref, options?)` | Animation trigger state based on viewport visibility |
| `useIsMobile()` | Zero's default `<768px` mobile breakpoint |
| `useMediaQuery(query, options?)` | SSR-safe browser media queries |
| `useMounted()` | Hydration-sensitive UI that should render only after mount |
| `useMotionValueState(motionValue)` | Bridging Motion values into React render state |
| `useOs(options?)` | SSR-safe operating-system detection: `macos`, `ios`, `windows`, `android`, `linux`, `chromeos`, or `undetermined` |
| `usePrevious(value)` | Comparing the current render value with the previous one |
| `useStableCallback(callback)` | Stable event/timer callback identity with fresh logic |
| `useTextSelection()` | Current non-collapsed page text selection as `Selection | null` |
| `useThrottledCallback(callback, waitMs, options?)` | Rate-limited callbacks for scroll, resize, pointer, and fast input handlers |
| `useThrottledValue(value, waitMs?, options?)` | Rate-limited value projection for fast-changing UI state |
| `useTimeout(callback, delayMs)` | One-shot timers; pass `null` to pause |

`useDebouncedValue` remains the simple value helper. Use
`useDebouncedCallback` when the callback itself needs lifecycle controls:

```tsx
const search = useDebouncedCallback(
  (query: string) => results.setFilters({ q: query }),
  { delay: 300, maxWait: 1200 },
);

search('invoice');
search.flush();
```

Use throttle hooks when the first or latest value matters, but intermediate
updates can be dropped:

```tsx
const throttledPointer = useThrottledValue(pointer, 100);
const onResize = useThrottledCallback(recalculateLayout, 250);
```

Outside-click and clipboard helpers are built for composed UI primitives:

```tsx
function CopyMenu({ text }: { text: string }) {
  const menu = useDisclosure();
  const ref = useClickAway<HTMLDivElement>(menu.close, { enabled: menu.isOpen });
  const clipboard = useCopyToClipboard();

  return (
    <div ref={ref}>
      <button type="button" onClick={menu.toggle}>Menu</button>
      {menu.isOpen && (
        <button type="button" onClick={() => void clipboard.copy(text)}>
          {clipboard.copied ? 'Copied' : 'Copy'}
        </button>
      )}
    </div>
  );
}
```

`useIdle` intentionally reports browser inactivity only. Auth logout, session
refresh, and sensitive-route redirects remain auth/platform responsibilities:

```tsx
const idle = useIdle(60_000);
```

Zero also re-exports `use-stick-to-bottom` for AI chat, live logs, and streaming
feeds. Prefer this library over a custom scroll hook when a panel should stay
smoothly pinned to the newest content while still letting the user scroll away:

```tsx
import { StickToBottom, useStickToBottomContext } from '@platform/frontend';

function StreamPanel({ chunks }: { chunks: string[] }) {
  return (
    <StickToBottom className="relative h-96 overflow-hidden" resize="smooth" initial="smooth">
      <StickToBottom.Content className="space-y-2">
        {chunks.map((chunk, index) => (
          <p key={index}>{chunk}</p>
        ))}
      </StickToBottom.Content>
      <JumpToBottom />
    </StickToBottom>
  );
}

function JumpToBottom() {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  if (isAtBottom) return null;

  return (
    <button type="button" onClick={() => void scrollToBottom()}>
      Jump to latest
    </button>
  );
}
```

For custom layouts, use the library hook directly:

```tsx
const stick = useStickToBottom({ resize: 'smooth', initial: 'smooth' });

return (
  <div ref={stick.scrollRef} className="h-96 overflow-auto">
    <div ref={stick.contentRef}>{messages.map(renderMessage)}</div>
  </div>
);
```

### Async Actions

```tsx
function SaveButton({ save }: { save: () => Promise<void> }) {
  const action = useAsyncAction(save);

  return (
    <button disabled={action.pending} onClick={() => void action.run()}>
      {action.pending ? 'Saving...' : 'Save'}
    </button>
  );
}
```

`useAsyncAction` stores errors and re-throws them from `run()` so callers can still use normal `try/catch` when needed.

### Disclosure State

```tsx
const details = useDisclosure();

return (
  <>
    <button onClick={details.open}>Open</button>
    <Dialog open={details.isOpen} onOpenChange={details.setOpen} />
  </>
);
```

Use `open` and `onOpenChange` when a component needs controlled state.

## Platform Hooks

Platform hooks require `AppProvider` or `ClientProvider` in the browser. They are SSR-safe unless their docs say otherwise.

| Area | Hooks |
|------|-------|
| Client | `useClient`, `useClientMaybe`, `useIsServer` |
| Auth | `useAuth`, `useAuthConfig`, `useCurrentUser`, `useRequireAuth`, `useUserProperty` |
| Reactive data | `useCollection`, `useLazyCollection`, `useDataPage`, `useRow`, `useRecord`, `useRecordByIdentity`, `useQuery`, `useStatus` |
| Data UI state | `useDataSelection` |
| Mutations/health | `useMutation`, `useConnectionHealth` |
| Server state | `useServerState`, `useServerStateReady`, `usePreference`, `useFormDraft` |
| Router | `useParams`, `usePathname`, `useRouter` |
| Notifications | `useNotifications`, `useUnreadCount`, `useOnNewNotification`, `useNotificationContext` |
| Rooms/presence | `useRoom`, `useRoomMembers`, `useRooms`, `useRoomActions`, `useRoomData`, `usePresence`, `usePresenceList`, `useTypingIndicator` |
| Ephemeral KV | `useEphemeral`, `useEphemeralTopic` |
| Storage | `useUpload`, `useUploadQueue`, `useUploadDropzone`, `useStorageFile`, `useStorageFolder`, `useStorageBrowser`, `useStorageDrives`, `useDriveUsage`, `useDriveQuota`, `usePresignedUrl`, `useStorageActions` |
| Workflows | `useWorkflow`, `useWorkflowList`, `useWorkflowActions`, `useWorkflowRun` |
| Components | `useForm`, `useDataTable`, `useDataTableSource`, `useAdminUsers` |

Zero keeps existing platform hooks as canonical instead of adding duplicate
aliases. Use `useDataPage` for paged `/api/data` screens, `useRecord` /
`useRecordByIdentity` for detail records, `useWorkflowRun` for start-and-watch
workflow UI, and `useNotifications` for notification lists and counts.

### Data Screens

`useDataPage(table, options?)` manages `/api/data` pagination, filters, sorting,
loading/error state, and refresh in one hook:

```tsx
const clients = useDataPage<ClientRow>('clients', {
  filters: { status: 'active' },
  sort: { field: 'created_at', dir: 'desc' },
  pageSize: 50,
});

return (
  <DataTableView
    data={clients.rows}
    loading={clients.loading}
    onNextPage={clients.hasMore ? clients.nextPage : undefined}
  />
);
```

Filters support the same operators as `/api/data`:

```tsx
clients.setFilters({
  department: ['ops', 'finance'],
  created_at: { op: 'gte', value: '2026-01-01' },
});
```

Use `useRecord(table, id)` when detail screens need one row plus update/delete
actions:

```tsx
const client = useRecord<ClientRow>('clients', clientId);
client.update({ status: 'active' });
```

Use `useRecordByIdentity(table, identity)` for relational/natural identity
tables:

```tsx
const membership = useRecordByIdentity('memberships', {
  team_id: teamId,
  user_id: userId,
});

membership.upsert({ team_id: teamId, user_id: userId, role: 'admin' });
```

This uses Zero's deterministic natural-identity sync ID support while keeping
the platform's single-column sync primary-key invariant.

`useDataSelection(rows, options?)` owns reusable selected-row state for tables,
detail views, and bulk actions:

```tsx
const selection = useDataSelection(clients.rows, {
  getId: (client) => client.client_id,
});

return (
  <DataTableView
    data={clients.rows}
    selectedIds={selection.selectedIds}
    onRowClick={selection.toggle}
  />
);
```

### Mutations And Health

`useMutation(action, options?)` wraps SDK-backed commands with pending, result,
and error state. Caught failures emit through frontend observability by default:

```tsx
const save = useMutation(
  () => client.post('/api/settings', values),
  { metadata: { form: 'settings' } },
);

<button disabled={save.pending} onClick={() => void save.run()}>
  Save
</button>
```

`useConnectionHealth()` gives app-ready sync/auth state:

```tsx
const health = useConnectionHealth();

if (!health.connected || health.pendingMutations > 0) {
  return <SyncBanner pending={health.pendingMutations} />;
}
```

### Preferences And Drafts

`usePreference(key, defaultValue)` is a named wrapper over `useServerState` for
user preferences:

```tsx
const density = usePreference('tableDensity', 'compact');
density.setValue('comfortable');
```

`useFormDraft(key, initialValue)` persists object-shaped form drafts per user:

```tsx
const draft = useFormDraft('client-intake', {
  name: '',
  email: '',
});

draft.setField('email', 'person@example.com');
```

Both require `stateSync: true` on the server and `AppProvider`.

### Storage Workflows

`useUploadQueue()` handles multi-file upload state on top of `useUpload()`:

```tsx
const queue = useUploadQueue();
await queue.uploadFiles(driveId, files, {
  resolvePath: (file) => `/invoices/${file.name}`,
});
```

`useUploadDropzone()` wires `react-dropzone` to the same upload queue and
stores every accepted file at `path/file.name`:

```tsx
const dropzone = useUploadDropzone({
  driveId,
  path: '/invoices',
  accept: { 'application/pdf': ['.pdf'] },
  overwrite: true,
});

return (
  <div {...dropzone.dropzone.getRootProps()}>
    <input {...dropzone.dropzone.getInputProps()} />
  </div>
);
```

Use the ready component when you want the default Zero UI:

```tsx
<StorageDropzone
  driveId={driveId}
  path="/invoices"
  accept={{ 'application/pdf': ['.pdf'] }}
/>
```

`useStorageFile(driveId, path)` loads one file/folder metadata record and
returns `url`, `remove()`, `setVisibility()`, and `refresh()`:

```tsx
const file = useStorageFile(driveId, '/invoices/acme.pdf');

return file.file ? <a href={file.url ?? undefined}>{file.file.name}</a> : null;
```

`useStorageBrowser(driveId, initialPath?)` provides folder navigation, selection,
upload queue, and common file actions:

```tsx
const browser = useStorageBrowser(driveId);

browser.openFolder('projects/alpha');
await browser.createFolder('contracts');
await browser.uploadFiles(files);
```

`useDriveQuota(driveId)` derives `percentUsed`, `nearLimit`, `overLimit`, and
`unlimited` from drive usage.

### Presence And Typing

`usePresence(roomId, data?)` is the low-level room presence primitive.
`usePresenceList(roomId, options?)` filters stale users and returns display
labels for presence UI:

```tsx
const presence = usePresenceList(roomId, {
  includeSelf: false,
  data: { label: currentUser.username },
});

presence.members.map((member) => member.label);
```

`useTypingIndicator(scope, options?)` publishes ephemeral typing state with a
short TTL and returns the other users currently typing:

```tsx
const typing = useTypingIndicator(`thread:${threadId}`);

<textarea onChange={() => typing.markTyping()} />

{typing.isAnyoneTyping && (
  <span>{typing.typingUsers.map((user) => user.label).join(', ')} typing</span>
)}
```

Typing state is never persisted. It requires `AppProvider`/`SyncProvider` and
the underlying sync connection.

### Workflow Runs

`useWorkflowRun(name, options?)` starts a workflow and watches its live synced
instance/step progress:

```tsx
const report = useWorkflowRun('generate-report');

await report.start({ clientId });

return <Progress value={report.progress.percent} />;
```

### User Properties

`useUserProperty(key, options?)` reads and updates one current-user KV property:

```tsx
function ThemeToggle() {
  const theme = useUserProperty('theme', {
    defaultValue: 'system',
  });

  return (
    <select
      value={theme.value ?? 'system'}
      onChange={(event) => void theme.setValue(event.target.value)}
    >
      <option value="system">System</option>
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </select>
  );
}
```

User property writes still go through the auth backend. If a property is configured as admin-only, system-only, or non-editable, the server rejects user writes. UI gates and `useUserProperty` are convenience tools, not security boundaries; protect sensitive data and actions in backend policies/plugins.

Typed parsing is opt-in:

```tsx
const compactMode = useUserProperty('compactMode', {
  defaultValue: false,
  parse: (value) => value === 'true',
  serialize: (value) => value ? 'true' : 'false',
});
```

## Responsibility Boundaries

Hooks should:

- Return stable, predictable UI state.
- Be SSR-safe when exported from `@platform/frontend`.
- Compose SDK/auth/sync clients instead of duplicating transport.
- Keep optimistic state and server reconciliation clear.

Hooks should not:

- Read auth tokens from browser storage.
- Call AI/storage/auth providers directly when an SDK method exists.
- Treat frontend visibility gates as authorization.
- Own Elysia route behavior or server policy.

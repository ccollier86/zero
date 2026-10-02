# Frontend Hooks

Zero exposes two hook layers from `@zero/framework/react`:

1. Generic React hooks for common UI state and browser behavior.
2. Platform hooks that compose Zero auth, sync, storage, notifications, rooms, Torrent workflows, router, and server state.

Generic hooks live under `src/hooks`. Platform hooks live under `src/frontend/client` and delegate transport to the SDK client. Do not add `fetch()`, token reads, WebSocket protocol code, or backend authorization decisions to hooks.

## Generic Hooks

Import generic hooks from `@zero/framework/react`:

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
} from '@zero/framework/react';
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
import { StickToBottom, useStickToBottomContext } from '@zero/framework/react';

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
| Auth | `useAuth`, `useAuthConfig`, `useCurrentUser`, `useRequireAuth`, `useUserProperty`, `useAuthorization`, `useAuthorizationScopeBoundary`, `useHasPermission`, `useHasAllPermissions`, `useHasAnyPermission`, `useApplicationAccess`, `usePlatformAdministration`, `usePlatformTenants`, `useAuthAudit`, `useTenantMembers`, `useTenantOnboardingAdministration`, `useTenantDomainAdministration`, `useDomainOnboarding`, `useTenantSwitcher`, `useTenantAppShellWorkspaces` |
| Reactive data | `useCollection`, `useLazyCollection`, `useDataPage`, `useRow`, `useRecord`, `useRecordByIdentity`, `useQuery`, `useStatus` |
| Resources | `useResourceClient`, `useResourceList`, `useResourceRecord`, `useResourceActions` |
| Data UI state | `useDataSelection` |
| Mutations/health | `useMutation`, `useConnectionHealth` |
| Server state | `useServerState`, `useServerStateReady`, `usePreference`, `useFormDraft` |
| Router | `useParams`, `usePathname`, `useRouter` |
| Notifications | `useNotifications`, `useUnreadCount`, `useOnNewNotification`, `useNotificationContext` |
| Rooms/presence | `useRoom`, `useRoomMembers`, `useRooms`, `useRoomActions`, `useRoomData`, `usePresence`, `usePresenceList`, `useTypingIndicator` |
| Ephemeral KV | `useEphemeral`, `useEphemeralTopic` |
| Storage | `useUpload`, `useUploadQueue`, `useUploadDropzone`, `useStorageFile`, `useStorageFolder`, `useStorageBrowser`, `useStorageDrives`, `useDriveCapabilities`, `useStoragePermissions`, `useDriveUsage`, `useDriveQuota`, `usePresignedUrl`, `useStorageActions` |
| Torrent workflows | `useWorkflow`, `useWorkflowTopology`, `useWorkflowList`, `useWorkflowActions`, `useWorkflowRun` |
| Components | `useForm`, `useDataTable`, `useDataTableSource`, `useAdminUsers` |

Zero keeps existing platform hooks as canonical instead of adding duplicate
aliases. Use `useDataPage` for paged `/api/data` screens, `useRecord` /
`useRecordByIdentity` for detail records, `useWorkflowRun` for start-and-watch
workflow UI, `useWorkflowTopology` for a pinned run map, `useResourceList` for
generated resource CRUD screens, and
`useNotifications` for notification lists and counts.

The new Auth control-plane hooks share one caught-failure reporter. Current
loads and mutations emit `FRONTEND_AUTH_ACTION_FAILED` with only the bounded
action family and safe machine code before exposing their normal hook error
state; stale work rejected by a scope-generation fence is not reported as a
current failure. See
[Auth Operational Failure Contract](../observability.md#auth-operational-failure-contract).

Public auth config has deliberately different reactive and imperative failure
contracts. `useAuthConfig()` exposes `unknown`/`loading`/`ready`/`error` state,
and its `reload()` is nonthrowing so components render or retry from that
snapshot. `useAuth().getConfig()` forces the same client-scoped, fenced refresh
for imperative code, but rejects the original current transport, server, or
validation failure after publishing safe error state. Superseded imperative
refreshes reject with `AbortError`; neither path can publish a stale response.

### Current authorization hints

`useAuthorization()` observes the sanitized live `GET /auth/authorization`
projection. `useHasPermission`, `useHasAllPermissions`, and
`useHasAnyPermission` provide fail-closed UI checks over the same projection.
They return false before a current identity/scope snapshot exists and after a
load error or revocation. These hooks never replace backend authorization.

In multi mode `scope` remains the active tenant/membership projection. While
that tenant is the protected Administration Organization, the response may
also carry a separate `applicationScope`. Permission hooks check both
permission arrays; tenant-role/tenant-identity UI remains bound only to
`scope`. The opaque revision changes with either scope and with the installed
registry version.

```tsx
const authz = useAuthorization();
const canEdit = useHasPermission('patients:write');

if (authz.isLoading) return <ToolbarSkeleton />;
return canEdit ? <EditPatientButton /> : null;
```

The cache immediately masks old data on account replacement and tenant switch,
suppresses late responses, and revalidates while observed. See
[Browser Authorization Snapshot and Gates](../auth/browser-authorization.md)
for status semantics, vanilla APIs, packaged gates, and security boundaries.

App-owned caches should subscribe to `useAuthorizationScopeBoundary()`. Key or
purge their entries with its opaque `key`, reject late callbacks captured under
an older key, and hide/freeze scope-sensitive UI while `ready` is false.
`scopeKey`, `dataRevision`, `stable`, and `phase` describe the committed scope,
same-scope local data generation, and credential transition; they contain no
token and provide no server authority. `dataRevision` advances when Sync proves
that the current auth context, table access, or read authority is stale even if
the account and tenant IDs are unchanged. Zero cancels scoped HTTP work, clears
the cached authorization hint, purges Sync rows, and masks official hooks until
replacement authority validates. Zero-owned hooks already use this boundary
internally. See the linked browser-authorization guide for a complete example.
The public
`isAuthorizationScopeCallbackCurrent(currentKey, ready, capturedKey)` predicate
provides the same pure late-callback check for app-owned async adapters.

### Application access administration

`useApplicationAccess(options?)` is the headless `single/advanced` control
surface. It loads the caller's safe capabilities, role templates, and a
cursor-paged user projection, then exposes `loadMore`, `reload`,
`replaceUserRoles`, and `transferOwnership`. The hook never exposes global
platform roles, credentials, password/MFA state, or account properties.
It supplies the target's loaded `roleRevision` on writes, reloads after a
revision conflict, and masks cached results immediately when the authenticated
user identity changes.

```tsx
const access = useApplicationAccess({
  limit: 25,
  search,
  status: 'active',
});

await access.replaceUserRoles(userId, ['reader']);
```

Role descriptors include actor-specific `grantable` flags, while
`capabilities` says whether the caller may read, manage, or transfer ownership.
These fields drive UI only; the server re-resolves live authority inside each
mutation transaction. See
[Application Access Administration](../auth/application-access-administration.md).

### Platform administration

`usePlatformAdministration(options?)` is the protected Administration
Organization's headless people/invitation/ownership surface.
`usePlatformTenants(options?)` is the customer-organization directory,
lifecycle, creation, member-detail, and cross-workspace member/role/ownership
surface. Both require a live active `kind: 'administration'` scope, load only
reads allowed by the server-projected capabilities, and synchronously mask old
data across an account or tenant switch.

```tsx
const administrators = usePlatformAdministration({
  memberSearch,
  memberStatus: 'active',
});

const organizations = usePlatformTenants({
  search,
  selectedTenantId,
  memberStatus: 'active',
});

if (organizations.config?.capabilities.canManageTenantMembers) {
  await organizations.updateTenantMember(
    selectedTenantId,
    selectedMembershipId,
    { roles: ['manager'] },
  );
}
```

Platform people, invitation, and configuration requests are independent
slices. New UI should use the precise fields instead of treating one failed
request as a failure of the whole screen:

| Slice | State | Retry |
|---|---|---|
| protected config | `isLoadingConfig`, `configError` | `reloadConfig()` |
| administration members | `isLoadingMembers`, `isMutatingMembers`, `membersError` | `reloadMembers()` |
| public invitation policy | `invitationPolicyStatus`, `invitationsEnabled`, `invitationConfigError` | `reloadInvitations()` also retries failed public config |
| administration invitations | `isLoadingInvitations`, `isMutatingInvitations`, `invitationsError` | `reloadInvitations()` |

`isLoading`, `isMutating`, `error`, and `reload()` remain compatibility
aggregates. A member transport failure does not erase a successfully loaded
invitation page; a public-config failure disables only invitation transports
and leaves authorized member management usable. `invitationsEnabled` is
`null` while public policy is unresolved, `false` when disabled or failed
closed, and `true` only after policy explicitly enables the feature.
Paging is also separate: member state uses `memberPage`,
`isLoadingMoreMembers`, and `loadMoreMembers()`, while invitation state uses
`invitationPage`, `isLoadingMoreInvitations`, and `loadMoreInvitations()`.
`reload()` fans out to the protected config, member, and invitation slices;
the narrower retry methods do not turn a sibling failure into a screen-wide
failure.

The directory exposes `canCreateTenants` separately from
`canManageTenants`, and `canReadTenantMembers` separately from
`canReadTenants`; callers must not infer the combined permission requirements.
Its failures are split by owning operation: use `directoryError` with
`reloadDirectory()` for config/workspace reads,
`selectedTenantMembersError` with `reloadSelectedTenantMembers()` for the
selected workspace's people list, and `mutationError` for failed writes.
`clearMutationError()` dismisses a handled write failure without clearing either
read slice. The legacy `error` field remains an aggregate and `reload()` retries
both read slices and dismisses the aggregate mutation failure for compatibility;
focused UI should prefer the narrower
fields so a member failure cannot replace a loaded workspace directory.
It also exposes `canManageTenantMembers` and a distinct `customerRoles`
projection. `addTenantMember()`, `updateTenantMember()`,
`removeTenantMember()`, and `transferTenantOwnership()` require the selected
target organization; role updates inject that loaded member's current
revision, and successful writes refresh the directory/member state. This
membership control plane does not switch the actor's session or grant access
to customer application data. `useTenantMembers()` remains the corresponding
active-organization surface for customer organization managers. See
[Platform Administration Organization](../auth/platform-administration.md).

### Control-plane audit

`useAuthAudit({ scope: 'tenant' | 'platform', ...filters })` provides
authorization-fenced pagination, reload, and bounded export for the durable
security/control-plane audit. It exposes only the scope the server authorizes;
it is not a general page-view, read, or application-CRUD activity feed. See
[Control-Plane Audit](../auth/control-plane-audit.md).

### Tenant administration

`useTenantMembers(options?)` loads the active tenant's safe configuration and
member page, then exposes `loadMore`, `reload`, `addMember`, `updateMember`,
`removeMember`, and `transferOwnership`. It never accepts a tenant ID; the
authenticated Bearer scope is the only server tenant source.

```tsx
const members = useTenantMembers({
  limit: 25,
  search,
  status: 'active',
});

await members.addMember({ email: 'ada@example.com' });
await members.updateMember(membershipId, { roles: ['manager'] });
```

The returned config includes actor-specific capabilities and grantable roles,
so custom UI can hide unavailable controls. Server authorization remains
authoritative. `useTenantSwitcher()` exposes live tenant choices and delegates
switching to the SDK's refresh-family scope barrier; it does not emulate
switching with a header or access token. See
[Tenant Member Administration](../auth/tenant-member-administration.md).

`useTenantAppShellWorkspaces()` adapts that same controller to
`<AppShell workspaces={...}>`. The returned config requires an exact committed
active tenant, carries pending/error/retry/live-announcement/focus state, and
defaults to hiding the control after a complete one-membership load. It does
not create a second token or tenant-selection path.

Tenant administration hooks key cached data by both current account and active
tenant. Account replacement in the same tenant, tenant switching, pagination,
and mutation completion are generation-fenced so stale rows or errors cannot
land in the replacement scope.

`useTenantOnboardingAdministration()` coordinates separate active-tenant
protected-config, invitation, and retained join-request slices according to the
capabilities returned by `getTenantAdministrationConfig()`. Protected config
loads independently of the public feature switches; list, pagination,
mutation, error, and retry state remain separate. It exposes
issue/revoke/approve/deny mutations and never accepts a tenant ID. Each join
request includes a
reviewer-safe approval policy: fixed/default modes leave role selection on the
server, while selectable mode contains only live grantable role keys and
labels, its default selection, and its maximum selection count. Consumers must
still treat the approval mutation as authoritative because an intervening
session, role, property, or policy change can invalidate that projection. See
[Tenant Invitations and Join Requests](../auth/tenant-invitations-and-join-requests.md).

Invitations and join requests also have independent state. Use
`isLoadingConfig`, `isConfigPermissionDenied`, `configError`, and
`reloadConfig()` for the protected tenant-administration configuration. Use
`isLoadingInvitations`, `isMutatingInvitations`, `invitationsError`, and
`reloadInvitations()` for the invitation panel; use `isLoadingJoinRequests`,
`isMutatingJoinRequests`, `joinRequestsError`, and `reloadJoinRequests()` for
review. `isInvitationsPermissionDenied` and
`isJoinRequestsPermissionDenied` distinguish an authorized-feature denial
from a transport failure. `authConfigStatus`, `authConfigError`,
`invitationsEnabled`, and `joinRequestsEnabled` expose public-policy
resolution without guessing. A disabled feature performs no corresponding
transport, while failure to load public policy fails that capability closed.
The aggregate state fields remain for compatibility. Paging remains separate
through `isLoadingMoreInvitations`/`loadMoreInvitations()` and
`isLoadingMoreJoinRequests`/`loadMoreJoinRequests()`. The shared `config`
projection can be null while that protected read is loading, denied, failed,
or fenced by a scope transition. It still loads when both public features are
disabled; it must not be interpreted as one aggregate request for all three
slices.

`useTenantDomainAdministration()` is the headless active-tenant surface for
request-only verified-company-domain onboarding. It loads server-derived actor
capabilities, safe request-role choices, and exact-domain claims. Its mutations
inject the current claim or policy revision and never accept a tenant ID.
`releaseClaim(claimId, confirmDomain)` injects both current revisions, requires
the exact normalized domain confirmation, and removes the active claim only
after the server commits its retained-history/seven-day-quarantine lifecycle.
One-time DNS TXT plaintext exists only in the returned `challenge` state and is
cleared across reloads and identity/scope changes.

`useDomainOnboarding({ identityContinuation? })` drives the generic-before-proof
user flow. `start()` never accepts an email, `complete(proofToken)` does not log
the user in, and `admit()` sends only the opaque server continuation plus the
optional pre-session identity continuation. It never accepts a domain, tenant,
or role. Both hooks suppress late async results after account replacement,
tenant switch, unstable session transition, or identity-continuation change.

The matching server route family is installed in multi-tenant mode. Public
config exposes the capability only when verified-domain onboarding and its
email/public-URL dependencies are operational; packaged UI otherwise stays
hidden. See
[Verified Company-Domain Onboarding](../auth/verified-domain-onboarding.md).

### Auth Restoration

`useAuth()` exposes both the general `isLoading` flag and the narrower
`isRestoring` flag:

```tsx
const { user, isLoading, isRestoring, login, logout } = useAuth();
```

`isRestoring` is true only while Zero recovers a persisted browser session by
rotating its refresh token and loading `/auth/me`. It remains false for explicit
login and other ordinary auth loading states. `AppProvider` uses it to withhold
the configured login route until restoration settles, so a valid stored session
does not flash the login form or lose its return destination.

Browsers with Web Locks serialize one-time refresh-token rotation per Zero
server across tabs and workers. A waiting tab rereads the latest persisted token
after acquiring the lock. Without Web Locks, Zero uses a bounded, expiring
`localStorage` bakery lock across tabs when browser storage is available. The
in-process queue is the final same-JavaScript-realm fallback for runtimes
without either facility.

When an anonymous protected route redirects to login, Zero carries one safe
root-relative `redirect` value. Once authenticated on the login route, that
deep link wins; otherwise `postLoginPath` (default `/`) is used. Packaged and
custom form success callbacks still run, so use them for side effects rather
than duplicating `AppProvider` navigation.

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
  <>
    <DataTableView
      schema={clientTable.schema}
      source={{
        type: 'data',
        data: clients.rows,
        isLoading: clients.loading,
        error: clients.error,
        refresh: clients.refresh,
      }}
    />
    <div className="flex gap-2">
      <Button disabled={clients.page === 1} onClick={clients.previousPage}>
        Previous
      </Button>
      <Button disabled={!clients.hasMore} onClick={clients.nextPage}>
        Next
      </Button>
    </div>
  </>
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

### Resource Screens

Resource hooks call generated `/api/resources/:resource` routes through the SDK
client, so auth headers, token refresh, resource policy, and `FetchError`
behavior stay centralized.

```tsx
import { useResourceList, useResourceRecord } from '@zero/framework/react';

function Tickets() {
  const tickets = useResourceList<TicketRow>('tickets', {
    filters: { status: ['new', 'open'] },
    sort: { field: 'created_at', dir: 'desc' },
    pageSize: 25,
  });

  return (
    <>
      <DataTableView
        schema={ticketTable.schema}
        source={{
          type: 'data',
          data: tickets.rows,
          isLoading: tickets.loading,
          error: tickets.error,
          refresh: tickets.refresh,
        }}
      />
      <Button disabled={!tickets.hasMore} onClick={tickets.nextPage}>
        Next page
      </Button>
    </>
  );
}

function TicketDetails({ ticketId }: { ticketId: string }) {
  const ticket = useResourceRecord<TicketRow>('tickets', ticketId);

  return (
    <button onClick={() => ticket.update({ status: 'closed' })}>
      Close
    </button>
  );
}
```

Use `useResourceActions(resource)` when a form owns its own data state and only
needs generated create/update/delete calls. Use `useDataPage(table)` or
`useCollection(table)` when the screen should read from the live ReactiveDB
collection store. Resource hooks are route/policy focused; sync hooks are
live-store focused.

`useDataSelection(rows, options?)` owns reusable selected-row state for tables,
detail views, and bulk actions:

```tsx
const selection = useDataSelection(clients.rows, {
  getId: (client) => client.client_id,
});

return (
  <>
    <DataTableView
      schema={clientTable.schema}
      data={clients.rows}
      selectable
      onSelectionChange={selection.setSelectedIds}
    />
    <Button
      disabled={!selection.hasSelection}
      onClick={() => archiveClients(selection.selectedItems)}
    >
      Archive selected ({selection.count})
    </Button>
  </>
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

`useDriveCapabilities(driveId, path?)` loads the backend-resolved current-user
storage access for a drive or object path:

```tsx
const access = useDriveCapabilities(driveId);

return (
  <button disabled={!access.capabilities?.canWrite}>
    Upload
  </button>
);
```

Use `useStoragePermissions(driveId, objectPath?)` in admin surfaces to list
explicit role, user, and auth-property grants. Mutate those grants with
`useStorageActions().grantPermission()` and
`useStorageActions().revokePermission()`.

Auth-property grants accept only fields explicitly configured with
`useInPolicies: true` and an `editableBy` value of `admin`, `system`, or
`none`. A self-editable or unknown property is rejected because users must not
be able to grant themselves file access.

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

`useStorageFolder(driveId, path?, options?)` accepts `type`, `limit`, `cursor`,
`sortBy`, and `sortDir`. The backend clamps oversized limits and keeps totals
consistent with folder/file filters.

### Presence And Typing

`usePresence(roomId, data?)` is the low-level room presence primitive.
`usePresenceList(roomId, options?)` filters stale users and returns display
labels for presence UI. In an auth-enabled `createApp()`, the reserved
`presence:<roomId>` family requires a current `RoomService` membership, derives
the internal application/tenant namespace on the server, and restricts writes
to the current user's key. Authless standalone Sync retains its explicit
unrestricted compatibility behavior.

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
const typing = useTypingIndicator(threadId, {
  // This non-room topic must be allowed by the app's ephemeralPolicy.
  topic: `thread:${threadId}`,
});

<textarea onChange={() => typing.markTyping()} />

{typing.isAnyoneTyping && (
  <span>{typing.typingUsers.map((user) => user.label).join(', ')} typing</span>
)}
```

The default `typing:<scope>` form treats `scope` as a Zero room ID and requires
live membership. For a non-room thread or document, pass `options.topic` and
classify that topic through the app's server-side `ephemeralPolicy`; a hook
argument alone cannot authorize it.

Typing state is never persisted. It requires `AppProvider`/`SyncProvider` and
the underlying sync connection.

### Torrent Workflow Runs

Torrent is Zero's durable workflow system. The product name does not change
the established `useWorkflow*` hook names or `client.api.workflows` transport.

`useWorkflowRun(name, { instanceId?, version? })` starts or selects a workflow
and watches its live synced node/interaction progress. `version` pins new
starts to one immutable definition version:

```tsx
const report = useWorkflowRun('generate-report');

await report.start({ clientId });

return (
  <>
    <Progress value={report.progress.percent} />
    {report.isWaitingForInput && <span>Waiting for a response</span>}
    {report.isRetrying && <span>Retry scheduled</span>}
    {report.isRunningInParallel && <span>Running parallel work</span>}
  </>
);
```

`useWorkflow(instanceId)` returns `instance`, ordered `steps`, ordered
payload-redacted `events`, all `activeSteps`, safe durable `interactions`,
`currentStep`, and these flags:
`isRunning`, `isComplete`, `isFailed`, `isPaused`, `isCancelled`, `isWaiting`,
`isWaitingForInput`, `isRetrying`, and `isRunningInParallel`.
`useWorkflowList({ status?, name? })` returns the current user's visible
instances. Flags are descriptive and can overlap: a run remains `running`
while waiting or retrying. `isWaiting` covers every active lane, not only the
row selected as `currentStep`. `isRunningInParallel` means either multiple root
nodes are physically active or multiple items under one `each` parent are
active; a wait node and its delivery child do not count as parallel work.

The existing top-level `report.progress` counters now describe stable root
definition nodes and are mirrored at `report.progress.rootNodes`. Dynamic
`each` work is reported in `report.progress.fanoutItems`; interaction delivery
work is reported in `report.progress.deliverySteps`. Fan-out expansion cannot
change the root-node denominator or move the primary progress bar backward.

`useWorkflowTopology(instanceId)` performs one authenticated, scope-fenced load
of the immutable payload-free topology pinned to that run. It returns
`{ topology, isLoading, error, reload }`; combine `topology.nodes[].path` with
live `steps[].node_path` to render a graph. Legacy public rows normalize that
path to `step_id`, so the join is format-independent. Repeated fan-out rows use
`step_id` plus `item_index`; delivery rows attach through `parent_step_id`
instead of pretending to be definition nodes. The sanitized response contains
safe labels/paths/branch and edge layout metadata, not executable activities,
expressions, schemas, event routing names, interaction bodies, retry policy, or
payload-derived fan-out keys. Current-request failures emit
`frontend.workflow.topology_failed`; stale responses and errors are discarded.

`useWorkflowActions()` exposes authenticated `start`, `cancel`, `pause`,
`resume`, `sendEvent`, and `submitResponse` calls. `start(name, input?, {
version? })` can pin an immutable definition version. `submitResponse(instanceId,
interactionId, payload, { submissionId?, channel? })` answers a
`requestAndWait`. The hook generates an ID for each call; callers that may
retry at the application layer should supply one stable submission ID across
those attempts. It resolves to a privacy-safe
`WorkflowInteractionSubmissionResult` containing `outcome`, the current safe
`interaction` projection, and optional validator-authored `rejectionCode` and
`publicMessage`. `outcome` is `accepted`, `rejected`, or `superseded`; use the
optional public fields to explain a rejected response without exposing its
private submitted or normalized value. `sendEvent` resolves to `true` only
when the newly stored event was claimed before the request returned. An event
sent while paused is durably buffered but returns `false`; resume may claim it
later. A direct response is not buffered while paused: it rejects with
retryable HTTP `409` `WORKFLOW_DRAINING`. Preserve its submission ID and retry
after resume. Each wait also has a bounded unique-submission/byte budget;
replaying an existing stable ID remains valid at that cap, while a new ID
returns non-retryable HTTP `429` `WORKFLOW_INTERACTION_SUBMISSION_LIMIT`.

These hooks read ReactiveDB Sync and do not poll. Runtime rows are owner-scoped.
A live manager can see all runs only inside the active application/tenant
service-data scope; a global role does not imply cross-tenant visibility.
Definition `access.inspect` controls definition discovery, while a starter can
still use these safe hooks for their own pinned run. Child step/event/interaction
rows are shown only while their authorized parent instance is also visible.
Definitions and canonical graph JSON are excluded from Sync. Instance rows omit private
graph snapshots and `definition_version_id`, while their public `definition_id`,
numeric `definition_version`, and `graph_fingerprint` identify the immutable
topology safely. Every workflow instance and step clears
input, output, and raw error; step rows also omit the executable `wait_event`.
Safe `node_id`, `node_kind`, `node_path`, `branch_key`, `parent_step_id`,
and `item_index` remain for a real-time timeline or graph view. Use `step_id`
as the unique row key; payload-derived `item_key` and `activation_key` are
omitted.
Event rows expose audit metadata with payloads redacted. Interaction rows
expose safe status/timestamps and rejection counts, not prompts, policies,
schemas, or response payloads. Workflow tables are read-only over Sync, and
actions go through `client.api.workflows`. See
[Torrent: Durable Workflows](../workflows.md).

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
- Be SSR-safe when exported from `@zero/framework/react`.
- Compose SDK/auth/sync clients instead of duplicating transport.
- Keep optimistic state and server reconciliation clear.

Hooks should not:

- Read auth tokens from browser storage.
- Call AI/storage/auth providers directly when an SDK method exists.
- Treat frontend visibility gates as authorization.
- Own Elysia route behavior or server policy.

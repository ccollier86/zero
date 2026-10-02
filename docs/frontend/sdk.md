# SDK

The developer-facing API for database, auth, real-time, and persistent state.
It has an **imperative core client** that is usable outside React components and
**React hooks** that bind the same client to component state. Install one
package to get typed CRUD, auth, live subscriptions, optimistic mutations, and
per-authorized-scope user state persisted on the server.

```ts
import { createClient } from '@zero/framework/react';
import { tables } from '@app/lib/schemas';

// Core client — works anywhere
const client = createClient({
  url: 'http://localhost:3000',
  tables,
  auth: true,
});

// Auth — top-level. May return a session or an MFA continuation.
const authResult = await client.login('alice', 'password123');

// Auth admin — typed user-management helpers
const { users, page } = await client.listAuthAdminUsers();

// HTTP — authenticated JSON requests in one line
const { user } = await client.post('/api/users', { name: 'Alice' });
await client.patch('/api/users/1', { role: 'admin' });
await client.delete('/api/users/1');

// Collections — real-time sync with optimistic mutations
const todos = client.collection('todos');
todos.insert({ title: 'Buy milk', done: true });  // Auto-generates UUID PK
```

In a client component, `useCollection()` exposes the same live table through
React:

```tsx
'use client';

import { useCollection, type InferRow } from '@zero/framework/react';
import { todoTable } from '@app/lib/schemas';

type Todo = InferRow<typeof todoTable>;

export function TodoList() {
  const { data, insert, update, remove } = useCollection<Todo>('todos');
  return (
    <>
      <button onClick={() => insert({ title: 'New todo', done: false })}>Add</button>
      {data.map((todo) => (
        <div key={todo.id}>
          <button onClick={() => update(todo.id, { done: !todo.done })}>
            {todo.title}: {todo.done ? 'done' : 'open'}
          </button>
          <button onClick={() => remove(todo.id)}>Delete</button>
        </div>
      ))}
    </>
  );
}
```

---

## Client

### createClient

Factory for the SDK client. One client per app. Normally created internally by `AppProvider` -- you rarely call this directly.

```ts
import { createClient } from '@zero/framework/react';

const client = createClient({
  url: 'http://localhost:3000',
  tables,          // Single tables object — auto-extracts what it needs
  auth: true,      // Omit or false for authless apps
  autoConnect: true,
});
```

**Config:**

```ts
interface ClientConfig {
  /** Server URL (HTTP or HTTPS). WebSocket URL derived automatically. */
  url: string;

  /** Table definitions. defineTable() output is accepted directly. */
  tables?: Record<string, ClientTableDef | { clientTable: ClientTableDef }>;

  /** Enable auth. Default: false, matching createApp(). */
  auth?: boolean;

  /** Revalidate observed authorization hints. Default: 30000; 0 disables polling. */
  authorizationRevalidationIntervalMs?: number;

  /** Enable scoped-user state sync. Requires auth: true. Default: false. */
  stateSync?: boolean;

  /** Connect WebSocket immediately on creation. Default: true */
  autoConnect?: boolean;

  /** Max reconnect attempts before giving up. Default: Infinity */
  maxReconnectAttempts?: number;

  /** Generated resource route prefix. Default: '/api/resources'. */
  resourcePrefix?: string;

  /** Called on unrecoverable connection error. */
  onError?: (error: string) => void;

  /** Called after successful reconnect. */
  onReconnect?: () => void;

  /** Called after a realtime mutation rejection has rolled back locally. */
  onMutationRejected?: (rejection: SyncMutationRejection) => void;
}
```

`auth` is opt-in on the raw SDK client. In a full-stack app, `AppProvider`
uses the server-injected platform config when `auth` or `stateSync` props are
omitted, so frontend defaults match `createApp()`.

**Returns:** `Client` instance.

**Singleton:** Only one client per process. Calling `createClient()` twice throws. Call `client.disconnect()` first to release.

### Client Interface

```ts
interface Client {
  /** Server URL this client is connected to */
  readonly url: string;

  // ─── Auth (top-level shortcuts) ──────────────────────────────
  readonly user: AuthUser | null;
  readonly authorization: AuthAuthorizationSnapshot | null;
  readonly authorizationState: AuthAuthorizationState;
  readonly isAuthenticated: boolean;
  readonly token: string | null;
  getAuthorization(): Promise<AuthAuthorizationSnapshot | null>;
  refreshAuthorization(): Promise<AuthAuthorizationSnapshot | null>;
  subscribeAuthorization(callback: () => void): () => void;
  login(username: string, password: string): Promise<AuthCompletionResult>;
  register(params: RegisterParams): Promise<AuthRegistrationResult>;
  getAuthConfig(): Promise<AuthPublicConfig>;
  forgotPassword(email: string, nativeContinuation?: string): Promise<void>;
  resendVerificationEmail(email: string, nativeContinuation?: string): Promise<void>;
  verifyEmail(token: string): Promise<AuthCompletionResult>;
  inspectActionToken(token: string): Promise<AuthActionTokenInfo>;
  resetPassword(token: string, newPassword: string): Promise<AuthCompletionResult>;
  setupPassword(token: string, newPassword: string): Promise<AuthCompletionResult>;
  listMfaMethods(): Promise<{ methods: AuthMfaMethod[]; required: boolean }>;
  startMfaSetup(params: { setupToken?: string; method: AuthMfaMethodType; label?: string }): Promise<AuthMfaSetupStartResult>;
  verifyMfaSetup(params: { verificationToken: string; code: string }): Promise<AuthMfaSetupVerifyResult>;
  verifyMfaChallenge(params: { challengeToken: string; code: string }): Promise<AuthCompletionResult>;
  logout(): Promise<void>;
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
  refresh(): Promise<void>;
  setProperty(key: string, value: unknown): Promise<void>;
  getProperty(key: string): Promise<string | null>;
  getProperties(): Promise<Record<string, string>>;
  deleteProperty(key: string): Promise<void>;

  // ─── Verified-domain onboarding ───────────────────────
  getTenantDomainAdministration(signal?: AbortSignal): Promise<AuthTenantDomainAdministration>;
  createTenantDomainClaim(domain: string): Promise<AuthTenantDomainChallengeResult>;
  issueTenantDomainChallenge(claimId: string, expectedRevision: string): Promise<AuthTenantDomainChallengeResult>;
  verifyTenantDomainClaim(claimId: string, expectedRevision: string): Promise<AuthTenantDomainClaimResult>;
  updateTenantDomainPolicy(claimId: string, update: AuthTenantDomainPolicyUpdate): Promise<AuthTenantDomainClaimResult>;
  releaseTenantDomainClaim(claimId: string, input: AuthTenantDomainReleaseInput): Promise<AuthTenantDomainReleaseResult>;
  startDomainOnboarding(identityContinuation?: string): Promise<{ accepted: true }>;
  completeDomainOnboarding(proofToken: string): Promise<AuthDomainOnboardingCompletion>;
  admitDomainOnboarding(continuation: string, identityContinuation?: string): Promise<AuthDomainOnboardingAdmissionResult>;

  // ─── Auth Admin ─────────────────────────────────────────────
  getAuthAdminConfig(): Promise<AuthAdminConfig>;
  listAuthAdminUsers(params?: AuthAdminUserListParams): Promise<AuthAdminUserListResult>;
  getAuthAdminUser(userId: string): Promise<AuthUser>;
  createAuthAdminUser(params: AuthAdminCreateUserParams): Promise<{ user: AuthUser; setupEmailSent: boolean }>;
  updateAuthAdminUser(userId: string, params: AuthAdminUpdateUserParams): Promise<AuthUser>;
  setAuthAdminUserProperty(userId: string, key: string, value: unknown): Promise<void>;
  deleteAuthAdminUserProperty(userId: string, key: string): Promise<void>;
  deleteAuthAdminUser(userId: string): Promise<void>;
  sendAuthAdminSetupEmail(userId: string): Promise<boolean>;
  sendAuthAdminPasswordReset(userId: string): Promise<void>;
  clearAuthAdminPasswordChangeRequirement(userId: string): Promise<AuthUser>;
  resetAuthAdminPassword(userId: string, password: string): Promise<void>;
  suspendAuthAdminUser(userId: string): Promise<AuthUser>;
  activateAuthAdminUser(userId: string): Promise<AuthUser>;
  revokeAuthAdminUserSessions(userId: string): Promise<void>;
  getAuthAdminUserMfa(userId: string): Promise<AuthAdminUserMfaStatus>;
  requireAuthAdminUserMfa(userId: string): Promise<AuthUser>;
  clearAuthAdminUserMfaRequirement(userId: string): Promise<AuthUser>;
  resetAuthAdminUserMfa(userId: string): Promise<AuthAdminMfaResetResult>;
  sendAuthAdminVerificationEmail(userId: string): Promise<void>;
  verifyAuthAdminUserEmail(userId: string): Promise<AuthUser>;

  // ─── Guardian user API keys ──────────────────────────────────
  /** Session-authenticated, mode-separated API-key management transports. */
  readonly apiKeys: AuthApiKeySdkSurface;

  // ─── HTTP (JSON fetch; auth headers when auth is enabled) ─────
  /** Auto-prepends server URL, auto-JSON, auto-auth, throws FetchError on non-2xx */
  fetch<T = unknown>(path: string, init?: FetchInit): Promise<T>;
  get<T = unknown>(path: string): Promise<T>;
  post<T = unknown>(path: string, body?: unknown): Promise<T>;
  put<T = unknown>(path: string, body?: unknown): Promise<T>;
  patch<T = unknown>(path: string, body?: unknown): Promise<T>;
  delete<T = unknown>(path: string): Promise<T>;

  // ─── Typed API (authenticated Eden Treaty) ───────────────
  readonly api: Api;

  // ─── Data ────────────────────────────────────────────────────
  collection<
    T extends Row = Row,
    TPrimaryKey extends keyof T & string = PrimaryKeyOf<T>,
  >(name: string): Collection<T, TPrimaryKey>;
  resource<T extends Row = Row>(
    name: string,
    options?: ResourceClientOptions,
  ): ResourceClient<T>;

  // ─── Connection ──────────────────────────────────────────────
  connect(): void;
  readonly connected: boolean;
  onConnectionChange(callback: (connected: boolean) => void): () => void;
  onMutationRejected(
    callback: (rejection: SyncMutationRejection) => void,
  ): () => void;
  disconnect(): void;
}
```

`ClientConfig.onMutationRejected` installs a startup observer;
`client.onMutationRejected(callback)` adds a runtime observer and returns an
unsubscribe function. Both fire after the optimistic row has been rolled back.
Observer failures cannot interrupt Sync state or queue progress.

```ts
interface SyncMutationRejection {
  ref: string;
  table: string;
  op: 'INSERT' | 'UPDATE' | 'DELETE';
  rowId: string;
  plane?: 'default' | 'system' | 'tenant';
  error?: string;
  errorCode?: SyncAckErrorCode;
  source: 'server' | 'timeout';
}
```

Branch on `errorCode`, not the display-oriented `error`. A
`SYNC_DATA_REALM_NOT_READY` rejection should wait for
`client.dataRealm.getReadiness()`/`retry()` to report `ready` before a
deliberate resubmission. `SYNC_DATA_REALM_UNAVAILABLE` and
`SYNC_MUTATION_CAPACITY_EXHAUSTED` stop automatic replay. A local acknowledgement
timeout uses `source: 'timeout'` and may not carry an error code. The low-level
`SyncClientConfig` and `SyncClient` expose the same callback/subscription.

The public `Client` does not expose Zero's internal sync, state, or ephemeral
objects. Use the exported state, presence, room, and data hooks for those
features. The internal objects exist only for framework provider wiring.

### Guardian API-key management

When `auth.apiKeys.enabled` is configured, the same client exposes four
session-authenticated management namespaces:

```ts
const own = await client.apiKeys.self.list({ limit: 25 });
const issued = await client.apiKeys.self.issue({ label: 'deployment', ttl: '7d' });
await client.apiKeys.self.rotate(issued.apiKey.keyId, {
  label: 'deployment',
  ttl: '7d',
});
await client.apiKeys.self.revoke(issued.apiKey.keyId);

await client.apiKeys.applicationAdmin.listUser(userId);
await client.apiKeys.applicationAdmin.issueUser(userId, input);

await client.apiKeys.tenantAdmin.listMember(membershipId);
await client.apiKeys.tenantAdmin.issueMember(membershipId, input);

await client.apiKeys.platformAdmin.list({ tenantId });
await client.apiKeys.platformAdmin.listMember(tenantId, membershipId);
await client.apiKeys.platformAdmin.issueMember(tenantId, membershipId, input);
```

The three administrator namespaces also expose `rotate(keyId, input)` and
`revoke(keyId)`. All calls use the restored Guardian session and `no-store`;
management routes do not accept an API key as their own credential. Issue and
rotation return `{ apiKey, secret }`. The `secret` is a one-time value and is
never inserted into list state.

For React, `useAuthApiKeys()` wraps the same namespaces with identity/scope
fencing, cursor pagination, and capability state:

```tsx
const keys = useAuthApiKeys({ mode: 'self', limit: 25 });
const memberKeys = useAuthApiKeys({
  mode: 'tenant-admin',
  membershipId,
});
```

Modes are `self`, `application-admin`, `tenant-admin`, and `platform-admin`;
the latter can be a platform directory (optional `tenantId` filter) or an exact
`tenantId` + `membershipId` target. The hook exposes `apiKeys`, `page`,
`isAvailable`, server-authoritative `canIssue`, `canRotate`, and `canRevoke`,
loading/mutation/denial/error state, `reload`, `loadMore`, `issue`, `rotate`,
and `revoke`.

See [Guardian User API Keys](../auth/api-keys.md) for server configuration,
explicit route admission, scope/lifecycle semantics, and optional packaged UI.

### Auth Registration Config

`client.getAuthConfig()` reads `GET /auth/config` and is safe for public auth
UI decisions:

```ts
const config = await client.getAuthConfig();

if (config.registration.registrationEnabled) {
  // show register link/form
}

if (config.bootstrap?.required && config.bootstrap.secretRequired) {
  // collect the operator setup key; never persist it in browser storage
}

console.log(config.tenancy?.mode ?? 'single');
console.log(config.authorization?.mode ?? 'simple');

if ((config.tenancy?.mode ?? 'single') === 'multi') {
  console.log(config.tenancy?.terminology?.singular ?? 'organization');
  console.log(config.tenancy?.creation?.mode ?? 'authenticated');
}

if (config.tenancy?.onboarding?.verifiedDomains?.enabled) {
  // Only request-to-join is defined in the first browser contract.
  console.log(config.tenancy.onboarding.verifiedDomains.admission);
}

if (config.apiKeys?.enabled) {
  console.log(config.apiKeys.selfService);
  console.log(config.apiKeys.administratorIssuance);
  console.log(config.apiKeys.defaultTTL, config.apiKeys.maxTTL);
  console.log(config.apiKeys.maxActivePerUser);
}
```

Both public and admin auth-config responses include the resolved capability
axes. Older servers/clients may omit these additive fields, so mixed-version
clients should treat absence as `single/simple`. Public config deliberately
contains only safe capability data: tenancy mode, configured singular/plural
terminology, tenant-creation mode, and authorization mode. The permission
registry, role templates, API-key eligible-role allowlist, bootstrap secret,
and other policy internals remain server-only. Treat a missing terminology
value as `organization/organizations` and a missing multi-mode creation value
as `authenticated` when supporting an older server. Treat missing `apiKeys` as
disabled.

`registrationEnabled` covers either an available installation ceremony or
ordinary public registration. `publicRegistrationEnabled` is narrower and is
false during secret-gated setup. The public response deliberately omits the
configured secret and exact user count.

The built-in `LoginForm`, `RegisterForm`, and `ForgotPasswordForm` use the same
config by default. Policy-aware forms wait for config before exposing
registration or password-reset actions. After the first admin account exists,
`registration.mode: 'admin-only'` hides public registration UI while keeping
login available. When `tenancy.mode` is `multi`, `RegisterForm` automatically
uses the configured tenant terminology. It requires the tenant name during the
first bootstrap only. Later registrations create an identity independently;
when public config says the resulting identity may create a tenant, the form
offers creation as an explicit option instead of silently joining or creating
one. The server derives the slug; apps using the SDK directly may provide an
explicit slug.

The auth component set is reusable and route-agnostic:

```tsx
import {
  ChangePasswordForm,
  ForgotPasswordForm,
  LoginForm,
  MFAEnrollmentForm,
  MFAManagementPanel,
  PasswordActionForm,
  RegisterForm,
  TenantCreationForm,
  UserPropertiesForm,
} from '@zero/framework/components/auth';
import { QRCode } from '@zero/framework/react';

<LoginForm
  forgotPasswordHref="/forgot-password"
  identifierAutoComplete="email"
  identifierLabel="Email"
  registerHref="/register"
/>
<RegisterForm loginHref="/login" />
<TenantCreationForm />
<ForgotPasswordForm loginHref="/login" />
<PasswordActionForm token={tokenFromUrl} mode="auto" loginHref="/login" />
<PasswordActionForm mode="reset" loginHref="/login" />
<UserPropertiesForm />
<MFAManagementPanel />
<ChangePasswordForm />
```

`LoginFormProps.showRememberMe` remains accepted as a deprecated source-
compatibility prop, but it does not render a checkbox or change session
persistence. Zero session lifetime and restoration are controlled by the
server auth policy.

`PasswordActionForm` inspects `/auth/action-token/:token` and calls the reset
or setup route based on token type. Invalid, expired, unsupported, or
mode-mismatched tokens keep submit disabled. If `token` is omitted, it renders a
token-paste step for email clients or routes that cannot preserve the query
string. Login, registration, email verification, and password action forms route
MFA and multi-tenant completion responses through `AuthFlowContinuation`. It
renders MFA setup/challenge, `TenantSelectionForm`, or the actionable
`TenantCreationForm` when the response includes an eligible one-time creation
proof. When creation is not allowed, it explains that an invitation or
platform administrator is required instead of presenting a dead-end action.
`TenantCreationForm` can also be rendered for a signed-in user without a
continuation; the SDK then proves and rotates the current refresh family.
`UserPropertiesForm` renders only
`editableBy: 'user'` property fields exposed by `/auth/config`.

### Adaptive User Management

Use `UserManagement` or its explicit `PlatformUserManagement` alias for the
default people/access control plane:

```tsx
import { PlatformUserManagement } from '@zero/framework/react';

export function UsersSettingsPanel() {
  return <PlatformUserManagement className="h-[720px]" />;
}
```

The organism resolves the installed auth profile from live configuration and
scope. `single/simple` keeps the established global account manager;
`single/advanced` composes application roles and ownership into that same
selected-account detail; a customer organization uses tenant membership and
role administration; and the protected Administration Organization adds
compact People/Workspaces scope controls, invitations, the all-identities
directory, and customer-workspace lifecycle/detail.

`UserManagementProps` keeps extension points scoped to the record family they
augment:

| Prop | Adaptive behavior |
| --- | --- |
| `pageSize` | Sets the bounded page size for the active identity, member, or workspace directory. |
| `defaultManagementView` | Chooses the initial Administration Organization view: `people` or `workspaces`. |
| `defaultPeopleScope` | Chooses the initial platform People scope: `administration` or `identities`. |
| `additionalDetailContent`, `additionalNavigationActions`, `onSelectedUserChange` | Extend and observe identity-backed detail only. |
| `additionalTenantMemberDetailContent`, `additionalTenantMemberNavigationActions`, `onSelectedTenantMemberChange` | Extend and observe tenant-membership detail only. |
| `onActorSessionInvalidated` | Runs after a self-membership or ownership mutation invalidates the actor session. |
| `onActorAuthorizationChanged` | Runs after a `single/advanced` mutation changes the actor's own application authority. |

Supplying `data` intentionally selects the established controlled
identity-manager contract, together with `config`, `roleOptions`, and the
controlled mutation handlers. It does not partially control the adaptive
tenant or workspace modes. Use `IdentityUserManagement` when an explicitly
identity-only self-wired surface is clearer.

Where application-account authority is present, the account layer supports
backend pagination, search, role/status filters, create, update, promote,
suspend, activate, delete where safe, session revoke, direct reset when
enabled, setup/reset email, verification/MFA operations, and configured
user-property editing. In tenant-member views the exact selected account is
loaded only after the live authorization projection grants
`application.users:read`; tenant-only managers never probe that API.

Those controls are actor-capability gated. `application.users:read` may render
a read-only identity directory; writes require the projected user-management
capability, and creating/promoting/demoting or mutating a global-admin target
requires the separate global-admin management capability. The packaged create
form cannot submit an `admin` role when that capability is absent.

In multi-tenant mode the packaged organism deliberately omits hard delete and
uses suspend/activate as the identity lifecycle. Organization membership,
invitation, join-request, and creation attribution are retained history; a
direct `deleteAuthAdminUser()` call for such an identity returns
`409 USER_HAS_TENANT_HISTORY` and leaves both identity and history unchanged.
Hard delete remains available for single-tenant apps and for custom lifecycle
code deleting a multi-tenant identity that has never acquired retained tenant
history.

Configured `auth.userProperties` become typed controls. Enum fields render as
selects, booleans as checkboxes, and strings/numbers as tokenized inputs. If
`strictUserProperties` is false, the component also exposes an additional
key/value editor for unconfigured custom metadata. If strict mode is true, only
configured fields are editable and the server rejects unknown keys.

For custom admin dashboards, use the same top-level SDK methods directly:

```ts
const { users, page } = await client.listAuthAdminUsers({
  search: 'ops',
  role: 'user',
  status: 'active',
  limit: 50,
});

console.log(page.total, page.hasMore, page.nextOffset);

await client.setAuthAdminUserProperty(userId, 'department', 'operations');
await client.deleteAuthAdminUserProperty(userId, 'legacyFlag');
await client.sendAuthAdminPasswordReset(userId);
```

### Application Access Management

In `single/advanced`, keep global account administration separate from
application roles. Use the namespaced SDK for a custom screen:

```ts
const config = await client.applicationAdmin.getConfig();
const page = await client.applicationAdmin.listUsers({
  search: 'ada',
  status: 'active',
  limit: 25,
});

const first = page.users[0];
if (first && config.capabilities.canManageRoles) {
  await client.applicationAdmin.replaceUserRoles(
    first.identity.userId,
    ['reader'],
    first.roleRevision,
  );
}
```

Use `useApplicationAccess()` for headless React state or mount the adaptive
`<UserManagement />`/`<PlatformUserManagement />` control plane. In a
`single/advanced` application it composes application roles and ownership into
the selected account's existing detail and bottom action bar. The routes
do not exist outside `single/advanced`; global `users.role = 'admin'` does not
grant application authority. Role replacement is grant-ceiling constrained,
requires the latest target `roleRevision` to prevent lost updates, and
protected ownership moves only through `transferOwnership()`. The React hook
tracks loaded revisions for you.
See [Application Access Administration](../auth/application-access-administration.md)
for response shapes, errors, and owner lifecycle guarantees.

### Platform Administration Organization

In `multi/simple` and `multi/advanced`, bootstrap creates a protected
Administration Organization. After switching the durable session into that
scope, use the namespaced SDK:

```ts
const config = await client.platformAdmin.getConfig();
const page = await client.platformAdmin.listTenants({
  status: 'active',
  search: 'practice',
  limit: 25,
});

if (config.capabilities.canCreateTenants) {
  await client.platformAdmin.createTenant({
    name: 'Northside Practice',
    ownerEmail: 'owner@northside.example',
  });
}
```

Use `usePlatformAdministration()` for protected-organization people,
invitations, roles, and ownership. Use `usePlatformTenants()` for the customer
directory, lifecycle, creation, and capability-gated member/role/ownership
control plane. Customer workspaces are cursor-paged newest first; committed
create and lifecycle receipts stay reconciled into the active filtered
projection until their server page observes them.
`<UserManagement />` (or its explicit `PlatformUserManagement` alias) provides
the packaged adaptive control plane. Its compact People/Workspaces controls
compose Administration Organization membership, invitations and roles with the
customer-workspace directory rather than stacking independent page-sized
panels. A workspace opens one focused Manage/View people list-detail surface:
roles/effective permissions remain in the right pane, member/ownership actions
remain in the bottom bar, and Add member uses a dialog. A Back action returns
to the workspace directory without losing the selected workspace. Navigation
scopes follow the live application projection: global identities require
`application.users:read`, while Workspaces appears for directory readers or
for the supported create-only combination of `application.tenants:manage`
plus `application.users:read`.
`PlatformWorkspaceManagement` and `TenantMemberManagement` remain
available as focused primitives for custom layouts. A platform actor holding
`application.tenants:read`, `application.users:read`, and
`application.tenant-members:manage` can add, update, remove, or transfer a
selected customer membership without switching sessions:

```ts
const member = await client.platformAdmin.addTenantMember(customerTenantId, {
  email: 'manager@example.com',
  roles: ['manager'],
});

await client.platformAdmin.updateTenantMember(
  customerTenantId,
  member.member.membershipId,
  {
    roles: ['member'],
    expectedRoleRevision: member.member.roleRevision,
  },
);
```

`getConfig()` projects this authority as `canManageTenantMembers` and returns
customer role policy separately in `customerRoles`. The
`usePlatformTenants()` hook exposes matching methods, injects the selected
member's current role revision on role changes, and refreshes the customer
directory/member view after a successful write. Its read failures remain
independent: `directoryError` retries through `reloadDirectory()`, while
`selectedTenantMembersError` retries through
`reloadSelectedTenantMembers()`. Failed writes use `mutationError` and
`clearMutationError()`; the aggregate `error` and `reload()` members remain for
compatibility, with aggregate reload retrying both reads and dismissing the
handled mutation failure. This is membership control
only: active administration scope never implies customer application-data
access, and customer organization managers never gain global password, MFA,
session, or account-lifecycle controls. See
[Platform Administration Organization](../auth/platform-administration.md).

For custom administration UI, prefer the hook's independent config, member,
and invitation state (`isLoadingConfig`/`configError`,
`isLoadingMembers`/`membersError`, and
`isLoadingInvitations`/`invitationsError`) plus their matching reload methods.
The public invitation policy has an explicit unresolved state through
`invitationPolicyStatus` and nullable `invitationsEnabled`; no invitation
transport runs until policy resolves enabled. Aggregate loading, mutation,
error, and reload fields remain for compatibility.
Member and invitation paging are independent as well:
`memberPage`/`isLoadingMoreMembers`/`loadMoreMembers()` and
`invitationPage`/`isLoadingMoreInvitations`/`loadMoreInvitations()`.

The adaptive tenant-member views put invitation work in one focused
Invite/Invitations dialog beside Add member. The dialog projects the live
delivery policy and grantable roles, displays a manual token only after that
explicit delivery mode succeeds, and embeds a server-filtered pending list.
The pending list uses cursor-based Load more, remains available without issue
controls when the actor has read authority, and exposes revoke independently
when the actor has invitation-management authority. Revocation always requires
explicit confirmation. The default pending page size is 10 and custom callers
may request 1–100 records through `useTenantInvitationAction({ pageSize })`.

For a custom member layout, compose the same workflow without rebuilding its
authority and scope fencing:

```tsx
import {
  TenantMemberManagement,
  useTenantInvitationAction,
} from '@zero/framework/react';

export function OrganizationPeople() {
  const invitations = useTenantInvitationAction({
    label: 'Invite person',
    pageSize: 20,
    onInvitationIssued: (result) => {
      console.log(result.invitation.invitationId);
    },
  });

  return (
    <>
      <TenantMemberManagement
        secondaryPrimaryAction={invitations.secondaryPrimaryAction}
      />
      {invitations.dialog}
    </>
  );
}
```

The hook also returns `canInvite` and `canViewPendingInvitations`. It closes
the dialog, clears a displayed manual token, and discards stale completions
when the identity or active tenant authorization boundary changes.

For active-tenant invitation and customer join-request controls,
`useTenantOnboardingAdministration()` composes three independently fenced
slices. Protected tenant configuration uses `config`, `isLoadingConfig`,
`isConfigPermissionDenied`, `configError`, and `reloadConfig()` and continues
to load even when both public onboarding features are disabled. Invitations
and join requests each expose their own loading, loading-more, mutation,
permission-denied, error, reload, and paging fields. Public capability state is
separate again: `authConfigStatus`/`authConfigError` report the shared public
config read, while nullable `invitationsEnabled` and `joinRequestsEnabled`
distinguish unresolved policy from enabled and failed-closed/disabled policy.
The older aggregate fields remain compatible, but custom panels should use
the exact slice fields. See
[Tenant Invitations and Join Requests](../auth/tenant-invitations-and-join-requests.md).

### User Property Gates

Current-user properties are included in `user.properties`. The frontend barrel
exports lightweight UI gates:

```tsx
import { AdminGate, PropertyGate, HasFlag, SignedIn, SignedOut } from '@zero/framework/react';

<PropertyGate propertyKey="department" allow={['accounting', 'management']}>
  <DepartmentTools />
</PropertyGate>

<HasFlag propertyKey="notificationsEnabled">
  <NotificationSettings />
</HasFlag>

<AdminGate>
  <AdminOnlyButton />
</AdminGate>

<SignedOut>
  <LoginForm />
</SignedOut>
```

These gates only control UI visibility. Protect sensitive data and actions
with backend route/query authorization as well.

### Auth and HTTP Errors

Auth and admin-auth methods throw `AuthClientError`, which preserves the
server's structured auth error code and exposes `retryable` only when the
server explicitly marks the failure safe to repeat. Generic `client.fetch()`
shortcuts throw `FetchError` for non-2xx server responses; local authenticated-
transport policy errors remain `AuthClientError` values.

Authenticated SDK transports are bound to the configured Zero server origin.
Passing a cross-origin absolute URL to `client.fetch()` fails locally with
`AUTH_REQUEST_ORIGIN_MISMATCH`; no access or refresh credential is sent.

```ts
import { AuthClientError } from '@zero/framework/react';

try {
  await client.updateAuthAdminUser(id, { role: 'admin' });
} catch (err) {
  if (err instanceof AuthClientError) {
    console.log(err.status, err.code, err.retryable, err.body);
  }
}
```

A cross-plane authority commit collision returns HTTP 409
`AUTH_COMMIT_CONFLICT` with `retryable === true`; the Guardian mutation did not
commit, so the caller may repeat it. Do not treat that code as a stale login.
`AUTH_STATE_CHANGED` remains the separate stale-ceremony/session signal.

`FetchError` is thrown by `client.fetch()` and its HTTP shortcuts on non-2xx
responses:

```ts
class FetchError extends Error {
  readonly status: number;   // HTTP status code (e.g. 403, 404, 500)
  readonly body: unknown;    // Parsed JSON response body
}
```

### FetchInit

```ts
interface FetchInit {
  method?: string;
  body?: unknown;                   // Auto-stringified, auto Content-Type
  headers?: Record<string, string>; // Merged with auth headers
  signal?: AbortSignal;             // Passed through to fetch()
  json?: boolean;                   // false = return raw Response (default: true)
}
```

**Connection lifecycle:**

1. `createClient({ autoConnect: true })` — opens WebSocket to `ws://{url}/sync`
2. Sends `sync.subscribe` with `tables`, `snapshot`, and `lastSeq: 0`
3. Server responds with `sync.snapshot` for tables requested in `snapshot`; lazy tables are omitted
4. Client stores the included snapshot tables in local @xstate/store
5. Live `sync.change` messages stream in as data changes
6. On disconnect: exponential backoff reconnect (1s, 2s, 4s... max 30s + jitter)
7. On reconnect: sends `sync.subscribe { tables, snapshot, lastSeq }` — server replays missed changes or sends fresh snapshot for requested snapshot tables

With `autoConnect: false`, the client creates stores but does not open a
WebSocket until `client.connect()` is called.

When auth is enabled, the WebSocket does not capture a one-time token at client
creation. It reads the current access token every time it opens or reconnects.
That keeps sync aligned with login, restore, refresh, and registration. If the
server rejects the socket for auth, the SDK attempts one refresh; if refresh is
rejected, auth state and local synced table/state data are cleared.

---

## Collections (Database)

A collection is a typed handle to a server table. It provides CRUD operations, queries, and real-time subscriptions.

### Getting a Collection

```ts
interface Todo {
  id: string;
  title: string;
  done: boolean;
}

const todos = client.collection<Todo>('todos');
```

The type parameter `<Todo>` flows through to all return types and mutation
inputs. Prefer `InferRow<typeof todoTable>` for schema-defined tables. It also
carries type-only primary-key metadata, so insert/load inputs may omit exactly
the key Zero generates at runtime.

Schema-defined boolean fields stay logical at this API boundary: collection
reads and callbacks expose `boolean`, while writes are encoded to SQLite's
`0/1` representation inside the collection transport.

**Type safety note:** `client.collection<T>('todos')` — the generic `T` is a
**client-side type assertion**. For tables built with `defineTable()`/`schema()`,
the server independently validates the complete logical row before writing.
Hand-authored raw SQL table definitions enforce their SQLite constraints but
remain logically permissive unless you attach an explicit mutation validator.
Add client-side validation when you want feedback before an optimistic mutation
is sent.

### Collection Interface

```ts
interface Collection<
  T extends Record<string, unknown>,
  TPrimaryKey extends keyof T & string = PrimaryKeyOf<T>,
> {
  /** Table name */
  readonly name: string;

  // ─── Reads ───────────────────────────────────────────

  /** Get all rows. Returns a map keyed by primary key. */
  getAll(): Record<string, T>;

  /** Get a single row by primary key. Returns null if not found. */
  getOne(id: string): T | null;

  /** Get rows matching a filter function. */
  getMany(filter: (row: T) => boolean): T[];

  /** Get the count of all rows. */
  count(): number;

  // ─── Mutations (optimistic + server sync) ────────────

  /** Insert a new row. Applies optimistically, then sends to server. */
  insert(row: InsertInput<T, TPrimaryKey>): void;

  /** Return the deterministic sync id for a natural identity key. */
  identityKey(key: Record<string, unknown>): string;

  /** Get a single local row by natural identity. */
  getByIdentity(key: Record<string, unknown>): T | null;

  /** Insert or update by natural identity. */
  upsertByIdentity(row: InsertInput<T, TPrimaryKey>): void;

  /** Update by natural identity. */
  updateByIdentity(key: Record<string, unknown>, partial: Partial<T>): void;

  /** Delete by natural identity. */
  deleteByIdentity(key: Record<string, unknown>): void;

  /** Update a row by primary key. Partial merge. */
  update(id: string, partial: Partial<T>): void;

  /** Delete a row by primary key. */
  remove(id: string): void;

  // ─── Subscriptions ──────────────────────────────────

  /** Subscribe to all rows in this collection. */
  subscribe(callback: (rows: Record<string, T>) => void): () => void;

  /** Subscribe to a specific row by ID. */
  subscribeOne(id: string, callback: (row: T | null) => void): () => void;

  // ─── Lazy Loading ────────────────────────────────────

  /** Bulk-load rows into the local store (for lazy tables). Merges by default. */
  load(rows: InsertInput<T, TPrimaryKey>[], options?: { replace?: boolean }): void;

  /** Clear all rows from this table in the local store. No server delete. */
  clear(): void;
}
```

`InsertInput<T>` and `InferInsert<typeof table>` are exported from
`@zero/framework/react` and `@zero/framework/schema`. They make only the
generated primary key optional. For a hand-written row type with a custom key,
name it explicitly: `client.collection<Account, 'account_id'>('accounts')`.

### Natural Identity Collections

ReactiveDB-managed sync tables use one single-column `TEXT` or `INTEGER`
affinity primary key. Zero's default generated sync key uses `TEXT`, and both
accepted storage forms cross Sync as canonical string row IDs. Explicit
`INTEGER` values must remain JavaScript safe integers. For join tables or
relationship tables that would normally have a composite primary key, declare
a natural identity in the table schema:

```ts
export const membershipTable = defineTable('memberships', {
  team_id: field.text({ required: true }),
  user_id: field.text({ required: true }),
  role: field.text(),
}, {
  pk: 'membership_id',
  identity: ['team_id', 'user_id'],
});
```

The collection can then derive and use the deterministic sync id from the
identity fields:

```ts
const memberships = client.collection('memberships');
const key = { team_id: 'team-1', user_id: 'user-1' };

memberships.insert({ ...key, role: 'admin' });
memberships.getByIdentity(key);
memberships.upsertByIdentity({ ...key, role: 'member' });
memberships.updateByIdentity(key, { role: 'admin' });
memberships.deleteByIdentity(key);
```

Identity fields must exist in the schema, cannot be the sync primary key, and
cannot be changed after insert. Identity values must be strings, finite
numbers, or booleans.

### Reads

```ts
const todos = client.collection<Todo>('todos');

// All rows — Record<string, Todo>
const all = todos.getAll();
// { 'abc': { id: 'abc', title: 'Buy milk', done: false }, 'def': { ... } }

// Single row — Todo | null
const one = todos.getOne('abc');
// { id: 'abc', title: 'Buy milk', done: false }

// Filtered — Todo[]
const incomplete = todos.getMany(row => !row.done);
// [{ id: 'abc', title: 'Buy milk', done: false }]

// Count — number
const total = todos.count();
// 2
```

**Reads are local.** They read from the in-memory store, not the server. The store is kept in sync via the WebSocket connection. Reads are synchronous and O(1) for `getOne`, O(n) for `getAll`/`getMany`.

### Mutations

```ts
const todos = client.collection<Todo>('todos');

// Insert — auto-generates UUID PK, no id needed
todos.insert({ title: 'Walk the dog', done: false });

// Update (partial merge)
todos.update('abc', { done: true });

// Delete
todos.remove('abc');
```

**Mutations are optimistic.** Every mutation follows this flow:

```
1. Client calls todos.insert(row)
   │
   ├─► Local store updates immediately (UI re-renders)
   ├─► WebSocket sends sync.mutate { ref, table, op, row }
   │
   ├─► Server authorizes/stamps, validates, then writes to ReactiveDB
   │   ├─► Success: sync.ack { ref, ok: true }
   │   │   └─► Client removes from pending queue. Done.
   │   └─► Failure: sync.ack { ref, ok: false, error: '...' }
   │       └─► Client rolls back to pre-mutation state. UI re-renders.
   │
   └─► Server projects sync.change to eligible authorized subscribers
       └─► Those stores update and their UIs re-render
```

**Rollback on failure:** The client captures the previous state before applying the optimistic change. If the server rejects the mutation (validation error, constraint violation), the client restores the previous state. The UI briefly shows the optimistic state, then snaps back.

**Pending queue:** Each in-flight mutation is tracked with a `ref` (UUID). Mutations to the same row are serialized — the client waits for the first ack before sending the second. This prevents broken rollback chains.

**Timeout:** Mutations not acked within 10 seconds are treated as failures and rolled back.

### Subscriptions

```ts
const todos = client.collection<Todo>('todos');

// Subscribe to all changes
const unsub = todos.subscribe((rows) => {
  console.log(Object.values(rows));
});

// Subscribe to a single row
const unsub2 = todos.subscribeOne('abc', (row) => {
  console.log('Row changed:', row);
  // row: Todo | null (null if deleted)
});

// Cleanup
unsub();
unsub2();
```

Subscriptions are local — they watch the in-memory store, not the server directly. When a `sync.change` arrives over WebSocket, the store updates, and all matching subscriptions fire.

### Lazy Sync

By default, omitted table sync mode is `auto`: startup counts rows and keeps
small tables in full sync, then auto-resolves oversized tables to lazy sync.
Explicit `sync: 'full'` and `sync: 'lazy'` always win. Auto decisions are saved
in the app database so a table does not flip back and forth between modes.

**Declare a lazy table:**

```ts
import { defineTable, field } from '@zero/framework/react';

export const attendanceTable = defineTable('attendance', {
  group_id: field.text({ required: true }),
  date: field.date({ required: true }),
  present: field.boolean(),
}, { sync: 'lazy' });
```

**Load data with `useLazyCollection`:**

The platform auto-registers `GET /api/data` for resolved lazy tables. Use the `useLazyCollection` hook:

```tsx
import { useLazyCollection } from '@zero/framework/react';

function GroupAttendance({ groupId }: { groupId: string }) {
  const { data, isLoading, error, refresh } = useLazyCollection(
    'attendance',
    { group_id: groupId },
    { order: 'date', dir: 'desc', limit: 50 }
  );

  if (isLoading) return <p>Loading...</p>;
  return <ul>{data.map(a => <li key={a.id}>{a.date}</li>)}</ul>;
}
```

Filter format is `Record<string, string>` (object), not tuple arrays.

For manual lazy reads, `GET /api/data` accepts:

```text
table=attendance
filter=group_id:abc
filter=date:gte:2026-01-01
order=date
dir=desc
limit=50
offset=0
```

Filters are repeatable and ANDed together. `field:value` is equality; explicit
operators are `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `like`, `contains`, and
`in`. The response is `{ rows, page }`, where `page` includes `limit`, `offset`,
`count`, `hasMore`, and `nextOffset`.

The endpoint validates table/column names, parameterizes values, caps result
size, and enforces the same sync read policy used by WebSocket subscriptions.
When a lazy table is registered with `defineResource()`, it must permit HTTP
(`http` or `all`) for `/api/data`; if it also participates in lazy Sync, use
`exposure: 'all'`. The endpoint enforces that resource's `list` policy and
applies safe owner constraints to the SQL query. Tenant realms are always
ANDed into those constraints. After an asynchronous resource policy, the
endpoint re-resolves the bearer and trusted policy properties, then repeats
the durable authority/property check inside the same SQLite transaction as the
resource query; changed authority fails closed without reading resource rows.
Add SQLite indexes in migrations for columns used heavily in `filter`, `order`,
or policy constraints.

Registered resource policy also affects WebSocket sync. A resource whose
`list` policy allows all rows uses the normal full-sync fast path. A resource
whose `list` policy returns row constraints, such as owner-only data, uses a
per-connection row filter for snapshots, catchup, and live changes. Direct
optimistic mutations still go through WebSocket, but registered resources
evaluate `create`, `update`, and `delete` policy on the server before the write
is accepted. Registered creates cannot replace an existing primary key.
Updates/deletes compare the exact row snapshot evaluated by policy, and the
durable authority/property check runs in the same SQLite transaction as the
conditional write.

### Generated Resource Client

`client.resource(name)` wraps generated `/api/resources/:resource` routes with
the same authenticated fetch path as `client.get()` and `client.post()`:

The registered resource must declare `exposure: 'http'` or `exposure: 'all'`.
Resources classified as `internal` or `sync` are deliberately unavailable from
generated HTTP CRUD. Its declared `actions` also bound the operations those
routes accept: omission enables the standard five operations, while explicit
`actions: []` enables none and extra per-action policy keys are rejected.

```ts
const tickets = client.resource<TicketRow>('tickets');

const list = await tickets.list({
  filters: { status: ['new', 'open'] },
  sort: { field: 'created_at', dir: 'desc' },
  limit: 25,
  offset: 0,
});

const ticket = await tickets.get('ticket_123');
const created = await tickets.create({ title: 'New ticket' });
const updated = await tickets.update(ticket.ticket_id, { status: 'closed' });
await tickets.remove(ticket.ticket_id);
```

`list()` accepts the same filter operators, sort shape, `limit`, and `offset`
used by `/api/data`. It returns `{ rows, page }`. `get()`, `create()`, and
`update()` return the row body from the generated resource route. `remove()` is
an alias for `delete()` and returns `{ deleted, id }`.

When the server customizes generated routes:

```ts
const app = await createApp({
  db: { mode: './data/app.db' },
  tables,
  resourceRoutes: { prefix: '/api/clinic/resources' },
});
```

configure the SDK once:

```ts
createClient({
  url: 'http://localhost:3000',
  tables,
  auth: true,
  resourcePrefix: '/api/clinic/resources',
});
```

or override per call:

```ts
client.resource('tickets', { prefix: '/api/clinic/resources' });
```

Use `client.resource()` and `useResourceList()` when the screen should go
through generated resource CRUD routes. Use `client.collection()`,
`useCollection()`, or `useDataPage()` when the screen is primarily reading from
the live ReactiveDB collection store.

### Generated Resource Hooks

The resource hooks add React loading/error state around the generated CRUD
HTTP routes. They do not subscribe to WebSocket changes or mutate the local
collection store.

```tsx
'use client';

import {
  useResourceActions,
  useResourceList,
} from '@zero/framework/react';

function TicketList() {
  const tickets = useResourceList<TicketRow>('tickets', {
    filters: { status: ['new', 'open'] },
    sort: { field: 'created_at', dir: 'desc' },
    pageSize: 25,
  });
  const actions = useResourceActions<TicketRow>('tickets');

  if (tickets.loading) return <p>Loading…</p>;
  if (tickets.error) return <p>{tickets.error.message}</p>;

  return (
    <>
      <button onClick={() => actions.create({ title: 'New ticket' })}>
        Create
      </button>
      {tickets.rows.map((ticket) => <p key={ticket.ticket_id}>{ticket.title}</p>)}
    </>
  );
}
```

The public hooks are:

- `useResourceClient<T>(name, { prefix? })` — returns the vanilla client, or
  `null` before browser hydration.
- `useResourceList<T>(name, options?)` — paginated rows plus filters, sorting,
  loading/error state, page controls, and `refresh()`.
- `useResourceRecord<T>(name, id: string | null, options?)` — one row plus `update()`,
  `remove()`, and `refresh()`.
- `useResourceActions<T>(name, { prefix? })` — create/update/remove actions
  with shared loading/error state.

Set `autoLoad: false` on list/record options to defer the automatic list/get
request. An explicit `refresh()` still loads the current list or record; changing
`autoLoad` back to `true` also enables automatic loading. A custom generated-resource
prefix can be supplied globally with
`ClientConfig.resourcePrefix` or per hook/client through `prefix`.

**Manual load (advanced):**

```ts
const col = client.collection('attendance');
col.load(records);                      // Merge/upsert with existing rows
col.load(records, { replace: true });   // Replace ALL rows with these
col.clear();                            // Empty the local store (no server delete)
```

**Live changes are table-scoped, not query-scoped.** Lazy mode omits the initial
snapshot, while authorized WebSocket inserts and updates for the table are
still applied to the shared local collection by row id. The filters passed to
`useLazyCollection()` affect its `/api/data` load; they are not retained as a
live-query predicate. Deletes remove a matching local row, and resource
row-policy continues to limit what the connection may receive.

Use `useQuery()` to derive a continuously filtered view from the local table,
or use `useDataPage()`/`useResourceList()` when the server result page itself
is the UI source of truth. Multiple filtered lazy hooks share the same local
table, and a filtered `useLazyCollection()` load replaces that table's current
local contents.

---

## Auth

### AuthClient Interface

```ts
interface AuthClient {
  /** Current authenticated user, or null */
  readonly user: AuthUser | null;

  /** Whether a user is currently authenticated */
  readonly isAuthenticated: boolean;

  /** Whether any auth operation is currently loading */
  readonly isLoading: boolean;

  /** Whether a persisted browser session is currently being restored */
  readonly isRestoring: boolean;

  /** Current safe auth error message, or null */
  readonly error: string | null;

  /** Current access token (in memory, never persisted to disk) */
  readonly accessToken: string | null;

  // ─── Actions ─────────────────────────────────────────

  /** Register a new user. Returns a session or auth continuation state. */
  register(params: RegisterParams): Promise<AuthRegistrationResult>;

  /** Log in with username and password. Returns a session or MFA challenge. */
  login(username: string, password: string): Promise<AuthCompletionResult>;

  /** Load the public-safe registration/account/MFA configuration. */
  getConfig(): Promise<AuthPublicConfig>;

  forgotPassword(email: string, nativeContinuation?: string): Promise<void>;
  resendVerificationEmail(email: string, nativeContinuation?: string): Promise<void>;
  verifyEmail(token: string): Promise<AuthCompletionResult>;
  inspectActionToken(token: string): Promise<AuthActionTokenInfo>;
  resetPassword(token: string, newPassword: string): Promise<AuthCompletionResult>;
  setupPassword(token: string, newPassword: string): Promise<AuthCompletionResult>;
  listMfaMethods(): Promise<{ methods: AuthMfaMethod[]; required: boolean }>;

  /** Start MFA setup from a session or setup token. */
  startMfaSetup(params: {
    setupToken?: string;
    method: 'email' | 'totp';
    label?: string;
  }): Promise<AuthMfaSetupStartResult>;

  /** Verify MFA setup. Auth-flow setup returns a full session. */
  verifyMfaSetup(params: {
    verificationToken: string;
    code: string;
  }): Promise<AuthMfaSetupVerifyResult>;

  /** Verify an MFA login challenge and receive the next auth completion result. */
  verifyMfaChallenge(params: {
    challengeToken: string;
    code: string;
  }): Promise<AuthCompletionResult>;

  /** Log out. Revokes refresh token server-side, clears local state. */
  logout(): Promise<void>;

  /** Refresh the access token using the stored refresh token. */
  refresh(): Promise<boolean>;

  /** Change password. Requires current password. Revokes all sessions. */
  changePassword(currentPassword: string, newPassword: string): Promise<void>;

  setProperty(key: string, value: unknown): Promise<void>;
  getProperty(key: string): Promise<string | null>;
  getProperties(): Promise<Record<string, string>>;
  deleteProperty(key: string): Promise<void>;

  getTenantDomainAdministration(signal?: AbortSignal): Promise<AuthTenantDomainAdministration>;
  createTenantDomainClaim(domain: string): Promise<AuthTenantDomainChallengeResult>;
  issueTenantDomainChallenge(claimId: string, expectedRevision: string): Promise<AuthTenantDomainChallengeResult>;
  verifyTenantDomainClaim(claimId: string, expectedRevision: string): Promise<AuthTenantDomainClaimResult>;
  updateTenantDomainPolicy(claimId: string, update: AuthTenantDomainPolicyUpdate): Promise<AuthTenantDomainClaimResult>;
  releaseTenantDomainClaim(claimId: string, input: AuthTenantDomainReleaseInput): Promise<AuthTenantDomainReleaseResult>;
  startDomainOnboarding(identityContinuation?: string): Promise<{ accepted: true }>;
  completeDomainOnboarding(proofToken: string): Promise<AuthDomainOnboardingCompletion>;
  admitDomainOnboarding(continuation: string, identityContinuation?: string): Promise<AuthDomainOnboardingAdmissionResult>;

  // ─── Events ──────────────────────────────────────────

  /** Listen for auth state changes */
  subscribe(callback: () => void): () => void;
}
```

The verified-domain methods are backed by Zero's multi-tenant server route
family. Public config advertises them only when the feature and its
email/public-URL dependencies are operational; otherwise packaged components
fail closed. The administration methods derive tenant scope from Bearer
authority; onboarding start never accepts an email; admission never accepts a
tenant, domain, or role. Claim release requires the current claim and policy
revisions plus an exact normalized-domain confirmation, retires rather than
deletes history, and places cross-tenant reuse in a seven-day quarantine. See
[Verified Company-Domain Onboarding](../auth/verified-domain-onboarding.md)
before implementing a custom screen.

### Register

```ts
const result = await client.register({
  username: 'alice',
  email: 'alice@example.com',
  password: 'secret123',
  firstName: 'Alice',         // optional
  lastName: 'Johnson',        // optional
  organizationName: 'Acme Health', // required at multi bootstrap; optional later
  organizationSlug: 'acme-health', // optional; server derives it when omitted
});

if ('accessToken' in result) {
  // Full session: result.user, result.accessToken, result.refreshToken
}

if ('mfaSetupRequired' in result) {
  // Continue with client.startMfaSetup({ setupToken: result.mfaSetupToken, ... })
}

if (result.tenant) {
  console.log(result.tenant.tenantId, result.tenant.role); // role is 'owner' here
}
```

**RegisterParams:**

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
```

New passwords must contain 8–1024 characters. Login accepts a non-empty
username or email identifier and an existing password up to 1024 characters.
`bootstrapSecret` is only for the one-time installation ceremony. Read
`GET /auth/config`: when `bootstrap.required`, `bootstrap.available`, and
`bootstrap.secretRequired` are true, collect the operator setup key and include
it. The packaged `RegisterForm` does this automatically. Do not persist the key
in browser storage or send it after bootstrap completes.

When public config reports `tenancy.mode: 'multi'`, `organizationName` is
required only while bootstrap is open. It is optional afterward and
`organizationSlug`, when present, is canonicalized with it. Omitting both
registers only the identity and returns onboarding-required with no app
credential after all account-verification gates are satisfied. When email
verification is required, registration returns only the verification state;
`verifyEmail()` produces the onboarding result and any eligible creation proof.
Supplying tenant input requests policy-checked creation; it never requests
membership in an existing tenant.

**What happens:**

1. `POST /auth/register` with credentials, optional post-bootstrap tenant input, and—only during secret-gated setup—`bootstrapSecret`
2. Server rejects invalid setup authority before Argon2 work, then rechecks it inside the serialized registration transaction; successful setup durably closes bootstrap
3. Server hashes the password (Argon2id via `Bun.password.hash()`), then transactionally writes the user and `_credentials`; explicit authorized creation also writes `_auth_tenants` and the protected active `owner` membership
4. During first bootstrap, that transaction also assigns global/platform role `admin` and writes the durable completion marker; any tenant failure rolls everything back
5. If email verification is required, the server returns only the verification state and no tenant-creation proof; after verification, MFA and tenant completion run in order
6. Otherwise the server generates access token (ES256 JWT, 15min TTL) and refresh token (opaque UUID, SHA-256 hashed in `_refresh_tokens`, 7d TTL)
7. SDK stores access token in memory and refresh token in `localStorage` only when a full session is returned
8. The server also sets a signed HttpOnly page-session cookie bound to that refresh session
9. SDK connects/reconnects WebSocket with the new access token — the server gates requested tables and rows using Bearer auth plus the composed Sync/resource policy
10. The SDK auth store adopts the returned user projection; default `createApp()` policy does not expose registrations through a generic `users` table stream

The additive `result.tenant` is a public-safe summary of the organization and
owner membership created by registration. It is not an active-tenant security
credential. After every password/email/MFA gate, Zero issues a tenant-bound web
session only for one live membership; multiple memberships return a typed
selection continuation and zero return onboarding-required. Server-side live
session resolution remains the authority, not this summary.

**Errors:**

| Error | Code | When |
|-------|------|------|
| `Username taken` | `DUPLICATE_USERNAME` | Username already exists |
| `Email taken` | `DUPLICATE_EMAIL` | Email already registered |
| `Invalid auth request` | `AUTH_VALIDATION_FAILED` | Missing, malformed, too-short, or oversized fields |
| `Administrator bootstrap is unavailable` | `BOOTSTRAP_UNAVAILABLE` | Setup is disabled or secret mode has no configured secret |
| `Administrator bootstrap authorization failed` | `BOOTSTRAP_AUTHORIZATION_FAILED` | The setup key is missing or wrong |
| `Bootstrap authorization is only accepted for an empty installation` | `BOOTSTRAP_NOT_REQUIRED` | A caller submits setup authority after bootstrap closed |
| `Registration disabled` | `REGISTRATION_DISABLED` | Ordinary public registration is disabled by app policy |
| `Organization name is required` | `TENANT_NAME_REQUIRED` | Multi-mode bootstrap or an explicit creation request omitted its tenant name |
| `Organization creation is disabled` | `TENANT_CREATION_DISABLED` | Static creation policy is `disabled` |
| `Organization creation requires a platform administrator` | `TENANT_CREATION_FORBIDDEN` | Static creation policy is `platform-admin` and the live identity is not one |
| `Organization URL is already in use` | `TENANT_SLUG_TAKEN` | The explicit or derived organization slug already exists; the user write is rolled back |

### Login

```ts
const result = await client.login('alice', 'secret123');

if ('mfaChallengeRequired' in result) {
  // Show OTP/authenticator prompt, then call client.verifyMfaChallenge(...)
}
```

**What happens:**

1. `POST /auth/login` with username + password
2. Server looks up the user by username or email and verifies the password via `Bun.password.verify()`
3. On success without MFA: generates a new token pair, returns the user record, and sets the page-session cookie
4. On success with MFA: returns `mfaChallengeRequired` or `mfaSetupRequired` without app tokens
5. SDK stores tokens and reconnects WebSocket only after a full session is returned
6. Any `onChange` listeners fire with the user

**Errors:**

| Error | Code | When |
|-------|------|------|
| `Invalid credentials` | `INVALID_CREDENTIALS` | Username/email is unknown or password is wrong |
| `Account is suspended` | `ACCOUNT_SUSPENDED` | The account cannot receive a session |
| `Password change required` | `PASSWORD_CHANGE_REQUIRED` | An administrator requires account recovery before sign-in |
| `Email verification required` | `EMAIL_VERIFICATION_REQUIRED` | The account must consume its verification link first |

### MFA Continuation

MFA setup and challenge responses are not errors. They are typed continuation
states returned before a full app session exists.

```ts
const result = await client.login('alice', 'secret123');

if ('mfaSetupRequired' in result) {
  const setup = await client.startMfaSetup({
    setupToken: result.mfaSetupToken,
    method: 'totp',
  });

  // Show setup.totp.otpauthUrl as a QR code, then collect the first code.
  const completed = await client.verifyMfaSetup({
    verificationToken: setup.verificationToken,
    code: form.code,
  });
}

if ('mfaChallengeRequired' in result) {
  const completed = await client.verifyMfaChallenge({
    challengeToken: result.mfaChallenge.challengeToken,
    code: form.code,
  });
}
```

### Logout

```ts
await client.logout();
```

**What happens:**

1. `POST /auth/logout`, including the refresh token when one is available
2. Server revokes both the supplied refresh token and the refresh session bound to the page cookie
3. Server expires the HttpOnly page cookie
4. SDK waits for that response, then clears access token from memory and refresh token from `localStorage`
5. SDK disconnects WebSocket (no more authenticated subscriptions)
6. `client.user` is `null`, `client.isAuthenticated` is `false`
7. Any `onChange` listeners fire with `null`

Logout is idempotent. It still contacts the server when local token state is
already empty because JavaScript cannot inspect or clear the HttpOnly cookie.

### Refresh

```ts
await client.refresh();
```

**What happens:**

1. Acquires the per-server refresh lock and rereads the current refresh token
   from `localStorage`
2. `POST /auth/refresh` with the refresh token
3. Server verifies: hash matches, not expired, not revoked
4. Server **rotates** — revokes old refresh token, issues new access + refresh pair
5. Server replaces the page cookie with a credential bound to the new refresh row
6. SDK stores the new access token in memory and the new refresh token in `localStorage`
7. The top-level `client.refresh()` resolves after the attempt. If refresh is
   unavailable or rejected, the SDK clears the local session instead of
   surfacing the endpoint's token error.

**Automatic refresh:** The SDK intercepts 401 responses from authenticated
HTTP calls and automatically refreshes before retrying once. The component
never sees a recoverable expired-access-token 401.

**Rotation:** Every refresh call produces a new refresh token and revokes the old
one. Browsers with Web Locks serialize this operation per Zero server across
tabs and workers. A waiter rereads the persisted token after it acquires the
lock, so it does not reuse the token another tab replaced. Without Web Locks,
Zero uses a bounded, expiring `localStorage` bakery lock across tabs when
browser storage is available. The in-process queue is the final
same-JavaScript-realm fallback for runtimes without either facility.
If an old token is still replayed, the server revokes the entire token family.

The lower-level exported `AuthClient.refresh()` returns `Promise<boolean>` so
custom transport code can distinguish success from failure. The top-level
`Client` and `useAuth()` deliberately expose `Promise<void>` and reflect failure
through cleared auth state. They do not throw `TOKEN_EXPIRED`, `TOKEN_REVOKED`,
or `NO_TOKEN` to callers of `refresh()`.

### Session Persistence And Expiry

The access token is short-lived and memory-only. The refresh token is persisted
in `localStorage`, rotated on every refresh, and used to restore the hydrated
browser client. A separate HttpOnly page credential restores identity for the
initial server-rendered document request, before JavaScript can run.

The SDK keeps the user logged in across normal access-token expiry:

1. Startup with a stored refresh token calls `/auth/refresh`, then `/auth/me`.
   `useAuth().isRestoring` is true only for this recovery interval, while
   `isLoading` is also true.
2. Direct and refreshed `GET`/`HEAD` pages can use the server-readable page cookie during SSR.
3. Authenticated HTTP calls that receive 401 refresh and retry once.
4. Sync opens and reconnects with the latest access token instead of a stale token captured at startup.
5. Login, registration, and refresh reconnect sync when the auth token changes.
6. Logout, rejected refresh, revoked refresh token, or unknown 401 clears auth state and resets local synced table/state data.

When auth is enabled, `AppProvider` watches auth state on the client. During
persisted-session restoration it withholds the login subtree, preventing a
login-form flash. After restoration settles, a fully signed-out scope keeps
public login and first-administrator bootstrap UI mounted even if an anonymous
Sync reset has advanced the local authorization-data revision. Authenticated
replacement data remains masked until its live authorization projection is
validated. If the user becomes unauthenticated on a protected route, Zero
removes the protected subtree and redirects to `loginPath` with exactly one
validated, URL-encoded `redirect` return path. The client can retain pathname,
query, and fragment. A direct server response retains pathname and query only,
because fragments are never sent to the server.

After login, or whenever an authenticated user visits the login route, one safe
return path wins; otherwise Zero uses `postLoginPath`, which defaults to `/`.
External, scheme-relative, malformed, duplicate, recursive,
backslash/control-character, and canonicalization-unsafe return values are
ignored. Login paths with equivalent trailing slashes are the same route.
Navigation uses replacement so the login page is not added to browser history.

For protected-first apps, configure public paths in `createApp()`:

```ts
const app = await createApp({
  db: { mode: './data/app.db' },
  tables,
  auth: true,
  routeAuth: 'protected-by-default',
  publicPaths: ['/login', '/register', '/forgot-password', '/reset-password', '/setup-password', '/verify-email'],
  loginPath: '/login',
  postLoginPath: '/dashboard',
});
```

For public-first apps, use route-owned auth boundaries:

```ts
const app = await createApp({
  db: { mode: './data/app.db' },
  tables,
  auth: true,
  routeAuth: 'explicit',
  loginPath: '/login',
  postLoginPath: '/dashboard',
});
```

Then export `config.auth` from protected layouts or pages.

Or override them in the root provider:

```tsx
'use client';

import { AppProvider } from '@zero/framework/react';
import { tables } from '@app/lib/schemas';

<AppProvider
  url={window.location.origin}
  tables={tables}
  auth
  publicPaths={['/login', '/forgot-password']}
  loginPath="/login"
  postLoginPath="/dashboard"
>
  {children}
</AppProvider>
```

`postLoginPath` is a top-level app option and a provider override, not an auth
plugin or raw `createClient()` option. An explicit value may not resolve to the
login route; trailing slashes are equivalent for that comparison. For backward
compatibility, `loginPath: '/'` with an omitted, implicitly `/` post-login path
leaves an authenticated root visit in place instead of looping.

Packaged and custom forms keep their existing success callbacks. When the form
runs on the configured login route inside `AppProvider`, use `onSuccess` for
side effects rather than issuing a second navigation; the provider applies the
validated return path or fallback when auth state changes.

Custom auth pages outside the provider-owned flow can reuse the same local-path
validation rather than reimplementing redirect checks:

```ts
import {
  normalizeAbsoluteLocalPath,
  normalizeConfiguredLocalPath,
} from '@zero/framework/react';

const returnPath = normalizeAbsoluteLocalPath(untrustedRedirect) ?? '/';
const configuredPath = normalizeConfiguredLocalPath('dashboard') ?? '/';
```

Use `normalizeAbsoluteLocalPath()` for untrusted return values because it
requires an already root-relative URL. `normalizeConfiguredLocalPath()` is for
trusted app settings and may add a missing leading slash. Both return `null`
for unsafe input.

### User Record

```ts
interface AuthUser {
  userId: string;
  username: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;                  // 'user' | 'admin'
  status: 'active' | 'suspended';
  passwordChangeRequired: boolean;
  emailVerifiedAt: number | null;
  emailVerificationRequired: boolean;
  mfaRequired: boolean;
  createdAt: number;             // Unix timestamp ms
  updatedAt: number | null;
  properties: Record<string, string>;  // Extensible KV metadata
}

interface AuthTenantSummary {
  tenantId: string;
  kind: 'administration' | 'organization';
  slug: string;
  name: string;
  role: string | null;
}

interface AuthSessionResult {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
  mfaSetupRequired?: false;
  mfaChallengeRequired?: false;
  tenantSelectionRequired?: false;
  tenantOnboardingRequired?: false;
  activeTenant?: AuthTenantSummary;
}

interface AuthPasswordUpdatedResult {
  user: AuthUser;
  passwordUpdated: true;
  signInRequired: true;
}

interface AuthEmailVerificationRequiredResult {
  user: AuthUser & {
    emailVerifiedAt: null;
    emailVerificationRequired: true;
  };
}

interface AuthTenantSelectionRequiredResult {
  user: AuthUser;
  tenantSelectionRequired: true;
  tenantSelection: {
    continuation: string;
    expiresAt: number;
    tenants: AuthTenantSummary[];
  };
}

interface AuthTenantOnboardingRequiredResult {
  user: AuthUser;
  tenantOnboardingRequired: true;
  onboarding: {
    reason: 'no_active_tenant_membership';
    continuation: string;
    expiresAt: number;
    tenantCreation?: {
      allowed: boolean;
      continuation?: string;
      expiresAt?: number;
    };
  };
}

type AuthCompletionResult =
  | AuthSessionResult
  | AuthPasswordUpdatedResult
  | AuthEmailVerificationRequiredResult
  | AuthTenantSelectionRequiredResult
  | AuthTenantOnboardingRequiredResult
  | {
      user: AuthUser;
      mfaSetupRequired: true;
      mfaSetupToken: string;
      mfa: { methods: Array<'email' | 'totp'>; allowUserChoice: boolean };
    }
  | {
      user: AuthUser;
      mfaChallengeRequired: true;
      mfaChallenge: {
        method: AuthMfaMethod;
        challenge?: AuthMfaChallenge;
        challengeToken: string;
      };
    };

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

`POST /auth/register` normally returns a token pair. When
`auth.account.requireEmailVerification` is enabled for a post-bootstrap public
registration, it returns only `user` with `emailVerificationRequired: true`.
Call `verifyEmail(token)` after the emailed link/token is consumed to receive
the next auth completion result. When MFA setup or challenge is required, the
SDK returns `mfaSetupRequired` or `mfaChallengeRequired` and does not persist a
session until the corresponding MFA verification call advances the completion
flow. In multi mode that result can still require tenant selection or tenant
onboarding before Zero issues a tenant-bound session.

Registration specifically returns `AuthRegistrationResult`. In multi mode its
`tenant` field is present only when the request explicitly used the allowed
one-step creation path; it remains a safe description of the created tenant and
owner membership even when email verification or MFA is pending. Ordinary
post-bootstrap registration may omit tenant input. It then returns
`tenantOnboardingRequired` and no access/refresh token once account-verification
gates have passed; eligible results include an expiring one-time creation
continuation. If email verification is pending, registration deliberately
returns no onboarding/creation proof and `verifyEmail(token)` produces a fresh
completion result afterward. Login, verification, and later session operations
continue to use `AuthCompletionResult`.

```ts
const result = await client.login(email, password);
if (isAuthTenantSelectionRequiredResult(result)) {
  await client.selectTenant(
    result.tenantSelection.continuation,
    result.tenantSelection.tenants[0].tenantId,
  );
}

if (isAuthTenantOnboardingRequiredResult(result)
  && result.onboarding.tenantCreation?.continuation) {
  await client.createTenant({
    name: 'Acme Practice',
    continuation: result.onboarding.tenantCreation.continuation,
  });
}

const { activeTenant, createTenant, listTenants, switchTenant } = useAuth();
const choices = await listTenants(); // refresh-family proof, not access-only
const target = choices?.tenants.find((tenant) =>
  tenant.tenantId !== activeTenant?.tenantId
);
if (target) await switchTenant(target.tenantId);

// Signed-in creation uses the current refresh family and activates the result.
await createTenant({ name: 'Another Practice' });
```

Selection continuations expire after five minutes; creation continuations
expire after ten. Both are identity-only, app-bound, stored server-side only as
hashes, and consumed once. Tenant creation commits its protected owner and new
bound session in the same transaction as proof consumption or refresh-family
rotation. Switching rotates the refresh family and replaces/revokes the old
parent session. The browser SDK
freezes writes, rejects stale old-scope HTTP response bodies, purges
Sync/state/ephemeral data, optimistic queues, and Zero-owned hook caches,
discards global overlays, and hides/remounts or reloads the app subtree for the
replacement scope. It reconnects with the new credential and waits for the new
Sync baseline before resolving. App-owned caches should key or purge on
`useAuthorizationScopeBoundary().key`. Old access, page, and refresh
credentials no longer authorize requests.

Refresh-family operations—including tenant listing, even though listing does
not itself rotate the proof—are coordinated across browser tabs. Zero derives a
credential key, sanitized signal key, channel name, and lock name from the
normalized Zero server URL, so multiple Zero apps sharing an origin do not
consume one another's session. Refresh, tenant creation/switching, and logout
use Web Locks when available; a bounded, expiring `localStorage` lock is the
fallback. Each operation re-reads the committed credential after acquiring the
lock, preventing a proof-only list from arriving after a concurrent rotation
and preventing two tabs from replaying the same rotating refresh token.
Cross-tab messages contain only an opaque scope id, revision, and transition
kind—never an access or refresh token.

Every received logout or scope-replacement signal passes through the same
authorization purge barrier before that tab restores a bearer and reconnects
Sync. Late 401 responses and stale signals are revision-checked and cannot
clear a newer session. Zero adopts the former global refresh-token key once
into the URL-scoped record for upgrade compatibility, then removes the legacy
copy.

If the server commits a tenant creation/switch but the replacement Sync
baseline times out, Zero keeps the new credentials. The promise rejects with
`AuthSessionSynchronizationError` (`committed` and `recoverable` are both
`true`) and `client.sessionTransition` / `useAuth().sessionTransition` reports
`recovery-required`. Retry only the local reconciliation barrier—do not repeat
the server mutation:

```ts
try {
  await client.switchTenant(nextTenantId);
} catch (error) {
  if (error instanceof AuthSessionSynchronizationError && error.committed) {
    await client.reconcileAuthSession();
  } else {
    throw error;
  }
}
```

Native/mobile clients use the same server-side tenant-session contract through
the credential-owning TypeScript native SDK. The independent Rust/Tauri and
Chrome-extension packages also implement list/switch behavior, but remain
private `0.0.0` previews rather than published, production-approved artifacts.
See [Native App Authentication](../auth/native-app-auth.md).

Use `isAuthEmailVerificationRequiredResult(result)` to narrow the registration
continuation without probing token fields manually.

### Token Storage

| Token | Storage | Why |
|-------|---------|-----|
| Access token | In-memory only (JS variable) | Short-lived (15min by default). It is not persisted by Zero, but JavaScript executing through XSS can still read application memory or make authenticated requests. |
| Refresh token | URL-scoped, revisioned record in `localStorage` | Long-lived (7d by default), survives page refresh, and is serialized across tabs. Server stores only the SHA-256 hash. XSS can steal this browser copy, so CSP, output encoding, dependency hygiene, and refresh rotation/revocation remain essential. |
| Page session | Signed JWT in a host-only HttpOnly `SameSite=Lax` cookie | Lets SSR authenticate direct safe page navigation before JavaScript runs; validation is bound to the live refresh row and current user. |

The credentials intentionally have separate jobs. The page cookie is accepted
only for matched `GET`/`HEAD` pages. APIs, mutations, `route.ts` handlers, and
WebSocket sync still require the in-memory Bearer access token, avoiding a new
ambient-cookie CSRF boundary for data changes.

---

## Real-time

Real-time is not a separate feature — it's built into every collection read. When you call `todos.getAll()`, you're reading from a local store that's kept in sync via WebSocket. When another client writes, your store updates, your subscriptions fire.

### How It Works

```
Server (ReactiveDB)                           Client (SyncStore)
┌─────────────────┐                          ┌─────────────────┐
│ todos table     │                          │ todos store     │
│ ┌─────────────┐ │   sync.change            │ ┌─────────────┐ │
│ │ id:abc      │ │ ──────────────────────►  │ │ id:abc      │ │
│ │ title:Milk  │ │   (WebSocket)            │ │ title:Milk  │ │
│ │ done:0      │ │                          │ │ done:0      │ │
│ └─────────────┘ │                          │ └─────────────┘ │
│                 │   sync.mutate            │                 │
│                 │ ◄──────────────────────  │  optimistic     │
│                 │   (WebSocket)            │  apply first    │
└─────────────────┘                          └─────────────────┘
```

1. **Initial sync:** Client connects → sends `sync.subscribe { tables, snapshot, lastSeq }` → server sends `sync.snapshot` for the requested snapshot tables plus current seq number
2. **Live changes:** Server writes → `onChange` fires → policy evaluates each subscribed connection/row → authorized clients receive `sync.change` → local stores update
3. **Client mutations:** Client calls `insert()`/`update()`/`remove()` → optimistic local apply → `sync.mutate` sent over WS → server authorizes, validates, writes, and acks → eligible subscribed clients receive the change
4. **Reconnect:** Client tracks `lastSeq`. On reconnect, sends `sync.subscribe { tables, snapshot, lastSeq }`. Server either replays missed changes (`sync.catchup`) or sends fresh snapshot for the requested snapshot tables if the gap is too large.

### Connection Status

```ts
// Current public status
client.connected; // boolean

// Listen for changes
const unsubscribe = client.onConnectionChange((connected) => {
  console.log(connected ? 'Online' : 'Offline');
});
```

React UIs can use `useStatus()` for the boolean or `useConnectionHealth()` for
the richer auth/sync/pending-mutation health model.

### Reconnect Behavior

| Scenario | Server response | Client behavior |
|----------|----------------|----------------|
| Brief disconnect (gap within ring buffer) | `sync.catchup` — array of missed changes | Apply changes in order, resume |
| Long disconnect (gap exceeds buffer) | `sync.snapshot` — requested snapshot tables | Replace included table state, clear pending entries for those tables |
| Server restart | `sync.snapshot` (runtime epoch changes; retained database seq normally continues) | Resync requested snapshot tables, clear matching pending entries; seq resets only after an explicit destructive server reset |
| Max attempts exceeded | — | `client.connected` remains `false`, reconnection stops, and configured `onError` is called |

Exponential backoff: 1s → 2s → 4s → 8s → ... → 30s max, with 0-20% random jitter to prevent thundering herd.

### Optimistic Update Lifecycle

```ts
// 1. Developer calls:
todos.insert({ id: 'new-1', title: 'Walk dog', done: false });

// 2. Immediately (synchronous):
//    - Store applies the row locally
//    - Any useCollection/subscribe callbacks fire
//    - UI shows the new row

// 3. Asynchronously:
//    - WS sends: { type: 'sync.mutate', ref: 'uuid', table: 'todos', op: 'INSERT', row: {...} }

// 4a. Server accepts:
//    - WS receives: { type: 'sync.ack', ref: 'uuid', ok: true, seq: 43 }
//    - Client removes mutation from pending queue
//    - No UI change (optimistic state was correct)

// 4b. Server rejects:
//    - WS receives: { type: 'sync.ack', ref: 'uuid', ok: false, error: 'title required' }
//    - Client restores previous state from pending queue
//    - UI snaps back (row disappears)
```

### Pending Queue

```ts
interface PendingMutation {
  ref: string;                      // Correlation UUID
  table: string;
  op: 'INSERT' | 'UPDATE' | 'DELETE';
  rowId: string;
  previousState: Row | null;        // For rollback
  optimisticState: Row | null;      // What we applied
  sentAt: number;                   // For timeout detection
}
```

**Rules:**
- Same-row mutations serialized — second mutation waits for first ack
- Timeout at 10s — treated as rejection, rolls back
- `sync.snapshot` clears pending entries and same-row queue tracking only for tables included in the snapshot. Lazy tables omitted from snapshots keep their pending mutations.
- Pending-mutation status is available through `useConnectionHealth()`; it is
  not exposed as a public `client.pending` field.

---

## Ephemeral Collaboration

Ephemeral state is in-memory, TTL-bound collaboration data carried on the
existing Sync WebSocket. Use it for presence, typing, cursors, and drag state;
use tables or State Sync for anything that must survive a server restart.

React apps use `useEphemeral(topic, key, initialValue)` for one value and
`useEphemeralTopic(topic)` for a full topic. The raw `EphemeralClient` remains
provider wiring, but its stable wire failures are exposed through
`useEphemeralErrors()`:

```tsx
'use client';

import {
  useCurrentUser,
  useEphemeral,
  useEphemeralErrors,
} from '@zero/framework/react';

function CanvasCursor({ canvasId }: { canvasId: string }) {
  const user = useCurrentUser();
  const topic = `canvas:${canvasId}`;
  const key = `cursor:${user!.userId}`;
  const [cursor, setCursor] = useEphemeral(topic, key, { x: 0, y: 0 });

  useEphemeralErrors((error) => {
    if (error.topic === topic) console.error(error.code, error.message);
  });

  return <button onClick={() => setCursor({ x: cursor.x + 1, y: cursor.y })}>Move</button>;
}
```

Auth-enabled apps reject arbitrary shared topic names. Classify app-owned
topics in server config and derive their namespace and writable key from the
verified identity:

```ts
import type { EphemeralTopicPolicy } from '@zero/framework/server';

const ephemeralPolicy: EphemeralTopicPolicy = {
  async authorize({ topic, operation, key, authContext }) {
    const match = /^canvas:([a-z0-9_-]+)$/.exec(topic);
    if (!match || !authContext) {
      return {
        ok: false,
        code: 'EPHEMERAL_TOPIC_UNCLASSIFIED',
        reason: 'Canvas topic is not available',
      };
    }
    if (operation !== 'subscribe' && key !== `cursor:${authContext.userId}`) {
      return {
        ok: false,
        code: 'EPHEMERAL_KEY_NOT_OWNED',
        reason: 'Cursor key must match the authenticated user',
      };
    }
    // Zero scopes this logical namespace below an internal `app:` prefix.
    return { ok: true, namespace: `canvas:${match[1]}`, keyOwnership: 'actor' };
  },
};

const config = {
  db: { mode: 'memory' },
  tables,
  auth: true,
  ephemeralPolicy,
};
```

Zero reserves `presence:<roomId>` and `typing:<roomId>` for current room
members and requires their write/delete key to be
`user:<currentUserId>`. `usePresence(roomId)` and
`useTypingIndicator(roomId)` follow that contract. For a non-room typing scope,
pass an app-owned topic and classify it with `ephemeralPolicy`.

The server authorizes subscribe/set/delete independently, prevents actor-owned
key overwrite/delete, rechecks policy before delivery, and removes a live
subscription when room membership is revoked. Topic/key/value/TTL sizes are
bounded, and aggregate actor/namespace/app memory limits apply even to writes
made without a subscription. Rejected operations produce `ephemeral.error`
with stable codes. See
the [wire protocol](../realtime-sync/realtime-sync/protocol.md#ephemeral-collaboration-channel)
for exact messages and limits.

---

## State (Per-Authorized-Scope User KV)

Server-persisted key-value state per authorized-scope user. It requires no app
schema, app table, or app migration and survives refresh, device switch, and
server restart. Full spec: [State Sync](../state-sync.md).

### Public state API

The raw `StateClient` is internal provider wiring, not a field on the public
`Client` type. React applications use `useServerState()`, `usePreference()`,
`useFormDraft()`, and `useServerStateReady()`:

```tsx
'use client';

import { useServerState } from '@zero/framework/react';

function ThemeButton() {
  const [theme, setTheme] = useServerState('theme', 'light');
  return (
    <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
      {theme}
    </button>
  );
}
```

State mutations are optimistic and durable, and the same user in the same
authorization scope shares updates across devices over the table-sync
WebSocket. A tenant switch changes the entire state keyspace. See
[State Sync](../state-sync.md) for its wire protocol and limits.

---

## React Hooks

React wrappers around the public SDK. Collection/state hooks subscribe through
`useSyncExternalStore`; generated-resource hooks are request-driven and expose
explicit `refresh()` controls.

### Provider

The root client layout is the sole owner of `AppProvider`. Zero's generated
browser entry provides `RouterProvider` and `ErrorBoundary`; it does not add a
second `AppProvider`.

```tsx
'use client';

import { AppProvider } from '@zero/framework/react';
import { tables } from '@app/lib/schemas';
import type { ReactNode } from 'react';

// app/layout.tsx — root layout
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html>
      <body>
        <AppProvider
          url={typeof window !== 'undefined' ? window.location.origin : ''}
          tables={tables}
          auth
        >
          {children}
        </AppProvider>
      </body>
    </html>
  );
}
```

`AppProvider` creates the client internally, auto-extracts what it needs from
the `tables` object, connects the WebSocket, and provides all contexts (sync,
auth, router). `__PLATFORM_CONFIG__` no longer carries `tables`; it carries
runtime server settings such as `auth`, `stateSync`, `loginPath`,
`postLoginPath`, and resolved `tableSyncModes` so omitted provider props and
auto-lazy decisions match the backend.

The live `client.authorization` projection is also scope-aware. In multi mode
`scope` is the active membership; an Administration Organization session may
add `applicationScope` for application-control-plane permissions. Permission
helpers check both, tenant gates check only `scope`, and the opaque revision
changes when either authority plane or the installed registry version changes.
See [Browser Authorization Snapshot and Gates](../auth/browser-authorization.md).

### Hook organization

Zero exposes hooks from `@zero/framework/react`, but the implementation is split
by responsibility:

- `client-context.tsx` owns `ClientProvider`, `useClient`, `useClientMaybe`, and SSR fallback checks.
- `auth-hooks.ts` owns `useAuth`, `useAuthConfig`, `useCurrentUser`, `useRequireAuth`, and `useUserProperty`.
- `authorization-scope-hooks.ts` exposes the credential-free
  `useAuthorizationScopeBoundary` cache/readiness key used by Zero-owned hooks
  and app-owned caches across account or tenant replacement.
- `data-hooks.ts` owns `useCollection`, `useLazyCollection`, `useRow`, `useQuery`, and `useStatus`.
- `data-composition-hooks.ts` owns `useDataPage`, `useRecord`, and `useRecordByIdentity`.
- `resource-client.ts` owns the vanilla generated-resource CRUD client used by `client.resource()`.
- `resource-hooks.ts` owns `useResourceClient`, `useResourceList`, `useResourceRecord`, and `useResourceActions`.
- `data-selection-hooks.ts` owns reusable selected-row state for tables and detail views.
- `mutation-hooks.ts` and `connection-health-hooks.ts` own mutation lifecycle and sync/auth health state.
- `presence-list-hooks.ts` and `typing-indicator-hooks.ts` own display-ready,
  membership-authorized room presence and typing state; `ephemeral-hooks.ts`
  owns generic topic access and stable error observation.
- `preference-hooks.ts` owns `usePreference` and `useFormDraft` over server state sync.
- `workflow-hooks.ts` owns Sync-backed live graph nodes/events/interactions plus
  versioned start, lifecycle, event, and response actions.
- `workflow-run-hooks.ts` owns the composed `useWorkflowRun` helper, including
  version pinning, stable root progress, separate fan-out/delivery progress,
  parallel/wait flags, and selected-run state.
- `workflow-topology-hooks.ts` owns the authenticated, authorization-fenced
  load of one run's immutable presentation topology.
- `src/storage/upload-queue-hooks.ts`, `src/storage/upload-dropzone-hooks.ts`, `src/storage/storage-file-hooks.ts`, and `src/storage/storage-browser-hooks.ts` own storage queue, dropzone, file, and browser composition.
- `src/hooks/*` owns generic React primitives such as `useDisclosure`, `useAsyncAction`, `useDebouncedValue`, `useDebouncedCallback`, `useThrottledValue`, `useClickAway`, `useCopyToClipboard`, `useIdle`, `useOs`, `useTextSelection`, `useMediaQuery`, and `useHotkey`.
- `use-stick-to-bottom` is re-exported directly as `StickToBottom`, `useStickToBottom`, and `useStickToBottomContext` for smooth AI/chat/log panels.

App code should still import from `@zero/framework/react`. Use the lower-level
files only when working inside the platform source. See [Frontend Hooks](./hooks.md).

Torrent workflow actions use the generated authenticated `client.api.workflows`
surface, while `useWorkflow`, `useWorkflowList`, `useWorkflowActions`, and
`useWorkflowRun` compose the safe owner-scoped ReactiveDB projection;
`useWorkflowTopology` adds the sanitized pinned topology over authenticated
HTTP. That live
projection includes status, timing, labels, branch, parent, and fan-out
identity plus ordered event audit rows; it redacts event payloads plus every
workflow instance/step input, output, and raw error. Canonical definitions, scratch memory, interaction
bodies, and coordination state remain server-only. `submitResponse` resolves
to a privacy-safe `WorkflowInteractionSubmissionResult` with the decision
`outcome`, current interaction projection, and optional validator-authored
`rejectionCode`/`publicMessage`; it never exposes the submitted or normalized
response value. Named events can buffer
while a run is paused, but a direct interaction response fails with retryable
HTTP `409` `WORKFLOW_DRAINING`; reuse its stable submission ID after resume. See
[Torrent: Durable Workflows](../workflows.md).

For a visual monitor, join topology `nodes[].path` to live `steps[].node_path`.
Legacy rows normalize that path to `step_id`; fan-out rows share their
definition path and remain distinct by `step_id`/`item_index`; delivery rows
attach through `parent_step_id`. `isWaiting` covers a waiting parallel lane
even when another lane is actively running.

The server-side workflow Sync adapter composes this owner/active-scope-manager
projection with the app's existing resource policy using deny-wins semantics.
It preserves delegate filters, projectors, and delivery-time validators and
binds both authorities into one read fingerprint. Advanced-RBAC
`resolveManagementAccess` must be synchronous: Sync's last check occurs at the
synchronous row-delivery edge, so an async management result makes the
filtered connection non-comparable and admission fails closed. This is a
server integration rule; React hooks require no extra configuration in a
managed `createApp()`.

### useUserProperty

Read and update one current-user KV property through the auth client:

```tsx
const theme = useUserProperty('theme', {
  defaultValue: 'system',
});

void theme.setValue('dark');
```

The server remains authoritative. If a configured property is admin-only,
system-only, or non-editable, user writes are rejected by auth routes. Use this
hook for UI preferences and visibility convenience, not backend authorization.

### useAuthorizationScopeBoundary

App-owned React Query, SWR, custom-store, and other cached state should key or
purge on `useAuthorizationScopeBoundary().key`, discard callbacks captured
under an older key, and hide/freeze scope-sensitive UI while `ready` is false.
The returned `scopeKey`, `dataRevision`, `stable`, and `phase` are opaque local
boundary metadata; the hook contains no credential and is not proof of
authority. `dataRevision` advances for server-detected same-scope auth-context,
table-access, or read-authority changes. Zero purges local rows and grants,
cancels in-flight scoped requests, and keeps the boundary unreadable until a
replacement authorization projection validates. Zero-owned hooks apply the
same boundary internally. See
[Browser Authorization Snapshot and Gates](../auth/browser-authorization.md).

Source-installed components and app-owned async adapters can use the exported
`isAuthorizationScopeCallbackCurrent(currentKey, ready, capturedKey)` helper
before publishing a result. It accepts only opaque boundary state, never a
credential, and returns false while the boundary is not ready or has changed.

### useCollection

Subscribe to a full-sync table. Returns array/map reads plus optimistic mutation functions. Re-renders when the local collection changes.

```tsx
function TodoList() {
  const { data, insert, update, remove } = useCollection<Todo>('todos');

  return (
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
      <button onClick={() => insert({ title: 'New todo', done: false })}>
        Add
      </button>
    </ul>
  );
}
```

**Signature:**

```ts
function useCollection<
  T extends Record<string, unknown>,
  TPrimaryKey extends keyof T & string = PrimaryKeyOf<T>,
>(name: string): CollectionResult<T, TPrimaryKey>;

interface CollectionResult<
  T extends Record<string, unknown>,
  TPrimaryKey extends keyof T & string = PrimaryKeyOf<T>,
> {
  /** All rows as an array. Live, updates on every change. */
  data: T[];
  /** All rows keyed by primary key. */
  byId: Record<string, T>;
  /** Current local row count. */
  count: number;

  /** Optimistic insert. Auto-generates the primary key when omitted. */
  insert(row: InsertInput<T, TPrimaryKey>): void;

  /** Optimistic partial update by primary key. Merges into existing row. */
  update(id: string, partial: Partial<T>): void;

  /** Optimistic delete by primary key. */
  remove(id: string): void;

  /** Load rows into the local store. Used by lazy tables. */
  load(rows: InsertInput<T, TPrimaryKey>[], options?: { replace?: boolean }): void;
  /** Clear local rows without deleting server rows. */
  clear(): void;
}
```

Full-sync tables receive an initial WebSocket snapshot. For large tables, let
Zero auto-lazy the table or mark it lazy and use `useLazyCollection`.

### useLazyCollection

Fetch a lazy table through `GET /api/data`, load the result into the local
collection, then keep loaded rows live through WebSocket changes.

```tsx
function AttendanceList({ groupId }: { groupId: string }) {
  const { data, isLoading, error, refresh } = useLazyCollection<Attendance>(
    'attendance',
    { group_id: groupId },
    { order: 'date', dir: 'desc', limit: 50 },
  );

  if (isLoading) return <p>Loading...</p>;
  if (error) return <p>{error.message}</p>;

  return (
    <ul>
      {data.map(row => <li key={row.id}>{row.date}</li>)}
      <button onClick={refresh}>Refresh</button>
    </ul>
  );
}
```

**Signature:**

```ts
function useLazyCollection<T extends Record<string, unknown>>(
  table: string,
  filters?: Record<string, string>,
  options?: {
    order?: string;
    dir?: 'asc' | 'desc';
    limit?: number;
    offset?: number;
  },
): CollectionResult<T> & {
  isLoading: boolean;
  error: Error | null;
  refresh(): void;
};
```

Filters are sent to `/api/data` as equality filters. The backend validates table
and column names against the schema, enforces sync read policy, caps result
size, and applies configured sorting/pagination.

### useRow

Subscribe to a single row by primary key. Only re-renders when that specific row changes.

```tsx
function TodoItem({ id }: { id: string }) {
  const row = useRow<Todo>('todos', id);
  const { update, remove } = useCollection<Todo>('todos');

  if (!row) return null;  // Row was deleted

  return (
    <div>
      <input
        type="checkbox"
        checked={row.done}
        onChange={() => update(id, { done: !row.done })}
      />
      <span>{row.title}</span>
      <button onClick={() => remove(id)}>Delete</button>
    </div>
  );
}
```

**Signature:**

```ts
function useRow<T extends Record<string, unknown>>(name: string, id: string): T | null;
```

**Re-render behavior:** Only re-renders when this specific row changes. Other rows in the same table changing does not trigger a re-render. Uses referential equality on `store.context[table][id]`.

### useQuery

Filtered local view of a table. The predicate runs against rows already present
in the collection; it does not become a server query.

```tsx
function IncompleteTodos() {
  const incomplete = useQuery<Todo>('todos', row => !row.done);

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

**Signature:**

```ts
function useQuery<T extends Record<string, unknown>>(
  name: string,
  filter: (row: T) => boolean,
): T[];
```

**Re-render behavior:** Any new table-map snapshot causes the hook to render and
recompute the filtered array, including a change to a row that does not match
the predicate. Use a stable predicate to avoid an additional recomputation on
unrelated component renders.

**Important:** The filter function should be stable — wrap in `useCallback` or define outside the component. A new function reference on every render defeats the memoization.

### useStatus

Connection state for the shared SDK WebSocket.

```tsx
function ConnectionIndicator() {
  const { connected } = useStatus();
  return <div className={connected ? 'online' : 'offline'} />;
}
```

```ts
function useStatus(): { connected: boolean };
```

### useServerState

Like `useState`, but persisted on the server and synced across devices.

```tsx
function ThemeToggle() {
  const [theme, setTheme] = useServerState('theme', 'light');

  return (
    <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
      Current: {theme}
    </button>
  );
}
```

```tsx
function IntakeForm() {
  const [formData, setFormData] = useServerState('intake.demographics', {
    name: '', dob: '', address: '', phone: '',
  });

  const updateField = (field: string, value: string) => {
    setFormData({ ...formData, [field]: value });
  };

  return (
    <form>
      <input value={formData.name} onChange={e => updateField('name', e.target.value)} />
      <input value={formData.dob} onChange={e => updateField('dob', e.target.value)} />
    </form>
  );
  // User fills out name. Phone dies. Opens laptop. Name is there.
}
```

**Signature:**

```ts
function useServerState<T extends JsonValue>(
  key: string,
  defaultValue: T,
): [T, (value: T) => void];
```

**Behavior:**
- Same API as `useState` — `[value, setter]`
- `value` reads from the server-synced KV store. Returns `defaultValue` if key doesn't exist.
- `setter` writes through Zero's internal state transport — optimistic,
  persisted, and synced across devices
- Re-renders when value changes (local set OR remote push from another device/tab)
- Uses `useSyncExternalStore` — tear-free reads

Full state sync spec: [State Sync](../state-sync.md).

### useAuth

Full auth state and actions. Reads from AuthContext, mutations call the auth API.

```tsx
'use client';

import { useAuth } from '@zero/framework/react';
import { useState, type FormEvent } from 'react';

function LoginPage() {
  const {
    login,
    isAuthenticated,
    isLoading,
    isRestoring,
    error: authError,
  } = useAuth();
  const [localError, setLocalError] = useState<string | null>(null);

  if (isRestoring) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    const form = new FormData(e.target as HTMLFormElement);
    try {
      await login(form.get('username') as string, form.get('password') as string);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Login failed');
    }
  };

  if (isAuthenticated) return null;

  return (
    <form onSubmit={handleSubmit}>
      <input name="username" required />
      <input name="password" type="password" required />
      {(localError ?? authError) && (
        <p className="error">{localError ?? authError}</p>
      )}
      <button type="submit" disabled={isLoading}>Login</button>
    </form>
  );
}
```

**Signature:**

```ts
function useAuth(): AuthState & AuthActions;

interface AuthState {
  /** Current user record, or null if not authenticated. Reactive — re-renders on change. */
  user: AuthUser | null;

  /** Current live organization binding in multi mode, or null. */
  activeTenant: AuthTenantSummary | null;

  /** Whether a user is currently authenticated. */
  isAuthenticated: boolean;

  /** Current auth loading/error state. */
  isLoading: boolean;
  /** True only while a persisted browser session is being restored. */
  isRestoring: boolean;
  error: string | null;

  /** Observable state for restore, authentication, and tenant-scope replacement. */
  sessionTransition: AuthSessionTransitionState;
}

interface AuthActions {
  /** Register an identity; optional multi-mode tenant input is policy checked. */
  register(params: RegisterParams): Promise<AuthRegistrationResult | null>;

  /** Log in with username/email and password. Returns a session or MFA continuation. */
  login(username: string, password: string): Promise<AuthCompletionResult | null>;

  /**
   * Force a public-auth-config refresh for imperative code.
   * Rejects the original current transport, server, or validation failure.
   */
  getConfig(): Promise<AuthPublicConfig | null>;

  /** Request a password reset email. Does not reveal account existence. */
  forgotPassword(email: string, nativeContinuation?: string): Promise<void>;

  /** Request another verification email. Does not reveal account existence. */
  resendVerificationEmail(email: string, nativeContinuation?: string): Promise<void>;

  /** Verify an email action token. Returns a session or MFA continuation. */
  verifyEmail(token: string): Promise<AuthCompletionResult | null>;

  /** Inspect a setup/reset token without consuming it. */
  inspectActionToken(token: string): Promise<AuthActionTokenInfo | null>;

  /** Complete password reset/setup from an emailed token. */
  resetPassword(token: string, newPassword: string): Promise<AuthCompletionResult | null>;
  setupPassword(token: string, newPassword: string): Promise<AuthCompletionResult | null>;

  /** Current-user MFA methods and enrollment/challenge actions. */
  listMfaMethods(): Promise<{ methods: AuthMfaMethod[]; required: boolean } | null>;
  startMfaSetup(params: { setupToken?: string; method: AuthMfaMethodType; label?: string }): Promise<AuthMfaSetupStartResult | null>;
  verifyMfaSetup(params: { verificationToken: string; code: string }): Promise<AuthMfaSetupVerifyResult | null>;
  verifyMfaChallenge(params: { challengeToken: string; code: string }): Promise<AuthCompletionResult | null>;

  /** Finish a typed tenant-selection continuation. */
  selectTenant(continuation: string, tenantId: string): Promise<AuthSessionResult | null>;
  /** List live memberships using the current refresh family. */
  listTenants(): Promise<AuthTenantListResult | null>;
  /** Create and activate an owned tenant from onboarding or current refresh proof. */
  createTenant(params: AuthTenantCreateParams): Promise<AuthSessionResult | null>;
  /** Replace the current browser session with a target tenant binding. */
  switchTenant(tenantId: string): Promise<AuthSessionResult | null>;

  /** Log out. Revokes server-side refresh token, clears local state. */
  logout(): Promise<void>;

  /** Manually refresh the access token. Usually automatic — call this only if needed. */
  refresh(): Promise<void>;

  /** Retry a recoverable session transition and reconcile authorization-scoped clients. */
  reconcileSession(): Promise<void>;

  changePassword(currentPassword: string, newPassword: string): Promise<void>;
  setProperty(key: string, value: unknown): Promise<void>;
  getProperty(key: string): Promise<string | null>;
  getProperties(): Promise<Record<string, string>>;
  deleteProperty(key: string): Promise<void>;
}
```

**Session user:** `user` comes from the auth session controller and is populated
by login, registration, refresh, and session-restoration responses. It is not
backed by `useRow('users', ...)`; default `createApp()` policy deliberately
keeps identity rows out of generic Sync. Security-relevant admin changes are
enforced by live server verification and session revocation, independent of
what an already-rendered client happens to display.

**Session expiry:** When the refresh token can no longer restore the session,
the hook reflects the cleared auth state. `user` becomes `null`,
`isAuthenticated` becomes `false`, and `AppProvider` redirects protected
client routes to the configured login path with the safe return destination
described above. You can still add local guards when you want a
component-specific fallback:

```tsx
'use client';

// app/dashboard/layout.tsx
import { useRequireAuth } from '@zero/framework/react';
import type { ReactNode } from 'react';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const user = useRequireAuth('/login');
  if (!user) return null;
  return <main>{children}</main>;
}
```

### useAuthConfig

`useAuthConfig()` is the reactive, fail-closed form of the public auth-config
read. Every consumer attached to the same concrete auth client shares one
client-scoped controller, immutable snapshot, and ordinary in-flight request.
Different clients never share config or requests.

```tsx
function RegistrationEntry() {
  const authConfig = useAuthConfig();

  if (authConfig.config === null && authConfig.error !== null) {
    return (
      <button type="button" onClick={() => { void authConfig.reload(); }}>
        Retry registration settings
      </button>
    );
  }

  if (authConfig.config === null && authConfig.isLoading) {
    return <p>Loading registration settings…</p>;
  }

  return authConfig.canRegister ? <RegisterLink /> : null;
}
```

```ts
interface AuthConfigState {
  status: 'unknown' | 'loading' | 'ready' | 'error';
  config: AuthPublicConfig | null;
  isLoading: boolean;
  error: string | null;
  canRegister: boolean;
  bootstrapRequired: boolean;
  reload(): Promise<void>;
}
```

The states have these meanings:

- `unknown`: no usable client snapshot exists yet, including SSR and the
  instant after invalidation. Capability checks remain false.
- `loading`: a request is active. An initial load has `config: null`; a forced
  reload may retain the previous immutable config while the replacement is in
  flight.
- `ready`: `config` is the current immutable public snapshot and `error` is
  null.
- `error`: the latest read failed or auth is disabled. `config` is null and
  `error` contains a browser-safe message, so capability-dependent UI must not
  treat the feature as merely disabled.

`reload()` forces a live read, aborts and fences any superseded request, and
publishes the result to every consumer of that client. Load failures are
reported through frontend auth observability and reflected in state rather
than thrown by `reload()`; callers should render or retry from the published
snapshot. The imperative `useAuth().getConfig()` action performs the same
shared, fenced refresh but preserves the action contract: a successful current
request returns the immutable config, while its original current transport,
server, or response-validation failure rejects to the caller after the safe
error snapshot is published. Superseded imperative refreshes reject with an
`AbortError` and cannot publish stale config. A successful
`useAuth().register()` invalidates the shared snapshot before starting a
best-effort reload, so first-admin bootstrap completion cannot leave
registration policy cached. Public config remains a UI capability hint; server
policy is authoritative for every operation.

### useCurrentUser

Convenience hook — the current session-backed user projection from `useAuth()`.

```tsx
function UserBadge() {
  const user = useCurrentUser();
  if (!user) return null;

  return (
    <div>
      <span>{user.firstName} {user.lastName}</span>
      <span className="badge">{user.role}</span>
    </div>
  );
}
```

**Signature:**

```ts
function useCurrentUser(): AuthUser | null;
```

Equivalent to `useAuth().user`. It subscribes to the same auth-session store and
does not subscribe to the private `users` table.

### SSR Hook Behavior

Zero currently has two route rendering paths rather than a server-rendered
component tree that later hands the same hook state to the browser:

- A page/layout chain with no literal `'use client'` directive is streamed with
  `renderToReadableStream()`. It ships no route JavaScript and is not hydrated.
  Load its initial data in a route loader or server-owned database code.
- If the page or one of its layouts contains `'use client'`, the server runs
  the loader and returns the app shell plus route/platform data. The browser
  imports the generated route manifest and mounts the tree with `createRoot()`.
  `AppProvider` then creates the SDK client, restores auth, and connects Sync.

Frontend hooks return safe empty/default values when invoked during server
render without a browser client, but that is a safety property, not an SSR data
handoff. Put hook-driven pages behind a `'use client'` boundary. Once mounted,
`useCollection()` consumes the Sync snapshot, `useLazyCollection()` performs
its `/api/data` load, and `useServerState()` consumes the state snapshot. In a
browser, using these hooks outside `AppProvider`/`ClientProvider` throws the
provider error.

### useParams

Route parameters from the matched file-based route. See [Router](./router.md).

```tsx
// app/blog/[slug]/page.tsx
export default function BlogPost() {
  const { slug } = useParams<{ slug: string }>();
  return <article>Post: {slug}</article>;
}
```

```ts
function useParams<
  T extends Record<string, string> = Record<string, string>,
>(): T;
```

### usePathname

Current URL pathname. Re-renders on client-side navigation.

```ts
function usePathname(): string;
```

### useRouter

Programmatic navigation. See [Router: Client-Side Navigation](./router.md#client-side-navigation) for the full navigation model.

```ts
function useRouter(): RouterActions;

interface RouterActions {
  /** Navigate to a path, add to history stack. */
  push(path: string): void;

  /** Navigate to a path, replace current history entry. */
  replace(path: string): void;

  /** Go back in history. Equivalent to history.back(). */
  back(): void;

  /** True while loading the next client page and layout modules. */
  isNavigating: boolean;

  /** Preload a registered client page module and its layout modules. */
  prefetch(path: string): void;

  /** Framework integration: update params/navigation state. */
  setParams(params: Record<string, string>): void;
  setIsNavigating(value: boolean): void;
}
```

`push()` and `replace()` update browser history. Zero then loads a matching
client route from the generated manifest. If the target is server-only or is
not in that manifest, the runtime performs a full document navigation.

### Link

Client-side navigation component. It intercepts unmodified left clicks for
internal links. Absolute cross-origin HTTP(S) URLs, `mailto:`, `tel:`, modified
clicks, non-left clicks, and non-`_self` targets retain native anchor behavior.

```tsx
import { Link } from '@zero/framework/react';

<Link href="/dashboard/settings">Settings</Link>
<Link href="/blog/hello-world" prefetch="intent">Read more</Link>
<Link href="/login" replace>Login</Link>
```

**Props:**

```ts
interface LinkProps {
  href: string;
  prefetch?: 'intent' | 'render' | 'none';  // default: 'none'
  replace?: boolean;     // Replace history entry instead of push
  className?: string;
  children: React.ReactNode;
}
```

| Prefetch mode | Behavior |
|---------------|----------|
| `'intent'` | Preload once on `mouseenter` |
| `'render'` | Accepted for compatibility; currently no automatic preload |
| `'none'` | Only load on click |

Call `useRouter().prefetch(path)` for explicit eager preload. `Link` does not
currently prefetch on focus or when it enters the viewport.

---

## Validation

Valibot schemas for validating mutations, route params, and API inputs. One schema validates on both client and server.

### Mutation Validation

Schema-generated tables are validated again on the server. Validate in the UI
as well when you want bad data to be rejected before the optimistic apply.

```tsx
import { useCollection, type InferInsert, type InferRow } from '@zero/framework/react';
import { todoTable } from '@app/lib/schemas';

function AddTodo() {
  type Todo = InferRow<typeof todoTable>;
  const { insert } = useCollection<Todo>('todos');

  const handleAdd = (title: string) => {
    const row: InferInsert<typeof todoTable> = { title, done: false };
    const result = todoTable.schema.validate(row);
    if (!result.success) {
      console.error(result.issues);
      return;
    }
    insert(row); // The collection generates the sync primary key.
  };

  return <button onClick={() => handleAdd('New todo')}>Add</button>;
}
```

For reusable forms, keep validation in the form or action component so invalid
data never enters the optimistic store. The server remains authoritative:
after Sync/resource policy stamping, it rejects unknown input fields, decodes
logical field values, and validates the complete INSERT row. For UPDATE it
merges the partial input with the current stored row and validates the complete
logical result. Primary-key changes are rejected. Validation failures write no
row/change and cause the optimistic client state to roll back.

This automatic logical boundary applies to `defineTable()` and `schema()`
tables. A raw hand-authored SQL table retains its historical SQLite-only
behavior unless server config supplies an explicit mutation validator.

### Route Param Validation

Validate dynamic route segments before the page component renders.

```tsx
// app/blog/[slug]/page.tsx
import * as v from 'valibot';

export const validate = {
  params: v.object({
    slug: v.pipe(v.string(), v.minLength(1), v.maxLength(100), v.regex(/^[a-z0-9-]+$/)),
  }),
};

// params.slug is guaranteed to match the schema — invalid slugs render the not-found page
export default function BlogPost({ params }: { params: { slug: string } }) {
  return <article>Post: {params.slug}</article>;
}
```

The router checks for an exported `validate` object. If present, it validates before rendering. On validation failure, the router renders the `not-found.tsx` page.

### API Route Validation

Validate request bodies in API route handlers.

```ts
// app/api/todos/route.ts
import * as v from 'valibot';
import {
  getSyncDB,
  type LoaderContext,
  type RouteConfig,
} from '@zero/framework/server';

export const config: RouteConfig = { auth: 'required' };

const CreateTodoBody = v.object({
  title: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
});

export async function POST({ request }: LoaderContext) {
  const parsed = v.safeParse(CreateTodoBody, await request.json());
  if (!parsed.success) {
    return Response.json(
      { error: 'Invalid todo', issues: parsed.issues },
      { status: 422 },
    );
  }

  const db = getSyncDB();
  if (!db) {
    return Response.json({ error: 'Database unavailable' }, { status: 503 });
  }

  const change = db.insert('todos', {
    id: crypto.randomUUID(),
    title: parsed.output.title,
    done: 0,
  });
  return Response.json(change.row, { status: 201 });
}
```

File-route handlers own errors they create, so this example uses
`safeParse()` and returns a bounded `422` response explicitly. For larger APIs,
prefer `defineEndpoint()` or `defineRouter()` under `server/`, where Zero's
declared validation schemas run before the handler.

---

## Typed RPC (Eden Treaty)

For requests outside the sync engine — one-off queries, file uploads, streaming, server actions. Eden Treaty generates a fully typed client from the Elysia server type.

```ts
import { useClient } from '@zero/framework/react';

const client = useClient();

// Fully typed — autocomplete for every route, param, response
const { data, error } = await client.api.api.todos.get();
const { data: created } = await client.api.api.todos.post({ title: 'New' });
const { data: transcript } = await client.api.api.sessions[sessionId].transcript.get();

// File values are encoded as multipart FormData by Eden.
const { data: parsed } = await client.api.api.documents.parse.post({ file });
```

Use the `client.api` instance supplied by Zero instead of constructing a
second raw Treaty client. It owns bearer injection, waits for an in-flight
session restore, and retries once with the rotated token after a 401. Multipart
bodies remain multipart on that retry; do not set `Content-Type` manually
because the browser must generate its boundary. Automatic retry applies to
replayable request bodies such as JSON, text, and `FormData`; a one-shot
`ReadableStream` request body cannot be replayed and needs an endpoint-specific
upload protocol instead.

On the server, a protected `defineEndpoint()` or `defineRouter()` multipart
route installs an early auth guard automatically. A missing/invalid Bearer token
(or a non-admin token on `auth: 'admin'`) is rejected during `onRequest`, before
Elysia parses the file body; the normal route guard still protects non-multipart
requests. Nested routers match their complete mounted prefix, while
`auth: false`/`optional` multipart routes remain public.

Raw Elysia upload routes must opt into both halves explicitly:

```ts
import { Elysia, t } from 'elysia';
import {
  createAuthMiddleware,
  createProtectedMultipartRequestGuard,
  getTokenService,
} from '@zero/framework/server';

const uploads = new Elysia()
  .use(createAuthMiddleware(getTokenService))
  .onRequest(createProtectedMultipartRequestGuard(getTokenService, {
    requirement: 'user',
    method: 'POST',
    path: '/api/documents/parse',
  }))
  .post('/api/documents/parse', ({ body, requireAuth }) => ({
    uploadedBy: requireAuth().userId,
    bytes: body.file.size,
  }), {
    zeroAuth: 'user',
    body: t.Object({ file: t.File() }),
  });
```

Register the `onRequest` hook before the route. Use matching `admin` values for
an administrator-only upload. The early hook returns Zero's stable `401`, `403`,
or `503` JSON errors; `zeroAuth` remains the ordinary route guard for every
request. `createApp()`-compiled endpoints use the app-local token service
automatically, avoiding cross-app global service ambiguity.

**When to use sync hooks vs. Eden:**

| Scenario | Use |
|----------|-----|
| Policy-authorized app data that should be live (todos, messages) | `useCollection` / `useRow` — synced automatically |
| Mutation that should be optimistic + live | `insert()` / `update()` / `remove()` from hooks |
| One-off action (send email, trigger export) | Eden RPC |
| File upload | Eden RPC |
| Streaming response (AI generation, large export) | Eden RPC with streaming |
| Data that doesn't need real-time (reports, analytics) | Eden RPC |

When an Eden RPC writes through ReactiveDB, it enters the same change pipeline
as a Sync mutation. Snapshot, catch-up, and live delivery still pass through
the table/resource/row policy, so a server write is not an authorization bypass
or a promise to broadcast the row to every client.

---

## Server Configuration

### createApp

Server-side factory. Wires the configured auth, sync, routing, platform
services, and static assets into one Elysia instance. Most app code should use
`@zero/framework/server` only from server-owned modules.

```ts
import { createApp } from '@zero/framework/server';
import config from '../zero.config';

const app = await createApp(config);

app.listen(3000);
export type App = typeof app;
```

**AppConfig:** Import the public type instead of copying a partial local
interface. `defineZeroConfig()` preserves literal inference and returns the
same object; `createApp()` performs normalization and cross-feature checks.

```ts
// zero.config.ts
import {
  defineZeroConfig,
  type AppConfig,
} from '@zero/framework/server';
import { tables } from '@app/lib/schemas';

const bootstrapSecret = process.env.AUTH_BOOTSTRAP_SECRET;
if (!bootstrapSecret) {
  throw new Error('AUTH_BOOTSTRAP_SECRET is required');
}

const config = defineZeroConfig({
  db: { mode: './data/app.db' },
  tables,
  auth: {
    tenancy: { mode: 'single' },
    authorization: { mode: 'simple' },
    bootstrap: { mode: 'secret', secret: bootstrapSecret },
  },
  stateSync: true,
  syncDefaults: {
    defaultMode: 'auto',
    autoLazy: { rowLimit: 1_000, action: 'lazy', persist: true },
  },
  appDir: './app',
  outDir: './.build',
}) satisfies AppConfig;

export default config;
```

The complete `AppConfig` also includes email, AI, vector, KV, PDF, resources,
generated resource routes, storage, route auth, sitemap, migrations,
observability, Sync policy, and the five app-owned server discovery directory
options. `stateSync: true` requires auth. Omitted capability values resolve to
`single/simple`; all four `single|multi` by `simple|advanced` profiles now
normalize. In Zero 2.0, `multi` installs tenant/membership
persistence, browser and native tenant sessions, creation/onboarding,
registered-resource and managed-service isolation, invitations/join requests,
the protected Administration Organization, the customer-organization
directory/lifecycle, and packaged tenant/platform controls. `advanced` installs the validated static
registry, durable application/tenant assignments, live kernel expansion, and
packaged role administration. Doctor blocks concrete unsafe configuration and
unclassified boundaries; the documented source/local support boundary does not
imply the still-gated public npm or wider deployment matrix.

Zero 2.0 does not include upstream enterprise SSO, break-glass,
tenant-custom roles, broader populated-app discovery/migration tooling beyond
exact pre-024 administration reconciliation, or verified-domain
autojoin/aliases/direct transfer. The Administration Organization and bounded
customer-organization lifecycle are documented in
[Platform Administration Organization](../auth/platform-administration.md).
Registered resources now declare explicit server-owned client
exposure and optional field-level allow-lists across CRUD, `/api/data`, Sync,
caches, and packaged forms. Managed file-mode runtimes sharing a relevant
SQLite plane relay that plane's tracked changes; runtimes sharing `systemDb`
also relay auth/session invalidation. Multi-mode startup
also validates actual non-partial tenant-leading indexes, tenant-scoped business
uniqueness, and composite tenant consistency for foreign keys between
registered tenant resources.

**DDL passthrough:** For a raw table definition, `tables` passes its string
values directly to `ReactiveDB.defineTable()`. Those values **are** SQLite
column definitions. Schema-generated tables additionally carry server-only
logical-validator symbol metadata; it is ignored when ReactiveDB enumerates SQL
columns and when config is serialized. ReactiveDB builds `CREATE TABLE` SQL by
joining the string-valued columns:

```ts
// Config:
tables: {
  todos: { id: 'text primary key', title: 'text not null', done: 'integer default 0' }
}

// ReactiveDB generates:
// CREATE TABLE IF NOT EXISTS todos (id text primary key, title text not null, done integer default 0)
```

**What it wires:**

| Step | Plugin | What it provides |
|------|--------|-----------------|
| 1 | ReactiveDB | Shared in-memory or durable SQLite database |
| 2 | Auth plugin (when enabled) | Routes under `/auth`, including `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/me`, and `/auth/jwks`; auth tables on the shared DB |
| 3 | Auth middleware (when enabled) | `authContext` plus `requireAuth()`/`requireAdmin()` on downstream server routes |
| 4 | Observability plugin | Stable event codes, default console + memory store, protected `/api/_zero/observability/events`, frontend ingest |
| 5 | Scheduler/domain plugins | Scheduler always; notifications, rooms, Torrent workflows, and storage when auth is enabled |
| 6 | Data query plugin | `/api/data` for lazy synced tables with sync read policy |
| 7 | Router plugin | File routing from `appDir`; streaming for server-only chains and browser mounting for `'use client'` chains |
| 8 | Client bundle | `Bun.build()` on startup |

**Plugin order matters.** `createApp()` composes sync first so the shared
ReactiveDB exists for dependent plugins. Auth and auth middleware mount before
domain plugins and observability event reads. Router mounts last as the
catch-all route.

---

## Data Flow: Page Load → Live

```
GET /dashboard
   └─► Router matches the page and layouts
       ├─► Server-only chain (no 'use client')
       │   ├─► run loader
       │   ├─► renderToReadableStream()
       │   └─► send HTML with no route JS or hydration
       └─► Client chain (page/layout has 'use client')
           ├─► run loader
           ├─► send #root shell + __ROUTE_DATA__ + __PLATFORM_CONFIG__ + bundle
           ├─► browser imports page/layout modules and calls createRoot()
           └─► AppProvider restores auth and subscribes to /sync

Live client state
   ├─► Client A: insert() → optimistic → WS sync.mutate
   ├─► Server: authorizes → validates → writes → sync.ack to A → deliver to eligible subscribers
   ├─► Client B: store updates → useCollection re-renders
   └─► No polling. No refetch. No invalidation. Live.
```

---

## Full Example

Four files. Auth, real-time data, optimistic mutations, and a client-rendered
file-based route.

**app/lib/schemas/index.ts:**

```ts
import { defineTable, field } from '@zero/framework/react';

export const todoTable = defineTable('todos', {
  title: field.text({ required: true }),
  done: field.boolean(),
});

export const tables = { todos: todoTable };
```

**app/server.ts:**

```ts
import { resolveConfig, createApp } from '@zero/framework/server';
import { tables } from './lib/schemas';

const config = resolveConfig({
  db: { mode: 'memory' },
  tables,
  // Local demo only. Production should use secret-gated or trusted bootstrap.
  auth: { bootstrap: 'public' },
});

const app = await createApp(config);
app.listen(3000);
export type App = typeof app;
```

**app/layout.tsx:**

```tsx
'use client';

import { AppProvider } from '@zero/framework/react';
import { tables } from './lib/schemas';
import type { ReactNode } from 'react';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html>
      <body>
        <AppProvider
          url={typeof window !== 'undefined' ? window.location.origin : ''}
          tables={tables}
          auth
        >
          {children}
        </AppProvider>
      </body>
    </html>
  );
}
```

**app/page.tsx:**

```tsx
'use client';

import { useCollection, useAuth, useCurrentUser, type InferRow } from '@zero/framework/react';
import { todoTable } from '@app/lib/schemas';

type Todo = InferRow<typeof todoTable>;

export default function Home() {
  const { isAuthenticated, login, register, logout } = useAuth();
  const user = useCurrentUser();
  const { data: todos, insert, update, remove } = useCollection<Todo>('todos');

  if (!isAuthenticated) {
    return (
      <div>
        <h1>Welcome</h1>
        <button onClick={() => register({
          username: 'alice', email: 'alice@test.com', password: 'secret123',
        })}>
          Register as Alice
        </button>
        <button onClick={() => login('alice', 'secret123')}>
          Login as Alice
        </button>
      </div>
    );
  }

  return (
    <div>
      <h1>Hello, {user?.firstName ?? user?.username}</h1>
      <button onClick={() => logout()}>Logout</button>

      <h2>Todos ({todos.length})</h2>
      <ul>
        {todos.map(todo => (
          <li key={todo.id}>
            <input
              type="checkbox"
              checked={!!todo.done}
              onChange={() => update(todo.id, { done: !todo.done })}
            />
            {todo.title}
            <button onClick={() => remove(todo.id)}>x</button>
          </li>
        ))}
      </ul>
      <button onClick={() => insert({ title: `Todo #${todos.length + 1}` })}>
        Add Todo
      </button>
    </div>
  );
}
```

Run `bun app/server.ts`. Open two browser tabs. Register the local demo account,
then add or check off a todo and watch the live optimistic update. This example
uses public first-user bootstrap only to stay self-contained; use a
secret-gated or trusted bootstrap ceremony outside local development.

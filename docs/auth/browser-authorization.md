# Browser Authorization Snapshot and Gates

> Status: supported in Zero 2.0
>
> Last reviewed: 2026-09-29

Zero exposes one narrow, live browser projection for rendering permission-aware
UI. It is a convenience surface, not an authorization boundary. Routes,
resources, Sync, workflows, rooms, notifications, storage, and domain services
must continue to enforce their server-side access declarations.

## Server endpoint

`GET /auth/authorization` requires the normal Bearer session. The auth runtime
rehydrates the account, durable session, tenant membership, authorization
generations, and retained advanced-role assignments before returning the
snapshot. It does not trust a browser-provided tenant, role, permission, or JWT
scope claim.

Both the endpoint and the official transport use `no-store`, so a browser or
intermediary cannot satisfy a live authority read from an HTTP cache.

The same centralized response policy sets `Cache-Control: private, no-store`
and `Pragma: no-cache` on dynamic auth capability discovery and authenticated
current-user, property, MFA, administrator, tenant, onboarding, domain, and
audit GET projections. Public OIDC discovery and `/auth/jwks` are intentionally
outside that private policy; token-bearing OIDC responses retain their own
OAuth `no-store` policy.

```json
{
  "version": 1,
  "identity": {
    "userId": "u_123",
    "platformRole": "user"
  },
  "profile": {
    "tenancy": "multi",
    "authorization": "advanced"
  },
  "scope": {
    "kind": "tenant",
    "scopeId": "ten_admin",
    "tenantId": "ten_admin",
    "membershipId": "tmem_admin",
    "roles": ["administrator"],
    "permissions": ["tenant:read"],
    "allPermissions": false,
    "revision": "..."
  },
  "applicationScope": {
    "kind": "application",
    "scopeId": "application",
    "roles": ["administrator"],
    "permissions": ["application.users:read"],
    "allPermissions": false,
    "revision": "..."
  },
  "revision": "..."
}
```

The response deliberately excludes email, user properties, access/refresh
tokens, session IDs, native client IDs, authentication/security generations,
password/MFA state, and every other credential or policy input. `revision` is
an opaque equality marker, not a credential or optimistic-write token.

`identity.platformRole` is the existing legacy global role. It is not an
advanced application-role assignment and does not supply `applicationScope`.
`scope.roles` and `scope.permissions` are application roles in single-tenant
mode or the active membership's tenant permissions in multi-tenant mode.
`applicationScope` is an additive, nullable projection. In multi mode Zero
populates it only while the active session is bound to the protected
Administration Organization, and only with the membership's live application
authority. Older compatible servers may omit the field. A platform
administrator does not implicitly receive customer-tenant permissions. The
Administration Organization's session summary carries
`kind: 'administration'`; its application authority still does not imply
customer data access. See
[Platform Administration Organization](./platform-administration.md).

The top-level opaque `revision` covers the tenant/application scope revisions
and installed authorization-registry version. A change to either authority
plane invalidates the UI hint even if the active tenant ID is unchanged. The
registry version itself remains server-only.

## Vanilla client

Enable auth on the normal client and read the current projection:

```ts
import { createClient, hasAuthorizationPermission } from '@zero/framework/react';

const client = createClient({
  url: 'https://app.example.com',
  auth: true,
  // Default is 30 seconds while observed. Use 0 to disable interval polling;
  // focus, visibility, online, session, and explicit refresh still revalidate.
  authorizationRevalidationIntervalMs: 30_000,
});

const authorization = await client.getAuthorization();
if (hasAuthorizationPermission(authorization, 'patients:read')) {
  // Show a navigation item. The destination still enforces patients:read.
}

await client.refreshAuthorization();
const unsubscribe = client.subscribeAuthorization(() => {
  console.log(client.authorizationState.status, client.authorization);
});
```

The cache is keyed to the current account, platform role, active tenant, and
exact in-memory bearer. Account replacement and tenant switching synchronously
mask the previous snapshot before the replacement request completes. A request
captures its identity/scope boundary; a response arriving after logout,
account replacement, bearer replacement, or tenant switch is discarded. The
SDK also validates that the returned subject and tenant match its current
session before publishing it.

While observed, the SDK revalidates on window focus, tab visibility, online
events, and the configured interval. Explicit refresh supersedes older pending
reads. A final `401` or `403` clears the snapshot and expires local auth. A
transport/protocol error clears the hint and gates fail closed, but it does not
grant or revoke server authority.

### States

| Status | Meaning | Gate behavior |
|---|---|---|
| `disabled` | Client auth is disabled | denied fallback |
| `unauthenticated` | No current account | denied fallback |
| `loading` | No snapshot exists for the current boundary | loading fallback |
| `refreshing` | Same-boundary snapshot is being revalidated | current snapshot remains usable for UI |
| `ready` | Current snapshot validated | evaluate requested UI condition |
| `error` | Revalidation/protocol failure | denied fallback |
| `revoked` | Server rejected the current authority | denied fallback and local expiry |

## React hooks

```tsx
import {
  isAuthorizationScopeCallbackCurrent,
  useAuthorization,
  useAuthorizationScopeBoundary,
  useHasPermission,
} from '@zero/framework/react';

function PatientNavigation() {
  const authorization = useAuthorization();
  const canRead = useHasPermission('patients:read');

  if (authorization.isLoading) return <NavigationSkeleton />;
  return canRead ? <a href="/patients">Patients</a> : null;
}
```

Available hooks:

- `useAuthorization()` returns the snapshot, status, loading/refreshing flags,
  safe error text, and `refresh()`.
- `useHasPermission(key)` requires one permission.
- `useHasAllPermissions(keys)` requires every non-empty key.
- `useHasAnyPermission(keys)` requires at least one non-empty key.
- `useAuthorizationScopeBoundary()` returns a credential-free boundary for
  partitioning app-owned browser caches across account, tenant, and live
  same-scope authorization changes.
- `isAuthorizationScopeCallbackCurrent(currentKey, ready, capturedKey)` is the
  same pure late-callback fence used by Zero-owned hooks and source-installed
  components.

All permission hooks return `false` before a current snapshot exists and after
error, logout, or revocation. The scope includes every declared key currently
covered by an all-permissions role; `allPermissions: true` never makes an
unknown or misspelled browser key pass.

Permission helpers evaluate the union of `scope.permissions` and
`applicationScope.permissions`. This lets administration-scope navigation use
`application.users:*`, `application.tenants:*`, `application.roles:*`, and
`application.audit:*` hints, including the bounded
`application.tenant-members:manage` control-plane capability, without
flattening those capabilities into the active tenant scope. Tenant
identity/role helpers continue to inspect only `scope`; an application
permission can never satisfy `TenantGate` or grant customer application-data
access.

### App-owned cache isolation

Zero-owned hooks and transports already participate in the browser
authorization barrier. An app that adds React Query, SWR, a custom store, or
another cache must partition or purge that state at the same boundary:

```tsx
import { useEffect } from 'react';
import { useAuthorizationScopeBoundary } from '@zero/framework/react';

function CurrentScopeResults() {
  const boundary = useAuthorizationScopeBoundary();

  useEffect(() => {
    appCache.removeWhere((entry) => entry.scopeKey !== boundary.key);
    cancelAppRequestsFromOtherScopes(boundary.key);
  }, [boundary.key]);

  if (!boundary.ready) return null;
  return <Results cacheKey={`${boundary.key}:results`} />;
}
```

`key` changes synchronously when old results must stop rendering, including
initial session restoration, logout, account replacement, tenant switching,
transition phases, and a live Sync close that reports `Auth context changed`,
`Sync access changed`, or `Sync read authority changed`. Those Sync cases may
keep the same account and tenant identity, so Zero increments the separate
monotonic `dataRevision`, cancels in-flight scoped HTTP work, drops the current
authorization hint, and purges local Sync rows before reconnecting. The key
changes again when replacement authorization becomes readable; late results
captured under either older key remain rejected.

An anonymous Sync reset can advance `dataRevision` too. Once stored-session
restoration and any explicit scope transition have settled, a signed-out scope
keeps public login, registration, recovery, and first-administrator bootstrap
UI readable because it has no authenticated authorization projection to
replace. Ordinary login or registration submission also keeps that anonymous
surface mounted while it reports `loading`. This exception never exposes a
stale authenticated scope: authenticated data remains masked after a purge
until its replacement authorization is `ready` or safely `refreshing`, and
logout/revocation remains masked until the authenticated session is cleared.
Before the first purge, an authenticated `loading` or transient `error` state
does not globally mask the app: the authorization snapshot is only a UI hint,
while server loaders and Sync remain server-authorized and browser permission
gates fail closed. An authenticated `revoked` state is never readable,
including at the initial revision.

Use `key` as the app-cache partition and late-callback fence. Hide or freeze
scope-sensitive UI while `ready` is false. `scopeKey` is the opaque identity of
the committed authorization family and scope; it deliberately remains stable
for a same-scope policy change. `dataRevision` identifies the browser-local
data invalidation generation. `stable`/`phase` describe credential transition
state for diagnostics or richer UX.

When an app-owned async operation captures a boundary key, compare it with the
latest key before publishing the result. The exported
`isAuthorizationScopeCallbackCurrent` helper returns true only when the latest
boundary is ready and still matches that captured key.

The hook exposes no access token, refresh token, session identifier, role, or
permission. Neither key is authority, and neither should be sent to a server
as proof. Server routes and services still derive authority from the live
credential and durable session.

## Packaged gates

Import visibility gates from the browser-safe auth component entry:

```tsx
import {
  AdministrationScopeGate,
  PermissionGate,
  PlatformAdminGate,
  TenantGate,
} from '@zero/framework/components/auth';

<PermissionGate
  permission={['patients:read', 'patients:write']}
  match="all"
  loadingFallback={<ButtonSkeleton />}
  fallback={null}
>
  <EditPatientButton />
</PermissionGate>

<TenantGate role={['owner', 'manager']} fallback={null}>
  <TenantSettingsLink />
</TenantGate>

<AdministrationScopeGate fallback={null}>
  <AdministrationOperationsLink />
</AdministrationScopeGate>

<PlatformAdminGate fallback={null}>
  <GlobalIdentityOperationsLink />
</PlatformAdminGate>
```

`PermissionGate` checks both the active scope and optional administration
`applicationScope` permissions. `TenantGate` requires a live tenant scope and
can optionally narrow by tenant ID or any current tenant role; it never reads
`applicationScope`.
`TenantGate` also accepts `tenantKind="organization" | "administration"`.
`AdministrationScopeGate` is the explicit shorthand for the protected
Administration Organization; it does not grant global identity administration.
`PlatformAdminGate` checks only the legacy global `admin` identity role; it is
intentionally not an alias for tenant ownership, tenant administration, or
Administration Organization application permissions.

`loadingFallback` is used only when no current-boundary snapshot exists.
`fallback` is used for unauthenticated, disabled, denied, error, and revoked
states. During same-boundary background refresh, gates use the retained current
snapshot to avoid periodic UI flicker. Sensitive operations still fail at the
server if authority changes between render and click.

## Framework cache isolation

The official data/resource, mutation, workflow, notification, room/presence,
typing, storage, State Sync, ephemeral, preference, form-draft, and
administration hooks mask old results and fence late work against the shared
authorization boundary. Authenticated HTTP responses are also body-read
guarded: stale bytes cannot become visible merely because headers arrived
before a scope change. Active upload requests are aborted when their scope is
invalidated.

`AppProvider` hides its app subtree during initial restoration and unstable
scope transitions. It discards global modals and toasts at the boundary,
remounts a non-hydrated app under the committed scope, and reloads hydrated
routes so server loaders and page-session policy rerun for the replacement
scope.

`useTenantMembers`, `useTenantOnboardingAdministration`,
`usePlatformAdministration`, and `useTenantSwitcher` key their cached results
by both account ID and active tenant ID. They mask old results during account
replacement—even if both accounts use the same tenant—and during tenant
switches. Independently loaded administration slices, pagination, mutations,
switch completion, and errors carry a monotonic boundary
generation, so late work from the previous account or tenant cannot update the
new UI. Packaged tenant-management blocks are also remounted at that boundary,
clearing local selections, confirmations, errors, and one-time invitation
tokens before a replacement account or tenant can render.

The packaged tenant switcher contains rejected operations because the hook has
already published their error; it announces and invokes `onSwitched` only after
a successful committed switch. Tenant-selection forms reset selection/error
state when the one-time continuation or offered tenant list changes.

## Security rules

- Treat the entire browser snapshot as display data controlled by the server,
  not as proof to send back with a mutation.
- Never authorize an API because a gate rendered its children.
- Never accept a browser tenant ID as the target of a tenant-scoped operation;
  use the bearer-bound scope.
- Do not store the snapshot with credentials or use its revision as a bearer.
- Keep permission declarations on server routes/resources/services even when
  the matching button is wrapped in `PermissionGate`.

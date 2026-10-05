---
id: zero.frontend.guardian.authorization-gates
type: reference
audience: [developer, agent]
owner: guardian
status: draft
visibility: internal
system: guardian
feature: visibility-and-authority-hints
maturity: supported
applies_to: ["2.1.1 source; new documentation under review"]
modes: [single-simple, single-advanced, multi-simple, multi-advanced]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Authorization Gates And Permission Hooks

[Guardian frontend index](./index.md) · [Documentation index](../../index.md)

Gates decide which React children to render. They do not protect endpoints,
grant permissions, prevent a manually issued request, or authorize a Fabric
database. Declare the corresponding requirement in the
[backend authorization policy](../../backend/guardian/authorization.md).

## Choose The Right Predicate

| Question | UI surface | What it checks |
| --- | --- | --- |
| Is there a signed-in user? | `SignedIn`, `SignedOut` | Human authentication state, with signed-out content delayed while loading. |
| Does the canonical account have a global role? | `Gate`, `AdminGate`, `useGate` | `user.role`; not an organization membership role. |
| Does a stored user property equal a value? | `PropertyGate`, `HasProperty`, `HasFlag`, `usePropertyGate` | Stored strings compared to stringified allowed values. |
| Does the current scope grant a permission? | `PermissionGate`, `useHasPermission` | Live sanitized authorization projection. |
| Is this the active organization/role? | `TenantGate` | Active tenant scope, optional ID/kind, any requested membership role. |
| Is this the Administration Organization? | `AdministrationScopeGate` | Organization kind; not an automatic platform permission. |
| Is the current global/platform role admin? | `PlatformAdminGate` | Live `identity.platformRole === 'admin'`. |

Prefer permission predicates for configurable capabilities. A role label is
useful when the UI intentionally distinguishes that role; it is not a
substitute for the application's [RBAC contract](../../backend/guardian/rbac.md).
An Administration member may have only an ordinary app role. Use an explicit
application permission for platform actions, not Administration membership alone.

## Permission Gates

```tsx
import { PermissionGate, TenantGate } from '@zero/framework/components/auth';

export function WorkspaceTools() {
  return (
    <TenantGate fallback={<p>Select a workspace.</p>}>
      <PermissionGate
        permission={['documents:read', 'documents:edit']}
        loadingFallback={<p>Checking access…</p>}
        fallback={<p>This workspace does not grant editing access.</p>}
      >
        <button type="button">Edit documents</button>
      </PermissionGate>
    </TenantGate>
  );
}
```

`PermissionGateProps` accepts a string or readonly string array in
`permission`, `match: 'all' | 'any'` (default `all`), `children`,
`loadingFallback` and `fallback` (both default `null`). An empty requirement
array fails closed in both match modes. Loading renders the loading fallback;
denial, logout, fetch failure and revocation render the denial fallback.

The snapshot is a UI hint. A current refresh can retain a ready snapshot
(`isRefreshing` true and `isReady` true). A scope-boundary transition masks the
old snapshot until the new identity/organization projection is safe.
See [authorization boundaries](../runtime/authorization-scope-boundary.md).

## Tenant And Administration Gates

`TenantGateProps` has the same fallbacks and children, plus:

- `tenantId?: string`: require this exact active tenant ID.
- `tenantKind?: 'organization' | 'administration'`: require the active kind.
- `role?: string | readonly string[]`: require any listed current tenant role.
  Omitting `role` only requires a tenant scope; an empty role array denies.

`AdministrationScopeGateProps` omits `tenantKind` and fixes it to
`administration`. It still accepts tenant ID/role narrowing.
`PlatformAdminGateProps` contains only fallbacks/children and checks the
global/platform admin role. Its meaning differs from a specific platform
permission; a delegated access manager should usually be tested with
`PermissionGate` for the required operation instead.

Neither gate switches organizations. Use the current SDK/hooks and
the server's tenant selection process; a client-supplied ID is not authority.

## Account Role And Property Convenience Gates

Import these from `@zero/framework/components/auth`:

```tsx
import { Gate, HasFlag, SignedIn, SignedOut } from '@zero/framework/components/auth';

export function AccountNavigation() {
  return (
    <>
      <SignedOut><a href="/login">Sign in</a></SignedOut>
      <SignedIn><a href="/account">Account</a></SignedIn>
      <Gate allow="admin"><a href="/administration">Administration</a></Gate>
      <HasFlag propertyKey="show_tutorial"><p>Welcome to the tutorial.</p></HasFlag>
    </>
  );
}
```

`GateProps` requires `allow: string | string[]` and children; fallback defaults
to null. `AdminGate` is `Gate allow="admin"`. `useGate(allow)` returns false
without a current user.

`PropertyGateProps` requires `propertyKey` and `allow`, where allowed values
are string/number/boolean or an array. Stored `'true'` matches boolean `true`;
`'1'` matches number `1`; comparison is exact, not JSON parsing or truthiness.
An absent property denies. `HasProperty` is an alias; `HasFlagProps` uses
`value?: boolean` default true. `usePropertyGate(key, allow)` exposes the same
predicate. Self-editable properties must not become trusted backend authority;
read [property ownership](../../backend/guardian/user-properties.md).

`AuthVisibilityGateProps` covers `SignedIn` and `SignedOut` with children and
fallback. `SignedOut` requires both not-loading and not-authenticated, avoiding
a signed-out flash during restoration. `SignedIn` checks authentication only,
not permissions or data-realm readiness.

## Live Authorization Hooks

Import `useAuthorization`, `useHasPermission`, `useHasAllPermissions` and
`useHasAnyPermission` from `@zero/framework/react/hooks`.

`useAuthorization(): UseAuthorizationResult` returns:

| Member | Meaning |
| --- | --- |
| `authorization` | Sanitized `AuthAuthorizationSnapshot | null`, not tokens or a trusted server principal. |
| `status` | Current authorization lifecycle state. |
| `isLoading` | Initial/masked loading, not background refresh. |
| `isRefreshing` | A refresh is in progress. |
| `isReady` | Ready or refreshing with a current usable snapshot. |
| `error` | Current safe lifecycle error string or null. |
| `refresh()` | Promise of a refreshed snapshot or null; rejects if captured scope changed. |

The hook subscribes to the SDK controller. It does not fetch a second account
directory or manufacture role authority from component props. A known client
with managed auth disabled reports disabled; SSR uses an unauthenticated
snapshot. Permission helpers return false without readiness; both array helpers
reject empty arrays.

Use `refresh()` after a deliberate authority-changing operation when that
operation's own hook does not already refresh the relevant projection. Do not
retain a callback across an organization switch and assume its result belongs
to the new scope.

## Verification And Related Guides

Verify signed-out/loading/denied/ready states, organization switching, role
removal and an empty permission list. The server must still reject a manually
issued forbidden request even when no gate is rendered.

- [Authentication hooks](./auth-hooks.md) explain the human session state.
- [Backend RBAC](../../backend/guardian/rbac.md) defines role scopes and grants.
- [Frontend runtime](../runtime/index.md) owns shared boundary/cache retirement.

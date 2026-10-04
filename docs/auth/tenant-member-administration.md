# Tenant Member Administration

> Status: supported in Zero 2.0
>
> Last reviewed: 2026-10-01

Zero's tenant API contract remains separate from global identity
administration. The tenant routes and focused `TenantMemberManagement`
primitive manage only the current session's organization membership and role
assignments; they cannot change a password, email, MFA method, global account
status, platform role, or delete an identity.

The default adaptive `UserManagement`/`PlatformUserManagement` UI composes
that tenant primitive with exact-account detail and the established account
actions only when the live authorization projection grants
`application.users:read`/`application.users:manage`. This is UI composition,
not an authority merge: tenant-only managers never call global account routes,
and every account or membership mutation still reaches its own server-enforced
API family.

The protected Administration Organization also has a bounded cross-workspace
adapter under `/auth/platform/tenants/:tenantId/...`. It reuses this exact
mutation engine, revision/grant/owner invariants, standard errors, and audit
events, but admission requires the three explicit application permissions
documented in
[Platform Administration Organization](./platform-administration.md). The
target tenant ID selects only a membership control-plane target; it never
turns the platform actor into a customer data-plane member.

This surface exists only with `auth.tenancy: 'multi'` and works in both
authorization modes:

```ts
auth: {
  tenancy: 'multi',
  authorization: 'simple', // or 'advanced'
}
```

## Authority boundary

Every `/auth/tenant/...` request resolves a live Bearer credential and calls
`access.requireTenant()`. The server derives `tenantId`, `membershipId`, user,
roles, permissions, and authorization generations from that live scope. No
member-administration route accepts a tenant ID in its path, query, or body.
Unknown input cannot redirect an operation to another organization.

Membership IDs are still untrusted opaque input. Before every mutation, the
service checks that the target membership belongs to the derived active
tenant. A membership ID copied from another tenant receives the same `404`
shape as a missing member.

Responses expose only this safe identity projection:

```ts
interface AuthTenantMember {
  membershipId: string;
  identity: {
    userId: string;
    username: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  };
  status: 'active' | 'suspended' | 'removed';
  roles: string[];
  roleRevision: string;
  joinedAt: number;
  updatedAt: number;
}
```

Global role/status, password gates, verification state, MFA state, user
properties, credentials, tokens, and security metadata are intentionally
absent.

## Routes

All routes require a current tenant-bound Bearer access token.

| Method and route | Required authority | Behavior |
|---|---|---|
| `GET /auth/tenant/config` | active tenant membership | Returns safe tenant metadata, current actor authority/capabilities, and static role metadata |
| `GET /auth/tenant/members` | `tenant.members:read` | Search and cursor-page safe member projections |
| `POST /auth/tenant/members` | `tenant.members:manage`; non-default roles also require `tenant.roles:manage` | Adds an already-existing account by exact canonical email |
| `PATCH /auth/tenant/members/:membershipId` | `tenant.members:manage`; role changes also require `tenant.roles:manage` | Suspends/reactivates membership and/or replaces assignable roles |
| `DELETE /auth/tenant/members/:membershipId` | `tenant.members:manage` | Marks a retained membership `removed`; it does not delete the identity |
| `POST /auth/tenant/ownership/transfer` | `tenant.roles:manage` plus the caller's live `owner` membership | Atomically promotes the target and demotes the caller |

The list route accepts:

```ts
{
  limit?: number; // 1..100, default 50
  cursor?: string; // opaque; use page.nextCursor unchanged
  search?: string; // email, username, first name, or last name
  status?: 'active' | 'suspended' | 'removed';
}
```

Cursor order is deterministic (`joinedAt`, then `membershipId`). Search and
all SQL values are parameterized. An invalid limit, cursor, search, or status
filter returns `422 TENANT_MEMBER_PAGE_INVALID`; direct/headless callers cannot
turn a malformed falsy status into an unfiltered query.

Adding a member does not create an identity or set a password. The email is
canonicalized and must identify exactly one existing account. Missing and
inactive identities fail closed. A retained duplicate membership returns
`409 TENANT_MEMBERSHIP_EXISTS`; re-admission belongs to an explicit onboarding
or invitation flow, not a generic add operation.

The HTTP contract uses one mode-neutral `roles: string[]` field:

```ts
await client.addTenantMember({
  email: 'clinician@example.com',
  // Omit roles for Zero's default `member` role.
});

await client.updateTenantMember(membershipId, {
  status: 'active',
  roles: ['manager'],
  expectedRoleRevision: member.roleRevision,
});
```

On member creation, omitting `roles` selects Zero's default `member` role;
supplying an explicit empty array is invalid. Simple mode accepts exactly one
role, while advanced mode accepts between one and 32 distinct assignable roles.
Creation never silently selects the first element from a multi-role simple-mode
request. The separate platform-administration `addMember` contract requires
explicit administration roles and never applies this customer-role default.

On member update, advanced-mode `roles: []` deliberately removes every
assignable role from an ordinary customer-organization membership; protected
system roles remain untouched. Administration Organization memberships must
always retain at least one explicit app or application-authority role, and simple mode still
requires exactly one role whenever `roles` is changed. The write is one SQLite
transaction; a failed role change rolls back a status change in the same
request. A direct SDK role-set
write must include the member's latest `expectedRoleRevision`; a missing
revision returns `422 TENANT_ROLE_REVISION_REQUIRED`, while an intervening role
write returns `409 TENANT_ROLE_REVISION_CONFLICT` without overwriting it. The
packaged hook supplies the loaded revision automatically and reloads after a
conflict. An update with neither status nor roles returns
`422 TENANT_MEMBER_UPDATE_EMPTY`. Headless callers that supply a status other
than exact `active` or `suspended` receive
`422 TENANT_MEMBER_STATUS_INVALID` before authority or persistence work; the
HTTP schema continues to use Zero's standard `AUTH_VALIDATION_FAILED` for a
malformed JSON field.

Role definitions are static application configuration, but retained
assignments can outlive a definition during a deployment. Such retired keys
remain visible in `roles`, are inert during permission expansion, and can never
be newly granted. Only the current tenant owner may remove them. While a
retired key is retained, other role changes are rejected with
`409 TENANT_RETIRED_ROLE_CLEANUP_REQUIRED`, so cleanup is explicit instead of
silently dropping or preserving stale authority data.

Mutation admission is rechecked at the commit boundary. The Elysia adapter
captures a secret-free reference to the authenticated session; after acquiring
the tenant write lock, the service re-resolves the live session, tenant scope,
membership/assignment revision, account properties, permissions, and role
grant ceiling inside that same transaction. If another process revokes the
session or membership, replaces roles, or changes authority-bearing properties
after request authentication, the mutation makes no write and returns
`409 AUTHORIZATION_CHANGED`. Callers may refresh their session and reload the
control plane before deciding whether to retry.

## Role and ownership safety

`GET /auth/tenant/config` returns each declared role with:

```ts
{
  key: string;
  label: string;
  description?: string;
  permissions: string[];
  allPermissions: boolean;
  system: boolean;
  assignable: boolean;
  grantable: boolean; // evaluated for the current actor
}
```

`assignable` is false for protected system roles. `grantable` additionally
applies the current actor's authority ceiling. A member cannot grant a role
with a permission it does not hold, and only an all-permissions actor can grant
an all-permissions assignable role. This check is server-side; UI filtering is
only a convenience.

`owner` is never accepted by generic role mutation. Ownership changes only
through `/ownership/transfer`, whose source membership is the live caller's
membership rather than request input. The tenancy store promotes the target
first and demotes the caller second in one serialized transaction. The target
must be an active membership whose account can receive a normal auth token:
active, not password-change-gated, and either not verification-gated or already
email-verified. Store preflights and SQLite triggers use that same predicate and
preserve at least one usable owner. Account suspension, password gating,
verification-policy/state changes, and canonical email changes fail when they
would strand an active organization. In advanced mode the
protected owner assignment changes in the same transaction as the retained
membership owner marker, and the former owner retains a regular `member`
assignment. Generic status and removal routes reject owner memberships too;
the caller must transfer ownership before suspending or removing the former
owner.

Suspension, removal, role replacement, and transfer increment the affected
membership authorization generation. Existing browser, page, native/mobile,
Sync, and extension authority that captured the old generation therefore
fails closed on its next server validation. SDK mutation responses include
`actorSessionInvalidated`; when true, the browser SDK clears its local session
and the user signs in again. Ownership transfer always invalidates the caller.

## Browser SDK and hooks

The vanilla client exposes:

```ts
const configuration = await client.getTenantAdministrationConfig();
const firstPage = await client.listTenantMembers({ limit: 25, search: 'ada' });
const nextPage = firstPage.page.nextCursor
  ? await client.listTenantMembers({ limit: 25, cursor: firstPage.page.nextCursor })
  : null;

await client.addTenantMember({ email: 'ada@example.com' });
await client.updateTenantMember(membershipId, {
  roles: ['manager'],
  expectedRoleRevision: member.roleRevision,
});
await client.updateTenantMember(membershipId, { status: 'suspended' });
await client.removeTenantMember(membershipId);
await client.transferTenantOwnership(membershipId);
```

`useTenantMembers()` owns config/member loading, cursor append, errors, and
serialized mutation state for a custom dashboard. `useTenantSwitcher()` loads
refresh-proof-backed tenant choices and performs the same cache/Sync scope
barrier as `client.switchTenant()`.

For Zero's default dashboard chrome, pass the dedicated presentation adapter
straight to `AppShell`:

```tsx
import { AppShell, useTenantAppShellWorkspaces } from '@zero/framework/react';

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const workspaces = useTenantAppShellWorkspaces();
  return <AppShell workspaces={workspaces}>{children}</AppShell>;
}
```

`useTenantAppShellWorkspaces()` is not a second switch implementation. It
projects `useTenantSwitcher()` into the generic AppShell workspace contract,
keeps the server-committed tenant selected, delegates changes to the rotating
tenant-session controller, disables another selection while scope replacement
is pending, and carries retry, live-region, and focus-restoration state through
the shell. It hides a completed one-membership list by default; pass
`{ hideWhenSingle: false }` when the active organization should remain visible.

## Packaged UI

Import the reusable controls from the auth component entry point:

```tsx
import {
  TenantMemberManagement,
  TenantSwitcher,
} from '@zero/framework/components/auth';

export function OrganizationSettings() {
  return (
    <div className="space-y-6">
      <TenantSwitcher />
      <TenantMemberManagement />
    </div>
  );
}
```

`TenantSwitcher` renders only when the public auth config reports multi-tenant
mode and a tenant session is active. It uses the SDK's refresh-family switch,
not a tenant header or caller-selected server scope. It and
`useTenantAppShellWorkspaces()` share the same presentation coordinator, so
apps choose the layout without changing auth behavior.

`TenantMemberManagement` adapts to server capabilities and simple/advanced
authorization. It includes loading, error, no-permission, empty, paginated,
mutation, and confirmation states. Role controls show only actor-grantable
roles. Retired assignments remain visible with an inert warning and an
owner-only removal path; declared-role edits stay disabled until that cleanup
is selected. Concurrent role conflicts reload current state rather than
clobbering another manager's change. Suspension, removal, and ownership
transfer require explicit confirmation. It never renders global password,
email, MFA, platform-role, or identity-deletion controls.

The adaptive `UserManagement`/`PlatformUserManagement` tenant view composes a
focused invitation workflow beside Add member. It opens as Invite when the
actor may issue and as Invitations when issue is unavailable but pending
history is readable. The dialog uses only policy-enabled email/manual delivery,
filters role choices through the actor's live grant ceiling, shows a manual
token only after an explicit manual issue succeeds, and embeds pending
invitation history. That history is requested with `status: 'pending'`, uses
cursor-based Load more (10 records by default), and independently exposes a
confirmed revoke when the actor has invitation-management authority. An
identity or active-tenant scope change closes the dialog, clears manual-token
state, and fences stale mutation results.

The member directory's search is the shared compact `DataTableSearch`, placed
first before status and role controls. It collapses to 112 px and expands to
216 px on focus or for an active query while preserving the existing server
search, debounce, and focus behavior. Existing `UserManagement`,
`PlatformUserManagement`, and `TenantMemberManagement` call sites require no
changes.

Focused layouts can attach the same workflow to the member primitive:

```tsx
import {
  TenantMemberManagement,
  useTenantInvitationAction,
} from '@zero/framework/react';

export function OrganizationMembers() {
  const invitations = useTenantInvitationAction({ pageSize: 20 });

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

`pageSize` is normalized to 1–100. The hook also accepts `label` and
`onInvitationIssued`, and returns `canInvite` plus
`canViewPendingInvitations`. The full `TenantOnboardingManagement` remains the
packaged surface when invitation and retained join-request administration
belong together on one settings page.

The components are dashboard organisms, not routes. The app chooses their
location and protects the containing page; the server permissions remain the
authoritative boundary.

For exact-email invitation issuance, durable email delivery, retained join
request review/re-admission, and the companion `TenantOnboardingManagement`,
`TenantInvitationForm`, and `TenantJoinRequestForm` components, see
[Tenant Invitations and Join Requests](./tenant-invitations-and-join-requests.md).

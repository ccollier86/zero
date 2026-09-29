# Platform Administration Organization

> Status: implemented in the unreleased multi-tenant auth candidate
>
> Last reviewed: 2026-09-29

Zero's multi-tenant profiles create one protected **Administration
Organization** for the people who operate the application. Every later tenant
is a customer organization. The two kinds use the same membership, invitation,
role-assignment, ownership, revision, and audit machinery, but they are not
interchangeable data scopes.

This document is the contract for the administration scope, the customer
organization directory, their browser SDKs and hooks, and the packaged React
controls. Read it with [Zero Auth Philosophy](./zero-auth-philosophy.md),
[Tenant Member Administration](./tenant-member-administration.md), and the
[Auth and Data-Plane Capability Matrix](./auth-data-plane-capability-matrix.md).

## Profile behavior

The Administration Organization exists only when `auth.tenancy` resolves to
`multi`:

| Profile | Bootstrap result | Administration authorization |
| --- | --- | --- |
| `single/simple` | Existing single-application bootstrap; no tenant | Global `user`/`admin` behavior |
| `single/advanced` | Existing single-application bootstrap; no tenant | Application roles and `application.*` permissions |
| `multi/simple` | Protected Administration Organization plus owner membership | Exactly one administration membership role |
| `multi/advanced` | Protected Administration Organization plus owner membership | One or more administration membership roles |

Omitted auth mode remains `single/simple`. Multi-mode bootstrap creates the
first tenant with `kind: 'administration'`, binds the bootstrap identity as its
owner, and establishes the active administration scope. Subsequent creation
produces `kind: 'organization'` customer tenants. Migration `024` adds the kind
discriminator and reconciles a fresh or eligible multi-mode installation.
Pre-024 populated multi-mode installations that cannot be reconciled from
their bootstrap audit history require the exact, operator-selected adoption
workflow below. This does not make tenancy-axis profile changes supported.

### Adopting the administration organization on a pre-024 installation

Migration `024` can automatically mark an existing tenant as the
Administration Organization only when the append-only audit trail identifies
one exact active bootstrap tenant and its active owner. It never guesses from
tenant age, slug, display name, or a global-admin account. If a populated app
has no protected administration tenant after migration, startup fails before
publishing auth services and tells the operator to configure one exact internal
tenant ID:

```ts
auth: {
  tenancy: {
    mode: 'multi',
    administration: {
      adoptTenantId: 'ten_exact_internal_id',
    },
  },
}
```

Before using this one-time selector, back up the database, verify that the
tenant is active, verify its intended owner and retained memberships, and
confirm that it is the organization which should operate the application. On
startup Zero adopts that exact row, writes system-provenance audit evidence,
reconciles its protected owner assignment, and commits the installed profile
and authorization manifest in the same transaction. A missing or inactive ID,
an ID different from an already protected Administration Organization, or a
populated installation with no selector fails startup without partial
adoption. The unique database constraint prevents a second administration
tenant.

After a successful start, keeping the same selector is idempotent; removing it
is also safe because the tenant's protected `kind` is durable and immutable.
Review retained non-owner memberships after adoption: legacy customer roles
remain visible and inert for application authority until they are deliberately
replaced with an administration-only role. This selector is not a
`single`-to-`multi` profile migration, does not discover a candidate, and does
not provide broader guided populated-app adoption. See
[Platform Configuration](../platform-configuration.md#administration-organization-adoption)
and [Releasing Zero](../releasing.md#pre-024-administration-organization-adoption)
for the configuration and deployment procedure.

The administration tenant:

- is server-created and cannot be created, suspended, archived, or converted
  through the customer-tenant lifecycle API;
- is excluded from the customer tenant directory and every customer lifecycle
  target;
- is never selected by accepting a tenant ID in a platform-administration
  request body, query, header, or path;
- cannot own a verified company-domain claim or become an ordinary customer
  data realm; and
- does not grant implicit access to any customer organization's data.

The browser must first switch its durable session to the administration tenant.
Every platform route then rehydrates that active membership and its current
assignment/authorization generations. A stale token, a visible button, or a
caller-supplied organization ID is never authority.

## Permission model

Administration-organization people and invitations deliberately reuse the
tenant-scoped vocabulary:

| Capability | Required permission |
| --- | --- |
| Read administration members | `tenant.members:read` |
| Add an administration member | `tenant.members:manage` **and** `tenant.roles:manage` |
| Change administration-member roles | `tenant.members:manage` **and** `tenant.roles:manage` |
| Suspend, reactivate, or remove an administration member | `tenant.members:manage` |
| Read invitations | `tenant.invitations:read` |
| Issue an invitation | `tenant.invitations:manage` **and** `tenant.roles:manage` |
| Revoke an invitation | `tenant.invitations:manage` |
| Transfer administration ownership | live owner authority **and** `tenant.roles:manage` |

Cross-organization platform work uses explicit application permissions:

| Capability | Required permission |
| --- | --- |
| Browse customer organizations | `application.tenants:read` |
| Inspect safe customer-member projections | `application.tenants:read` **and** `application.users:read` |
| Suspend/reactivate a customer organization | `application.tenants:manage` |
| Create a customer organization and resolve its owner | `application.tenants:manage` **and** `application.users:read` |
| Browse global identities | `application.users:read` |
| Mutate ordinary global identities | `application.users:manage` |
| Create/promote/demote or mutate global-admin identities | the server-projected global-admin management capability |
| Read/manage application roles | `application.roles:read` / `application.roles:manage` |
| Read/manage platform audit retention/export | `application.audit:read` / `application.audit:manage` |

The built-in `administrator` and `access-manager` membership roles are
administration-only. Any configured role that explicitly contains an
`application.*` permission is also administration-only. The server returns
`administrationOnly`, `assignable`, and `grantable` on every role descriptor;
packaged controls obey those projections instead of reconstructing role policy
in the browser. Customer-organization controls do not offer administration-only
roles.

Every newly added or invited non-owner administration member must receive only
explicit administration-only roles; these flows never fall back to the customer
`member` role. Generic role replacement applies the same tenant-kind policy.
For member creation, a missing or empty role set fails with
`AUTHORIZATION_ADMINISTRATION_ROLE_REQUIRED`; a declared customer-only role
uses the same code. An undeclared role fails with
`AUTHORIZATION_ROLE_UNDECLARED`, while the protected `owner` or another system
role fails with `TENANT_OWNER_ROLE_PROTECTED`. Malformed JSON values remain
`AUTH_VALIDATION_FAILED`. The protected `owner` role is
handled only by bootstrap and the dedicated ownership lifecycle: ownership
transfer demotes the former owner to `administrator`, invalidates that actor's
current session, and promotes the target atomically. Retained legacy
customer-only or retired assignments may remain visible for diagnosis but are
never offered for a new administration assignment.

Administration membership is covered by the platform-administrator MFA
requirement. Invitation inspection and acceptance carry a required,
server-derived tenant `kind`, allowing public UI to label this stronger scope
before authentication without revealing private permissions.

`allPermissions` remains scope-relative. A customer owner may have all
permissions within that customer organization without receiving application
permissions or becoming a platform operator.

## Server routes

All routes below require a live authenticated session whose active tenant is
the protected Administration Organization. The administration tenant ID is
never an input.

| Method and route | Result / purpose |
| --- | --- |
| `GET /auth/platform/config` | Active administration identity, `simple`/`advanced` mode, safe role descriptors, and actor-specific capability booleans |
| `GET /auth/platform/members` | Bounded administration-member page |
| `POST /auth/platform/members` | Add an existing identity as an administration member |
| `PATCH /auth/platform/members/:membershipId` | Change status or role assignments with revision fencing |
| `DELETE /auth/platform/members/:membershipId` | Remove a member subject to owner/actor invariants |
| `POST /auth/platform/ownership/transfer` | Transfer protected-organization ownership |
| `GET /auth/platform/invitations` | Bounded administration invitation page |
| `POST /auth/platform/invitations` | Issue an exact-email invitation |
| `DELETE /auth/platform/invitations/:invitationId` | Revoke a pending invitation |
| `GET /auth/platform/tenants` | Search/filter a bounded customer-organization page |
| `POST /auth/platform/tenants` | Create a customer organization and bind its initial owner |
| `PATCH /auth/platform/tenants/:tenantId` | Suspend/reactivate with expected authorization generation |
| `GET /auth/platform/tenants/:tenantId/members` | Read a bounded safe customer-member page |

Customer-member drill-in is intentionally read-only. To manage a customer
organization's memberships, an authorized person switches into that
organization and uses the ordinary active-tenant APIs and
`TenantMemberManagement`. This keeps customer mutations on the same tenant
authority boundary as the rest of the data plane.

Directory and member reads validate the request shape and then revalidate live
application authority before customer-tenant discovery or SQL projection. A
revoked caller therefore receives the same authority failure for existing and
missing customer IDs, without an unauthorized existence probe.

Tenant directory reads represent `active`, `suspended`, and terminal
`archived` rows. Lifecycle mutation accepts only `active` or `suspended`.
Direct/headless tenant and member list calls reject invalid filters with
`PLATFORM_TENANT_PAGE_INVALID` (`422`) before authority or persistence work.
On HTTP routes, values rejected by the Elysia query schema (for example an
unknown status enum or malformed numeric field) use the namespace-wide
`AUTH_VALIDATION_FAILED` contract; semantic values that pass that schema but
fail service validation, such as an invalid opaque cursor, retain
`PLATFORM_TENANT_PAGE_INVALID`. A headless lifecycle value outside the two
mutable statuses fails with `PLATFORM_TENANT_STATUS_INVALID` (`422`) before
authority or persistence work.
Every list cursor, identifier, role, permission, page, and response object is
strictly parsed and bounded by the browser transport; unknown or malformed
server fields fail closed. Lifecycle writes use
`expectedAuthorizationGeneration`, and a generation conflict reloads the
directory before the user retries. Tenant-created/suspended/reactivated success
events publish only after the outermost ReactiveDB transaction commits;
rollbacks and idempotent lifecycle retries emit no false or duplicate success.

## Browser SDK

With auth enabled, the public client exposes `client.platformAdmin`; an
`AuthClient` exposes the same surface as `authClient.platformAdmin`:

```ts
const config = await client.platformAdmin.getConfig();

const organizations = await client.platformAdmin.listTenants({
  status: 'active',
  search: 'acme',
  limit: 25,
});

const created = await client.platformAdmin.createTenant({
  name: 'Acme Health',
  slug: 'acme-health',
  ownerEmail: 'owner@acme.example',
});

await client.platformAdmin.updateTenant(created.tenant.tenantId, {
  status: 'suspended',
  expectedAuthorizationGeneration:
    created.tenant.authorizationGeneration,
});
```

The namespace also provides `listMembers`, `addMember`, `updateMember`,
`removeMember`, `transferOwnership`, `listInvitations`, `issueInvitation`,
`revokeInvitation`, and read-only `listTenantMembers`. Exact request and result
types are exported from `@zero/framework/react`, including
`AuthPlatformAdministrationConfig`, `AuthPlatformRoleSelection`,
`AuthPlatformAddMemberParams`, `AuthPlatformUpdateMemberParams`,
`AuthPlatformUpdateMemberInput`, `AuthPlatformIssueInvitationParams`,
`AuthPlatformTenant`, and `AuthPlatformAdminSdkSurface`. Platform add,
role-replacement, and invitation requests use a non-empty role tuple; direct
role replacement also requires `expectedRoleRevision`. The administration
hook accepts `AuthPlatformUpdateMemberInput` and injects that revision from its
fenced member view. Ordinary tenant `addTenantMember` keeps `roles` optional so
omission can select `member`.

The platform config is intentionally capability-driven. In particular,
`canManageTenants` controls suspend/reactivate, while `canCreateTenants`
captures the stronger tenant-manage plus user-read requirement;
`canReadTenantMembers` captures the combined tenant-read plus user-read
requirement. Clients must not infer one from another.

As with every authenticated Zero transport, session restoration completes
before sending, refresh/retry is centralized, and an authorization-scope fence
prevents a result from an old user or tenant scope from publishing after a
switch. Platform responses contain safe identities and policy descriptions,
not access/refresh tokens, cookies, password material, signing secrets, or
server configuration secrets.

## Hooks

Two self-wired hooks compose the namespace with the active auth boundary:

```tsx
import {
  usePlatformAdministration,
  usePlatformTenants,
} from '@zero/framework/react';

const administration = usePlatformAdministration({
  memberSearch: query,
  memberStatus: 'active',
});

const directory = usePlatformTenants({
  search: organizationQuery,
  selectedTenantId,
  memberStatus: 'active',
});
```

`usePlatformAdministration` owns config, protected-organization members,
invitations, pagination, mutations, and role-revision conflict recovery.
`usePlatformTenants` owns the customer directory, customer lifecycle,
creation, and capability-gated read-only member drill-in. Both hooks clear old
scope data synchronously, ignore late completions, suppress mutation results
after a foreign scope transition, and expose pending/error/reload state.

The administration hook does not collapse unrelated work into one request.
Its protected config, member directory, public invitation policy, and
invitation directory are independently generation-fenced. Use:

- `isLoadingConfig`, `configError`, and `reloadConfig()` for protected config;
- `isLoadingMembers`, `isMutatingMembers`, `membersError`, and
  `reloadMembers()` for people and ownership;
- `invitationPolicyStatus`, nullable `invitationsEnabled`,
  `invitationDelivery`, and `invitationConfigError` for public policy; and
- `isLoadingInvitations`, `isMutatingInvitations`, `invitationsError`, and
  `reloadInvitations()` for invitations.

The older `isLoading`, `isMutating`, `error`, and `reload()` values are
aggregate compatibility fields. A member failure does not clear invitation
data, and an invitation failure does not disable member controls. If public
auth config is unresolved, invitation availability is `null`; if policy is
disabled or config failed, it is `false` and no invitation request is sent.
Retrying invitations also retries a failed public-config load. Server
capabilities and mutation authorization remain authoritative regardless of UI
state.

The remaining result fields stay slice-specific as well:

| Concern | Data and paging | Mutation methods |
|---|---|---|
| protected configuration | `config`, `isLoadingConfig`, `configError`, `reloadConfig()` | none |
| administration members | `members`, `memberPage`, `isLoadingMembers`, `isLoadingMoreMembers`, `membersError`, `loadMoreMembers()`, `reloadMembers()` | `addMember()`, `updateMember()`, `removeMember()`, `transferOwnership()`; `isMutatingMembers` covers only these writes |
| invitation policy | `invitationPolicyStatus`, `invitationsEnabled`, `invitationDelivery`, `invitationConfigError` | none |
| administration invitations | `invitations`, `invitationPage`, `isLoadingInvitations`, `isLoadingMoreInvitations`, `invitationsError`, `loadMoreInvitations()`, `reloadInvitations()` | `issueInvitation()`, `revokeInvitation()`; `isMutatingInvitations` covers only these writes |

`invitationPolicyStatus` is `unresolved`, `enabled`, `disabled`, or `error`.
The nullable `invitationsEnabled` distinguishes unresolved policy (`null`)
from an explicitly enabled feature (`true`) and disabled or failed-closed
policy (`false`). `isAvailable` only means the current session is in an
Administration Organization. It does not imply that protected config loaded
or that the actor has a member, invitation, or ownership capability.

For backward compatibility, the aggregate booleans are logical ORs of the
corresponding slice states, aggregate `error` exposes the first current config,
member, invitation-policy, or invitation error, and `reload()` asks all three
protected slices to reload. Prefer the exact slice fields for new UI so one
failure cannot replace an unrelated panel with a screen-wide error.

## Packaged React controls

Zero exports two ready-to-compose organisms:

```tsx
import {
  PlatformAdministrationManagement,
  PlatformTenantManagement,
} from '@zero/framework/react';

export function PlatformOperations() {
  return (
    <main className="grid gap-8">
      <PlatformAdministrationManagement />
      <PlatformTenantManagement />
    </main>
  );
}
```

`PlatformAdministrationManagement` browses and manages administration members,
invitations, roles, status, and ownership according to projected capabilities.
It selects exactly one role in `multi/simple` and supports bounded multiple
role assignments in `multi/advanced`; both modes require at least one
administration-only role.

`PlatformTenantManagement` browses customer organizations, creates them when
`canCreateTenants` is true, suspends/reactivates them when
`canManageTenants` is true, and presents capability-gated read-only customer
membership detail. Archived organizations remain visible but immutable.
Customer-facing titles, labels, status/search copy, empty states, and lifecycle
actions use the resolved `auth.tenancy.terminology` singular/plural values;
“Platform administration” stays the fixed protected-scope name.

These controls are not pages. The host application owns routing, layout,
branding, and navigation. Both controls:

- render an explicit switch-to-administration message outside that scope;
- omit unauthorized reads and mutation controls rather than using a rejected
  request as feature detection;
- expose labels, descriptions, alerts, polite live status, busy/disabled
  states, confirmation focus restoration, and responsive-safe layouts; and
- remain presentation only—the server reauthorizes every operation.

Global account administration remains a separate surface:
`PlatformUserManagement` browses and, when authorized, manages application
identities, security state, and properties. It now distinguishes read from
manage authority and separately gates global-admin targets. Administration
membership does not authorize password, email, MFA, account suspension, or
identity deletion by itself.

`GET /auth/authorization` keeps the active administration membership in its
ordinary tenant `scope` and projects its live application permissions in the
separate additive `applicationScope`. Browser permission helpers and
`PermissionGate` inspect both; `TenantGate` stays bound to `scope`. This lets
application-user/tenant/role/audit navigation adapt without flattening
control-plane authority into customer tenant permissions. The top-level opaque
revision covers both projections and the installed registry version.

## Session and installed-app compatibility

Browser session summaries and tenant choices carry
`kind: 'administration' | 'organization'`, so switching UI can visibly label
the protected scope. Registration results likewise distinguish the bootstrap
Administration Organization from later customer organizations.

The canonical native tenant wire contract adds the same `kind` discriminator.
The framework TypeScript native client parses it strictly. The standalone
Rust/Tauri and Chrome-extension SDKs are separate unreleased repositories and
must release their matching tenant-kind model/parser updates in lockstep with
this server contract; applications must not pair this branch with an older
strict preview SDK.

## Security checklist

- Mount platform controls only inside an authenticated application shell, but
  still rely on their active-scope and capability gates.
- Never persist or accept an administration tenant ID as independent browser
  authority.
- Do not turn global `users.role`, `allPermissions`, or a customer owner role
  into implicit cross-tenant access.
- Keep customer membership mutation on the active-customer-tenant routes.
- Treat actor-session invalidation after self/ownership changes as a required
  navigation/auth refresh event.
- Preserve expected revision/generation fields on role and lifecycle writes.
- Do not expose the manual one-time invitation token in logs or long-lived UI;
  the packaged invitation control labels its manual-delivery fallback as a
  secret and displays it only from the mutation receipt.
- Retain the durable authorization/control-plane audit for bootstrap,
  membership, invitations, ownership, role, identity, and tenant lifecycle
  changes.

## Deliberately separate work

This implementation does not imply upstream enterprise OIDC/SAML/SCIM, group
mapping, break-glass/support impersonation, tenant-authored runtime custom
roles, broader populated-installation discovery/migration tooling beyond the
exact pre-024 reconciliation above, verified-domain autojoin or direct
transfer, per-tenant database files, or cross-host replica coordination. Those
remain separately designed capabilities; they are not silently simulated by
the Administration Organization.

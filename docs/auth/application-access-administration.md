# Application Access Administration

> Status: implemented in this unreleased candidate
>
> Last reviewed: 2026-09-28

Zero's `single/advanced` profile has an implicit application authorization
scope. It does not create a fake organization or reuse global account
administration. The application access control plane assigns declared
application roles while `PlatformUserManagement` continues to own passwords,
MFA, account status, and the global `users.role` field.

## Enable the profile

```ts
createApp({
  auth: {
    tenancy: 'single',
    authorization: {
      mode: 'advanced',
      permissions: {
        'documents:read': { label: 'Read documents' },
        'documents:write': { label: 'Edit documents' },
      },
      roles: {
        reader: { permissions: ['documents:read'] },
        editor: {
          permissions: ['documents:read', 'documents:write'],
        },
        'document-access-manager': {
          permissions: [
            'application.roles:read',
            'application.roles:manage',
            'documents:read',
          ],
        },
      },
    },
  },
});
```

Zero adds two immutable framework permissions in this profile:

- `application.roles:read` reads safe identities, role templates, and retained
  application assignments.
- `application.roles:manage` changes assignable roles.

The protected framework `owner` role has every declared permission and can
only move through the ownership-transfer operation. The built-in
`access-manager` role contains the two application administration permissions.
Zero also enforces a grant ceiling: an actor may change a role only when every
permission in that role is already inside the actor's authority. Create a
delegated manager role containing the application permissions it is allowed to
grant, as in the example above.

Fresh installations atomically assign `owner` to the bootstrap user. When an
existing single-tenant installation first enables advanced authorization,
configure one exact `auth.authorization.ownerAdoption.userId` or `.email`.
Startup fails closed rather than guessing from the global platform-admin role.
The selector is consulted only while the installation is ownerless, so leaving
it configured cannot re-grant a prior owner after an ownership transfer.
Bootstrap registration stays receipt-bound until downstream session and token
provisioning finishes. If that work fails, Zero removes only the matching
pending bootstrap-owner assignment and user in the same rollback transaction;
finalized and ordinary owners remain protected by the last-owner trigger.

## HTTP contract

The following routes exist only for `single/advanced`:

| Method | Route | Required authority |
| --- | --- | --- |
| `GET` | `/auth/application/config` | `application.roles:read` |
| `GET` | `/auth/application/users` | `application.roles:read` |
| `PATCH` | `/auth/application/users/:userId/roles` | `application.roles:manage` plus the live grant ceiling |
| `POST` | `/auth/application/ownership/transfer` | current application `owner` |

The list route supports bounded `limit`, opaque cursor, `search`, and
`active`/`suspended` status filters. Responses expose user ID, display identity,
email, account availability, role keys, the opaque `roleRevision` concurrency
token, and timestamps. They never expose
password state, MFA state, verification state, properties, credentials,
tokens, or the global platform role. Invalid limit, cursor, search, or status
values fail with `APPLICATION_USER_PAGE_INVALID` (`422`), including malformed
falsy values from a direct/headless caller.

The config response is capability-driven and safe to render directly:

```ts
{
  authorization: 'advanced',
  actor: {
    userId: string,
    roles: string[],
    permissions: string[],
    allPermissions: boolean,
  },
  capabilities: {
    canReadUsers: boolean,
    canManageRoles: boolean,
    canTransferOwnership: boolean,
  },
  roles: Array<{
    key: string,
    label: string,
    description?: string,
    permissions: string[],
    allPermissions: boolean,
    system: boolean,
    assignable: boolean,
    grantable: boolean,
  }>,
}
```

All application-administration responses are private and non-cacheable, and
the browser transport also bypasses the HTTP cache for this control plane.

`PATCH .../roles` accepts `{ roles, expectedRevision }`, where
`expectedRevision` is the target user's latest `roleRevision`, and returns
`{ user, actorAuthorizationChanged }`. A stale whole-set write fails with
`APPLICATION_ROLE_REVISION_CONFLICT` (`409`) instead of overwriting another
administrator's committed change. Ownership
transfer returns `{ owner, previousOwner, actorAuthorizationChanged: true }`.
The flag describes a committed change to the caller's live authority; it is
not a signal that the user was logged out.

Role replacement accepts the complete desired set of assignable role keys. A
literal `roles: []` is the only deliberate clear operation. Zero never turns a
sparse array, non-string or malformed key, blank value, or duplicate into a
smaller grant set by filtering or deduplicating it. Direct/headless service
calls reject those values with `APPLICATION_ROLE_SELECTION_INVALID` (`422`);
requests rejected earlier by the HTTP schema retain Zero's standard
`AUTH_VALIDATION_FAILED` contract. System roles are preserved and cannot be
added or removed by the generic operation. An actor may retain a target's
existing higher role but cannot use omission to revoke a role outside its own
grant ceiling. New grants require an active target; role revocation from a
suspended account remains available.
If a deployment removes a role template, retained assignments for that key
become inert immediately: they grant no permissions, remain visible as
retired, cannot be granted again, and only an owner may remove them. Other role
changes are blocked until that cleanup occurs so a stale assignment cannot be
silently preserved or restored.

Ownership transfer re-resolves the live actor inside the same SQLite
transaction as the assignment writes, assigns the new owner before revoking
the previous owner, bumps both authorization revisions, and relies on the
database last-owner invariant as a second line of defense. A failed revoke
rolls back the new grant. The target must be able to receive a normal auth
token: the account is active, has no password-change gate, and either does not
require email verification or has a positive verification timestamp. Account
status, password-gate, verification-policy, verification-state, and canonical
email transitions are rejected when they would leave no such application
owner. These rules also live in repaired SQLite triggers, so administrator
routes and trusted raw writes cannot bypass them. Global
`users.role = 'admin'` never satisfies these application permissions or
ownership checks.

Application-role revisions are resolved live for every HTTP request and
authority capture; an already-issued bearer immediately sees grants and
revocations. The browser SDK performs a best-effort refresh after a caller
changes its own authority so Sync and other long-lived transports reconnect
with a fresh authorization snapshot. A refresh failure never makes a committed
server mutation look safe to retry.

The application namespace is not mounted in other profiles, so callers receive
`404`, not a weaker fallback implementation. Auth failures are `401` or `403`;
grant-ceiling violations are `403`; protected-owner, inactive-target,
ownership-conflict, stale-revision, and retired-role-cleanup failures are `409`;
malformed pagination or role selections
are `422`. Treat error `code` as the stable branch and `error` as display text.

## Browser SDK

Application administration is deliberately namespaced:

```ts
const config = await client.applicationAdmin.getConfig();
const page = await client.applicationAdmin.listUsers({
  search: 'ada',
  status: 'active',
  limit: 25,
});
const user = page.users[0];

if (user) {
  await client.applicationAdmin.replaceUserRoles(
    user.identity.userId,
    ['reader'],
    user.roleRevision,
  );
  await client.applicationAdmin.transferOwnership(user.identity.userId);
}
```

Use `useApplicationAccess()` for a headless React integration. It provides
profile availability, denied/error/loading states, capability metadata,
cursor pagination, role replacement, and ownership transfer. The hook supplies
the loaded target revision automatically and keys its cached projection to the
authenticated user, immediately masking a prior identity's data during an
account replacement.

For the packaged surface, use Zero's adaptive user manager:

```tsx
import { UserManagement } from '@zero/framework/react';

export function AccessSettings() {
  return (
    <UserManagement
      onActorAuthorizationChanged={() => {
        // Optional: close an access drawer or navigate after self-authority changes.
      }}
    />
  );
}
```

In `single/advanced`, the component preserves the established account list,
profile/properties, password, verification, MFA, session, and lifecycle
controls and adds application roles, effective permissions, and ownership to
that same selected-person workflow. Role choices are driven by the server
registry and actor-specific grantability, higher roles remain visible but
locked, retired roles are identified for owner cleanup, suspended targets
cannot receive new grants, and ownership requires an explicit confirmation.
UI visibility is convenience only; the
Elysia routes and headless domain service repeat every authority check.
`pageSize` is clamped to the server's 1–100 range, and self-role changes and
ownership transfer invoke `onActorAuthorizationChanged` only after the server
mutation succeeds. Zero's own bearer refresh has already run best-effort at
that point.

## Choosing the correct surface

| Need | Surface |
| --- | --- |
| Single/simple accounts, passwords, MFA, and lifecycle | `UserManagement` |
| Single/advanced accounts plus application roles | `UserManagement` |
| Multi-tenant active-organization people and tenant roles | `UserManagement` or focused `TenantMemberManagement` |
| Administration Organization people and customer workspaces | `PlatformUserManagement` |

Do not use platform-admin status as an application data-plane role, and do not
mix application access assignment into tenant member APIs.

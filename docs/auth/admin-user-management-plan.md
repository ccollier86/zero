# Admin User Management, Registration, And User Properties Plan

> Historical scope note: this document records the focused global identity and
> `PlatformUserManagement` slice. It does not replace the newer application/
> tenant RBAC system. Current authorization and tenancy contracts live in
> [Zero Auth Philosophy](./zero-auth-philosophy.md), the
> [implementation checklist](./multi-tenant-auth-implementation-checklist.md),
> [Application Access Administration](./application-access-administration.md),
> and [Tenant Member Administration](./tenant-member-administration.md).

## Implementation Status

Platform support is implemented:

1. Secret-gated installation bootstrap creates the first admin by default;
   legacy public first-request bootstrap is explicit and Doctor-warned.
2. `registration.mode` controls post-bootstrap public registration.
3. Admin user-management routes are mounted under `/auth/admin`.
4. Configured `userProperties` support defaults, enum/string/boolean/number
   validation, actor edit policy, and optional strict unknown-key rejection.
5. Built-in auth forms can read `/auth/config` and hide public registration
   when the backend closes it.
6. Client UI gates (`PropertyGate`, `HasProperty`, `HasFlag`) are exported.
7. Admin MFA status, requirement, enrollment reset, and email-verification
   lifecycle routes are mounted below `/auth/admin/users/:userId`.
8. Security transitions durably invalidate refresh/page sessions and previously
   issued access and auth-transition tokens.
9. The production `UserManagement` organism exposes auth readiness, per-user
   security state, and capability-gated lifecycle actions.
10. Administrator setup/reset email is delivery-first: the password gate and
    session revocation occur only after recipient acceptance, with explicit
    recovery for an already-stranded gate.

Deferred from this global account-management surface:

1. Config-file discovery/scaffolding under a `zero/` or `config/` folder.
2. MFA recovery-code generation, display, and verification.
3. Per-device/session inventory and individual-session revocation.
4. Administrator impersonation and bulk user actions.
5. Tenant-custom runtime roles. Protected Administration Organization and
   customer-organization lifecycle controls, current app/tenant RBAC, and
   resource field policy now live on separate surfaces.
6. Avatar storage integration.

## Goal

This slice made Zero's global account system practical for private/internal
apps. The later authorization work extends it without turning global account
management into tenant membership management.

The platform should support:

1. First-user bootstrap.
2. Configurable public registration.
3. Admin-created and admin-managed users.
4. Admin-editable user key/value properties.
5. Configured property fields with defaults and enum options.
6. Admin UI adaptation based on the configured property fields.

## Historical Non-Goals For This Slice

These were intentionally outside this focused account-management slice; some
now exist through separate platform surfaces:

1. Groups-to-permissions.
2. Application/tenant RBAC, now implemented through the separate four-profile
   authorization system.
3. Tenant member onboarding and administration, now implemented separately
   from global identity provisioning.
4. Row-level security.
5. Backend query/table enforcement, now provided for policy-trusted properties
   and registered resources rather than arbitrary user-writable KV.
6. Avatar storage.

User properties can support UI gates and app behavior, but they are not a
trusted authorization layer unless matching backend checks are added by the
app.

## Registration Policy

Zero should support public registration for prototypes and closed registration
for private apps.

Inline config:

```ts
import { defineAuthConfig } from '@zero/framework/server';

export default defineAuthConfig({
  registration: {
    mode: 'admin-only',
  },
});
```

Supported modes:

| Mode | Behavior after bootstrap |
| --- | --- |
| `public` | Anyone can call `POST /auth/register` and receives role `user`. |
| `admin-only` | Public registration is hidden/disabled. Admins create users through admin routes. |
| `disabled` | No public or admin registration route creates users unless app code uses the store directly. |

Bootstrap rule:

1. A fresh install defaults to `auth.bootstrap.mode: 'secret'`; without a
   configured secret, `POST /auth/register` remains closed.
2. The matching `bootstrapSecret` creates the first admin and writes a durable
   completion marker in the same serialized transaction.
3. Explicit `auth.bootstrap: 'public'` preserves the legacy behavior; explicit
   `auth.bootstrap: 'disabled'` requires trusted provisioning.
4. After completion, `registration.mode` controls ordinary registration and
   bootstrap input is rejected.

When public registration is disabled, the public register route should behave
as unavailable after bootstrap. The frontend register page should also hide
itself from injected/effective config.

## Admin User API

Admin routes are protected by `requireAdmin()`.

Implemented routes:

```txt
GET    /auth/admin/config
GET    /auth/admin/users?limit=50&offset=0&search=ops&role=user&status=active
GET    /auth/admin/users/:userId
POST   /auth/admin/users
PATCH  /auth/admin/users/:userId
DELETE /auth/admin/users/:userId

PUT    /auth/admin/users/:userId/properties/:key
PATCH  /auth/admin/users/:userId/properties
DELETE /auth/admin/users/:userId/properties/:key

POST   /auth/admin/users/:userId/reset-password
POST   /auth/admin/users/:userId/send-setup-email
POST   /auth/admin/users/:userId/send-password-reset
POST   /auth/admin/users/:userId/clear-password-change-requirement
POST   /auth/admin/users/:userId/suspend
POST   /auth/admin/users/:userId/activate
POST   /auth/admin/users/:userId/revoke-sessions

GET    /auth/admin/users/:userId/mfa
POST   /auth/admin/users/:userId/mfa/require
POST   /auth/admin/users/:userId/mfa/clear-requirement
POST   /auth/admin/users/:userId/mfa/reset
POST   /auth/admin/users/:userId/send-verification-email
POST   /auth/admin/users/:userId/verify-email
```

`GET /auth/admin/users` returns `{ users, page }`; `page` includes `limit`,
`offset`, `count`, `total`, `hasMore`, and `nextOffset`.

The admin security endpoints return these exact top-level response shapes:

| Route | Response |
| --- | --- |
| `GET /auth/admin/users/:userId/mfa` | `{ methods, required, requirement }` |
| `POST /auth/admin/users/:userId/mfa/require` | `{ user }` |
| `POST /auth/admin/users/:userId/mfa/clear-requirement` | `{ user }` |
| `POST /auth/admin/users/:userId/mfa/reset` | `{ ok: true, deletedMethods, invalidatedChallenges }` |
| `POST /auth/admin/users/:userId/send-verification-email` | `{ ok: true }` |
| `POST /auth/admin/users/:userId/verify-email` | `{ user }` |
| `POST /auth/admin/users/:userId/clear-password-change-requirement` | `{ user }` |

`requirement` is one of `user`, `global`, `admin-role`, or `none`. Requiring or
clearing the per-user requirement, resetting MFA, manually verifying an email,
changing security-sensitive account state, or explicitly revoking sessions
revokes refresh tokens and increments the user's auth generation. Page sessions
are refresh-bound, while access and auth-transition token resolution rejects an
older generation, so reactivating an account cannot revive previously issued
credentials.

Manual verification is an explicit opt-in:

```ts
export default defineAuthConfig({
  account: {
    allowAdminMarkEmailVerified: false,
  },
});
```

`allowAdminMarkEmailVerified` defaults to `false`.
`GET /auth/admin/config` reports the resolved value as both
`account.allowAdminMarkEmailVerified` and
`capabilities.adminMarkEmailVerified`; the Users UI shows the manual override
only when that capability is true. Sending a normal verification email remains
a separate readiness-gated action.

Direct `reset-password` is controlled by
`auth.accountEmails.manualPasswordReset`. Set it to `false` to force admin
reset flows through emailed action links.

Setup/reset email actions validate real email readiness and require the
provider boundary to accept the intended recipient before setting
`passwordChangeRequired` or revoking sessions. A failed delivery removes its
token and leaves an existing user ungated. Admin creation is protected by a
durable exact-state receipt: failed setup delivery removes an untouched new
account, but preserves an account that another authorized operation has
already changed or linked to durable state. Generic profile updates cannot
newly enable the gate. The clear-requirement route is an explicit, audited
recovery for another user whose gate already exists; it leaves the password
unchanged and invalidates sessions plus outstanding action links.

Admin user creation should accept:

```ts
{
  username: string;
  email: string;
  password?: string;
  firstName?: string;
  lastName?: string;
  role?: 'user' | 'admin' | string;
  // Accepted only as part of sendSetupEmail delivery; raw gate creation fails.
  passwordChangeRequired?: boolean;
  mfaRequired?: boolean;
  sendSetupEmail?: boolean;
  properties?: Record<string, string>;
}
```

Admin update should support:

1. Username.
2. Email.
3. First and last name.
4. Role.
5. Configured key/value properties.
6. Password reset.
7. Session revocation.

Enforced safety rules:

1. Do not allow deleting the last admin.
2. Do not allow demoting the last admin.
3. Do not allow suspending or otherwise locking the last active admin.
4. Reject destructive self-admin transitions such as self-demotion,
   self-suspension, self-delete, self-password reset, and self-MFA reset.
5. Resetting a password revokes every existing session and token generation.
6. Deleting a history-free identity cascades identity-owned credentials,
   properties, and refresh tokens. Multi-tenant organization history is never
   cascaded: the API returns `409 USER_HAS_TENANT_HISTORY` with guidance to
   suspend the identity instead.
7. Never gate an account before setup/reset delivery is accepted.
8. Clearing a stranded gate cannot target the acting administrator and revokes
   every existing session/action-link generation.

## Configured User Properties

Zero should keep the existing `user_properties` table and add a config layer on
top of it.

Recommended config:

```ts
export default defineAuthConfig({
  registration: {
    mode: 'admin-only',
  },

  userProperties: {
    plan: {
      type: 'enum',
      label: 'Plan',
      values: ['free', 'pro', 'enterprise'],
      default: 'free',
      editableBy: 'admin',
    },
    department: {
      type: 'enum',
      label: 'Department',
      values: ['accounting', 'operations', 'management'],
      editableBy: 'admin',
      useInPolicies: true,
    },
    notificationsEnabled: {
      type: 'boolean',
      label: 'Notifications',
      default: true,
      editableBy: 'user',
    },
    dashboardLayout: {
      type: 'string',
      label: 'Dashboard Layout',
      default: 'default',
      editableBy: 'user',
    },
  },
});
```

Supported field types for this slice:

| Type | Stored value |
| --- | --- |
| `string` | Raw string |
| `enum` | One configured string option |
| `boolean` | Serialized as `true` or `false` |
| `number` | Serialized as a decimal string |

The admin UI renders controls from this config:

| Field type | Admin UI control |
| --- | --- |
| `string` | Text input |
| `enum` | Select |
| `boolean` | Toggle |
| `number` | Number input |

## Defaults

Configured defaults should apply when a user is created through:

1. First-user bootstrap registration.
2. Public registration.
3. Admin user creation.

Admin user creation may override configured defaults by sending explicit
properties.

For existing users, the platform may lazily fill missing default properties on
login or `/auth/me`, but it must not overwrite existing values. This gives old
apps a safe migration path when a new property field is added to config.

## Current-User Properties

The current-user property routes can remain:

```txt
PUT    /auth/me/properties/:key
GET    /auth/me/properties
GET    /auth/me/properties/:key
DELETE /auth/me/properties/:key
```

Once configured property fields exist:

1. Current users may edit fields with `editableBy: 'user'`.
2. Current users may not edit fields with `editableBy: 'admin'`.
3. Unknown keys may remain allowed for backward compatibility, or apps can
   enable strict mode later.

Recommended V1 default: preserve unknown-key writes for compatibility, but
protect configured admin-only keys.

## Admin UI Behavior

The reusable `UserManagement` organism is wired to the admin routes. It reads:

```txt
GET /auth/admin/config
```

and adapts:

1. Show compact readiness warnings only when configured email, verification,
   or MFA capabilities are not operationally ready.
2. Show configured property fields on create-user forms.
3. Apply defaults in the create-user form.
4. Let admins edit configured properties later.
5. Show unconfigured existing properties in an additional key/value section
   when `strictUserProperties` is false.
6. Show selected-user security state only when it needs attention: pending
   verification, password setup, MFA enrollment, enrolled methods, or errors.
7. Capability-gate setup/reset emails, manual password reset, confirmed
   password-gate recovery, resend/mark verification, MFA require/clear/reset,
   session revocation, suspend/activate, and delete actions.
8. Serialize sensitive actions and require confirmation for destructive
   transitions. The backend remains authoritative for every invariant.
9. In multi-tenant mode, omit hard delete from the packaged live UI because a
   global identity row does not prove the absence of retained organization
   history. Show suspend/activate instead. A custom controlled surface may own
   an explicit lifecycle ceremony, but the API still rejects unsafe deletion
   with `409 USER_HAS_TENANT_HISTORY`.

This gives developers a simple way to configure app-specific user metadata
without building a custom user-management screen for every app. Apps that need
a custom admin surface can call the top-level SDK helpers, including
`listAuthAdminUsers`, `setAuthAdminUserProperty`, and
`deleteAuthAdminUserProperty`.

## Auth UI Adaptation

Auth-facing UI should adapt to the effective auth config.

The login/register pages and auth navigation should:

1. Hide public registration once bootstrap is complete when
   `registration.mode` is `admin-only` or `disabled`.
2. Show bootstrap registration only when the public config reports an
   available ceremony, and render the operator setup-key input for secret mode.
3. Make the setup path clear in the UI so the operator creates the admin
   account intentionally.
4. Avoid showing links or forms that will always fail under the active
   registration policy.
5. Use the same effective config as backend routes so frontend behavior and
   server enforcement cannot drift.

This should keep the UI clean regardless of whether the app is an open
prototype, a closed personal app, or an admin-managed internal tool.

## UI Gates

Frontend gates can use current auth user properties for interface-level
behavior:

```tsx
<PropertyGate propertyKey="department" allow="accounting">
  <AccountingDashboard />
</PropertyGate>

<PropertyGate propertyKey="plan" allow={['pro', 'enterprise']}>
  <AdvancedReports />
</PropertyGate>
```

These are UI convenience gates. Backend routes and data access still need
server-side checks if the hidden UI controls protect sensitive behavior.

Recommended component API:

```tsx
<PropertyGate
  propertyKey="department"
  allow={['accounting', 'management']}
  fallback={null}
>
  <DepartmentTools />
</PropertyGate>
```

`propertyKey` selects the current auth user's property. `allow` accepts a
single string, number, boolean, or an array of allowed values. The gate renders
children when the user's property value matches one of the allowed values. It
renders `fallback` otherwise.

Convenience aliases can wrap the same logic:

```tsx
<HasProperty propertyKey="department" allow="accounting" />
<HasFlag propertyKey="notificationsEnabled" />
```

The component docs and prop comments should be explicit that property gates are
for UI behavior and are not backend authorization.

## Implementation Order

1. Add auth config types for registration and user properties.
2. Add `defineAuthConfig()` with no runtime side effects.
3. Normalize inline/file auth config into effective auth config.
4. Add `UserStore.countUsers()`.
5. Add user creation with initial/default properties.
6. Add registration policy and first-admin bootstrap.
7. Add admin user routes.
8. Add property validation/default application service.
9. Add admin config endpoint.
10. Update frontend admin user-management UI.
11. Add UI property gates.
12. Update docs and tests.

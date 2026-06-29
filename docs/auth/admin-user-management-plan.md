# Admin User Management, Registration, And User Properties Plan

This is the near-term auth work for Zero. It intentionally replaces the broad
permissions/RBAC/tenant plan for now.

## Implementation Status

Backend support is implemented:

1. First-user bootstrap always creates an admin.
2. `registration.mode` controls post-bootstrap public registration.
3. Admin user-management routes are mounted under `/auth/admin`.
4. Configured `userProperties` support defaults, enum/string/boolean/number
   validation, actor edit policy, and optional strict unknown-key rejection.
5. Built-in auth forms can read `/auth/config` and hide public registration
   when the backend closes it.
6. Client UI gates (`PropertyGate`, `HasProperty`, `HasFlag`) are exported.

Deferred:

1. Config-file discovery/scaffolding under a `zero/` or `config/` folder.
2. A production admin user-management page wired to `/auth/admin`.
3. Auth/account lifecycle email, password reset, setup links, and forced
   password-change flow. See [Platform Email And Account Lifecycle Plan](./email-account-lifecycle-plan.md).
4. Full metadata/RBAC/tenant/query enforcement.
5. Avatar storage integration.

## Goal

Make Zero's current auth system practical for private/internal apps without
building a full authorization platform yet.

The platform should support:

1. First-user bootstrap.
2. Configurable public registration.
3. Admin-created and admin-managed users.
4. Admin-editable user key/value properties.
5. Configured property fields with defaults and enum options.
6. Admin UI adaptation based on the configured property fields.

## Non-Goals For This Slice

Do not build these in this slice:

1. Groups-to-permissions.
2. Full RBAC.
3. Tenant-aware user provisioning.
4. Row-level security.
5. Backend query/table enforcement from KV properties.
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

1. If there are zero users, `POST /auth/register` is always allowed.
2. The first registered user always receives role `admin`.
3. After the first user exists, `registration.mode` controls public
   registration.

When public registration is disabled, the public register route should behave
as unavailable after bootstrap. The frontend register page should also hide
itself from injected/effective config.

## Admin User API

Admin routes should be protected by `requireAdmin()`.

Recommended routes:

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
POST   /auth/admin/users/:userId/suspend
POST   /auth/admin/users/:userId/activate
POST   /auth/admin/users/:userId/revoke-sessions
```

`GET /auth/admin/users` returns `{ users, page }`; `page` includes `limit`,
`offset`, `count`, `total`, `hasMore`, and `nextOffset`.

Direct `reset-password` is controlled by
`auth.accountEmails.manualPasswordReset`. Set it to `false` to force admin
reset flows through emailed action links.

Admin user creation should accept:

```ts
{
  username: string;
  email: string;
  password?: string;
  firstName?: string;
  lastName?: string;
  role?: 'user' | 'admin' | string;
  passwordChangeRequired?: boolean;
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

Safety rules:

1. Do not allow deleting the last admin.
2. Do not allow demoting the last admin.
3. Consider requiring an explicit confirmation flag to delete the current
   admin's own account.
4. Resetting a password should revoke existing refresh tokens.
5. Deleting a user should cascade credentials, properties, and refresh tokens.

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

The admin UI should render controls from this config:

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

The existing mock user-management page is not yet wired to these routes. A
production admin user-management UI should read:

```txt
GET /auth/admin/config
```

and adapt:

1. Show whether public registration is enabled after bootstrap.
2. Show configured property fields on create-user forms.
3. Apply defaults in the create-user form.
4. Let admins edit configured properties later.
5. Show unconfigured existing properties in an advanced/raw KV section.

This will give developers a simple way to configure app-specific user metadata
without building a custom user-management screen for every app. Until that UI
slice is implemented, apps can call the admin routes directly through the SDK's
authenticated `client.get/post/patch/delete` helpers.

## Auth UI Adaptation

Auth-facing UI should adapt to the effective auth config.

The login/register pages and auth navigation should:

1. Hide public registration once bootstrap is complete when
   `registration.mode` is `admin-only` or `disabled`.
2. Still allow first-user bootstrap registration when there are zero users.
3. Make the first-user path clear in the UI so the first account becomes the
   admin account intentionally.
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

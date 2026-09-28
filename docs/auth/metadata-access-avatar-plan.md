# Auth Metadata, Access Control, And Avatars Plan

> Historical planning record. The governed user-property system and the newer
> four-profile authorization/tenancy architecture supersede the access and
> tenant sketches in this document. Use
> [Zero Auth Philosophy](./zero-auth-philosophy.md), the
> [implementation checklist](./multi-tenant-auth-implementation-checklist.md),
> and [Platform Configuration](../platform-configuration.md) for current
> contracts. The remaining avatar ideas are not an implemented auth boundary.

## Goal

Keep Zero's current fast auth path simple while adding a configurable,
Clerk-style metadata and access-control layer for apps that need more precise
authorization.

The platform should provide stable metadata keys with built-in behavior. App
developers configure the values.

Zero should not know what `"accounting"` means. Zero should know what
`groups`, `permissions`, `tenantId`, and `avatarFileId` mean.

This plan should use the platform-wide config-file protocol in
`docs/platform-configuration.md`. Auth/access/avatar should be the first
system to prove that protocol before storage, sync, observability, migrations,
and other `createApp()` systems adopt it.

## State When This Plan Was Written

Current auth already has:

1. `users.role` for coarse system roles such as `user` and `admin`.
2. `user_properties` for user key/value data.
3. `requireAuth()` and `requireAdmin()` in auth middleware.
4. Frontend role gates through `Gate`.
5. Storage primitives that can support avatar files.

Important limitation: `user_properties` is currently exposed through a
user-writable route. The platform should not treat that unrestricted write path
as trusted system metadata. It should become the public/user-writable side of a
governed metadata system, with reserved keys blocked from arbitrary user
writes.

## Metadata Categories

### System Role

Keep `role` as the coarse platform/system role.

Recommended default roles:

- `user`
- `admin`

Apps may still store other role strings, but the platform should preserve the
simple `admin` shortcut because it is useful.

### Public/User Metadata

Public/user metadata is safe for display, preferences, and user-controlled app
state. It is not trusted for authorization.

Examples:

- `displayName`
- `theme`
- `timezone`
- notification preferences

This layer should be writable only for keys explicitly marked user-writable.
Examples include notification settings, theme, timezone, and safe profile
display fields. It should reject platform-reserved keys unless the write comes
through a dedicated route that enforces the right invariant.

Apps can use public metadata to control app behavior when that behavior is safe
for the user to control. For example, a notification UI can read
`notifications.enabled`, a dashboard can read a preferred layout, or an app can
remember a selected theme. This is optional. If an app already has a different
settings/preferences system, it can keep using that system and leave public
metadata empty.

The key rule is that public metadata should never be the thing that grants
access to data or administrative actions. It can influence user experience; it
must not decide security.

### Private Metadata

Private metadata is app/admin-controlled metadata that should not be exposed to
normal users but also does not necessarily grant access by itself.

Examples:

- onboarding state assigned by staff
- billing/customer references
- internal notes
- external provider ids

Private metadata is useful for workflows and server-side app behavior. It
should be readable by backend code and admin tools, not by the generic current
user metadata endpoint unless explicitly projected.

Private metadata is the important layer for system-assigned user facts. Use it
for data assigned during registration, sign-in callbacks, admin user
management, invite acceptance, tenant provisioning, billing sync, or other
trusted backend flows.

### Authz Metadata

Authz metadata is system/admin/app-controlled and can be used in backend policy
decisions.

Examples:

- `groups`
- `permissions`
- `tenantId`
- `tenantIds`
- `department`
- `teamIds`
- `region`
- `entitlements`
- `clearance`

Authz metadata must be validated against app configuration and must not be
user-writable by default.

### Reserved System Keys

Some metadata keys have platform behavior and must be reserved even when they
look like normal profile fields.

Recommended reserved keys:

- `groups`
- `permissions`
- `tenantId`
- `tenantIds`
- `department`
- `teamIds`
- `region`
- `entitlements`
- `clearance`
- `avatarFileId`
- `displayName` when configured as admin-managed

`avatarFileId` is not an authz key, but it should still be reserved when the
avatar system is enabled. Users should change it through the avatar route so
storage ownership, MIME type, size, and object permissions are validated.

## Simple Configuration

Most apps should not need to put auth/access policy directly inside
`createApp()`. Keep `createApp()` small and let Zero load focused policy config
files from the app root.

Recommended app structure:

```txt
app/
  server.ts
zero/
  auth.ts
  access.ts
  storage.ts
```

`createApp()` should accept a small pointer or use discovery:

```ts
createApp({
  db: { mode: './data/app.db' },
  tables,
  auth: true,
  configDir: './zero',
});
```

or:

```ts
createApp({
  db: { mode: './data/app.db' },
  tables,
  auth: {
    config: './zero/auth.ts',
  },
  access: {
    config: './zero/access.ts',
  },
});
```

The policy files are the primary developer experience. Inline config should
remain available for tiny apps and tests, but it should not be the recommended
path for serious apps.

Example `zero/auth.ts`:

```ts
import { defineAuthConfig } from '@zero/framework/server';

export default defineAuthConfig({
  access: {
    groups: ['accounting', 'management', 'billing'],
    permissions: [
      'invoice.read',
      'invoice.create',
      'invoice.approve',
      'users.manage',
    ],
    departments: ['accounting', 'operations', 'management'],
    entitlements: ['free', 'pro', 'enterprise'],
  },
  tenancy: false,
  avatar: true,
});
```

This config means:

1. `groups` is a string array authz key.
2. `permissions` is a string array authz key.
3. `department` is a string authz key with configured values.
4. `entitlements` is a string array authz key.
5. The app is single-tenant because `tenancy` is false.
6. Avatars are enabled with storage-backed defaults.

## Template Files

Zero should ship blank starter templates with comments and fill-in sections.

Recommended command:

```txt
bun run zero init-config auth
bun run zero init-config access
```

Generated `zero/auth.ts` template:

```ts
import { defineAuthConfig } from '@zero/framework/server';

export default defineAuthConfig({
  /**
   * Access metadata gives the platform meaningful keys while your app defines
   * the values. Delete sections you do not need.
   */
  access: {
    // Groups are broad team/business buckets used by route gates, UI gates,
    // storage policies, and table access policies.
    groups: [
      // 'accounting',
      // 'management',
    ],

    // Permissions are precise actions. Prefer resource.action naming.
    permissions: [
      // 'invoice.read',
      // 'invoice.approve',
      // 'users.manage',
    ],

    // Departments are a single user assignment useful for common business apps.
    departments: [
      // 'operations',
    ],

    // Entitlements are feature/plan flags.
    entitlements: [
      // 'pro',
    ],
  },

  /**
   * Single-tenant by default. Set this only for tenant-aware SaaS apps.
   */
  tenancy: false,

  /**
   * Enables the storage-backed avatar defaults.
   */
  avatar: false,
});
```

Generated `zero/access.ts` template:

```ts
import {
  defineAccessConfig,
  hasPermission,
  sameTenant,
} from '@zero/framework/server';

export default defineAccessConfig({
  tables: {
    // invoices: {
    //   read: hasPermission('invoice.read'),
    //   update: hasPermission('invoice.update'),
    // },
  },
});
```

Templates should be heavily commented but generated as normal TypeScript so
developers get autocomplete and compile-time feedback.

## Advanced Configuration

Apps that need more control can define metadata fields directly.

```ts
createApp({
  auth: {
    metadata: {
      groups: {
        type: 'string[]',
        values: ['accounting', 'management', 'billing'],
        authz: true,
        visibility: 'public',
        writable: 'admin',
      },
      permissions: {
        type: 'string[]',
        values: ['invoice.read', 'invoice.approve', 'users.manage'],
        authz: true,
        visibility: 'private',
        writable: 'admin',
      },
      tenantId: {
        type: 'string',
        authz: true,
        visibility: 'private',
        writable: 'admin',
      },
      displayName: {
        type: 'string',
        authz: false,
        visibility: 'public',
        writable: 'user',
      },
      avatarFileId: {
        type: 'string',
        authz: false,
        visibility: 'public',
        writable: 'system',
      },
    },
  },
});
```

Supported metadata field properties:

| Property | Purpose |
| --- | --- |
| `type` | `string`, `string[]`, `number`, `boolean`, `json` |
| `values` | Optional allowed values for selects/multiselects |
| `authz` | Whether the key can be used for backend authorization |
| `visibility` | `public` keys may appear in safe user responses; `private` keys remain server/admin-only |
| `writable` | `user`, `admin`, `system`, or `none` |
| `label` | Optional admin UI label |
| `description` | Optional admin UI helper text |

`writable: 'user'` must only be allowed when the field is explicitly safe for
current-user edits. `authz: true` fields must default to
`visibility: 'private'` and `writable: 'admin'` unless the app deliberately
opts into a different projection.

Writable modes:

| Mode | Meaning |
| --- | --- |
| `user` | Current user may update the key through the user metadata endpoint. Use for preferences and safe profile fields. |
| `admin` | Admin routes may update the key. Use for group, department, entitlement, and other staff-managed facts. |
| `system` | Only platform/server flows may update the key. Use for avatar file ids, provider ids, computed flags, and automation-owned values. |
| `none` | Read-only after creation unless custom app code mutates it directly through a trusted service. |

## Tenancy

Zero is single-tenant by default.

If the app does not configure tenancy metadata or `access.tenancy`, Zero should
not expect tenant columns, tenant metadata, or tenant filters.

Tenant-aware apps opt in:

```ts
createApp({
  auth: {
    access: {
      groups: ['accounting'],
    },
    tenancy: {
      mode: 'single',
      userKey: 'tenantId',
      rowKey: 'tenant_id',
      enforceByDefault: true,
      exemptTables: ['public_settings'],
    },
  },
});
```

Historical proposal (superseded by the current tenancy/authorization contracts;
`mode: 'multi'` no longer fails startup merely because it was selected):

```ts
auth: {
  tenancy: {
    mode: 'multi',
    userKey: 'tenantIds',
    rowKey: 'tenant_id',
  },
}
```

Tenant-aware behavior should include:

1. `/api/data` row filters.
2. Sync read/mutation policy checks.
3. Insert tenant assignment or validation.
4. Update/delete current-row scope validation.
5. Observability warnings when scoped tables are configured as full sync.
6. Platform doctor checks for missing tenant columns.

Scoped tables should default to lazy mode unless row-filtered snapshots are
implemented.

## Policy Helpers

Backend helpers should cover common access decisions:

```ts
requireAuth();
requireAdmin();
requireGroup('accounting');
requirePermission('invoice.approve');
requireDepartment('management');
requireEntitlement('enterprise');
requireMetadata('region', 'east');
```

Composable table policies:

```ts
access: {
  tables: {
    invoices: {
      read: and(hasPermission('invoice.read'), sameTenant()),
      insert: and(hasPermission('invoice.create'), sameTenant()),
      update: and(hasPermission('invoice.update'), sameTenant()),
      delete: hasRole('admin'),
    },
  },
}
```

Recommended policy categories:

1. Gate policies: allow or deny an action.
2. Row scope policies: produce safe SQL filters or current-row checks.

Gate policies apply to routes, storage actions, workflow actions, and sync
mutations.

Row scope policies apply to `/api/data`, lazy collections, list endpoints, and
current-row update/delete checks.

## Enforcement Points

The same authz model should be enforced through:

1. Elysia route guards and route config.
2. Auth middleware helpers.
3. Sync subscriptions.
4. Sync mutations.
5. `/api/data` lazy queries.
6. Storage routes.
7. Notification targeting where relevant.
8. Workflow actions.
9. Frontend gates for UX only.

Frontend gates must never be the security boundary.

## Avatar System

Avatars should be optional and storage-backed.

Simple config:

```ts
createApp({
  auth: {
    avatar: true,
  },
});
```

Advanced config:

```ts
createApp({
  auth: {
    avatar: {
      enabled: true,
      drive: 'avatars',
      userWritable: true,
      maxFileSize: 1_000_000,
      allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
      metadataKey: 'avatarFileId',
    },
  },
});
```

Avatar integration should:

1. Use the storage service rather than a separate file path system.
2. Create or use a configured avatar drive.
3. Store the file id in configured profile metadata, default `avatarFileId`.
4. Expose `POST /auth/me/avatar` when user avatar upload is enabled.
5. Expose admin avatar management through the admin user UI.
6. Provide `<UserAvatar />` and admin table/avatar cells.
7. Validate file size and MIME type.
8. Avoid public raw filesystem paths.

If storage is disabled and `auth.avatar` is enabled, startup should fail with a
clear error or automatically enable storage through `createApp()` defaults.

## Admin UI Adaptation

Admin UI components should read metadata and avatar configuration from the
server. The effective config should be the normalized result of inline config
plus loaded `zero.auth.ts` / `zero.access.ts` files.

Recommended endpoint:

```txt
GET /auth/admin/config
```

Admin-only response should include:

1. Metadata field definitions.
2. Allowed values.
3. Writable modes.
4. Visibility and authz flags.
5. Tenancy settings.
6. Avatar settings.

Admin user-management UI should adapt automatically:

| Config | Admin UI |
| --- | --- |
| `groups` | multiselect chips |
| `permissions` | grouped permission picker |
| `department` | select |
| `entitlements` | multiselect or plan picker |
| `tenantId` | tenant selector |
| `tenantIds` | tenant multiselect |
| `avatar.enabled` | avatar upload/clear controls |
| `displayName` | text input |

User-facing profile UI should only show fields that are public and
user-writable.

## Data Storage Direction

Do not rely on unrestricted user-writable metadata for secure authorization.

Recommended direction:

1. Keep the existing KV style for speed and app ergonomics, but put a metadata
   service in front of all user-facing writes.
2. Treat `user_properties` as the public/user-writable metadata projection, not
   as the full metadata authority.
3. Add private/system metadata storage with configured validation and
   admin/system write controls.
4. Store authz metadata in the protected layer and load it into `AuthContext`
   through backend services, not from arbitrary public user writes.
5. Project public metadata into user records or safe user-facing responses when
   `public: true`.
6. Keep private permissions out of user-facing projections; do not expose auth
   user rows through generic Sync.
7. Block generic `/auth/me/properties/:key` writes to reserved system keys.

The exact table shape can be decided during implementation. Options:

1. `user_metadata` with `visibility`, `writable_by`, and per-key policy
   enforced by auth routes.
2. `_user_private_metadata` / `_user_authz_metadata` internal tables plus safe
   public projection into `user_properties`.
3. `user_properties` for public metadata plus `_user_system_metadata` for
   private and authz keys.

Security preference: keep public/user-writable metadata and protected
system/authz metadata physically separate, then expose one typed metadata
service so app developers do not have to think about table details.

## Observability And Doctor

This feature should use the observability boundary for:

1. Invalid metadata assignment attempts.
2. Unknown configured values.
3. Missing tenant columns.
4. Scoped table configured as full sync.
5. Avatar storage misconfiguration.
6. Policy callback failures.

Future platform doctor checks should validate:

1. Configured metadata keys have supported types.
2. Values assigned to users match configured allowed values.
3. Authz keys are not user-writable.
4. Tenant policies match table columns.
5. Avatar config has compatible storage.
6. Frontend admin UI can read the effective config.

## Implementation Order

### Phase 1: Backend Metadata Foundation

1. Define auth metadata, access, tenancy, and avatar config types.
2. Add `defineAuthConfig()` and `defineAccessConfig()` helpers.
3. Add config-file discovery/loading for `zero/auth.ts` and
   `zero/access.ts`.
4. Add blank commented config templates and CLI scaffolding.
5. Normalize simple config into advanced metadata definitions.
6. Add metadata validation and storage APIs.
7. Govern current user-writable metadata and block reserved system keys from
   generic user writes.
8. Store private/authz metadata separately from public user metadata.
9. Expose safe admin/user routes for reading and mutating configured metadata.
10. Extend `AuthContext` with configured authz metadata.
11. Update backend auth docs and tests.

### Phase 2: Storage-Backed Avatar Backend

1. Add avatar config normalization.
2. Create or reuse the configured storage drive.
3. Add upload, replace, clear, and read routes for current-user avatars.
4. Add admin avatar management routes.
5. Store the avatar file id in the configured profile metadata key.
6. Validate size and MIME type through storage.
7. Emit observability events for avatar storage misconfiguration and failures.
8. Update storage/auth docs and tests.

### Phase 3: Security Middleware And Query Integration

1. Add backend guard helpers for groups, permissions, department,
   entitlements, metadata, and tenancy.
2. Add route config or macro support for metadata-based auth gates.
3. Add sync policy helper presets backed by metadata.
4. Add `/api/data` row-scope policy support.
5. Add tenant-aware insert/update/delete validation.
6. Add observability warnings for unsafe scoped-table/full-sync combinations.
7. Add platform doctor checks for metadata/tenancy/policy drift.
8. Update security docs and tests.

### Phase 4: Frontend And Admin UI

1. Add frontend hooks such as `useCan`, `useHasGroup`, and
   `useUserMetadata`.
2. Expand `Gate` for group, permission, entitlement, and metadata checks.
3. Add `UserAvatar` and avatar hooks.
4. Add admin config endpoint consumption.
5. Make admin user-management components adapt to configured metadata fields.
6. Update frontend docs and examples.

This should be implemented in focused slices. Do not try to land metadata,
RLS-style scoping, avatars, and admin UI in one pass.

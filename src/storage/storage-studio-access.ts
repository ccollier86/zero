/**
 * storage-studio-access.ts
 *
 * Declares Guardian permissions and reusable role fragments for the opt-in
 * Storage Studio control plane. It does not install roles or authorize an
 * individual request; applications retain control of their final role keys.
 */

import type {
  AuthPermissionConfig,
  AuthRoleTemplateConfig,
  PermissionKey,
} from '../auth/types';

/** Discover managed drives visible in the active application/tenant scope. */
export const STORAGE_CATALOG_READ_PERMISSION = 'storage:catalog:read' as const satisfies PermissionKey;

/** Provision organization/application drives in the active scope. */
export const STORAGE_DRIVES_PROVISION_PERMISSION = 'storage:drives:provision' as const satisfies PermissionKey;

/** Change managed drive lifecycle, metadata, quotas, and provider policy. */
export const STORAGE_DRIVES_MANAGE_PERMISSION = 'storage:drives:manage' as const satisfies PermissionKey;

/** Permanently delete managed drives through the guarded lifecycle. */
export const STORAGE_DRIVES_DELETE_PERMISSION = 'storage:drives:delete' as const satisfies PermissionKey;

/** Provision a personal drive owned by the current user. */
export const STORAGE_PERSONAL_DRIVES_PROVISION_PERMISSION = 'storage:personal-drives:provision' as const satisfies PermissionKey;

/**
 * Guardian permission fragment applications may spread into their registry.
 * Scope is deliberately omitted: Guardian resolves it to application in
 * single mode and tenant in multi mode.
 */
export const STORAGE_STUDIO_PERMISSION_REGISTRY = Object.freeze({
  [STORAGE_CATALOG_READ_PERMISSION]: permission(
    'View storage catalog',
    'Discover managed drives visible in the active workspace.',
  ),
  [STORAGE_DRIVES_PROVISION_PERMISSION]: permission(
    'Provision storage drives',
    'Provision organization or application storage drives.',
  ),
  [STORAGE_DRIVES_MANAGE_PERMISSION]: permission(
    'Manage storage drives',
    'Manage storage drive lifecycle, metadata, quotas, and provider policy.',
  ),
  [STORAGE_DRIVES_DELETE_PERMISSION]: permission(
    'Delete storage drives',
    'Permanently delete storage drives through the guarded lifecycle.',
  ),
  [STORAGE_PERSONAL_DRIVES_PROVISION_PERMISSION]: permission(
    'Provision personal storage drives',
    'Provision a personal drive for the current user when policy permits.',
  ),
} satisfies Record<string, AuthPermissionConfig>);

/** Read-only catalog role fragment. */
export const STORAGE_STUDIO_VIEWER_ROLE_FRAGMENT = role(
  'Storage viewer',
  'Views the managed storage catalog.',
  [STORAGE_CATALOG_READ_PERMISSION],
);

/** Organization/application drive provisioner without mutation authority. */
export const STORAGE_STUDIO_PROVISIONER_ROLE_FRAGMENT = role(
  'Storage provisioner',
  'Views the catalog and provisions organization storage drives.',
  [STORAGE_CATALOG_READ_PERMISSION, STORAGE_DRIVES_PROVISION_PERMISSION],
);

/** Drive manager that cannot permanently delete a drive. */
export const STORAGE_STUDIO_MANAGER_ROLE_FRAGMENT = role(
  'Storage manager',
  'Provisions and manages drives without permanent deletion authority.',
  [
    STORAGE_CATALOG_READ_PERMISSION,
    STORAGE_DRIVES_PROVISION_PERMISSION,
    STORAGE_DRIVES_MANAGE_PERMISSION,
  ],
);

/** Personal-drive self-service fragment; config still must permit self-service. */
export const STORAGE_STUDIO_PERSONAL_ROLE_FRAGMENT = role(
  'Personal storage provisioner',
  'Views storage and provisions the current user’s personal drive.',
  [
    STORAGE_CATALOG_READ_PERMISSION,
    STORAGE_PERSONAL_DRIVES_PROVISION_PERMISSION,
  ],
);

/** Complete Storage Studio administrative authority. */
export const STORAGE_STUDIO_ADMIN_ROLE_FRAGMENT = role(
  'Storage administrator',
  'Provisions, manages, and deletes organization and personal drives.',
  [
    STORAGE_CATALOG_READ_PERMISSION,
    STORAGE_DRIVES_PROVISION_PERMISSION,
    STORAGE_DRIVES_MANAGE_PERMISSION,
    STORAGE_DRIVES_DELETE_PERMISSION,
    STORAGE_PERSONAL_DRIVES_PROVISION_PERMISSION,
  ],
);

/** Convenience registry; these keys are reusable fragments, not installed roles. */
export const STORAGE_STUDIO_ROLE_FRAGMENTS = Object.freeze({
  viewer: STORAGE_STUDIO_VIEWER_ROLE_FRAGMENT,
  provisioner: STORAGE_STUDIO_PROVISIONER_ROLE_FRAGMENT,
  manager: STORAGE_STUDIO_MANAGER_ROLE_FRAGMENT,
  personalProvisioner: STORAGE_STUDIO_PERSONAL_ROLE_FRAGMENT,
  administrator: STORAGE_STUDIO_ADMIN_ROLE_FRAGMENT,
});

/** True when a permission collection contains one exact Storage Studio key. */
export function hasStorageStudioPermission(
  permissions: readonly PermissionKey[],
  required: keyof typeof STORAGE_STUDIO_PERMISSION_REGISTRY,
): boolean {
  return permissions.includes(required);
}

function permission(
  label: string,
  description: string,
): Readonly<AuthPermissionConfig> {
  return Object.freeze({ label, description });
}

function role(
  label: string,
  description: string,
  permissions: readonly PermissionKey[],
): Readonly<AuthRoleTemplateConfig> {
  return Object.freeze({
    label,
    description,
    permissions: Object.freeze([...permissions]),
  });
}

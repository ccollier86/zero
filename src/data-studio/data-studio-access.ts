/**
 * data-studio-access.ts
 *
 * Declares the opt-in Guardian permission and reusable role fragments for Data
 * Studio. Applications choose role keys and merge these immutable fragments.
 */

import type {
  AuthPermissionConfig,
  AuthRoleTemplateConfig,
  PermissionKey,
} from '../auth/types';

/** Read logical table definitions and rows in the active tenant. */
export const DATA_STUDIO_READ_PERMISSION = 'data-studio:read' as const satisfies PermissionKey;

/** Create and edit logical rows in the active tenant. */
export const DATA_STUDIO_WRITE_PERMISSION = 'data-studio:write' as const satisfies PermissionKey;

/** Create, edit, archive, and restore logical table schemas. */
export const DATA_STUDIO_MANAGE_PERMISSION = 'data-studio:manage' as const satisfies PermissionKey;

/** Guardian permission fragment applications may spread into their registry. */
export const DATA_STUDIO_PERMISSION_REGISTRY = Object.freeze({
  [DATA_STUDIO_READ_PERMISSION]: Object.freeze({
    label: 'View Data Studio',
    description: 'View logical tables and rows in the active organization.',
    scope: 'tenant',
  }),
  [DATA_STUDIO_WRITE_PERMISSION]: Object.freeze({
    label: 'Edit Data Studio rows',
    description: 'Create, edit, and remove logical rows in the active organization.',
    scope: 'tenant',
  }),
  [DATA_STUDIO_MANAGE_PERMISSION]: Object.freeze({
    label: 'Manage Data Studio schemas',
    description: 'Create and manage logical table schemas in the active organization.',
    scope: 'tenant',
  }),
} satisfies Record<string, AuthPermissionConfig>);

/** Read-only role fragment; consumers select the final role key. */
export const DATA_STUDIO_VIEWER_ROLE_FRAGMENT = Object.freeze({
  label: 'Data Studio viewer',
  description: 'Views logical tables and rows without changing them.',
  permissions: Object.freeze([
    DATA_STUDIO_READ_PERMISSION,
  ]),
} satisfies AuthRoleTemplateConfig);

/** Row-editor role fragment with no schema-management authority. */
export const DATA_STUDIO_EDITOR_ROLE_FRAGMENT = Object.freeze({
  label: 'Data Studio editor',
  description: 'Views logical tables and manages their rows.',
  permissions: Object.freeze([
    DATA_STUDIO_READ_PERMISSION,
    DATA_STUDIO_WRITE_PERMISSION,
  ]),
} satisfies AuthRoleTemplateConfig);

/** Full tenant-local Data Studio role fragment. */
export const DATA_STUDIO_MANAGER_ROLE_FRAGMENT = Object.freeze({
  label: 'Data Studio manager',
  description: 'Manages logical table schemas and rows in the active organization.',
  permissions: Object.freeze([
    DATA_STUDIO_MANAGE_PERMISSION,
    DATA_STUDIO_READ_PERMISSION,
    DATA_STUDIO_WRITE_PERMISSION,
  ]),
} satisfies AuthRoleTemplateConfig);

/** Convenience registry of reusable role fragments; keys are not installed roles. */
export const DATA_STUDIO_ROLE_FRAGMENTS = Object.freeze({
  viewer: DATA_STUDIO_VIEWER_ROLE_FRAGMENT,
  editor: DATA_STUDIO_EDITOR_ROLE_FRAGMENT,
  manager: DATA_STUDIO_MANAGER_ROLE_FRAGMENT,
});

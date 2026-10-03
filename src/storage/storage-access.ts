/**
 * storage-access.ts
 *
 * Pure hierarchical Storage ACL evaluation. This module owns ancestor target
 * collection and grant matching only; it does not read databases, establish
 * tenant scope, or apply public/owner/platform-admin bypasses.
 */

import { storagePathPrefixes } from './storage-input';
import type {
  ObjectRecord,
  PermissionLevel,
  PermissionRecord,
} from './types';

const PERMISSION_RANK: Readonly<Record<PermissionLevel, number>> = Object.freeze({
  read: 1,
  write: 2,
  admin: 3,
});

/** One legacy role or the complete effective Guardian role projection. */
export type StorageActorRoleInput = string | readonly string[] | null;

/** Normalize role input without granting authority to empty or duplicate values. */
export function normalizeStorageActorRoles(
  input: StorageActorRoleInput,
): readonly string[] {
  if (Array.isArray(input)) {
    return [...new Set(input.filter(
      (role): role is string => typeof role === 'string' && role.length > 0,
    ))];
  }
  return typeof input === 'string' && input.length > 0 ? [input] : [];
}

/**
 * Resolve every existing folder ancestor plus an optional exact object.
 *
 * A missing destination therefore inherits the nearest existing folder and
 * drive grants. A file encountered before the target terminates inheritance,
 * because files cannot be logical parents.
 */
export function collectStorageAclObjectIds(
  canonicalPath: string,
  getObjectByPath: (path: string) => ObjectRecord | null,
): ReadonlySet<string> {
  const ids = new Set<string>();
  const prefixes = storagePathPrefixes(canonicalPath);
  for (let index = 0; index < prefixes.length; index += 1) {
    const object = getObjectByPath(prefixes[index]!);
    if (!object) break;
    if (object.type === 'file' && index < prefixes.length - 1) break;
    ids.add(object.object_id);
  }
  return ids;
}

/** Return drive, ancestor, and exact-object grants in their stored order. */
export function selectHierarchicalStoragePermissions(
  permissions: readonly PermissionRecord[],
  objectIds: ReadonlySet<string>,
): PermissionRecord[] {
  return permissions.filter(
    (permission) => permission.object_id === null || objectIds.has(permission.object_id),
  );
}

/** Determine whether any additive ACL grant satisfies the requested level. */
export function storagePermissionsGrantAccess(
  permissions: readonly PermissionRecord[],
  userId: string,
  roles: readonly string[],
  properties: Readonly<Record<string, string>>,
  requiredLevel: PermissionLevel,
  isPolicyTrustedProperty: ((key: string) => boolean) | undefined,
): boolean {
  const requiredRank = PERMISSION_RANK[requiredLevel];
  for (const permission of permissions) {
    const permissionRank = PERMISSION_RANK[permission.permission as PermissionLevel];
    if (!permissionRank || permissionRank < requiredRank) continue;

    switch (permission.grant_type) {
      case 'user':
        if (permission.grant_value === userId) return true;
        break;
      case 'role':
        if (roles.includes(permission.grant_value)) return true;
        break;
      case 'property':
        if (permission.grant_key
          && isPolicyTrustedProperty?.(permission.grant_key)
          && properties[permission.grant_key] === permission.grant_value) {
          return true;
        }
        break;
    }
  }
  return false;
}

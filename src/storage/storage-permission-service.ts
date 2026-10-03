/**
 * storage-permission-service.ts
 *
 * Owns Storage ACL persistence and hierarchical authorization decisions. It
 * consumes validated actor/scope inputs and Storage rows; it does not verify
 * authentication tokens, route HTTP requests, or mutate object contents.
 */

import {
  serviceDataScopeMatchesTenant,
  type ServiceDataScope,
} from '../auth/service-data-scope';
import type { ReactiveDB } from '../sync/reactive-db';
import {
  collectStorageAclObjectIds,
  normalizeStorageActorRoles,
  selectHierarchicalStoragePermissions,
  storagePermissionsGrantAccess,
  type StorageActorRoleInput,
} from './storage-access';
import { StorageError } from './storage-error';
import { normalizeStoragePath } from './storage-input';
import type {
  DriveRecord,
  GrantPermissionParams,
  ListPermissionsOptions,
  ObjectRecord,
  PermissionLevel,
  PermissionRecord,
} from './types';

const STORAGE_GRANT_TYPES = new Set(['role', 'user', 'property']);
const STORAGE_PERMISSION_LEVELS = new Set(['read', 'write', 'admin']);
const MAX_GRANT_VALUE_LENGTH = 200;
const MAX_GRANT_KEY_LENGTH = 100;
const INVALID_GRANT_TEXT = /[\u0000-\u001f\u007f]/u;

export interface StoragePermissionServiceOptions {
  readonly tenancyMode?: 'single' | 'multi';
  readonly isPolicyTrustedProperty?: (key: string) => boolean;
}

/** Persist Storage grants and evaluate their additive hierarchical effect. */
export class StoragePermissionService {
  private readonly stmts;

  constructor(
    db: ReactiveDB,
    private readonly options: StoragePermissionServiceOptions,
  ) {
    this.stmts = {
      getDrive: db.prepare('SELECT * FROM storage_drives WHERE drive_id = ?'),
      getObjectByPath: db.prepare(
        'SELECT * FROM storage_objects WHERE drive_id = ? AND path = ?',
      ),
      getDrivePermissions: db.prepare(
        'SELECT * FROM _storage_permissions WHERE drive_id = ? AND object_id IS NULL',
      ),
      getAllPermissions: db.prepare(
        'SELECT * FROM _storage_permissions WHERE drive_id = ? ORDER BY created_at, permission_id',
      ),
      insertPermission: db.prepare(
        `INSERT INTO _storage_permissions
         (permission_id, tenant_id, drive_id, object_id, grant_type, grant_key, grant_value, permission, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ),
      deletePermission: db.prepare(
        'DELETE FROM _storage_permissions WHERE permission_id = ?',
      ),
      getPermissionById: db.prepare(
        'SELECT * FROM _storage_permissions WHERE permission_id = ?',
      ),
    };
  }

  /** Persist a validated drive-level or exact-object grant. */
  grant(driveId: string, params: GrantPermissionParams): PermissionRecord {
    const drive = this.getDrive(driveId);
    if (!drive) throw new StorageError(404, `Drive not found: ${driveId}`);

    if (!STORAGE_GRANT_TYPES.has(params.grantType)) {
      throw invalidGrant('Storage permission grant type is invalid.');
    }
    if (!STORAGE_PERMISSION_LEVELS.has(params.permission)) {
      throw invalidGrant('Storage permission level is invalid.');
    }
    const grantValue = normalizeGrantText(
      params.grantValue,
      MAX_GRANT_VALUE_LENGTH,
      'Storage permission grant value',
    );

    const propertyKey = params.grantType === 'property'
      ? normalizeGrantText(
          params.grantKey,
          MAX_GRANT_KEY_LENGTH,
          'Storage permission property key',
        )
      : null;
    if (params.grantType === 'property'
      && !this.options.isPolicyTrustedProperty?.(propertyKey!)) {
      throw new StorageError(
        400,
        'Property permissions require a policy-trusted grantKey',
      );
    }

    let objectId: string | null = null;
    if (params.objectPath) {
      const object = this.getObject(driveId, normalizeStoragePath(params.objectPath));
      if (!object) {
        throw new StorageError(
          404,
          'Storage object was not found.',
          'STORAGE_OBJECT_NOT_FOUND',
        );
      }
      objectId = object.object_id;
    }

    const permission: PermissionRecord = {
      permission_id: `perm_${crypto.randomUUID()}`,
      tenant_id: drive.tenant_id,
      drive_id: driveId,
      object_id: objectId,
      grant_type: params.grantType,
      grant_key: params.grantType === 'property' ? propertyKey! : null,
      grant_value: grantValue,
      permission: params.permission,
      created_at: Date.now(),
    };
    this.stmts.insertPermission.run(
      permission.permission_id,
      permission.tenant_id,
      permission.drive_id,
      permission.object_id,
      permission.grant_type,
      permission.grant_key,
      permission.grant_value,
      permission.permission,
      permission.created_at,
    );
    return permission;
  }

  /** List drive grants or every grant considered for an existing object. */
  list(driveId: string, options: ListPermissionsOptions = {}): PermissionRecord[] {
    if (!this.getDrive(driveId)) {
      throw new StorageError(404, `Drive not found: ${driveId}`);
    }
    if (!options.objectPath) {
      return this.stmts.getDrivePermissions.all(driveId) as PermissionRecord[];
    }

    const path = normalizeStoragePath(options.objectPath);
    if (!this.getObject(driveId, path)) {
      throw new StorageError(
        404,
        'Storage object was not found.',
        'STORAGE_OBJECT_NOT_FOUND',
      );
    }
    return this.selectForPath(driveId, path);
  }

  /** Read one stored grant by its stable identifier. */
  get(permissionId: string): PermissionRecord | null {
    return this.stmts.getPermissionById.get(permissionId) as PermissionRecord | null;
  }

  /** Revoke one stored grant. Retains the established idempotent return shape. */
  revoke(permissionId: string): boolean {
    this.stmts.deletePermission.run(permissionId);
    return true;
  }

  /** Evaluate owner/public/bypass and hierarchical additive ACL authority. */
  checkAccess(
    driveId: string,
    path: string | null,
    userId: string | null,
    userRole: StorageActorRoleInput,
    userProperties: Record<string, string>,
    requiredLevel: PermissionLevel,
    scope?: ServiceDataScope,
  ): boolean {
    const drive = this.getDrive(driveId);
    if (!drive) return false;
    const userRoles = normalizeStorageActorRoles(userRole);

    if (this.options.tenancyMode === 'multi'
      && !scope
      && (userId !== null || userRoles.length > 0 || Object.keys(userProperties).length > 0)) {
      return false;
    }
    if (scope && !serviceDataScopeMatchesTenant(scope, drive.tenant_id)) {
      if (requiredLevel !== 'read') return false;
      if (drive.public) return true;
      return path
        ? this.getObject(driveId, normalizeStoragePath(path))?.public === 1
        : false;
    }
    if (this.options.tenancyMode === 'single' && userRoles.includes('admin')) return true;
    if (drive.public && requiredLevel === 'read') return true;

    const canonicalPath = path ? normalizeStoragePath(path) : null;
    if (canonicalPath && requiredLevel === 'read') {
      if (this.getObject(driveId, canonicalPath)?.public) return true;
    }
    if (!userId) return false;
    if (drive.owner_id === userId) return true;

    const permissions = canonicalPath
      ? this.selectForPath(driveId, canonicalPath)
      : this.stmts.getDrivePermissions.all(driveId) as PermissionRecord[];
    return storagePermissionsGrantAccess(
      permissions,
      userId,
      userRoles,
      userProperties,
      requiredLevel,
      this.options.isPolicyTrustedProperty,
    );
  }

  private selectForPath(driveId: string, path: string): PermissionRecord[] {
    const objectIds = collectStorageAclObjectIds(
      path,
      (candidate) => this.getObject(driveId, candidate),
    );
    return selectHierarchicalStoragePermissions(
      this.stmts.getAllPermissions.all(driveId) as PermissionRecord[],
      objectIds,
    );
  }

  private getDrive(driveId: string): DriveRecord | null {
    return this.stmts.getDrive.get(driveId) as DriveRecord | null;
  }

  private getObject(driveId: string, path: string): ObjectRecord | null {
    return this.stmts.getObjectByPath.get(driveId, path) as ObjectRecord | null;
  }
}

function normalizeGrantText(value: unknown, maximum: number, label: string): string {
  if (typeof value !== 'string') throw invalidGrant(`${label} is invalid.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum || INVALID_GRANT_TEXT.test(normalized)) {
    throw invalidGrant(`${label} is invalid.`);
  }
  return normalized;
}

function invalidGrant(message: string): StorageError {
  return new StorageError(400, message, 'STORAGE_INPUT_INVALID');
}

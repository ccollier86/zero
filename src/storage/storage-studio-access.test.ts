/**
 * storage-studio-access.test.ts
 *
 * Locks Guardian fragments and deterministic single/multi ownership mapping.
 */

import { describe, expect, test } from 'bun:test';
import {
  STORAGE_CATALOG_READ_PERMISSION,
  STORAGE_DRIVES_DELETE_PERMISSION,
  STORAGE_DRIVES_MANAGE_PERMISSION,
  STORAGE_DRIVES_PROVISION_PERMISSION,
  STORAGE_PERSONAL_DRIVES_PROVISION_PERMISSION,
  STORAGE_STUDIO_ADMIN_ROLE_FRAGMENT,
  STORAGE_STUDIO_MANAGER_ROLE_FRAGMENT,
  STORAGE_STUDIO_PERMISSION_REGISTRY,
  STORAGE_STUDIO_PERSONAL_ROLE_FRAGMENT,
  STORAGE_STUDIO_ROLE_FRAGMENTS,
  hasStorageStudioPermission,
} from './storage-studio-access';
import { resolveStorageStudioOwnership } from './storage-studio-ownership';

describe('Storage Studio Guardian fragments', () => {
  test('declares the closed portable permission registry', () => {
    expect(Object.keys(STORAGE_STUDIO_PERMISSION_REGISTRY)).toEqual([
      STORAGE_CATALOG_READ_PERMISSION,
      STORAGE_DRIVES_PROVISION_PERMISSION,
      STORAGE_DRIVES_MANAGE_PERMISSION,
      STORAGE_DRIVES_DELETE_PERMISSION,
      STORAGE_PERSONAL_DRIVES_PROVISION_PERMISSION,
    ]);
    expect(Object.values(STORAGE_STUDIO_PERMISSION_REGISTRY).every(
      (permission) => !Object.hasOwn(permission, 'scope'),
    )).toBe(true);
    expect(Object.values(STORAGE_STUDIO_PERMISSION_REGISTRY).every(Object.isFrozen)).toBe(true);
  });

  test('keeps permanent deletion and personal provisioning independently grantable', () => {
    expect(STORAGE_STUDIO_MANAGER_ROLE_FRAGMENT.permissions).not.toContain(
      STORAGE_DRIVES_DELETE_PERMISSION,
    );
    expect(STORAGE_STUDIO_PERSONAL_ROLE_FRAGMENT.permissions).toEqual([
      STORAGE_CATALOG_READ_PERMISSION,
      STORAGE_PERSONAL_DRIVES_PROVISION_PERMISSION,
    ]);
    expect(STORAGE_STUDIO_ADMIN_ROLE_FRAGMENT.permissions).toContain(
      STORAGE_DRIVES_DELETE_PERMISSION,
    );
    expect(Object.isFrozen(STORAGE_STUDIO_ROLE_FRAGMENTS)).toBe(true);
    expect(hasStorageStudioPermission(
      STORAGE_STUDIO_ADMIN_ROLE_FRAGMENT.permissions ?? [],
      STORAGE_DRIVES_MANAGE_PERMISSION,
    )).toBe(true);
  });
});

describe('Storage Studio ownership', () => {
  test('maps organization ownership to the application in single mode', () => {
    expect(resolveStorageStudioOwnership({
      tenancyMode: 'single',
      choice: 'organization',
      userId: 'user_one',
    })).toEqual({
      ownerKind: 'application',
      ownerId: 'application',
      scopeKind: 'application',
      scopeId: 'application',
    });
    expect(resolveStorageStudioOwnership({
      tenancyMode: 'single',
      choice: 'personal',
      userId: 'user_one',
    })).toEqual({
      ownerKind: 'user',
      ownerId: 'user_one',
      scopeKind: 'application',
      scopeId: 'application',
    });
  });

  test('maps organization and personal ownership inside a validated tenant', () => {
    expect(resolveStorageStudioOwnership({
      tenancyMode: 'multi',
      choice: 'organization',
      userId: 'user_one',
      tenantId: 'tenant_one',
    })).toEqual({
      ownerKind: 'organization',
      ownerId: 'tenant_one',
      scopeKind: 'tenant',
      scopeId: 'tenant_one',
    });
    expect(resolveStorageStudioOwnership({
      tenancyMode: 'multi',
      choice: 'personal',
      userId: 'user_one',
      tenantId: 'tenant_one',
    })).toMatchObject({
      ownerKind: 'user',
      ownerId: 'user_one',
      scopeKind: 'tenant',
      scopeId: 'tenant_one',
    });
    expect(() => resolveStorageStudioOwnership({
      tenancyMode: 'multi',
      choice: 'organization',
      userId: 'user_one',
    })).toThrow('tenantId');
  });
});

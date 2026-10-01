import { describe, expect, test } from 'bun:test';
import {
  authRoleLabel,
  createAuthRoleLabelMap,
  projectAuthRoleAccess,
} from './auth-role-presentation';

describe('auth role presentation', () => {
  test('uses configured labels and preserves unknown retired role keys', () => {
    const labels = createAuthRoleLabelMap([
      { key: 'billing_admin', label: 'Billing administrator' },
      { key: 'member', label: 'Contributor' },
    ]);

    expect(authRoleLabel('billing_admin', labels)).toBe(
      'Billing administrator',
    );
    expect(authRoleLabel('member', labels)).toBe('Contributor');
    expect(authRoleLabel('retired_role', labels)).toBe('retired_role');
  });

  test('projects assigned roles and effective permissions deterministically', () => {
    const projection = projectAuthRoleAccess([
      {
        key: 'writer',
        label: 'Writer',
        permissions: ['documents:write', 'documents:read'],
        allPermissions: false,
      },
      {
        key: 'reader',
        label: 'Reader',
        permissions: ['documents:read'],
        allPermissions: false,
      },
    ], ['writer', 'retired_role', 'reader', 'writer']);

    expect(projection).toEqual({
      assignedRoles: [
        { key: 'reader', label: 'Reader', retired: false },
        { key: 'retired_role', label: 'retired_role', retired: true },
        { key: 'writer', label: 'Writer', retired: false },
      ],
      allPermissions: false,
      permissions: ['documents:read', 'documents:write'],
    });
  });

  test('reports unbounded access without leaking explicit or retired-role permissions', () => {
    const projection = projectAuthRoleAccess([
      {
        key: 'owner',
        label: 'Owner',
        permissions: [],
        allPermissions: true,
      },
      {
        key: 'member',
        label: 'Member',
        permissions: ['documents:read'],
        allPermissions: false,
      },
    ], ['unknown', 'member', 'owner']);

    expect(projection.allPermissions).toBe(true);
    expect(projection.permissions).toEqual([]);
    expect(projection.assignedRoles).toContainEqual({
      key: 'unknown',
      label: 'unknown',
      retired: true,
    });
  });
});

import { describe, expect, test } from 'bun:test';
import {
  platformTenantDirectoryProjectionKey,
  platformTenantMemberProjectionKey,
  reconcilePlatformTenantProjection,
} from './platform-tenant-directory-hooks';
import {
  EMPTY_PLATFORM_TENANT_DIRECTORY_ERRORS,
  platformTenantDirectoryAggregateError,
  reducePlatformTenantDirectoryErrors,
} from './platform-tenant-directory-errors';
import type { AuthPlatformTenant } from './auth-platform-administration-types';

describe('platform tenant directory projection continuity', () => {
  test('keeps refresh identity stable while fencing boundaries and query scopes', () => {
    const directory = platformTenantDirectoryProjectionKey(4, {
      limit: 25,
      search: 'care',
      status: 'active',
    });
    expect(platformTenantDirectoryProjectionKey(4, {
      limit: 25,
      search: 'care',
      status: 'active',
    })).toBe(directory);
    expect(platformTenantDirectoryProjectionKey(5, {
      limit: 25,
      search: 'care',
      status: 'active',
    })).not.toBe(directory);
    expect(platformTenantDirectoryProjectionKey(4, {
      limit: 25,
      search: 'other',
      status: 'active',
    })).not.toBe(directory);
  });

  test('keeps selected-member identity stable across refreshes but not workspace changes', () => {
    const members = platformTenantMemberProjectionKey(8, {
      selectedTenantId: 'tenant-one',
      memberLimit: 50,
      memberSearch: 'ada',
      memberStatus: 'active',
    });
    expect(platformTenantMemberProjectionKey(8, {
      selectedTenantId: 'tenant-one',
      memberLimit: 50,
      memberSearch: 'ada',
      memberStatus: 'active',
    })).toBe(members);
    expect(platformTenantMemberProjectionKey(8, {
      selectedTenantId: 'tenant-two',
      memberLimit: 50,
      memberSearch: 'ada',
      memberStatus: 'active',
    })).not.toBe(members);
    expect(platformTenantMemberProjectionKey(9, {
      selectedTenantId: 'tenant-one',
      memberLimit: 50,
      memberSearch: 'ada',
      memberStatus: 'active',
    })).not.toBe(members);
  });

  test('keeps an exact committed tenant visible beyond the current cursor page', () => {
    const oldest = tenant('tenant-old', 10);
    const current = tenant('tenant-current', 20);
    const created = tenant('tenant-created', 30);

    expect(reconcilePlatformTenantProjection(
      [current, oldest],
      [created],
      {},
    ).map((entry) => entry.tenantId)).toEqual([
      'tenant-created',
      'tenant-current',
      'tenant-old',
    ]);
    expect(reconcilePlatformTenantProjection(
      [current, oldest],
      [{ ...created, status: 'suspended' }],
      { status: 'active' },
    ).map((entry) => entry.tenantId)).toEqual([
      'tenant-current',
      'tenant-old',
    ]);
  });

  test('keeps directory, selected-member, and mutation failures isolated', () => {
    const directoryFailed = reducePlatformTenantDirectoryErrors(
      EMPTY_PLATFORM_TENANT_DIRECTORY_ERRORS,
      { type: 'fail-directory', error: 'directory failed' },
    );
    const membersFailed = reducePlatformTenantDirectoryErrors(directoryFailed, {
      type: 'fail-selected-members',
      error: 'members failed',
    });
    const mutationFailed = reducePlatformTenantDirectoryErrors(membersFailed, {
      type: 'fail-mutation',
      error: 'mutation failed',
    });

    expect(mutationFailed).toEqual({
      directoryError: 'directory failed',
      selectedTenantMembersError: 'members failed',
      mutationError: 'mutation failed',
    });
    expect(reducePlatformTenantDirectoryErrors(mutationFailed, {
      type: 'clear-selected-members',
    })).toEqual({
      directoryError: 'directory failed',
      selectedTenantMembersError: null,
      mutationError: 'mutation failed',
    });
    expect(reducePlatformTenantDirectoryErrors(mutationFailed, {
      type: 'clear-directory',
    })).toEqual({
      directoryError: null,
      selectedTenantMembersError: 'members failed',
      mutationError: 'mutation failed',
    });
    expect(reducePlatformTenantDirectoryErrors(mutationFailed, {
      type: 'clear-mutation',
    })).toEqual({
      directoryError: 'directory failed',
      selectedTenantMembersError: 'members failed',
      mutationError: null,
    });
  });

  test('retains the legacy aggregate precedence without coupling slice state', () => {
    expect(platformTenantDirectoryAggregateError({
      directoryError: 'directory failed',
      selectedTenantMembersError: 'members failed',
      mutationError: 'mutation failed',
    })).toBe('directory failed');
    expect(platformTenantDirectoryAggregateError({
      directoryError: null,
      selectedTenantMembersError: 'members failed',
      mutationError: 'mutation failed',
    })).toBe('members failed');
    expect(platformTenantDirectoryAggregateError({
      directoryError: null,
      selectedTenantMembersError: null,
      mutationError: 'mutation failed',
    })).toBe('mutation failed');
  });
});

function tenant(tenantId: string, createdAt: number): AuthPlatformTenant {
  return {
    tenantId,
    kind: 'organization',
    slug: tenantId,
    name: tenantId,
    status: 'active',
    authorizationGeneration: 1,
    createdAt,
    updatedAt: createdAt,
    suspendedAt: null,
    memberCount: 1,
    activeMemberCount: 1,
  };
}

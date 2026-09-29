import { describe, expect, test } from 'bun:test';
import { AuthError } from './types';
import {
  normalizeAuthTenantMemberCreateRoleKeys,
  normalizeAuthTenantMemberReplacementRoleKeys,
} from './auth-tenant-member-role-selection';

describe('tenant member create role selection', () => {
  test('distinguishes omission from an explicitly empty selection', () => {
    expect(normalizeAuthTenantMemberCreateRoleKeys(undefined, 'simple'))
      .toEqual(['member']);
    expectInvalid(() => normalizeAuthTenantMemberCreateRoleKeys([], 'simple'));
    expectInvalid(() => normalizeAuthTenantMemberCreateRoleKeys([], 'advanced'));
  });

  test('allows one simple role and multiple advanced roles within the bound', () => {
    expect(normalizeAuthTenantMemberCreateRoleKeys(['manager'], 'simple'))
      .toEqual(['manager']);
    expectInvalid(() => normalizeAuthTenantMemberCreateRoleKeys(
      ['member', 'manager'],
      'simple',
    ));
    expect(normalizeAuthTenantMemberCreateRoleKeys(
      ['manager', 'member'],
      'advanced',
    )).toEqual(['manager', 'member']);
    expect(normalizeAuthTenantMemberCreateRoleKeys(
      Array.from({ length: 32 }, (_, index) => `role-${index}`),
      'advanced',
    )).toHaveLength(32);
    expectInvalid(() => normalizeAuthTenantMemberCreateRoleKeys(
      Array.from({ length: 33 }, (_, index) => `role-${index}`),
      'advanced',
    ));
  });

  test('rejects malformed and duplicate selections at the service boundary', () => {
    expectInvalid(() => normalizeAuthTenantMemberCreateRoleKeys(
      ['member', 'member'],
      'advanced',
    ));
    expectInvalid(() => normalizeAuthTenantMemberCreateRoleKeys([''], 'advanced'));
    expectInvalid(() => normalizeAuthTenantMemberCreateRoleKeys(['Not A Role'], 'advanced'));
    expectInvalid(() => normalizeAuthTenantMemberCreateRoleKeys(
      [42] as unknown as readonly string[],
      'advanced',
    ));
    expectInvalid(() => normalizeAuthTenantMemberCreateRoleKeys(
      new Array(1),
      'advanced',
    ));
  });

  test('preserves only a deliberate empty replacement selection', () => {
    expect(normalizeAuthTenantMemberReplacementRoleKeys([])).toEqual([]);
    expectInvalid(() => normalizeAuthTenantMemberReplacementRoleKeys(new Array(1)));
    expectInvalid(() => normalizeAuthTenantMemberReplacementRoleKeys(['   ']));
    expectInvalid(() => normalizeAuthTenantMemberReplacementRoleKeys([
      'member',
      'member',
    ]));
  });
});

function expectInvalid(operation: () => unknown): void {
  try {
    operation();
    throw new Error('Expected tenant role selection to be rejected');
  } catch (error) {
    expect(error).toBeInstanceOf(AuthError);
    expect(error).toMatchObject({
      code: 'TENANT_ROLE_SELECTION_INVALID',
      status: 422,
    });
  }
}

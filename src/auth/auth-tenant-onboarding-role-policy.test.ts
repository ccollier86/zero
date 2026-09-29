import { describe, expect, test } from 'bun:test';
import { resolveAuthBehaviorConfig } from './auth-config';
import {
  normalizeAuthTenantOnboardingRoleKeys,
} from './auth-tenant-onboarding-role-policy';
import { createAuthorizationKernel } from './authorization-kernel';
import { AuthError, type AuthAuthorizationMode } from './types';

describe('tenant onboarding role policy input boundary', () => {
  test('normalizes valid input without mutating it and preserves mode semantics', () => {
    const input = [' reviewer ', 'member'];
    const advanced = normalize(input, 'advanced');

    expect(advanced).toEqual(['member', 'reviewer']);
    expect(input).toEqual([' reviewer ', 'member']);
    expect(Object.isFrozen(advanced)).toBe(true);
    expect(normalize([' reviewer '], 'simple')).toEqual(['reviewer']);
    expectInvalid(() => normalize(['member', 'reviewer'], 'simple'));
  });

  test('rejects every selection that could otherwise shrink or change a grant', () => {
    const sparse = new Array(1) as string[];
    const malformed: unknown[] = [
      undefined,
      null,
      false,
      'member',
      {},
      [],
      sparse,
      [''],
      ['   '],
      ['member', 7],
      ['member', 'member'],
      ['member', ' member '],
      ['Not-A-Role'],
      ['role with spaces'],
      ['a'.repeat(65)],
      Array.from({ length: 33 }, (_, index) => `role-${index}`),
    ];

    for (const roleKeys of malformed) {
      expectInvalid(() => normalizeUnknown(roleKeys, 'advanced'));
    }
  });
});

function normalize(
  roleKeys: readonly string[],
  mode: AuthAuthorizationMode,
): readonly string[] {
  return normalizeUnknown(roleKeys, mode);
}

function normalizeUnknown(
  roleKeys: unknown,
  mode: AuthAuthorizationMode,
): readonly string[] {
  const kernel = createAuthorizationKernel(resolveAuthBehaviorConfig({
    tenancy: 'multi',
    authorization: {
      mode,
      roles: {
        reviewer: { permissions: [] },
      },
    },
  }));
  return normalizeAuthTenantOnboardingRoleKeys({
    kernel,
    roleKeys: roleKeys as readonly string[],
    tenantKind: 'organization',
  });
}

function expectInvalid(operation: () => unknown): void {
  try {
    operation();
    throw new Error('Expected tenant onboarding roles to be rejected');
  } catch (error) {
    expect(error).toBeInstanceOf(AuthError);
    expect(error).toMatchObject({
      code: 'TENANT_ROLE_SELECTION_INVALID',
      message: 'Onboarding role selection is invalid',
      status: 422,
    });
  }
}

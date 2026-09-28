import { describe, expect, test } from 'bun:test';
import {
  authRoleLabel,
  createAuthRoleLabelMap,
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
});

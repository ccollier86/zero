/**
 * user-management-property-editor.test.ts
 *
 * Verifies pure admin user property editor helpers. Component rendering and
 * backend property validation are covered by their own modules.
 */

import { describe, expect, test } from 'bun:test';
import type { AuthAdminConfig } from '../../../frontend/client/auth-client';
import {
  buildPropertyMutationPlan,
  canEditCustomUserProperties,
  createCustomPropertyRows,
} from './user-management-property-editor';

describe('admin user property editor helpers', () => {
  test('splits configured fields from editable custom properties', () => {
    const config = makeConfig({ strictUserProperties: false });

    expect(canEditCustomUserProperties(config)).toBe(true);
    expect(createCustomPropertyRows(config, {
      department: 'clinical',
      plan: 'pro',
      location: 'west',
    })).toEqual([
      { id: 'existing:department', key: 'department', value: 'clinical' },
      { id: 'existing:location', key: 'location', value: 'west' },
    ]);
  });

  test('builds upserts and deletes for custom key changes', () => {
    const config = makeConfig({ strictUserProperties: false });

    const plan = buildPropertyMutationPlan({
      config,
      originalProperties: {
        department: 'clinical',
        legacy: 'remove-me',
        plan: 'free',
      },
      configuredValues: {
        plan: 'pro',
      },
      customRows: [
        { id: 'existing:department', key: 'department', value: 'billing' },
        { id: 'new:1', key: 'region', value: 'east' },
      ],
    });

    expect(plan).toEqual({
      properties: {
        plan: 'pro',
        department: 'billing',
        region: 'east',
      },
      deleteKeys: ['legacy'],
    });
  });

  test('rejects duplicate or configured custom keys', () => {
    const config = makeConfig({ strictUserProperties: false });

    expect(() =>
      buildPropertyMutationPlan({
        config,
        originalProperties: {},
        configuredValues: {},
        customRows: [
          { id: 'new:1', key: 'department', value: 'a' },
          { id: 'new:2', key: 'department', value: 'b' },
        ],
      }),
    ).toThrow('"department" is listed more than once');

    expect(() =>
      buildPropertyMutationPlan({
        config,
        originalProperties: {},
        configuredValues: {},
        customRows: [
          { id: 'new:1', key: 'plan', value: 'pro' },
        ],
      }),
    ).toThrow('"plan" is already managed');
  });
});

function makeConfig(
  overrides: Partial<Pick<AuthAdminConfig, 'strictUserProperties'>> = {},
): AuthAdminConfig {
  return {
    registration: {
      mode: 'public',
      bootstrapRequired: false,
      publicRegistrationEnabled: true,
      userCount: 1,
    },
    email: {
      enabled: true,
      provider: 'memory',
      hasPublicUrl: true,
    },
    accountEmails: {
      adminCreatedUser: true,
      passwordReset: true,
      passwordChangedNotice: false,
      emailVerification: false,
      manualPasswordReset: true,
      actionTokenTTL: '1h',
      requestCooldown: '5m',
      resetPath: '/reset-password',
      setupPath: '/setup-password',
    },
    account: {
      requireEmailVerification: false,
      emailVerificationPath: '/verify-email',
      emailVerificationReady: false,
      allowAdminMarkEmailVerified: false,
    },
    capabilities: {
      canManageUsers: true,
      canManageGlobalAdmins: true,
      manualPasswordReset: true,
      setupEmail: true,
      passwordResetEmail: true,
      emailVerification: false,
      adminMarkEmailVerified: false,
      mfa: false,
      suspendUsers: true,
      promoteAdmins: true,
      userProperties: true,
    },
    userProperties: {
      plan: {
        key: 'plan',
        type: 'enum',
        label: 'Plan',
        values: ['free', 'pro'],
        default: 'free',
        editableBy: 'admin',
        useInPolicies: true,
      },
    },
    strictUserProperties: overrides.strictUserProperties ?? false,
  };
}

/**
 * auth-config.test.ts
 *
 * Verifies auth behavior config normalization and security validation. This
 * file owns pure config tests only; route payload behavior and user-property
 * writes are covered by integration and service tests.
 */

import { describe, expect, test } from 'bun:test';
import {
  isPolicyTrustedUserProperty,
  resolveAuthBehaviorConfig,
} from './auth-config';

describe('resolveAuthBehaviorConfig', () => {
  test('defaults user properties to self-editable and not policy trusted', () => {
    const config = resolveAuthBehaviorConfig({
      userProperties: {
        theme: {
          type: 'enum',
          values: ['light', 'dark'],
        },
      },
    });

    expect(config.userProperties.theme).toMatchObject({
      editableBy: 'user',
      useInPolicies: false,
    });
    expect(isPolicyTrustedUserProperty(config.userProperties.theme)).toBe(false);
  });

  test('allows admin, system, and none-editable properties to opt into policy use', () => {
    const config = resolveAuthBehaviorConfig({
      userProperties: {
        department: {
          type: 'enum',
          values: ['accounting', 'support'],
          editableBy: 'admin',
          useInPolicies: true,
        },
        clearance: {
          type: 'string',
          editableBy: 'system',
          useInPolicies: true,
        },
        complianceHold: {
          type: 'boolean',
          editableBy: 'none',
          useInPolicies: true,
        },
      },
    });

    expect(isPolicyTrustedUserProperty(config.userProperties.department)).toBe(true);
    expect(isPolicyTrustedUserProperty(config.userProperties.clearance)).toBe(true);
    expect(isPolicyTrustedUserProperty(config.userProperties.complianceHold)).toBe(true);
  });

  test('rejects policy trust for self-editable user properties', () => {
    expect(() =>
      resolveAuthBehaviorConfig({
        userProperties: {
          notificationsEnabled: {
            type: 'boolean',
            editableBy: 'user',
            useInPolicies: true,
          },
        },
      })
    ).toThrow('cannot set useInPolicies: true');
  });
});

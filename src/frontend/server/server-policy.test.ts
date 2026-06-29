/**
 * server-policy.test.ts
 *
 * Verifies middleware policy evaluation for auth, role, and user-property
 * requirements. These tests keep policy behavior independent from Elysia
 * middleware mounting.
 */

import { describe, expect, test } from 'bun:test';

import { AuthError, type AuthContext } from '../../auth/types';
import {
  enforceServerPolicy,
  evaluateServerPolicy,
  getEffectiveAuthRequirement,
  type ZeroPolicyUserPropertyStore,
} from './server-policy';

const user: AuthContext = {
  userId: 'u_1',
  email: 'user@test.com',
  role: 'user',
};

const admin: AuthContext = {
  userId: 'u_admin',
  email: 'admin@test.com',
  role: 'admin',
};

describe('server policy', () => {
  test('computes effective auth from auth, role, and properties', () => {
    expect(getEffectiveAuthRequirement(undefined)).toBe('optional');
    expect(getEffectiveAuthRequirement({ auth: false })).toBe(false);
    expect(getEffectiveAuthRequirement({ auth: 'admin', role: 'manager' })).toBe('admin');
    expect(getEffectiveAuthRequirement({ role: 'manager' })).toBe('user');
    expect(getEffectiveAuthRequirement({ properties: { department: 'ops' } })).toBe('user');
  });

  test('allows optional and explicit public policies without auth', () => {
    expect(evaluateServerPolicy(undefined, { authContext: null })).toMatchObject({
      allowed: true,
      auth: null,
    });
    expect(evaluateServerPolicy({ auth: false }, { authContext: null })).toMatchObject({
      allowed: true,
      auth: null,
    });
  });

  test('requires authenticated users for user/admin/role/property policies', () => {
    expect(evaluateServerPolicy({ auth: 'user' }, { authContext: null })).toMatchObject({
      allowed: false,
      status: 401,
      reason: 'unauthorized',
    });
    expect(evaluateServerPolicy({ role: 'manager' }, { authContext: null })).toMatchObject({
      allowed: false,
      status: 401,
    });
    expect(evaluateServerPolicy({ properties: { department: 'ops' } }, { authContext: null })).toMatchObject({
      allowed: false,
      status: 401,
    });
  });

  test('enforces admin and role requirements', () => {
    expect(evaluateServerPolicy({ auth: 'admin' }, { authContext: admin })).toMatchObject({
      allowed: true,
      auth: admin,
    });
    expect(evaluateServerPolicy({ auth: 'admin' }, { authContext: user })).toMatchObject({
      allowed: false,
      status: 403,
      reason: 'forbidden',
    });
    expect(evaluateServerPolicy({ role: ['user', 'manager'] }, { authContext: user })).toMatchObject({
      allowed: true,
      auth: user,
    });
    expect(evaluateServerPolicy({ role: ['manager'] }, { authContext: user })).toMatchObject({
      allowed: false,
      status: 403,
      reason: 'role',
    });
  });

  test('matches property equality, arrays, in, not, and exists operators', () => {
    const store = propertyStore({
      plan: 'pro',
      department: 'accounting',
      notificationsEnabled: 'true',
    });

    expect(policy({ plan: 'pro' }, store)).toMatchObject({ allowed: true });
    expect(policy({ department: ['accounting', 'management'] }, store)).toMatchObject({ allowed: true });
    expect(policy({ department: { in: ['accounting', 'sales'] } }, store)).toMatchObject({ allowed: true });
    expect(policy({ plan: { not: 'free' } }, store)).toMatchObject({ allowed: true });
    expect(policy({ notificationsEnabled: true }, store)).toMatchObject({ allowed: true });
    expect(policy({ missing: { exists: false } }, store)).toMatchObject({ allowed: true });

    expect(policy({ plan: 'free' }, store)).toMatchObject({
      allowed: false,
      status: 403,
      reason: 'property',
    });
    expect(policy({ department: { not: ['accounting'] } }, store)).toMatchObject({
      allowed: false,
      status: 403,
    });
    expect(policy({ missing: { exists: true } }, store)).toMatchObject({
      allowed: false,
      status: 403,
    });
  });

  test('fails closed when property policy has no auth store', () => {
    const result = evaluateServerPolicy(
      { properties: { department: 'accounting' } },
      { authContext: user },
      { getPropertyStore: () => null }
    );

    expect(result).toMatchObject({
      allowed: false,
      status: 401,
      reason: 'auth-unavailable',
    });
  });

  test('throws AuthError from enforcement helper', () => {
    expect(() => enforceServerPolicy({ auth: 'user' }, { authContext: null }))
      .toThrow(AuthError);
  });
});

function policy(
  properties: Record<string, string | boolean | string[] | { in?: string[]; not?: string | string[]; exists?: boolean }>,
  store: ZeroPolicyUserPropertyStore
) {
  return evaluateServerPolicy(
    { properties },
    { authContext: user },
    { getPropertyStore: () => store }
  );
}

function propertyStore(properties: Record<string, string>): ZeroPolicyUserPropertyStore {
  return {
    getProperties() {
      return properties;
    },
  };
}

import { describe, expect, test } from 'bun:test';
import {
  assertAdminMayDeleteUser,
  assertAdminMayForcePasswordChange,
  assertAdminMayResetMfa,
  assertAdminMayResetPassword,
  assertAdminUserTransition,
} from './admin-user-guards';
import { AuthError, type UserRecord } from './types';
import type { UserStore } from './user-store';

const admin: UserRecord = {
  userId: 'admin-1',
  username: 'admin',
  email: 'admin@example.com',
  firstName: null,
  lastName: null,
  role: 'admin',
  status: 'active',
  passwordChangeRequired: false,
  emailVerifiedAt: null,
  emailVerificationRequired: false,
  mfaRequired: false,
  createdAt: 1,
  updatedAt: null,
  properties: {},
};

function storeWithActiveAdmins(count: number): UserStore {
  return { countActiveAdmins: () => count } as UserStore;
}

function expectCode(action: () => void, code: string): void {
  try {
    action();
    throw new Error('Expected guard to reject');
  } catch (error) {
    expect(error).toBeInstanceOf(AuthError);
    expect((error as AuthError).code).toBe(code);
  }
}

describe('admin user transition guards', () => {
  test('forbids destructive self transitions across every admin flow', () => {
    const store = storeWithActiveAdmins(2);
    expectCode(() => assertAdminUserTransition({
      store,
      actorUserId: admin.userId,
      user: admin,
      changes: { role: 'user' },
    }), 'SELF_ADMIN_TRANSITION_FORBIDDEN');
    expectCode(() => assertAdminMayDeleteUser(store, admin.userId, admin), 'SELF_ADMIN_TRANSITION_FORBIDDEN');
    expectCode(() => assertAdminMayForcePasswordChange(store, admin.userId, admin), 'SELF_ADMIN_TRANSITION_FORBIDDEN');
    expectCode(() => assertAdminMayResetPassword(admin.userId, admin), 'SELF_ADMIN_TRANSITION_FORBIDDEN');
    expectCode(() => assertAdminMayResetMfa(admin.userId, admin), 'SELF_ADMIN_TRANSITION_FORBIDDEN');
  });

  test('preserves the last active administrator for non-self transitions', () => {
    const store = storeWithActiveAdmins(1);
    expectCode(() => assertAdminUserTransition({
      store,
      actorUserId: 'admin-2',
      user: admin,
      changes: { status: 'suspended' },
    }), 'LAST_ACTIVE_ADMIN_REQUIRED');
    expectCode(() => assertAdminMayDeleteUser(store, 'admin-2', admin), 'LAST_ACTIVE_ADMIN_REQUIRED');
    expectCode(() => assertAdminMayForcePasswordChange(store, 'admin-2', admin), 'LAST_ACTIVE_ADMIN_REQUIRED');
  });
});

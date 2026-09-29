import { describe, expect, test } from 'bun:test';
import { emitPlatformCode } from '../observability/sink';
import { OBS_CODES } from '../observability/codes';
import { AdminPasswordRecoveryService } from './admin-password-recovery-service';
import type { AuthPlatformCodeEmitter } from './auth-observability';
import type { AuthContext, UserRecord } from './types';
import type { UserStore } from './user-store';

const actor: AuthContext = {
  userId: 'admin-actor',
  email: 'admin@example.test',
  role: 'admin',
};

const target: UserRecord = {
  userId: 'target-user',
  username: 'target',
  email: 'target@example.test',
  firstName: null,
  lastName: null,
  role: 'user',
  status: 'active',
  passwordChangeRequired: true,
  emailVerifiedAt: 1,
  emailVerificationRequired: false,
  mfaRequired: false,
  createdAt: 1,
  updatedAt: null,
  properties: {},
};

describe('administrator mutation authority callback boundary', () => {
  test('rejects Promise authority and prevents the protected mutation', async () => {
    let cleared = false;
    const emitted: string[] = [];
    const emitCode: AuthPlatformCodeEmitter = (definition, options) => {
      emitted.push(definition.code);
      return emitPlatformCode(definition, options);
    };
    const store = {
      transaction: <T>(operation: () => T) => operation(),
      getUserById: () => target,
      clearPasswordChangeRequired: () => {
        cleared = true;
        return true;
      },
    } as unknown as UserStore;
    const service = new AdminPasswordRecoveryService(store, emitCode);

    expect(() => service.clearPasswordChangeRequirement(
      target.userId,
      (async () => actor) as never,
    )).toThrow(expect.objectContaining({
      code: 'AUTH_STATE_INVARIANT_FAILED',
      status: 500,
      message: '[auth] Administrator authority callback must be synchronous.',
    }));
    await Promise.resolve();

    expect(cleared).toBe(false);
    expect(emitted).toEqual([OBS_CODES.AUTH_STATE_INVARIANT_FAILED.code]);
  });
});

import { describe, expect, test } from 'bun:test';
import {
  assertPlatformAdministrationInvitationsEnabled,
  resolvePlatformAdministrationInvitationPolicy,
} from '../../frontend/client/platform-administration-hooks';

describe('platform administration invitation policy', () => {
  test('keeps unresolved invitation policy nullable and fails configuration errors closed', () => {
    const unresolved = resolvePlatformAdministrationInvitationPolicy('loading', null, null);
    const failed = resolvePlatformAdministrationInvitationPolicy(
      'error',
      null,
      'Config transport failed',
    );

    expect(unresolved).toEqual({
      status: 'unresolved', enabled: null, delivery: null, error: null,
    });
    expect(failed).toEqual({
      status: 'error', enabled: false, delivery: null, error: 'Config transport failed',
    });
    expect(() => assertPlatformAdministrationInvitationsEnabled(unresolved)).toThrow(
      'configuration must load',
    );
    expect(() => assertPlatformAdministrationInvitationsEnabled({
      status: 'enabled',
      enabled: true,
      delivery: { email: true, manual: true, default: 'manual' },
      error: null,
    })).not.toThrow();
    try {
      assertPlatformAdministrationInvitationsEnabled(failed);
      throw new Error('Expected invitation policy guard to fail');
    } catch (cause) {
      expect(cause).toMatchObject({
        code: 'TENANT_INVITATIONS_UNAVAILABLE',
        status: 404,
        body: null,
      });
    }
  });
});

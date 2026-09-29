import { describe, expect, test } from 'bun:test';
import { resolveSyncAuthContext, sameSyncAuthContext } from './sync-auth';
import type { SyncAuthContext, SyncTokenVerifier } from './types';

function createVerifier(): SyncTokenVerifier {
  return {
    async verifyAccessToken(token: string) {
      if (token === 'user-token') {
        return { sub: 'user-1', email: 'user@test.local', role: 'user' };
      }
      if (token === 'admin-token') {
        return { sub: 'admin-1', email: 'admin@test.local', role: 'admin' };
      }
      return null;
    },
  };
}

describe('resolveSyncAuthContext', () => {
  test('allows anonymous sync when no auth bridge is configured', async () => {
    const result = await resolveSyncAuthContext(undefined);

    expect(result).toEqual({ ok: true, authContext: null });
  });

  test('allows missing token when auth is optional', async () => {
    const result = await resolveSyncAuthContext(undefined, {
      getTokenVerifier: () => createVerifier(),
    });

    expect(result).toEqual({ ok: true, authContext: null });
  });

  test('fails a cached optional anonymous bridge after its auth profile changes', async () => {
    let current = true;
    const verifier: SyncTokenVerifier = {
      assertCurrentProfile() {
        if (!current) throw new Error('AUTH_PROFILE_CHANGED');
      },
      async verifyAccessToken() {
        return null;
      },
    };
    const auth = { getTokenVerifier: () => verifier };

    expect(await resolveSyncAuthContext(undefined, auth)).toEqual({
      ok: true,
      authContext: null,
    });

    current = false;
    expect(await resolveSyncAuthContext(undefined, auth)).toEqual({
      ok: false,
      closeCode: 1011,
      reason: 'Auth resolution failed',
    });
  });

  test('rechecks the profile after asynchronous token resolution', async () => {
    let current = true;
    const verifier: SyncTokenVerifier = {
      assertCurrentProfile() {
        if (!current) throw new Error('AUTH_PROFILE_CHANGED');
      },
      async resolveAuthContext() {
        current = false;
        return {
          userId: 'user-1',
          email: 'user@test.local',
          role: 'user',
        };
      },
      async verifyAccessToken() {
        return null;
      },
    };

    expect(await resolveSyncAuthContext('user-token', {
      getTokenVerifier: () => verifier,
    })).toEqual({
      ok: false,
      closeCode: 1011,
      reason: 'Auth resolution failed',
    });
  });

  test('rejects missing token when auth is required', async () => {
    const result = await resolveSyncAuthContext(undefined, {
      required: true,
      getTokenVerifier: () => createVerifier(),
    });

    expect(result).toEqual({
      ok: false,
      closeCode: 4001,
      reason: 'Auth token required',
    });
  });

  test('rejects provided token when auth verifier is unavailable', async () => {
    const result = await resolveSyncAuthContext('user-token', {
      getTokenVerifier: () => null,
    });

    expect(result).toEqual({
      ok: false,
      closeCode: 1011,
      reason: 'Auth not initialized',
    });
  });

  test('rejects invalid provided token', async () => {
    const result = await resolveSyncAuthContext('bad-token', {
      getTokenVerifier: () => createVerifier(),
    });

    expect(result).toEqual({
      ok: false,
      closeCode: 4001,
      reason: 'Invalid auth token',
    });
  });

  test('rejects signature-only payloads without hydrated identity', async () => {
    const result = await resolveSyncAuthContext('native-token', {
      getTokenVerifier: () => ({
        async verifyAccessToken() {
          return { sub: 'user-1' };
        },
      }),
    });

    expect(result).toEqual({
      ok: false,
      closeCode: 4001,
      reason: 'Invalid auth token',
    });
  });

  test('prefers live account resolution over signature-only verification', async () => {
    let signatureOnlyVerifierCalled = false;
    const verifier: SyncTokenVerifier = {
      async resolveAuthContext() {
        return null;
      },
      async verifyAccessToken() {
        signatureOnlyVerifierCalled = true;
        return { sub: 'suspended', email: 'user@test.local', role: 'user' };
      },
    };

    const result = await resolveSyncAuthContext('signed-but-revoked', {
      getTokenVerifier: () => verifier,
    });

    expect(result).toEqual({
      ok: false,
      closeCode: 4001,
      reason: 'Invalid auth token',
    });
    expect(signatureOnlyVerifierCalled).toBe(false);
  });

  test('uses current role and identity returned by live account resolution', async () => {
    const verifier: SyncTokenVerifier = {
      async resolveAuthContext() {
        return {
          userId: 'user-1',
          email: 'renamed@test.local',
          role: 'admin',
        };
      },
      async verifyAccessToken() {
        return { sub: 'user-1', email: 'old@test.local', role: 'user' };
      },
    };

    const result = await resolveSyncAuthContext('current-token', {
      getTokenVerifier: () => verifier,
    });

    expect(result).toEqual({
      ok: true,
      authContext: {
        userId: 'user-1',
        email: 'renamed@test.local',
        role: 'admin',
      },
    });
  });

  test('maps a user token to sync auth context', async () => {
    const result = await resolveSyncAuthContext('user-token', {
      getTokenVerifier: () => createVerifier(),
    });

    expect(result).toEqual({
      ok: true,
      authContext: {
        userId: 'user-1',
        email: 'user@test.local',
        role: 'user',
      },
    });
  });

  test('maps an admin token to sync auth context', async () => {
    const result = await resolveSyncAuthContext('admin-token', {
      getTokenVerifier: () => createVerifier(),
    });

    expect(result).toEqual({
      ok: true,
      authContext: {
        userId: 'admin-1',
        email: 'admin@test.local',
        role: 'admin',
      },
    });
  });
});

describe('sameSyncAuthContext', () => {
  const context: SyncAuthContext = {
    userId: 'user-1',
    email: 'user@test.local',
    role: 'user',
    authGeneration: 4,
    clientId: 'browser',
    sessionKind: 'web',
    scope: ['openid', 'profile'],
    sessionId: 'session-1',
    sessionGeneration: 2,
    mfaVerifiedAt: 1_700_000_000_000,
    sessionScopeKind: 'tenant',
    sessionScopeId: 'tenant-1',
    tenantId: 'tenant-1',
    tenantKind: 'organization',
    membershipId: 'membership-1',
    tenantRole: 'member',
    tenantAuthorizationGeneration: 3,
    membershipAuthorizationGeneration: 5,
    authorizationAssignmentRevision: 'revision-1',
  };

  test('compares every Guardian security-boundary field', () => {
    expect(sameSyncAuthContext(context, { ...context })).toBe(true);
    expect(sameSyncAuthContext(context, {
      ...context,
      authGeneration: context.authGeneration! + 1,
    })).toBe(false);
    expect(sameSyncAuthContext(context, {
      ...context,
      mfaVerifiedAt: context.mfaVerifiedAt! + 1,
    })).toBe(false);
    expect(sameSyncAuthContext(context, {
      ...context,
      tenantKind: 'administration',
    })).toBe(false);
  });
});

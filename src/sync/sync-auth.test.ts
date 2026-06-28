import { describe, expect, test } from 'bun:test';
import { resolveSyncAuthContext } from './sync-auth';
import type { SyncTokenVerifier } from './types';

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

import { describe, expect, test } from 'bun:test';
import { hashToken } from '../../tokens/token-utils';
import { createReactiveDB } from '../../sync/reactive-db';
import { defineAuthTables } from '../auth-schema';
import { resolveNativeAuthConfig } from '../native';
import type { TokenService } from '../token-service';
import type { UserRecord } from '../types';
import type { UserStore } from '../user-store';
import type { PreparedNativeSession } from './native-auth-records';
import { rotateNativeRefresh } from './native-refresh-flow';
import type { NativeServiceContext } from './native-service-context';
import { NativeSessionStore } from './native-session-store';

function setup(options: ConstructorParameters<typeof NativeSessionStore>[1]) {
  const db = createReactiveDB({ mode: 'memory' });
  defineAuthTables(db);
  db.prepare(`INSERT INTO users
    (user_id, username, email, role, status, password_change_required,
     email_verification_required, mfa_required, created_at)
    VALUES ('user', 'user', 'user@example.test', 'user', 'active', 0, 0, 0, 1)`).run();
  return { db, store: new NativeSessionStore(db, options) };
}

function prepared(raw: string, familyId: string, createdAt: number, rotationCount = 0) {
  const session: PreparedNativeSession = {
    tokenId: `id-${raw}`, familyId, userId: 'user', clientId: 'desktop',
    tokenHash: hashToken(raw), scope: 'openid', authGeneration: 0,
    expiresAt: createdAt + 1_000_000, createdAt, rotationCount,
    consumedAt: null, revokedAt: null, replacedBy: null,
  };
  return session;
}

describe('NativeSessionStore refresh-family bounds', () => {
  test('throttles rotation without consuming the current token and preserves replay revocation', () => {
    let now = 10_000;
    const { db, store } = setup({ now: () => now, minRotationIntervalMs: 30_000 });
    try {
      expect(store.consumeCodeAndInsert(() => true, prepared('one', 'family', now))).toBe(true);
      expect(store.rotate(store.get('one')!, prepared('two', 'family', now, 1))).toBe('rotated');
      const current = store.get('two')!;
      expect(store.rotate(current, prepared('three', 'family', now, 2))).toBe('throttled');
      expect(store.get('two')?.consumedAt).toBeNull();
      now += 30_000;
      expect(store.rotate(current, prepared('three', 'family', now, 2))).toBe('rotated');
      expect(store.rotate(store.get('one')!, prepared('four', 'family', now, 1)))
        .toBe('reused');
      expect(store.get('three')).toBeNull();
    } finally {
      db.dispose();
    }
  });

  test('deletes terminal families but keeps wrong-client and throttled tokens usable', async () => {
    let now = Date.now();
    const { db, store } = setup({ now: () => now, minRotationIntervalMs: 30_000 });
    const state = { generation: 0, user: activeUser() as UserRecord | null };
    const context = flowContext(store, state);
    try {
      for (const raw of ['expired', 'disabled', 'missing', 'suspended', 'generation']) {
        const session = prepared(raw, `family-${raw}`, now);
        if (raw === 'expired') session.expiresAt = now - 1;
        store.consumeCodeAndInsert(() => true, session);
        context.config.native.enabled = raw !== 'disabled';
        state.user = raw === 'missing' ? null : activeUser();
        if (raw === 'suspended') state.user!.status = 'suspended';
        state.generation = raw === 'generation' ? 1 : 0;
        await expect(rotateNativeRefresh(context, {
          refreshToken: raw, clientId: 'desktop',
        })).rejects.toMatchObject({ code: 'invalid_grant' });
        expect(store.get(raw)).toBeNull();
      }

      context.config.native.enabled = true;
      state.user = activeUser();
      state.generation = 0;
      store.consumeCodeAndInsert(() => true, prepared('bound', 'family-bound', now));
      await expect(rotateNativeRefresh(context, {
        refreshToken: 'bound', clientId: 'other-client',
      })).rejects.toMatchObject({ code: 'invalid_grant' });
      expect(store.get('bound')).not.toBeNull();

      store.consumeCodeAndInsert(() => true, prepared('paced', 'family-paced', now, 1));
      await expect(rotateNativeRefresh(context, {
        refreshToken: 'paced', clientId: 'desktop',
      })).rejects.toMatchObject({ code: 'temporarily_unavailable' });
      expect(store.get('paced')?.consumedAt).toBeNull();
      now += 30_000;
      const rotated = await rotateNativeRefresh(context, {
        refreshToken: 'paced', clientId: 'desktop',
      });
      expect(rotated.refresh_token).toBeString();
      expect(store.get('paced')?.consumedAt).not.toBeNull();
    } finally {
      db.dispose();
    }
  });

  test('caps rotations and active families while keeping storage bounded under stress', () => {
    let now = 20_000;
    const { db, store } = setup({
      now: () => now, minRotationIntervalMs: 0,
      maxRotationsPerFamily: 2, maxActiveFamiliesPerUserClient: 3,
    });
    try {
      store.consumeCodeAndInsert(() => true, prepared('q0', 'quota', now));
      expect(store.rotate(store.get('q0')!, prepared('q1', 'quota', ++now, 1)))
        .toBe('rotated');
      expect(store.rotate(store.get('q1')!, prepared('q2', 'quota', ++now, 2)))
        .toBe('rotated');
      expect(store.rotate(store.get('q2')!, prepared('q3', 'quota', ++now, 3)))
        .toBe('exhausted');
      expect(store.get('q2')).toBeNull();

      for (let index = 0; index < 100; index += 1) {
        store.consumeCodeAndInsert(
          () => true, prepared(`family-${index}`, `family-${index}`, ++now),
        );
      }
      const count = db.prepare(
        'SELECT COUNT(*) AS count FROM _auth_native_sessions'
      ).get() as { count: number };
      expect(count.count).toBe(3);
      expect(store.get('family-0')).toBeNull();
      expect(store.get('family-99')).not.toBeNull();
    } finally {
      db.dispose();
    }
  });
});

function activeUser(): UserRecord {
  return {
    userId: 'user', username: 'user', email: 'user@example.test', role: 'user',
    status: 'active', passwordChangeRequired: false, emailVerifiedAt: null,
    emailVerificationRequired: false, mfaRequired: false, firstName: null,
    lastName: null, createdAt: 1, updatedAt: null, properties: {},
  };
}

function flowContext(
  sessions: NativeSessionStore,
  state: { generation: number; user: UserRecord | null },
): NativeServiceContext {
  return {
    config: {
      native: resolveNativeAuthConfig({ clients: [{
        clientId: 'desktop', name: 'Desktop', redirectUris: ['com.example.desktop:/callback'],
      }] }),
      issuer: 'https://example.test/auth', audience: 'https://example.test',
      requestTtlMs: 60_000, codeTtlMs: 60_000, refreshTtlMs: 1_000_000,
    },
    sessions, requests: null!, codes: null!,
    users: {
      getUserById: () => state.user,
      getAuthGeneration: () => state.generation,
    } as unknown as UserStore,
    tokens: {
      signNativeAccessToken: async () => 'access-token',
      signNativeIdToken: async () => 'id-token',
      getAccessTokenTTLSeconds: () => 300,
    } as unknown as TokenService,
  };
}

import { describe, expect, test } from 'bun:test';
import { hashToken } from '../../tokens/token-utils';
import { emitPlatformCode } from '../../observability/sink';
import { createReactiveDB } from '../../sync/reactive-db';
import { defineAuthTables } from '../auth-schema';
import { resolveNativeAuthConfig } from '../native';
import type { TokenService } from '../token-service';
import { AuthError, type UserRecord } from '../types';
import type { UserStore } from '../user-store';
import type { PreparedNativeSession } from './native-auth-records';
import { rotateNativeRefresh } from './native-refresh-flow';
import type { NativeServiceContext } from './native-service-context';
import { NativeSessionStore } from './native-session-store';
import { NativeTenantAuthorityService } from './native-tenant-authority';

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
    mfaVerifiedAt: null,
    expiresAt: createdAt + 1_000_000, createdAt, rotationCount,
    consumedAt: null, revokedAt: null, replacedBy: null,
  };
  return session;
}

describe('NativeSessionStore refresh-family bounds', () => {
  test('rejects an async runtime profile guard', () => {
    const { db, store } = setup({});
    try {
      store.setRuntimeProfileGuard(async () => {});
      expect(() => store.assertCurrentProfile()).toThrow(expect.objectContaining({
        code: 'AUTH_STATE_INVARIANT_FAILED',
        message: '[auth] Native session runtime profile guard must be synchronous.',
      }));
    } finally {
      db.dispose();
    }
  });

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

  test('rejects newly required unassured families and preserves verified assurance on rotation', async () => {
    const now = Date.now();
    const { db, store } = setup({ now: () => now, minRotationIntervalMs: 0 });
    const state = { generation: 0, user: activeUser() as UserRecord | null };
    const context = flowContext(store, state);
    context.requiresMfaAssurance = () => true;
    try {
      store.consumeCodeAndInsert(
        () => true,
        prepared('unassured', 'family-unassured', now),
      );
      await expect(rotateNativeRefresh(context, {
        refreshToken: 'unassured', clientId: 'desktop',
      })).rejects.toMatchObject({ code: 'invalid_grant' });
      expect(store.get('unassured')).toBeNull();

      const assured = prepared('assured', 'family-assured', now);
      assured.mfaVerifiedAt = 12_345;
      store.consumeCodeAndInsert(() => true, assured);
      const rotated = await rotateNativeRefresh(context, {
        refreshToken: 'assured', clientId: 'desktop',
      });
      expect(store.get(rotated.refresh_token)?.mfaVerifiedAt).toBe(12_345);
    } finally {
      db.dispose();
    }
  });

  test('requires profile completion before signing or consuming a native refresh family', async () => {
    const now = Date.now();
    const { db, store } = setup({ now: () => now, minRotationIntervalMs: 0 });
    const admittedUsers: string[] = [];
    let signedTokens = 0;
    const context = flowContext(store, { generation: 0, user: activeUser() }, {
      assertFullSessionAdmission: (userId) => {
        admittedUsers.push(userId);
        throw new AuthError('Synthetic required profile', 'AUTH_PROFILE_COMPLETION_REQUIRED', 403);
      },
      signNativeAccessToken: async () => { signedTokens += 1; return 'access-token'; },
      signNativeIdToken: async () => { signedTokens += 1; return 'id-token'; },
    });
    try {
      store.consumeCodeAndInsert(() => true, prepared('incomplete', 'incomplete-family', now));
      await expect(rotateNativeRefresh(context, {
        refreshToken: 'incomplete', clientId: 'desktop',
      })).rejects.toMatchObject({ code: 'invalid_grant' });
      expect(admittedUsers).toEqual(['user']);
      expect(signedTokens).toBe(0);
      expect(store.get('incomplete')).toMatchObject({ consumedAt: null, revokedAt: null });
      expect(db.prepare('SELECT COUNT(*) AS count FROM _auth_native_sessions').get())
        .toEqual({ count: 1 });
    } finally {
      db.dispose();
    }
  });

  test('rechecks profile completion at the native refresh writer after held signing', async () => {
    const now = Date.now();
    const { db, store } = setup({ now: () => now, minRotationIntervalMs: 0 });
    const signingEntered = Promise.withResolvers<void>();
    const signingReleased = Promise.withResolvers<void>();
    const admittedUsers: string[] = [];
    let profileReady = true;
    let rotation: ReturnType<typeof rotateNativeRefresh> | null = null;
    const context = flowContext(store, { generation: 0, user: activeUser() }, {
      assertFullSessionAdmission: (userId) => {
        admittedUsers.push(userId);
        if (!profileReady) {
          throw new AuthError('Synthetic profile unavailable', 'AUTH_PROFILE_COMPLETION_NOT_READY', 503);
        }
      },
      signNativeAccessToken: async () => {
        signingEntered.resolve();
        await signingReleased.promise;
        return 'access-token';
      },
    });
    try {
      store.consumeCodeAndInsert(() => true, prepared('held', 'held-family', now));
      rotation = rotateNativeRefresh(context, {
        refreshToken: 'held', clientId: 'desktop',
      });
      await Promise.race([signingEntered.promise, rotation.then(() => {
        throw new Error('Native refresh settled without entering the held signer');
      })]);
      profileReady = false;
      signingReleased.resolve();
      await expect(rotation).rejects.toMatchObject({
        code: 'temporarily_unavailable', status: 503,
      });
      expect(admittedUsers).toEqual(['user', 'user']);
      expect(store.get('held')).toMatchObject({ consumedAt: null, revokedAt: null });
      expect(db.prepare('SELECT COUNT(*) AS count FROM _auth_native_sessions').get())
        .toEqual({ count: 1 });
    } finally {
      signingReleased.resolve();
      await rotation?.catch(() => {});
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

  test('rolls native family mutations back when an atomic audit callback fails', () => {
    const now = 30_000;
    const { db, store } = setup({ now: () => now });
    try {
      expect(store.consumeCodeAndInsert(
        () => true,
        prepared('audit-current', 'audit-family', now),
      )).toBe(true);
      expect(() => store.revokeFamily('audit-family', () => {
        throw new Error('audit unavailable');
      })).toThrow('audit unavailable');
      expect(store.get('audit-current')).not.toBeNull();

      const current = store.get('audit-current')!;
      expect(() => store.switchFamily(
        current,
        prepared('audit-replacement', 'audit-next-family', now + 1),
        () => true,
        () => { throw new Error('audit unavailable'); },
      )).toThrow('audit unavailable');
      expect(store.get('audit-current')?.revokedAt).toBeNull();
      expect(store.get('audit-replacement')).toBeNull();
    } finally {
      db.dispose();
    }
  });

  test('rejects Promise callbacks instead of treating them as native authority', () => {
    const now = 40_000;
    const { db, store } = setup({ now: () => now, minRotationIntervalMs: 0 });
    const asyncTrue = (async () => true) as unknown as () => boolean;
    const asyncFalse = (async () => false) as unknown as () => boolean;
    try {
      expect(() => store.consumeCodeAndInsert(
        asyncTrue,
        prepared('async-consume', 'async-consume-family', now),
      )).toThrow(expect.objectContaining({
        code: 'AUTH_STATE_INVARIANT_FAILED',
        message: '[auth] Native authorization code consumption must be synchronous.',
      }));
      expect(store.get('async-consume')).toBeNull();

      expect(store.consumeCodeAndInsert(
        () => true,
        prepared('async-current', 'async-family', now),
      )).toBe(true);
      const current = store.get('async-current')!;
      expect(() => store.rotate(
        current,
        prepared('async-rotated', 'async-family', now + 1, 1),
        asyncFalse,
      )).toThrow(expect.objectContaining({
        code: 'AUTH_STATE_INVARIANT_FAILED',
        message: '[auth] Native session rotation admission must be synchronous.',
      }));
      expect(store.get('async-current')?.revokedAt).toBeNull();
      expect(store.get('async-rotated')).toBeNull();

      expect(() => store.revokeFamily('async-family', async () => {}))
        .toThrow(expect.objectContaining({
          code: 'AUTH_STATE_INVARIANT_FAILED',
          message: '[auth] Native session revocation callback must be synchronous.',
        }));
      expect(store.get('async-current')?.revokedAt).toBeNull();

      expect(() => store.switchFamily(
        current,
        prepared('async-switched', 'async-next-family', now + 2),
        () => true,
        async () => {},
      )).toThrow(expect.objectContaining({
        code: 'AUTH_STATE_INVARIANT_FAILED',
        message: '[auth] Native session switch callback must be synchronous.',
      }));
      expect(store.get('async-current')?.revokedAt).toBeNull();
      expect(store.get('async-switched')).toBeNull();
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

type NativeRefreshTokenDouble = Pick<TokenService,
  'assertFullSessionAdmission' | 'signNativeAccessToken' | 'signNativeIdToken'
  | 'getAccessTokenTTLSeconds'>;

function flowContext(
  sessions: NativeSessionStore,
  state: { generation: number; user: UserRecord | null },
  tokenOverrides: Partial<NativeRefreshTokenDouble> = {},
): NativeServiceContext {
  const tokens = {
    assertFullSessionAdmission: (_userId: string) => {},
    signNativeAccessToken: async () => 'access-token',
    signNativeIdToken: async () => 'id-token',
    getAccessTokenTTLSeconds: () => 300,
    ...tokenOverrides,
  } satisfies NativeRefreshTokenDouble;
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
    tokens: tokens as unknown as TokenService,
    authority: new NativeTenantAuthorityService('single', null),
    requiresMfaAssurance: () => false,
    emitCode: emitPlatformCode,
  };
}

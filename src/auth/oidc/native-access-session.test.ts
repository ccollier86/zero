import { describe, expect, test } from 'bun:test';
import { createReactiveDB } from '../../sync/reactive-db';
import { hashToken } from '../../tokens/token-utils';
import { defineAuthTables } from '../auth-schema';
import { resolveNativeAuthConfig } from '../native';
import { createNativeAccessSessionValidator } from './native-access-session';
import type { PreparedNativeSession } from './native-auth-records';
import { NativeSessionStore } from './native-session-store';

const claims = {
  familyId: 'family-a', userId: 'user', clientId: 'desktop', authGeneration: 2,
};

describe('native access-session validation', () => {
  test('fences the cached family validator and session mutations after a profile change', () => {
    const { db, store } = setup();
    try {
      store.consumeCodeAndInsert(() => true, session('a', 'family-a', 20_000));
      const validator = createNativeAccessSessionValidator(config(true), store);
      let current = true;
      store.setRuntimeProfileGuard(() => {
        if (!current) throw new Error('AUTH_PROFILE_CHANGED');
      });
      expect(validator.isActive({
        sessionId: 'family-a',
        userId: 'user',
        clientId: 'desktop',
        authGeneration: 2,
      })).toBe(true);

      current = false;
      expect(() => validator.isActive({
        sessionId: 'family-a',
        userId: 'user',
        clientId: 'desktop',
        authGeneration: 2,
      })).toThrow('AUTH_PROFILE_CHANGED');
      expect(() => store.get('a')).toThrow('AUTH_PROFILE_CHANGED');
      expect(() => store.revokeFamily('family-a')).toThrow('AUTH_PROFILE_CHANGED');
      expect(db.prepare(`SELECT revoked_at FROM _auth_native_sessions
        WHERE family_id = 'family-a'`).get()).toEqual({ revoked_at: null });
    } finally {
      db.dispose();
    }
  });

  test('requires an exact, live, unrevoked refresh-family binding', () => {
    const { db, store } = setup();
    try {
      store.consumeCodeAndInsert(() => true, session('a', 'family-a', 20_000));
      store.consumeCodeAndInsert(() => true, session('b', 'family-b', 20_000));
      expect(store.isFamilyActive(claims, 10_000)).toBe(true);
      expect(store.isFamilyActive({ ...claims, familyId: 'family-b' }, 10_000)).toBe(true);
      for (const mismatch of [
        { userId: 'other' }, { clientId: 'mobile' }, { authGeneration: 3 },
      ]) expect(store.isFamilyActive({ ...claims, ...mismatch }, 10_000)).toBe(false);

      db.prepare(`UPDATE _auth_native_sessions SET revoked_at = 11_000
        WHERE family_id = 'family-a'`).run();
      expect(store.isFamilyActive(claims, 10_000)).toBe(false);
      expect(store.isFamilyActive({ ...claims, familyId: 'family-b' }, 10_000)).toBe(true);

      db.prepare("DELETE FROM _auth_native_sessions WHERE family_id = 'family-b'").run();
      expect(store.isFamilyActive({ ...claims, familyId: 'family-b' }, 10_000)).toBe(false);
    } finally {
      db.dispose();
    }
  });

  test('rejects expired, orphaned, and disabled-client sessions', () => {
    const { db, store } = setup();
    try {
      store.consumeCodeAndInsert(() => true, session('a', 'family-a', 10_000));
      store.consumeCodeAndInsert(() => true, session('b', 'family-b', 20_000));
      expect(store.isFamilyActive(claims, 10_000)).toBe(false);
      const enabled = createNativeAccessSessionValidator(config(true), store);
      expect(enabled.isActive({
        sessionId: 'family-a', userId: 'user', clientId: 'desktop', authGeneration: 2,
      })).toBe(false);
      expect(enabled.isActive({
        sessionId: 'family-b', userId: 'user', clientId: 'desktop', authGeneration: 2,
      })).toBe(true);
      const disabled = createNativeAccessSessionValidator(config(false), store);
      expect(disabled.isActive({
        sessionId: 'family-b', userId: 'user', clientId: 'desktop', authGeneration: 2,
      })).toBe(false);
      expect(enabled.isActive({
        sessionId: 'family-b', userId: 'user', clientId: 'removed', authGeneration: 2,
      })).toBe(false);
    } finally {
      db.dispose();
    }
  });

  test('requires durable MFA assurance when live policy crosses that boundary', () => {
    const { db, store } = setup();
    try {
      store.consumeCodeAndInsert(() => true, session('plain', 'family-a', 20_000));
      store.consumeCodeAndInsert(
        () => true,
        session('assured', 'family-b', 20_000, 9_000),
      );
      let required = true;
      const validator = createNativeAccessSessionValidator(
        config(true),
        store,
        undefined,
        () => required,
      );
      expect(validator.isActive({
        sessionId: 'family-a', userId: 'user', clientId: 'desktop', authGeneration: 2,
      })).toBe(false);
      expect(validator.isActive({
        sessionId: 'family-b', userId: 'user', clientId: 'desktop', authGeneration: 2,
      })).toBe(true);
      required = false;
      expect(validator.isActive({
        sessionId: 'family-a', userId: 'user', clientId: 'desktop', authGeneration: 2,
      })).toBe(true);
    } finally {
      db.dispose();
    }
  });
});

function setup() {
  const db = createReactiveDB({ mode: 'memory' });
  defineAuthTables(db);
  db.prepare(`INSERT INTO users
    (user_id, username, email, role, status, password_change_required,
     email_verification_required, mfa_required, created_at)
    VALUES ('user', 'user', 'user@example.test', 'user', 'active', 0, 0, 0, 1)`).run();
  return { db, store: new NativeSessionStore(db, { now: () => 10_000 }) };
}

function session(
  raw: string,
  familyId: string,
  expiresAt: number,
  mfaVerifiedAt: number | null = null,
): PreparedNativeSession {
  return {
    tokenId: raw, tokenHash: hashToken(raw), familyId, userId: 'user', clientId: 'desktop',
    scope: 'openid', authGeneration: 2, expiresAt, createdAt: 1, rotationCount: 0,
    mfaVerifiedAt,
    consumedAt: null, revokedAt: null, replacedBy: null,
  };
}

function config(enabled: boolean) {
  return resolveNativeAuthConfig({ enabled, clients: [{
    clientId: 'desktop', name: 'Desktop', redirectUris: ['com.example.app:/callback'],
  }] });
}

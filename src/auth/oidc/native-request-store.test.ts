import { describe, expect, test } from 'bun:test';
import { createReactiveDB } from '../../sync/reactive-db';
import { defineAuthTables } from '../auth-schema';
import type { NativeRequestStoreOptions } from './native-request-admission';
import { NativeCodeStore } from './native-code-store';
import { NativeRequestStore } from './native-request-store';
import { hashToken } from '../../tokens/token-utils';

const input = {
  clientId: 'desktop-a', redirectUri: 'com.example.app:/callback',
  scope: 'openid', state: 'state', nonce: 'nonce', codeChallenge: 'challenge',
  prompt: null, ttlMs: 120_000,
};

function setup(options: NativeRequestStoreOptions) {
  const db = createReactiveDB({ mode: 'memory' });
  defineAuthTables(db);
  return { db, store: new NativeRequestStore(db, options) };
}

describe('NativeRequestStore admission', () => {
  test('fences cached request and code stores after a profile change', () => {
    const now = Date.now();
    const { db, store } = setup({ now: () => now });
    try {
      db.prepare(`INSERT INTO users
        (user_id, username, email, role, status, password_change_required,
         email_verification_required, mfa_required, created_at)
        VALUES ('u_one', 'u_one', 'u_one@example.test', 'user', 'active', 0, 0, 0, ?)`)
        .run(now);
      const created = store.create({ ...input, prompt: null });
      expect(store.claimForUser(created.rawRequestId, 'u_one')).toBe(true);
      const codes = new NativeCodeStore(db);
      let current = true;
      const guard = () => {
        if (!current) throw new Error('AUTH_PROFILE_CHANGED');
      };
      store.setRuntimeProfileGuard(guard);
      codes.setRuntimeProfileGuard(guard);
      expect(store.get(created.rawRequestId)?.boundUserId).toBe('u_one');

      current = false;
      expect(() => store.get(created.rawRequestId)).toThrow('AUTH_PROFILE_CHANGED');
      expect(() => store.releaseForUser(created.rawRequestId, 'u_one'))
        .toThrow('AUTH_PROFILE_CHANGED');
      expect(() => codes.issue(created.rawRequestId, 'u_one', 0, 100))
        .toThrow('AUTH_PROFILE_CHANGED');
      expect(db.prepare(`SELECT consumed_at, bound_user_id
        FROM _auth_native_requests WHERE request_id = ?`).get(created.requestId))
        .toEqual({ consumed_at: null, bound_user_id: 'u_one' });
      expect(db.prepare('SELECT COUNT(*) AS count FROM _auth_native_codes').get())
        .toEqual({ count: 0 });
    } finally {
      db.dispose();
    }
  });

  test('persists per-client and global outstanding caps across store restarts', () => {
    let now = 1_000_000;
    const options: NativeRequestStoreOptions = {
      now: () => now,
      limits: {
        maxOutstandingPerClient: 2, maxOutstandingGlobal: 3,
        maxAdmissionsPerClient: 20, maxAdmissionsGlobal: 20,
      },
    };
    const { db, store } = setup(options);
    try {
      store.create(input);
      store.create(input);
      const restarted = new NativeRequestStore(db, options);
      expect(() => restarted.create(input)).toThrow('temporarily busy');
      restarted.create({ ...input, clientId: 'desktop-b' });
      expect(() => restarted.create({ ...input, clientId: 'desktop-b' }))
        .toThrow('temporarily busy');
      now += 120_001;
      expect(restarted.create(input).requestId).toBeString();
    } finally {
      db.dispose();
    }
  });

  test('rolling limits retain recently expired rows and expire with the window', () => {
    let now = 2_000_000;
    const options: NativeRequestStoreOptions = {
      now: () => now,
      limits: {
        maxOutstandingPerClient: 20, maxOutstandingGlobal: 20,
        maxAdmissionsPerClient: 2, maxAdmissionsGlobal: 3, rollingWindowMs: 1_000,
      },
    };
    const { db, store } = setup(options);
    try {
      store.create({ ...input, ttlMs: 10 });
      store.create({ ...input, ttlMs: 10 });
      now += 11;
      expect(() => new NativeRequestStore(db, options).create(input))
        .toThrow('temporarily busy');
      store.create({ ...input, clientId: 'desktop-b' });
      expect(() => store.create({ ...input, clientId: 'desktop-c' }))
        .toThrow('temporarily busy');
      now += 1_001;
      expect(store.create(input).requestId).toBeString();
    } finally {
      db.dispose();
    }
  });

  test('persists hashed deployment source keys and caps a source across clients', () => {
    const { db, store } = setup({ limits: {
      maxOutstandingGlobal: 20, maxOutstandingPerClient: 20,
      maxOutstandingPerSource: 2, maxAdmissionsGlobal: 20,
      maxAdmissionsPerClient: 20, maxAdmissionsPerSource: 2,
    } });
    try {
      store.create({ ...input, clientId: 'desktop-a', sourceKey: 'proxy:203.0.113.7' });
      store.create({ ...input, clientId: 'desktop-b', sourceKey: 'proxy:203.0.113.7' });
      expect(() => store.create({
        ...input, clientId: 'desktop-c', sourceKey: 'proxy:203.0.113.7',
      })).toThrow('temporarily busy');
      expect(store.create({
        ...input, clientId: 'desktop-c', sourceKey: 'proxy:203.0.113.8',
      }).requestId).toBeString();
      const rows = db.prepare('SELECT source_hash FROM _auth_native_requests').all() as any[];
      expect(rows.every((row) => row.source_hash !== 'proxy:203.0.113.7')).toBe(true);
      expect(rows.every((row) => row.source_hash !== hashToken('proxy:203.0.113.7')))
        .toBe(true);
    } finally {
      db.dispose();
    }
  });

  test('atomically begins a registration continuation once', () => {
    let now = 3_000_000;
    const { db, store } = setup({ now: () => now });
    try {
      const created = store.create({ ...input, prompt: 'create', ttlMs: 100 });
      expect(store.beginRegistration(created.rawRequestId)).toBe(true);
      expect(store.get(created.rawRequestId)?.prompt).toBe('create-resume');
      expect(store.beginRegistration(created.rawRequestId)).toBe(false);
      const expired = store.create({ ...input, prompt: 'create', ttlMs: 100 });
      now += 101;
      expect(store.beginRegistration(expired.rawRequestId)).toBe(false);
    } finally {
      db.dispose();
    }
  });

  test('atomically consumes a terminal request only once', () => {
    const { db, store } = setup({});
    try {
      const created = store.create({ ...input, prompt: 'none' });
      expect(store.consumeTerminal(created.rawRequestId)?.prompt).toBe('none');
      expect(store.consumeTerminal(created.rawRequestId)).toBeNull();
    } finally {
      db.dispose();
    }
  });

  test('binds an active interactive request to only one user', () => {
    let now = 4_000_000;
    const { db, store } = setup({ now: () => now });
    try {
      for (const userId of ['u_one', 'u_two']) {
        db.prepare(`INSERT INTO users
          (user_id, username, email, role, status, password_change_required,
           email_verification_required, mfa_required, created_at)
          VALUES (?, ?, ?, 'user', 'active', 0, 0, 0, ?)`)
          .run(userId, userId, `${userId}@example.test`, now);
      }
      const created = store.create({ ...input, prompt: 'create', ttlMs: 100 });
      expect(store.beginRegistration(created.rawRequestId)).toBe(true);
      expect(store.isAvailable(created.rawRequestId)).toBe(true);
      expect(store.claimForUser(created.rawRequestId, 'u_one')).toBe(true);
      expect(store.isAvailable(created.rawRequestId)).toBe(false);
      expect(store.claimForUser(created.rawRequestId, 'u_one')).toBe(true);
      expect(store.claimForUser(created.rawRequestId, 'u_two')).toBe(false);
      expect(store.matchesUser(created.rawRequestId, 'u_one')).toBe(true);
      expect(store.matchesUser(created.rawRequestId, 'u_two')).toBe(false);
      expect(store.get(created.rawRequestId)?.boundUserId).toBe('u_one');
      db.prepare('DELETE FROM users WHERE user_id = ?').run('u_one');
      expect(store.get(created.rawRequestId)).toBeNull();

      const expiring = store.create({ ...input, prompt: null, ttlMs: 100 });
      expect(store.isAvailable(expiring.rawRequestId)).toBe(true);
      expect(store.claimForUser(expiring.rawRequestId, 'u_two')).toBe(true);
      now += 101;
      expect(store.matchesUser(expiring.rawRequestId, 'u_two')).toBe(false);
      expect(store.isAvailable(expiring.rawRequestId)).toBe(false);
    } finally {
      db.dispose();
    }
  });

  test('atomically refuses code issuance for a different bound user', () => {
    const now = Date.now();
    const { db, store } = setup({ now: () => now });
    try {
      for (const userId of ['u_one', 'u_two']) {
        db.prepare(`INSERT INTO users
          (user_id, username, email, role, status, password_change_required,
           email_verification_required, mfa_required, created_at)
          VALUES (?, ?, ?, 'user', 'active', 0, 0, 0, ?)`)
          .run(userId, userId, `${userId}@example.test`, now);
      }
      const created = store.create({ ...input, prompt: null, ttlMs: 100 });
      expect(store.claimForUser(created.rawRequestId, 'u_one')).toBe(true);
      const firstProcess = new NativeCodeStore(db);
      const secondProcess = new NativeCodeStore(db);

      expect(secondProcess.issue(created.rawRequestId, 'u_two', 0, 100)).toBeNull();
      expect(firstProcess.issue(created.rawRequestId, 'u_one', 0, 100)?.rawCode).toBeString();
      expect(secondProcess.issue(created.rawRequestId, 'u_one', 0, 100)).toBeNull();
    } finally {
      db.dispose();
    }
  });
});

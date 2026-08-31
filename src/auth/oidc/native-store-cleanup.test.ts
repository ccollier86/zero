import { describe, expect, test } from 'bun:test';
import { createReactiveDB, type ReactiveDB } from '../../sync/reactive-db';
import { defineAuthTables } from '../auth-schema';
import { NativeCodeStore } from './native-code-store';
import { NativeRequestStore } from './native-request-store';
import { NativeSessionStore } from './native-session-store';

const requestInput = {
  clientId: 'desktop', redirectUri: 'com.example.app:/callback', scope: 'openid',
  state: 'state', nonce: 'nonce', codeChallenge: 'challenge', prompt: null,
};

function setup(): ReactiveDB {
  const db = createReactiveDB({ mode: 'memory' });
  defineAuthTables(db);
  db.prepare(`INSERT INTO users
    (user_id, username, email, role, status, password_change_required,
     email_verification_required, mfa_required, created_at)
    VALUES ('user', 'user', 'user@example.com', 'user', 'active', 0, 0, 0, 1)`).run();
  return db;
}

function rows(db: ReactiveDB, table: string): number {
  return Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as any).count);
}

describe('native auth bounded cleanup', () => {
  test('bounds expired request cleanup per admission operation', () => {
    let now = 1_000;
    const db = setup();
    const store = new NativeRequestStore(db, {
      now: () => now,
      limits: { cleanupBatchSize: 2, rollingWindowMs: 100 },
    });
    try {
      for (let index = 0; index < 3; index += 1) {
        store.create({ ...requestInput, clientId: `desktop-${index}`, ttlMs: 10 });
      }
      now = 1_200;
      expect(store.cleanupExpired()).toBe(2);
      expect(rows(db, '_auth_native_requests')).toBe(1);
    } finally {
      db.dispose();
    }
  });

  test('bounds expired authorization-code cleanup', () => {
    const db = setup();
    const request = new NativeRequestStore(db).create({ ...requestInput, ttlMs: 60_000 });
    const insert = db.prepare(`INSERT INTO _auth_native_codes
      (code_id, code_hash, request_id, user_id, client_id, redirect_uri, scope,
       nonce, code_challenge, auth_generation, created_at, expires_at)
      VALUES (?, ?, ?, 'user', 'desktop', 'com.example.app:/callback',
       'openid', 'nonce', 'challenge', 0, 1, 2)`);
    try {
      for (let index = 0; index < 3; index += 1) {
        insert.run(`code-${index}`, `hash-${index}`, request.requestId);
      }
      expect(new NativeCodeStore(db, 2).cleanupExpired(3)).toBe(2);
      expect(rows(db, '_auth_native_codes')).toBe(1);
    } finally {
      db.dispose();
    }
  });

  test('does not cascade-delete a live authorization code with its expired request', () => {
    let now = 1_000;
    const db = setup();
    const requests = new NativeRequestStore(db, {
      now: () => now, limits: { rollingWindowMs: 10 },
    });
    const request = requests.create({ ...requestInput, ttlMs: 5 });
    db.prepare(`INSERT INTO _auth_native_codes
      (code_id, code_hash, request_id, user_id, client_id, redirect_uri, scope,
       nonce, code_challenge, auth_generation, created_at, expires_at)
      VALUES ('live', 'live-hash', ?, 'user', 'desktop',
        'com.example.app:/callback', 'openid', 'nonce', 'challenge', 0, ?, ?)`)
      .run(request.requestId, now, now + 1_000);
    try {
      now += 20;
      expect(requests.cleanupExpired()).toBe(0);
      expect(rows(db, '_auth_native_requests')).toBe(1);
      expect(rows(db, '_auth_native_codes')).toBe(1);
      db.prepare('UPDATE _auth_native_codes SET consumed_at = ?').run(now);
      expect(requests.cleanupExpired()).toBeGreaterThan(0);
      expect(rows(db, '_auth_native_codes')).toBe(0);
    } finally {
      db.dispose();
    }
  });

  test('bounds expired native-session cleanup', () => {
    const db = setup();
    const insert = db.prepare(`INSERT INTO _auth_native_sessions
      (token_id, family_id, user_id, client_id, token_hash, scope,
       auth_generation, expires_at, created_at)
      VALUES (?, ?, 'user', 'desktop', ?, 'openid', 0, 2, 1)`);
    try {
      for (let index = 0; index < 3; index += 1) {
        insert.run(`token-${index}`, `family-${index}`, `hash-${index}`);
      }
      expect(new NativeSessionStore(db, 2).cleanupExpired(3)).toBe(2);
      expect(rows(db, '_auth_native_sessions')).toBe(1);
    } finally {
      db.dispose();
    }
  });
});

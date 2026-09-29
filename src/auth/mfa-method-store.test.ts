/**
 * mfa-method-store.test.ts
 *
 * Verifies MFA method persistence independently from HTTP routes. These tests
 * keep enrollment state behavior covered without starting the auth plugin.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { MfaMethodStore } from './mfa-method-store';

let db: ReactiveDB;
let store: MfaMethodStore;

beforeEach(() => {
  db = createReactiveDB({ mode: 'memory' });
  setupTables(db);
  store = new MfaMethodStore(db);
});

afterEach(() => {
  db.dispose();
});

describe('MfaMethodStore', () => {
  test('creates pending methods and returns public method metadata', () => {
    const method = store.createMethod({
      userId: 'u_test',
      type: 'totp',
      label: 'Authenticator',
      secretCiphertext: 'encrypted-secret',
      metadata: { source: 'setup' },
    });

    expect(method.methodId).toStartWith('mfa_');
    expect(method.userId).toBe('u_test');
    expect(method.type).toBe('totp');
    expect(method.status).toBe('pending');
    expect(method.isPrimary).toBe(false);
    expect(method.secretCiphertext).toBe('encrypted-secret');
    expect(method.metadata.source).toBe('setup');

    expect(store.listPublicMethods('u_test')).toHaveLength(1);
  });

  test('activates one preferred method and disables other active methods in single-active mode', () => {
    const email = store.createMethod({
      userId: 'u_test',
      type: 'email',
      status: 'active',
      isPrimary: true,
      verifiedAt: 1000,
    });
    const totp = store.createMethod({
      userId: 'u_test',
      type: 'totp',
      secretCiphertext: 'encrypted-secret',
    });

    const activated = store.activateMethod(totp.methodId, {
      verifiedAt: 2000,
      singleActive: true,
    });

    expect(activated?.status).toBe('active');
    expect(activated?.verifiedAt).toBe(2000);
    expect(activated?.isPrimary).toBe(true);
    expect(store.getMethod(email.methodId)?.status).toBe('disabled');
    expect(store.getActivePreferredMethod('u_test')?.methodId).toBe(totp.methodId);
  });

  test('does not reactivate a disabled method or disturb the current primary method', () => {
    const primary = store.createMethod({
      userId: 'u_test',
      type: 'email',
      status: 'active',
      isPrimary: true,
      verifiedAt: 1000,
    });
    const disabled = store.createMethod({
      userId: 'u_test',
      type: 'totp',
      status: 'disabled',
      secretCiphertext: 'encrypted-secret',
    });

    expect(store.activateMethod(disabled.methodId, {
      verifiedAt: 2000,
      singleActive: true,
    })).toBeNull();
    expect(store.getMethod(disabled.methodId)?.status).toBe('disabled');
    expect(store.getMethod(primary.methodId)).toMatchObject({
      status: 'active',
      isPrimary: true,
    });
  });

  test('can switch preference between active methods when multiple are retained', () => {
    const email = store.createMethod({
      userId: 'u_test',
      type: 'email',
      status: 'active',
      isPrimary: true,
      verifiedAt: 1000,
    });
    const totp = store.createMethod({
      userId: 'u_test',
      type: 'totp',
      status: 'active',
      verifiedAt: 1000,
    });

    const preferred = store.preferMethod('u_test', totp.methodId);

    expect(preferred?.isPrimary).toBe(true);
    expect(store.getMethod(email.methodId)?.isPrimary).toBe(false);
    expect(store.getActivePreferredMethod('u_test')?.methodId).toBe(totp.methodId);
  });

  test('disables methods and removes them from public method listings', () => {
    const method = store.createMethod({
      userId: 'u_test',
      type: 'email',
      status: 'active',
      isPrimary: true,
      verifiedAt: 1000,
    });

    expect(store.disableMethod(method.methodId, 3000)).toBe(true);
    expect(store.getMethod(method.methodId)?.disabledAt).toBe(3000);
    expect(store.listPublicMethods('u_test')).toEqual([]);
  });
});

function setupTables(db: ReactiveDB): void {
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`
    CREATE TABLE users (
      user_id TEXT PRIMARY KEY
    )
  `);
  db.exec("INSERT INTO users (user_id) VALUES ('u_test')");
  db.exec(`
    CREATE TABLE _auth_mfa_methods (
      method_id         TEXT PRIMARY KEY,
      user_id           TEXT NOT NULL,
      type              TEXT NOT NULL,
      label             TEXT,
      status            TEXT NOT NULL,
      is_primary        INTEGER NOT NULL DEFAULT 0,
      secret_ciphertext TEXT,
      created_at        INTEGER NOT NULL,
      verified_at       INTEGER,
      disabled_at       INTEGER,
      last_used_at      INTEGER,
      metadata          TEXT,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
  `);
}

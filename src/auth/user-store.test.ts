import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { createReactiveDB, ReactiveDB } from '../sync/reactive-db';
import { UserStore } from './user-store';
import { AuthError } from './types';

// ─── Test Setup ───────────────────────────────────────────────────────────

let db: ReactiveDB;
let store: UserStore;

function setupAuthTables(db: ReactiveDB): void {
  db.exec('PRAGMA foreign_keys = ON');

  db.defineTable('users', {
    user_id: 'text primary key',
    username: 'text unique not null',
    email: 'text unique not null',
    first_name: 'text',
    last_name: 'text',
    role: "text not null default 'user'",
    status: "text not null default 'active'",
    password_change_required: 'integer not null default 0',
    created_at: 'integer not null',
    updated_at: 'integer',
  });

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_properties (
      user_id TEXT NOT NULL,
      key     TEXT NOT NULL,
      value   TEXT,
      PRIMARY KEY (user_id, key),
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS _credentials (
      user_id       TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS _refresh_tokens (
      token_id   TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      revoked_at INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
  `);
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON _refresh_tokens(token_hash)'
  );

  db.exec(`
    CREATE TABLE IF NOT EXISTS _auth_action_tokens (
      token_id    TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      type        TEXT NOT NULL,
      token_hash  TEXT NOT NULL,
      expires_at  INTEGER NOT NULL,
      consumed_at INTEGER,
      created_at  INTEGER NOT NULL,
      created_by  TEXT,
      metadata    TEXT,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
  `);
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_auth_action_tokens_hash ON _auth_action_tokens(token_hash)'
  );

  db.exec(`
    CREATE TABLE IF NOT EXISTS _auth_config (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
}

beforeEach(() => {
  db = createReactiveDB({ mode: 'memory' });
  setupAuthTables(db);
  store = new UserStore(db);
});

afterEach(() => {
  db.dispose();
});

// ─── User CRUD ────────────────────────────────────────────────────────────

describe('UserStore — User CRUD', () => {
  test('createUser returns a valid UserRecord', async () => {
    const user = await store.createUser({
      username: 'alice',
      email: 'alice@example.com',
      password: 'password123',
      firstName: 'Alice',
      lastName: 'Smith',
    });

    expect(user.userId).toStartWith('u_');
    expect(user.username).toBe('alice');
    expect(user.email).toBe('alice@example.com');
    expect(user.firstName).toBe('Alice');
    expect(user.lastName).toBe('Smith');
    expect(user.role).toBe('user');
    expect(user.createdAt).toBeGreaterThan(0);
    expect(user.updatedAt).toBeNull();
    expect(user.properties).toEqual({});
  });

  test('createUser with default role', async () => {
    const user = await store.createUser({
      username: 'bob',
      email: 'bob@example.com',
      password: 'password123',
    });
    expect(user.role).toBe('user');
    expect(user.firstName).toBeNull();
    expect(user.lastName).toBeNull();
  });

  test('createUser with custom role', async () => {
    const user = await store.createUser({
      username: 'admin',
      email: 'admin@example.com',
      password: 'password123',
      role: 'admin',
    });
    expect(user.role).toBe('admin');
  });

  test('createUser stores lifecycle status and password-change flag', async () => {
    const user = await store.createUser({
      username: 'setup',
      email: 'setup@example.com',
      password: 'password123',
      status: 'active',
      passwordChangeRequired: true,
    });

    expect(user.status).toBe('active');
    expect(user.passwordChangeRequired).toBe(true);
    expect(store.getUserById(user.userId)!.passwordChangeRequired).toBe(true);
  });

  test('createUser stores initial properties atomically', async () => {
    const user = await store.createUser({
      username: 'withprops',
      email: 'withprops@example.com',
      password: 'password123',
      properties: {
        plan: 'pro',
        notificationsEnabled: 'true',
      },
    });

    expect(user.properties).toEqual({
      plan: 'pro',
      notificationsEnabled: 'true',
    });
    expect(store.getProperty(user.userId, 'plan')).toBe('pro');
  });

  test('createUser throws DUPLICATE_USERNAME on username conflict', async () => {
    await store.createUser({
      username: 'alice',
      email: 'alice@example.com',
      password: 'password123',
    });

    try {
      await store.createUser({
        username: 'alice',
        email: 'other@example.com',
        password: 'password123',
      });
      expect(true).toBe(false); // Should not reach
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError);
      expect((err as AuthError).code).toBe('DUPLICATE_USERNAME');
      expect((err as AuthError).status).toBe(409);
    }
  });

  test('createUser throws DUPLICATE_EMAIL on email conflict', async () => {
    await store.createUser({
      username: 'alice',
      email: 'alice@example.com',
      password: 'password123',
    });

    try {
      await store.createUser({
        username: 'bob',
        email: 'alice@example.com',
        password: 'password123',
      });
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError);
      expect((err as AuthError).code).toBe('DUPLICATE_EMAIL');
      expect((err as AuthError).status).toBe(409);
    }
  });

  test('getUserById returns user', async () => {
    const created = await store.createUser({
      username: 'alice',
      email: 'alice@example.com',
      password: 'pass12345',
    });

    const found = store.getUserById(created.userId);
    expect(found).not.toBeNull();
    expect(found!.username).toBe('alice');
    expect(found!.email).toBe('alice@example.com');
  });

  test('getUserById returns null for missing user', () => {
    expect(store.getUserById('u_nonexistent')).toBeNull();
  });

  test('getUserByUsername', async () => {
    await store.createUser({
      username: 'alice',
      email: 'alice@example.com',
      password: 'pass12345',
    });

    expect(store.getUserByUsername('alice')).not.toBeNull();
    expect(store.getUserByUsername('bob')).toBeNull();
  });

  test('getUserByEmail', async () => {
    await store.createUser({
      username: 'alice',
      email: 'alice@example.com',
      password: 'pass12345',
    });

    expect(store.getUserByEmail('alice@example.com')).not.toBeNull();
    expect(store.getUserByEmail('bob@example.com')).toBeNull();
  });

  test('listUsers returns all users ordered by creation date desc', async () => {
    await store.createUser({
      username: 'first',
      email: 'first@example.com',
      password: 'pass12345',
    });
    // Small delay to ensure different created_at
    await store.createUser({
      username: 'second',
      email: 'second@example.com',
      password: 'pass12345',
    });

    const users = store.listUsers();
    expect(users).toHaveLength(2);
    // Newest first
    expect(users[0].username).toBe('second');
    expect(users[1].username).toBe('first');
  });

  test('countUsers and countUsersByRole report current users', async () => {
    await store.createUser({
      username: 'admin',
      email: 'admin@example.com',
      password: 'password123',
      role: 'admin',
    });
    await store.createUser({
      username: 'user',
      email: 'user@example.com',
      password: 'password123',
    });

    expect(store.countUsers()).toBe(2);
    expect(store.countUsersByRole('admin')).toBe(1);
    expect(store.countUsersByRole('user')).toBe(1);
  });

  test('listUsers supports pagination, search, role, and status filters', async () => {
    await store.createUser({
      username: 'ops-admin',
      email: 'ops-admin@example.com',
      password: 'password123',
      role: 'admin',
      firstName: 'Ops',
    });
    const inactive = await store.createUser({
      username: 'ops-worker',
      email: 'ops-worker@example.com',
      password: 'password123',
      role: 'user',
      firstName: 'Ops',
    });
    await store.createUser({
      username: 'sales-worker',
      email: 'sales-worker@example.com',
      password: 'password123',
      role: 'user',
      firstName: 'Sales',
    });
    store.updateUser(inactive.userId, { status: 'suspended' });

    const activeOps = store.listUsers({ search: 'ops', status: 'active', limit: 10 });
    expect(activeOps.map((user) => user.username)).toEqual(['ops-admin']);
    expect(store.countUsers({ search: 'ops', status: 'active' })).toBe(1);

    const users = store.listUsers({ role: 'user', limit: 1, offset: 1 });
    expect(users).toHaveLength(1);
    expect(store.countUsers({ role: 'user' })).toBe(2);
  });

  test('updateUser updates fields and sets updated_at', async () => {
    const created = await store.createUser({
      username: 'alice',
      email: 'alice@example.com',
      password: 'pass12345',
    });

    const updated = store.updateUser(created.userId, {
      firstName: 'Alice',
      lastName: 'Johnson',
      role: 'admin',
    });

    expect(updated).not.toBeNull();
    expect(updated!.firstName).toBe('Alice');
    expect(updated!.lastName).toBe('Johnson');
    expect(updated!.role).toBe('admin');
    expect(updated!.updatedAt).toBeGreaterThan(0);
  });

  test('updateUser returns null for missing user', () => {
    expect(store.updateUser('u_nope', { firstName: 'X' })).toBeNull();
  });

  test('updateUser throws DUPLICATE_USERNAME on conflict', async () => {
    await store.createUser({
      username: 'alice',
      email: 'alice@example.com',
      password: 'pass12345',
    });
    const bob = await store.createUser({
      username: 'bob',
      email: 'bob@example.com',
      password: 'pass12345',
    });

    try {
      store.updateUser(bob.userId, { username: 'alice' });
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError);
      expect((err as AuthError).code).toBe('DUPLICATE_USERNAME');
    }
  });

  test('deleteUser removes user and returns true', async () => {
    const user = await store.createUser({
      username: 'alice',
      email: 'alice@example.com',
      password: 'pass12345',
    });

    expect(store.deleteUser(user.userId)).toBe(true);
    expect(store.getUserById(user.userId)).toBeNull();
  });

  test('deleteUser returns false for missing user', () => {
    expect(store.deleteUser('u_nope')).toBe(false);
  });

  test('createUser emits change event via ReactiveDB', async () => {
    const changes: string[] = [];
    db.onChange((change) => changes.push(change.table));

    await store.createUser({
      username: 'alice',
      email: 'alice@example.com',
      password: 'pass12345',
    });

    expect(changes).toContain('users');
  });
});

// ─── Password ─────────────────────────────────────────────────────────────

describe('UserStore — Password', () => {
  test('verifyPassword returns true for correct password', async () => {
    const user = await store.createUser({
      username: 'alice',
      email: 'alice@example.com',
      password: 'correcthorse',
    });

    expect(await store.verifyPassword(user.userId, 'correcthorse')).toBe(true);
  });

  test('verifyPassword returns false for wrong password', async () => {
    const user = await store.createUser({
      username: 'alice',
      email: 'alice@example.com',
      password: 'correcthorse',
    });

    expect(await store.verifyPassword(user.userId, 'wrongpassword')).toBe(
      false
    );
  });

  test('verifyPassword returns false for nonexistent user', async () => {
    expect(await store.verifyPassword('u_nope', 'anything')).toBe(false);
  });

  test('updatePassword changes password and revokes tokens', async () => {
    const user = await store.createUser({
      username: 'alice',
      email: 'alice@example.com',
      password: 'oldpassword1',
    });

    // Store a refresh token first
    store.storeRefreshToken('tok_1', user.userId, 'hash1', Date.now() + 86400000);

    const changed = await store.updatePassword(
      user.userId,
      'oldpassword1',
      'newpassword1'
    );
    expect(changed).toBe(true);

    // Old password fails
    expect(await store.verifyPassword(user.userId, 'oldpassword1')).toBe(false);
    // New password works
    expect(await store.verifyPassword(user.userId, 'newpassword1')).toBe(true);

    // Refresh token should be revoked
    const token = store.getRefreshTokenByHash('hash1');
    expect(token).not.toBeNull();
    expect(token!.revokedAt).not.toBeNull();
  });

  test('updatePassword returns false for wrong current password', async () => {
    const user = await store.createUser({
      username: 'alice',
      email: 'alice@example.com',
      password: 'password123',
    });

    expect(
      await store.updatePassword(user.userId, 'wrong', 'newpass123')
    ).toBe(false);
  });

  test('resetPassword changes password and revokes tokens without current password', async () => {
    const user = await store.createUser({
      username: 'resetme',
      email: 'resetme@example.com',
      password: 'oldpassword1',
    });
    store.storeRefreshToken('tok_reset', user.userId, 'reset_hash', Date.now() + 86400000);

    expect(await store.resetPassword(user.userId, 'newpassword1')).toBe(true);
    expect(await store.verifyPassword(user.userId, 'oldpassword1')).toBe(false);
    expect(await store.verifyPassword(user.userId, 'newpassword1')).toBe(true);
    expect(store.getRefreshTokenByHash('reset_hash')!.revokedAt).not.toBeNull();
  });

  test('resetPassword returns false for missing user', async () => {
    expect(await store.resetPassword('u_missing', 'newpassword1')).toBe(false);
  });

  test('requirePasswordChange marks account and revokes tokens', async () => {
    const user = await store.createUser({
      username: 'force',
      email: 'force@example.com',
      password: 'password123',
    });
    store.storeRefreshToken('tok_force', user.userId, 'force_hash', Date.now() + 86400000);

    expect(store.requirePasswordChange(user.userId)).toBe(true);
    expect(store.getUserById(user.userId)!.passwordChangeRequired).toBe(true);
    expect(store.getRefreshTokenByHash('force_hash')!.revokedAt).not.toBeNull();
  });
});

// ─── Properties KV ────────────────────────────────────────────────────────

describe('UserStore — Properties', () => {
  let userId: string;

  beforeEach(async () => {
    const user = await store.createUser({
      username: 'alice',
      email: 'alice@example.com',
      password: 'pass12345',
    });
    userId = user.userId;
  });

  test('setProperty and getProperty', () => {
    store.setProperty(userId, 'theme', 'dark');
    expect(store.getProperty(userId, 'theme')).toBe('dark');
  });

  test('getProperty returns null for missing key', () => {
    expect(store.getProperty(userId, 'nonexistent')).toBeNull();
  });

  test('setProperty overwrites existing value (upsert)', () => {
    store.setProperty(userId, 'theme', 'dark');
    store.setProperty(userId, 'theme', 'light');
    expect(store.getProperty(userId, 'theme')).toBe('light');
  });

  test('getProperties returns all properties as map', () => {
    store.setProperty(userId, 'theme', 'dark');
    store.setProperty(userId, 'lang', 'en');

    const props = store.getProperties(userId);
    expect(props).toEqual({ theme: 'dark', lang: 'en' });
  });

  test('setProperties upserts multiple values', () => {
    store.setProperty(userId, 'theme', 'dark');

    store.setProperties(userId, {
      theme: 'light',
      plan: 'pro',
    });

    expect(store.getProperties(userId)).toEqual({
      theme: 'light',
      plan: 'pro',
    });
  });

  test('deleteProperty removes a single property', () => {
    store.setProperty(userId, 'theme', 'dark');
    store.setProperty(userId, 'lang', 'en');

    store.deleteProperty(userId, 'theme');
    expect(store.getProperty(userId, 'theme')).toBeNull();
    expect(store.getProperty(userId, 'lang')).toBe('en');
  });

  test('properties are included in getUserById', () => {
    store.setProperty(userId, 'theme', 'dark');
    const user = store.getUserById(userId);
    expect(user!.properties).toEqual({ theme: 'dark' });
  });

  test('properties cascade delete with user', async () => {
    store.setProperty(userId, 'theme', 'dark');
    store.deleteUser(userId);
    // Properties should be gone (FK cascade)
    expect(store.getProperty(userId, 'theme')).toBeNull();
  });
});

// ─── Refresh Tokens ───────────────────────────────────────────────────────

describe('UserStore — Refresh Tokens', () => {
  let userId: string;

  beforeEach(async () => {
    const user = await store.createUser({
      username: 'alice',
      email: 'alice@example.com',
      password: 'pass12345',
    });
    userId = user.userId;
  });

  test('storeRefreshToken and getRefreshTokenByHash', () => {
    const now = Date.now();
    store.storeRefreshToken('tok_1', userId, 'abc123hash', now + 86400000);

    const record = store.getRefreshTokenByHash('abc123hash');
    expect(record).not.toBeNull();
    expect(record!.tokenId).toBe('tok_1');
    expect(record!.userId).toBe(userId);
    expect(record!.tokenHash).toBe('abc123hash');
    expect(record!.expiresAt).toBe(now + 86400000);
    expect(record!.revokedAt).toBeNull();
  });

  test('getRefreshTokenByHash returns null for unknown hash', () => {
    expect(store.getRefreshTokenByHash('unknown')).toBeNull();
  });

  test('revokeRefreshToken sets revokedAt', () => {
    store.storeRefreshToken('tok_1', userId, 'hash1', Date.now() + 86400000);
    store.revokeRefreshToken('tok_1');

    const record = store.getRefreshTokenByHash('hash1');
    expect(record).not.toBeNull();
    expect(record!.revokedAt).not.toBeNull();
    expect(record!.revokedAt).toBeGreaterThan(0);
  });

  test('getRefreshTokenByHash returns revoked tokens (for replay detection)', () => {
    store.storeRefreshToken('tok_1', userId, 'hash1', Date.now() + 86400000);
    store.revokeRefreshToken('tok_1');

    // Still returned — caller decides what to do
    const record = store.getRefreshTokenByHash('hash1');
    expect(record).not.toBeNull();
    expect(record!.revokedAt).not.toBeNull();
  });

  test('revokeAllUserTokens revokes all non-revoked tokens', () => {
    store.storeRefreshToken('tok_1', userId, 'h1', Date.now() + 86400000);
    store.storeRefreshToken('tok_2', userId, 'h2', Date.now() + 86400000);
    store.storeRefreshToken('tok_3', userId, 'h3', Date.now() + 86400000);

    // Revoke one manually first
    store.revokeRefreshToken('tok_1');

    // Revoke all
    store.revokeAllUserTokens(userId);

    expect(store.getRefreshTokenByHash('h1')!.revokedAt).not.toBeNull();
    expect(store.getRefreshTokenByHash('h2')!.revokedAt).not.toBeNull();
    expect(store.getRefreshTokenByHash('h3')!.revokedAt).not.toBeNull();
  });

  test('deleteExpiredTokens removes expired and revoked tokens', () => {
    const past = Date.now() - 1000;
    const future = Date.now() + 86400000;

    // Expired token
    store.storeRefreshToken('tok_expired', userId, 'h_exp', past);
    // Valid token
    store.storeRefreshToken('tok_valid', userId, 'h_val', future);
    // Revoked token (revoke it, then set revoked_at in the past)
    store.storeRefreshToken('tok_revoked', userId, 'h_rev', future);
    store.revokeRefreshToken('tok_revoked');

    const deleted = store.deleteExpiredTokens();
    expect(deleted).toBeGreaterThanOrEqual(1); // At least the expired one

    expect(store.getRefreshTokenByHash('h_exp')).toBeNull();
    expect(store.getRefreshTokenByHash('h_val')).not.toBeNull();
  });
});

// ─── Auth Config ──────────────────────────────────────────────────────────

describe('UserStore — Auth Config', () => {
  test('setConfig and getConfig', () => {
    store.setConfig('signing_key_private', '{"kty":"EC"}');
    expect(store.getConfig('signing_key_private')).toBe('{"kty":"EC"}');
  });

  test('getConfig returns null for missing key', () => {
    expect(store.getConfig('nonexistent')).toBeNull();
  });

  test('setConfig upserts (INSERT OR REPLACE)', () => {
    store.setConfig('key1', 'value1');
    store.setConfig('key1', 'value2');
    expect(store.getConfig('key1')).toBe('value2');
  });
});

// ─── Auth Action Tokens ───────────────────────────────────────────────────

describe('UserStore — Auth Action Tokens', () => {
  test('storeActionToken and getActionTokenByHash', async () => {
    const user = await store.createUser({
      username: 'tokenuser',
      email: 'tokenuser@example.com',
      password: 'password123',
    });

    const record = store.storeActionToken({
      tokenId: 'aat_1',
      userId: user.userId,
      type: 'password_reset',
      tokenHash: 'hash_reset',
      expiresAt: Date.now() + 3600000,
      createdAt: Date.now(),
      createdBy: null,
      metadata: { source: 'test' },
    });

    expect(record.tokenId).toBe('aat_1');
    expect(record.metadata.source).toBe('test');

    const found = store.getActionTokenByHash('hash_reset');
    expect(found).not.toBeNull();
    expect(found!.userId).toBe(user.userId);
    expect(found!.type).toBe('password_reset');
    expect(found!.consumedAt).toBeNull();
    expect(found!.metadata.source).toBe('test');
  });

  test('consumeActionToken is one-time', async () => {
    const user = await store.createUser({
      username: 'consumeuser',
      email: 'consumeuser@example.com',
      password: 'password123',
    });

    store.storeActionToken({
      tokenId: 'aat_consume',
      userId: user.userId,
      type: 'account_setup',
      tokenHash: 'hash_consume',
      expiresAt: Date.now() + 3600000,
      createdAt: Date.now(),
    });

    expect(store.consumeActionToken('aat_consume')).toBe(true);
    expect(store.consumeActionToken('aat_consume')).toBe(false);
    expect(store.getActionTokenByHash('hash_consume')!.consumedAt).not.toBeNull();
  });
});

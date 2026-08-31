/**
 * action-token-service.test.ts
 *
 * Verifies one-time auth action token generation and consume policy without
 * starting Elysia.
 */

import { beforeEach, afterEach, describe, expect, test } from 'bun:test';
import { configureObservability } from '../observability';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { configurePlatformTokens, resetPlatformTokens, type PlatformTokenService } from '../tokens';
import { UserStore } from './user-store';
import { AuthActionTokenService } from './action-token-service';
import { discardUndeliveredActionToken } from './auth-action-token-delivery';
import { AuthError } from './types';

let db: ReactiveDB;
let store: UserStore;
let service: AuthActionTokenService;
let platformTokens: PlatformTokenService;

beforeEach(() => {
  configureObservability({ console: false });
  db = createReactiveDB({ mode: 'memory' });
  setupAuthTables(db);
  platformTokens = configurePlatformTokens({ db });
  store = new UserStore(db);
  service = new AuthActionTokenService(store, '1h', '5m', platformTokens);
});

afterEach(() => {
  resetPlatformTokens();
  db.dispose();
});

describe('AuthActionTokenService', () => {
  test('creates a raw token while storing only the hash', async () => {
    const user = await store.createUser({
      username: 'alice',
      email: 'alice@example.com',
      password: 'password123',
    });

    const created = service.create({
      userId: user.userId,
      type: 'password_reset',
      metadata: { source: 'test' },
    });

    expect(created.rawToken).toBeString();
    expect(created.record.tokenHash).not.toBe(created.rawToken);
    const row = db.prepare('SELECT token_hash FROM _zero_action_tokens WHERE token_id = ?')
      .get(created.record.tokenId) as { token_hash: string };
    expect(row.token_hash).toBe(created.record.tokenHash);
  });

  test('inspect validates and consume marks the token used once', async () => {
    const user = await store.createUser({
      username: 'bob',
      email: 'bob@example.com',
      password: 'password123',
    });
    const created = service.create({ userId: user.userId, type: 'account_setup' });

    const inspected = service.inspect(created.rawToken, ['account_setup']);
    expect(inspected.user.userId).toBe(user.userId);

    const consumed = service.consume(created.rawToken, ['account_setup']);
    expect(consumed.record.tokenId).toBe(created.record.tokenId);
    expect(() => service.consume(created.rawToken, ['account_setup'])).toThrow(AuthError);
  });

  test('email identity change invalidates platform and legacy action tokens', async () => {
    const user = await store.createUser({
      username: 'identity',
      email: 'identity@example.com',
      password: 'password123',
    });
    const platform = service.create({ userId: user.userId, type: 'email_verification' });
    const legacyService = new AuthActionTokenService(store, '1h', '5m', null);
    const legacy = legacyService.create({ userId: user.userId, type: 'account_setup' });

    store.updateUser(user.userId, { email: 'changed@example.com' });

    for (const inspect of [
      () => service.inspect(platform.rawToken),
      () => legacyService.inspect(legacy.rawToken),
    ]) {
      try {
        inspect();
        throw new Error('Expected stale token rejection');
      } catch (error) {
        expect(error).toBeInstanceOf(AuthError);
        expect((error as AuthError).code).toBe('ACTION_TOKEN_INVALID');
      }
    }
  });

  test('admin transition links require the exact generation and never resurrect after clear', async () => {
    const user = await store.createUser({
      username: 'generation-link',
      email: 'generation-link@example.com',
      password: 'password123',
    });
    const tokenA = service.create({
      userId: user.userId,
      type: 'account_setup',
      afterSecurityTransition: true,
      skipCooldown: true,
    });

    expect(() => service.inspect(tokenA.rawToken)).toThrow(AuthError);
    expect(store.requirePasswordChange(user.userId)).toBe(true);
    expect(service.inspect(tokenA.rawToken).user.userId).toBe(user.userId);

    const generationBeforeClear = store.getAuthGeneration(user.userId);
    expect(store.clearPasswordChangeRequired(user.userId)).toBe(true);
    expect(store.getAuthGeneration(user.userId)).toBe(generationBeforeClear + 1);
    expect(() => service.inspect(tokenA.rawToken)).toThrow(AuthError);

    const tokenB = service.create({
      userId: user.userId,
      type: 'admin_password_reset',
      afterSecurityTransition: true,
      skipCooldown: true,
    });
    expect(() => service.inspect(tokenB.rawToken)).toThrow(AuthError);
    expect(store.requirePasswordChange(user.userId)).toBe(true);
    expect(service.inspect(tokenB.rawToken).user.userId).toBe(user.userId);
    expect(() => service.inspect(tokenA.rawToken)).toThrow(AuthError);
  });

  test('only the latest successfully activated admin password link remains valid', async () => {
    const user = await store.createUser({
      username: 'latest-link',
      email: 'latest-link@example.com',
      password: 'password123',
    });
    const tokenA = service.create({
      userId: user.userId,
      type: 'account_setup',
      afterSecurityTransition: true,
      skipCooldown: true,
    });
    expect(store.requirePasswordChange(user.userId)).toBe(true);
    expect(service.inspect(tokenA.rawToken).record.tokenId).toBe(tokenA.record.tokenId);

    const rejectedToken = service.create({
      userId: user.userId,
      type: 'admin_password_reset',
      afterSecurityTransition: true,
      skipCooldown: true,
    });
    expect(service.revokeUndelivered(rejectedToken.rawToken)).toBe(true);
    expect(service.inspect(tokenA.rawToken).record.tokenId).toBe(tokenA.record.tokenId);

    const tokenB = service.create({
      userId: user.userId,
      type: 'admin_password_reset',
      afterSecurityTransition: true,
      skipCooldown: true,
    });
    expect(store.requirePasswordChange(user.userId)).toBe(true);
    expect(service.inspect(tokenB.rawToken).record.tokenId).toBe(tokenB.record.tokenId);
    expect(() => service.inspect(tokenA.rawToken)).toThrow(AuthError);
    expect(() => service.inspect(rejectedToken.rawToken)).toThrow(AuthError);
  });

  test('rejects pre-upgrade action tokens without an email identity binding', async () => {
    const user = await store.createUser({
      username: 'unbound',
      email: 'unbound@example.com',
      password: 'password123',
    });
    const created = service.create({ userId: user.userId, type: 'email_verification' });
    db.prepare('UPDATE _zero_action_tokens SET metadata = ? WHERE token_id = ?')
      .run('{}', created.record.tokenId);

    try {
      service.inspect(created.rawToken);
      throw new Error('Expected unbound token rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(AuthError);
      expect((error as AuthError).code).toBe('ACTION_TOKEN_INVALID');
    }
  });

  test('rejects expired tokens', async () => {
    const expiredService = new AuthActionTokenService(store, '1s');
    const user = await store.createUser({
      username: 'expired',
      email: 'expired@example.com',
      password: 'password123',
    });
    const created = expiredService.create({ userId: user.userId, type: 'password_reset' });
    db.prepare('UPDATE _zero_action_tokens SET expires_at = ? WHERE token_id = ?')
      .run(Date.now() - 1, created.record.tokenId);

    expect(() => expiredService.inspect(created.rawToken)).toThrow('Action token has expired');
  });

  test('enforces cooldown for active tokens of the same user and type', async () => {
    const user = await store.createUser({
      username: 'cooldown',
      email: 'cooldown@example.com',
      password: 'password123',
    });

    const first = service.create({ userId: user.userId, type: 'password_reset' });
    expect(() => service.create({ userId: user.userId, type: 'password_reset' }))
      .toThrow(AuthError);

    service.consume(first.rawToken, ['password_reset']);
    const second = service.create({ userId: user.userId, type: 'password_reset' });
    expect(second.record.tokenId).not.toBe(first.record.tokenId);
  });

  test('discarding undelivered platform and legacy tokens makes both inactive', async () => {
    const user = await store.createUser({
      username: 'undelivered',
      email: 'undelivered@example.com',
      password: 'password123',
    });
    const legacyService = new AuthActionTokenService(store, '1h', '5m', null);
    const platform = service.create({ userId: user.userId, type: 'password_reset' });
    const legacy = legacyService.create({ userId: user.userId, type: 'password_reset' });

    expect(discardUndeliveredActionToken(service, platform.rawToken)).toBe(true);
    expect(discardUndeliveredActionToken(legacyService, legacy.rawToken)).toBe(true);
    expect(() => service.inspect(platform.rawToken)).toThrow(AuthError);
    expect(() => legacyService.inspect(legacy.rawToken)).toThrow(AuthError);

    expect(() => service.create({ userId: user.userId, type: 'password_reset' }))
      .not.toThrow();
    expect(() => legacyService.create({ userId: user.userId, type: 'password_reset' }))
      .not.toThrow();
    expect(discardUndeliveredActionToken(service, 'missing-token')).toBe(false);
  });

  test('cleanupExpired deletes stale action tokens', async () => {
    const user = await store.createUser({
      username: 'cleanup',
      email: 'cleanup@example.com',
      password: 'password123',
    });
    const created = service.create({ userId: user.userId, type: 'password_reset' });
    db.prepare('UPDATE _zero_action_tokens SET expires_at = ? WHERE token_id = ?')
      .run(Date.now() - 1, created.record.tokenId);

    expect(service.cleanupExpired()).toBe(1);
    expect(() => service.inspect(created.rawToken)).toThrow(AuthError);
  });
});

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
    email_verified_at: 'integer',
    email_verification_required: 'integer not null default 0',
    mfa_required: 'integer not null default 0',
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
  db.exec('CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON _refresh_tokens(token_hash)');

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
  db.exec('CREATE INDEX IF NOT EXISTS idx_auth_action_tokens_hash ON _auth_action_tokens(token_hash)');

  db.exec(`
    CREATE TABLE IF NOT EXISTS _auth_config (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
}

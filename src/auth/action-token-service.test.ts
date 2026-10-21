/**
 * action-token-service.test.ts
 *
 * Verifies one-time auth action token generation and consume policy without
 * starting Elysia.
 */

import { beforeEach, afterEach, describe, expect, spyOn, test } from 'bun:test';
import {
  configureObservability,
  emitPlatformCode,
  MemoryEventStore,
  OBS_CODES,
} from '../observability';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import {
  configurePlatformTokens,
  PlatformTokenService,
  PlatformTokenStore,
  resetPlatformTokens,
} from '../tokens';
import { UserStore } from './user-store';
import { AuthActionTokenService } from './action-token-service';
import { discardUndeliveredActionToken } from './auth-action-token-delivery';
import { AuthError } from './types';

let db: ReactiveDB;
let store: UserStore;
let service: AuthActionTokenService;
let platformTokens: PlatformTokenService;
let events: MemoryEventStore;

beforeEach(() => {
  events = new MemoryEventStore();
  configureObservability({ console: false, store: events });
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
  test('enforces 48-hour setup and 1-hour reset expirations in both storage paths', async () => {
    const user = await store.createUser({
      username: 'split-expiry', email: 'split-expiry@example.test', password: 'password123',
    });
    const now = Date.now();
    const clock = spyOn(Date, 'now').mockReturnValue(now);
    try {
      for (const tokens of [platformTokens, null]) {
        clock.mockReturnValue(now);
        const action = new AuthActionTokenService(store, {
          actionTokenTTL: '2h', accountSetupTokenTTL: '48h', passwordResetTokenTTL: '1h',
        }, '5m', tokens);
        const setup = action.create({ userId: user.userId, type: 'account_setup', skipCooldown: true });
        const reset = action.create({ userId: user.userId, type: 'password_reset', skipCooldown: true });
        const adminReset = action.create({ userId: user.userId, type: 'admin_password_reset', skipCooldown: true });
        const verify = action.create({ userId: user.userId, type: 'email_verification', skipCooldown: true });
        const contact = action.create({ userId: user.userId, type: 'profile_contact_verification', skipCooldown: true });
        expect(setup.record.expiresAt).toBe(now + 48 * 3_600_000);
        expect(reset.record.expiresAt).toBe(now + 3_600_000);
        expect(adminReset.record.expiresAt).toBe(now + 3_600_000);
        expect(verify.record.expiresAt).toBe(now + 2 * 3_600_000);
        expect(contact.record.expiresAt).toBe(now + 2 * 3_600_000);
        clock.mockReturnValue(reset.record.expiresAt - 1);
        expect(action.inspect(reset.rawToken).record.type).toBe('password_reset');
        expect(action.inspect(adminReset.rawToken).record.type).toBe('admin_password_reset');
        clock.mockReturnValue(reset.record.expiresAt);
        expect(() => action.inspect(reset.rawToken)).toThrow('expired');
        expect(() => action.inspect(adminReset.rawToken)).toThrow('expired');
        expect(action.inspect(setup.rawToken).record.type).toBe('account_setup');
        clock.mockReturnValue(setup.record.expiresAt - 1);
        expect(action.inspect(setup.rawToken).record.type).toBe('account_setup');
        clock.mockReturnValue(setup.record.expiresAt);
        expect(() => action.inspect(setup.rawToken)).toThrow('expired');
      }
    } finally {
      clock.mockRestore();
    }
  });

  test('preserves shared lifetimes and does not extend already-issued tokens', async () => {
    const user = await store.createUser({
      username: 'legacy-expiry', email: 'legacy-expiry@example.test', password: 'password123',
    });
    for (const tokens of [platformTokens, null]) {
      const legacy = new AuthActionTokenService(store, '2h', '5m', tokens);
      const setup = legacy.create({ userId: user.userId, type: 'account_setup', skipCooldown: true });
      const reset = legacy.create({ userId: user.userId, type: 'admin_password_reset', skipCooldown: true });
      expect(setup.record.expiresAt - setup.record.createdAt).toBe(2 * 3_600_000);
      expect(reset.record.expiresAt - reset.record.createdAt).toBe(2 * 3_600_000);
      const policy = { actionTokenTTL: '2h', accountSetupTokenTTL: '48h', passwordResetTokenTTL: '1h' };
      const updated = new AuthActionTokenService(store, policy, '5m', tokens);
      expect(updated.inspect(setup.rawToken).record.expiresAt).toBe(setup.record.expiresAt);
      policy.accountSetupTokenTTL = '7d';
      const next = updated.create({ userId: user.userId, type: 'account_setup', skipCooldown: true });
      expect(next.record.expiresAt - next.record.createdAt).toBe(48 * 3_600_000);
    }
  });

  test('validates every configured lifetime before any token is issued', () => {
    for (const field of ['actionTokenTTL', 'accountSetupTokenTTL', 'passwordResetTokenTTL']) {
      for (const value of ['soon', '-1h', '1.5h', '9007199254740991d']) {
        expect(() => new AuthActionTokenService(store, { [field]: value }, '5m', null))
          .toThrow('Invalid auth');
      }
    }
  });

  test('rejects exact expiry in platform-backed and direct action-token composition', async () => {
    const user = await store.createUser({ username: 'expiry-boundary', email: 'expiry@example.test', password: 'password123' });
    const clock = spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    try {
      for (const tokens of [platformTokens, null]) {
        clock.mockReturnValue(1_700_000_000_000);
        const action = new AuthActionTokenService(store, '1s', '5m', tokens);
        const created = action.create({ userId: user.userId, type: 'password_reset', skipCooldown: true });
        clock.mockReturnValue(created.record.expiresAt);
        expect(() => action.inspect(created.rawToken)).toThrow('expired');
      }
    } finally {
      clock.mockRestore();
    }
  });

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
    expect(events.query({ code: OBS_CODES.TOKENS_ACTION_CONSUMED.code }).events)
      .toHaveLength(1);
    expect(events.query({ code: OBS_CODES.AUTH_ACTION_TOKEN_CONSUMED.code }).events)
      .toHaveLength(1);
    expect(() => service.consume(created.rawToken, ['account_setup'])).toThrow(AuthError);
  });

  test('rejects a platform token service from another transaction domain', () => {
    const otherDb = createReactiveDB({ mode: 'memory' });
    const otherPlatformTokens = new PlatformTokenService(new PlatformTokenStore(otherDb));
    const emitted: string[] = [];

    try {
      expect(() => new AuthActionTokenService(
        store,
        '1h',
        '5m',
        otherPlatformTokens,
        (definition, options) => {
          emitted.push(definition.code);
          return emitPlatformCode(definition, options);
        },
      )).toThrow(expect.objectContaining({
        code: 'AUTH_STATE_INVARIANT_FAILED',
        status: 500,
      }));
      expect(emitted).toEqual([OBS_CODES.AUTH_STATE_INVARIANT_FAILED.code]);
      expect(events.query({ code: OBS_CODES.AUTH_STATE_INVARIANT_FAILED.code }).events[0])
        .toMatchObject({
          metadata: {
            component: 'action-tokens',
            invariant: 'platform-token-transaction-domain-mismatch',
          },
        });
    } finally {
      otherDb.dispose();
    }
  });

  test('rolls back platform consumption without publishing success telemetry', async () => {
    const user = await store.createUser({
      username: 'rollback-platform-token',
      email: 'rollback-platform-token@example.com',
      password: 'password123',
    });
    const created = service.create({
      userId: user.userId,
      type: 'password_reset',
    });

    expect(() => store.transaction(() => {
      service.consume(created.rawToken, ['password_reset']);
      throw new Error('rollback after consume');
    })).toThrow('rollback after consume');

    expect(service.inspect(created.rawToken, ['password_reset']).record.tokenId)
      .toBe(created.record.tokenId);
    expect(events.query({ code: OBS_CODES.TOKENS_ACTION_CONSUMED.code }).events)
      .toHaveLength(0);
    expect(events.query({ code: OBS_CODES.AUTH_ACTION_TOKEN_CONSUMED.code }).events)
      .toHaveLength(0);
  });

  test('defers legacy consumption telemetry through the outer transaction', async () => {
    const legacy = new AuthActionTokenService(store, '1h', '5m', null);
    const user = await store.createUser({
      username: 'rollback-legacy-token',
      email: 'rollback-legacy-token@example.com',
      password: 'password123',
    });
    const created = legacy.create({
      userId: user.userId,
      type: 'password_reset',
    });

    expect(() => store.transaction(() => {
      legacy.consume(created.rawToken, ['password_reset']);
      throw new Error('rollback legacy consume');
    })).toThrow('rollback legacy consume');

    expect(legacy.inspect(created.rawToken, ['password_reset']).record.tokenId)
      .toBe(created.record.tokenId);
    expect(events.query({ code: OBS_CODES.AUTH_ACTION_TOKEN_CONSUMED.code }).events)
      .toHaveLength(0);

    legacy.consume(created.rawToken, ['password_reset']);
    expect(events.query({ code: OBS_CODES.AUTH_ACTION_TOKEN_CONSUMED.code }).events)
      .toHaveLength(1);
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

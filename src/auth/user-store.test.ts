import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReactiveDB, ReactiveDB } from '../sync/reactive-db';
import { UserStore, type AuthSecurityAuditContext } from './user-store';
import { defineAuthTables } from './auth-schema';
import { AuthError } from './types';
import { AuthActionTokenService } from './action-token-service';
import { PlatformTokenService } from '../tokens/token-service';
import { PlatformTokenStore } from '../tokens/token-store';
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';

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

function pauseCredentialHash(target: UserStore): {
  started: Promise<void>;
  release(): void;
} {
  let markStarted!: () => void;
  let releaseHash!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    releaseHash = resolve;
  });
  const credentials = (target as unknown as {
    credentials: { hashPassword: (password: string) => Promise<string> };
  }).credentials;
  const hashPassword = credentials.hashPassword.bind(credentials);
  credentials.hashPassword = async (password) => {
    markStarted();
    await gate;
    return hashPassword(password);
  };
  return { started, release: releaseHash };
}

function createAuditRecordingStore(): {
  store: UserStore;
  events: unknown[];
} {
  const events: unknown[] = [];
  const observedStore = new UserStore(db, {
    auditService: {
      append: (event: unknown) => { events.push(event); },
    } as never,
  });
  return { store: observedStore, events };
}

// ─── User CRUD ────────────────────────────────────────────────────────────

describe('UserStore — User CRUD', () => {
  test('fences cached direct reads and writes after the runtime profile changes', async () => {
    const user = await store.createUser({
      username: 'profile-fenced',
      email: 'profile-fenced@example.com',
      password: 'password123',
    });
    store.setProperty(user.userId, 'department', 'before');
    let current = true;
    store.setRuntimeProfileGuard(() => {
      if (current) return;
      throw new AuthError(
        'This runtime auth profile is stale',
        'AUTH_PROFILE_CHANGED',
        503,
      );
    });

    expect(store.getUserById(user.userId)?.userId).toBe(user.userId);
    expect(store.getProperty(user.userId, 'department')).toBe('before');
    current = false;

    for (const operation of [
      () => store.assertCurrentProfile(),
      () => store.getUserById(user.userId),
      () => store.getProperty(user.userId, 'department'),
      () => store.setProperty(user.userId, 'department', 'after'),
      () => store.setConfig('profile-fence-test', 'unsafe'),
      () => store.storeActionToken({
        tokenId: 'aat_profile_fence',
        userId: user.userId,
        type: 'password_reset' as const,
        tokenHash: 'profile-fence-hash',
        expiresAt: Date.now() + 60_000,
        createdAt: Date.now(),
      }),
    ]) {
      expect(operation).toThrow(expect.objectContaining({
        code: 'AUTH_PROFILE_CHANGED',
        status: 503,
      }));
    }

    expect(db.prepare(
      'SELECT value FROM user_properties WHERE user_id = ? AND key = ?',
    ).get(user.userId, 'department')).toEqual({ value: 'before' });
    expect(db.prepare(
      "SELECT 1 AS present FROM _auth_config WHERE key = 'profile-fence-test'",
    ).get()).toBeNull();
    expect(db.prepare(
      "SELECT 1 AS present FROM _auth_action_tokens WHERE token_id = 'aat_profile_fence'",
    ).get()).toBeNull();
  });

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
    expect(user.emailVerifiedAt).toBeNull();
    expect(user.emailVerificationRequired).toBe(false);
    expect(user.mfaRequired).toBe(false);
    expect(user.createdAt).toBeGreaterThan(0);
    expect(user.updatedAt).toBeNull();
    expect(user.properties).toEqual({});
  });

  test('createUser canonicalizes email without changing the username', async () => {
    const user = await store.createUser({
      username: 'Case.Sensitive.User',
      email: '  Mixed.Case@Example.COM  ',
      password: 'password123',
    });

    expect(user.username).toBe('Case.Sensitive.User');
    expect(user.email).toBe('mixed.case@example.com');
    expect(store.getUserByEmail('  MIXED.CASE@EXAMPLE.COM ')?.userId).toBe(user.userId);
    expect(store.getUserByUsername('case.sensitive.user')).toBeNull();
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

  test('createUser rejects an async beforeInsert and rolls the identity back', async () => {
    const emitted: string[] = [];
    const observedStore = new UserStore(db, {
      emitCode: (definition, options) => {
        emitted.push(definition.code);
        return emitPlatformCode(definition, options);
      },
    });

    await expect(observedStore.createUser({
      username: 'async-before-insert',
      email: 'async-before-insert@example.com',
      password: 'password123',
    }, undefined, async () => {})).rejects.toMatchObject({
      code: 'AUTH_STATE_INVARIANT_FAILED',
      status: 500,
      message: '[auth] User creation beforeInsert must be synchronous.',
    });

    expect(observedStore.getUserByUsername('async-before-insert')).toBeNull();
    expect(emitted).toEqual([OBS_CODES.AUTH_STATE_INVARIANT_FAILED.code]);
  });

  test('rejects an asynchronous authorization bootstrapper and rolls identity back', async () => {
    const emitted: string[] = [];
    const observedStore = new UserStore(db, {
      emitCode: (definition, options) => {
        emitted.push(definition.code);
        return emitPlatformCode(definition, options);
      },
    });
    observedStore.setAuthorizationBootstrapper({
      establishBootstrapOwner: (async () => {
        throw new Error('private bootstrap rejection');
      }) as never,
    });

    await expect(observedStore.createUser({
      username: 'async-bootstrap-owner',
      email: 'async-bootstrap-owner@example.com',
      password: 'password123',
    })).rejects.toMatchObject({
      code: 'AUTH_STATE_INVARIANT_FAILED',
      message: '[auth] Authorization bootstrap owner callback must be synchronous.',
    });
    await Promise.resolve();

    expect(observedStore.countUsers()).toBe(0);
    expect(observedStore.isBootstrapRequired()).toBe(true);
    expect(emitted).toEqual([OBS_CODES.AUTH_STATE_INVARIANT_FAILED.code]);
  });

  test('rejects asynchronous provisional authority checks and cleanup atomically', async () => {
    const emitted: string[] = [];
    const observedStore = new UserStore(db, {
      emitCode: (definition, options) => {
        emitted.push(definition.code);
        return emitPlatformCode(definition, options);
      },
    });
    const policy = {
      role: 'admin' as const,
      requireEmailVerification: false,
      mfaRequired: false,
    };
    observedStore.setAuthorizationBootstrapper({
      establishBootstrapOwner() {},
      hasProvisionalRegistrationAuthority: (async () => true) as never,
      rollbackProvisionalApplicationOwner: () => true,
    });
    const first = await observedStore.createRegistrationUser({
      username: 'async-provisional-check',
      email: 'async-provisional-check@example.com',
      password: 'password123',
    }, () => policy, undefined, { provisional: true });
    expect(first.provisioning).not.toBeNull();

    expect(() => observedStore.finalizeRegistrationProvisioning(first.provisioning!))
      .toThrow(expect.objectContaining({
        code: 'AUTH_STATE_INVARIANT_FAILED',
        message: '[auth] Provisional authorization check must be synchronous.',
      }));
    await Promise.resolve();
    expect(observedStore.hasPendingRegistrationProvisioning(first.user.userId)).toBe(true);

    observedStore.setAuthorizationBootstrapper({
      establishBootstrapOwner() {},
      hasProvisionalRegistrationAuthority: () => true,
      rollbackProvisionalApplicationOwner: (async () => true) as never,
    });
    expect(() => observedStore.rollbackRegistrationProvisioning(first.provisioning!))
      .toThrow(expect.objectContaining({
        code: 'AUTH_STATE_INVARIANT_FAILED',
        message: '[auth] Provisional authorization rollback must be synchronous.',
      }));
    await Promise.resolve();
    expect(observedStore.getUserById(first.user.userId)).not.toBeNull();
    expect(observedStore.hasPendingRegistrationProvisioning(first.user.userId)).toBe(true);

    observedStore.setAuthorizationBootstrapper({
      establishBootstrapOwner() {},
      hasProvisionalRegistrationAuthority: () => true,
      rollbackProvisionalApplicationOwner: () => true,
    });
    expect(observedStore.rollbackRegistrationProvisioning(first.provisioning!)).toBe(true);
    expect(observedStore.getUserById(first.user.userId)).toBeNull();
    expect(emitted).toEqual([
      OBS_CODES.AUTH_STATE_INVARIANT_FAILED.code,
      OBS_CODES.AUTH_STATE_INVARIANT_FAILED.code,
    ]);
  });

  test('concurrent registrations elect exactly one bootstrap administrator', async () => {
    const created = await Promise.all(Array.from({ length: 6 }, (_, index) =>
      store.createRegistrationUser({
        username: `racer-${index}`,
        email: `racer-${index}@example.com`,
        password: 'password123',
      }, (isBootstrap) => ({
        isBootstrap,
        role: isBootstrap ? 'admin' : 'user',
        requireEmailVerification: false,
        mfaRequired: isBootstrap,
      }))
    ));

    expect(created.filter(({ user }) => user.role === 'admin')).toHaveLength(1);
    expect(created.filter(({ policy }) => policy.isBootstrap)).toHaveLength(1);
    expect(store.countUsersByRole('admin')).toBe(1);
    expect(store.countUsersByRole('user')).toBe(5);
  });

  test('registration returns the exact committed authentication generation', async () => {
    const registered = await store.createRegistrationUser({
      username: 'generation-receipt',
      email: 'generation-receipt@example.com',
      password: 'password123',
    }, () => ({
      role: 'admin' as const,
      requireEmailVerification: false,
      mfaRequired: false,
    }));

    expect(registered.authGeneration).toBe(0);
    store.revokeAllUserTokens(registered.user.userId);
    expect(store.getAuthGeneration(registered.user.userId)).toBe(1);
    expect(registered.authGeneration).toBe(0);
  });

  test('atomic registration admission closes after the bootstrap winner', async () => {
    const attempts = await Promise.allSettled(Array.from({ length: 6 }, (_, index) =>
      store.createRegistrationUser({
        username: `closed-racer-${index}`,
        email: `closed-racer-${index}@example.com`,
        password: 'password123',
      }, (isBootstrap) => {
        if (!isBootstrap) {
          throw new AuthError('Registration disabled', 'REGISTRATION_DISABLED', 403);
        }
        return {
          role: 'admin' as const,
          requireEmailVerification: false,
          mfaRequired: false,
        };
      })
    ));

    expect(attempts.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter(({ status }) => status === 'rejected')).toHaveLength(5);
    expect(store.countUsers()).toBe(1);
    expect(store.countUsersByRole('admin')).toBe(1);
  });

  test('registration rejects thenable policy and afterInsert callbacks atomically', async () => {
    const emitted: string[] = [];
    const observedStore = new UserStore(db, {
      emitCode: (definition, options) => {
        emitted.push(definition.code);
        return emitPlatformCode(definition, options);
      },
    });
    const policy = {
      role: 'user' as const,
      requireEmailVerification: false,
      mfaRequired: false,
    };

    await expect(observedStore.createRegistrationUser({
      username: 'thenable-policy',
      email: 'thenable-policy@example.com',
      password: 'password123',
    }, (() => ({
      then(resolve: (value: typeof policy) => void) { resolve(policy); },
    })) as never)).rejects.toMatchObject({
      code: 'AUTH_STATE_INVARIANT_FAILED',
      message: '[auth] Registration policy resolution must be synchronous.',
    });
    await expect(observedStore.createRegistrationUser({
      username: 'async-registration-hook',
      email: 'async-registration-hook@example.com',
      password: 'password123',
    }, () => policy, (async () => {}) as never)).rejects.toMatchObject({
      code: 'AUTH_STATE_INVARIANT_FAILED',
      message: '[auth] Registration afterInsert must be synchronous.',
    });

    expect(observedStore.countUsers()).toBe(0);
    expect(emitted).toEqual([
      OBS_CODES.AUTH_STATE_INVARIANT_FAILED.code,
      OBS_CODES.AUTH_STATE_INVARIANT_FAILED.code,
    ]);
  });

  test('captures direct createUser input before password hashing yields', async () => {
    let releaseHash!: () => void;
    let markHashStarted!: () => void;
    const hashStarted = new Promise<void>((resolve) => {
      markHashStarted = resolve;
    });
    const hashGate = new Promise<void>((resolve) => {
      releaseHash = resolve;
    });
    const credentials = (store as unknown as {
      credentials: { hashPassword: (password: string) => Promise<string> };
    }).credentials;
    const hashPassword = credentials.hashPassword.bind(credentials);
    credentials.hashPassword = async (password) => {
      markHashStarted();
      await hashGate;
      return hashPassword(password);
    };
    const properties = { department: 'original' };
    const input = {
      username: 'captured-direct-user',
      email: 'captured-direct-user@example.com',
      password: 'original-password',
      firstName: 'Original',
      lastName: 'Identity',
      properties,
    };

    const pending = store.createUser(input);
    await hashStarted;
    input.username = 'mutated-direct-user';
    input.email = 'mutated-direct-user@example.com';
    input.password = 'mutated-password';
    input.firstName = 'Mutated';
    input.lastName = 'Caller';
    properties.department = 'mutated';
    releaseHash();

    const user = await pending;
    expect(user).toMatchObject({
      username: 'captured-direct-user',
      email: 'captured-direct-user@example.com',
      firstName: 'Original',
      lastName: 'Identity',
      properties: { department: 'original' },
    });
    expect(await store.verifyPassword(user.userId, 'original-password')).toBe(true);
    expect(await store.verifyPassword(user.userId, 'mutated-password')).toBe(false);
  });

  test('captures registration identity fields before password hashing yields', async () => {
    let releaseHash!: () => void;
    let markHashStarted!: () => void;
    const hashStarted = new Promise<void>((resolve) => {
      markHashStarted = resolve;
    });
    const hashGate = new Promise<void>((resolve) => {
      releaseHash = resolve;
    });
    const credentials = (store as unknown as {
      credentials: { hashPassword: (password: string) => Promise<string> };
    }).credentials;
    const hashPassword = credentials.hashPassword.bind(credentials);
    credentials.hashPassword = async (password) => {
      markHashStarted();
      await hashGate;
      return hashPassword(password);
    };
    const properties = { department: 'registration-original' };
    const input = {
      username: 'captured-registration-user',
      email: 'captured-registration-user@example.com',
      password: 'original-password',
      firstName: 'Registration',
      lastName: 'Original',
      properties,
    };

    const pending = store.createRegistrationUser(input, () => ({
      role: 'admin' as const,
      requireEmailVerification: false,
      mfaRequired: false,
    }));
    await hashStarted;
    input.username = 'mutated-registration-user';
    input.email = 'mutated-registration-user@example.com';
    input.password = 'mutated-password';
    input.firstName = 'Mutated';
    input.lastName = 'Caller';
    properties.department = 'registration-mutated';
    releaseHash();

    const { user } = await pending;
    expect(user).toMatchObject({
      username: 'captured-registration-user',
      email: 'captured-registration-user@example.com',
      firstName: 'Registration',
      lastName: 'Original',
      properties: { department: 'registration-original' },
    });
    expect(await store.verifyPassword(user.userId, 'original-password')).toBe(true);
    expect(await store.verifyPassword(user.userId, 'mutated-password')).toBe(false);
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

  test('markEmailVerified stores verification timestamp and clears required flag', async () => {
    const user = await store.createUser({
      username: 'verify',
      email: 'verify@example.com',
      password: 'password123',
      emailVerificationRequired: true,
    });

    expect(user.emailVerificationRequired).toBe(true);
    expect(user.emailVerifiedAt).toBeNull();

    const verified = store.markEmailVerified(user.userId, 12345);

    expect(verified?.emailVerificationRequired).toBe(false);
    expect(verified?.emailVerifiedAt).toBe(12345);
    expect(store.getUserById(user.userId)?.emailVerifiedAt).toBe(12345);
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

  test('canonical CRUD aliases call the user store lifecycle methods', async () => {
    const user = await store.create({
      username: 'aliases',
      email: 'aliases@example.com',
      password: 'password123',
    });

    expect(store.get(user.userId)?.email).toBe('aliases@example.com');
    expect(store.list().some((listed) => listed.userId === user.userId)).toBe(true);

    const updated = store.update(user.userId, { firstName: 'Alias' });
    expect(updated?.firstName).toBe('Alias');
    expect(store.delete(user.userId)).toBe(true);
    expect(store.get(user.userId)).toBeNull();
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

  test('createUser rejects canonical variants of an existing email', async () => {
    await store.createUser({
      username: 'canonical-owner',
      email: 'canonical@example.com',
      password: 'password123',
    });

    await expect(store.createUser({
      username: 'canonical-conflict',
      email: '  CANONICAL@EXAMPLE.COM ',
      password: 'password123',
    })).rejects.toMatchObject({ code: 'DUPLICATE_EMAIL', status: 409 });
    expect(store.countUsers()).toBe(1);
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

  test('updateUser canonicalizes email and rejects canonical collisions', async () => {
    const alice = await store.createUser({
      username: 'canonical-update-alice',
      email: 'alice-update@example.com',
      password: 'pass12345',
    });
    const bob = await store.createUser({
      username: 'canonical-update-bob',
      email: 'bob-update@example.com',
      password: 'pass12345',
    });

    expect(store.updateUser(alice.userId, {
      email: '  ALICE.NEW@Example.COM ',
    })?.email).toBe('alice.new@example.com');
    expect(() => store.updateUser(bob.userId, {
      email: ' ALICE.NEW@EXAMPLE.COM ',
    })).toThrow(expect.objectContaining({ code: 'DUPLICATE_EMAIL' }));
    expect(store.getUserById(bob.userId)?.email).toBe('bob-update@example.com');
  });

  test('serializes email comparison with update so another process cannot carry verification across addresses', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zero-user-email-transition-'));
    const path = join(directory, 'auth.sqlite');
    let first: ReactiveDB | null = null;
    let second: ReactiveDB | null = null;

    try {
      first = createReactiveDB({ mode: path, busyTimeout: 1 });
      second = createReactiveDB({ mode: path, busyTimeout: 1 });
      defineAuthTables(first);
      defineAuthTables(second);
      const firstStore = new UserStore(first);
      const secondStore = new UserStore(second);
      const user = await firstStore.createUser({
        username: 'email-race',
        email: 'address-a@example.com',
        password: 'password123',
        emailVerificationRequired: true,
        emailVerifiedAt: 100,
      });

      const getUserById = firstStore.getUserById.bind(firstStore);
      let attemptedInterleaving = false;
      let interleavingBlocked = false;
      firstStore.getUserById = (userId) => {
        const stale = getUserById(userId);
        if (!attemptedInterleaving) {
          attemptedInterleaving = true;
          try {
            secondStore.updateUser(userId, { email: 'address-b@example.com' });
            secondStore.updateUser(userId, { emailVerifiedAt: 200 });
          } catch (error) {
            interleavingBlocked = /locked|busy/i.test(String(error));
          }
        }
        return stale;
      };

      const updated = firstStore.updateUser(user.userId, {
        email: 'address-a@example.com',
      });
      firstStore.getUserById = getUserById;

      expect(attemptedInterleaving).toBe(true);
      expect(interleavingBlocked).toBe(true);
      expect(updated).toMatchObject({
        email: 'address-a@example.com',
        emailVerifiedAt: 100,
      });
    } finally {
      second?.dispose();
      first?.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('legacy canonical email collisions fail closed without rewriting rows', async () => {
    const first = await store.createUser({
      username: 'legacy-email-one',
      email: 'legacy-one@example.com',
      password: 'pass12345',
    });
    const second = await store.createUser({
      username: 'legacy-email-two',
      email: 'legacy-two@example.com',
      password: 'pass12345',
    });
    const writeLegacyEmail = db.prepare('UPDATE users SET email = ? WHERE user_id = ?');
    writeLegacyEmail.run('Legacy.Collision@Example.com', first.userId);
    writeLegacyEmail.run(' legacy.collision@example.com ', second.userId);

    expect(store.getUserByEmail('legacy.collision@example.com')).toBeNull();
    await expect(store.createUser({
      username: 'legacy-email-three',
      email: 'LEGACY.COLLISION@EXAMPLE.COM',
      password: 'pass12345',
    })).rejects.toMatchObject({ code: 'DUPLICATE_EMAIL' });

    expect(store.getUserById(first.userId)?.email).toBe('Legacy.Collision@Example.com');
    expect(store.getUserById(second.userId)?.email).toBe(' legacy.collision@example.com ');
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

  test('multi-tenant deletion retains known organization history with a stable conflict', async () => {
    const user = await store.createUser({
      username: 'history-user',
      email: 'history-user@example.com',
      password: 'pass12345',
    });
    db.exec(`
      CREATE TABLE _auth_tenant_memberships (
        membership_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
        created_by TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT
      )
    `);
    db.prepare(`
      INSERT INTO _auth_tenant_memberships (membership_id, user_id, created_by)
      VALUES ('m_history', ?, ?)
    `).run(user.userId, user.userId);
    const multiStore = new UserStore(db, { tenancyMode: 'multi' });

    expect(() => multiStore.deleteUser(user.userId)).toThrow(AuthError);
    try {
      multiStore.deleteUser(user.userId);
    } catch (error) {
      expect(error).toMatchObject({
        status: 409,
        code: 'USER_HAS_TENANT_HISTORY',
      });
      expect((error as Error).message).toContain('suspend');
    }
    expect(multiStore.getUserById(user.userId)).not.toBeNull();
  });

  test('a mapped tenant-history conflict remains rollback-only when swallowed by an outer transaction', async () => {
    const user = await store.createUser({
      username: 'nested-history-user',
      email: 'nested-history-user@example.com',
      password: 'pass12345',
    });
    db.exec(`
      CREATE TABLE _auth_tenant_memberships (
        membership_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
        created_by TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT
      )
    `);
    db.prepare(`
      INSERT INTO _auth_tenant_memberships (membership_id, user_id, created_by)
      VALUES ('m_nested_history', ?, ?)
    `).run(user.userId, user.userId);
    const multiStore = new UserStore(db, { tenancyMode: 'multi' });

    expect(() => db.transaction(() => {
      try {
        multiStore.deleteUser(user.userId);
      } catch (error) {
        expect(error).toMatchObject({
          status: 409,
          code: 'USER_HAS_TENANT_HISTORY',
        });
      }
    })).toThrow('ReactiveDB transaction is rollback-only: FOREIGN KEY constraint failed');
    expect(multiStore.getUserById(user.userId)).not.toBeNull();
  });

  test('multi-tenant deletion does not mislabel an unrelated restrictive foreign key', async () => {
    const user = await store.createUser({
      username: 'foreign-user',
      email: 'foreign-user@example.com',
      password: 'pass12345',
    });
    db.exec(`
      CREATE TABLE _unrelated_user_reference (
        reference_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT
      )
    `);
    db.prepare(`
      INSERT INTO _unrelated_user_reference (reference_id, user_id)
      VALUES ('ref_1', ?)
    `).run(user.userId);
    const multiStore = new UserStore(db, { tenancyMode: 'multi' });

    try {
      multiStore.deleteUser(user.userId);
      throw new Error('Expected restrictive foreign key failure');
    } catch (error) {
      expect(error).not.toBeInstanceOf(AuthError);
      expect(String(error)).toContain('FOREIGN KEY constraint failed');
    }
    expect(multiStore.getUserById(user.userId)).not.toBeNull();
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

  test('rejects a stale password verification after a concurrent reset commits', async () => {
    const user = await store.createUser({
      username: 'verification-reset-race',
      email: 'verification-reset-race@example.com',
      password: 'oldpassword1',
    });
    const credentials = (store as unknown as {
      credentials: {
        verifyPasswordHash(password: string, passwordHash: string): Promise<boolean>;
      };
    }).credentials;
    const originalVerify = credentials.verifyPasswordHash.bind(credentials);
    let markVerificationStarted!: () => void;
    let releaseVerification!: () => void;
    const verificationStarted = new Promise<void>((resolve) => {
      markVerificationStarted = resolve;
    });
    const verificationGate = new Promise<void>((resolve) => {
      releaseVerification = resolve;
    });
    credentials.verifyPasswordHash = async (password, passwordHash) => {
      markVerificationStarted();
      await verificationGate;
      return originalVerify(password, passwordHash);
    };

    const staleVerification = store.verifyPassword(user.userId, 'oldpassword1');
    try {
      await verificationStarted;
      expect(await store.resetPassword(user.userId, 'newpassword1')).toBe(true);
      releaseVerification();
      await expect(staleVerification).resolves.toBe(false);
    } finally {
      releaseVerification();
      credentials.verifyPasswordHash = originalVerify;
    }
    await expect(store.verifyPassword(user.userId, 'newpassword1')).resolves.toBe(true);
  });

  test('updatePassword changes password and revokes tokens', async () => {
    const user = await store.createUser({
      username: 'alice',
      email: 'alice@example.com',
      password: 'oldpassword1',
    });
    const parentRevocations: Array<{ userId: string; reason: string }> = [];
    store.setAuthSessionRevoker({
      revoke: () => false,
      revokeAllForUser: (userId, reason) => {
        parentRevocations.push({ userId, reason });
        return 1;
      },
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
    expect(parentRevocations).toEqual([{
      userId: user.userId,
      reason: 'security-state-changed',
    }]);
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

  test('captures update-password audit context before password hashing yields', async () => {
    const { store: observedStore, events } = createAuditRecordingStore();
    const user = await observedStore.createUser({
      username: 'captured-password-update',
      email: 'captured-password-update@example.com',
      password: 'oldpassword1',
    });
    const audit: AuthSecurityAuditContext = {
      actor: {
        userId: 'original-actor',
        membershipId: 'original-membership',
        provenance: 'authenticated-request',
      },
      request: {
        requestId: 'original-request',
        correlationId: 'original-correlation',
      },
    };
    const hash = pauseCredentialHash(observedStore);

    const pending = observedStore.updatePassword(
      user.userId,
      'oldpassword1',
      'newpassword1',
      audit,
    );
    await hash.started;
    audit.actor.userId = 'mutated-actor';
    audit.actor.membershipId = 'mutated-membership';
    audit.request!.requestId = 'mutated-request';
    audit.request!.correlationId = 'mutated-correlation';
    hash.release();

    expect(await pending).toBe(true);
    expect(events).toContainEqual(expect.objectContaining({
      action: 'account.password-changed',
      actor: expect.objectContaining({
        userId: 'original-actor',
        membershipId: 'original-membership',
      }),
      request: expect.objectContaining({
        requestId: 'original-request',
        correlationId: 'original-correlation',
      }),
    }));
  });

  test('concurrent password changes compare-and-swap the verified credential', async () => {
    const user = await store.createUser({
      username: 'password-race',
      email: 'password-race@example.com',
      password: 'oldpassword1',
    });

    const outcomes = await Promise.all([
      store.updatePassword(user.userId, 'oldpassword1', 'winner-password-a'),
      store.updatePassword(user.userId, 'oldpassword1', 'winner-password-b'),
    ]);

    expect(outcomes.filter(Boolean)).toHaveLength(1);
    expect(await store.verifyPassword(user.userId, 'oldpassword1')).toBe(false);
    const accepted = await Promise.all([
      store.verifyPassword(user.userId, 'winner-password-a'),
      store.verifyPassword(user.userId, 'winner-password-b'),
    ]);
    expect(accepted.filter(Boolean)).toHaveLength(1);
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

  test('captures reset controls and audit context before password hashing yields', async () => {
    const { store: observedStore, events } = createAuditRecordingStore();
    const user = await observedStore.createUser({
      username: 'captured-password-reset',
      email: 'captured-password-reset@example.com',
      password: 'oldpassword1',
      passwordChangeRequired: false,
    });
    const audit: AuthSecurityAuditContext = {
      actor: { userId: 'original-admin', provenance: 'authenticated-request' },
      request: { requestId: 'original-reset-request' },
    };
    let originalCallbackCalls = 0;
    let replacementCallbackCalls = 0;
    const options: {
      passwordChangeRequired?: boolean;
      beforeCommit?: () => void;
      audit?: AuthSecurityAuditContext;
    } = {
      passwordChangeRequired: true,
      beforeCommit: () => { originalCallbackCalls += 1; },
      audit,
    };
    const hash = pauseCredentialHash(observedStore);

    const pending = observedStore.resetPassword(user.userId, 'newpassword1', options);
    await hash.started;
    options.passwordChangeRequired = false;
    options.beforeCommit = () => { replacementCallbackCalls += 1; };
    options.beforeCommit = undefined;
    options.audit = {
      actor: { userId: 'replacement-admin', provenance: 'system' },
      request: { requestId: 'replacement-reset-request' },
    };
    audit.actor.userId = 'mutated-original-admin';
    audit.request!.requestId = 'mutated-original-reset-request';
    hash.release();

    expect(await pending).toBe(true);
    expect(originalCallbackCalls).toBe(1);
    expect(replacementCallbackCalls).toBe(0);
    expect(observedStore.getUserById(user.userId)?.passwordChangeRequired).toBe(true);
    expect(events).toContainEqual(expect.objectContaining({
      action: 'account.password-reset-by-admin',
      actor: expect.objectContaining({ userId: 'original-admin' }),
      request: expect.objectContaining({ requestId: 'original-reset-request' }),
    }));
  });

  test('resetPassword rolls back credential, gate, and session changes on revocation failure', async () => {
    const user = await store.createUser({
      username: 'atomic-admin-reset',
      email: 'atomic-admin-reset@example.com',
      password: 'oldpassword1',
      passwordChangeRequired: true,
    });
    store.storeRefreshToken(
      'tok_atomic_admin_reset',
      user.userId,
      'atomic_admin_reset_hash',
      Date.now() + 86_400_000,
    );
    db.exec(`
      CREATE TRIGGER fail_password_reset_generation_bump
      BEFORE INSERT ON _auth_user_generations
      BEGIN
        SELECT RAISE(ABORT, 'password reset generation write failed');
      END
    `);

    await expect(store.resetPassword(user.userId, 'newpassword1')).rejects
      .toThrow('password reset generation write failed');

    expect(await store.verifyPassword(user.userId, 'oldpassword1')).toBe(true);
    expect(await store.verifyPassword(user.userId, 'newpassword1')).toBe(false);
    expect(store.getUserById(user.userId)?.passwordChangeRequired).toBe(true);
    expect(store.getRefreshTokenByHash('atomic_admin_reset_hash')?.revokedAt).toBeNull();
    expect(store.getAuthGeneration(user.userId)).toBe(0);
  });

  test('resetPassword rejects an async authority callback before credential commit', async () => {
    const emitted: string[] = [];
    const observedStore = new UserStore(db, {
      emitCode: (definition, options) => {
        emitted.push(definition.code);
        return emitPlatformCode(definition, options);
      },
    });
    const user = await store.createUser({
      username: 'async-admin-reset-authority',
      email: 'async-admin-reset-authority@example.com',
      password: 'oldpassword1',
      passwordChangeRequired: true,
    });
    observedStore.storeRefreshToken(
      'tok_async_admin_reset',
      user.userId,
      'async_admin_reset_hash',
      Date.now() + 86_400_000,
    );

    await expect(observedStore.resetPassword(user.userId, 'newpassword1', {
      beforeCommit: async () => {},
    })).rejects.toMatchObject({
      code: 'AUTH_STATE_INVARIANT_FAILED',
      status: 500,
      message: '[auth] Password reset beforeCommit must be synchronous.',
    });

    expect(await observedStore.verifyPassword(user.userId, 'oldpassword1')).toBe(true);
    expect(await observedStore.verifyPassword(user.userId, 'newpassword1')).toBe(false);
    expect(observedStore.getUserById(user.userId)?.passwordChangeRequired).toBe(true);
    expect(observedStore.getRefreshTokenByHash('async_admin_reset_hash')?.revokedAt)
      .toBeNull();
    expect(observedStore.getAuthGeneration(user.userId)).toBe(0);
    expect(emitted).toEqual([OBS_CODES.AUTH_STATE_INVARIANT_FAILED.code]);
  });

  test('resetPassword reports a retained identity without a credential as an invariant', async () => {
    const emitted: string[] = [];
    const observedStore = new UserStore(db, {
      emitCode: (definition, options) => {
        emitted.push(definition.code);
        return emitPlatformCode(definition, options);
      },
    });
    const user = await store.createUser({
      username: 'missing-admin-reset-credential',
      email: 'missing-admin-reset-credential@example.com',
      password: 'oldpassword1',
      passwordChangeRequired: true,
    });
    observedStore.storeRefreshToken(
      'tok_missing_admin_credential',
      user.userId,
      'missing_admin_credential_hash',
      Date.now() + 86_400_000,
    );
    db.prepare('DELETE FROM _credentials WHERE user_id = ?').run(user.userId);

    await expect(observedStore.resetPassword(user.userId, 'newpassword1', {
      beforeCommit: () => {
        observedStore.setProperty(user.userId, 'reset-probe', 'must-roll-back');
      },
    })).rejects.toMatchObject({
      code: 'AUTH_STATE_INVARIANT_FAILED',
      status: 500,
      message: '[auth] Password reset credential is unavailable.',
    });

    expect(observedStore.getUserById(user.userId)?.passwordChangeRequired).toBe(true);
    expect(observedStore.getProperty(user.userId, 'reset-probe')).toBeNull();
    expect(observedStore.getRefreshTokenByHash('missing_admin_credential_hash')?.revokedAt)
      .toBeNull();
    expect(observedStore.getAuthGeneration(user.userId)).toBe(0);
    expect(emitted).toEqual([OBS_CODES.AUTH_STATE_INVARIANT_FAILED.code]);
  });

  test('completePasswordAction clears the forced gate and replaces the credential', async () => {
    const user = await store.createUser({
      username: 'forced-recovery',
      email: 'forced-recovery@example.com',
      password: 'oldpassword1',
      passwordChangeRequired: true,
    });
    store.storeRefreshToken(
      'tok_forced_recovery',
      user.userId,
      'forced_recovery_hash',
      Date.now() + 86_400_000,
    );
    let consumed = false;

    expect(await store.completePasswordAction(user.userId, 'newpassword1', () => {
      consumed = true;
    })).toBe(true);

    expect(consumed).toBe(true);
    expect(await store.verifyPassword(user.userId, 'oldpassword1')).toBe(false);
    expect(await store.verifyPassword(user.userId, 'newpassword1')).toBe(true);
    expect(store.getUserById(user.userId)?.passwordChangeRequired).toBe(false);
    expect(store.getRefreshTokenByHash('forced_recovery_hash')?.revokedAt).not.toBeNull();
    expect(store.getAuthGeneration(user.userId)).toBe(1);
  });

  test('captures password-action audit context before password hashing yields', async () => {
    const { store: observedStore, events } = createAuditRecordingStore();
    const user = await observedStore.createUser({
      username: 'captured-password-action',
      email: 'captured-password-action@example.com',
      password: 'oldpassword1',
      passwordChangeRequired: true,
    });
    const audit: AuthSecurityAuditContext = {
      actor: { userId: 'original-recovery-actor', provenance: 'account-recovery' },
      request: { requestId: 'original-recovery-request' },
    };
    let consumed = false;
    const hash = pauseCredentialHash(observedStore);

    const pending = observedStore.completePasswordAction(
      user.userId,
      'newpassword1',
      () => { consumed = true; },
      audit,
    );
    await hash.started;
    audit.actor.userId = 'mutated-recovery-actor';
    audit.request!.requestId = 'mutated-recovery-request';
    hash.release();

    expect(await pending).toBe(true);
    expect(consumed).toBe(true);
    expect(events).toContainEqual(expect.objectContaining({
      action: 'account.password-recovered',
      actor: expect.objectContaining({ userId: 'original-recovery-actor' }),
      request: expect.objectContaining({ requestId: 'original-recovery-request' }),
    }));
  });

  test('completePasswordAction rejects an async token consumer and rolls back consumption', async () => {
    const emitted: string[] = [];
    const observedStore = new UserStore(db, {
      emitCode: (definition, options) => {
        emitted.push(definition.code);
        return emitPlatformCode(definition, options);
      },
    });
    const user = await store.createUser({
      username: 'async-recovery-consumer',
      email: 'async-recovery-consumer@example.com',
      password: 'oldpassword1',
      passwordChangeRequired: true,
    });
    const platformTokens = new PlatformTokenService(new PlatformTokenStore(db), {
      actionTokenCooldown: false,
    });
    const actionTokens = new AuthActionTokenService(
      observedStore,
      '1h',
      '5m',
      platformTokens,
    );
    const created = actionTokens.create({
      userId: user.userId,
      type: 'password_reset',
    });

    await expect(observedStore.completePasswordAction(
      user.userId,
      'newpassword1',
      async () => {
        actionTokens.consume(created.rawToken, ['password_reset']);
      },
    )).rejects.toMatchObject({
      code: 'AUTH_STATE_INVARIANT_FAILED',
      status: 500,
      message: '[auth] Password recovery token consumption must be synchronous.',
    });

    expect(actionTokens.inspect(created.rawToken, ['password_reset']).record.tokenId)
      .toBe(created.record.tokenId);
    expect(await observedStore.verifyPassword(user.userId, 'oldpassword1')).toBe(true);
    expect(await observedStore.verifyPassword(user.userId, 'newpassword1')).toBe(false);
    expect(observedStore.getUserById(user.userId)?.passwordChangeRequired).toBe(true);
    expect(observedStore.getAuthGeneration(user.userId)).toBe(0);
    expect(emitted).toEqual([OBS_CODES.AUTH_STATE_INVARIANT_FAILED.code]);
  });

  test('completePasswordAction poisons an awaited token-consumer continuation', async () => {
    const user = await store.createUser({
      username: 'delayed-recovery-consumer',
      email: 'delayed-recovery-consumer@example.com',
      password: 'oldpassword1',
      passwordChangeRequired: true,
    });
    const platformTokens = new PlatformTokenService(new PlatformTokenStore(db), {
      actionTokenCooldown: false,
    });
    const actionTokens = new AuthActionTokenService(store, '1h', '5m', platformTokens);
    const created = actionTokens.create({
      userId: user.userId,
      type: 'password_reset',
    });
    let releaseContinuation!: () => void;
    const continuationGate = new Promise<void>((resolve) => {
      releaseContinuation = resolve;
    });
    let finishContinuation!: () => void;
    const continuationFinished = new Promise<void>((resolve) => {
      finishContinuation = resolve;
    });
    let continuationError: unknown;

    await expect(store.completePasswordAction(
      user.userId,
      'newpassword1',
      async () => {
        await continuationGate;
        try {
          actionTokens.consume(created.rawToken, ['password_reset']);
        } catch (error) {
          continuationError = error;
        } finally {
          finishContinuation();
        }
      },
    )).rejects.toMatchObject({
      code: 'AUTH_STATE_INVARIANT_FAILED',
      status: 500,
    });

    releaseContinuation();
    await continuationFinished;
    expect(continuationError).toBeInstanceOf(Error);
    expect((continuationError as Error).message).toContain('transaction is rollback-only');
    expect(actionTokens.inspect(created.rawToken, ['password_reset']).record.tokenId)
      .toBe(created.record.tokenId);
    expect(await store.verifyPassword(user.userId, 'oldpassword1')).toBe(true);
    expect(await store.verifyPassword(user.userId, 'newpassword1')).toBe(false);
  });

  test('an in-flight profile change fences password replacement before commit', async () => {
    const user = await store.createUser({
      username: 'profile-fenced-password',
      email: 'profile-fenced-password@example.com',
      password: 'oldpassword1',
    });
    store.storeRefreshToken(
      'tok_profile_fenced_password',
      user.userId,
      'profile_fenced_password_hash',
      Date.now() + 86_400_000,
    );
    let profileChecks = 0;
    store.setRuntimeProfileGuard(() => {
      profileChecks += 1;
      if (profileChecks < 3) return;
      throw new AuthError(
        'This runtime auth profile is stale',
        'AUTH_PROFILE_CHANGED',
        503,
      );
    });

    await expect(store.updatePassword(
      user.userId,
      'oldpassword1',
      'newpassword1',
    )).rejects.toMatchObject({ code: 'AUTH_PROFILE_CHANGED', status: 503 });

    store.setRuntimeProfileGuard(() => {});
    expect(await store.verifyPassword(user.userId, 'oldpassword1')).toBe(true);
    expect(await store.verifyPassword(user.userId, 'newpassword1')).toBe(false);
    expect(store.getRefreshTokenByHash('profile_fenced_password_hash')?.revokedAt).toBeNull();
    expect(store.getAuthGeneration(user.userId)).toBe(0);
  });

  test('password action storage failure does not consume the recovery token', async () => {
    const user = await store.createUser({
      username: 'atomic-reset',
      email: 'atomic-reset@example.com',
      password: 'oldpassword1',
    });
    const platformTokens = new PlatformTokenService(new PlatformTokenStore(db), {
      actionTokenCooldown: false,
    });
    const actionTokens = new AuthActionTokenService(store, '1h', '5m', platformTokens);
    const created = actionTokens.create({
      userId: user.userId,
      type: 'password_reset',
    });
    db.exec(`
      CREATE TRIGGER fail_password_action_update
      BEFORE UPDATE ON _credentials
      BEGIN
        SELECT RAISE(ABORT, 'credential write failed');
      END
    `);

    let failure: unknown;
    try {
      await store.completePasswordAction(user.userId, 'newpassword1', () => {
        actionTokens.consume(created.rawToken, ['password_reset']);
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    expect(actionTokens.inspect(created.rawToken, ['password_reset']).record.tokenId)
      .toBe(created.record.tokenId);
    expect(await store.verifyPassword(user.userId, 'oldpassword1')).toBe(true);
    expect(await store.verifyPassword(user.userId, 'newpassword1')).toBe(false);
  });

  test('password recovery fails closed and preserves its token when the credential is missing', async () => {
    const emitted: string[] = [];
    const observedStore = new UserStore(db, {
      emitCode: (definition, options) => {
        emitted.push(definition.code);
        return emitPlatformCode(definition, options);
      },
    });
    const user = await store.createUser({
      username: 'missing-credential-reset',
      email: 'missing-credential-reset@example.com',
      password: 'oldpassword1',
    });
    const platformTokens = new PlatformTokenService(new PlatformTokenStore(db), {
      actionTokenCooldown: false,
    });
    const actionTokens = new AuthActionTokenService(observedStore, '1h', '5m', platformTokens);
    const created = actionTokens.create({
      userId: user.userId,
      type: 'password_reset',
    });
    db.prepare('DELETE FROM _credentials WHERE user_id = ?').run(user.userId);

    await expect(observedStore.completePasswordAction(user.userId, 'newpassword1', () => {
      actionTokens.consume(created.rawToken, ['password_reset']);
    })).rejects.toMatchObject({
      code: 'AUTH_STATE_INVARIANT_FAILED',
      status: 500,
      message: '[auth] Password recovery credential is unavailable.',
    });
    expect(actionTokens.inspect(created.rawToken, ['password_reset']).record.tokenId)
      .toBe(created.record.tokenId);
    expect(emitted).toEqual([OBS_CODES.AUTH_STATE_INVARIANT_FAILED.code]);
  });

  test('verification storage failure does not consume the email link', async () => {
    const user = await store.createUser({
      username: 'atomic-verification',
      email: 'atomic-verification@example.com',
      password: 'password123',
      emailVerifiedAt: null,
      emailVerificationRequired: true,
    });
    const platformTokens = new PlatformTokenService(new PlatformTokenStore(db), {
      actionTokenCooldown: false,
    });
    const actionTokens = new AuthActionTokenService(store, '1h', '5m', platformTokens);
    const created = actionTokens.create({
      userId: user.userId,
      type: 'email_verification',
    });
    db.exec(`
      CREATE TRIGGER fail_email_verification_update
      BEFORE UPDATE ON users
      BEGIN
        SELECT RAISE(ABORT, 'verification write failed');
      END
    `);

    expect(() => store.completeEmailVerification(user.userId, () => {
      actionTokens.consume(created.rawToken, ['email_verification']);
    })).toThrow('verification write failed');
    expect(actionTokens.inspect(created.rawToken, ['email_verification']).record.tokenId)
      .toBe(created.record.tokenId);
    expect(store.getUserById(user.userId)?.emailVerifiedAt).toBeNull();
    expect(store.getUserById(user.userId)?.emailVerificationRequired).toBe(true);
  });

  test('verification rejects async token and completion callbacks with full rollback', async () => {
    const emitted: string[] = [];
    const observedStore = new UserStore(db, {
      emitCode: (definition, options) => {
        emitted.push(definition.code);
        return emitPlatformCode(definition, options);
      },
    });
    const platformTokens = new PlatformTokenService(new PlatformTokenStore(db), {
      actionTokenCooldown: false,
    });
    const actionTokens = new AuthActionTokenService(
      observedStore,
      '1h',
      '0s',
      platformTokens,
    );
    const first = await observedStore.createUser({
      username: 'async-verification-consumer',
      email: 'async-verification-consumer@example.com',
      password: 'password123',
      emailVerifiedAt: null,
      emailVerificationRequired: true,
    });
    const firstToken = actionTokens.create({
      userId: first.userId,
      type: 'email_verification',
      skipCooldown: true,
    });

    expect(() => observedStore.completeEmailVerification(first.userId, async () => {
      actionTokens.consume(firstToken.rawToken, ['email_verification']);
    })).toThrow(expect.objectContaining({
      code: 'AUTH_STATE_INVARIANT_FAILED',
      message: '[auth] Email verification token consumption must be synchronous.',
    }));
    expect(actionTokens.inspect(firstToken.rawToken, ['email_verification']).record.tokenId)
      .toBe(firstToken.record.tokenId);
    expect(observedStore.getUserById(first.userId)?.emailVerifiedAt).toBeNull();

    const second = await observedStore.createUser({
      username: 'async-verification-after',
      email: 'async-verification-after@example.com',
      password: 'password123',
      emailVerifiedAt: null,
      emailVerificationRequired: true,
    });
    const secondToken = actionTokens.create({
      userId: second.userId,
      type: 'email_verification',
      skipCooldown: true,
    });
    expect(() => observedStore.completeEmailVerification(
      second.userId,
      () => actionTokens.consume(secondToken.rawToken, ['email_verification']),
      Date.now(),
      async () => {},
    )).toThrow(expect.objectContaining({
      code: 'AUTH_STATE_INVARIANT_FAILED',
      message: '[auth] Email verification afterVerify must be synchronous.',
    }));
    expect(actionTokens.inspect(secondToken.rawToken, ['email_verification']).record.tokenId)
      .toBe(secondToken.record.tokenId);
    expect(observedStore.getUserById(second.userId)?.emailVerifiedAt).toBeNull();
    expect(emitted).toEqual([
      OBS_CODES.AUTH_STATE_INVARIANT_FAILED.code,
      OBS_CODES.AUTH_STATE_INVARIANT_FAILED.code,
    ]);
  });

  test('verification invalidates sibling links and existing sessions', async () => {
    const user = await store.createUser({
      username: 'verification-siblings',
      email: 'verification-siblings@example.com',
      password: 'password123',
      emailVerifiedAt: null,
      emailVerificationRequired: true,
    });
    const platformTokens = new PlatformTokenService(new PlatformTokenStore(db), {
      actionTokenCooldown: false,
    });
    const actionTokens = new AuthActionTokenService(store, '1h', '0s', platformTokens);
    const first = actionTokens.create({
      userId: user.userId, type: 'email_verification', skipCooldown: true,
    });
    const sibling = actionTokens.create({
      userId: user.userId, type: 'email_verification', skipCooldown: true,
    });
    store.storeRefreshToken('pre-verification', user.userId, 'pre-verification-hash',
      Date.now() + 60_000);

    const verified = store.completeEmailVerification(user.userId, () => {
      actionTokens.consume(first.rawToken, ['email_verification']);
    });

    expect(verified?.emailVerificationRequired).toBe(false);
    expect(verified?.emailVerifiedAt).not.toBeNull();
    expect(store.getAuthGeneration(user.userId)).toBe(1);
    expect(store.getRefreshTokenByHash('pre-verification-hash')?.revokedAt).not.toBeNull();
    expect(() => actionTokens.inspect(sibling.rawToken, ['email_verification']))
      .toThrow('Action token is invalid');
  });

  test('email verification returns its exact post-revocation authentication generation', async () => {
    const user = await store.createUser({
      username: 'verification-generation-receipt',
      email: 'verification-generation-receipt@example.com',
      password: 'password123',
      emailVerifiedAt: null,
      emailVerificationRequired: true,
    });

    const receipt = store.completeEmailVerificationForAuthentication(
      user.userId,
      () => {},
    );
    expect(receipt).toMatchObject({
      user: { userId: user.userId, emailVerificationRequired: false },
      authGeneration: 1,
    });

    store.revokeAllUserTokens(user.userId);
    expect(store.getAuthGeneration(user.userId)).toBe(2);
    expect(receipt?.authGeneration).toBe(1);
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

  test('requirePasswordChange rolls back the gate when generation storage fails', async () => {
    const user = await store.createUser({
      username: 'atomic-gate',
      email: 'atomic-gate@example.com',
      password: 'password123',
    });
    store.storeRefreshToken(
      'tok_atomic_gate',
      user.userId,
      'atomic_gate_hash',
      Date.now() + 86_400_000
    );
    db.exec(`
      CREATE TRIGGER fail_auth_generation_bump
      BEFORE INSERT ON _auth_user_generations
      BEGIN
        SELECT RAISE(ABORT, 'generation write failed');
      END
    `);

    expect(() => store.requirePasswordChange(user.userId)).toThrow('generation write failed');
    expect(store.getUserById(user.userId)!.passwordChangeRequired).toBe(false);
    expect(store.getRefreshTokenByHash('atomic_gate_hash')!.revokedAt).toBeNull();
    expect(store.getAuthGeneration(user.userId)).toBe(0);
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

  test('rejects an asynchronous session revoker and rolls token invalidation back', async () => {
    const emitted: string[] = [];
    const observedStore = new UserStore(db, {
      emitCode: (definition, options) => {
        emitted.push(definition.code);
        return emitPlatformCode(definition, options);
      },
    });
    observedStore.storeRefreshToken(
      'tok_async_revoker',
      userId,
      'async-revoker-hash',
      Date.now() + 86_400_000,
    );
    observedStore.setAuthSessionRevoker({
      revoke: () => true,
      revokeAllForUser: (async () => 1) as never,
    });

    expect(() => observedStore.revokeAllUserTokens(userId))
      .toThrow(expect.objectContaining({
        code: 'AUTH_STATE_INVARIANT_FAILED',
        message: '[auth] User session revocation callback must be synchronous.',
      }));
    await Promise.resolve();

    expect(observedStore.getRefreshTokenByHash('async-revoker-hash')?.revokedAt).toBeNull();
    expect(observedStore.getAuthGeneration(userId)).toBe(0);
    expect(emitted).toEqual([OBS_CODES.AUTH_STATE_INVARIANT_FAILED.code]);
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

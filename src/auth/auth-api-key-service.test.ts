import { afterEach, describe, expect, test } from 'bun:test';
import { emitPlatformCode } from '../observability/sink';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { AuthApiKeyService } from './auth-api-key-service';
import { AuthApiKeyStore } from './auth-api-key-store';
import { AUTH_API_KEY_MAX_TIMESTAMP_MS } from './auth-api-key-time';
import type { AuthApiKeyMutationAuthority } from './auth-api-key-types';
import { AuthAuditService } from './auth-audit-service';
import { resolveAuthBehaviorConfig } from './auth-config';
import { defineAuthTables } from './auth-schema';
import { AuthorizationKernel } from './authorization-kernel';
import { TenantStore, TenancyService } from './tenancy';
import { AuthError, type AuthContext, type AuthTenancyMode } from './types';
import { UserStore } from './user-store';

const databases: ReactiveDB[] = [];

afterEach(() => {
  for (const db of databases.splice(0).reverse()) db.dispose();
});

describe('Guardian user API-key service', () => {
  test('issues an application key once, persists only its hash, and resolves live authority', () => {
    const harness = createHarness();
    harness.insertUser('member');
    const session = applicationSession('member');

    const issued = harness.service.issueSelf(operation(session), {
      label: '  CI deployer  ',
    });
    const persisted = harness.store.getById(issued.apiKey.keyId)!;
    const rawRow = harness.db.prepare(
      'SELECT * FROM _auth_api_keys WHERE key_id = ?',
    ).get(issued.apiKey.keyId) as Record<string, unknown>;

    expect(issued.secret).toMatch(
      /^zero_ak_v1\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/,
    );
    expect(issued.apiKey).toMatchObject({
      userId: 'member',
      label: 'CI deployer',
      scopeKind: 'application',
      scopeId: 'application',
      status: 'active',
    });
    expect('secret' in issued.apiKey).toBe(false);
    expect(persisted.secretHash).toHaveLength(64);
    expect(persisted.secretHash).not.toBe(issued.secret);
    expect(JSON.stringify(rawRow)).not.toContain(issued.secret);
    const listed = harness.service.listSelf(session);
    expect(listed.apiKeys).toEqual([issued.apiKey]);
    expect(listed.capabilities).toEqual({
      canIssue: true,
      canRotate: true,
      canRevoke: true,
    });

    expect(harness.service.resolve(issued.secret)).toMatchObject({
      userId: 'member',
      credentialKind: 'api-key',
      credentialId: issued.apiKey.keyId,
      sessionScopeKind: 'application',
      sessionScopeId: 'application',
    });
    const wrongSecret = `${issued.secret.slice(0, -1)}${
      issued.secret.endsWith('A') ? 'B' : 'A'
    }`;
    expect(harness.service.resolve(wrongSecret)).toBeNull();
  });

  test('expires a key at its exact deadline', () => {
    const harness = createHarness();
    harness.insertUser('member');
    const session = applicationSession('member');
    const issued = harness.service.issueSelf(operation(session), {
      label: 'Short lived',
      ttl: '1s',
    });

    harness.advance(999);
    expect(harness.service.resolve(issued.secret)?.userId).toBe('member');
    harness.advance(1);

    expect(harness.service.resolve(issued.secret)).toBeNull();
    expect(harness.service.listSelf(session).apiKeys[0]?.status).toBe('expired');
  });

  test('rejects an expiry that cannot be represented by the browser contract', () => {
    const harness = createHarness();
    harness.advance(AUTH_API_KEY_MAX_TIMESTAMP_MS - harness.now() - 500);
    harness.insertUser('member');
    const session = applicationSession('member');

    expectAuthError(
      () => harness.service.issueSelf(operation(session), {
        label: 'Out of range',
        ttl: '1s',
      }),
      'AUTH_API_KEY_VALIDATION_FAILED',
      422,
    );
    expect(harness.service.listSelf(session).apiKeys).toEqual([]);
  });

  test('revokes a key and rejects the credential immediately', () => {
    const harness = createHarness();
    harness.insertUser('member');
    const session = applicationSession('member');
    const issued = harness.service.issueSelf(operation(session), { label: 'Revoke me' });

    const revoked = harness.service.revokeSelf(operation(session), issued.apiKey.keyId);

    expect(revoked.status).toBe('revoked');
    expect(revoked.revokedAt).toBe(harness.now());
    expect(harness.service.resolve(issued.secret)).toBeNull();
  });

  test('rotates atomically and invalidates both the old credential and authority reference', () => {
    const harness = createHarness();
    harness.insertUser('member');
    const session = applicationSession('member');
    const issued = harness.service.issueSelf(operation(session), { label: 'Original' });
    const admitted = harness.service.resolve(issued.secret)!;
    const reference = harness.service.captureAuthority(admitted)!;

    harness.advance(1);
    const rotated = harness.service.rotateSelf(
      operation(session),
      issued.apiKey.keyId,
      { label: 'Replacement' },
    );

    expect(rotated.secret).not.toBe(issued.secret);
    expect(rotated.apiKey.keyId).not.toBe(issued.apiKey.keyId);
    expect(harness.store.getById(rotated.apiKey.keyId)?.rotatedFromKeyId)
      .toBe(issued.apiKey.keyId);
    expect(harness.service.resolve(issued.secret)).toBeNull();
    expect(harness.service.resolveAuthority(reference)).toBeNull();
    expect(harness.service.resolve(rotated.secret)?.credentialId)
      .toBe(rotated.apiKey.keyId);
  });

  test('rejects authority captured or resolved across an installed-profile transition', () => {
    let transitionArmed = false;
    let profileCurrent = true;
    let profileChecks = 0;
    const harness = createHarness({
      assertCurrentProfile() {
        if (!transitionArmed) return;
        if (!profileCurrent) {
          throw new AuthError('Profile changed', 'AUTH_PROFILE_CHANGED', 503);
        }
        profileChecks += 1;
        if (profileChecks === 1) profileCurrent = false;
      },
    });
    harness.insertUser('member');
    const session = applicationSession('member');
    const issued = harness.service.issueSelf(operation(session), { label: 'Worker' });
    const admitted = harness.service.resolve(issued.secret)!;
    const reference = harness.service.captureAuthority(admitted)!;

    transitionArmed = true;
    profileChecks = 0;
    profileCurrent = true;
    expect(() => harness.service.captureAuthority(admitted)).toThrow(
      expect.objectContaining({ code: 'AUTH_PROFILE_CHANGED', status: 503 }),
    );

    profileChecks = 0;
    profileCurrent = true;
    expect(() => harness.service.resolveAuthority(reference)).toThrow(
      expect.objectContaining({ code: 'AUTH_PROFILE_CHANGED', status: 503 }),
    );
  });

  test('invalidates a key when the user security generation changes', () => {
    const harness = createHarness();
    harness.insertUser('member');
    const session = applicationSession('member');
    const issued = harness.service.issueSelf(operation(session), { label: 'Before reset' });

    harness.users.revokeAllUserTokens('member');

    expect(harness.service.resolve(issued.secret)).toBeNull();
    expect(harness.service.listSelf(session).apiKeys[0]?.status).toBe('invalidated');
  });

  test('enforces the active-key limit and releases capacity after revocation', () => {
    const harness = createHarness({ maxActivePerUser: 1 });
    harness.insertUser('member');
    const session = applicationSession('member');
    const first = harness.service.issueSelf(operation(session), { label: 'Only key' });

    expectAuthError(
      () => harness.service.issueSelf(operation(session), { label: 'Too many' }),
      'AUTH_API_KEY_LIMIT_REACHED',
      409,
    );

    harness.service.revokeSelf(operation(session), first.apiKey.keyId);
    expect(harness.service.issueSelf(operation(session), { label: 'Capacity reused' })
      .apiKey.status).toBe('active');
  });

  test('keeps management session-only', () => {
    const harness = createHarness();
    harness.insertUser('member');
    const session = applicationSession('member');
    const issued = harness.service.issueSelf(operation(session), { label: 'Workload' });
    const apiKeyAuth = harness.service.resolve(issued.secret)!;

    expectAuthError(
      () => harness.service.listSelf(apiKeyAuth),
      'FORBIDDEN',
      403,
    );
    expectAuthError(
      () => harness.service.revokeSelf(operation(apiKeyAuth), issued.apiKey.keyId),
      'FORBIDDEN',
      403,
    );
  });

  test('gates only administrator issue and rotate while retaining inactive-target list and revoke', () => {
    const harness = createHarness({ administratorIssuance: false });
    harness.insertUser('admin', 'admin');
    harness.insertUser('target');
    const admin = applicationSession('admin', 'admin');
    const target = applicationSession('target');
    const first = harness.service.issueSelf(operation(target), { label: 'List me' });
    harness.advance(1);
    const second = harness.service.issueSelf(operation(target), { label: 'Revoke me' });

    const listed = harness.service.listForAdministrator(admin, { userId: 'target' });
    expect(listed.apiKeys).toHaveLength(2);
    expect(listed.capabilities).toEqual({
      canIssue: false,
      canRotate: false,
      canRevoke: true,
    });
    expectAuthError(
      () => harness.service.issueForAdministrator(
        operation(admin),
        { userId: 'target' },
        { label: 'Blocked issue' },
      ),
      'AUTH_API_KEYS_UNAVAILABLE',
      404,
    );
    expectAuthError(
      () => harness.service.rotateForAdministrator(
        operation(admin),
        first.apiKey.keyId,
        { label: 'Blocked rotate' },
      ),
      'AUTH_API_KEYS_UNAVAILABLE',
      404,
    );

    harness.db.prepare("UPDATE users SET status = 'suspended' WHERE user_id = ?")
      .run('target');
    const inactive = harness.service.listForAdministrator(admin, { userId: 'target' });
    expect(inactive.apiKeys.map((key) => key.status)).toEqual([
      'unavailable',
      'unavailable',
    ]);
    expect(inactive.capabilities).toEqual({
      canIssue: false,
      canRotate: false,
      canRevoke: true,
    });
    expect(harness.service.revokeForAdministrator(
      operation(admin),
      second.apiKey.keyId,
    ).status).toBe('revoked');
  });

  test('binds a multi/simple key to the exact organization membership', () => {
    const harness = createHarness({ tenancy: 'multi' });
    harness.insertUser('owner');
    const first = harness.tenancy!.createTenant({
      slug: 'first-org',
      name: 'First Org',
      ownerUserId: 'owner',
    });
    const second = harness.tenancy!.createTenant({
      slug: 'second-org',
      name: 'Second Org',
      ownerUserId: 'owner',
    });
    const firstSession = tenantSession(first, 'owner');
    const secondSession = tenantSession(second, 'owner');

    const issued = harness.service.issueSelf(operation(firstSession), {
      label: 'First org automation',
    });
    const resolved = harness.service.resolve(issued.secret);

    expect(issued.apiKey).toMatchObject({
      userId: 'owner',
      scopeKind: 'tenant',
      scopeId: first.tenant.tenantId,
      tenantId: first.tenant.tenantId,
      membershipId: first.ownerMembership.membershipId,
    });
    expect(resolved).toMatchObject({
      userId: 'owner',
      credentialKind: 'api-key',
      tenantId: first.tenant.tenantId,
      membershipId: first.ownerMembership.membershipId,
      tenantKind: 'organization',
      tenantRole: 'owner',
    });
    const secondPage = harness.service.listSelf(secondSession);
    expect(secondPage.apiKeys).toEqual([]);
    expect(secondPage.capabilities).toEqual({
      canIssue: true,
      canRotate: true,
      canRevoke: true,
    });
  });
});

interface ApiKeyHarness {
  readonly db: ReactiveDB;
  readonly store: AuthApiKeyStore;
  readonly users: UserStore;
  readonly tenancy: TenancyService | null;
  readonly service: AuthApiKeyService;
  readonly now: () => number;
  readonly advance: (milliseconds: number) => void;
  readonly insertUser: (userId: string, role?: string) => void;
}

function createHarness(options: {
  tenancy?: AuthTenancyMode;
  administratorIssuance?: boolean;
  maxActivePerUser?: number;
  assertCurrentProfile?: () => void;
} = {}): ApiKeyHarness {
  const tenancyMode = options.tenancy ?? 'single';
  const config = resolveAuthBehaviorConfig({
    tenancy: tenancyMode,
    authorization: 'simple',
    apiKeys: {
      enabled: true,
      selfService: true,
      administratorIssuance: options.administratorIssuance ?? false,
      defaultTTL: '1h',
      maxTTL: '7d',
      maxActivePerUser: options.maxActivePerUser ?? 10,
    },
  });
  const db = createReactiveDB({ mode: 'memory' });
  databases.push(db);
  db.exec('PRAGMA foreign_keys = ON');
  defineAuthTables(db);
  const users = new UserStore(db, { tenancyMode });
  const tenancy = tenancyMode === 'multi'
    ? new TenancyService(new TenantStore(db))
    : null;
  const store = new AuthApiKeyStore(db);
  let currentTime = 1_700_000_000_000;
  const now = () => currentTime;
  const service = new AuthApiKeyService({
    config: config.apiKeys,
    store,
    users,
    tenancy,
    authorization: new AuthorizationKernel(config),
    roles: null,
    audit: new AuthAuditService(db, config.audit),
    emitCode: emitPlatformCode,
    now,
    assertCurrentProfile: options.assertCurrentProfile,
  });

  return {
    db,
    store,
    users,
    tenancy,
    service,
    now,
    advance(milliseconds) {
      currentTime += milliseconds;
    },
    insertUser(userId, role = 'user') {
      db.prepare(`
        INSERT INTO users (
          user_id, username, email, role, status,
          password_change_required, email_verification_required, mfa_required,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'active', 0, 0, 0, ?, NULL)
      `).run(userId, userId, `${userId}@example.test`, role, currentTime);
    },
  };
}

function applicationSession(userId: string, role = 'user'): AuthContext {
  return Object.freeze({
    userId,
    email: `${userId}@example.test`,
    role,
    credentialKind: 'session',
    authGeneration: 0,
    sessionScopeKind: 'application',
    sessionScopeId: 'application',
  });
}

function tenantSession(
  creation: ReturnType<TenancyService['createTenant']>,
  userId: string,
): AuthContext {
  return Object.freeze({
    userId,
    email: `${userId}@example.test`,
    role: 'user',
    credentialKind: 'session',
    authGeneration: 0,
    sessionScopeKind: 'tenant',
    sessionScopeId: creation.tenant.tenantId,
    tenantId: creation.tenant.tenantId,
    membershipId: creation.ownerMembership.membershipId,
    tenantKind: creation.tenant.kind,
    tenantRole: creation.ownerMembership.roleKey,
    tenantAuthorizationGeneration: creation.tenant.authorizationGeneration,
    membershipAuthorizationGeneration:
      creation.ownerMembership.authorizationGeneration,
  });
}

function operation(auth: AuthContext): AuthApiKeyMutationAuthority {
  return Object.freeze({ auth, assertCurrent: () => auth });
}

function expectAuthError(
  operationUnderTest: () => unknown,
  code: string,
  status: number,
): void {
  try {
    operationUnderTest();
    throw new Error(`Expected AuthError ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(AuthError);
    expect(error).toMatchObject({ code, status });
  }
}

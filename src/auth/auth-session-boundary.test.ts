import { afterEach, describe, expect, test } from 'bun:test';
import { SignJWT } from 'jose';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { loadOrCreateAuthSigningKeys } from './auth-signing-keys';
import { defineAuthTables } from './auth-schema';
import { defineAuthSessionTables } from './auth-session-schema';
import { AuthSessionService } from './auth-session-service';
import { AuthSessionStore } from './auth-session-store';
import { TokenService } from './token-service';
import { TenancyService } from './tenancy/tenancy-service';
import { TenantStore } from './tenancy/tenant-store';
import type { UserRecord } from './types';
import { UserStore } from './user-store';

interface Harness {
  db: ReactiveDB;
  users: UserStore;
  sessions: AuthSessionService;
  tenancy: TenancyService | null;
  tokens: TokenService;
}

const databases: ReactiveDB[] = [];

afterEach(() => {
  for (const db of databases.splice(0).reverse()) db.dispose();
});

describe('durable browser session boundary', () => {
  test('adds a nullable parent link without rewriting legacy refresh rows', () => {
    const db = createReactiveDB({ mode: 'memory' });
    databases.push(db);
    db.exec(`
      CREATE TABLE users (user_id TEXT PRIMARY KEY);
      CREATE TABLE _refresh_tokens (
        token_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        revoked_at INTEGER,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
      );
      INSERT INTO users (user_id) VALUES ('legacy-user');
      INSERT INTO _refresh_tokens (
        token_id, user_id, token_hash, expires_at, created_at, revoked_at
      ) VALUES ('legacy-token', 'legacy-user', 'legacy-hash', 2000000000000, 1, NULL);
    `);

    defineAuthSessionTables(db);

    const sessionColumn = (db.prepare('PRAGMA table_info(_refresh_tokens)').all() as Array<{
      name: string;
      notnull: number;
    }>).find((column) => column.name === 'session_id');
    expect(sessionColumn).toMatchObject({ name: 'session_id', notnull: 0 });
    expect(db.prepare(
      'SELECT token_id, session_id FROM _refresh_tokens WHERE token_id = ?',
    ).get('legacy-token')).toEqual({ token_id: 'legacy-token', session_id: null });
    expect((db.prepare('PRAGMA foreign_key_list(_refresh_tokens)').all() as Array<{
      table: string;
      from: string;
      on_delete: string;
    }>).some((foreignKey) => foreignKey.table === '_auth_sessions'
      && foreignKey.from === 'session_id'
      && foreignKey.on_delete === 'CASCADE')).toBe(true);
  });

  test('preserves single-tenant behavior behind an application-scoped parent', async () => {
    const app = await createHarness('single');
    const user = await createUser(app, 'single-user');
    const pair = await app.tokens.issueTokenPair(user);
    const payload = await app.tokens.verifyAccessToken(pair.accessToken);
    const context = await app.tokens.resolveAuthContext(pair.accessToken);
    const refresh = app.users.getRefreshTokenByHash(hashToken(pair.refreshToken));

    expect(payload).toMatchObject({
      sub: user.userId,
      sessionKind: 'web',
      sessionGeneration: 0,
    });
    expect(payload?.sessionId).toStartWith('ses_');
    expect(refresh?.sessionId).toBe(payload?.sessionId);
    expect(context).toMatchObject({
      userId: user.userId,
      sessionKind: 'web',
      sessionId: payload?.sessionId,
      sessionGeneration: 0,
      sessionScopeKind: 'application',
      sessionScopeId: 'application',
    });
    expect(context).not.toHaveProperty('tenantId');
  });

  test('lets pre-boundary single access finish its TTL but rejects it in multi mode', async () => {
    const single = await createHarness('single');
    const singleUser = await createUser(single, 'legacy-access-single');
    const legacySingleAccess = await single.tokens.signAccessToken(singleUser);
    const upgradedSingleTokens = await TokenService.create({
      db: single.db,
      authSessionService: single.sessions,
    });
    upgradedSingleTokens.setUserStore(single.users);

    await expect(upgradedSingleTokens.resolveAuthContext(legacySingleAccess)).resolves.toEqual({
      userId: singleUser.userId,
      email: singleUser.email,
      role: singleUser.role,
      authGeneration: 0,
    });

    const multi = await createHarness('multi');
    const multiUser = await createUser(multi, 'legacy-access-multi');
    multi.tenancy!.createTenant({
      slug: 'legacy-access-multi',
      name: 'Legacy Access Multi',
      ownerUserId: multiUser.userId,
    });
    const legacyMultiAccess = await multi.tokens.signAccessToken(multiUser);
    const upgradedMultiTokens = await TokenService.create({
      db: multi.db,
      authSessionService: multi.sessions,
    });
    upgradedMultiTokens.setUserStore(multi.users);

    await expect(upgradedMultiTokens.resolveAuthContext(legacyMultiAccess)).resolves.toBeNull();
  });

  test('adopts live legacy single-mode refresh and existing page credentials atomically', async () => {
    const app = await createHarness('single');
    const user = await createUser(app, 'legacy-user');
    // Prove that a missing legacy claim is not being treated as generation 0.
    app.users.revokeAllUserTokens(user.userId);
    expect(app.users.getAuthGeneration(user.userId)).toBe(1);
    const rawRefresh = crypto.randomUUID();
    app.users.storeRefreshToken(
      'legacy-refresh',
      user.userId,
      hashToken(rawRefresh),
      Date.now() + 86_400_000,
    );
    const keys = await loadOrCreateAuthSigningKeys({ db: app.db });
    const legacyPageToken = await new SignJWT({ sid: 'legacy-refresh' })
      .setProtectedHeader({ alg: 'ES256', kid: keys.keyId })
      .setSubject(user.userId)
      .setIssuedAt()
      .setExpirationTime('1h')
      .setIssuer('auth-page-session')
      .sign(keys.privateKey);

    await expect(app.tokens.resolvePageSessionToken(legacyPageToken)).resolves.toMatchObject({
      userId: user.userId,
      authGeneration: 1,
      sessionKind: 'web',
      sessionScopeKind: 'application',
    });
    const adopted = app.users.getRefreshTokenById('legacy-refresh');
    expect(adopted?.sessionId).toStartWith('ses_');
    expect(app.sessions.store.getById(adopted!.sessionId!)).toMatchObject({
      userId: user.userId,
      scopeKind: 'application',
      scopeId: 'application',
      provenance: 'local',
    });

    app.users.revokeAllUserTokens(user.userId);
    expect(app.users.getRefreshTokenById('legacy-refresh')?.revokedAt).toBeNumber();
    await expect(app.tokens.resolvePageSessionToken(legacyPageToken)).resolves.toBeNull();
  });

  test('does not adopt an unbound legacy refresh row in multi-tenant mode', async () => {
    const app = await createHarness('multi');
    const user = await createUser(app, 'legacy-multi-user');
    const tenant = app.tenancy!.createTenant({
      slug: 'legacy-multi',
      name: 'Legacy Multi',
      ownerUserId: user.userId,
    });
    expect(tenant.ownerMembership.status).toBe('active');
    const rawRefresh = crypto.randomUUID();
    app.users.storeRefreshToken(
      'legacy-multi-refresh',
      user.userId,
      hashToken(rawRefresh),
      Date.now() + 86_400_000,
    );

    await expect(app.tokens.issuePageSessionToken(rawRefresh)).resolves.toBeNull();
    await expect(app.tokens.rotateRefreshToken(rawRefresh)).resolves.toBeNull();
    expect(app.users.getRefreshTokenById('legacy-multi-refresh')?.sessionId).toBeNull();
    expect(app.db.prepare('SELECT COUNT(*) AS count FROM _auth_sessions').get())
      .toEqual({ count: 0 });
  });

  test('hydrates valid multi-tenant access and page contexts from live authority', async () => {
    const app = await createHarness('multi');
    const user = await createUser(app, 'tenant-user');
    const created = app.tenancy!.createTenant({
      slug: 'valid-tenant',
      name: 'Valid Tenant',
      ownerUserId: user.userId,
    });
    const pair = await app.tokens.issueTokenPair(user);
    const page = await app.tokens.issuePageSessionToken(pair.refreshToken);

    const expected = {
      userId: user.userId,
      sessionKind: 'web',
      sessionScopeKind: 'tenant',
      sessionScopeId: created.tenant.tenantId,
      tenantId: created.tenant.tenantId,
      membershipId: created.ownerMembership.membershipId,
      tenantRole: 'owner',
      tenantAuthorizationGeneration: 0,
      membershipAuthorizationGeneration: 0,
    } as const;
    await expect(app.tokens.resolveAuthContext(pair.accessToken)).resolves.toMatchObject(expected);
    await expect(app.tokens.resolvePageSessionToken(page!.token)).resolves.toMatchObject(expected);
  });

  test('denies wrong-user, mismatched, absent, and ambiguous tenant bindings', async () => {
    const app = await createHarness('multi');
    const userA = await createUser(app, 'binding-a');
    const userB = await createUser(app, 'binding-b');
    const tenantA = app.tenancy!.createTenant({
      slug: 'binding-a', name: 'Binding A', ownerUserId: userA.userId,
    });
    const tenantB = app.tenancy!.createTenant({
      slug: 'binding-b', name: 'Binding B', ownerUserId: userB.userId,
    });
    const noMembership = await createUser(app, 'binding-none');

    await expect(app.tokens.issueTokenPair(userA, { binding: {
      tenantId: tenantB.tenant.tenantId,
      membershipId: tenantA.ownerMembership.membershipId,
    } })).rejects.toMatchObject({ code: 'INVALID_TENANT_SESSION_BINDING' });
    await expect(app.tokens.issueTokenPair(userA, { binding: {
      tenantId: tenantB.tenant.tenantId,
      membershipId: tenantB.ownerMembership.membershipId,
    } })).rejects.toMatchObject({ code: 'INVALID_TENANT_SESSION_BINDING' });
    await expect(app.tokens.issueTokenPair(noMembership)).rejects.toMatchObject({
      code: 'TENANT_MEMBERSHIP_REQUIRED',
    });

    app.tenancy!.addMembership({
      tenantId: tenantB.tenant.tenantId,
      userId: userA.userId,
      roleKey: 'member',
      createdBy: userB.userId,
    });
    await expect(app.tokens.issueTokenPair(userA)).rejects.toMatchObject({
      code: 'TENANT_SELECTION_REQUIRED',
    });
  });

  test('rolls back parent and refresh issuance when tenant authority changes during signing', async () => {
    const app = await createHarness('multi');
    const user = await createUser(app, 'issuance-race');
    const created = app.tenancy!.createTenant({
      slug: 'issuance-race', name: 'Issuance Race', ownerUserId: user.userId,
    });
    const originalSign = app.tokens.signAccessToken.bind(app.tokens);
    app.tokens.signAccessToken = async (subject, generation, session) => {
      app.tenancy!.bumpTenantAuthorizationGeneration(created.tenant.tenantId);
      return originalSign(subject, generation, session);
    };

    try {
      await expect(app.tokens.issueTokenPair(user, { binding: {
        tenantId: created.tenant.tenantId,
        membershipId: created.ownerMembership.membershipId,
      } })).rejects.toMatchObject({ code: 'AUTH_STATE_CHANGED' });
    } finally {
      app.tokens.signAccessToken = originalSign;
    }
    expect(app.db.prepare('SELECT COUNT(*) AS count FROM _auth_sessions').get())
      .toEqual({ count: 0 });
    expect(app.db.prepare('SELECT COUNT(*) AS count FROM _refresh_tokens').get())
      .toEqual({ count: 0 });
  });

  test('rejects Promise admission and replacement hooks without rotating web authority', async () => {
    const app = await createHarness('multi');
    const user = await createUser(app, 'async-web-authority');
    const created = app.tenancy!.createTenant({
      slug: 'async-web-authority',
      name: 'Async Web Authority',
      ownerUserId: user.userId,
    });
    const binding = {
      tenantId: created.tenant.tenantId,
      membershipId: created.ownerMembership.membershipId,
    };
    const asyncFalse = (async () => false) as unknown as () => boolean;

    await expect(app.tokens.issueTokenPairAfterAdmission(
      user,
      { binding },
      asyncFalse,
    )).rejects.toMatchObject({
      code: 'AUTH_STATE_INVARIANT_FAILED',
      message: '[auth] Web session issuance admission must be synchronous.',
    });
    expect(app.db.prepare('SELECT COUNT(*) AS count FROM _auth_sessions').get())
      .toEqual({ count: 0 });
    expect(app.db.prepare('SELECT COUNT(*) AS count FROM _refresh_tokens').get())
      .toEqual({ count: 0 });

    const pair = await app.tokens.issueTokenPair(user, { binding });
    await expect(app.tokens.replaceWebSession(
      pair.refreshToken,
      binding,
      asyncFalse,
    )).rejects.toMatchObject({
      code: 'AUTH_STATE_INVARIANT_FAILED',
      message: '[auth] Web session replacement admission must be synchronous.',
    });
    await expect(app.tokens.replaceWebSession(
      pair.refreshToken,
      binding,
      () => true,
      async () => {},
    )).rejects.toMatchObject({
      code: 'AUTH_STATE_INVARIANT_FAILED',
      message: '[auth] Web session replacement callback must be synchronous.',
    });

    expect(app.tokens.resolveWebRefreshProof(pair.refreshToken)).toMatchObject({
      user: { userId: user.userId },
      record: { revokedAt: null },
      session: { status: 'active' },
    });
    expect(app.db.prepare('SELECT COUNT(*) AS count FROM _auth_sessions').get())
      .toEqual({ count: 1 });
    expect(app.db.prepare('SELECT COUNT(*) AS count FROM _refresh_tokens').get())
      .toEqual({ count: 1 });
  });

  test('rejects Promise callbacks at direct session and refresh-store boundaries', async () => {
    const app = await createHarness('single');
    const user = await createUser(app, 'direct-async-session');
    const asyncTrue = (async () => true) as unknown as () => boolean;
    const asyncFalse = (async () => false) as unknown as () => boolean;

    const denied = app.sessions.prepareWebSession({
      userId: user.userId,
      expiresAt: Date.now() + 60_000,
    });
    expect(() => app.sessions.persistPreparedWebSession(
      denied,
      () => true,
      asyncFalse,
    )).toThrow(expect.objectContaining({
      code: 'AUTH_STATE_INVARIANT_FAILED',
      message: '[auth] Web session admission must be synchronous.',
    }));

    const orphan = app.sessions.prepareWebSession({
      userId: user.userId,
      expiresAt: Date.now() + 60_000,
    });
    expect(() => app.sessions.persistPreparedWebSession(
      orphan,
      asyncTrue,
    )).toThrow(expect.objectContaining({
      code: 'AUTH_STATE_INVARIANT_FAILED',
      message: '[auth] Refresh persistence callback must be synchronous.',
    }));
    expect(app.db.prepare('SELECT COUNT(*) AS count FROM _auth_sessions').get())
      .toEqual({ count: 0 });

    const pair = await app.tokens.issueTokenPair(user);
    const proof = app.tokens.resolveWebRefreshProof(pair.refreshToken)!;
    app.db.exec('CREATE TABLE session_callback_probe (value TEXT PRIMARY KEY)');
    expect(() => app.sessions.withActiveWebSession({
      sessionId: proof.session.sessionId,
      userId: user.userId,
      generation: proof.session.generation,
    }, Date.now() + 60_000, (async () => {
      app.db.prepare('INSERT INTO session_callback_probe (value) VALUES (?)').run('unsafe');
      return true;
    }) as never)).toThrow(expect.objectContaining({
      code: 'AUTH_STATE_INVARIANT_FAILED',
      message: '[auth] Active web session operation must be synchronous.',
    }));
    expect(app.db.prepare('SELECT COUNT(*) AS count FROM session_callback_probe').get())
      .toEqual({ count: 0 });

    expect(() => app.users.replaceRefreshSessionAtomically(
      proof.record,
      {
        tokenId: 'async-parent-replacement',
        tokenHash: 'async-parent-replacement-hash',
        expiresAt: Date.now() + 60_000,
        createdAt: Date.now(),
      },
      'async-parent-session',
      app.users.getAuthGeneration(user.userId),
      asyncFalse,
    )).toThrow(expect.objectContaining({
      code: 'AUTH_STATE_INVARIANT_FAILED',
      message: '[auth] Refresh parent replacement must be synchronous.',
    }));
    expect(app.users.getRefreshTokenByHash(hashToken(pair.refreshToken))?.revokedAt).toBeNull();
    expect(app.users.getRefreshTokenById('async-parent-replacement')).toBeNull();

    app.sessions.setMfaAssuranceValidator(asyncFalse);
    expect(() => app.sessions.resolveWebSession({
      sessionId: proof.session.sessionId,
      userId: user.userId,
      generation: proof.session.generation,
    })).toThrow(expect.objectContaining({
      code: 'AUTH_STATE_INVARIANT_FAILED',
      message: '[auth] MFA assurance validation must be synchronous.',
    }));
  });

  test('rejects async authorization resolvers and public runtime profile guards', async () => {
    const app = await createHarness('single');
    const user = await createUser(app, 'async-runtime-guards');
    const pair = await app.tokens.issueTokenPair(user);

    app.tokens.setAuthorizationRevisionResolver(
      (async () => 'revision') as unknown as () => string,
    );
    await expect(app.tokens.resolveAuthContext(pair.accessToken)).rejects.toMatchObject({
      code: 'AUTH_STATE_INVARIANT_FAILED',
      message: '[auth] Authorization revision resolution must be synchronous.',
    });
    app.tokens.setAuthorizationRevisionResolver(() => null);

    app.users.setRuntimeProfileGuard(async () => {});
    expect(() => app.users.getUserById(user.userId)).toThrow(expect.objectContaining({
      code: 'AUTH_STATE_INVARIANT_FAILED',
      message: '[auth] User runtime profile guard must be synchronous.',
    }));
    app.users.setRuntimeProfileGuard(() => {});

    app.sessions.setRuntimeProfileGuard(async () => {});
    expect(() => app.sessions.resolveWebSession({
      sessionId: app.tokens.resolveWebRefreshProof(pair.refreshToken)!.session.sessionId,
      userId: user.userId,
    })).toThrow(expect.objectContaining({
      code: 'AUTH_STATE_INVARIANT_FAILED',
      message: '[auth] Session runtime profile guard must be synchronous.',
    }));
    app.sessions.setRuntimeProfileGuard(() => {});

    app.tokens.setRuntimeProfileGuard(async () => {});
    expect(() => app.tokens.getAuthorityRevision()).toThrow(expect.objectContaining({
      code: 'AUTH_STATE_INVARIANT_FAILED',
      message: '[auth] Token runtime profile guard must be synchronous.',
    }));
  });

  for (const invalidation of [
    'tenant suspension',
    'tenant generation',
    'membership suspension',
    'membership generation',
    'membership role change',
  ] as const) {
    test(`${invalidation} immediately invalidates access, page, and refresh`, async () => {
      const app = await createHarness('multi');
      const suffix = invalidation.replaceAll(' ', '-');
      const user = await createUser(app, `invalidate-${suffix}`);
      const backup = await createUser(app, `backup-${suffix}`);
      const created = app.tenancy!.createTenant({
        slug: `invalidate-${suffix}`,
        name: `Invalidate ${invalidation}`,
        ownerUserId: user.userId,
      });
      app.tenancy!.addMembership({
        tenantId: created.tenant.tenantId,
        userId: backup.userId,
        roleKey: 'owner',
        createdBy: user.userId,
      });
      const pair = await app.tokens.issueTokenPair(user, { binding: {
        tenantId: created.tenant.tenantId,
        membershipId: created.ownerMembership.membershipId,
      } });
      const page = await app.tokens.issuePageSessionToken(pair.refreshToken);

      switch (invalidation) {
        case 'tenant suspension':
          app.tenancy!.suspendTenant(created.tenant.tenantId);
          break;
        case 'tenant generation':
          app.tenancy!.bumpTenantAuthorizationGeneration(created.tenant.tenantId);
          break;
        case 'membership suspension':
          app.tenancy!.suspendMembership(created.ownerMembership.membershipId);
          break;
        case 'membership generation':
          app.tenancy!.bumpMembershipAuthorizationGeneration(
            created.ownerMembership.membershipId,
          );
          break;
        case 'membership role change':
          app.tenancy!.updateMembershipRole(
            created.ownerMembership.membershipId,
            'member',
          );
          break;
      }

      await expect(app.tokens.resolveAuthContext(pair.accessToken)).resolves.toBeNull();
      await expect(app.tokens.resolvePageSessionToken(page!.token)).resolves.toBeNull();
      await expect(app.tokens.rotateRefreshToken(pair.refreshToken)).resolves.toBeNull();
    });
  }

  test('rotation retains the parent sid and logout revokes old access immediately', async () => {
    const app = await createHarness('single');
    const user = await createUser(app, 'rotation-user');
    const original = await app.tokens.issueTokenPair(user);
    const originalPayload = await app.tokens.verifyAccessToken(original.accessToken);
    const rotated = await app.tokens.rotateRefreshToken(original.refreshToken);
    const rotatedPayload = await app.tokens.verifyAccessToken(rotated!.accessToken);

    expect(rotatedPayload?.sessionId).toBe(originalPayload?.sessionId);
    expect(app.sessions.store.getById(originalPayload!.sessionId!)).toMatchObject({
      status: 'active',
      generation: 0,
    });
    expect(app.tokens.revokeRefreshTokenByRaw(rotated!.refreshToken)).toBe(true);
    await expect(app.tokens.resolveAuthContext(original.accessToken)).resolves.toBeNull();
    await expect(app.tokens.resolveAuthContext(rotated!.accessToken)).resolves.toBeNull();
    expect(app.sessions.store.getById(originalPayload!.sessionId!)).toMatchObject({
      status: 'revoked',
      generation: 1,
      revocationReason: 'logout',
    });
  });

  test('parent expiry fails closed and cleanup cascades its refresh child', async () => {
    const app = await createHarness('single');
    const user = await createUser(app, 'expired-parent');
    const pair = await app.tokens.issueTokenPair(user);
    const page = await app.tokens.issuePageSessionToken(pair.refreshToken);
    const refresh = app.users.getRefreshTokenByHash(hashToken(pair.refreshToken))!;
    app.db.prepare('UPDATE _auth_sessions SET expires_at = ? WHERE session_id = ?')
      .run(Date.now() - 1_000, refresh.sessionId!);

    await expect(app.tokens.resolveAuthContext(pair.accessToken)).resolves.toBeNull();
    await expect(app.tokens.resolvePageSessionToken(page!.token)).resolves.toBeNull();
    await expect(app.tokens.rotateRefreshToken(pair.refreshToken)).resolves.toBeNull();

    app.users.deleteExpiredTokens();
    expect(app.sessions.store.getById(refresh.sessionId!)).toBeNull();
    expect(app.users.getRefreshTokenById(refresh.tokenId)).toBeNull();
  });

  test('replay and account-security invalidation revoke every affected parent', async () => {
    const app = await createHarness('single');
    const user = await createUser(app, 'security-invalidation');
    const replayed = await app.tokens.issueTokenPair(user);
    const sibling = await app.tokens.issueTokenPair(user);
    const replayedSid = (await app.tokens.verifyAccessToken(
      replayed.accessToken,
    ))!.sessionId!;
    const siblingSid = (await app.tokens.verifyAccessToken(
      sibling.accessToken,
    ))!.sessionId!;

    expect(await app.tokens.rotateRefreshToken(replayed.refreshToken)).not.toBeNull();
    await expect(app.tokens.rotateRefreshToken(replayed.refreshToken)).resolves.toBeNull();
    expect(app.sessions.store.getById(replayedSid)).toMatchObject({
      status: 'revoked', revocationReason: 'refresh-replay',
    });
    expect(app.sessions.store.getById(siblingSid)).toMatchObject({
      status: 'revoked', revocationReason: 'refresh-replay',
    });

    const replacementUser = app.users.getUserById(user.userId)!;
    const security = await app.tokens.issueTokenPair(replacementUser);
    const securitySid = (await app.tokens.verifyAccessToken(
      security.accessToken,
    ))!.sessionId!;
    app.users.revokeAllUserTokens(user.userId);
    expect(app.sessions.store.getById(securitySid)).toMatchObject({
      status: 'revoked', revocationReason: 'security-state-changed',
    });
    await expect(app.tokens.resolveAuthContext(security.accessToken)).resolves.toBeNull();
  });

  test('keeps durable parents isolated across app-local databases', async () => {
    const appA = await createHarness('single');
    const appB = await createHarness('single');
    const userA = await createUser(appA, 'isolated-a');
    const userB = await createUser(appB, 'isolated-b');
    const pairA = await appA.tokens.issueTokenPair(userA);
    const pairB = await appB.tokens.issueTokenPair(userB);
    const sidA = (await appA.tokens.verifyAccessToken(pairA.accessToken))!.sessionId!;
    const sidB = (await appB.tokens.verifyAccessToken(pairB.accessToken))!.sessionId!;

    expect(appA.sessions).not.toBe(appB.sessions);
    expect(appA.sessions.store.getById(sidA)).not.toBeNull();
    expect(appB.sessions.store.getById(sidA)).toBeNull();
    appA.tokens.revokeRefreshTokenByRaw(pairA.refreshToken);
    await expect(appA.tokens.resolveAuthContext(pairA.accessToken)).resolves.toBeNull();
    await expect(appB.tokens.resolveAuthContext(pairB.accessToken)).resolves.toMatchObject({
      sessionId: sidB,
      userId: userB.userId,
    });
  }, 60_000);
});

async function createHarness(mode: 'single' | 'multi'): Promise<Harness> {
  const db = createReactiveDB({ mode: 'memory' });
  databases.push(db);
  db.exec('PRAGMA foreign_keys = ON');
  defineAuthTables(db);
  const users = new UserStore(db);
  const tenancy = mode === 'multi'
    ? new TenancyService(new TenantStore(db))
    : null;
  const sessions = new AuthSessionService(
    new AuthSessionStore(db),
    mode,
    tenancy,
  );
  const tokens = await TokenService.create({ db, authSessionService: sessions });
  tokens.setUserStore(users);
  return { db, users, sessions, tenancy, tokens };
}

async function createUser(app: Harness, key: string): Promise<UserRecord> {
  return app.users.createUser({
    username: key,
    email: `${key}@example.test`,
    password: 'password123',
  });
}

function hashToken(token: string): string {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(token);
  return hasher.digest('hex');
}

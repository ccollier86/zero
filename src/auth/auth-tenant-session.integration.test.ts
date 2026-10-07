import { afterEach, describe, expect, test } from 'bun:test';
import { Elysia, type AnyElysia } from 'elysia';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import type { AuthRuntime } from './auth-runtime';
import { AuthSessionContinuationStore } from './auth-session-continuation-store';
import { createAuthPlugin } from './auth.plugin';
import { generateTotpCode } from './mfa-totp';
import { PAGE_SESSION_COOKIE_NAME } from './page-session';
import type { UserRecord } from './types';

interface Harness {
  app: AnyElysia;
  db: ReactiveDB;
  runtime: AuthRuntime;
  url: string;
}

interface JsonResponse {
  status: number;
  body: Record<string, any>;
  headers: Headers;
}

const active: Harness[] = [];

afterEach(async () => {
  for (const harness of active.splice(0).reverse()) {
    await harness.app.stop();
    harness.db.dispose();
  }
});

async function start(options: {
  mfa?: boolean;
  mfaPolicy?: 'required' | 'admin-required';
} = {}): Promise<Harness> {
  const db = createReactiveDB({ mode: 'memory' });
  let runtime: AuthRuntime | null = null;
  const app = new Elysia().use(createAuthPlugin({
    db,
    tenancy: 'multi',
    bootstrap: 'public',
    registration: { mode: 'public' },
    ...(options.mfa || options.mfaPolicy ? {
      mfa: {
        enabled: true,
        policy: options.mfaPolicy ?? 'required',
        methods: ['totp' as const],
        totp: {
          issuer: 'Tenant Session Tests',
          encryptionKey: 'tenant-session-test-encryption-key',
        },
      },
    } : {}),
    onRuntimeCreated(created) {
      runtime = created;
    },
  }));
  app.listen(0);
  const createdRuntime = runtime as AuthRuntime | null;
  if (!createdRuntime) throw new Error('Auth runtime was not created');
  const harness = {
    app,
    db,
    runtime: createdRuntime,
    url: `http://localhost:${app.server!.port}`,
  };
  active.push(harness);
  const deadline = Date.now() + 2_000;
  while (!createdRuntime.getStore() || !createdRuntime.getTokenService()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for auth runtime startup');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return harness;
}

async function post(
  harness: Harness,
  path: string,
  body: Record<string, unknown>,
  cookie?: string,
): Promise<JsonResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(`${harness.url}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, any>,
    headers: response.headers,
  };
}

function register(harness: Harness, key: string) {
  return post(harness, '/auth/register', {
    username: key,
    email: `${key}@example.test`,
    password: 'password123',
    organizationName: `${key} organization`,
  });
}

function login(harness: Harness, key: string, cookie?: string) {
  return post(harness, '/auth/login', {
    username: key,
    password: 'password123',
  }, cookie);
}

function activeSessionCount(db: ReactiveDB): number {
  return (db.prepare(`
    SELECT COUNT(*) AS count FROM _auth_sessions WHERE status = 'active'
  `).get() as { count: number }).count;
}

function activeSessionCountForUser(db: ReactiveDB, userId: string): number {
  return (db.prepare(`
    SELECT COUNT(*) AS count
    FROM _auth_sessions
    WHERE status = 'active' AND user_id = ?
  `).get(userId) as { count: number }).count;
}

function pageToken(headers: Headers): string {
  const setCookie = headers.get('set-cookie') ?? '';
  const match = setCookie.match(new RegExp(`${PAGE_SESSION_COOKIE_NAME}_[a-f0-9]{32}=([^;]*)`));
  if (!match) throw new Error('Expected a page-session cookie');
  return decodeURIComponent(match[1]!);
}

function cookie(token: string, harness: Harness): string {
  return `${harness.runtime.getTokenService()!.pageSessionCookieName}=${encodeURIComponent(token)}`;
}

describe('multi-tenant browser session completion', () => {
  test('does not carry an old-password proof across a committed reset', async () => {
    const harness = await start();
    const registered = await register(harness, 'password-handoff');
    expect(registered.status).toBe(200);
    const store = harness.runtime.getStore()!;
    const originalVerify = store.verifyPasswordForAuthentication.bind(store);
    let markVerified!: () => void;
    let releaseHandoff!: () => void;
    const verified = new Promise<void>((resolve) => { markVerified = resolve; });
    const handoffGate = new Promise<void>((resolve) => { releaseHandoff = resolve; });
    store.verifyPasswordForAuthentication = async (userId, password) => {
      const proof = await originalVerify(userId, password);
      markVerified();
      await handoffGate;
      return proof;
    };

    const pendingLogin = login(harness, 'password-handoff');
    try {
      await verified;
      expect(await store.resetPassword(
        registered.body.user.userId,
        'replacement-password',
      )).toBe(true);
      expect(activeSessionCount(harness.db)).toBe(0);
      releaseHandoff();
      const rejected = await pendingLogin;
      expect(rejected.status).toBe(409);
      expect(rejected.body.code).toBe('AUTH_STATE_CHANGED');
      expect(rejected.body.accessToken).toBeUndefined();
      expect(rejected.body.refreshToken).toBeUndefined();
      expect(activeSessionCount(harness.db)).toBe(0);
    } finally {
      releaseHandoff();
      store.verifyPasswordForAuthentication = originalVerify;
    }

    const replacement = await post(harness, '/auth/login', {
      username: 'password-handoff',
      password: 'replacement-password',
    });
    expect(replacement.status).toBe(200);
    expect(replacement.body.activeTenant).toMatchObject({
      tenantId: registered.body.tenant.tenantId,
    });
  }, 60_000);

  test('does not carry a verified MFA proof across a committed password reset', async () => {
    const harness = await start({ mfa: true });
    const registered = await register(harness, 'mfa-generation-handoff');
    expect(registered.status).toBe(200);
    expect(registered.body.mfaSetupRequired).toBe(true);

    const setup = await post(harness, '/auth/mfa/setup', {
      setupToken: registered.body.mfaSetupToken,
      method: 'totp',
    });
    expect(setup.status).toBe(200);
    const setupCode = generateTotpCode({ secret: setup.body.totp.secret });
    const verifiedSetup = await post(harness, '/auth/mfa/setup/verify', {
      verificationToken: setup.body.verificationToken,
      code: setupCode,
    });
    expect(verifiedSetup.status).toBe(200);

    const challenge = await login(harness, 'mfa-generation-handoff');
    expect(challenge.status).toBe(200);
    expect(challenge.body.mfaChallengeRequired).toBe(true);

    const mfa = harness.runtime.getMfaChallengeService()!;
    const store = harness.runtime.getStore()!;
    const originalVerify = mfa.verifyLoginChallenge.bind(mfa);
    let markVerified!: () => void;
    let releaseHandoff!: () => void;
    const verified = new Promise<void>((resolve) => { markVerified = resolve; });
    const handoffGate = new Promise<void>((resolve) => { releaseHandoff = resolve; });
    mfa.verifyLoginChallenge = async (params) => {
      const method = await originalVerify(params);
      markVerified();
      await handoffGate;
      return method;
    };

    const pendingVerification = post(harness, '/auth/mfa/challenge/verify', {
      challengeToken: challenge.body.mfaChallenge.challengeToken,
      code: generateTotpCode({ secret: setup.body.totp.secret }),
    });
    try {
      await verified;
      expect(await store.resetPassword(
        registered.body.user.userId,
        'replacement-password',
      )).toBe(true);
      expect(activeSessionCount(harness.db)).toBe(0);
      releaseHandoff();

      const rejected = await pendingVerification;
      expect(rejected.status).toBe(409);
      expect(rejected.body.code).toBe('AUTH_STATE_CHANGED');
      expect(rejected.body.accessToken).toBeUndefined();
      expect(rejected.body.refreshToken).toBeUndefined();
      expect(activeSessionCount(harness.db)).toBe(0);
    } finally {
      releaseHandoff();
      mfa.verifyLoginChallenge = originalVerify;
    }

    const replacement = await post(harness, '/auth/login', {
      username: 'mfa-generation-handoff',
      password: 'replacement-password',
    });
    expect(replacement.status).toBe(200);
    expect(replacement.body.mfaChallengeRequired).toBe(true);
  }, 60_000);

  test('returns onboarding for zero memberships, auto-binds one, and selects among many', async () => {
    const harness = await start();
    const store = harness.runtime.getStore()!;
    const tenancy = harness.runtime.getTenancyService()!;
    const tokens = harness.runtime.getTokenService()!;

    const installation = await register(harness, 'installation-owner');
    expect(installation.status).toBe(200);
    await store.createUser({
      username: 'no-tenant',
      email: 'no-tenant@example.test',
      password: 'password123',
    });
    const beforeZero = activeSessionCount(harness.db);
    const zero = await login(harness, 'no-tenant');
    expect(zero.status).toBe(200);
    expect(zero.body).toMatchObject({
      tenantOnboardingRequired: true,
      onboarding: { reason: 'no_active_tenant_membership' },
    });
    expect(zero.body.accessToken).toBeUndefined();
    expect(zero.body.refreshToken).toBeUndefined();
    expect(activeSessionCount(harness.db)).toBe(beforeZero);

    const owner = await register(harness, 'selection-owner');
    expect(owner.status).toBe(200);
    const one = await login(harness, 'selection-owner');
    expect(one.status).toBe(200);
    expect(one.body.activeTenant.tenantId).toBe(owner.body.tenant.tenantId);
    await expect(tokens.resolveAuthContext(one.body.accessToken)).resolves.toMatchObject({
      tenantId: owner.body.tenant.tenantId,
      membershipId: owner.body.tenant.membershipId,
    });

    const other = await register(harness, 'selection-other');
    tenancy.addMembership({
      tenantId: other.body.tenant.tenantId,
      userId: owner.body.user.userId,
      roleKey: 'member',
      createdBy: other.body.user.userId,
    });

    const beforeMany = activeSessionCount(harness.db);
    const many = await login(harness, 'selection-owner');
    expect(many.status).toBe(200);
    expect(many.body.tenantSelectionRequired).toBe(true);
    expect(many.body.tenantSelection.tenants).toEqual(expect.arrayContaining([
      expect.objectContaining({ tenantId: owner.body.tenant.tenantId, role: 'owner' }),
      expect.objectContaining({ tenantId: other.body.tenant.tenantId, role: 'member' }),
    ]));
    expect(many.body.accessToken).toBeUndefined();
    expect(many.body.refreshToken).toBeUndefined();
    expect(activeSessionCount(harness.db)).toBe(beforeMany);

    const raw = many.body.tenantSelection.continuation as string;
    const persisted = harness.db.prepare(`
      SELECT token_hash, purpose, user_id, application_id
      FROM _auth_session_continuations
      WHERE purpose = 'tenant_selection'
    `).get() as Record<string, unknown>;
    expect(persisted).toMatchObject({
      purpose: 'tenant_selection',
      user_id: owner.body.user.userId,
    });
    expect(persisted.token_hash).not.toBe(raw);
    expect(String(persisted.token_hash)).not.toContain(raw);
    expect(new AuthSessionContinuationStore(harness.db, {
      applicationId: 'app_wrong',
    }).inspect(raw, 'tenant_selection')).toBeNull();
    expect(harness.runtime.getAuthTenantSessionService()!.continuations
      .inspect(raw, 'not_tenant_selection' as 'tenant_selection')).toBeNull();

    const selected = await post(harness, '/auth/tenants/select', {
      continuation: raw,
      tenantId: other.body.tenant.tenantId,
    });
    expect(selected.status).toBe(200);
    expect(selected.body.activeTenant).toMatchObject({
      tenantId: other.body.tenant.tenantId,
      role: 'member',
    });
    expect(pageToken(selected.headers)).toBeString();
    await expect(tokens.resolveAuthContext(selected.body.accessToken)).resolves.toMatchObject({
      userId: owner.body.user.userId,
      tenantId: other.body.tenant.tenantId,
    });

    const replay = await post(harness, '/auth/tenants/select', {
      continuation: raw,
      tenantId: owner.body.tenant.tenantId,
    });
    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe('TENANT_SELECTION_CONTINUATION_INVALID');
  }, 60_000);

  test('does not bless a tenant-selection continuation reset during access signing', async () => {
    const harness = await start();
    const store = harness.runtime.getStore()!;
    const tenancy = harness.runtime.getTenancyService()!;
    const tokens = harness.runtime.getTokenService()!;
    const tenantSessions = harness.runtime.getAuthTenantSessionService()!;
    const owner = await register(harness, 'selection-reset-owner');
    const other = await register(harness, 'selection-reset-other');
    tenancy.addMembership({
      tenantId: other.body.tenant.tenantId,
      userId: owner.body.user.userId,
      roleKey: 'member',
      createdBy: other.body.user.userId,
    });
    const loginResult = await login(harness, 'selection-reset-owner');
    const rawContinuation = loginResult.body.tenantSelection.continuation as string;
    expect(rawContinuation).toBeString();

    const gate = createAsyncGate();
    const candidateAccessTokens: string[] = [];
    const originalSign = tokens.signAccessToken.bind(tokens);
    tokens.signAccessToken = async (user, generation, session) => {
      const token = await originalSign(user, generation, session);
      candidateAccessTokens.push(token);
      gate.enter();
      await gate.wait;
      return token;
    };

    const selection = tenantSessions.selectTenant(
      rawContinuation,
      other.body.tenant.tenantId,
    );
    try {
      await gate.entered;
      expect(await store.resetPassword(
        owner.body.user.userId,
        'replacement-password',
      )).toBe(true);
      gate.release();
      await expect(selection).rejects.toMatchObject({
        code: 'TENANT_SELECTION_CONTINUATION_INVALID',
        status: 401,
      });
    } finally {
      gate.release();
      tokens.signAccessToken = originalSign;
    }

    expect(candidateAccessTokens).toHaveLength(1);
    await expect(tokens.resolveAuthContext(candidateAccessTokens[0]!)).resolves.toBeNull();
    expect(tenantSessions.continuations.inspect(
      rawContinuation,
      'tenant_selection',
    )).not.toBeNull();
    expect(activeSessionCountForUser(harness.db, owner.body.user.userId)).toBe(0);
  }, 60_000);

  test('does not persist a tenant when onboarding authority resets during signing', async () => {
    const harness = await start();
    const store = harness.runtime.getStore()!;
    const tenancy = harness.runtime.getTenancyService()!;
    const tokens = harness.runtime.getTokenService()!;
    const tenantSessions = harness.runtime.getAuthTenantSessionService()!;
    expect((await register(harness, 'creation-reset-bootstrap')).status).toBe(200);
    const user = await store.createUser({
      username: 'creation-reset-user',
      email: 'creation-reset-user@example.test',
      password: 'password123',
    });
    const loginResult = await login(harness, 'creation-reset-user');
    const rawContinuation = loginResult.body.onboarding.continuation as string;
    expect(rawContinuation).toBeString();

    const gate = createAsyncGate();
    const originalSign = tokens.signAccessToken.bind(tokens);
    tokens.signAccessToken = async (subject, generation, session) => {
      const token = await originalSign(subject, generation, session);
      gate.enter();
      await gate.wait;
      return token;
    };

    const creation = tenantSessions.createTenant({
      continuation: rawContinuation,
      name: 'Reset During Creation',
      slug: 'reset-during-creation',
    });
    try {
      await gate.entered;
      expect(await store.resetPassword(user.userId, 'replacement-password')).toBe(true);
      gate.release();
      await expect(creation).rejects.toMatchObject({
        code: 'TENANT_ONBOARDING_CONTINUATION_INVALID',
        status: 401,
      });
    } finally {
      gate.release();
      tokens.signAccessToken = originalSign;
    }

    expect(tenancy.getTenantBySlug('reset-during-creation')).toBeNull();
    expect(tenantSessions.continuations.inspect(
      rawContinuation,
      'tenant_onboarding',
    )).not.toBeNull();
    expect(activeSessionCountForUser(harness.db, user.userId)).toBe(0);
  }, 60_000);

  test('captures tracing context before asynchronous tenant and page-session commits', async () => {
    const harness = await start();
    const store = harness.runtime.getStore()!;
    const tenancy = harness.runtime.getTenancyService()!;
    const tokens = harness.runtime.getTokenService()!;
    const tenantSessions = harness.runtime.getAuthTenantSessionService()!;

    expect((await register(harness, 'snapshot-bootstrap')).status).toBe(200);
    await store.createUser({
      username: 'snapshot-user',
      email: 'snapshot-user@example.test',
      password: 'password123',
    });
    const onboarding = await login(harness, 'snapshot-user');
    expect(onboarding.body.tenantOnboardingRequired).toBe(true);

    const continuationGate = createAsyncGate();
    const originalIssueAfterAdmission = tokens.issueTokenPairAfterAdmission.bind(tokens);
    tokens.issueTokenPairAfterAdmission = async (user, options, admit) => {
      continuationGate.enter();
      await continuationGate.wait;
      return originalIssueAfterAdmission(user, options, admit);
    };
    const continuationAudit = {
      requestId: 'tenant-create-continuation-before',
      correlationId: 'tenant-create-continuation-correlation-before',
    };
    const continuationCreation = tenantSessions.createTenant({
      continuation: onboarding.body.onboarding.continuation,
      name: 'Snapshot First',
      slug: 'snapshot-first',
      auditRequest: continuationAudit,
    });
    await continuationGate.entered;
    continuationAudit.requestId = 'tenant-create-continuation-after';
    continuationAudit.correlationId = 'tenant-create-continuation-correlation-after';
    continuationGate.release();
    const first = await continuationCreation.finally(() => {
      tokens.issueTokenPairAfterAdmission = originalIssueAfterAdmission;
    });
    expect(auditRequestForTarget(
      harness.db,
      'tenant.created',
      first.tenant.tenantId,
    )).toEqual({
      request_id: 'tenant-create-continuation-before',
      correlation_id: 'tenant-create-continuation-correlation-before',
    });

    const refreshGate = createAsyncGate();
    const originalReplaceForCreation = tokens.replaceWebSession.bind(tokens);
    tokens.replaceWebSession = async (rawToken, binding, admit, onReplaced) => {
      refreshGate.enter();
      await refreshGate.wait;
      return originalReplaceForCreation(rawToken, binding, admit, onReplaced);
    };
    const refreshAudit = {
      requestId: 'tenant-create-refresh-before',
      correlationId: 'tenant-create-refresh-correlation-before',
    };
    const refreshCreation = tenantSessions.createTenant({
      refreshToken: first.tokens.refreshToken,
      name: 'Snapshot Second',
      slug: 'snapshot-second',
      auditRequest: refreshAudit,
    });
    await refreshGate.entered;
    refreshAudit.requestId = 'tenant-create-refresh-after';
    refreshAudit.correlationId = 'tenant-create-refresh-correlation-after';
    refreshGate.release();
    const second = await refreshCreation.finally(() => {
      tokens.replaceWebSession = originalReplaceForCreation;
    });
    expect(Object.isFrozen(first.user)).toBe(false);
    expect(Object.isFrozen(second.user)).toBe(false);
    expect(auditRequestForTarget(
      harness.db,
      'tenant.created',
      second.tenant.tenantId,
    )).toEqual({
      request_id: 'tenant-create-refresh-before',
      correlation_id: 'tenant-create-refresh-correlation-before',
    });

    const selectionProof = await login(harness, 'snapshot-user');
    expect(selectionProof.body.tenantSelectionRequired).toBe(true);
    const selectionGate = createAsyncGate();
    const originalIssueForSelection = tokens.issueTokenPairAfterAdmission.bind(tokens);
    tokens.issueTokenPairAfterAdmission = async (user, options, admit) => {
      selectionGate.enter();
      await selectionGate.wait;
      return originalIssueForSelection(user, options, admit);
    };
    const selectionAudit = {
      requestId: 'tenant-selection-before',
      correlationId: 'tenant-selection-correlation-before',
    };
    const selection = tenantSessions.selectTenant(
      selectionProof.body.tenantSelection.continuation,
      first.tenant.tenantId,
      selectionAudit,
    );
    await selectionGate.entered;
    selectionAudit.requestId = 'tenant-selection-after';
    selectionAudit.correlationId = 'tenant-selection-correlation-after';
    selectionGate.release();
    const selected = await selection.finally(() => {
      tokens.issueTokenPairAfterAdmission = originalIssueForSelection;
    });
    const selectedMembershipId = tenancy.getMembership(
      first.tenant.tenantId,
      selected.user.userId,
    )!.membershipId;
    expect(auditRequestForTarget(
      harness.db,
      'session.tenant-selected',
      selectedMembershipId,
    )).toEqual({
      request_id: 'tenant-selection-before',
      correlation_id: 'tenant-selection-correlation-before',
    });

    const switchGate = createAsyncGate();
    const originalResolveForSwitch = tokens.resolveWebRefreshProof.bind(tokens);
    const originalSwitchProof = originalResolveForSwitch(
      selected.completion.tokens.refreshToken,
    )!;
    const mutableSwitchUser = {
      ...originalSwitchProof.user,
      properties: {
        ...originalSwitchProof.user.properties,
        boundary: 'original',
      },
    };
    tokens.resolveWebRefreshProof = (rawToken) => rawToken
      === selected.completion.tokens.refreshToken
      ? { ...originalSwitchProof, user: mutableSwitchUser }
      : originalResolveForSwitch(rawToken);
    const originalSignForSwitch = tokens.signAccessToken.bind(tokens);
    tokens.signAccessToken = async (user, generation, session) => {
      const accessToken = await originalSignForSwitch(user, generation, session);
      switchGate.enter();
      await switchGate.wait;
      return accessToken;
    };
    const callbackUsers: UserRecord[] = [];
    const originalReplaceForSwitch = tokens.replaceWebSession.bind(tokens);
    tokens.replaceWebSession = async (rawToken, binding, admit, onReplaced) => (
      originalReplaceForSwitch(rawToken, binding, admit, (input) => {
        onReplaced?.(input);
        callbackUsers.push(input.user);
        input.user.email = 'callback-mutated@example.test';
        input.user.properties.boundary = 'callback-mutated';
      })
    );
    const switchAudit = {
      requestId: 'tenant-switch-before',
      correlationId: 'tenant-switch-correlation-before',
    };
    const switching = tenantSessions.switchTenant(
      selected.completion.tokens.refreshToken,
      second.tenant.tenantId,
      switchAudit,
    );
    await switchGate.entered;
    switchAudit.requestId = 'tenant-switch-after';
    switchAudit.correlationId = 'tenant-switch-correlation-after';
    mutableSwitchUser.userId = 'mutated-switch-user';
    mutableSwitchUser.email = 'mutated-switch-user@example.test';
    mutableSwitchUser.role = 'mutated-switch-role';
    mutableSwitchUser.properties.boundary = 'mutated-switch-user';
    switchGate.release();
    const switched = await switching.finally(() => {
      tokens.signAccessToken = originalSignForSwitch;
      tokens.resolveWebRefreshProof = originalResolveForSwitch;
      tokens.replaceWebSession = originalReplaceForSwitch;
    });
    expect(switched.user).toMatchObject({
      userId: originalSwitchProof.user.userId,
      email: originalSwitchProof.user.email,
      role: originalSwitchProof.user.role,
      properties: { boundary: 'original' },
    });
    expect(callbackUsers).toHaveLength(1);
    const callbackUser = callbackUsers[0]!;
    expect(Object.isFrozen(callbackUser)).toBe(false);
    expect(Object.isFrozen(callbackUser.properties)).toBe(false);
    expect(Object.isFrozen(switched.user)).toBe(false);
    expect(Object.isFrozen(switched.user.properties)).toBe(false);
    expect(switched.user).not.toBe(callbackUser);
    expect(switched.user.properties).not.toBe(callbackUser.properties);
    switched.user.email = 'returned-user-is-mutable@example.test';
    switched.user.properties.boundary = 'returned-user-is-mutable';
    expect(switched.user.email).toBe('returned-user-is-mutable@example.test');
    expect(switched.user.properties.boundary).toBe('returned-user-is-mutable');
    expect(callbackUser.email).toBe('callback-mutated@example.test');
    expect(callbackUser.properties.boundary).toBe('callback-mutated');
    switched.user.email = originalSwitchProof.user.email;
    switched.user.properties.boundary = 'original';
    const switchedMembershipId = tenancy.getMembership(
      second.tenant.tenantId,
      originalSwitchProof.user.userId,
    )!.membershipId;
    expect(auditRequestForTarget(
      harness.db,
      'session.tenant-switched',
      switchedMembershipId,
    )).toEqual({
      request_id: 'tenant-switch-before',
      correlation_id: 'tenant-switch-correlation-before',
    });

    const currentProof = tokens.resolveWebRefreshProof(switched.tokens.refreshToken)!;
    const logoutPair = await tokens.issueTokenPair(switched.user, {
      binding: {
        tenantId: currentProof.session.tenantId!,
        membershipId: currentProof.session.membershipId!,
      },
    });
    const logoutSessionId = tokens.resolveWebRefreshProof(
      logoutPair.refreshToken,
    )!.session.sessionId;
    const logoutAudit = {
      requestId: 'refresh-revoke-before',
      correlationId: 'refresh-revoke-correlation-before',
    };
    const originalGetRefreshTokenByHash = store.getRefreshTokenByHash.bind(store);
    store.getRefreshTokenByHash = (tokenHash) => {
      logoutAudit.requestId = 'refresh-revoke-after';
      logoutAudit.correlationId = 'refresh-revoke-correlation-after';
      return originalGetRefreshTokenByHash(tokenHash);
    };
    try {
      expect(tokens.revokeRefreshTokenByRaw(
        logoutPair.refreshToken,
        logoutAudit,
      )).toBe(true);
    } finally {
      store.getRefreshTokenByHash = originalGetRefreshTokenByHash;
    }
    expect(auditRequestForTarget(
      harness.db,
      'session.revoked',
      logoutSessionId,
    )).toEqual({
      request_id: 'refresh-revoke-before',
      correlation_id: 'refresh-revoke-correlation-before',
    });

    const page = await tokens.issuePageSessionToken(switched.tokens.refreshToken);
    expect(page).not.toBeNull();
    const sessionId = tokens.resolveWebRefreshProof(
      switched.tokens.refreshToken,
    )!.session.sessionId;
    const codec = (tokens as unknown as {
      codec: {
        verifyPageSessionToken(token: string): Promise<unknown>;
      };
    }).codec;
    const pageGate = createAsyncGate();
    const originalVerifyPageSessionToken = codec.verifyPageSessionToken.bind(codec);
    codec.verifyPageSessionToken = async (token) => {
      pageGate.enter();
      await pageGate.wait;
      return originalVerifyPageSessionToken(token);
    };
    const pageAudit = {
      requestId: 'page-revoke-before',
      correlationId: 'page-revoke-correlation-before',
    };
    const revocation = tokens.revokePageSessionToken(page!.token, pageAudit);
    await pageGate.entered;
    pageAudit.requestId = 'page-revoke-after';
    pageAudit.correlationId = 'page-revoke-correlation-after';
    pageGate.release();
    await expect(revocation.finally(() => {
      codec.verifyPageSessionToken = originalVerifyPageSessionToken;
    })).resolves.toBe(true);
    expect(auditRequestForTarget(
      harness.db,
      'session.revoked',
      sessionId,
    )).toEqual({
      request_id: 'page-revoke-before',
      correlation_id: 'page-revoke-correlation-before',
    });
    expect(harness.runtime.getAuthSessionService()!.store.getById(sessionId)).toMatchObject({
      status: 'revoked',
      revocationReason: 'page-session-replaced',
    });
  }, 60_000);

  test('fails closed for wrong membership, expiry, suspension, replay, and concurrent use', async () => {
    const harness = await start();
    const tenancy = harness.runtime.getTenancyService()!;
    const owner = await register(harness, 'proof-owner');
    const other = await register(harness, 'proof-other');
    const outsider = await register(harness, 'proof-outsider');
    const membership = tenancy.addMembership({
      tenantId: other.body.tenant.tenantId,
      userId: owner.body.user.userId,
      roleKey: 'member',
      createdBy: other.body.user.userId,
    });

    const wrongUser = await login(harness, 'proof-owner');
    const wrongTarget = await post(harness, '/auth/tenants/select', {
      continuation: wrongUser.body.tenantSelection.continuation,
      tenantId: outsider.body.tenant.tenantId,
    });
    expect(wrongTarget.status).toBe(403);
    expect(wrongTarget.body.code).toBe('TENANT_SELECTION_INVALID');

    harness.db.prepare(`
      UPDATE _auth_session_continuations SET expires_at = ? WHERE token_hash = ?
    `).run(
      Date.now() - 1,
      hashToken(wrongUser.body.tenantSelection.continuation),
    );
    const expired = await post(harness, '/auth/tenants/select', {
      continuation: wrongUser.body.tenantSelection.continuation,
      tenantId: owner.body.tenant.tenantId,
    });
    expect(expired.status).toBe(401);

    const membershipProof = await login(harness, 'proof-owner');
    tenancy.suspendMembership(membership.membershipId);
    const suspendedMembership = await post(harness, '/auth/tenants/select', {
      continuation: membershipProof.body.tenantSelection.continuation,
      tenantId: other.body.tenant.tenantId,
    });
    expect(suspendedMembership.status).toBe(403);
    tenancy.reactivateMembership(membership.membershipId);

    const tenantProof = await login(harness, 'proof-owner');
    tenancy.suspendTenant(other.body.tenant.tenantId);
    const suspendedTenant = await post(harness, '/auth/tenants/select', {
      continuation: tenantProof.body.tenantSelection.continuation,
      tenantId: other.body.tenant.tenantId,
    });
    expect(suspendedTenant.status).toBe(403);
    const onlyLiveTenant = await login(harness, 'proof-owner');
    expect(onlyLiveTenant.status).toBe(200);
    expect(onlyLiveTenant.body.activeTenant.tenantId).toBe(owner.body.tenant.tenantId);
    tenancy.reactivateTenant(other.body.tenant.tenantId);

    const concurrentProof = await login(harness, 'proof-owner');
    const input = {
      continuation: concurrentProof.body.tenantSelection.continuation,
      tenantId: owner.body.tenant.tenantId,
    };
    const results = await Promise.all([
      post(harness, '/auth/tenants/select', input),
      post(harness, '/auth/tenants/select', input),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 401]);
    expect(results.filter((result) => result.status === 200)).toHaveLength(1);
  }, 60_000);

  test('lists with refresh-family proof and atomically replaces a tenant session', async () => {
    const harness = await start();
    const tenancy = harness.runtime.getTenancyService()!;
    const tokens = harness.runtime.getTokenService()!;
    const owner = await register(harness, 'switch-owner');
    const other = await register(harness, 'switch-other');
    tenancy.addMembership({
      tenantId: other.body.tenant.tenantId,
      userId: owner.body.user.userId,
      roleKey: 'member',
      createdBy: other.body.user.userId,
    });
    const proof = await login(harness, 'switch-owner');
    const selected = await post(harness, '/auth/tenants/select', {
      continuation: proof.body.tenantSelection.continuation,
      tenantId: owner.body.tenant.tenantId,
    });
    const oldPage = pageToken(selected.headers);
    const oldAccess = selected.body.accessToken as string;
    const oldRefresh = selected.body.refreshToken as string;

    const deniedList = await post(harness, '/auth/tenants/list', {
      refreshToken: oldAccess,
    });
    expect(deniedList.status).toBe(401);
    const listed = await post(harness, '/auth/tenants/list', {
      refreshToken: oldRefresh,
    });
    expect(listed.status).toBe(200);
    expect(listed.body.activeTenantId).toBe(owner.body.tenant.tenantId);
    expect(listed.body.tenants).toHaveLength(2);

    const switched = await post(harness, '/auth/tenants/switch', {
      refreshToken: oldRefresh,
      tenantId: other.body.tenant.tenantId,
    }, cookie(oldPage, harness));
    expect(switched.status).toBe(200);
    expect(switched.body.activeTenant.tenantId).toBe(other.body.tenant.tenantId);
    const newPage = pageToken(switched.headers);
    expect(newPage).not.toBe(oldPage);
    await expect(tokens.resolveAuthContext(oldAccess)).resolves.toBeNull();
    await expect(tokens.resolvePageSessionToken(oldPage)).resolves.toBeNull();
    await expect(tokens.resolveAuthContext(switched.body.accessToken)).resolves.toMatchObject({
      tenantId: other.body.tenant.tenantId,
      sessionScopeId: other.body.tenant.tenantId,
    });
    await expect(tokens.resolvePageSessionToken(newPage)).resolves.toMatchObject({
      tenantId: other.body.tenant.tenantId,
    });

    const refreshed = await post(harness, '/auth/refresh', {
      refreshToken: switched.body.refreshToken,
    });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.activeTenant).toMatchObject({
      tenantId: other.body.tenant.tenantId,
      role: 'member',
    });

    const replayedOldRefresh = await post(harness, '/auth/refresh', {
      refreshToken: oldRefresh,
    });
    expect(replayedOldRefresh.status).toBe(401);
    await expect(tokens.resolveAuthContext(switched.body.accessToken)).resolves.toBeNull();
    await expect(tokens.resolvePageSessionToken(newPage)).resolves.toBeNull();
  }, 60_000);

  test('does not accept a tenant-selection proof in another app runtime', async () => {
    const appA = await start();
    const appB = await start();
    const tenancyA = appA.runtime.getTenancyService()!;
    const owner = await register(appA, 'isolated-owner');
    const other = await register(appA, 'isolated-other');
    tenancyA.addMembership({
      tenantId: other.body.tenant.tenantId,
      userId: owner.body.user.userId,
      roleKey: 'member',
      createdBy: other.body.user.userId,
    });
    const proof = await login(appA, 'isolated-owner');

    const crossed = await post(appB, '/auth/tenants/select', {
      continuation: proof.body.tenantSelection.continuation,
      tenantId: owner.body.tenant.tenantId,
    });
    expect(crossed.status).toBe(401);
    expect(crossed.body.code).toBe('TENANT_SELECTION_CONTINUATION_INVALID');
    expect(activeSessionCount(appB.db)).toBe(0);
  }, 60_000);

  test('concurrent switch attempts cannot leave either replacement usable', async () => {
    const harness = await start();
    const tenancy = harness.runtime.getTenancyService()!;
    const tokens = harness.runtime.getTokenService()!;
    const owner = await register(harness, 'race-owner');
    const other = await register(harness, 'race-other');
    tenancy.addMembership({
      tenantId: other.body.tenant.tenantId,
      userId: owner.body.user.userId,
      roleKey: 'member',
      createdBy: other.body.user.userId,
    });
    const proof = await login(harness, 'race-owner');
    const selected = await post(harness, '/auth/tenants/select', {
      continuation: proof.body.tenantSelection.continuation,
      tenantId: owner.body.tenant.tenantId,
    });
    const input = {
      refreshToken: selected.body.refreshToken,
      tenantId: other.body.tenant.tenantId,
    };
    const results = await Promise.all([
      post(harness, '/auth/tenants/switch', input),
      post(harness, '/auth/tenants/switch', input),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 401]);
    const winner = results.find((result) => result.status === 200)!;
    // The loser presented a consumed refresh credential, so the existing
    // replay policy invalidates the winner too. No concurrent caller keeps a
    // usable family after ambiguity.
    await expect(tokens.resolveAuthContext(winner.body.accessToken)).resolves.toBeNull();
    await expect(tokens.rotateRefreshToken(winner.body.refreshToken)).resolves.toBeNull();
  }, 60_000);

  test('MFA completion still requires tenant selection and emits no app session', async () => {
    const harness = await start({ mfa: true });
    const tenancy = harness.runtime.getTenancyService()!;
    const registered = await register(harness, 'mfa-tenant-owner');
    expect(registered.body.mfaSetupRequired).toBe(true);
    const setup = await post(harness, '/auth/mfa/setup', {
      setupToken: registered.body.mfaSetupToken,
      method: 'totp',
    });
    const verifiedSetup = await post(harness, '/auth/mfa/setup/verify', {
      verificationToken: setup.body.verificationToken,
      code: generateTotpCode({ secret: setup.body.totp.secret }),
    });
    expect(verifiedSetup.status).toBe(200);
    expect(verifiedSetup.body.activeTenant.tenantId).toBe(registered.body.tenant.tenantId);

    const otherUser = await harness.runtime.getStore()!.createUser({
      username: 'mfa-other-owner',
      email: 'mfa-other-owner@example.test',
      password: 'password123',
    });
    const other = tenancy.createTenant({
      slug: 'mfa-other',
      name: 'MFA Other',
      ownerUserId: otherUser.userId,
    });
    tenancy.addMembership({
      tenantId: other.tenant.tenantId,
      userId: registered.body.user.userId,
      roleKey: 'member',
      createdBy: otherUser.userId,
    });

    const loginResult = await login(harness, 'mfa-tenant-owner');
    expect(loginResult.body.mfaChallengeRequired).toBe(true);
    const before = activeSessionCount(harness.db);
    const verifiedChallenge = await post(harness, '/auth/mfa/challenge/verify', {
      challengeToken: loginResult.body.mfaChallenge.challengeToken,
      code: generateTotpCode({ secret: setup.body.totp.secret }),
    });
    expect(verifiedChallenge.status).toBe(200);
    expect(verifiedChallenge.body.tenantSelectionRequired).toBe(true);
    expect(verifiedChallenge.body.accessToken).toBeUndefined();
    expect(verifiedChallenge.body.refreshToken).toBeUndefined();
    expect(activeSessionCount(harness.db)).toBe(before);
  }, 60_000);

  test('admin-required dynamically invalidates unassured sessions and preserves verified descendants', async () => {
    const harness = await start({ mfaPolicy: 'admin-required' });
    const tenancy = harness.runtime.getTenancyService()!;
    const tokens = harness.runtime.getTokenService()!;

    const bootstrap = await register(harness, 'admin-assurance-owner');
    expect(bootstrap.body.mfaSetupRequired).toBe(true);
    const bootstrapSetup = await post(harness, '/auth/mfa/setup', {
      setupToken: bootstrap.body.mfaSetupToken,
      method: 'totp',
    });
    const bootstrapVerified = await post(harness, '/auth/mfa/setup/verify', {
      verificationToken: bootstrapSetup.body.verificationToken,
      code: generateTotpCode({ secret: bootstrapSetup.body.totp.secret }),
    });
    expect(bootstrapVerified.status).toBe(200);
    expect(bootstrapVerified.body.activeTenant.kind).toBe('administration');

    const customer = await register(harness, 'admin-assurance-customer');
    expect(customer.status).toBe(200);
    expect(customer.body.mfaSetupRequired).toBeUndefined();
    expect(customer.body.activeTenant.kind).toBe('organization');
    await expect(tokens.resolveAuthContext(customer.body.accessToken)).resolves.toMatchObject({
      userId: customer.body.user.userId,
      tenantKind: 'organization',
    });

    const appMembership = tenancy.addMembership({
      tenantId: bootstrap.body.tenant.tenantId,
      userId: customer.body.user.userId,
      roleKey: 'member',
      createdBy: bootstrap.body.user.userId,
    });

    // An ordinary app role in the Administration Organization is not a
    // platform-operator signal and does not activate admin-required MFA.
    await expect(tokens.resolveAuthContext(customer.body.accessToken)).resolves.toMatchObject({
      userId: customer.body.user.userId,
      tenantKind: 'organization',
    });
    const appOnlyLogin = await login(harness, 'admin-assurance-customer');
    expect(appOnlyLogin.body.tenantSelectionRequired).toBe(true);
    expect(appOnlyLogin.body.mfaSetupRequired).toBeUndefined();

    tenancy.updateMembershipRole(appMembership.membershipId, 'administrator');

    // Application authority in that membership is live policy state. It
    // invalidates both access and refresh use immediately; no token claim or
    // UI state can delay the gate.
    await expect(tokens.resolveAuthContext(customer.body.accessToken)).resolves.toBeNull();
    const staleRefresh = await post(harness, '/auth/refresh', {
      refreshToken: customer.body.refreshToken,
    });
    expect(staleRefresh.status).toBe(401);

    const loginResult = await login(harness, 'admin-assurance-customer');
    expect(loginResult.body.mfaSetupRequired).toBe(true);
    const setup = await post(harness, '/auth/mfa/setup', {
      setupToken: loginResult.body.mfaSetupToken,
      method: 'totp',
    });
    const verified = await post(harness, '/auth/mfa/setup/verify', {
      verificationToken: setup.body.verificationToken,
      code: generateTotpCode({ secret: setup.body.totp.secret }),
    });
    expect(verified.status).toBe(200);
    expect(verified.body.tenantSelectionRequired).toBe(true);
    const continuation = harness.runtime.getAuthTenantSessionService()!.continuations
      .inspect(verified.body.tenantSelection.continuation, 'tenant_selection');
    expect(continuation?.mfaVerifiedAt).toBeNumber();

    const selected = await post(harness, '/auth/tenants/select', {
      continuation: verified.body.tenantSelection.continuation,
      tenantId: bootstrap.body.tenant.tenantId,
    });
    expect(selected.status).toBe(200);
    await expect(tokens.resolveAuthContext(selected.body.accessToken)).resolves.toMatchObject({
      tenantKind: 'administration',
      mfaVerifiedAt: expect.any(Number),
    });

    const switched = await post(harness, '/auth/tenants/switch', {
      refreshToken: selected.body.refreshToken,
      tenantId: customer.body.tenant.tenantId,
    });
    expect(switched.status).toBe(200);
    await expect(tokens.resolveAuthContext(switched.body.accessToken)).resolves.toMatchObject({
      tenantKind: 'organization',
      mfaVerifiedAt: continuation!.mfaVerifiedAt,
    });

    const refreshed = await post(harness, '/auth/refresh', {
      refreshToken: switched.body.refreshToken,
    });
    expect(refreshed.status).toBe(200);
    await expect(tokens.resolveAuthContext(refreshed.body.accessToken)).resolves.toMatchObject({
      mfaVerifiedAt: continuation!.mfaVerifiedAt,
    });
  }, 60_000);
});

function hashToken(token: string): string {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(token);
  return hasher.digest('hex');
}

function createAsyncGate(): {
  entered: Promise<void>;
  wait: Promise<void>;
  enter(): void;
  release(): void;
} {
  let enter!: () => void;
  let release!: () => void;
  return {
    entered: new Promise<void>((resolve) => { enter = resolve; }),
    wait: new Promise<void>((resolve) => { release = resolve; }),
    enter: () => enter(),
    release: () => release(),
  };
}

function auditRequestForTarget(
  db: ReactiveDB,
  action: string,
  targetId: string,
): { request_id: string | null; correlation_id: string | null } | null {
  return db.prepare(`
    SELECT request_id, correlation_id
    FROM _auth_audit_events
    WHERE action = ? AND target_id = ?
    LIMIT 1
  `).get(action, targetId) as {
    request_id: string | null;
    correlation_id: string | null;
  } | null;
}

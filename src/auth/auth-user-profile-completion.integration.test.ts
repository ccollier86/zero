import { afterEach, describe, expect, test } from 'bun:test';
import { contactFixture } from './auth-user-contact.test-fixture';
import { createReactiveDB } from '../sync/reactive-db';
import { defineAuthTables } from './auth-schema';
import { UserStore } from './user-store';
import { registerReactiveDBMutationInterceptor } from '../sync/reactive-db-mutation-interceptor';
import { normalizeAuthUserProfile } from './auth-config-user-profile';
import { AuthUserProfileCompletionStore } from './auth-user-profile-completion-store';
import { reconcileProfileCompletionPolicy } from './auth-user-profile-completion-policy';
import { derivePkceS256Challenge } from './native';
import { generateTotpCode } from './mfa-totp';
import { AuthSessionContinuationStore } from './auth-session-continuation-store';
import { AuthUserProfileCompletionService } from './auth-user-profile-completion-service';
import { OBS_CODES } from '../observability/codes';

const fixtures: ReturnType<typeof contactFixture>[] = [];
afterEach(async () => { for (const f of fixtures.splice(0).reverse()) await f.close(); });
function setup(...args: Parameters<typeof contactFixture>) { const f = contactFixture(...args); fixtures.push(f); return f; }
const policy = { completion: { enabled: true }, fields: { firstName: { required: true } } } as const;

describe('required first-use profile completion', () => {
  test('new signup receives only an identity continuation; app/session/profile APIs remain inaccessible until accepted completion', async () => {
    const f = setup({ profile: policy }); const owner = await f.register();
    expect(owner.profileCompletionRequired).toBe(true); expect(owner.accessToken).toBeUndefined();
    expect(owner.refreshToken).toBeUndefined();
    const raw = owner.profileCompletion.continuation;
    expect(owner.profileCompletion).toMatchObject({ state: 'ready', missingFields: ['firstName'], profile: { revision: 1 } });
    expect((await f.request('GET', '/auth/me', undefined, raw)).status).toBe(401);
    expect((await f.request('GET', '/auth/profile', undefined, raw)).status).toBe(401);
    expect((await f.request('GET', '/auth/profile/contacts', undefined, raw)).status).toBe(401);
    const inspected = await f.request('POST', '/auth/profile/completion/inspect', { continuation: raw });
    expect(inspected.status).toBe(200); expect(inspected.headers.get('cache-control')).toContain('no-store');
    expect((await f.request('POST', '/auth/profile/completion', { continuation: raw, expectedRevision: 1,
      changes: { role: 'admin', firstName: 'forged' } })).status).toBe(422);
    const complete = await f.request('POST', '/auth/profile/completion', { continuation: raw, expectedRevision: 1,
      changes: { firstName: 'Accepted name' } });
    expect(complete.status).toBe(200); expect(complete.body.accessToken).toBeString();
    expect(complete.headers.get('set-cookie')).toContain(`${f.getRuntime().getTokenService()!.pageSessionCookieName}=`);
    expect((await f.request('GET', '/auth/profile', undefined, complete.body.accessToken)).body.values.firstName).toBe('Accepted name');
    expect((await f.request('POST', '/auth/profile/completion/inspect', { continuation: raw })).status).toBe(400);
    const stored = f.db.prepare('SELECT token_hash,consumed_at FROM _auth_profile_completion_continuations').get() as any;
    expect(stored.consumed_at).toBeNumber(); expect(stored.token_hash).not.toBe(raw);
  });
  test('missing required fields and stale administrator revisions do not consume the identity continuation', async () => {
    const f = setup({ profile: policy }); const owner = await f.register(); const raw = owner.profileCompletion.continuation;
    const invalid = await f.request('POST', '/auth/profile/completion', { continuation: raw, expectedRevision: 1, changes: { lastName: 'Only last' } });
    expect(invalid.status).toBe(422); expect(invalid.body.code).toBe('AUTH_PROFILE_REQUIRED_FIELDS');
    f.getRuntime().getStore()!.updateUser(owner.user.userId, { lastName: 'Administrator edit' });
    const stale = await f.request('POST', '/auth/profile/completion', { continuation: raw, expectedRevision: 1, changes: { firstName: 'stale' } });
    expect(stale.status).toBe(409); expect(stale.body.code).toBe('AUTH_PROFILE_REVISION_CONFLICT');
    const inspected = await f.request('POST', '/auth/profile/completion/inspect', { continuation: raw });
    expect(inspected.status).toBe(200); expect(inspected.body.profile.revision).toBe(2);
    expect(inspected.body.profile.values.firstName).toBeNull();
  });
  test('current security generation and final writer rejection prevent full session admission', async () => {
    const f = setup({ profile: policy }); const owner = await f.register(); const raw = owner.profileCompletion.continuation;
    const remove = registerReactiveDBMutationInterceptor(f.db, ({ change }) => {
      if (change.table === 'users' && change.op === 'UPDATE') f.getRuntime().getStore()!.revokeAllUserTokens(owner.user.userId);
    });
    try {
      const result = await f.request('POST', '/auth/profile/completion', { continuation: raw, expectedRevision: 1, changes: { firstName: 'denied' } });
      expect(result.status).toBe(400); expect(result.body.code).toBe('AUTH_PROFILE_COMPLETION_INVALID');
    } finally { remove(); }
    expect(f.getRuntime().getStore()!.getUserById(owner.user.userId)?.firstName).toBeNull();
    expect(f.db.prepare('SELECT COUNT(*) AS count FROM _refresh_tokens').get()).toEqual({ count: 0 });
    expect(f.db.prepare('SELECT consumed_at FROM _auth_profile_completion_continuations').get()).toEqual({ consumed_at: null });
    f.getRuntime().getStore()!.revokeAllUserTokens(owner.user.userId);
    expect((await f.request('POST', '/auth/profile/completion/inspect', { continuation: raw })).status).toBe(400);
  });
  test('legacy accounts are not silently enrolled; explicit onSignIn rollout does gate them', async () => {
    for (const existingUsers of ['none', 'onSignIn'] as const) {
      const db = createReactiveDB({ mode: 'memory' }); defineAuthTables(db);
      const users = new UserStore(db); await users.createUser({ username: 'legacy-owner', email: 'legacy-owner@example.test', password: 'password123' });
      const f = setup({ db, profile: { ...policy, completion: { enabled: true, existingUsers } } });
      const login = await f.request('POST', '/auth/login', { username: 'legacy-owner', password: 'password123' });
      expect(login.status).toBe(200);
      if (existingUsers === 'none') { expect(login.body.accessToken).toBeString(); expect(login.body.profileCompletionRequired).toBeUndefined(); }
      else { expect(login.body.profileCompletionRequired).toBe(true); expect(login.body.accessToken).toBeUndefined(); }
    }
  });
  test('restricted continuations retain achieved MFA assurance and cannot be used after expiry', async () => {
    const f = setup({ profile: policy }); const owner = await f.register(); const runtime = f.getRuntime();
    const user = runtime.getStore()!.getUserById(owner.user.userId)!;
    const verifiedAt = Date.now();
    const decision = await runtime.getAuthTenantSessionService()!.complete(user, undefined, verifiedAt, runtime.getStore()!.getAuthGeneration(user.userId));
    expect(decision.kind).toBe('profile_completion_required');
    if (decision.kind !== 'profile_completion_required') throw new Error('Synthetic expected completion');
    const raw = decision.profileCompletion.continuation;
    const result = await f.request('POST', '/auth/profile/completion', { continuation: raw, expectedRevision: 1, changes: { firstName: 'MFA complete' } });
    expect(result.status).toBe(200);
    const current = await runtime.getTokenService()!.resolveAuthContext(result.body.accessToken);
    expect(current?.mfaVerifiedAt).toBe(verifiedAt);
    f.db.prepare('UPDATE _auth_profile_completion_continuations SET expires_at = 0 WHERE consumed_at IS NULL').run();
    expect((await f.request('POST', '/auth/profile/completion/inspect', { continuation: owner.profileCompletion.continuation })).status).toBe(400);
  });
  test('concurrent accepted drafts consume one continuation and admit one refresh family', async () => {
    const f = setup({ profile: policy }); const owner = await f.register();
    const command = { continuation: owner.profileCompletion.continuation, expectedRevision: 1, changes: { firstName: 'Concurrent' } };
    const results = await Promise.all([f.request('POST', '/auth/profile/completion', command),
      f.request('POST', '/auth/profile/completion', command)]);
    expect(results.filter(value => value.status === 200)).toHaveLength(1);
    expect(results.filter(value => value.status === 409)).toHaveLength(1);
    expect(f.db.prepare('SELECT COUNT(*) AS count FROM _refresh_tokens').get()).toEqual({ count: 1 });
    expect(f.db.prepare('SELECT COUNT(*) AS count FROM _auth_sessions').get()).toEqual({ count: 1 });
    expect(f.events.query({ code: OBS_CODES.AUTH_USER_PROFILE_COMPLETED.code }).events).toHaveLength(1);
  });
  test('a signing failure preserves the accepted profile and unused proof; a current-revision retry can complete', async () => {
    const f = setup({ profile: policy }); const owner = await f.register(); const runtime = f.getRuntime();
    const tokens = runtime.getTokenService()!; const original = tokens.signAccessToken.bind(tokens);
    tokens.signAccessToken = async () => { throw new Error('Synthetic signing failure'); };
    const command = { continuation: owner.profileCompletion.continuation, expectedRevision: 1, changes: { firstName: 'Durable accepted' } };
    try { expect((await f.request('POST', '/auth/profile/completion', command)).status).toBe(500); }
    finally { tokens.signAccessToken = original; }
    const inspected = await f.request('POST', '/auth/profile/completion/inspect', { continuation: command.continuation });
    expect(inspected.status).toBe(200); expect(inspected.body.profile).toMatchObject({ revision: 2, values: { firstName: 'Durable accepted' } });
    expect(f.db.prepare('SELECT COUNT(*) AS count FROM _refresh_tokens').get()).toEqual({ count: 0 });
    const result = await f.request('POST', '/auth/profile/completion', { ...command, expectedRevision: 2 });
    expect(result.status).toBe(200); expect(result.body.accessToken).toBeString();
    expect(f.events.query({ code: OBS_CODES.AUTH_USER_PROFILE_COMPLETED.code }).events).toHaveLength(1);
  });
  test('revocation during async signing rejects the final writer without consuming the proof or storing a family', async () => {
    const f = setup({ profile: policy }); const owner = await f.register(); const runtime = f.getRuntime();
    const tokens = runtime.getTokenService()!; const original = tokens.signAccessToken.bind(tokens);
    tokens.signAccessToken = async (...args) => { const value = await original(...args);
      runtime.getStore()!.revokeAllUserTokens(owner.user.userId); return value; };
    try {
      const result = await f.request('POST', '/auth/profile/completion', { continuation: owner.profileCompletion.continuation,
        expectedRevision: 1, changes: { firstName: 'Accepted before revocation' } });
      expect(result.status).toBe(400); expect(result.body.code).toBe('AUTH_PROFILE_COMPLETION_INVALID');
    } finally { tokens.signAccessToken = original; }
    expect(f.db.prepare('SELECT COUNT(*) AS count FROM _refresh_tokens').get()).toEqual({ count: 0 });
    expect(f.db.prepare('SELECT COUNT(*) AS count FROM _auth_sessions').get()).toEqual({ count: 0 });
    expect(f.db.prepare('SELECT consumed_at FROM _auth_profile_completion_continuations').get()).toEqual({ consumed_at: null });
    expect(f.events.query({ code: OBS_CODES.AUTH_USER_PROFILE_COMPLETED.code }).events).toHaveLength(0);
  });
  test('latest required-policy fingerprint fences stale runtimes and stateless/native issuers', async () => {
    const f = setup({ profile: policy }); const owner = await f.register(); const runtime = f.getRuntime();
    const tokens = runtime.getTokenService()!; const user = runtime.getStore()!.getUserById(owner.user.userId)!;
    await expect(tokens.signAccessToken(user)).rejects.toMatchObject({ code: 'AUTH_PROFILE_COMPLETION_REQUIRED' });
    await expect(tokens.signNativeAccessToken(user, 'contact-native', 'openid profile', 0, 'synthetic-family'))
      .rejects.toMatchObject({ code: 'AUTH_PROFILE_COMPLETION_REQUIRED' });
    reconcileProfileCompletionPolicy(f.db, runtime.getStore()!, normalizeAuthUserProfile({ ...policy,
      fields: { firstName: { required: true }, lastName: { required: true } } }));
    const old = await f.request('POST', '/auth/profile/completion/inspect', { continuation: owner.profileCompletion.continuation });
    expect(old.status).toBe(409); expect(old.body.code).toBe('AUTH_PROFILE_COMPLETION_CHANGED');
    await expect(tokens.issueTokenPair(user)).rejects.toMatchObject({ code: 'AUTH_PROFILE_COMPLETION_CHANGED' });
  });
  test('disabled defaults and explicitly excluded signup remain ordinary; blocked enabled migration cannot fabricate readiness', async () => {
    const ordinary = setup({ profile: { fields: policy.fields } }); const owner = await ordinary.register();
    expect(owner.accessToken).toBeString(); expect(owner.profileCompletionRequired).toBeUndefined();
    const excluded = setup({ profile: { ...policy, completion: { enabled: true, onSignup: false } } });
    expect((await excluded.register()).accessToken).toBeString();
    const blocked = setup({ profile: policy, completionSchemaAllowed: false });
    const denied = await blocked.request('POST', '/auth/register', { username: 'blocked', email: 'blocked@example.test', password: 'password123' });
    expect(denied.status).toBe(503); expect(denied.body.code).toBe('AUTH_PROFILE_COMPLETION_NOT_READY');
    expect(blocked.db.prepare('SELECT COUNT(*) AS count FROM users').get()).toEqual({ count: 0 });
  });
  test('new invitation enrollment preserves its exact tenant binding, independently of onSignup', async () => {
    const f = setup({ profile: { ...policy, completion: { enabled: true, onSignup: false, onInvitation: true } },
      auth: { tenancy: { mode: 'multi', creation: { mode: 'authenticated' }, onboarding: { invitations: { accountCreation: true } } },
        authorization: 'simple' } });
    const bootstrap = await f.request('POST', '/auth/register', { username: 'invite-owner', email: 'invite-owner@example.test',
      password: 'password123', organizationName: 'Platform administration' });
    expect(bootstrap.status).toBe(200); expect(bootstrap.body.accessToken).toBeString();
    const customer = await f.request('POST', '/auth/tenants/create', { name: 'Customer', refreshToken: bootstrap.body.refreshToken });
    expect(customer.status).toBe(200);
    const issued = await f.request('POST', '/auth/tenant/invitations', { email: 'new-invite@example.test' }, customer.body.accessToken);
    expect(issued.status).toBe(200);
    const accepted = await f.request('POST', '/auth/invitations/accept', { token: issued.body.token, username: 'new-invite',
      email: 'new-invite@example.test', password: 'password123' });
    expect(accepted.status).toBe(200); expect(accepted.body.profileCompletionRequired).toBe(true);
    expect(accepted.body.accessToken).toBeUndefined();
    expect(f.db.prepare('SELECT origin FROM _auth_profile_completion_enrollments WHERE user_id = ?')
      .get(accepted.body.user.userId)).toEqual({ origin: 'invitation' });
    const result = await f.request('POST', '/auth/profile/completion', { continuation: accepted.body.profileCompletion.continuation,
      expectedRevision: 1, changes: { firstName: 'Invited accepted' } });
    expect(result.status).toBe(200); expect(result.body.activeTenant.tenantId).toBe(customer.body.activeTenant.tenantId);
  });
  test('completion precedes tenant choice and passes to the existing selection owner without issuing an unbound family', async () => {
    const f = setup({ profile: policy, auth: { tenancy: { mode: 'multi', creation: { mode: 'authenticated' } } } });
    const registered = await f.request('POST', '/auth/register', { username: 'multi-owner', email: 'multi-owner@example.test',
      password: 'password123', organizationName: 'Platform administration' });
    expect(registered.status).toBe(200); expect(registered.body.profileCompletionRequired).toBe(true);
    const raw = registered.body.profileCompletion.continuation;
    const before = f.getRuntime().getTenancyService()!.listActiveTenantMembershipsForUser(registered.body.user.userId);
    expect(before).toHaveLength(1);
    const first = await f.request('POST', '/auth/profile/completion', { continuation: raw, expectedRevision: 1,
      changes: { firstName: 'Multi accepted' } });
    expect(first.status).toBe(200); expect(first.body.activeTenant.tenantId).toBe(before[0]!.tenant.tenantId);
    const created = await f.request('POST', '/auth/tenants/create', { name: 'Second', refreshToken: first.body.refreshToken });
    expect(created.status).toBe(200);
    f.getRuntime().getStore()!.updateUser(registered.body.user.userId, { firstName: '' });
    const login = await f.request('POST', '/auth/login', { username: 'multi-owner', password: 'password123' });
    expect(login.body.profileCompletionRequired).toBe(true); expect(login.body.tenantSelectionRequired).toBeUndefined();
    const count = f.db.prepare('SELECT COUNT(*) AS count FROM _refresh_tokens').get();
    const selected = await f.request('POST', '/auth/profile/completion', { continuation: login.body.profileCompletion.continuation,
      expectedRevision: login.body.profileCompletion.profile.revision, changes: { firstName: 'Reselected accepted' } });
    expect(selected.status).toBe(200); expect(selected.body.tenantSelectionRequired).toBe(true);
    expect(selected.body.accessToken).toBeUndefined();
    expect(f.db.prepare('SELECT COUNT(*) AS count FROM _refresh_tokens').get()).toEqual(count);
    const bound = await f.request('POST', '/auth/tenants/select', { continuation: selected.body.tenantSelection.continuation,
      tenantId: before[0]!.tenant.tenantId });
    expect(bound.status).toBe(200); expect(bound.body.activeTenant.tenantId).toBe(before[0]!.tenant.tenantId);
  });
  test('native authorization resumes with the existing request context after restricted completion', async () => {
    const f = setup({ profile: policy }); const verifier = 'v'.repeat(64);
    const query = new URLSearchParams({ response_type: 'code', client_id: 'contact-native',
      redirect_uri: 'com.example.contact:/callback', scope: 'openid profile email', state: 's'.repeat(43),
      nonce: 'n'.repeat(43), code_challenge: await derivePkceS256Challenge(verifier), code_challenge_method: 'S256', prompt: 'create' });
    const begin = await f.app.handle(new Request(`http://localhost/auth/oauth/authorize?${query}`));
    expect(begin.status).toBe(302);
    const continuation = new URL(begin.headers.get('location')!, 'http://localhost').searchParams.get('redirect')!;
    const registered = await f.request('POST', '/auth/register', { username: 'native-completion', email: 'native-completion@example.test',
      password: 'password123', nativeContinuation: continuation });
    expect(registered.body.profileCompletionRequired).toBe(true); expect(registered.body.accessToken).toBeUndefined();
    const complete = await f.request('POST', '/auth/profile/completion', { continuation: registered.body.profileCompletion.continuation,
      expectedRevision: 1, changes: { firstName: 'Native complete' } });
    expect(complete.status).toBe(200);
    const cookie = complete.headers.get('set-cookie')!.split(';', 1)[0]!;
    const consent = await f.app.handle(new Request(`http://localhost${continuation}`, { headers: { Cookie: cookie } }));
    expect(consent.status).toBe(200);
    const html = await consent.text(); const requestId = html.match(/name="request_id" value="([^"]+)"/)?.[1];
    expect(requestId).toBeString();
    const approve = await f.app.handle(new Request('http://localhost/auth/oauth/authorize', { method: 'POST',
      headers: { Cookie: cookie, Origin: 'http://localhost', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ request_id: requestId!, decision: 'approve' }) }));
    expect(approve.status).toBe(302);
    const callback = new URL(approve.headers.get('location')!); expect(callback.searchParams.get('state')).toBe('s'.repeat(43));
    const exchanged = await f.app.handle(new Request('http://localhost/auth/oauth/token', { method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({
        grant_type: 'authorization_code', code: callback.searchParams.get('code')!, client_id: 'contact-native',
        redirect_uri: 'com.example.contact:/callback', code_verifier: verifier }) }));
    expect(exchanged.status).toBe(200);
    const result = await exchanged.json() as any;
    expect(await f.getRuntime().getTokenService()!.resolveAuthContext(result.access_token)).toMatchObject({
      userId: registered.body.user.userId, clientId: 'contact-native', sessionKind: 'native' });
    f.getRuntime().getStore()!.updateUser(registered.body.user.userId, { firstName: '' });
    const deniedRefresh = await f.app.handle(new Request('http://localhost/auth/oauth/token', { method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({
        grant_type: 'refresh_token', refresh_token: result.refresh_token, client_id: 'contact-native' }) }));
    expect(deniedRefresh.status).toBe(400);
    expect(await deniedRefresh.json()).toMatchObject({ error: 'invalid_grant' });
    expect(f.events.query({ code: OBS_CODES.AUTH_NATIVE_REQUEST_FAILED.code }).events).toHaveLength(0);
  });
  test('required MFA setup/challenge must finish before the profile continuation appears', async () => {
    const f = setup({ profile: policy, auth: { mfa: { enabled: true, policy: 'required', methods: ['totp'],
      totp: { encryptionKey: 'synthetic-profile-completion-totp-key' } } } });
    const owner = await f.register(); expect(owner.mfaSetupRequired).toBe(true);
    expect(owner.profileCompletionRequired).toBeUndefined(); expect(owner.accessToken).toBeUndefined();
    const enrollment = await f.request('POST', '/auth/mfa/setup', { setupToken: owner.mfaSetupToken, method: 'totp' });
    expect(enrollment.status).toBe(200);
    const verified = await f.request('POST', '/auth/mfa/setup/verify', { verificationToken: enrollment.body.verificationToken,
      code: generateTotpCode({ secret: enrollment.body.totp.secret }) });
    expect(verified.status).toBe(200); expect(verified.body.profileCompletionRequired).toBe(true);
    expect(verified.body.accessToken).toBeUndefined();
    const login = await f.request('POST', '/auth/login', { username: 'contact-owner', password: 'password123' });
    expect(login.body.mfaChallengeRequired).toBe(true); expect(login.body.profileCompletionRequired).toBeUndefined();
    const challenge = await f.request('POST', '/auth/mfa/challenge/verify', { challengeToken: login.body.mfaChallenge.challengeToken,
      code: generateTotpCode({ secret: enrollment.body.totp.secret }) });
    expect(challenge.status).toBe(200); expect(challenge.body.profileCompletionRequired).toBe(true);
    const accepted = await f.request('POST', '/auth/profile/completion', { continuation: challenge.body.profileCompletion.continuation,
      expectedRevision: 1, changes: { firstName: 'Proved MFA' } });
    expect(accepted.status).toBe(200);
    expect((await f.getRuntime().getTokenService()!.resolveAuthContext(accepted.body.accessToken))?.mfaVerifiedAt).toBeNumber();
  });
  test('mandatory email proof completes before first-use profile and cannot be replaced by that continuation', async () => {
    const f = setup({ profile: policy, auth: { account: { requireEmailVerification: true } } });
    const owner = await f.register();
    if (owner.profileCompletionRequired) {
      await f.request('POST', '/auth/profile/completion', { continuation: owner.profileCompletion.continuation,
        expectedRevision: 1, changes: { firstName: 'Bootstrap' } });
    }
    const result = await f.request('POST', '/auth/register', { username: 'verify-first', email: 'verify-first@example.test', password: 'password123' });
    expect(result.status).toBe(200); expect(result.body.user.emailVerificationRequired).toBe(true);
    expect(result.body.profileCompletionRequired).toBeUndefined(); expect(result.body.accessToken).toBeUndefined();
    await f.getRuntime().getAuthEmailOutbox()!.processDue();
    const message = [...f.provider.messages].reverse().find(item => item.message.to === 'verify-first@example.test');
    const url = message?.message.text?.match(/https:\/\/example\.test\/verify-email\?token=[A-Za-z0-9_-]+/)?.[0];
    expect(url).toBeString();
    const proved = await f.request('POST', '/auth/verify-email', { token: new URL(url!).searchParams.get('token') });
    expect(proved.status).toBe(200); expect(proved.body.profileCompletionRequired).toBe(true);
    expect(proved.body.accessToken).toBeUndefined();
    const accepted = await f.request('POST', '/auth/profile/completion', { continuation: proved.body.profileCompletion.continuation,
      expectedRevision: proved.body.profileCompletion.profile.revision, changes: { firstName: 'Verified email' } });
    expect(accepted.status).toBe(200); expect(accepted.body.accessToken).toBeString();
  });
  test('reconstructed continuation/service owners recover the retained proof without recreating identity or weakening scope', async () => {
    const f = setup({ profile: policy }); const owner = await f.register(); const runtime = f.getRuntime();
    const recreatedStore = new AuthSessionContinuationStore(f.db);
    const recovered = new AuthUserProfileCompletionService(f.db, runtime.getStore()!, runtime.getUserProfileService()!,
      recreatedStore, normalizeAuthUserProfile(policy), () => runtime.getAuthTenantSessionService()!);
    expect(recovered.read({ continuation: owner.profileCompletion.continuation }).profile?.revision).toBe(1);
    const result = await recovered.complete({ continuation: owner.profileCompletion.continuation,
      expectedRevision: 1, changes: { firstName: 'Recovered accepted' } });
    expect(result.completion.kind).toBe('session');
    expect(f.db.prepare('SELECT COUNT(*) AS count FROM users').get()).toEqual({ count: 1 });
    expect(() => recovered.read({ continuation: owner.profileCompletion.continuation }))
      .toThrow(expect.objectContaining({ code: 'AUTH_PROFILE_COMPLETION_INVALID' }));
  });
  test('bounded repeated sign-in and corrupt retained contexts cannot consume proofs or mint sessions', async () => {
    const f = setup({ profile: policy }); const owner = await f.register();
    for (let index = 0; index < 9; index++) {
      const result = await f.request('POST', '/auth/login', { username: 'contact-owner', password: 'password123' });
      expect(result.status).toBe(200); expect(result.body.profileCompletionRequired).toBe(true);
    }
    const full = await f.request('POST', '/auth/login', { username: 'contact-owner', password: 'password123' });
    expect(full.status).toBe(429); expect(full.body.code).toBe('AUTH_PROFILE_COMPLETION_CAPACITY');
    f.db.prepare('UPDATE _auth_profile_completion_contexts SET session_binding_json = ?').run('{"userId":"forged"}');
    const corrupt = await f.request('POST', '/auth/profile/completion/inspect', { continuation: owner.profileCompletion.continuation });
    expect(corrupt.status).toBe(500); expect(corrupt.body.code).toBe('AUTH_STATE_INVARIANT_FAILED');
    expect(f.db.prepare('SELECT COUNT(*) AS count FROM _refresh_tokens').get()).toEqual({ count: 0 });
    expect(JSON.stringify(f.events.query({}).events)).not.toContain(owner.profileCompletion.continuation);
    expect(f.events.query({ code: OBS_CODES.AUTH_STATE_INVARIANT_FAILED.code }).events).toHaveLength(1);
  });
  test('required profile checks remain in refresh issuance and an outer writer cannot start async completion', async () => {
    const f = setup({ profile: policy }); const owner = await f.register();
    const completed = await f.request('POST', '/auth/profile/completion', { continuation: owner.profileCompletion.continuation,
      expectedRevision: 1, changes: { firstName: 'Completed' } });
    expect(completed.status).toBe(200);
    f.getRuntime().getStore()!.updateUser(owner.user.userId, { firstName: '' });
    const refresh = await f.request('POST', '/auth/refresh', { refreshToken: completed.body.refreshToken });
    expect(refresh.status).toBe(403); expect(refresh.body.code).toBe('AUTH_PROFILE_COMPLETION_REQUIRED');
    expect(f.db.prepare('SELECT COUNT(*) AS count FROM _refresh_tokens').get()).toEqual({ count: 1 });
    const login = await f.request('POST', '/auth/login', { username: 'contact-owner', password: 'password123' });
    const command = { continuation: login.body.profileCompletion.continuation,
      expectedRevision: login.body.profileCompletion.profile.revision, changes: { firstName: 'Outside only' } };
    let pending!: Promise<unknown>;
    f.db.transaction(() => { pending = f.getRuntime().getUserProfileCompletionService()!.complete(command); });
    await expect(pending).rejects.toMatchObject({ code: 'AUTH_PROFILE_COMPLETION_TRANSACTION_INVALID' });
    expect(f.getRuntime().getStore()!.getUserById(owner.user.userId)?.firstName).toBe('');
  });
  test('retained fractional MFA authority is rejected rather than normalized into a full session', async () => {
    const f = setup({ profile: policy }); const owner = await f.register();
    f.db.prepare('UPDATE _auth_profile_completion_continuations SET mfa_verified_at = 0.5').run();
    const response = await f.request('POST', '/auth/profile/completion/inspect', { continuation: owner.profileCompletion.continuation });
    expect(response.status).toBe(500); expect(response.body.code).toBe('AUTH_STATE_INVARIANT_FAILED');
    expect(f.events.query({ code: OBS_CODES.AUTH_STATE_INVARIANT_FAILED.code }).events).toHaveLength(1);
    expect(f.db.prepare('SELECT COUNT(*) AS count FROM _refresh_tokens').get()).toEqual({ count: 0 });
  });
  test('runtime retirement during signing cannot finish a captured restricted completion', async () => {
    const f = setup({ profile: policy }); const owner = await f.register(); const runtime = f.getRuntime();
    const service = runtime.getUserProfileCompletionService()!;
    const tokens = runtime.getTokenService()!; const original = tokens.signAccessToken.bind(tokens);
    let enter!: () => void; let release!: () => void;
    const entered = new Promise<void>(done => { enter = done; });
    const held = new Promise<void>(done => { release = done; });
    tokens.signAccessToken = async (...args) => { enter(); await held; return original(...args); };
    const pending = f.request('POST', '/auth/profile/completion', { continuation: owner.profileCompletion.continuation,
      expectedRevision: 1, changes: { firstName: 'Accepted before shutdown' } });
    await entered; service.stop(); release();
    try { const response = await pending; expect(response.status).toBe(503);
      expect(response.body.code).toBe('AUTH_PROFILE_COMPLETION_NOT_READY'); }
    finally { tokens.signAccessToken = original; }
    expect(f.db.prepare('SELECT COUNT(*) AS count FROM _refresh_tokens').get()).toEqual({ count: 0 });
    expect(f.db.prepare('SELECT consumed_at FROM _auth_profile_completion_continuations').get()).toEqual({ consumed_at: null });
  });
});

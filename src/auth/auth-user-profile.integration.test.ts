import { afterEach, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { EmailService } from '../email/email-service';
import { MemoryEmailProvider } from '../email/memory-email-provider';
import { MemoryEventStore } from '../observability';
import { ZERO_OBSERVABILITY_RUNTIME } from '../runtime/service-keys';
import { ZeroAppRuntime } from '../runtime/zero-app-runtime';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { createAuthPlugin } from './auth.plugin';
import type { AuthRuntime } from './auth-runtime';
import type { AuthUserProfileConfig } from './auth-user-profile-types';
import { NativeSessionStore } from './oidc/native-session-store';
import { prepareNativeSession } from './oidc/native-session-factory';
import { registerReactiveDBMutationInterceptor } from '../sync/reactive-db-mutation-interceptor';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const operation of cleanup.splice(0).reverse()) await operation(); });

function setup(profile: AuthUserProfileConfig = {
  fields: { username: true, preferredName: true, bio: true, website: true, socialLinks: true }, regional: true,
}, schemaAllowed = true) {
  const db = createReactiveDB({ mode: 'memory' });
  const owner = new ZeroAppRuntime('profile-test');
  const events = new MemoryEventStore({ maxEvents: 100 });
  owner.set(ZERO_OBSERVABILITY_RUNTIME, { sink: events, store: events, config: { console: false } });
  let runtime!: AuthRuntime;
  const provider = new MemoryEmailProvider();
  const email = { enabled: true, app: { name: 'Profile test', publicUrl: 'https://example.test' },
    config: { provider, from: 'no-reply@example.test' }, provider,
    service: new EmailService(provider, { from: 'no-reply@example.test' }) };
  const app = new Elysia().use(createAuthPlugin({ db, runtime: owner,
    emailRuntime: email, bootstrap: 'public', profileSchemaInstallAllowed: schemaAllowed,
    nativeIssuer: 'http://localhost/auth', nativeAudience: 'http://localhost',
    nativeApps: { clients: [{ clientId: 'profile-native', name: 'Profile Native',
      redirectUris: ['com.example.profile:/callback'], scopes: ['openid', 'profile', 'email', 'profile:write'] }] },
    userProfile: profile, onRuntimeCreated: value => { runtime = value; } })).compile();
  cleanup.push(async () => { await owner.dispose(); db.dispose(); });
  const request = async (method: string, path: string, body?: unknown, token?: string) => {
    const response = await app.handle(new Request(`http://localhost${path}`, { method,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }));
    return { status: response.status, headers: response.headers, body: await response.json() as any };
  };
  return { db, events, request, getRuntime: () => runtime };
}

async function register(request: ReturnType<typeof setup>['request'], username = 'profile-owner') {
  const result = await request('POST', '/auth/register', {
    username, email: `${username}@example.test`, password: 'password123', firstName: 'Initial',
  });
  expect(result.status).toBe(200);
  return result.body;
}

describe('public Guardian own-profile routes', () => {
  test('GET/PATCH use own global identity, accepted CAS values and private cache headers', async () => {
    const { request, events, getRuntime } = setup();
    const owner = await register(request);
    const other = await register(request, 'another-user');
    const before = await request('GET', '/auth/profile', undefined, owner.accessToken);
    expect(before.status).toBe(200);
    expect(before.body).toMatchObject({ userId: owner.user.userId, revision: 1,
      values: { firstName: 'Initial', preferredName: null }, capabilities: { state: 'ready' } });
    expect(before.headers.get('cache-control')).toContain('no-store');
    const accepted = await request('PATCH', '/auth/profile', { expectedRevision: 1, changes: {
      firstName: 'Accepted', preferredName: 'Friendly', regional: { timeFormat: '24h', weekStartsOn: 1 },
    } }, owner.accessToken);
    expect(accepted.status).toBe(200);
    expect(accepted.body).toMatchObject({ revision: 2, values: { firstName: 'Accepted', preferredName: 'Friendly', regional: { timeFormat: '24h' } } });
    expect(await getRuntime().getTokenService()!.resolveAuthContext(owner.accessToken)).not.toBeNull();
    expect((await request('GET', '/auth/profile', undefined, other.accessToken)).body.values.preferredName).toBeNull();
    const successful = events.query({ code: 'auth.user_profile.updated' }).events;
    expect(successful).toHaveLength(1);
    expect(JSON.stringify(successful)).not.toContain('Friendly');
    expect(JSON.stringify(successful)).not.toContain(owner.user.email);
  });

  test('forged account targets/role/security fields and malformed input cannot reach persistence', async () => {
    const { request } = setup(); const owner = await register(request);
    for (const changes of [{ role: 'admin' }, { email: 'replacement@example.test' }, { userId: 'someone-else' },
      { status: 'active' }, { verified: true }, { website: 'javascript:alert(1)' }, { regional: { timeZone: 'Not/Real' } }]) {
      expect((await request('PATCH', '/auth/profile', { expectedRevision: 1, changes }, owner.accessToken)).status).toBe(422);
    }
    expect((await request('GET', '/auth/profile', undefined, owner.accessToken)).body.revision).toBe(1);
    expect((await request('GET', '/auth/profile')).status).toBe(401);
  });

  test('administrator core edit conflicts with stale self draft, with no partial extended write', async () => {
    const { request, getRuntime } = setup(); const owner = await register(request);
    getRuntime().getStore()!.updateUser(owner.user.userId, { firstName: 'Administrator updated' });
    const stale = await request('PATCH', '/auth/profile', { expectedRevision: 1, changes: { bio: 'Old draft' } }, owner.accessToken);
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('AUTH_PROFILE_REVISION_CONFLICT');
    const current = await request('GET', '/auth/profile', undefined, owner.accessToken);
    expect(current.body).toMatchObject({ revision: 2, values: { firstName: 'Administrator updated', bio: null } });
  });

  test('disabled and noneditable fields cannot be enabled by submitted values', async () => {
    const { request } = setup({ fields: { firstName: { editable: false }, bio: false }, regional: false });
    const owner = await register(request);
    for (const changes of [{ firstName: 'forged' }, { bio: 'forged' }, { regional: { locale: 'fr' } }]) {
      const rejected = await request('PATCH', '/auth/profile', { expectedRevision: 1, changes }, owner.accessToken);
      expect(rejected.status).toBe(403); expect(rejected.body.code).toBe('AUTH_PROFILE_FIELD_NOT_EDITABLE');
    }
    expect((await request('GET', '/auth/profile', undefined, owner.accessToken)).body.capabilities.fields.firstName.editable).toBe(false);
  });

  test('uninstalled forbidden schema is visibly blocked without breaking registration or unrelated Guardian', async () => {
    const { request, db } = setup(undefined, false); const owner = await register(request);
    expect((await request('GET', '/auth/config')).body.userProfile.state).toBe('blocked');
    const result = await request('GET', '/auth/profile', undefined, owner.accessToken);
    expect(result.status).toBe(503); expect(result.body.code).toBe('AUTH_PROFILE_NOT_READY');
    expect(result.body.error).toBe('Authentication service unavailable');
    expect(db.prepare("SELECT 1 FROM sqlite_master WHERE name = '_auth_user_profiles'").get()).toBeNull();
    expect((await request('GET', '/auth/me', undefined, owner.accessToken)).status).toBe(200);
  });

  test('native read scope does not authorize edits, email disclosure or regional writes', async () => {
    const { request, db, getRuntime } = setup(); const owner = await register(request);
    const tokens = getRuntime().getTokenService()!;
    const user = getRuntime().getStore()!.getUserById(owner.user.userId)!;
    const generation = getRuntime().getStore()!.getAuthGeneration(user.userId);
    const sessions = new NativeSessionStore(db);
    const nativeToken = async (scope: string) => {
      const prepared = prepareNativeSession({ userId: user.userId, clientId: 'profile-native', scope,
        authGeneration: generation, ttlMs: 3_600_000,
        authority: { scopeKind: 'application', scopeId: 'application', tenantId: null,
          membershipId: null, tenantAuthorizationGeneration: null, membershipAuthorizationGeneration: null } });
      expect(sessions.consumeCodeAndInsert(() => true, prepared.session)).toBe(true);
      return tokens.signNativeAccessToken(user, 'profile-native', scope, generation, prepared.session.familyId);
    };
    const onlyIdentity = await nativeToken('openid');
    expect((await request('GET', '/auth/profile', undefined, onlyIdentity)).status).toBe(403);
    const reader = await nativeToken('openid profile');
    const readable = await request('GET', '/auth/profile', undefined, reader);
    expect(readable.status).toBe(200); expect(readable.body.email).toBeNull();
    expect(readable.body.capabilities.fields.firstName.editable).toBe(false);
    expect(readable.body.capabilities.regional.editable).toBe(false);
    expect((await request('PATCH', '/auth/profile', { expectedRevision: 1, changes: { firstName: 'Escalated' } }, reader)).status).toBe(403);
    const writer = await nativeToken('openid profile profile:write');
    const accepted = await request('PATCH', '/auth/profile', { expectedRevision: 1,
      changes: { firstName: 'Native accepted', regional: { timeFormat: '12h' } } }, writer);
    expect(accepted.status).toBe(200); expect(accepted.body.email).toBeNull();
    const withEmail = await nativeToken('openid profile email');
    expect((await request('GET', '/auth/profile', undefined, withEmail)).body.email).toBe(user.email);
  });

  test('revocation after the tracked core change rejects final commit and emits no accepted-profile event', async () => {
    const { request, db, getRuntime, events } = setup(); const owner = await register(request);
    const store = getRuntime().getStore()!;
    const remove = registerReactiveDBMutationInterceptor(db, ({ change }) => {
      if (change.table === 'users' && change.op === 'UPDATE') store.revokeAllUserTokens(owner.user.userId);
    });
    try {
      const rejected = await request('PATCH', '/auth/profile', { expectedRevision: 1, changes: {
        firstName: 'Must roll back', bio: 'Not accepted', regional: { timeFormat: '24h' },
      } }, owner.accessToken);
      expect(rejected.status).toBe(409); expect(rejected.body.code).toBe('AUTHORIZATION_CHANGED');
    } finally { remove(); }
    const actual = await request('GET', '/auth/profile', undefined, owner.accessToken);
    expect(actual.status).toBe(200);
    expect(actual.body).toMatchObject({ revision: 1, values: { firstName: 'Initial', bio: null, regional: { timeFormat: null } } });
    expect(events.query({ code: 'auth.user_profile.updated' }).events).toHaveLength(0);
  });

  test('API keys are not own-profile sessions, even when associated with the same user', async () => {
    const { request, getRuntime } = setup(); const owner = await register(request);
    const auth = await getRuntime().getTokenService()!.resolveAuthContext(owner.accessToken);
    expect(auth).not.toBeNull();
    const service = getRuntime().getUserProfileService()!;
    expect(() => service.read({ ...auth!, credentialKind: 'api-key' }))
      .toThrow(expect.objectContaining({ code: 'AUTH_PROFILE_SESSION_REQUIRED' }));
    expect(() => service.update({ ...auth!, credentialKind: 'api-key' }, { expectedRevision: 1, changes: { firstName: 'Denied' } }))
      .toThrow(expect.objectContaining({ code: 'AUTH_PROFILE_SESSION_REQUIRED' }));
  });

  test('concurrent drafts with the same revision accept one command, without merging a rejected write', async () => {
    const { request, events } = setup(); const owner = await register(request);
    const results = await Promise.all(['first', 'second'].map(bio => request('PATCH', '/auth/profile',
      { expectedRevision: 1, changes: { bio } }, owner.accessToken)));
    expect(results.map(result => result.status).sort()).toEqual([200, 409]);
    const accepted = results.find(result => result.status === 200)!;
    const current = await request('GET', '/auth/profile', undefined, owner.accessToken);
    expect(current.body.revision).toBe(2); expect(current.body.values.bio).toBe(accepted.body.values.bio);
    expect(events.query({ code: 'auth.user_profile.updated' }).events).toHaveLength(1);
  });

  test('disabled profiles and email-username presentation preserve data without opening edits', async () => {
    const disabled = setup({ enabled: false }); const owner = await register(disabled.request);
    expect((await disabled.request('GET', '/auth/config')).body.userProfile.state).toBe('disabled');
    const hidden = await disabled.request('GET', '/auth/profile', undefined, owner.accessToken);
    expect(hidden.status).toBe(403); expect(hidden.body.code).toBe('AUTH_PROFILE_DISABLED');
    const emailMode = setup({ usernameMode: 'email' }); const emailOwner = await register(emailMode.request);
    const before = await emailMode.request('GET', '/auth/profile', undefined, emailOwner.accessToken);
    expect(before.body.values.username).toBe('profile-owner');
    expect(before.body.capabilities.usernameMode).toBe('email');
    expect((await emailMode.request('PATCH', '/auth/profile', { expectedRevision: 1,
      changes: { username: 'attempted-replacement' } }, emailOwner.accessToken)).status).toBe(403);
  });
});

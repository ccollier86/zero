import { afterEach, describe, expect, test } from 'bun:test';
import { contactFixture, deliveredContactToken } from './auth-user-contact.test-fixture';
import { NativeSessionStore } from './oidc/native-session-store';
import { prepareNativeSession } from './oidc/native-session-factory';
import { registerReactiveDBMutationInterceptor } from '../sync/reactive-db-mutation-interceptor';

const fixtures: ReturnType<typeof contactFixture>[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0).reverse()) await fixture.close(); });
const setup = (...args: Parameters<typeof contactFixture>) => { const fixture = contactFixture(...args); fixtures.push(fixture); return fixture; };

describe('Guardian public own-contact routes', () => {
  test('optional email proof is purpose-bound, consume-once and never inferred from a legacy gate timestamp', async () => {
    const f = setup(); const owner = await f.register(); const runtime = f.getRuntime();
    runtime.getStore()!.markEmailVerified(owner.user.userId);
    const before = await f.request('GET', '/auth/profile/contacts', undefined, owner.accessToken);
    expect(before.status).toBe(200); expect(before.headers.get('cache-control')).toContain('no-store');
    expect(before.body.email.state).toBe('unverified');
    const pending = await f.request('POST', '/auth/profile/contacts/email/verify', { expectedRevision: before.body.revision }, owner.accessToken);
    expect(pending.status).toBe(200); expect(pending.body.email.state).toBe('pending');
    await runtime.getAuthEmailOutbox()!.processDue();
    const token = deliveredContactToken(f.provider);
    expect((await f.request('POST', '/auth/verify-email', { token })).status).not.toBe(200);
    const accepted = await f.request('POST', '/auth/profile/contacts/email/complete', { token });
    expect(accepted.status).toBe(200); expect(accepted.body).toEqual({ verified: true, userId: owner.user.userId, requiresSignIn: false });
    const proved = await f.request('GET', '/auth/profile/contacts', undefined, owner.accessToken);
    expect(proved.body.email.state).toBe('possession-verified');
    expect((await f.request('POST', '/auth/profile/contacts/email/complete', { token })).status).toBe(400);
    const events = f.events.query({ code: 'auth.user_contact.proved' }).events;
    expect(events).toHaveLength(1); expect(JSON.stringify(events)).not.toContain(owner.user.email);
    expect(JSON.stringify(events)).not.toContain(token);
  });
  test('candidate email is not a login until reauthenticated proof; activation revokes every session family', async () => {
    const f = setup(); const owner = await f.register(); const runtime = f.getRuntime();
    const rejected = await f.request('POST', '/auth/profile/contacts/email/change', {
      expectedRevision: 1, email: 'candidate@example.test', currentPassword: 'wrong-password' }, owner.accessToken);
    expect(rejected.status).toBe(401);
    const pending = await f.request('POST', '/auth/profile/contacts/email/change', {
      expectedRevision: 1, email: 'candidate@example.test', currentPassword: 'password123' }, owner.accessToken);
    expect(pending.status).toBe(200);
    expect(pending.body.email).toMatchObject({ value: owner.user.email, pendingValue: 'candidate@example.test' });
    expect(runtime.getStore()!.getUserByEmail('candidate@example.test')).toBeNull();
    expect(runtime.getStore()!.getUserByEmail(owner.user.email)?.userId).toBe(owner.user.userId);
    await runtime.getAuthEmailOutbox()!.processDue();
    const token = deliveredContactToken(f.provider);
    expect([...f.provider.messages].reverse().find(item => item.message.tags?.action === 'contact_verification')!.message.to).toBe('candidate@example.test');
    const accepted = await f.request('POST', '/auth/profile/contacts/email/complete', { token });
    expect(accepted.status).toBe(200); expect(accepted.body.requiresSignIn).toBe(true);
    expect(await runtime.getTokenService()!.resolveAuthContext(owner.accessToken)).toBeNull();
    expect(runtime.getStore()!.getUserByEmail(owner.user.email)).toBeNull();
    expect(runtime.getStore()!.getUserByEmail('candidate@example.test')?.userId).toBe(owner.user.userId);
    expect(runtime.getStore()!.getUserById(owner.user.userId)?.username).toBe(owner.user.username);
  });
  test('phone remains absent until configured, stored unverified, and provider readiness is truthful', async () => {
    const f = setup(); const owner = await f.register();
    const initial = await f.request('GET', '/auth/profile/contacts', undefined, owner.accessToken);
    expect(initial.body.phone.state).toBe('absent'); expect(initial.body.capabilities.phone.verifyReady).toBe(false);
    const stored = await f.request('PATCH', '/auth/profile/contacts/phone', { expectedRevision: 1, phone: '+12025550123' }, owner.accessToken);
    expect(stored.status).toBe(200); expect(stored.body.phone).toMatchObject({ value: '+12025550123', state: 'unverified' });
    expect((await f.request('POST', '/auth/profile/contacts/phone/verify', { expectedRevision: 2 }, owner.accessToken)).status).toBe(503);
    expect((await f.request('PATCH', '/auth/profile/contacts/phone', { expectedRevision: 1, phone: null }, owner.accessToken)).status).toBe(409);
    expect((await f.request('PATCH', '/auth/profile/contacts/phone', { expectedRevision: 2, phone: '2025550123' }, owner.accessToken)).status).toBe(422);
    const cleared = await f.request('PATCH', '/auth/profile/contacts/phone', { expectedRevision: 2, phone: null }, owner.accessToken);
    expect(cleared.body.phone.state).toBe('absent');
  });
  test('native read scopes neither disclose phone nor grant writes; explicit contacts consent remains bounded', async () => {
    const f = setup(); const owner = await f.register(); const runtime = f.getRuntime();
    await f.request('PATCH', '/auth/profile/contacts/phone', { expectedRevision: 1, phone: '+12025550123' }, owner.accessToken);
    const sessions = new NativeSessionStore(f.db);
    const issue = async (scopes: string[]) => {
      const prepared = prepareNativeSession({ userId: owner.user.userId, clientId: 'contact-native', scope: scopes.join(' '),
        authGeneration: runtime.getStore()!.getAuthGeneration(owner.user.userId), ttlMs: 3_600_000,
        authority: { scopeKind: 'application', scopeId: 'application', tenantId: null, membershipId: null,
          tenantAuthorizationGeneration: null, membershipAuthorizationGeneration: null } });
      expect(sessions.consumeCodeAndInsert(() => true, prepared.session)).toBe(true);
      const accessToken = await runtime.getTokenService()!.signNativeAccessToken(owner.user, 'contact-native', scopes.join(' '),
        runtime.getStore()!.getAuthGeneration(owner.user.userId), prepared.session.familyId);
      return { accessToken };
    };
    const readonly = await issue(['openid', 'profile']);
    const redacted = await f.request('GET', '/auth/profile/contacts', undefined, readonly.accessToken);
    expect(redacted.status).toBe(200); expect(redacted.body.email).toBeNull(); expect(redacted.body.phone).toBeNull();
    expect((await f.request('PATCH', '/auth/profile/contacts/phone', { expectedRevision: 2, phone: null }, readonly.accessToken)).status).toBe(403);
    const writable = await issue(['openid', 'profile', 'phone', 'contacts:write']);
    expect((await f.request('GET', '/auth/profile/contacts', undefined, writable.accessToken)).body.email).toBeNull();
    expect((await f.request('PATCH', '/auth/profile/contacts/phone', { expectedRevision: 2, phone: null }, writable.accessToken)).status).toBe(200);
  });
  test('managed forbidden migration is blocked, and disabled outer profile cannot enable contacts', async () => {
    const blocked = setup({ schemaAllowed: false }); const owner = await blocked.register();
    const result = await blocked.request('GET', '/auth/profile/contacts', undefined, owner.accessToken);
    expect(result.status).toBe(503); expect(result.body.code).toBe('AUTH_CONTACT_NOT_READY');
    expect((await blocked.request('GET', '/auth/config')).body.userProfile.contacts.state).toBe('blocked');
    expect(blocked.db.prepare("SELECT 1 FROM sqlite_master WHERE name = '_auth_user_contacts'").get()).toBeNull();
    const disabled = setup({ profile: { enabled: false, contacts: { enabled: true, email: { verify: true } } } });
    const user = await disabled.register();
    expect((await disabled.request('GET', '/auth/profile/contacts', undefined, user.accessToken)).status).toBe(403);
    expect((await disabled.request('GET', '/auth/config')).body.userProfile.contacts.state).toBe('disabled');
  });
  test('revocation during the final tracked email write rolls back token consumption and candidate activation', async () => {
    const f = setup(); const owner = await f.register(); const runtime = f.getRuntime();
    await f.request('POST', '/auth/profile/contacts/email/change', { expectedRevision: 1,
      email: 'revoked-candidate@example.test', currentPassword: 'password123' }, owner.accessToken);
    await runtime.getAuthEmailOutbox()!.processDue(); const token = deliveredContactToken(f.provider);
    const original = runtime.getTokenService()!.resolveAuthContextAuthority.bind(runtime.getTokenService()!);
    let rejected = false;
    const remove = registerReactiveDBMutationInterceptor(f.db, ({ change }) => {
      if (change.table !== 'users' || change.op !== 'UPDATE') return;
      if (runtime.getStore()!.getUserById(owner.user.userId)?.email === 'revoked-candidate@example.test') {
        rejected = true; runtime.getTokenService()!.resolveAuthContextAuthority = () => null;
      }
    });
    try { expect((await f.request('POST', '/auth/profile/contacts/email/complete', { token })).status).toBe(409); }
    finally { remove(); runtime.getTokenService()!.resolveAuthContextAuthority = original; }
    expect(rejected).toBe(true); expect(runtime.getStore()!.getUserById(owner.user.userId)?.email).toBe(owner.user.email);
    expect(runtime.getActionTokenService()!.inspect(token, ['profile_contact_verification']).record.consumedAt).toBeNull();
  });
});

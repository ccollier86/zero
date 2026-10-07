import { afterEach, describe, expect, test } from 'bun:test';
import { createReactiveDB } from '../sync/reactive-db';
import { defineAuthTables } from './auth-schema';
import { UserStore } from './user-store';
import { normalizeAuthUserProfile } from './auth-config-user-profile';
import { inspectInstalledUserProfilePolicy, isUserProfilePolicyReady, reconcileUserProfilePolicy,
  userProfilePolicyFingerprint } from './auth-user-profile-policy';
import { AuthUserProfileCompletionStore } from './auth-user-profile-completion-store';
import { profileCompletionPolicyFingerprint } from './auth-user-profile-completion-policy';
import { contactFixture } from './auth-user-contact.test-fixture';
import { registerReactiveDBMutationInterceptor } from '../sync/reactive-db-mutation-interceptor';
import type { PhoneVerificationAdapter } from './auth-user-contact-types';
import { nativeProfileCompletionError } from './oidc/native-profile-completion-admission';
import { AuthError } from './types';

const fixtures: ReturnType<typeof contactFixture>[] = [];
afterEach(async () => { for (const f of fixtures.splice(0).reverse()) await f.close(); });
const setup = (...args: Parameters<typeof contactFixture>) => { const f = contactFixture(...args); fixtures.push(f); return f; };
const changed = { fields: { firstName: { editable: false } } } as const;

describe('bootstrap-owned optional profile policy generation', () => {
  test('same policy is idempotent; A→B→A never reactivates the old A guard', () => {
    const db = createReactiveDB({ mode: 'memory' });
    try {
      defineAuthTables(db); const users = new UserStore(db);
      const a = normalizeAuthUserProfile(), b = normalizeAuthUserProfile(changed);
      expect(inspectInstalledUserProfilePolicy(db)).toBeNull();
      const first = reconcileUserProfilePolicy(db, users, a);
      const original = inspectInstalledUserProfilePolicy(db)!;
      const repeated = reconcileUserProfilePolicy(db, users, a);
      expect(inspectInstalledUserProfilePolicy(db)).toEqual(original); first.assertCurrent(); repeated.assertCurrent();
      const second = reconcileUserProfilePolicy(db, users, b);
      expect(inspectInstalledUserProfilePolicy(db)!.generation).toBe(2);
      expect(first.assertCurrent).toThrow(expect.objectContaining({ code: 'AUTH_PROFILE_POLICY_CHANGED' }));
      const third = reconcileUserProfilePolicy(db, users, a);
      expect(inspectInstalledUserProfilePolicy(db)!.generation).toBe(3); third.assertCurrent();
      expect(first.assertCurrent).toThrow(expect.objectContaining({ code: 'AUTH_PROFILE_POLICY_CHANGED' }));
      expect(second.assertCurrent).toThrow(expect.objectContaining({ code: 'AUTH_PROFILE_POLICY_CHANGED' }));
      users.setUserProfilePolicyGuard(first.assertCurrent);
      expect(isUserProfilePolicyReady(users)).toBe(false); expect(() => users.assertCurrentProfile()).not.toThrow();
      // Arbitrary reader construction cannot adopt a policy or revive an issuer.
      const before = db.prepare('SELECT total_changes() AS count').get();
      new AuthUserProfileCompletionStore(db, users, b);
      expect(db.prepare('SELECT total_changes() AS count').get()).toEqual(before);
      expect(inspectInstalledUserProfilePolicy(db)!.generation).toBe(3);
    } finally { db.dispose(); }
  });
  test('blocked migration does not opportunistically create policy rows; malformed retained clocks fail closed', () => {
    const db = createReactiveDB({ mode: 'memory' });
    try {
      defineAuthTables(db, { profileSchemaInstallAllowed: false }); const users = new UserStore(db);
      const guard = reconcileUserProfilePolicy(db, users, normalizeAuthUserProfile());
      users.setUserProfilePolicyGuard(guard.assertCurrent);
      expect(isUserProfilePolicyReady(users)).toBe(false);
      expect(() => users.assertCurrentProfile()).not.toThrow();
      expect(db.prepare("SELECT 1 FROM sqlite_master WHERE name='_auth_user_profile_policy'").get()).toBeNull();
    } finally { db.dispose(); }
    const valid = createReactiveDB({ mode: 'memory' });
    try {
      defineAuthTables(valid); const users = new UserStore(valid);
      const guard = reconcileUserProfilePolicy(valid, users, normalizeAuthUserProfile());
      valid.prepare('UPDATE _auth_user_profile_policy SET policy_fingerprint=?').run('x'.repeat(64));
      expect(guard.assertCurrent).toThrow(expect.objectContaining({ code: 'AUTH_STATE_INVARIANT_FAILED' }));
      expect(() => reconcileUserProfilePolicy(valid, users, normalizeAuthUserProfile())).toThrow(expect.objectContaining({ code: 'AUTH_STATE_INVARIANT_FAILED' }));
    } finally { valid.dispose(); }
  });
  test('every resolved optional feature and nonsecret adapter identity participates, but completion identity remains separate', () => {
    const original = normalizeAuthUserProfile(); const fingerprint = userProfilePolicyFingerprint(original);
    for (const input of [{ enabled: false }, changed, { regional: true }, { contacts: { enabled: true } },
      { avatars: { enabled: true } }, { completion: { enabled: true } }] as const) {
      expect(userProfilePolicyFingerprint(normalizeAuthUserProfile(input))).not.toBe(fingerprint);
    }
    expect(userProfilePolicyFingerprint(original, 'adapter-one')).not.toBe(userProfilePolicyFingerprint(original, 'adapter-two'));
    expect(profileCompletionPolicyFingerprint(normalizeAuthUserProfile({ contacts: { enabled: true } })))
      .toBe(profileCompletionPolicyFingerprint(original));
    expect(nativeProfileCompletionError(new AuthError('Safe retirement', 'AUTH_PROFILE_POLICY_CHANGED', 409)))
      .toMatchObject({ code: 'temporarily_unavailable', status: 503 });
  });
  test('a newer real Guardian bootstrap retires ordinary profile writes/capabilities while unrelated auth stays usable', async () => {
    const a = setup(); const owner = await a.register();
    const b = setup({ db: a.db, disposeDbOnClose: false, profile: changed });
    // Lazy startup is triggered through the public capability endpoint.
    expect((await b.request('GET', '/auth/config')).status).toBe(200);
    const rejected = await a.request('PATCH', '/auth/profile', { expectedRevision: 1, changes: { firstName: 'Must not persist' } }, owner.accessToken);
    expect(rejected.status).toBe(409); expect(rejected.body.code).toBe('AUTH_PROFILE_POLICY_CHANGED');
    const oldCaps = await a.request('GET', '/auth/config');
    expect(oldCaps.status).toBe(200); expect(oldCaps.body.userProfile.state).toBe('blocked');
    expect(oldCaps.body.userProfile.fields.firstName.editable).toBe(false);
    expect((await a.request('GET', '/auth/me', undefined, owner.accessToken)).status).toBe(200);
    const current = await b.request('GET', '/auth/profile', undefined, owner.accessToken);
    expect(current.body.values.firstName).toBeNull(); expect(current.body.capabilities.fields.firstName.editable).toBe(false);
    const c = setup({ db: a.db, disposeDbOnClose: false }); expect((await c.request('GET', '/auth/config')).status).toBe(200);
    expect((await a.request('PATCH', '/auth/profile', { expectedRevision: 1, changes: { firstName: 'Still stale' } }, owner.accessToken)).status).toBe(409);
    expect((await c.request('PATCH', '/auth/profile', { expectedRevision: 1, changes: { firstName: 'Current runtime' } }, owner.accessToken)).status).toBe(200);
    expect(a.db.prepare('SELECT generation FROM _auth_user_profile_policy').get()).toEqual({ generation: 3 });
  });
  test('a policy change inside the final profile writer fence rolls back every accepted mutation', async () => {
    const f = setup({ profile: { fields: { bio: true }, regional: true } }); const owner = await f.register();
    const freshUsers = new UserStore(f.db);
    const remove = registerReactiveDBMutationInterceptor(f.db, ({ change }) => {
      if (change.table === 'users' && change.op === 'UPDATE') reconcileUserProfilePolicy(f.db, freshUsers, normalizeAuthUserProfile(changed));
    });
    try {
      const rejected = await f.request('PATCH', '/auth/profile', { expectedRevision: 1,
        changes: { firstName: 'Rollback', bio: 'Not accepted', regional: { locale: 'fr' } } }, owner.accessToken);
      expect(rejected.status).toBe(409); expect(rejected.body.code).toBe('AUTH_PROFILE_POLICY_CHANGED');
    } finally { remove(); }
    expect(f.db.prepare('SELECT first_name,profile_revision FROM users WHERE user_id=?').get(owner.user.userId))
      .toEqual({ first_name: null, profile_revision: 1 });
    expect(f.db.prepare('SELECT generation FROM _auth_user_profile_policy').get()).toEqual({ generation: 1 });
    expect(f.db.prepare('SELECT count(*) AS count FROM _auth_user_profiles').get()).toEqual({ count: 0 });
    expect(f.db.prepare('SELECT count(*) AS count FROM _auth_user_regional_preferences').get()).toEqual({ count: 0 });
    expect(f.events.query({ code: 'auth.user_profile.updated' }).events).toHaveLength(0);
  });
  test('old contact methods and delayed phone verification cannot commit after policy retirement', async () => {
    let entered!: () => void, accept!: (value: boolean) => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const adapter: PhoneVerificationAdapter = { id: 'synthetic-policy-phone', isReady: () => true,
      start: async () => ({ reference: 'synthetic-private-reference' }),
      verify: async () => { entered(); return await new Promise<boolean>(resolve => { accept = resolve; }); } };
    const a = setup({ adapter }); const owner = await a.register();
    expect((await a.request('PATCH', '/auth/profile/contacts/phone', { expectedRevision: 1, phone: '+12025550123' }, owner.accessToken)).status).toBe(200);
    const pending = await a.request('POST', '/auth/profile/contacts/phone/verify', { expectedRevision: 2 }, owner.accessToken);
    const verification = a.request('POST', '/auth/profile/contacts/phone/complete', { expectedRevision: 3,
      challengeId: pending.body.phone.challengeId, code: 'accepted' }, owner.accessToken);
    await started;
    const b = setup({ db: a.db, disposeDbOnClose: false, adapter,
      profile: { contacts: { enabled: true, phone: { enabled: true, editable: false, verify: true } } } });
    expect((await b.request('GET', '/auth/config')).status).toBe(200); accept(true);
    const rejected = await verification; expect(rejected.status).toBe(409); expect(rejected.body.code).toBe('AUTH_PROFILE_POLICY_CHANGED');
    expect(a.db.prepare('SELECT phone_proved_at FROM _auth_user_contacts WHERE user_id=?').get(owner.user.userId)).toEqual({ phone_proved_at: null });
    expect((await a.request('POST', '/auth/profile/contacts/email/verify', { expectedRevision: 3 }, owner.accessToken)).status).toBe(409);
    const caps = await a.request('GET', '/auth/config');
    expect(caps.body.userProfile.contacts.state).toBe('blocked'); expect(caps.body.userProfile.contacts.phone.verifyReady).toBe(false);
    expect(fingerprintOnly(a.db)).toBe(userProfilePolicyFingerprint(normalizeAuthUserProfile({ contacts: { enabled: true, phone: { enabled: true, editable: false, verify: true } } }), adapter.id));
  });
});

function fingerprintOnly(db: ReturnType<typeof createReactiveDB>): string {
  return inspectInstalledUserProfilePolicy(db)!.policy_fingerprint;
}

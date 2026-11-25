/** Managed config/context/policy generation checks; all data and fixtures stay in MEMORY. */
import { expect, test } from 'bun:test';
import { createReactiveDB } from '../../sync/reactive-db';
import { defineAuthTables } from '../../auth/auth-schema';
import { UserStore } from '../../auth/user-store';
import { resolveAuthBehaviorConfig } from '../../auth/auth-config';
import { normalizeAuthUserProfile } from '../../auth/auth-config-user-profile';
import { createAuthorizationKernel } from '../../auth/authorization-kernel';
import { reconcileUserProfilePolicy, userProfilePolicyFingerprint } from '../../auth/auth-user-profile-policy';
import { ZeroAppRuntime } from '../../runtime/zero-app-runtime';
import { ZERO_AUTH_STORE, ZERO_AUTHORIZATION_KERNEL, ZERO_SYNC_DB } from '../../runtime/service-keys';
import { managedUserAvatarReadContext } from './app-user-avatar-read-policy';
import { resolveConfig } from './types';

test('managed config admits a detached runtime-only avatar policy without serializing its callback as behavior', () => {
  const policy = { id: 'synthetic-photo-access', version: '1', authorize: () => true };
  const config = resolveConfig({ db: { mode: 'memory' }, tables: {}, workflows: false, auth: {
    bootstrap: 'public', userProfile: { avatars: true }, userAvatarReadPolicy: policy,
  } });
  if (config.auth === false) throw new Error('Synthetic auth missing');
  const admitted = config.auth.userAvatarReadPolicy!;
  expect(admitted).not.toBe(policy); expect(Object.isFrozen(admitted)).toBe(true);
  policy.version = '2'; policy.authorize = () => false;
  expect(admitted.version).toBe('1'); expect(admitted.authorize({} as never)).toBe(true);
  for (const value of [null, true, {}, { ...policy, version: '' }, { ...policy, authorize: 1 }]) {
    expect(() => resolveConfig({ db: { mode: 'memory' }, tables: {}, auth: { userAvatarReadPolicy: value as never } })).toThrow();
  }
});

test('policy identity is bootstrap-owned, omission keeps the exact old fingerprint, and A→B→A cannot revive an old reader', () => {
  const db = createReactiveDB({ mode: 'memory' });
  try {
    db.exec('PRAGMA temp_store=MEMORY'); defineAuthTables(db); const users = new UserStore(db), profile = normalizeAuthUserProfile({ avatars: true });
    const legacy = new Bun.CryptoHasher('sha256').update(JSON.stringify({ enabled: profile.enabled, usernameMode: profile.usernameMode,
      fields: profile.fields, regional: profile.regional, contacts: profile.contacts, avatars: profile.avatars,
      completion: profile.completion, phoneAdapterId: null })).digest('hex');
    expect(userProfilePolicyFingerprint(profile)).toBe(legacy);
    const a = { id: 'synthetic-photo-access', version: '1' }, b = { ...a, version: '2' };
    const first = reconcileUserProfilePolicy(db, users, profile, null, undefined, a); first.assertCurrent();
    const same = reconcileUserProfilePolicy(db, users, profile, null, undefined, a); same.assertCurrent();
    const second = reconcileUserProfilePolicy(db, users, profile, null, undefined, b); second.assertCurrent();
    expect(first.assertCurrent).toThrow(expect.objectContaining({ code: 'AUTH_PROFILE_POLICY_CHANGED' }));
    const third = reconcileUserProfilePolicy(db, users, profile, null, undefined, a); third.assertCurrent();
    expect(first.assertCurrent).toThrow(); expect(second.assertCurrent).toThrow();
    expect(db.prepare('SELECT generation FROM _auth_user_profile_policy').get()).toEqual({ generation: 3 });
    expect(userProfilePolicyFingerprint(profile, null, a)).not.toBe(legacy);
  } finally { db.dispose(); }
});

test('managed peer policy gets application-only reads and current Guardian checks, never a SYSTEM writer', async () => {
  const system = createReactiveDB({ mode: 'memory' }), app = createReactiveDB({ mode: 'memory' }), runtime = new ZeroAppRuntime('synthetic-avatar-read-context');
  try {
    system.exec('PRAGMA temp_store=MEMORY'); app.exec('PRAGMA temp_store=MEMORY'); defineAuthTables(system);
    const users = new UserStore(system), kernel = createAuthorizationKernel(resolveAuthBehaviorConfig());
    for (const id of ['viewer', 'subject']) system.prepare("INSERT INTO users(user_id,username,email,role,status,created_at) VALUES(?,?,?,'user','active',1)")
      .run(id, id + '-login', id + '@example.test');
    app.defineTable('photo_relationships', { id: 'TEXT PRIMARY KEY', subject_id: 'TEXT NOT NULL' });
    app.create('photo_relationships', { id: 'viewer', subject_id: 'subject' });
    runtime.set(ZERO_AUTH_STORE, users); runtime.set(ZERO_AUTHORIZATION_KERNEL, kernel); runtime.set(ZERO_SYNC_DB, app);
    let current = true;
    const context = managedUserAvatarReadContext(runtime, { userId: 'viewer', email: 'viewer@example.test', role: 'user',
      sessionScopeKind: 'application', sessionScopeId: 'application' }, 'subject', () => { if (!current) throw new Error('Retired synthetic context'); });
    expect(context.scope.scopeKind).toBe('application'); expect(context.viewerId).toBe('viewer'); expect(context.subjectId).toBe('subject');
    expect(Object.keys(context.db).sort()).toEqual(['get', 'query']);
    expect(context.db.get('photo_relationships', 'viewer')?.subject_id).toBe('subject');
    expect(() => context.db.query('users')).toThrow();
    expect(context.allows('viewer', 'user')).toBe(true); expect(context.allows('viewer', 'admin')).toBe(false);
    expect(context.allows('missing', 'user')).toBe(false);
    system.prepare("UPDATE users SET status='suspended' WHERE user_id='subject'").run();
    expect(context.allows('subject', 'user')).toBe(false);
    current = false; expect(() => context.db.get('photo_relationships', 'viewer')).toThrow(); expect(() => context.allows('viewer', 'user')).toThrow();
  } finally { await runtime.dispose(); app.dispose(); system.dispose(); }
});

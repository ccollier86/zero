import { afterEach, describe, expect, test } from 'bun:test';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { defineAuthTables } from './auth-schema';
import { AuthUserProfileStore } from './auth-user-profile-store';
import { UserStore } from './user-store';
import { captureUserProfileUpdate } from './auth-user-profile-validation';

const databases: ReactiveDB[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.dispose(); });

async function setup() {
  const db = createReactiveDB({ mode: 'memory' }); databases.push(db);
  defineAuthTables(db);
  const users = new UserStore(db);
  const user = await users.createUser({ username: 'profile-owner', email: 'owner@example.test',
    password: 'password123', firstName: 'Initial', lastName: 'Owner' });
  const profiles = new AuthUserProfileStore(db, users);
  return { db, users, user, profiles };
}

describe('global profile persistence', () => {
  test('fresh nullable values and explicit app-default regional overrides do not backfill identity', async () => {
    const { profiles, user, db } = await setup();
    expect(profiles.read(user.userId)).toMatchObject({ revision: 1, values: {
      firstName: 'Initial', preferredName: null, socialLinks: [], regional: {
        locale: null, timeZone: null, timeFormat: null, weekStartsOn: null } } });
    expect(db.prepare('SELECT count(*) AS count FROM _auth_user_profiles').get()).toEqual({ count: 0 });
  });

  test('compound core/extended/region save advances exactly one shared revision and tracks canonical user row', async () => {
    const { profiles, user, db } = await setup();
    const received: unknown[] = [];
    db.onChange(change => { received.push(change); });
    const accepted = profiles.update(user.userId, { expectedRevision: 1, changes: {
      firstName: ' Updated ', lastName: null, preferredName: ' Preferred ', bio: 'About me',
      website: 'https://example.test', socialLinks: [{ label: ' Work ', url: 'https://work.test' }],
      regional: { locale: 'fr-FR', timeZone: 'Europe/Paris', timeFormat: '24h', weekStartsOn: 1 },
    } }, () => {});
    expect(accepted.revision).toBe(2);
    expect(accepted.values).toMatchObject({ firstName: 'Updated', lastName: null, preferredName: 'Preferred',
      website: 'https://example.test/', socialLinks: [{ label: 'Work', url: 'https://work.test/' }] });
    expect(received).toContainEqual(expect.objectContaining({ table: 'users', row: expect.objectContaining({ profile_revision: 2 }) }));
    expect(profiles.read(user.userId)).toEqual(accepted);
  });

  test('existing administrator/direct core changes advance the same CAS and reject stale self edits', async () => {
    const { profiles, user, users, db } = await setup();
    users.updateUser(user.userId, { firstName: 'Administrator' });
    expect(profiles.read(user.userId).revision).toBe(2);
    expect(() => profiles.update(user.userId, { expectedRevision: 1, changes: { bio: 'stale' } }, () => {}))
      .toThrow(expect.objectContaining({ code: 'AUTH_PROFILE_REVISION_CONFLICT' }));
    expect(profiles.read(user.userId).values.bio).toBeNull();
    users.updateUser(user.userId, { firstName: 'Administrator', status: 'active' });
    expect(profiles.read(user.userId).revision).toBe(2);
    db.prepare('UPDATE users SET username = ? WHERE user_id = ?').run('changed-directly', user.userId);
    expect(profiles.read(user.userId).revision).toBe(3);
  });

  test('final authority rejection rolls back core/extended/region writes and tracked delivery', async () => {
    const { profiles, user, db } = await setup();
    const before = profiles.read(user.userId);
    let calls = 0;
    const received: unknown[] = []; db.onChange(change => { received.push(change); });
    expect(() => profiles.update(user.userId, { expectedRevision: 1, changes: { firstName: 'Late', bio: 'No commit', regional: { locale: 'fr' } } },
      () => { if (++calls === 2) throw new Error('revoked'); })).toThrow('revoked');
    expect(profiles.read(user.userId)).toEqual(before);
    expect(received).toEqual([]);
    expect(db.prepare('SELECT count(*) AS count FROM _auth_user_profiles').get()).toEqual({ count: 0 });
  });

  test('thenable authority, malformed retained values and forged fields fail closed', async () => {
    const { profiles, user, db } = await setup();
    expect(() => profiles.update(user.userId, { expectedRevision: 1, changes: { bio: 'No commit' } },
      (async () => { throw new Error('private'); }) as never)).toThrow(expect.objectContaining({ code: 'AUTH_STATE_INVARIANT_FAILED' }));
    await Promise.resolve();
    expect(profiles.read(user.userId).revision).toBe(1);
    expect(() => captureUserProfileUpdate({ expectedRevision: 1, changes: { roles: ['admin'] } }))
      .toThrow(expect.objectContaining({ code: 'AUTH_PROFILE_VALIDATION_FAILED' }));
    db.prepare(`INSERT INTO _auth_user_profiles (user_id, social_links_json, updated_at) VALUES (?, ?, 1)`).run(user.userId, '{}');
    expect(() => profiles.read(user.userId)).toThrow(expect.objectContaining({ code: 'AUTH_STATE_INVARIANT_FAILED' }));
  });

  test('field accessors, proxies, unsafe URLs, excessive text and invalid regional settings are rejected without getters', () => {
    let invoked = false;
    const changes = Object.defineProperty({}, 'bio', { enumerable: true, get() { invoked = true; return 'private'; } });
    const revoked = Proxy.revocable({}, {}); revoked.revoke();
    for (const input of [changes, revoked.proxy, { bio: 'x'.repeat(2001) }, { preferredName: '\ud800' },
      { website: 'javascript:alert(1)' }, { website: 'https://user:password@example.test' },
      { regional: { weekStartsOn: 7 } }, { regional: { timeZone: 'not/a-zone' } },
      { socialLinks: Array.from({ length: 13 }, () => ({ label: 'Link', url: 'https://example.test' })) }]) {
      expect(() => captureUserProfileUpdate({ expectedRevision: 1, changes: input }))
        .toThrow(expect.objectContaining({ code: 'AUTH_PROFILE_VALIDATION_FAILED' }));
    }
    expect(invoked).toBe(false);
  });
});

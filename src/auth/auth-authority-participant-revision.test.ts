/** Memory-only authority-clock qualification; no file-backed commit/fence claim. */
import { expect, test } from 'bun:test';
import { createReactiveDB } from '../sync/reactive-db';
import { installAuthAuthorityRevision, inspectAuthAuthorityRevisionSchema, readAuthAuthorityRevision } from './auth-authority-revision';
import { defineAuthTables } from './auth-schema';
import { UserStore } from './user-store';
import { AuthActionTokenService } from './action-token-service';

test('provisioning marker-only admission changes advance authority and rolled-back changes do not', () => {
  const db = createReactiveDB({ mode: 'memory' });
  try {
    // The marker clock has no dependence on account creation or profile changes.
    db.exec(`CREATE TABLE _auth_registration_provisioning(marker_id TEXT PRIMARY KEY,user_id TEXT,lease_expires_at INTEGER);
      CREATE TABLE _auth_admin_user_provisioning(marker_id TEXT PRIMARY KEY,user_id TEXT,lease_expires_at INTEGER)`);
    installAuthAuthorityRevision(db);
    expect(inspectAuthAuthorityRevisionSchema(db)).toBe('ready');
    for (const table of ['_auth_registration_provisioning', '_auth_admin_user_provisioning']) {
      const before = readAuthAuthorityRevision(db)!;
      db.prepare(`INSERT INTO ${table} VALUES ('marker','selected-account',1)`).run();
      expect(readAuthAuthorityRevision(db)).toBe(before + 1);
      db.prepare(`UPDATE ${table} SET lease_expires_at=2`).run();
      expect(readAuthAuthorityRevision(db)).toBe(before + 1);
      db.prepare(`UPDATE ${table} SET user_id='other-account'`).run();
      expect(readAuthAuthorityRevision(db)).toBe(before + 2);
      expect(() => db.transaction(() => {
        db.prepare(`UPDATE ${table} SET user_id='selected-account'`).run();
        expect(readAuthAuthorityRevision(db)).toBe(before + 3);
        throw new Error('synthetic marker rollback');
      })).toThrow('synthetic marker rollback');
      expect(readAuthAuthorityRevision(db)).toBe(before + 2);
      expect(db.prepare(`SELECT user_id FROM ${table}`).get()).toEqual({ user_id: 'other-account' });
      db.prepare(`DELETE FROM ${table}`).run();
      expect(readAuthAuthorityRevision(db)).toBe(before + 3);
    }
  } finally { db.dispose(); }
});

test('additive marker trigger installation preserves the existing clock and detects a stale final-edge capture', () => {
  const db = createReactiveDB({ mode: 'memory' });
  try {
    installAuthAuthorityRevision(db);
    db.prepare('UPDATE _auth_authority_revision SET revision=73').run();
    db.exec('CREATE TABLE _auth_registration_provisioning(user_id TEXT PRIMARY KEY)');
    expect(inspectAuthAuthorityRevisionSchema(db)).toBe('missing');
    installAuthAuthorityRevision(db);
    expect(readAuthAuthorityRevision(db)).toBe(73);
    const capturedBeforeSubjectCheck = readAuthAuthorityRevision(db);
    expect(db.prepare("SELECT 1 FROM _auth_registration_provisioning WHERE user_id='selected-account'").get()).toBeNull();
    // Simulated interleaving only: the physical file-backed actor edge is a
    // separate required qualification, prohibited during the integrity hold.
    db.prepare("INSERT INTO _auth_registration_provisioning VALUES ('selected-account')").run();
    expect(readAuthAuthorityRevision(db)).not.toBe(capturedBeforeSubjectCheck);
    expect(inspectAuthAuthorityRevisionSchema(db)).toBe('ready');
  } finally { db.dispose(); }
});

test('supported registration/admin marker finalization and adopted-account retirement work with authority trigger side effects', async () => {
  const db = createReactiveDB({ mode: 'memory' });
  try {
    defineAuthTables(db); const users = new UserStore(db); installAuthAuthorityRevision(db);
    const registered = await users.createRegistrationUser({ username: 'synthetic-registration', email: 'registration@example.test', password: 'synthetic-password1' },
      () => ({ role: 'admin', requireEmailVerification: false, mfaRequired: false }), undefined, { provisional: true });
    if (!registered.provisioning) throw new Error('Missing synthetic registration marker.');
    const beforeFinalization = readAuthAuthorityRevision(db)!;
    users.finalizeRegistrationProvisioning(registered.provisioning);
    expect(readAuthAuthorityRevision(db)).toBeGreaterThan(beforeFinalization);
    expect(db.prepare('SELECT 1 FROM _auth_registration_provisioning').get()).toBeNull();

    const provision = (suffix: string) => users.createAdminProvisionedUser({ username: 'synthetic-' + suffix,
      email: suffix + '@example.test', password: 'synthetic-password1' },
    { actor: { userId: registered.user.userId, provenance: 'authenticated-request' }, setupRequested: true }, () => {});
    const finalized = await provision('finalized');
    const tokens = new AuthActionTokenService(users, '1h', '0s', null, (() => ({} as never)) as never);
    users.transaction(() => {
      const token = tokens.create({ userId: finalized.user.userId, type: 'account_setup', skipCooldown: true });
      users.bindAdminUserProvisioningSetupToken(finalized.provisioning, token.record.tokenId);
    });
    const beforeAdminFinalization = readAuthAuthorityRevision(db)!;
    users.finalizeAdminUserProvisioning(finalized.provisioning);
    expect(readAuthAuthorityRevision(db)).toBe(beforeAdminFinalization + 1);
    expect(db.prepare('SELECT 1 FROM _auth_admin_user_provisioning').get()).toBeNull();

    const adopted = await provision('adopted');
    users.updateUser(adopted.user.userId, { firstName: 'Changed canonical identity' });
    const beforeRetirement = readAuthAuthorityRevision(db)!;
    expect(users.rollbackAdminUserProvisioning(adopted.provisioning)).toBe(false);
    expect(readAuthAuthorityRevision(db)).toBe(beforeRetirement + 1);
    expect(users.getUserById(adopted.user.userId)?.firstName).toBe('Changed canonical identity');
    expect(db.prepare('SELECT 1 FROM _auth_admin_user_provisioning').get()).toBeNull();
  } finally { db.dispose(); }
});

test('a failed finalized registration activation rolls back both marker deletion and authority revision', async () => {
  const db = createReactiveDB({ mode: 'memory' });
  try {
    defineAuthTables(db);
    const users = new UserStore(db, { identityProjection: { userCreated() { throw new Error('synthetic activation failure'); } } });
    installAuthAuthorityRevision(db);
    const registered = await users.createRegistrationUser({ username: 'synthetic-registration', email: 'registration@example.test', password: 'synthetic-password1' },
      () => ({ role: 'admin', requireEmailVerification: false, mfaRequired: false }), undefined, { provisional: true });
    if (!registered.provisioning) throw new Error('Missing synthetic registration marker.');
    const before = readAuthAuthorityRevision(db);
    expect(() => users.finalizeRegistrationProvisioning(registered.provisioning!)).toThrow('synthetic activation failure');
    expect(readAuthAuthorityRevision(db)).toBe(before);
    expect(db.prepare('SELECT user_id FROM _auth_registration_provisioning').get()).toEqual({ user_id: registered.user.userId });
  } finally { db.dispose(); }
});

import { expect, test } from 'bun:test';

import { installAuthAuthorityRevision } from '../../auth/auth-authority-revision';
import { defineAuthTables } from '../../auth/auth-schema';
import { UserStore } from '../../auth/user-store';
import { AuthorityCommitCoordinator } from '../../databases/authority-commit-coordinator';
import { registerApplicationAuthorityCommitGuard } from '../../databases/database-application-authority-commit-guard';
import { registerDatabaseAuthorityCommitGuard } from '../../databases/database-authority-commit-guard';
import { defineTable, field } from '../../schema';
import { createReactiveDB } from '../../sync/reactive-db';
import { withReactiveDBCommitAdmission } from '../../sync/reactive-db-commit-admission';
import { createAppIdentityProjectionRuntime } from './identity-projection-runtime';

test('admitted first administrator and queued account commits finish identity projection before returning', async () => {
  const systemDB = createReactiveDB({ mode: 'memory' });
  const applicationDB = createReactiveDB({ mode: 'memory' });
  const coordinator = new AuthorityCommitCoordinator();
  const events: string[] = [];
  defineAuthTables(systemDB);
  installAuthAuthorityRevision(systemDB);
  const removeSystem = registerDatabaseAuthorityCommitGuard(systemDB, coordinator);
  const removeApplication = registerApplicationAuthorityCommitGuard(applicationDB, systemDB, coordinator);
  try {
    const credentials = defineTable('provider_credentials', {
      owner_user_id: field.guardianUser(),
      label: field.text(),
    }, { pk: 'credential_id' });
    const runtime = createAppIdentityProjectionRuntime({
      systemDB, applicationDB,
      tables: { provider_credentials: credentials.serverTable },
      tenancyMode: 'single', getDatabaseManager: () => null,
      emitCode: definition => { events.push(definition.code); return {} as never; },
    })!;
    await runtime.lifecycle.initialize?.();
    applicationDB.defineTable('provider_credentials', credentials.serverTable);
    const users = new UserStore(systemDB, { identityProjection: runtime.lifecycle });
    const owner = await users.createUser({
      username: 'projection-owner', email: 'owner@projection.test', password: 'Only-test-password-123',
    });
    expect(applicationDB.prepare('SELECT user_id FROM users WHERE user_id = ?').get(owner.userId))
      .toEqual({ user_id: owner.userId });
    expect(systemDB.prepare('SELECT status FROM _auth_identity_projection_targets WHERE target_id = ?').get('application'))
      .toEqual({ status: 'ready' });

    // All turns queue behind a held reader. This also catches granting the next
    // exclusive waiter before the current turn's synchronous callbacks finish.
    const shared = await coordinator.acquireShared();
    const committed: string[] = [];
    const operations = Array.from({ length: 6 }, (_, index) => withReactiveDBCommitAdmission(systemDB, () => {
      const userId = `queued-user-${index}`;
      systemDB.transaction(() => {
        systemDB.insert('users', {
          user_id: userId, username: userId, email: `${userId}@projection.test`,
          role: 'user', status: 'active', created_at: Date.now(),
        });
        runtime.lifecycle.userCreated(userId);
      });
      // The API must not report success while the anchor is missing/quarantined.
      expect(applicationDB.prepare('SELECT user_id FROM users WHERE user_id = ?').get(userId))
        .toEqual({ user_id: userId });
      committed.push(userId);
    }));
    shared.release();
    await Promise.all(operations);
    expect(committed).toEqual(Array.from({ length: 6 }, (_, index) => `queued-user-${index}`));
    expect(events).not.toContain('ZERO_AUTH_IDENTITY_PROJECTION_QUARANTINED');
    expect(systemDB.prepare('SELECT status FROM _auth_identity_projection_targets WHERE target_id = ?').get('application'))
      .toEqual({ status: 'ready' });

    applicationDB.insert('provider_credentials', {
      credential_id: 'credential-one', owner_user_id: owner.userId, label: 'Synthetic test credential',
    });
    expect(applicationDB.get('provider_credentials', 'credential-one')).toMatchObject({ owner_user_id: owner.userId });

    // Sharing the synchronous turn is not permission to see uncommitted auth
    // state or make a cross-file transaction appear atomic.
    const initialRole = users.getUserById(owner.userId)!.role;
    await expect(withReactiveDBCommitAdmission(systemDB, () => systemDB.transaction(() => {
      systemDB.prepare('UPDATE users SET role = ? WHERE user_id = ?')
        .run(initialRole === 'admin' ? 'user' : 'admin', owner.userId);
      applicationDB.insert('provider_credentials', {
        credential_id: 'must-rollback', owner_user_id: owner.userId, label: 'Uncommitted authority',
      });
    }))).rejects.toMatchObject({ code: 'DATABASE_AUTHORITY_CHANGED', outcome: 'not-committed' });
    expect(applicationDB.get('provider_credentials', 'must-rollback')).toBeNull();
    expect(users.getUserById(owner.userId)!.role).toBe(initialRole);
    expect(coordinator.diagnostics()).toMatchObject({ activeShared: 0, activeExclusive: false, pendingExclusive: 0 });
  } finally {
    removeApplication(); removeSystem();
    await coordinator.close();
    applicationDB.dispose(); systemDB.dispose();
  }
});

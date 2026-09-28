import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';

import { migrations } from './index';
import { Migrator } from './migrator';

test('migration 020 installs the durable authority revision and triggers', () => {
  const database = new Database(':memory:');
  const migrator = new Migrator({
    database,
    dbPath: ':memory:',
    migrations,
    createBackups: false,
    log: () => {},
  });

  try {
    expect(migrator.run('019').at(-1)).toBe('019');
    expect(migrator.run('020')).toEqual(['020']);

    const table = database.query(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name = '_auth_authority_revision'
    `).get();
    expect(table).toEqual({ name: '_auth_authority_revision' });

    const triggerNames = (database.query(`
      SELECT name FROM sqlite_master
      WHERE type = 'trigger' AND name LIKE 'trg_zero_authority_%'
      ORDER BY name
    `).all() as Array<{ name: string }>).map((row) => row.name);
    expect(triggerNames).toEqual(expect.arrayContaining([
      'trg_zero_authority_users_update_v2',
      'trg_zero_authority__auth_sessions_update_v1',
      'trg_zero_authority__auth_tenants_update_v1',
      'trg_zero_authority__auth_tenant_memberships_update_v1',
      'trg_zero_authority__auth_application_role_assignments_update_v1',
      'trg_zero_authority__auth_tenant_membership_roles_update_v1',
      'trg_zero_authority__auth_native_sessions_update_v1',
    ]));

    const before = authorityRevision(database);
    database.query(`
      INSERT INTO users (
        user_id, username, email, role, status, created_at
      ) VALUES (?, ?, ?, 'user', 'active', ?)
    `).run('migration-user', 'migration-user', 'migration@example.test', Date.now());
    expect(authorityRevision(database)).toBe(before + 1);

    database.query('UPDATE users SET first_name = ? WHERE user_id = ?')
      .run('Cosmetic', 'migration-user');
    expect(authorityRevision(database)).toBe(before + 1);
    database.query("UPDATE users SET role = 'admin' WHERE user_id = ?")
      .run('migration-user');
    expect(authorityRevision(database)).toBe(before + 2);
    database.query('UPDATE users SET email_verified_at = ? WHERE user_id = ?')
      .run(Date.now(), 'migration-user');
    expect(authorityRevision(database)).toBe(before + 3);
    expect(database.query(`
      SELECT name FROM sqlite_master
      WHERE type = 'trigger' AND name = 'trg_zero_authority_users_update_v1'
    `).get()).toBeNull();

    const beforeSession = authorityRevision(database);
    const now = Date.now();
    database.query(`
      INSERT INTO _auth_sessions (
        session_id, user_id, kind, status, generation, scope_kind, scope_id,
        provenance, authenticated_at, created_at, last_seen_at, expires_at
      ) VALUES (?, ?, 'web', 'active', 0, 'application', 'application',
        'local', ?, ?, ?, ?)
    `).run('session-1', 'migration-user', now, now, now, now + 60_000);
    expect(authorityRevision(database)).toBe(beforeSession + 1);

    // Routine sliding-session touches must not wake and revalidate every
    // socket across every replica. Revocation/generation changes still do.
    database.query(`
      UPDATE _auth_sessions SET last_seen_at = ?, expires_at = ?
      WHERE session_id = ?
    `).run(now + 1_000, now + 61_000, 'session-1');
    expect(authorityRevision(database)).toBe(beforeSession + 1);
    database.query(`
      UPDATE _auth_sessions SET status = 'revoked', generation = generation + 1
      WHERE session_id = ?
    `).run('session-1');
    expect(authorityRevision(database)).toBe(beforeSession + 2);
  } finally {
    migrator.dispose();
    database.close();
  }
});

function authorityRevision(database: Database): number {
  return (database.query(`
    SELECT revision FROM _auth_authority_revision WHERE singleton = 1
  `).get() as { revision: number }).revision;
}

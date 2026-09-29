import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';

import { ensureTenantInvitationGrantSnapshotColumns } from '../auth/auth-tenant-onboarding-schema';
import { createReactiveDB } from '../sync/reactive-db';
import { migration } from './definitions/026_tenant_invitation_grant_snapshot';

test('migration 026 leaves legacy invitations fail-closed and protects new snapshots', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`
      CREATE TABLE _auth_tenant_invitations (
        invitation_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        email TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        role_keys_json TEXT NOT NULL,
        status TEXT NOT NULL,
        issued_by TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TRIGGER trg_auth_tenant_invitation_binding_immutable
      BEFORE UPDATE OF tenant_id, email, token_hash, role_keys_json, issued_by
      ON _auth_tenant_invitations
      BEGIN
        SELECT RAISE(ABORT, 'AUTH_TENANT_INVITATION_BINDING_IMMUTABLE');
      END;
      INSERT INTO _auth_tenant_invitations VALUES (
        'legacy', 'tenant', 'person@example.test', 'hash', '["member"]',
        'pending', 'owner', 99, 1, 1
      );
    `);

    migration.up(db);
    migration.up(db);

    expect(db.query(`
      SELECT grant_snapshot_json, grant_snapshot_fingerprint
      FROM _auth_tenant_invitations WHERE invitation_id = 'legacy'
    `).get()).toEqual({
      grant_snapshot_json: null,
      grant_snapshot_fingerprint: null,
    });
    expect(() => db.query(`
      UPDATE _auth_tenant_invitations SET grant_snapshot_json = '{}'
      WHERE invitation_id = 'legacy'
    `).run()).toThrow('AUTH_TENANT_INVITATION_BINDING_IMMUTABLE');
  } finally {
    db.close();
  }
});

test('migration 026 stays in parity with the runtime legacy-table repair', () => {
  const migrated = new Database(':memory:');
  const runtimeRaw = new Database(':memory:');
  const runtime = createReactiveDB({ database: runtimeRaw });
  try {
    defineLegacyInvitationTable(migrated);
    defineLegacyInvitationTable(runtimeRaw);

    migration.up(migrated);
    ensureTenantInvitationGrantSnapshotColumns(runtime);

    expect(invitationColumns(migrated)).toEqual(invitationColumns(runtimeRaw));
    expect(invitationBindingTrigger(migrated))
      .toBe(invitationBindingTrigger(runtimeRaw));
  } finally {
    runtime.dispose();
    runtimeRaw.close();
    migrated.close();
  }
});

function defineLegacyInvitationTable(db: Database): void {
  db.exec(`
    CREATE TABLE _auth_tenant_invitations (
      invitation_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      email TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      role_keys_json TEXT NOT NULL,
      status TEXT NOT NULL,
      issued_by TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TRIGGER trg_auth_tenant_invitation_binding_immutable
    BEFORE UPDATE OF tenant_id, email, token_hash, role_keys_json, issued_by
    ON _auth_tenant_invitations
    BEGIN
      SELECT RAISE(ABORT, 'AUTH_TENANT_INVITATION_BINDING_IMMUTABLE');
    END;
  `);
}

function invitationColumns(db: Database): Array<[string, string, number]> {
  return (db.query('PRAGMA table_info(_auth_tenant_invitations)').all() as Array<{
    name: string;
    type: string;
    notnull: number;
  }>).map((column) => [column.name, column.type, column.notnull]);
}

function invitationBindingTrigger(db: Database): string {
  const row = db.query(`
    SELECT sql FROM sqlite_master
    WHERE type = 'trigger'
      AND name = 'trg_auth_tenant_invitation_binding_immutable'
  `).get() as { sql: string };
  return row.sql.toLowerCase().replace(/\s+/g, '').replaceAll('"', '');
}

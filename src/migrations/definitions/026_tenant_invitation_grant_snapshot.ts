/** Freeze the authority ceiling approved when a tenant invitation is issued. */

import type { Database } from 'bun:sqlite';
import type { Migration } from '../types';

export const migration: Migration = {
  version: '026',
  description: 'Tenant invitation issuance-time grant snapshots',
  safety: 'safe',
  backupRequired: false,

  up(db: Database) {
    const table = db.query(`SELECT 1 FROM sqlite_master
      WHERE type = 'table' AND name = '_auth_tenant_invitations'`).get();
    if (!table) return;
    ensureGrantSnapshotColumns(db);
    // Existing pending bearers deliberately remain NULL and therefore cannot
    // be accepted. Reissuing proves a current manager approved the live grant.
  },
};

/** Keep the historical migration independent from mutable runtime schema code. */
function ensureGrantSnapshotColumns(db: Database): void {
  const columns = db.query('PRAGMA table_info(_auth_tenant_invitations)')
    .all() as Array<{ name: string }>;
  const names = new Set(columns.map((column) => column.name));
  if (!names.has('grant_snapshot_json')) {
    db.exec('ALTER TABLE _auth_tenant_invitations ADD COLUMN grant_snapshot_json TEXT');
  }
  if (!names.has('grant_snapshot_fingerprint')) {
    db.exec(`ALTER TABLE _auth_tenant_invitations
      ADD COLUMN grant_snapshot_fingerprint TEXT`);
  }

  db.exec('DROP TRIGGER IF EXISTS trg_auth_tenant_invitation_binding_immutable');
  db.exec(`
    CREATE TRIGGER trg_auth_tenant_invitation_binding_immutable
    BEFORE UPDATE OF tenant_id, email, token_hash, role_keys_json,
      grant_snapshot_json, grant_snapshot_fingerprint, issued_by
    ON _auth_tenant_invitations
    BEGIN
      SELECT RAISE(ABORT, 'AUTH_TENANT_INVITATION_BINDING_IMMUTABLE');
    END
  `);
}

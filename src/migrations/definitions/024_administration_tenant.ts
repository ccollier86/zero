/** Establish the protected administration-organization discriminator. */

import type { Database } from 'bun:sqlite';
import type { Migration } from '../types';
import { replaceAuthorityUpdateTrigger } from './024_authority_revision_refresh';

export const migration: Migration = {
  version: '024',
  description: 'Protect the multi-tenant administration organization',
  safety: 'safe',
  backupRequired: false,

  up(db: Database) {
    const tenantTable = db.query(`SELECT 1 FROM sqlite_master
      WHERE type = 'table' AND name = '_auth_tenants'`).get();
    if (!tenantTable) return;

    const columns = db.query('PRAGMA table_info(_auth_tenants)').all() as Array<{
      name: string;
    }>;
    if (!columns.some((column) => column.name === 'kind')) {
      db.exec(`ALTER TABLE _auth_tenants
        ADD COLUMN kind TEXT NOT NULL DEFAULT 'organization'
        CHECK (kind IN ('organization', 'administration'))`);
    }

    // New installs persist kind at creation. An earlier candidate can be
    // adopted automatically only when append-only audit contains one exact
    // bootstrap tenant-created receipt. Anything absent or ambiguous remains
    // an ordinary organization for explicit adoptTenantId reconciliation.
    const auditTable = db.query(`SELECT 1 FROM sqlite_master
      WHERE type = 'table' AND name = '_auth_audit_events'`).get();
    const administration = db.query(`SELECT tenant_id FROM _auth_tenants
      WHERE kind = 'administration' LIMIT 1`).get();
    if (auditTable && !administration) {
      const candidates = db.query(`
        SELECT DISTINCT audit.target_id AS tenant_id
        FROM _auth_audit_events audit
        INNER JOIN _auth_tenants tenant ON tenant.tenant_id = audit.target_id
        INNER JOIN _auth_tenant_memberships membership
          ON membership.tenant_id = tenant.tenant_id
          AND membership.user_id = audit.actor_user_id
          AND membership.status = 'active'
          AND membership.role_key = 'owner'
        WHERE audit.action = 'tenant.created'
          AND audit.outcome = 'succeeded'
          AND audit.scope_kind = 'tenant'
          AND audit.tenant_id = audit.target_id
          AND audit.actor_provenance = 'bootstrap'
          AND audit.target_type = 'tenant'
          AND tenant.status = 'active'
        ORDER BY audit.target_id ASC
        LIMIT 2
      `).all() as Array<{ tenant_id: string }>;
      if (candidates.length === 1) {
        db.query(`UPDATE _auth_tenants SET kind = 'administration'
          WHERE tenant_id = ? AND kind = 'organization'`).run(
          candidates[0]!.tenant_id,
        );
      }
    }

    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_tenants_administration
      ON _auth_tenants(kind) WHERE kind = 'administration'`);
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_auth_administration_tenant_kind_immutable
      BEFORE UPDATE OF kind ON _auth_tenants
      WHEN OLD.kind = 'administration'
        OR NEW.kind != 'administration'
        OR EXISTS (
          SELECT 1 FROM _auth_tenants existing
          WHERE existing.kind = 'administration'
            AND existing.tenant_id != OLD.tenant_id
        )
      BEGIN
        SELECT RAISE(ABORT, 'AUTH_ADMINISTRATION_TENANT_PROTECTED');
      END
    `);
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_auth_administration_tenant_active
      BEFORE UPDATE OF status ON _auth_tenants
      WHEN OLD.kind = 'administration' AND NEW.status != 'active'
      BEGIN
        SELECT RAISE(ABORT, 'AUTH_ADMINISTRATION_TENANT_PROTECTED');
      END
    `);
    const provisioningTable = db.query(`SELECT 1 FROM sqlite_master
      WHERE type = 'table' AND name = '_auth_registration_provisioning'`).get();
    const provisionalBootstrapDelete = provisioningTable
      ? `AND NOT EXISTS (
          SELECT 1 FROM _auth_registration_provisioning provisioning
          WHERE provisioning.tenant_id = OLD.tenant_id
            AND provisioning.user_id = OLD.created_by
            AND provisioning.is_bootstrap = 1
        )`
      : '';
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_auth_administration_tenant_no_delete
      BEFORE DELETE ON _auth_tenants
      WHEN OLD.kind = 'administration'
        ${provisionalBootstrapDelete}
      BEGIN
        SELECT RAISE(ABORT, 'AUTH_ADMINISTRATION_TENANT_PROTECTED');
      END
    `);
    replaceAuthorityUpdateTrigger({
      db,
      table: '_auth_tenants',
      updateColumns: ['kind', 'status', 'authorization_generation'],
      version: 2,
    });
  },
};

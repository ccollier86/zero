/** Add server-owned tenant authority snapshots to native OAuth persistence. */

import type { Database } from 'bun:sqlite';
import { ensureNativeTenantAuthorityColumns } from '../../auth/oidc/native-auth-schema-repair';
import type { Migration } from '../types';

export const migration: Migration = {
  version: '010',
  description: 'Tenant-bound native authorization and refresh families',
  safety: 'safe',

  up(db: Database) {
    ensureNativeTenantAuthorityColumns({
      exec: (sql) => db.exec(sql),
      prepare: (sql) => ({ all: () => db.query(sql).all() }),
    });
    db.run(`CREATE INDEX IF NOT EXISTS idx_auth_native_session_tenant
      ON _auth_native_sessions(tenant_id, user_id) WHERE tenant_id IS NOT NULL`);
  },
};

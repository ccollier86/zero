/**
 * Managed createApp composition for actor-backed tenant Sync.
 *
 * This adapter is intentionally server-internal. It converts the database
 * manager's persistent tenant binding into Sync's narrow data-plane contract
 * without accepting a database or tenant selector from the wire protocol.
 */

import {
  DatabaseError,
  type DatabaseManager,
} from '../../databases';
import type {
  SyncTenantDataPlane,
  SyncTenantDataPlaneBindContext,
  SyncTenantDataPlaneTable,
} from '../../sync/sync-tenant-data-plane';

export interface ManagedTenantSyncDatabaseManager {
  bindTenantSync(
    options: Parameters<DatabaseManager['bindTenantSync']>[0],
  ): ReturnType<DatabaseManager['bindTenantSync']>;
}

/**
 * Build the trusted app-local tenant plane. No actor is acquired here: each
 * WebSocket gets its persistent binding only when it first uses a tenant table.
 */
export function createManagedTenantSyncDataPlane(options: Readonly<{
  manager: ManagedTenantSyncDatabaseManager;
  tables: Readonly<Record<string, SyncTenantDataPlaneTable>>;
}>): SyncTenantDataPlane {
  return Object.freeze({
    tables: options.tables,
    async bind(context: SyncTenantDataPlaneBindContext) {
      const auth = context.authContext;
      const tenantId = auth.tenantId;
      if (auth.sessionScopeKind !== 'tenant'
        || typeof tenantId !== 'string'
        || tenantId.length === 0
        || auth.sessionScopeId !== tenantId
        || typeof auth.membershipId !== 'string'
        || auth.membershipId.length === 0) {
        throw new DatabaseError(
          'DATABASE_AUTHORITY_CHANGED',
          'Tenant database authority is unavailable.',
        );
      }

      return await options.manager.bindTenantSync({
        tenantId,
        assertCurrentAuthoritySync: context.assertCurrentAuthoritySync,
        assertCurrentReadAuthority: context.assertCurrentReadAuthority,
      });
    },
  });
}

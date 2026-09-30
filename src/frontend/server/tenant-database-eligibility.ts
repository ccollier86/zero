/** Guardian-backed admission for physical tenant database creation. */

import type { TenantKind } from '../../auth/tenancy/tenancy-types';
import { DatabaseError } from '../../databases/database-error';
import type { DatabaseTenantEligibilityOptions } from '../../databases/database-manager';
import type { ReactiveDB } from '../../sync/reactive-db';

interface TenantEligibilityRow {
  readonly kind: string;
  readonly status: string;
}

/**
 * Keep ineligible tenant purposes from reserving actor capacity or creating a
 * database file. Resource/Sync policy is still the live authorization
 * boundary; this is the earlier physical-realm admission boundary.
 */
export function createTenantDatabaseEligibility(
  systemDB: ReactiveDB,
  eligibleKinds: readonly TenantKind[],
): DatabaseTenantEligibilityOptions {
  const admittedKinds = new Set<TenantKind>(eligibleKinds);
  return Object.freeze({
    assertEligible(tenantId: string): undefined {
      const row = systemDB.prepare(`
        SELECT kind, status FROM _auth_tenants WHERE tenant_id = ?
      `).get(tenantId) as TenantEligibilityRow | null;
      if (!row
        || row.status !== 'active'
        || (row.kind !== 'organization' && row.kind !== 'administration')
        || !admittedKinds.has(row.kind)) {
        throw new DatabaseError(
          'DATABASE_AUTHORITY_CHANGED',
          'Tenant database is unavailable for the active authority.',
          { retryable: false, outcome: 'not-started' },
        );
      }
      return undefined;
    },
  });
}

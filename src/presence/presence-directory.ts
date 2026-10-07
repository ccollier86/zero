/** Authoritative finalized Guardian directory; status rows never grant identity or membership. */
import { authTokenEligibleUserSql } from '../auth/auth-user-eligibility';
import { applicationServiceDataScope, trustedSystemServiceDataScope, type ServiceDataScope } from '../auth/service-data-scope';
import type { ReactiveDB } from '../sync/reactive-db';

export interface PresenceDirectoryMember { readonly scope: ServiceDataScope; readonly userId: string }
const eligible = `${authTokenEligibleUserSql('u')}
  AND NOT EXISTS (SELECT 1 FROM _auth_registration_provisioning r WHERE r.user_id=u.user_id)
  AND NOT EXISTS (SELECT 1 FROM _auth_admin_user_provisioning p WHERE p.user_id=u.user_id)`;

/** Reads only the owning SYSTEM runtime, never an actor's copied identity anchors. */
export class PresenceDirectory {
  constructor(private readonly db: ReactiveDB, private readonly tenancyMode: 'single' | 'multi') {}

  /** Ordered inventory includes unopened eligible tenants and excludes suspended/provisional accounts. */
  members(): readonly PresenceDirectoryMember[] {
    if (this.tenancyMode === 'single') {
      return (this.db.prepare(`SELECT u.user_id FROM users u WHERE ${eligible} ORDER BY u.user_id`).all() as { user_id: string }[])
        .map(row => ({ scope: applicationServiceDataScope(), userId: row.user_id }));
    }
    return (this.db.prepare(`SELECT m.tenant_id,m.user_id FROM _auth_tenant_memberships m
      JOIN _auth_tenants t ON t.tenant_id=m.tenant_id JOIN users u ON u.user_id=m.user_id
      WHERE m.status='active' AND t.status='active' AND ${eligible}
      ORDER BY m.tenant_id,m.user_id`).all() as { tenant_id: string; user_id: string }[])
      .map(row => ({ scope: trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: row.tenant_id }), userId: row.user_id }));
  }

  /** Delivery checks both viewer and subject against current Guardian authority. */
  contains(scope: ServiceDataScope, userId: string): boolean {
    if (scope.scopeKind === 'application') {
      return this.tenancyMode === 'single' && Boolean(this.db.prepare(
        `SELECT 1 FROM users u WHERE u.user_id=? AND ${eligible}`).get(userId));
    }
    return this.tenancyMode === 'multi' && Boolean(this.db.prepare(`SELECT 1 FROM _auth_tenant_memberships m
      JOIN _auth_tenants t ON t.tenant_id=m.tenant_id JOIN users u ON u.user_id=m.user_id
      WHERE m.tenant_id=? AND m.user_id=? AND m.status='active' AND t.status='active' AND ${eligible}`).get(scope.scopeId, userId));
  }
}

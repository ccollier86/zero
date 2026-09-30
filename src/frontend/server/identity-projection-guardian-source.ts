import type { ReactiveDB } from '../../sync/reactive-db';

export interface GuardianProjectionMembership {
  readonly membershipId: string;
  readonly tenantId: string;
  readonly userId: string;
}

/** Read-only Guardian authority source used to seed ID-only application anchors. */
export class GuardianIdentityProjectionSource {
  constructor(private readonly systemDB: ReactiveDB) {}

  hasUser(userId: string): boolean {
    const row = this.systemDB.prepare(`
      SELECT user.user_id
      FROM users user
      WHERE user.user_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM _auth_registration_provisioning registration
          WHERE registration.user_id = user.user_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM _auth_admin_user_provisioning provisioning
          WHERE provisioning.user_id = user.user_id
        )
    `).get(userId) as { user_id: string } | null;
    return row?.user_id === userId;
  }

  findMembership(input: GuardianProjectionMembership): GuardianProjectionMembership | null {
    const row = this.systemDB.prepare(`
      SELECT membership_id, tenant_id, user_id
      FROM _auth_tenant_memberships membership
      WHERE membership.membership_id = ?
        AND membership.tenant_id = ?
        AND membership.user_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM _auth_registration_provisioning registration
          WHERE registration.user_id = membership.user_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM _auth_admin_user_provisioning provisioning
          WHERE provisioning.user_id = membership.user_id
        )
    `).get(input.membershipId, input.tenantId, input.userId) as {
      membership_id: string;
      tenant_id: string;
      user_id: string;
    } | null;
    return row ? mapMembership(row) : null;
  }

  listUsers(): readonly string[] {
    return (this.systemDB.prepare(
      `SELECT user.user_id
       FROM users user
       WHERE NOT EXISTS (
         SELECT 1 FROM _auth_registration_provisioning registration
         WHERE registration.user_id = user.user_id
       )
         AND NOT EXISTS (
           SELECT 1 FROM _auth_admin_user_provisioning provisioning
           WHERE provisioning.user_id = user.user_id
         )
       ORDER BY user.user_id`,
    ).all() as Array<{ user_id: string }>).map((row) => row.user_id);
  }

  listMemberships(): readonly GuardianProjectionMembership[] {
    return (this.systemDB.prepare(`
      SELECT membership_id, tenant_id, user_id
      FROM _auth_tenant_memberships membership
      WHERE NOT EXISTS (
        SELECT 1 FROM _auth_registration_provisioning registration
        WHERE registration.user_id = membership.user_id
      )
        AND NOT EXISTS (
          SELECT 1 FROM _auth_admin_user_provisioning provisioning
          WHERE provisioning.user_id = membership.user_id
        )
      ORDER BY membership.tenant_id, membership.membership_id
    `).all() as Array<{
      membership_id: string;
      tenant_id: string;
      user_id: string;
    }>).map(mapMembership);
  }

  /** Retained, finalized memberships whose anchors belong to one tenant realm. */
  listMembershipsForTenant(tenantId: string): readonly GuardianProjectionMembership[] {
    return (this.systemDB.prepare(`
      SELECT membership_id, tenant_id, user_id
      FROM _auth_tenant_memberships membership
      WHERE membership.tenant_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM _auth_registration_provisioning registration
          WHERE registration.user_id = membership.user_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM _auth_admin_user_provisioning provisioning
          WHERE provisioning.user_id = membership.user_id
        )
      ORDER BY membership.membership_id
    `).all(tenantId) as Array<{
      membership_id: string;
      tenant_id: string;
      user_id: string;
    }>).map(mapMembership);
  }
}

function mapMembership(row: {
  membership_id: string;
  tenant_id: string;
  user_id: string;
}): GuardianProjectionMembership {
  return Object.freeze({
    membershipId: row.membership_id,
    tenantId: row.tenant_id,
    userId: row.user_id,
  });
}

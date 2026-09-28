/** Align protected-owner guards with the account token-eligibility boundary. */

import type { Database } from 'bun:sqlite';
import { defineAuthorizationRoleTables } from '../../auth/authorization-role-schema';
import {
  authTokenEligibleUserSql,
  recoverableRegistrationUserSql,
  recoverableTenantRegistrationUserSql,
} from '../../auth/auth-user-eligibility';
import { defineRegistrationIntentTable } from '../../auth/registration-intent-schema';
import type { ReactiveDB } from '../../sync/reactive-db';
import type { Migration } from '../types';

export const migration: Migration = {
  version: '016',
  description: 'Require token-eligible application and organization owners',
  safety: 'safe',

  up(db: Database) {
    defineRegistrationIntentTable(db as unknown as ReactiveDB);
    // The shared runtime schema helper drops and recreates every owner guard,
    // upgrading trigger bodies that SQLite cannot replace in place.
    defineAuthorizationRoleTables(db as unknown as ReactiveDB);
    assertExistingOwnerStateIsRecoverable(db);
  },
};

function assertExistingOwnerStateIsRecoverable(db: Database): void {
  const invalidApplication = db.query(`
    SELECT 1 AS invalid
    WHERE EXISTS (
      SELECT 1 FROM _auth_application_role_assignments assignment
      WHERE assignment.application_id = 'application'
        AND assignment.role_key = 'owner'
        AND assignment.revoked_at IS NULL
    )
      AND NOT EXISTS (
        SELECT 1
        FROM _auth_application_role_assignments assignment
        INNER JOIN users owner ON owner.user_id = assignment.user_id
        WHERE assignment.application_id = 'application'
          AND assignment.role_key = 'owner'
          AND assignment.revoked_at IS NULL
          AND ${authTokenEligibleUserSql('owner')}
      )
      AND NOT EXISTS (
        SELECT 1
        FROM _auth_application_role_assignments assignment
        INNER JOIN users owner ON owner.user_id = assignment.user_id
        WHERE assignment.application_id = 'application'
          AND assignment.role_key = 'owner'
          AND assignment.source = 'bootstrap'
          AND assignment.revoked_at IS NULL
          AND (${recoverableRegistrationUserSql('owner')})
      )
  `).get();
  if (invalidApplication) {
    throw new Error(
      '[auth] Migration 016 found application owners but none can authenticate '
      + 'or complete the exact pending registration.',
    );
  }

  const invalidTenant = db.query(`
    SELECT tenant.tenant_id
    FROM _auth_tenants tenant
    WHERE tenant.status = 'active'
      AND NOT EXISTS (
        SELECT 1
        FROM _auth_tenant_memberships membership
        INNER JOIN users owner ON owner.user_id = membership.user_id
        WHERE membership.tenant_id = tenant.tenant_id
          AND membership.status = 'active'
          AND membership.role_key = 'owner'
          AND ${authTokenEligibleUserSql('owner')}
      )
      AND NOT EXISTS (
        SELECT 1
        FROM _auth_tenant_memberships membership
        INNER JOIN users owner ON owner.user_id = membership.user_id
        WHERE membership.tenant_id = tenant.tenant_id
          AND membership.status = 'active'
          AND membership.role_key = 'owner'
          AND tenant.created_by = owner.user_id
          AND (${recoverableTenantRegistrationUserSql('owner', 'tenant')})
      )
    ORDER BY tenant.tenant_id ASC
    LIMIT 1
  `).get() as { tenant_id: string } | null;
  if (invalidTenant) {
    throw new Error(
      `[auth] Migration 016 found an active tenant without a usable or `
      + `registration-recoverable owner: ${invalidTenant.tenant_id}`,
    );
  }
}

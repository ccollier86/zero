import type { ReactiveDB } from '../sync/reactive-db';
import { defineTenancyTables } from './tenancy/tenancy-schema';
import {
  authTokenEligibleUserSql,
  recoverableLegacyRegistrationUserSql,
  recoverableRegistrationUserSql,
} from './auth-user-eligibility';

function applicationOwnerAssignmentDeleteTriggerSql(
  registrationProvisioning: boolean,
): string {
  return `
  CREATE TRIGGER trg_auth_application_last_owner_assignment_delete
  BEFORE DELETE ON _auth_application_role_assignments
  WHEN OLD.role_key = 'owner' AND OLD.revoked_at IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM _auth_application_role_assignments other
      INNER JOIN users other_user ON other_user.user_id = other.user_id
      WHERE other.application_id = OLD.application_id
        AND other.assignment_id <> OLD.assignment_id
        AND other.role_key = 'owner'
        AND other.revoked_at IS NULL
        AND ${authTokenEligibleUserSql('other_user')}
    )
    ${registrationProvisioning ? `AND NOT (
      OLD.source = 'bootstrap'
      AND OLD.source_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM _auth_registration_provisioning pending
        WHERE pending.registration_id = OLD.source_id
          AND pending.user_id = OLD.user_id
          AND pending.is_bootstrap = 1
      )
    )` : ''}
  BEGIN
    SELECT RAISE(ABORT, 'AUTH_LAST_ACTIVE_APPLICATION_OWNER');
  END
`;
}

export const APPLICATION_OWNER_ASSIGNMENT_DELETE_TRIGGER_SQL =
  applicationOwnerAssignmentDeleteTriggerSql(true);

function tenantOwnerAssignmentDeleteTriggerSql(
  registrationProvisioning: boolean,
): string {
  return `
  CREATE TRIGGER trg_auth_tenant_last_owner_assignment_delete
  BEFORE DELETE ON _auth_tenant_membership_roles
  WHEN OLD.role_key = 'owner' AND OLD.revoked_at IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM _auth_tenant_membership_roles other
      INNER JOIN _auth_tenant_memberships other_membership
        ON other_membership.membership_id = other.membership_id
        AND other_membership.tenant_id = other.tenant_id
        AND other_membership.user_id = other.user_id
      INNER JOIN users other_user ON other_user.user_id = other.user_id
      WHERE other.tenant_id = OLD.tenant_id
        AND other.assignment_id <> OLD.assignment_id
        AND other.role_key = 'owner'
        AND other.revoked_at IS NULL
        AND other_membership.status = 'active'
        AND ${authTokenEligibleUserSql('other_user')}
    )
    ${registrationProvisioning ? `AND NOT EXISTS (
      SELECT 1
      FROM _auth_registration_provisioning pending
      WHERE pending.tenant_id = OLD.tenant_id
        AND pending.user_id = OLD.user_id
    )` : ''}
  BEGIN
    SELECT RAISE(ABORT, 'AUTH_LAST_ACTIVE_TENANT_OWNER');
  END
`;
}

export const TENANT_OWNER_ASSIGNMENT_DELETE_TRIGGER_SQL =
  tenantOwnerAssignmentDeleteTriggerSql(true);

function applicationOwnerEligibilityTriggerSql(exactIntentScope: boolean): string {
  const oldRecoverable = exactIntentScope
    ? recoverableRegistrationUserSql('OLD')
    : recoverableLegacyRegistrationUserSql('OLD');
  const newRecoverable = exactIntentScope
    ? recoverableRegistrationUserSql('NEW')
    : recoverableLegacyRegistrationUserSql('NEW');
  return `
    CREATE TRIGGER trg_auth_application_last_owner_suspend
    BEFORE UPDATE OF status, password_change_required,
      email_verification_required, email_verified_at, email ON users
    WHEN (
        (${authTokenEligibleUserSql('OLD')})
        OR (
          (${oldRecoverable})
          AND EXISTS (
            SELECT 1 FROM _auth_application_role_assignments provisional_owner
            WHERE provisional_owner.application_id = 'application'
              AND provisional_owner.user_id = OLD.user_id
              AND provisional_owner.role_key = 'owner'
              AND provisional_owner.source = 'bootstrap'
              AND provisional_owner.revoked_at IS NULL
          )
        )
      )
      AND NOT (
        (${authTokenEligibleUserSql('NEW')})
        OR (
          OLD.email = NEW.email
          AND (${newRecoverable})
        )
      )
      AND EXISTS (
        SELECT 1 FROM _auth_application_role_assignments owned
        WHERE owned.application_id = 'application'
          AND owned.user_id = OLD.user_id
          AND owned.role_key = 'owner'
          AND owned.revoked_at IS NULL
      )
      AND NOT EXISTS (
        SELECT 1
        FROM _auth_application_role_assignments other
        INNER JOIN users other_user ON other_user.user_id = other.user_id
        WHERE other.application_id = 'application'
          AND other.user_id <> OLD.user_id
          AND other.role_key = 'owner'
          AND other.revoked_at IS NULL
          AND ${authTokenEligibleUserSql('other_user')}
      )
    BEGIN
      SELECT RAISE(ABORT, 'AUTH_LAST_ACTIVE_APPLICATION_OWNER');
    END
  `;
}

function applicationOwnerUserDeleteTriggerSql(): string {
  return `
    CREATE TRIGGER trg_auth_application_last_owner_delete
    BEFORE DELETE ON users
    WHEN EXISTS (
      SELECT 1 FROM _auth_application_role_assignments owned
      WHERE owned.application_id = 'application'
        AND owned.user_id = OLD.user_id
        AND owned.role_key = 'owner'
        AND owned.revoked_at IS NULL
    )
      AND NOT EXISTS (
        SELECT 1
        FROM _auth_application_role_assignments other
        INNER JOIN users other_user ON other_user.user_id = other.user_id
        WHERE other.application_id = 'application'
          AND other.user_id <> OLD.user_id
          AND other.role_key = 'owner'
          AND other.revoked_at IS NULL
          AND ${authTokenEligibleUserSql('other_user')}
      )
    BEGIN
      SELECT RAISE(ABORT, 'AUTH_LAST_ACTIVE_APPLICATION_OWNER');
    END
  `;
}

function applicationOwnerAssignmentRevokeTriggerSql(): string {
  return `
    CREATE TRIGGER trg_auth_application_last_owner_assignment_revoke
    BEFORE UPDATE OF application_id, user_id, role_key, revoked_at
    ON _auth_application_role_assignments
    WHEN OLD.role_key = 'owner'
      AND OLD.revoked_at IS NULL
      AND NOT (
        NEW.application_id = OLD.application_id
        AND NEW.role_key = 'owner'
        AND NEW.revoked_at IS NULL
      )
      AND NOT EXISTS (
        SELECT 1
        FROM _auth_application_role_assignments other
        INNER JOIN users other_user ON other_user.user_id = other.user_id
        WHERE other.application_id = OLD.application_id
          AND other.assignment_id <> OLD.assignment_id
          AND other.role_key = 'owner'
          AND other.revoked_at IS NULL
          AND ${authTokenEligibleUserSql('other_user')}
      )
    BEGIN
      SELECT RAISE(ABORT, 'AUTH_LAST_ACTIVE_APPLICATION_OWNER');
    END
  `;
}

function tenantOwnerAssignmentRevokeTriggerSql(): string {
  return `
    CREATE TRIGGER trg_auth_tenant_last_owner_assignment_revoke
    BEFORE UPDATE OF tenant_id, membership_id, user_id, role_key, revoked_at
    ON _auth_tenant_membership_roles
    WHEN OLD.role_key = 'owner'
      AND OLD.revoked_at IS NULL
      AND NOT (
        NEW.tenant_id = OLD.tenant_id
        AND NEW.membership_id = OLD.membership_id
        AND NEW.user_id = OLD.user_id
        AND NEW.role_key = 'owner'
        AND NEW.revoked_at IS NULL
      )
      AND NOT EXISTS (
        SELECT 1
        FROM _auth_tenant_membership_roles other
        INNER JOIN _auth_tenant_memberships other_membership
          ON other_membership.membership_id = other.membership_id
          AND other_membership.tenant_id = other.tenant_id
          AND other_membership.user_id = other.user_id
        INNER JOIN users other_user ON other_user.user_id = other.user_id
        WHERE other.tenant_id = OLD.tenant_id
          AND other.assignment_id <> OLD.assignment_id
          AND other.role_key = 'owner'
          AND other.revoked_at IS NULL
          AND other_membership.status = 'active'
          AND ${authTokenEligibleUserSql('other_user')}
      )
    BEGIN
      SELECT RAISE(ABORT, 'AUTH_LAST_ACTIVE_TENANT_OWNER');
    END
  `;
}

function applicationOwnerAssignmentGrantTriggerSql(
  event: 'INSERT' | 'UPDATE',
  registrationProvisioning: boolean,
): string {
  const transition = event === 'INSERT' ? '' : `
      AND NOT (
        OLD.application_id = NEW.application_id
        AND OLD.user_id = NEW.user_id
        AND OLD.role_key = 'owner'
        AND OLD.revoked_at IS NULL
      )`;
  const provisional = registrationProvisioning ? `
      AND NOT (
        NEW.source = 'bootstrap'
        AND NEW.source_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM _auth_registration_provisioning pending
          WHERE pending.registration_id = NEW.source_id
            AND pending.user_id = NEW.user_id
            AND pending.tenant_id IS NULL
            AND pending.is_bootstrap = 1
        )
      )` : '';
  return `
    CREATE TRIGGER trg_auth_application_owner_assignment_${event === 'INSERT' ? 'insert' : 'grant'}
    BEFORE ${event}${event === 'UPDATE' ? ` OF application_id, user_id, role_key,
      source, source_id, revoked_at` : ''}
    ON _auth_application_role_assignments
    WHEN NEW.application_id = 'application'
      AND NEW.role_key = 'owner'
      AND NEW.revoked_at IS NULL
      ${transition}
      AND NOT EXISTS (
        SELECT 1 FROM users identity
        WHERE identity.user_id = NEW.user_id
          AND ${authTokenEligibleUserSql('identity')}
      )
      ${provisional}
    BEGIN
      SELECT RAISE(ABORT, 'AUTH_APPLICATION_OWNER_TARGET_INELIGIBLE');
    END
  `;
}

function tenantOwnerAssignmentGrantTriggerSql(
  event: 'INSERT' | 'UPDATE',
): string {
  // The retained membership is the tenant-ownership source of truth and its
  // own INSERT/UPDATE triggers enforce token eligibility. This table is only
  // the advanced-RBAC projection, so reconciliation must remain possible for
  // an owner who became gated after a second usable owner was established.
  const transition = event === 'INSERT' ? '' : `
      AND NOT (
        OLD.tenant_id = NEW.tenant_id
        AND OLD.membership_id = NEW.membership_id
        AND OLD.user_id = NEW.user_id
        AND OLD.role_key = 'owner'
        AND OLD.revoked_at IS NULL
      )`;
  return `
    CREATE TRIGGER trg_auth_tenant_owner_assignment_${event === 'INSERT' ? 'insert' : 'grant'}
    BEFORE ${event}${event === 'UPDATE' ? ` OF tenant_id, membership_id, user_id,
      role_key, source, source_id, revoked_at` : ''}
    ON _auth_tenant_membership_roles
    WHEN NEW.role_key = 'owner' AND NEW.revoked_at IS NULL
      ${transition}
      AND NOT EXISTS (
        SELECT 1
        FROM _auth_tenant_memberships membership
        WHERE membership.tenant_id = NEW.tenant_id
          AND membership.membership_id = NEW.membership_id
          AND membership.user_id = NEW.user_id
          AND membership.role_key = 'owner'
      )
    BEGIN
      SELECT RAISE(ABORT, 'AUTH_TENANT_OWNER_ASSIGNMENT_MISMATCH');
    END
  `;
}

export interface AuthorizationRoleSchemaOptions {
  /** Historical migrations before 015 have no provisioning receipt table. */
  registrationProvisioning?: boolean;
}

/** Repair owner-delete guards after the provisioning marker table exists. */
export function recreateAuthorizationOwnerAssignmentDeleteTriggers(
  db: ReactiveDB,
  options: AuthorizationRoleSchemaOptions = {},
): void {
  const registrationProvisioning = options.registrationProvisioning !== false;
  db.exec('DROP TRIGGER IF EXISTS trg_auth_application_last_owner_assignment_delete');
  db.exec(applicationOwnerAssignmentDeleteTriggerSql(registrationProvisioning));
  db.exec('DROP TRIGGER IF EXISTS trg_auth_tenant_last_owner_assignment_delete');
  db.exec(tenantOwnerAssignmentDeleteTriggerSql(registrationProvisioning));
}

/** Repair every current advanced-role owner guard on an existing database. */
export function recreateAuthorizationOwnerTriggers(
  db: ReactiveDB,
  options: AuthorizationRoleSchemaOptions = {},
): void {
  const registrationProvisioning = options.registrationProvisioning !== false;
  withSchemaRepairSavepoint(db, 'zero_authorization_owner_guards', () => {
    db.exec('DROP TRIGGER IF EXISTS trg_auth_application_last_owner_suspend');
    db.exec(applicationOwnerEligibilityTriggerSql(registrationProvisioning));
    db.exec('DROP TRIGGER IF EXISTS trg_auth_application_last_owner_delete');
    db.exec(applicationOwnerUserDeleteTriggerSql());
    db.exec('DROP TRIGGER IF EXISTS trg_auth_application_last_owner_assignment_revoke');
    db.exec(applicationOwnerAssignmentRevokeTriggerSql());
    db.exec('DROP TRIGGER IF EXISTS trg_auth_tenant_last_owner_assignment_revoke');
    db.exec(tenantOwnerAssignmentRevokeTriggerSql());
    db.exec('DROP TRIGGER IF EXISTS trg_auth_application_owner_assignment_insert');
    db.exec(applicationOwnerAssignmentGrantTriggerSql(
      'INSERT',
      registrationProvisioning,
    ));
    db.exec('DROP TRIGGER IF EXISTS trg_auth_application_owner_assignment_grant');
    db.exec(applicationOwnerAssignmentGrantTriggerSql(
      'UPDATE',
      registrationProvisioning,
    ));
    for (const name of [
      'trg_auth_tenant_owner_assignment_insert',
      'trg_auth_tenant_owner_assignment_insert_eligibility',
      'trg_auth_tenant_owner_assignment_grant',
      'trg_auth_tenant_owner_assignment_grant_eligibility',
    ]) db.exec(`DROP TRIGGER IF EXISTS ${name}`);
    db.exec(tenantOwnerAssignmentGrantTriggerSql('INSERT'));
    db.exec(tenantOwnerAssignmentGrantTriggerSql('UPDATE'));
    recreateAuthorizationOwnerAssignmentDeleteTriggers(db, options);
  });
}

/** Internal advanced-RBAC persistence; never registered for client Sync. */
export function defineAuthorizationRoleTables(
  db: ReactiveDB,
  options: AuthorizationRoleSchemaOptions = {},
): void {
  // The shared store prepares both application and tenant statements. Keep the
  // internal FK graph complete in single mode as well; these tables remain
  // server-only and dormant unless multi-tenancy is enabled.
  defineTenancyTables(db, {
    registrationProvisioning: options.registrationProvisioning,
  });
  db.exec(`
    CREATE TABLE IF NOT EXISTS _auth_application_authorization_state (
      application_id              TEXT NOT NULL DEFAULT 'application'
                                  CHECK (application_id = 'application'),
      user_id                     TEXT NOT NULL,
      authorization_generation    INTEGER NOT NULL DEFAULT 0
                                  CHECK (authorization_generation >= 0),
      updated_at                  INTEGER NOT NULL,
      PRIMARY KEY (application_id, user_id),
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS _auth_application_role_assignments (
      assignment_id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL DEFAULT 'application'
                     CHECK (application_id = 'application'),
      user_id       TEXT NOT NULL,
      role_key      TEXT NOT NULL,
      source        TEXT NOT NULL
                    CHECK (source IN ('bootstrap', 'manual', 'migration', 'system')),
      source_id     TEXT,
      created_by    TEXT,
      created_at    INTEGER NOT NULL,
      revoked_by    TEXT,
      revoked_at    INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE SET NULL,
      FOREIGN KEY (revoked_by) REFERENCES users(user_id) ON DELETE SET NULL
    )
  `);
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_application_roles_active
    ON _auth_application_role_assignments(application_id, user_id, role_key)
    WHERE revoked_at IS NULL
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_auth_application_roles_history
    ON _auth_application_role_assignments(application_id, user_id, created_at)
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS _auth_tenant_membership_roles (
      assignment_id TEXT PRIMARY KEY,
      tenant_id     TEXT NOT NULL,
      membership_id TEXT NOT NULL,
      user_id       TEXT NOT NULL,
      role_key      TEXT NOT NULL,
      source        TEXT NOT NULL
                    CHECK (source IN ('bootstrap', 'manual', 'migration', 'system')),
      source_id     TEXT,
      created_by    TEXT,
      created_at    INTEGER NOT NULL,
      revoked_by    TEXT,
      revoked_at    INTEGER,
      FOREIGN KEY (tenant_id) REFERENCES _auth_tenants(tenant_id) ON DELETE CASCADE,
      FOREIGN KEY (membership_id, tenant_id, user_id)
        REFERENCES _auth_tenant_memberships(membership_id, tenant_id, user_id)
        ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE SET NULL,
      FOREIGN KEY (revoked_by) REFERENCES users(user_id) ON DELETE SET NULL
    )
  `);
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_tenant_membership_roles_active
    ON _auth_tenant_membership_roles(tenant_id, membership_id, role_key)
    WHERE revoked_at IS NULL
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_auth_tenant_membership_roles_history
    ON _auth_tenant_membership_roles(tenant_id, membership_id, created_at)
  `);

  recreateAuthorizationOwnerTriggers(db, options);
}

function withSchemaRepairSavepoint(
  db: ReactiveDB,
  name: string,
  repair: () => void,
): void {
  db.exec(`SAVEPOINT ${name}`);
  try {
    repair();
    db.exec(`RELEASE SAVEPOINT ${name}`);
  } catch (error) {
    db.exec(`ROLLBACK TO SAVEPOINT ${name}`);
    db.exec(`RELEASE SAVEPOINT ${name}`);
    throw error;
  }
}

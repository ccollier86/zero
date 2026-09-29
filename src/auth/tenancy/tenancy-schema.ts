import type { ReactiveDB } from '../../sync/reactive-db';
import {
  authTokenEligibleUserSql,
  recoverableLegacyRegistrationUserSql,
  recoverableTenantRegistrationUserSql,
} from '../auth-user-eligibility';

function tenantOwnerEligibilityTriggerSql(exactIntentScope: boolean): string {
  const oldRecoverable = exactIntentScope
    ? recoverableTenantRegistrationUserSql('OLD', 'provisional_tenant')
    : recoverableLegacyRegistrationUserSql('OLD');
  const newRecoverable = exactIntentScope
    ? recoverableTenantRegistrationUserSql('NEW', 'provisional_tenant')
    : recoverableLegacyRegistrationUserSql('NEW');
  return `
    CREATE TRIGGER trg_auth_tenant_last_owner_suspend
    BEFORE UPDATE OF status, password_change_required,
      email_verification_required, email_verified_at, email ON users
    WHEN (
        (${authTokenEligibleUserSql('OLD')})
        OR EXISTS (
            SELECT 1
            FROM _auth_tenant_memberships provisional_owner
            INNER JOIN _auth_tenants provisional_tenant
              ON provisional_tenant.tenant_id = provisional_owner.tenant_id
            WHERE provisional_owner.user_id = OLD.user_id
              AND provisional_owner.status = 'active'
              AND provisional_owner.role_key = 'owner'
              AND provisional_tenant.status = 'active'
              AND provisional_tenant.created_by = OLD.user_id
              AND (${oldRecoverable})
        )
      )
      AND NOT (
        (${authTokenEligibleUserSql('NEW')})
        OR (
          OLD.email = NEW.email
          AND EXISTS (
            SELECT 1
            FROM _auth_tenant_memberships provisional_owner
            INNER JOIN _auth_tenants provisional_tenant
              ON provisional_tenant.tenant_id = provisional_owner.tenant_id
            WHERE provisional_owner.user_id = NEW.user_id
              AND provisional_owner.status = 'active'
              AND provisional_owner.role_key = 'owner'
              AND provisional_tenant.status = 'active'
              AND provisional_tenant.created_by = NEW.user_id
              AND (${newRecoverable})
          )
        )
      )
      AND EXISTS (
        SELECT 1
        FROM _auth_tenant_memberships owned
        INNER JOIN _auth_tenants tenant ON tenant.tenant_id = owned.tenant_id
        WHERE owned.user_id = OLD.user_id
          AND owned.status = 'active'
          AND owned.role_key = 'owner'
          AND tenant.status = 'active'
          AND NOT EXISTS (
            SELECT 1
            FROM _auth_tenant_memberships other
            INNER JOIN users other_user ON other_user.user_id = other.user_id
            WHERE other.tenant_id = owned.tenant_id
              AND other.membership_id <> owned.membership_id
              AND other.status = 'active'
              AND other.role_key = 'owner'
              AND ${authTokenEligibleUserSql('other_user')}
          )
      )
    BEGIN
      SELECT RAISE(ABORT, 'AUTH_LAST_ACTIVE_TENANT_OWNER');
    END
  `;
}

function tenantOwnerDeleteTriggerSql(): string {
  return `
    CREATE TRIGGER trg_auth_tenant_last_owner_delete
    BEFORE DELETE ON users
    WHEN EXISTS (
      SELECT 1
      FROM _auth_tenant_memberships owned
      INNER JOIN _auth_tenants tenant ON tenant.tenant_id = owned.tenant_id
      WHERE owned.user_id = OLD.user_id
        AND owned.status = 'active'
        AND owned.role_key = 'owner'
        AND tenant.status = 'active'
        AND NOT EXISTS (
          SELECT 1
          FROM _auth_tenant_memberships other
          INNER JOIN users other_user ON other_user.user_id = other.user_id
          WHERE other.tenant_id = owned.tenant_id
            AND other.membership_id <> owned.membership_id
            AND other.status = 'active'
            AND other.role_key = 'owner'
            AND ${authTokenEligibleUserSql('other_user')}
        )
    )
    BEGIN
      SELECT RAISE(ABORT, 'AUTH_LAST_ACTIVE_TENANT_OWNER');
    END
  `;
}

function tenantOwnerMembershipInsertTriggerSql(
  registrationProvisioning: boolean,
): string {
  const provisionalOwner = registrationProvisioning ? `
        SELECT 1
        FROM users identity
        INNER JOIN _auth_tenants tenant ON tenant.tenant_id = NEW.tenant_id
        INNER JOIN _auth_registration_provisioning pending
          ON pending.user_id = identity.user_id
        WHERE identity.user_id = NEW.user_id
          AND tenant.created_by = NEW.user_id
          AND (pending.tenant_id IS NULL OR pending.tenant_id = NEW.tenant_id)
  ` : `
        SELECT 1
        FROM users identity
        INNER JOIN _auth_tenants tenant ON tenant.tenant_id = NEW.tenant_id
        WHERE identity.user_id = NEW.user_id
          AND tenant.created_by = NEW.user_id
          AND (${recoverableLegacyRegistrationUserSql('identity')})
  `;
  return `
    CREATE TRIGGER trg_auth_tenant_owner_membership_insert
    BEFORE INSERT ON _auth_tenant_memberships
    WHEN NEW.status = 'active' AND NEW.role_key = 'owner'
      AND NOT EXISTS (
        SELECT 1 FROM users identity
        WHERE identity.user_id = NEW.user_id
          AND ${authTokenEligibleUserSql('identity')}
      )
      AND NOT EXISTS (
        ${provisionalOwner}
      )
    BEGIN
      SELECT RAISE(ABORT, 'AUTH_TENANT_OWNER_TARGET_INELIGIBLE');
    END
  `;
}

function tenantOwnerMembershipGrantTriggerSql(): string {
  return `
    CREATE TRIGGER trg_auth_tenant_owner_membership_grant
    BEFORE UPDATE OF tenant_id, user_id, status, role_key
    ON _auth_tenant_memberships
    WHEN NEW.status = 'active' AND NEW.role_key = 'owner'
      AND NOT (
        OLD.tenant_id = NEW.tenant_id
        AND OLD.user_id = NEW.user_id
        AND OLD.status = 'active'
        AND OLD.role_key = 'owner'
      )
      AND NOT EXISTS (
        SELECT 1 FROM users identity
        WHERE identity.user_id = NEW.user_id
          AND ${authTokenEligibleUserSql('identity')}
      )
    BEGIN
      SELECT RAISE(ABORT, 'AUTH_TENANT_OWNER_TARGET_INELIGIBLE');
    END
  `;
}

function tenantLastOwnerMembershipUpdateTriggerSql(): string {
  return `
    CREATE TRIGGER trg_auth_tenant_last_owner_membership_update
    BEFORE UPDATE OF tenant_id, user_id, status, role_key
    ON _auth_tenant_memberships
    WHEN OLD.status = 'active' AND OLD.role_key = 'owner'
      AND NOT (
        OLD.tenant_id = NEW.tenant_id
        AND OLD.user_id = NEW.user_id
        AND NEW.status = 'active'
        AND NEW.role_key = 'owner'
      )
      AND EXISTS (
        SELECT 1 FROM _auth_tenants tenant
        WHERE tenant.tenant_id = OLD.tenant_id AND tenant.status = 'active'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM _auth_tenant_memberships other
        INNER JOIN users other_user ON other_user.user_id = other.user_id
        WHERE other.tenant_id = OLD.tenant_id
          AND other.membership_id <> OLD.membership_id
          AND other.status = 'active'
          AND other.role_key = 'owner'
          AND ${authTokenEligibleUserSql('other_user')}
      )
    BEGIN
      SELECT RAISE(ABORT, 'AUTH_LAST_ACTIVE_TENANT_OWNER');
    END
  `;
}

function tenantLastOwnerMembershipDeleteTriggerSql(
  registrationProvisioning: boolean,
): string {
  return `
    CREATE TRIGGER trg_auth_tenant_last_owner_membership_delete
    BEFORE DELETE ON _auth_tenant_memberships
    WHEN OLD.status = 'active' AND OLD.role_key = 'owner'
      AND EXISTS (
        SELECT 1 FROM _auth_tenants tenant
        WHERE tenant.tenant_id = OLD.tenant_id AND tenant.status = 'active'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM _auth_tenant_memberships other
        INNER JOIN users other_user ON other_user.user_id = other.user_id
        WHERE other.tenant_id = OLD.tenant_id
          AND other.membership_id <> OLD.membership_id
          AND other.status = 'active'
          AND other.role_key = 'owner'
          AND ${authTokenEligibleUserSql('other_user')}
      )
      ${registrationProvisioning ? `AND NOT EXISTS (
        SELECT 1 FROM _auth_registration_provisioning pending
        WHERE pending.tenant_id = OLD.tenant_id
          AND pending.user_id = OLD.user_id
      )` : ''}
    BEGIN
      SELECT RAISE(ABORT, 'AUTH_LAST_ACTIVE_TENANT_OWNER');
    END
  `;
}

export interface TenancySchemaOptions {
  /** Historical migrations before 015 have no provisioning receipt table. */
  registrationProvisioning?: boolean;
}

/** Repair the current user-lifecycle owner guards on existing databases. */
export function recreateTenancyOwnerUserTriggers(
  db: ReactiveDB,
  exactIntentScope = true,
): void {
  db.exec('DROP TRIGGER IF EXISTS trg_auth_tenant_last_owner_suspend');
  db.exec(tenantOwnerEligibilityTriggerSql(exactIntentScope));
  db.exec('DROP TRIGGER IF EXISTS trg_auth_tenant_last_owner_delete');
  db.exec(tenantOwnerDeleteTriggerSql());
}

/** Repair user and membership owner guards on an existing database. */
export function recreateTenancyOwnerTriggers(
  db: ReactiveDB,
  options: TenancySchemaOptions = {},
): void {
  const registrationProvisioning = options.registrationProvisioning !== false;
  withSchemaRepairSavepoint(db, 'zero_tenancy_owner_guards', () => {
    recreateTenancyOwnerUserTriggers(db, registrationProvisioning);
    db.exec('DROP TRIGGER IF EXISTS trg_auth_tenant_owner_membership_insert');
    db.exec(tenantOwnerMembershipInsertTriggerSql(registrationProvisioning));
    db.exec('DROP TRIGGER IF EXISTS trg_auth_tenant_owner_membership_grant');
    db.exec(tenantOwnerMembershipGrantTriggerSql());
    db.exec('DROP TRIGGER IF EXISTS trg_auth_tenant_last_owner_membership_update');
    db.exec(tenantLastOwnerMembershipUpdateTriggerSql());
    db.exec('DROP TRIGGER IF EXISTS trg_auth_tenant_last_owner_membership_delete');
    db.exec(tenantLastOwnerMembershipDeleteTriggerSql(
      registrationProvisioning,
    ));
  });
}

/**
 * Add the server-only tenant and membership control-plane tables.
 *
 * Raw SQL plus `_` prefixes deliberately keeps these records outside the
 * ReactiveDB client table registry and raw Sync snapshots.
 */
export function defineTenancyTables(
  db: ReactiveDB,
  options: TenancySchemaOptions = {},
): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _auth_tenants (
      tenant_id                   TEXT PRIMARY KEY,
      slug                        TEXT NOT NULL,
      name                        TEXT NOT NULL,
      status                      TEXT NOT NULL DEFAULT 'active'
                                  CHECK (status IN ('active', 'suspended', 'archived')),
      authorization_generation    INTEGER NOT NULL DEFAULT 0
                                  CHECK (authorization_generation >= 0),
      created_by                  TEXT NOT NULL,
      created_at                  INTEGER NOT NULL,
      updated_at                  INTEGER NOT NULL,
      suspended_at                INTEGER,
      kind                        TEXT NOT NULL DEFAULT 'organization'
                                  CHECK (kind IN ('organization', 'administration')),
      FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE RESTRICT
    )
  `);
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_tenants_slug
    ON _auth_tenants(slug COLLATE NOCASE)
  `);
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_tenants_administration
    ON _auth_tenants(kind) WHERE kind = 'administration'
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS _auth_tenant_memberships (
      membership_id               TEXT PRIMARY KEY,
      tenant_id                   TEXT NOT NULL,
      user_id                     TEXT NOT NULL,
      status                      TEXT NOT NULL DEFAULT 'active'
                                  CHECK (status IN ('active', 'suspended', 'removed')),
      role_key                    TEXT,
      authorization_generation    INTEGER NOT NULL DEFAULT 0
                                  CHECK (authorization_generation >= 0),
      joined_at                   INTEGER NOT NULL,
      created_at                  INTEGER NOT NULL,
      updated_at                  INTEGER NOT NULL,
      suspended_at                INTEGER,
      removed_at                  INTEGER,
      created_by                  TEXT NOT NULL,
      FOREIGN KEY (tenant_id) REFERENCES _auth_tenants(tenant_id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
      FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE RESTRICT,
      UNIQUE (tenant_id, user_id),
      UNIQUE (membership_id, tenant_id, user_id)
    )
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_auth_tenant_memberships_tenant_status
    ON _auth_tenant_memberships(tenant_id, status, role_key)
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_auth_tenant_memberships_user_status
    ON _auth_tenant_memberships(user_id, status, tenant_id)
  `);

  // The administration boundary is one-way and must stay online. An exact
  // organization may be promoted only while none exists; afterward even raw
  // SQL cannot repurpose, suspend, archive, or delete that authority scope.
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
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_auth_administration_tenant_no_delete
    BEFORE DELETE ON _auth_tenants
    WHEN OLD.kind = 'administration'
      AND NOT EXISTS (
        SELECT 1 FROM _auth_registration_provisioning provisioning
        WHERE provisioning.tenant_id = OLD.tenant_id
          AND provisioning.user_id = OLD.created_by
          AND provisioning.is_bootstrap = 1
      )
    BEGIN
      SELECT RAISE(ABORT, 'AUTH_ADMINISTRATION_TENANT_PROTECTED');
    END
  `);

  // Raw SQL and every lifecycle adapter share the full token-eligibility
  // definition. A status-active but gated identity is not a usable owner.
  recreateTenancyOwnerTriggers(db, options);
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

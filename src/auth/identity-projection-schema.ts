import type { ReactiveDB } from '../sync/reactive-db';
import { identityProjectionError } from './identity-projection-error';
import {
  assertExactManagedChecks,
  assertExactManagedColumns,
  assertExactManagedForeignKey,
  assertExactManagedIndex,
  assertManagedUniqueColumns,
  managedProjectionColumn as column,
  type IdentityProjectionSchemaReader,
} from './identity-projection-sqlite-invariants';

/** Return-agnostic schema handle shared by ReactiveDB and Bun actor SQLite. */
interface IdentityProjectionSchemaDatabase extends IdentityProjectionSchemaReader {
  exec(sql: string): unknown;
}

export const IDENTITY_PROJECTION_TARGETS_TABLE =
  '_auth_identity_projection_targets' as const;
export const IDENTITY_PROJECTION_OUTBOX_TABLE =
  '_auth_identity_projection_outbox' as const;
export const IDENTITY_PROJECTION_INSTALLATION_TABLE =
  '_auth_identity_projection_installation' as const;
export const IDENTITY_PROJECTION_STATE_TABLE =
  '_zero_identity_projection_state' as const;
export const IDENTITY_PROJECTION_RECEIPTS_TABLE =
  '_zero_identity_projection_receipts' as const;

/** Target-local mirror tables reserved for referential infrastructure only. */
export const IDENTITY_PROJECTION_TARGET_TABLES = Object.freeze([
  'users',
  'tenant_memberships',
  IDENTITY_PROJECTION_STATE_TABLE,
  IDENTITY_PROJECTION_RECEIPTS_TABLE,
] as const);

const SYSTEM_SCHEMA = `
  CREATE TABLE IF NOT EXISTS ${IDENTITY_PROJECTION_INSTALLATION_TABLE} (
    singleton       INTEGER PRIMARY KEY CHECK (singleton = 1),
    installation_id TEXT NOT NULL UNIQUE,
    created_at      INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ${IDENTITY_PROJECTION_TARGETS_TABLE} (
    target_id                TEXT PRIMARY KEY,
    scope                    TEXT NOT NULL CHECK (scope IN ('application', 'tenant', 'named')),
    status                   TEXT NOT NULL CHECK (status IN ('provisioning', 'ready', 'quarantined')),
    next_sequence            INTEGER NOT NULL DEFAULT 1 CHECK (next_sequence >= 1),
    acknowledged_sequence    INTEGER NOT NULL DEFAULT 0 CHECK (acknowledged_sequence >= 0),
    last_error_code          TEXT,
    created_at               INTEGER NOT NULL,
    updated_at               INTEGER NOT NULL,
    CHECK (acknowledged_sequence < next_sequence)
  );

  CREATE TABLE IF NOT EXISTS ${IDENTITY_PROJECTION_OUTBOX_TABLE} (
    target_id        TEXT NOT NULL,
    sequence         INTEGER NOT NULL CHECK (sequence >= 1),
    event_id         TEXT NOT NULL UNIQUE,
    dedupe_key       TEXT NOT NULL,
    anchor_kind      TEXT NOT NULL CHECK (anchor_kind IN ('user', 'membership')),
    user_id          TEXT NOT NULL,
    membership_id    TEXT,
    tenant_id        TEXT,
    status           TEXT NOT NULL CHECK (
      status IN ('pending', 'processing', 'completed', 'quarantined')
    ),
    attempts         INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    available_at     INTEGER NOT NULL,
    lease_owner      TEXT,
    lease_expires_at INTEGER,
    last_error_code  TEXT,
    created_at       INTEGER NOT NULL,
    updated_at       INTEGER NOT NULL,
    completed_at     INTEGER,
    PRIMARY KEY (target_id, sequence),
    UNIQUE (target_id, dedupe_key),
    FOREIGN KEY (target_id)
      REFERENCES ${IDENTITY_PROJECTION_TARGETS_TABLE}(target_id)
      ON DELETE RESTRICT,
    CHECK (
      (anchor_kind = 'user' AND membership_id IS NULL AND tenant_id IS NULL)
      OR
      (anchor_kind = 'membership' AND membership_id IS NOT NULL AND tenant_id IS NOT NULL)
    ),
    CHECK (
      (status = 'processing' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
      OR
      (status <> 'processing' AND lease_owner IS NULL AND lease_expires_at IS NULL)
    ),
    CHECK (
      (status = 'completed' AND completed_at IS NOT NULL)
      OR
      (status <> 'completed' AND completed_at IS NULL)
    ),
    CHECK (
      (status = 'pending' AND attempts >= 0)
      OR
      (status <> 'pending' AND attempts >= 1)
    )
  );

  CREATE INDEX IF NOT EXISTS idx_auth_identity_projection_due
    ON ${IDENTITY_PROJECTION_OUTBOX_TABLE}
      (target_id, status, available_at, sequence);
  CREATE INDEX IF NOT EXISTS idx_auth_identity_projection_leases
    ON ${IDENTITY_PROJECTION_OUTBOX_TABLE}(status, lease_expires_at);
`;

const TARGET_SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY
  );

  CREATE TABLE IF NOT EXISTS tenant_memberships (
    membership_id TEXT PRIMARY KEY,
    tenant_id     TEXT NOT NULL,
    user_id       TEXT NOT NULL,
    UNIQUE (tenant_id, user_id),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE RESTRICT
  );

  CREATE TABLE IF NOT EXISTS ${IDENTITY_PROJECTION_STATE_TABLE} (
    singleton       INTEGER PRIMARY KEY CHECK (singleton = 1),
    installation_id TEXT NOT NULL,
    target_id       TEXT NOT NULL,
    status          TEXT NOT NULL CHECK (status IN ('provisioning', 'ready', 'quarantined')),
    watermark       INTEGER NOT NULL DEFAULT 0 CHECK (watermark >= 0),
    quarantine_code TEXT,
    updated_at      INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ${IDENTITY_PROJECTION_RECEIPTS_TABLE} (
    event_id          TEXT PRIMARY KEY,
    target_id         TEXT NOT NULL,
    sequence          INTEGER NOT NULL CHECK (sequence >= 1),
    anchor_fingerprint TEXT NOT NULL,
    applied_at        INTEGER NOT NULL,
    UNIQUE (target_id, sequence)
  );
`;

/** Install durable system-plane target and outbox storage. */
export function defineIdentityProjectionSystemTables(db: ReactiveDB): void {
  db.transaction(() => {
    executeManagedProjectionSchema(db, SYSTEM_SCHEMA);
    assertExactIdentityProjectionSystemSQLiteTables(db);
  });
}

/**
 * Install ID-only anchors and projection metadata in an application database.
 * Existing tables are validated exactly so this subsystem cannot accidentally
 * write into a legacy profile/PII-bearing `users` table.
 */
export function defineIdentityAnchorTables(db: ReactiveDB): void {
  db.transaction(() => defineIdentityAnchorSQLiteTables(db));
}

/** Install/validate anchors on a raw actor handle before app tables publish. */
export function defineIdentityAnchorSQLiteTables(
  db: IdentityProjectionSchemaDatabase,
): void {
  executeManagedProjectionSchema(db, TARGET_SCHEMA);
  assertExactIdentityProjectionTargetSQLiteTables(db);
}

/** Verify the exact managed source-journal schema after create/migration. */
export function assertExactIdentityProjectionSystemSQLiteTables(
  db: Pick<IdentityProjectionSchemaDatabase, 'prepare'>,
): void {
  assertExactIdentityProjectionInstallationSQLiteTable(db);
  assertExactIdentityProjectionTargetsSQLiteTable(db);
  assertExactIdentityProjectionOutboxSQLiteTable(db);
}

export function assertExactIdentityProjectionInstallationSQLiteTable(
  db: Pick<IdentityProjectionSchemaDatabase, 'prepare'>,
): void {
  assertExactManagedColumns(db, IDENTITY_PROJECTION_INSTALLATION_TABLE, [
    column('singleton', 'INTEGER', 1),
    column('installation_id', 'TEXT', 0, true),
    column('created_at', 'INTEGER', 0, true),
  ]);
  assertExactManagedChecks(db, IDENTITY_PROJECTION_INSTALLATION_TABLE, [
    'singleton = 1',
  ]);
  assertManagedUniqueColumns(db, IDENTITY_PROJECTION_INSTALLATION_TABLE, [
    'installation_id',
  ]);
}

export function assertExactIdentityProjectionTargetsSQLiteTable(
  db: Pick<IdentityProjectionSchemaDatabase, 'prepare'>,
): void {
  assertExactManagedColumns(db, IDENTITY_PROJECTION_TARGETS_TABLE, [
    column('target_id', 'TEXT', 1),
    column('scope', 'TEXT', 0, true),
    column('status', 'TEXT', 0, true),
    column('next_sequence', 'INTEGER', 0, true, '1'),
    column('acknowledged_sequence', 'INTEGER', 0, true, '0'),
    column('last_error_code', 'TEXT', 0),
    column('created_at', 'INTEGER', 0, true),
    column('updated_at', 'INTEGER', 0, true),
  ]);
  assertExactManagedChecks(db, IDENTITY_PROJECTION_TARGETS_TABLE, [
    "scope IN ('application', 'tenant', 'named')",
    "status IN ('provisioning', 'ready', 'quarantined')",
    'next_sequence >= 1',
    'acknowledged_sequence >= 0',
    'acknowledged_sequence < next_sequence',
  ]);
}

export function assertExactIdentityProjectionOutboxSQLiteTable(
  db: Pick<IdentityProjectionSchemaDatabase, 'prepare'>,
): void {
  assertExactManagedColumns(db, IDENTITY_PROJECTION_OUTBOX_TABLE, [
    column('target_id', 'TEXT', 1, true),
    column('sequence', 'INTEGER', 2, true),
    column('event_id', 'TEXT', 0, true),
    column('dedupe_key', 'TEXT', 0, true),
    column('anchor_kind', 'TEXT', 0, true),
    column('user_id', 'TEXT', 0, true),
    column('membership_id', 'TEXT', 0),
    column('tenant_id', 'TEXT', 0),
    column('status', 'TEXT', 0, true),
    column('attempts', 'INTEGER', 0, true, '0'),
    column('available_at', 'INTEGER', 0, true),
    column('lease_owner', 'TEXT', 0),
    column('lease_expires_at', 'INTEGER', 0),
    column('last_error_code', 'TEXT', 0),
    column('created_at', 'INTEGER', 0, true),
    column('updated_at', 'INTEGER', 0, true),
    column('completed_at', 'INTEGER', 0),
  ]);
  assertExactManagedChecks(db, IDENTITY_PROJECTION_OUTBOX_TABLE, [
    'sequence >= 1',
    "anchor_kind IN ('user', 'membership')",
    "status IN ('pending', 'processing', 'completed', 'quarantined')",
    'attempts >= 0',
    "(anchor_kind = 'user' AND membership_id IS NULL AND tenant_id IS NULL) OR (anchor_kind = 'membership' AND membership_id IS NOT NULL AND tenant_id IS NOT NULL)",
    "(status = 'processing' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL) OR (status <> 'processing' AND lease_owner IS NULL AND lease_expires_at IS NULL)",
    "(status = 'completed' AND completed_at IS NOT NULL) OR (status <> 'completed' AND completed_at IS NULL)",
    "(status = 'pending' AND attempts >= 0) OR (status <> 'pending' AND attempts >= 1)",
  ]);
  assertManagedUniqueColumns(db, IDENTITY_PROJECTION_OUTBOX_TABLE, ['event_id']);
  assertManagedUniqueColumns(db, IDENTITY_PROJECTION_OUTBOX_TABLE, [
    'target_id',
    'dedupe_key',
  ]);
  assertExactManagedForeignKey(db, IDENTITY_PROJECTION_OUTBOX_TABLE, {
    table: IDENTITY_PROJECTION_TARGETS_TABLE,
    from: 'target_id',
    to: 'target_id',
    onDelete: 'RESTRICT',
  });
  assertExactManagedIndex(
    db,
    IDENTITY_PROJECTION_OUTBOX_TABLE,
    'idx_auth_identity_projection_due',
    ['target_id', 'status', 'available_at', 'sequence'],
  );
  assertExactManagedIndex(
    db,
    IDENTITY_PROJECTION_OUTBOX_TABLE,
    'idx_auth_identity_projection_leases',
    ['status', 'lease_expires_at'],
  );
}

/** Verify every always-installed target table, not only currently referenced anchors. */
export function assertExactIdentityProjectionTargetSQLiteTables(
  db: Pick<IdentityProjectionSchemaDatabase, 'prepare'>,
): void {
  assertExactIdentityUserSQLiteTable(db);
  assertExactIdentityMembershipSQLiteTable(db);
  assertExactIdentityProjectionStateSQLiteTable(db);
  assertExactIdentityProjectionReceiptsSQLiteTable(db);
}

export function assertExactIdentityProjectionStateSQLiteTable(
  db: Pick<IdentityProjectionSchemaDatabase, 'prepare'>,
): void {
  assertExactManagedColumns(db, IDENTITY_PROJECTION_STATE_TABLE, [
    column('singleton', 'INTEGER', 1),
    column('installation_id', 'TEXT', 0, true),
    column('target_id', 'TEXT', 0, true),
    column('status', 'TEXT', 0, true),
    column('watermark', 'INTEGER', 0, true, '0'),
    column('quarantine_code', 'TEXT', 0),
    column('updated_at', 'INTEGER', 0, true),
  ]);
  assertExactManagedChecks(db, IDENTITY_PROJECTION_STATE_TABLE, [
    'singleton = 1',
    "status IN ('provisioning', 'ready', 'quarantined')",
    'watermark >= 0',
  ]);
}

export function assertExactIdentityProjectionReceiptsSQLiteTable(
  db: Pick<IdentityProjectionSchemaDatabase, 'prepare'>,
): void {
  assertExactManagedColumns(db, IDENTITY_PROJECTION_RECEIPTS_TABLE, [
    column('event_id', 'TEXT', 1),
    column('target_id', 'TEXT', 0, true),
    column('sequence', 'INTEGER', 0, true),
    column('anchor_fingerprint', 'TEXT', 0, true),
    column('applied_at', 'INTEGER', 0, true),
  ]);
  assertExactManagedChecks(db, IDENTITY_PROJECTION_RECEIPTS_TABLE, [
    'sequence >= 1',
  ]);
  assertManagedUniqueColumns(db, IDENTITY_PROJECTION_RECEIPTS_TABLE, [
    'target_id',
    'sequence',
  ]);
}

/** Read-only exact-shape assertion shared by startup and platform diagnostics. */
export function assertExactIdentityAnchorSQLiteTables(
  db: Pick<IdentityProjectionSchemaDatabase, 'prepare'>,
  requirements: Readonly<{ membership: boolean }>,
): void {
  assertExactIdentityUserSQLiteTable(db);
  if (requirements.membership) assertExactIdentityMembershipSQLiteTable(db);
}

export function assertExactIdentityUserSQLiteTable(
  db: Pick<IdentityProjectionSchemaDatabase, 'prepare'>,
): void {
  assertExactManagedColumns(db, 'users', [
    column('user_id', 'TEXT', 1),
  ]);
}

export function assertExactIdentityMembershipSQLiteTable(
  db: Pick<IdentityProjectionSchemaDatabase, 'prepare'>,
): void {
  assertExactManagedColumns(db, 'tenant_memberships', [
    column('membership_id', 'TEXT', 1),
    column('tenant_id', 'TEXT', 0, true),
    column('user_id', 'TEXT', 0, true),
  ]);
  assertMembershipForeignKey(db);
  assertMembershipUniqueIdentity(db);
}

function assertMembershipForeignKey(
  db: Pick<IdentityProjectionSchemaDatabase, 'prepare'>,
): void {
  assertExactManagedForeignKey(db, 'tenant_memberships', {
    table: 'users',
    from: 'user_id',
    to: 'user_id',
    onDelete: 'RESTRICT',
  });
}

function assertMembershipUniqueIdentity(
  db: Pick<IdentityProjectionSchemaDatabase, 'prepare'>,
): void {
  assertManagedUniqueColumns(db, 'tenant_memberships', ['tenant_id', 'user_id']);
}

function executeManagedProjectionSchema(
  db: Pick<IdentityProjectionSchemaDatabase, 'exec'>,
  sql: string,
): void {
  try {
    db.exec(sql);
  } catch (cause) {
    throw identityProjectionError('IDENTITY_PROJECTION_SCHEMA_INVALID', { cause });
  }
}

/** Read-only health diagnostics for Guardian identity-projection state. */

import type { Database } from 'bun:sqlite';

import { IdentityProjectionError } from '../auth/identity-projection-error';
import {
  assertExactIdentityMembershipSQLiteTable,
  assertExactIdentityProjectionInstallationSQLiteTable,
  assertExactIdentityProjectionOutboxSQLiteTable,
  assertExactIdentityProjectionReceiptsSQLiteTable,
  assertExactIdentityProjectionStateSQLiteTable,
  assertExactIdentityProjectionTargetsSQLiteTable,
  assertExactIdentityUserSQLiteTable,
  IDENTITY_PROJECTION_INSTALLATION_TABLE,
  IDENTITY_PROJECTION_OUTBOX_TABLE,
  IDENTITY_PROJECTION_RECEIPTS_TABLE,
  IDENTITY_PROJECTION_STATE_TABLE,
  IDENTITY_PROJECTION_TARGETS_TABLE,
} from '../auth/identity-projection-schema';
import { requireIdentityProjectionId } from '../auth/identity-projection-validation';
import { APPLICATION_IDENTITY_PROJECTION_TARGET_ID } from '../frontend/server/identity-projection-anchors';
import type { DoctorIdentityProjectionConfiguration } from './platform-doctor-identity-projection';
import { checkProjectionTargetSummary } from './platform-doctor-identity-projection-summary';
import {
  addPlatformDoctorFinding as addFinding,
  type PlatformDoctorFindingSink,
} from './platform-doctor-contracts';
import { SYSTEM_DATABASE_DOCS } from './platform-doctor-system-database-config';
import { hasSQLiteTable } from './platform-doctor-system-database-inspection';

type ManagedSchemaStatus = 'ready' | 'missing' | 'invalid';

interface ManagedTableValidator {
  readonly table: string;
  readonly assertExact: (database: Database) => void;
}

const APPLICATION_PROJECTION_TABLES: readonly ManagedTableValidator[] = Object.freeze([
  Object.freeze({ table: 'users', assertExact: assertExactIdentityUserSQLiteTable }),
  Object.freeze({
    table: 'tenant_memberships',
    assertExact: assertExactIdentityMembershipSQLiteTable,
  }),
  Object.freeze({
    table: IDENTITY_PROJECTION_STATE_TABLE,
    assertExact: assertExactIdentityProjectionStateSQLiteTable,
  }),
  Object.freeze({
    table: IDENTITY_PROJECTION_RECEIPTS_TABLE,
    assertExact: assertExactIdentityProjectionReceiptsSQLiteTable,
  }),
]);

const SYSTEM_PROJECTION_TABLES: readonly ManagedTableValidator[] = Object.freeze([
  Object.freeze({
    table: IDENTITY_PROJECTION_INSTALLATION_TABLE,
    assertExact: assertExactIdentityProjectionInstallationSQLiteTable,
  }),
  Object.freeze({
    table: IDENTITY_PROJECTION_TARGETS_TABLE,
    assertExact: assertExactIdentityProjectionTargetsSQLiteTable,
  }),
  Object.freeze({
    table: IDENTITY_PROJECTION_OUTBOX_TABLE,
    assertExact: assertExactIdentityProjectionOutboxSQLiteTable,
  }),
]);

export interface DoctorApplicationIdentityProjectionState {
  readonly installationId: string;
  readonly targetId: string;
  readonly status: string;
  readonly watermark: number;
}

/** Inspect the shared application target's exact anchors and readiness. */
export function checkApplicationIdentityProjectionState(
  application: Database,
  findings: PlatformDoctorFindingSink,
): DoctorApplicationIdentityProjectionState | null {
  const schema = inspectManagedSchema(application, APPLICATION_PROJECTION_TABLES);
  if (schema !== 'ready') {
    addFinding(findings, {
      severity: schema === 'invalid' ? 'error' : 'warning',
      code: schema === 'invalid'
        ? 'database.identity_projection.anchor_schema_invalid'
        : 'database.identity_projection.anchor_schema_missing',
      path: 'db',
      message: schema === 'invalid'
        ? 'The existing application database contains an incompatible managed Guardian anchor/projection schema.'
        : 'The existing application database is missing one or more required ID-only Guardian anchor/projection tables.',
      hint: schema === 'invalid'
        ? 'Keep the deployment stopped and repair or rebuild the managed projection tables; do not add profile or credential columns to identity anchors.'
        : 'Let the managed projection initializer install and verify the exact ID-only schema before admitting dependent writes.',
      docs: `${SYSTEM_DATABASE_DOCS}#identity-anchors`,
    });
    return null;
  }

  const state = application.query(
    `SELECT installation_id, target_id, status, watermark
     FROM ${IDENTITY_PROJECTION_STATE_TABLE} WHERE singleton = 1`,
  ).get() as {
    installation_id?: unknown;
    target_id?: unknown;
    status?: unknown;
    watermark?: unknown;
  } | null;
  if (!state) {
    addApplicationTargetNotReady(findings);
    return null;
  }
  const inspected = applicationProjectionState(state);
  if (!inspected) {
    addFinding(findings, {
      severity: 'error',
      code: 'database.identity_projection.application_state_invalid',
      path: 'db',
      message: 'The application identity-projection state row is malformed.',
      hint: 'Keep the deployment stopped and repair or rebuild the managed projection state before admitting writes that use Guardian foreign keys.',
      docs: `${SYSTEM_DATABASE_DOCS}#tenant-provisioning-and-readiness`,
    });
    return null;
  }
  if (inspected.targetId !== APPLICATION_IDENTITY_PROJECTION_TARGET_ID) {
    addFinding(findings, {
      severity: 'error',
      code: 'database.identity_projection.application_binding_invalid',
      path: 'db',
      message: 'The application identity-projection state is bound to the wrong logical target.',
      hint: 'Keep the deployment stopped and restore the application database that belongs to this projection target.',
      docs: `${SYSTEM_DATABASE_DOCS}#durable-projection-protocol`,
    });
    return inspected;
  }
  if (inspected.status === 'quarantined') {
    addFinding(findings, {
      severity: 'error',
      code: 'database.identity_projection.application_target_quarantined',
      path: 'db',
      message: 'The application identity-projection target is quarantined.',
      hint: 'Repair the target binding/schema fault and reconcile the projection before admitting dependent writes.',
      docs: `${SYSTEM_DATABASE_DOCS}#tenant-provisioning-and-readiness`,
    });
    return inspected;
  }
  if (inspected.status === 'ready') return inspected;
  addApplicationTargetNotReady(findings);
  return inspected;
}

function addApplicationTargetNotReady(findings: PlatformDoctorFindingSink): void {
  addFinding(findings, {
    severity: 'warning',
    code: 'database.identity_projection.target_not_ready',
    path: 'db',
    message: 'The application identity-projection target is not marked ready.',
    hint: 'Keep writes that require Guardian foreign keys gated until projection reconciliation reports ready.',
    docs: `${SYSTEM_DATABASE_DOCS}#tenant-provisioning-and-readiness`,
  });
}

/** Validate system projection schema then report aggregate per-scope health. */
export function checkSystemIdentityProjectionState(
  system: Database,
  findings: PlatformDoctorFindingSink,
  projection: DoctorIdentityProjectionConfiguration,
  applicationState: DoctorApplicationIdentityProjectionState | null,
): void {
  const systemSchema = inspectSystemProjectionSchema(system);
  if (systemSchema !== 'ready') {
    addFinding(findings, {
      severity: systemSchema === 'invalid' ? 'error' : 'warning',
      code: systemSchema === 'invalid'
        ? 'database.identity_projection.system_schema_invalid'
        : 'database.identity_projection.system_schema_missing',
      path: 'systemDb',
      message: systemSchema === 'invalid'
        ? 'The existing system database contains an incompatible Guardian identity-projection schema.'
        : 'The existing system database does not contain the complete Guardian identity-projection installation, target, and outbox schema.',
      hint: systemSchema === 'invalid'
        ? 'Keep the deployment stopped, restore or migrate the system database schema, then rerun Doctor before startup.'
        : 'Start the upgraded app only after platform migrations and projection initialization are ready.',
      docs: `${SYSTEM_DATABASE_DOCS}#durable-projection-protocol`,
    });
    return;
  }
  checkProjectionBindings(system, findings, projection, applicationState);
  checkProjectionTargetSummary(system, findings, projection);
}

function applicationProjectionState(
  row: {
    installation_id?: unknown;
    target_id?: unknown;
    status?: unknown;
    watermark?: unknown;
  } | null,
): DoctorApplicationIdentityProjectionState | null {
  if (!row
    || !isIdentityProjectionId(row.installation_id)
    || !isIdentityProjectionId(row.target_id)
    || (row.status !== 'provisioning'
      && row.status !== 'ready'
      && row.status !== 'quarantined')
    || typeof row.watermark !== 'number'
    || !Number.isSafeInteger(row.watermark)
    || row.watermark < 0) return null;
  return Object.freeze({
    installationId: row.installation_id,
    targetId: row.target_id,
    status: row.status,
    watermark: row.watermark,
  });
}

function checkProjectionBindings(
  system: Database,
  findings: PlatformDoctorFindingSink,
  projection: DoctorIdentityProjectionConfiguration,
  applicationState: DoctorApplicationIdentityProjectionState | null,
): void {
  const installation = system.query(`
    SELECT installation_id
    FROM ${IDENTITY_PROJECTION_INSTALLATION_TABLE}
    WHERE singleton = 1
  `).get() as { installation_id?: unknown } | null;
  const installationId = isIdentityProjectionId(installation?.installation_id)
    ? installation.installation_id
    : null;
  if (!installationId) {
    addFinding(findings, {
      severity: 'warning',
      code: 'database.identity_projection.system_installation_missing',
      path: 'systemDb',
      message: 'The projection system schema has no installation binding yet.',
      hint: 'Initialize the upgraded platform before admitting writes that depend on Guardian identity anchors.',
      docs: `${SYSTEM_DATABASE_DOCS}#durable-projection-protocol`,
    });
  } else if (applicationState && applicationState.installationId !== installationId) {
    addFinding(findings, {
      severity: 'error',
      code: 'database.identity_projection.application_installation_mismatch',
      path: 'db',
      message: 'The application identity-projection target belongs to a different system-database installation.',
      hint: 'Keep the deployment stopped and restore the matching system/application database set before reconciliation.',
      docs: `${SYSTEM_DATABASE_DOCS}#durable-projection-protocol`,
    });
  }

  if (projection.applicationReferenceCount === 0) return;
  const source = system.query(`
    SELECT scope, status, acknowledged_sequence
    FROM ${IDENTITY_PROJECTION_TARGETS_TABLE}
    WHERE target_id = ?
  `).get(APPLICATION_IDENTITY_PROJECTION_TARGET_ID) as {
    scope?: unknown;
    status?: unknown;
    acknowledged_sequence?: unknown;
  } | null;
  if (!source) {
    addFinding(findings, {
      severity: 'warning',
      code: 'database.identity_projection.application_target_missing',
      path: 'systemDb',
      message: 'The system database has not registered the required application projection target.',
      hint: 'Initialize and reconcile the application target before admitting writes that depend on Guardian foreign keys.',
      docs: `${SYSTEM_DATABASE_DOCS}#tenant-provisioning-and-readiness`,
    });
    return;
  }
  if (source.scope !== 'application') {
    addFinding(findings, {
      severity: 'error',
      code: 'database.identity_projection.application_scope_invalid',
      path: 'systemDb',
      message: 'The required application projection target is registered with an incompatible scope.',
      hint: 'Keep the deployment stopped and repair the projection target registration before reconciliation.',
      docs: `${SYSTEM_DATABASE_DOCS}#durable-projection-protocol`,
    });
    return;
  }
  if (!applicationState
    || applicationState.status !== 'ready'
    || source.status !== 'ready') return;
  if (typeof source.acknowledged_sequence !== 'number'
    || !Number.isSafeInteger(source.acknowledged_sequence)
    || source.acknowledged_sequence < 0
    || source.acknowledged_sequence !== applicationState.watermark) {
    addFinding(findings, {
      severity: 'error',
      code: 'database.identity_projection.application_watermark_mismatch',
      path: 'db',
      message: 'The ready application target and system projection source disagree on their durable sequence watermark.',
      hint: 'Keep dependent writes gated and reconcile the matching database set before startup.',
      docs: `${SYSTEM_DATABASE_DOCS}#durable-projection-protocol`,
    });
  }
}

function isIdentityProjectionId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    requireIdentityProjectionId(value, 'doctorValue');
    return true;
  } catch {
    return false;
  }
}

function inspectSystemProjectionSchema(database: Database): 'ready' | 'missing' | 'invalid' {
  return inspectManagedSchema(database, SYSTEM_PROJECTION_TABLES);
}

function inspectManagedSchema(
  database: Database,
  validators: readonly ManagedTableValidator[],
): ManagedSchemaStatus {
  let missing = false;
  let invalid = false;
  for (const validator of validators) {
    if (!hasSQLiteTable(database, validator.table)) {
      missing = true;
      continue;
    }
    try {
      validator.assertExact(database);
    } catch (error) {
      if (!(error instanceof IdentityProjectionError)
        || error.code !== 'IDENTITY_PROJECTION_SCHEMA_INVALID') throw error;
      invalid = true;
    }
  }
  return invalid ? 'invalid' : missing ? 'missing' : 'ready';
}

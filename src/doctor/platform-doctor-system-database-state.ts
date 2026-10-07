/** Coordinates read-only state inspection across application and system planes. */

import type { Database } from 'bun:sqlite';

import { hasLegacySystemLayout } from '../frontend/server/system-database-layout';
import type { ResolvedConfig } from '../frontend/server/types';
import { inspectGuardianReferenceSchema } from '../schema/guardian-references';
import { checkAuthAuthorityRevisionState } from './platform-doctor-auth-authority';
import type { DoctorIdentityProjectionConfiguration } from './platform-doctor-identity-projection';
import {
  checkApplicationIdentityProjectionState,
  checkSystemIdentityProjectionState,
  type DoctorApplicationIdentityProjectionState,
} from './platform-doctor-identity-projection-state';
import {
  addPlatformDoctorFinding as addFinding,
  type PlatformDoctorFindingSink,
} from './platform-doctor-contracts';
import { SYSTEM_DATABASE_DOCS } from './platform-doctor-system-database-config';
import {
  hasSQLiteTable,
  withDoctorDatabase,
} from './platform-doctor-system-database-inspection';
import { checkGuardianPresenceApplicationState, checkGuardianProfileFeatureState,
  type DoctorGuardianProfileFeatures } from './platform-doctor-guardian-features';

/** Inspect existing databases without creating, migrating, or mutating them. */
export function inspectSystemDatabaseState(
  resolved: ResolvedConfig,
  findings: PlatformDoctorFindingSink,
  projectRoot: string,
  projection: DoctorIdentityProjectionConfiguration,
  features: DoctorGuardianProfileFeatures | null = null,
): void {
  let applicationState: DoctorApplicationIdentityProjectionState | null = null;
  withDoctorDatabase(resolved.db, projectRoot, 'db', findings, (application) => {
    if (hasLegacySystemLayout(application)) {
      addFinding(findings, {
        severity: 'error',
        code: 'database.system.legacy_combined_layout',
        path: 'db',
        message: 'The application database still contains a legacy combined Zero system layout.',
        hint: 'Keep the deployment stopped and perform an explicit reviewed split; Zero will not move authority rows during startup.',
        docs: `${SYSTEM_DATABASE_DOCS}#existing-application-upgrade`,
      });
      return;
    }
    if (features) checkGuardianPresenceApplicationState(application, features, findings);
    if (projection.applicationReferenceCount > 0) {
      checkApplicationGuardianReferenceStorage(application, resolved, findings);
      applicationState = checkApplicationIdentityProjectionState(
        application,
        findings,
      );
    }
  });

  if (resolved.auth === false && projection.referenceCount === 0) return;
  withDoctorDatabase(resolved.systemDb, projectRoot, 'systemDb', findings, (system) => {
    if (resolved.auth !== false) checkAuthAuthorityRevisionState(system, findings);
    if (features) checkGuardianProfileFeatureState(system, features, findings);
    if (projection.referenceCount > 0) {
      checkSystemIdentityProjectionState(system, findings, projection, applicationState);
    }
  });
}

function checkApplicationGuardianReferenceStorage(
  application: Database,
  resolved: ResolvedConfig,
  findings: PlatformDoctorFindingSink,
): void {
  const tenantTables = resolved.databaseTopology.mode === 'multiple'
    && resolved.databaseTopology.tenantIsolation === 'tenant-database'
    ? new Set(resolved.resources
        .filter((resource) => resource.realm?.kind === 'tenant')
        .map((resource) => resource.table))
    : new Set<string>();
  for (const [table, schema] of Object.entries(resolved.tables)) {
    if (tenantTables.has(table)) continue;
    if (!hasSQLiteTable(application, table)) continue;
    for (const issue of inspectGuardianReferenceSchema(schema, {
      database: application,
      tableName: table,
    })) {
      if (issue.code !== 'missing-foreign-key'
        && issue.code !== 'invalid-foreign-key') continue;
      addFinding(findings, {
        severity: 'error',
        code: 'database.identity_projection.reference_storage_invalid',
        path: `tables.${table}.${issue.field}`,
        message: `The application database Guardian foreign key for field "${issue.field}" on table "${table}" does not match its declaration.`,
        hint: 'Keep the deployment stopped and apply a reviewed table migration that restores the exact Guardian foreign key with ON DELETE RESTRICT.',
        docs: `${SYSTEM_DATABASE_DOCS}#identity-anchors`,
      });
    }
  }
}

/** Declarative Guardian identity-reference diagnostics for app and Fabric tables. */

import type { ResolvedConfig } from '../frontend/server/types';
import {
  getGuardianTableReferences,
  inspectGuardianReferenceSchema,
} from '../schema/guardian-references';
import {
  addPlatformDoctorFinding as addFinding,
  type PlatformDoctorFindingSink,
} from './platform-doctor-contracts';
import { SYSTEM_DATABASE_DOCS } from './platform-doctor-system-database-config';

/** Projection requirements partitioned by physical application target. */
export interface DoctorIdentityProjectionConfiguration {
  readonly referenceCount: number;
  readonly applicationReferenceCount: number;
  readonly tenantReferenceCount: number;
}

/** Validate projection prerequisites and describe the configured target planes. */
export function checkIdentityProjectionConfiguration(
  resolved: ResolvedConfig,
  findings: PlatformDoctorFindingSink,
): DoctorIdentityProjectionConfiguration {
  for (const [table, schema] of Object.entries(resolved.tables)) {
    for (const issue of inspectGuardianReferenceSchema(schema)) {
      addFinding(findings, {
        severity: 'error',
        code: 'database.identity_projection.reference_schema_invalid',
        path: `tables.${table}.${issue.field}`,
        message: `Guardian field "${issue.field}" on table "${table}" does not declare its exact managed foreign key.`,
        hint: 'Restore the field.guardianUser() or field.guardianMembership() declaration before startup.',
        docs: `${SYSTEM_DATABASE_DOCS}#identity-anchors`,
      });
    }
  }
  const references = Object.entries(resolved.tables).flatMap(([table, schema]) =>
    getGuardianTableReferences(schema).map((reference) => ({ table, reference })));
  const tenantTables = physicalTenantTables(resolved);
  const applicationReferences = references.filter(({ table }) => !tenantTables.has(table));
  const tenantReferences = references.filter(({ table }) => tenantTables.has(table));
  const needsMembership = references.some(({ reference }) =>
    reference.kind === 'membership');
  const configuration = Object.freeze({
    referenceCount: references.length,
    applicationReferenceCount: applicationReferences.length,
    tenantReferenceCount: tenantReferences.length,
  });
  if (references.length === 0) return configuration;

  if (resolved.auth === false) {
    addFinding(findings, {
      severity: 'error',
      code: 'database.identity_projection.requires_auth',
      path: 'tables',
      message: 'Application fields declare Guardian identity references while Guardian auth is disabled.',
      hint: 'Enable auth or replace Guardian reference fields with ordinary application-owned identifiers.',
      docs: `${SYSTEM_DATABASE_DOCS}#identity-anchors`,
    });
  } else if (needsMembership && resolvedTenancyMode(resolved) !== 'multi') {
    addFinding(findings, {
      severity: 'error',
      code: 'database.identity_projection.membership_requires_multi',
      path: 'tables',
      message: 'A Guardian membership reference requires multi-tenant Guardian mode.',
      hint: 'Use auth.tenancy: "multi", or reference the Guardian user anchor instead.',
      docs: `${SYSTEM_DATABASE_DOCS}#identity-anchors`,
    });
  } else {
    addFinding(findings, {
      severity: 'info',
      code: 'database.identity_projection.configured',
      path: 'tables',
      message: projectionConfigurationMessage(
        applicationReferences.length,
        tenantReferences.length,
      ),
      hint: 'Doctor inspects the shared application target directly and reports scope-specific physical-target readiness from the system plane when their SQLite files already exist.',
      docs: `${SYSTEM_DATABASE_DOCS}#durable-projection-protocol`,
    });
  }

  return configuration;
}

function resolvedTenancyMode(resolved: ResolvedConfig): 'single' | 'multi' {
  if (resolved.auth === false) return 'single';
  const tenancy = (resolved.auth as {
    tenancy?: 'single' | 'multi' | { mode?: 'single' | 'multi' };
  }).tenancy;
  if (typeof tenancy === 'string') return tenancy;
  return tenancy?.mode ?? 'single';
}

function physicalTenantTables(resolved: ResolvedConfig): ReadonlySet<string> {
  if (resolved.databaseTopology.mode !== 'multiple'
    || resolved.databaseTopology.tenantIsolation !== 'tenant-database') {
    return new Set();
  }
  return new Set(resolved.resources
    .filter((resource) => resource.realm?.kind === 'tenant')
    .map((resource) => resource.table));
}

function projectionConfigurationMessage(
  applicationReferences: number,
  tenantReferences: number,
): string {
  const details = [
    applicationReferences > 0
      ? `${applicationReferences} shared-application reference${applicationReferences === 1 ? '' : 's'}`
      : null,
    tenantReferences > 0
      ? `${tenantReferences} physical-tenant reference${tenantReferences === 1 ? '' : 's'}`
      : null,
  ].filter((value): value is string => value !== null);
  return `Guardian identity projection is required by ${details.join(' and ')}.`;
}

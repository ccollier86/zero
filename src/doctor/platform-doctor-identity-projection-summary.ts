/** Aggregate, scope-aware identity-projection target health diagnostics. */

import type { Database } from 'bun:sqlite';

import {
  IDENTITY_PROJECTION_OUTBOX_TABLE,
  IDENTITY_PROJECTION_TARGETS_TABLE,
} from '../auth/identity-projection-schema';
import type { DoctorIdentityProjectionConfiguration } from './platform-doctor-identity-projection';
import {
  addPlatformDoctorFinding as addFinding,
  type PlatformDoctorFindingSink,
} from './platform-doctor-contracts';
import { SYSTEM_DATABASE_DOCS } from './platform-doctor-system-database-config';

interface ProjectionTargetSummary {
  readonly total: number;
  readonly ready: number;
  readonly provisioning: number;
  readonly quarantined: number;
  readonly invalid: number;
  readonly applicationTotal: number;
  readonly applicationReady: number;
  readonly tenantTotal: number;
  readonly tenantReady: number;
  readonly namedTotal: number;
  readonly namedReady: number;
}

/** Report global health while preserving application/tenant/named separation. */
export function checkProjectionTargetSummary(
  system: Database,
  findings: PlatformDoctorFindingSink,
  projection: DoctorIdentityProjectionConfiguration,
): void {
  const row = system.query(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) AS ready,
      SUM(CASE WHEN status = 'provisioning' THEN 1 ELSE 0 END) AS provisioning,
      SUM(CASE WHEN status = 'quarantined' THEN 1 ELSE 0 END) AS quarantined,
      SUM(CASE
        WHEN scope IS NULL OR scope NOT IN ('application', 'tenant', 'named')
          OR status IS NULL OR status NOT IN ('provisioning', 'ready', 'quarantined')
          OR typeof(next_sequence) <> 'integer' OR next_sequence < 1
          OR typeof(acknowledged_sequence) <> 'integer' OR acknowledged_sequence < 0
        THEN 1 ELSE 0 END
      ) AS invalid,
      SUM(CASE WHEN scope = 'application' THEN 1 ELSE 0 END) AS application_total,
      SUM(CASE WHEN scope = 'application' AND status = 'ready' THEN 1 ELSE 0 END) AS application_ready,
      SUM(CASE WHEN scope = 'tenant' THEN 1 ELSE 0 END) AS tenant_total,
      SUM(CASE WHEN scope = 'tenant' AND status = 'ready' THEN 1 ELSE 0 END) AS tenant_ready,
      SUM(CASE WHEN scope = 'named' THEN 1 ELSE 0 END) AS named_total,
      SUM(CASE WHEN scope = 'named' AND status = 'ready' THEN 1 ELSE 0 END) AS named_ready
    FROM ${IDENTITY_PROJECTION_TARGETS_TABLE}
  `).get() as Record<string, number | null>;
  const summary = projectionTargetSummary(row);
  const backlog = system.query(`
    SELECT COUNT(*) AS count
    FROM ${IDENTITY_PROJECTION_OUTBOX_TABLE}
    WHERE status <> 'completed'
  `).get() as { count: number };
  const backlogCount = countValue(backlog.count);

  if (summary.invalid > 0) {
    addFinding(findings, {
      severity: 'error',
      code: 'database.identity_projection.targets_invalid',
      path: 'systemDb',
      message: `${summary.invalid} identity-projection target record${summary.invalid === 1 ? ' is' : 's are'} incompatible with the managed protocol.`,
      hint: 'Keep the deployment stopped and repair or restore the managed system projection state before reconciliation.',
      docs: `${SYSTEM_DATABASE_DOCS}#durable-projection-protocol`,
    });
    return;
  }

  if (summary.quarantined > 0) {
    addFinding(findings, {
      severity: 'error',
      code: 'database.identity_projection.targets_quarantined',
      path: 'systemDb',
      message: `${summary.quarantined} identity-projection target${summary.quarantined === 1 ? ' is' : 's are'} quarantined${scopeSummarySuffix(summary, projection)}.`,
      hint: 'Inspect the target-safe error code, repair the binding/schema fault, and reconcile before admitting dependent application writes.',
      docs: `${SYSTEM_DATABASE_DOCS}#tenant-provisioning-and-readiness`,
    });
    return;
  }

  if (summary.provisioning > 0 || backlogCount > 0) {
    addFinding(findings, {
      severity: 'warning',
      code: 'database.identity_projection.targets_pending',
      path: 'systemDb',
      message: `${summary.provisioning} projection target${summary.provisioning === 1 ? ' is' : 's are'} provisioning and ${backlogCount} delivery event${backlogCount === 1 ? ' remains' : 's remain'} pending${scopeSummarySuffix(summary, projection)}.`,
      hint: 'Wait for reconciliation and target readiness before routing writes that require Guardian foreign keys.',
      docs: `${SYSTEM_DATABASE_DOCS}#tenant-provisioning-and-readiness`,
    });
    return;
  }

  addFinding(findings, {
    severity: 'info',
    code: 'database.identity_projection.targets_ready',
    path: 'systemDb',
    message: `${summary.ready} of ${summary.total} registered projection targets are ready with no delivery backlog${scopeSummarySuffix(summary, projection)}.`,
    docs: `${SYSTEM_DATABASE_DOCS}#tenant-provisioning-and-readiness`,
  });
}

function projectionTargetSummary(row: Record<string, number | null>): ProjectionTargetSummary {
  return Object.freeze({
    total: countValue(row.total),
    ready: countValue(row.ready),
    provisioning: countValue(row.provisioning),
    quarantined: countValue(row.quarantined),
    invalid: countValue(row.invalid),
    applicationTotal: countValue(row.application_total),
    applicationReady: countValue(row.application_ready),
    tenantTotal: countValue(row.tenant_total),
    tenantReady: countValue(row.tenant_ready),
    namedTotal: countValue(row.named_total),
    namedReady: countValue(row.named_ready),
  });
}

function countValue(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}

function scopeSummarySuffix(
  summary: ProjectionTargetSummary,
  projection: DoctorIdentityProjectionConfiguration,
): string {
  const scopes: string[] = [];
  if (projection.applicationReferenceCount > 0 || summary.applicationTotal > 0) {
    scopes.push(`application ${summary.applicationReady}/${summary.applicationTotal}`);
  }
  if (projection.tenantReferenceCount > 0 || summary.tenantTotal > 0) {
    scopes.push(`tenant ${summary.tenantReady}/${summary.tenantTotal}`);
  }
  if (summary.namedTotal > 0) {
    scopes.push(`named ${summary.namedReady}/${summary.namedTotal}`);
  }
  return scopes.length > 0 ? ` (${scopes.join(', ')})` : '';
}

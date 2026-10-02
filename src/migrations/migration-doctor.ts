/**
 * migration-doctor.ts
 *
 * Aggregates migration health checks. It reports findings only; CLI callers
 * decide whether warnings should fail a build.
 */

import type { Database } from 'bun:sqlite';
import { diffSchemaSnapshots } from './schema-diff';
import { inspectDatabaseSchema } from './schema-inspector';
import { hashMigration, snapshotDeclaredTables } from './schema-snapshot';
import type {
  DeclaredTables,
  Migration,
  MigrationStatus,
  SchemaDiffIssue,
} from './types';
import { MigrationLedger } from './migration-ledger';

export interface DoctorFinding {
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
}

export interface DoctorReport {
  findings: DoctorFinding[];
  schemaIssues: SchemaDiffIssue[];
  ok: boolean;
}

/** Inspect application schema drift without creating platform migration state. */
export function runSchemaDoctor(params: {
  db: Database;
  declaredTables: DeclaredTables;
  strict?: boolean;
}): DoctorReport {
  const declared = snapshotDeclaredTables(params.declaredTables);
  const actual = inspectDatabaseSchema(params.db, { includeInternal: false });
  const schemaIssues = diffSchemaSnapshots(declared, actual);
  const hasError = schemaIssues.some((issue) => issue.severity === 'error');
  const hasWarning = schemaIssues.some((issue) => issue.severity === 'warning');

  return {
    findings: [],
    schemaIssues,
    ok: params.strict ? !hasError && !hasWarning : !hasError,
  };
}

/** Run migration and optional schema drift checks. */
export function runMigrationDoctor(params: {
  db: Database;
  migrations: Migration[];
  declaredTables?: DeclaredTables;
  strict?: boolean;
}): DoctorReport {
  const findings: DoctorFinding[] = [];
  const schemaIssues: SchemaDiffIssue[] = [];
  const ledger = new MigrationLedger(params.db);
  const latestEvents = ledger.latestByVersion();
  const durableStates = ledger.stateByVersion();

  for (const migration of params.migrations) {
    const event = latestEvents.get(migration.version);
    const state = durableStates.get(migration.version);
    const checksum = hashMigration(migration);
    const isApplied = state?.status === 'applied' && state.direction === 'up';

    if (!isApplied) {
      findings.push({
        severity: 'warning',
        code: 'migration.pending',
        message: `Migration ${migration.version} is pending: ${migration.description}`,
      });
    }

    if (event?.status === 'failed') {
      findings.push({
        severity: 'error',
        code: 'migration.failed',
        message: `Migration ${migration.version} failed previously: ${event.error ?? 'unknown error'}`,
      });
    }

    if (isApplied && state.checksum !== checksum) {
      findings.push({
        severity: 'error',
        code: 'migration.checksum',
        message: `Migration ${migration.version} changed after it was applied.`,
      });
    }

    if (!migration.down) {
      findings.push({
        severity: migration.safety === 'destructive' ? 'error' : 'info',
        code: 'migration.no_down',
        message: `Migration ${migration.version} does not define down().`,
      });
    }
  }

  if (params.declaredTables) {
    const declared = snapshotDeclaredTables(params.declaredTables);
    const actual = inspectDatabaseSchema(params.db, { includeInternal: false });
    schemaIssues.push(...diffSchemaSnapshots(declared, actual));
  } else {
    findings.push({
      severity: 'info',
      code: 'schema.not_loaded',
      message: 'App schema drift is checked separately with --doctor --schema <module> --db <application-db>.',
    });
  }

  const hasError = findings.some((finding) => finding.severity === 'error') ||
    schemaIssues.some((issue) => issue.severity === 'error');
  const hasWarning = findings.some((finding) => finding.severity === 'warning') ||
    schemaIssues.some((issue) => issue.severity === 'warning');

  return {
    findings,
    schemaIssues,
    ok: params.strict ? !hasError && !hasWarning : !hasError,
  };
}

/** Convert migrator status to doctor findings for display reuse. */
export function statusToFindings(statuses: MigrationStatus[]): DoctorFinding[] {
  return statuses.flatMap((status) => {
    const findings: DoctorFinding[] = [];
    if (!status.applied) {
      findings.push({
        severity: 'warning',
        code: 'migration.pending',
        message: `Migration ${status.version} is pending: ${status.description}`,
      });
    }
    if (status.lastStatus === 'failed') {
      findings.push({
        severity: 'error',
        code: 'migration.failed',
        message: `Migration ${status.version} failed during its most recent attempt.`,
      });
    }
    if (status.checksumMatches === false) {
      findings.push({
        severity: 'error',
        code: 'migration.checksum',
        message: `Migration ${status.version} changed after it was applied.`,
      });
    }
    return findings;
  });
}

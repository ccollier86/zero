/**
 * platform-doctor-data.ts
 *
 * Pure diagnostics for pre-resolution data dependencies, table identity,
 * migration readiness, and configured ReactiveDB synchronization behavior.
 */

import type {
  AppConfig,
  AppTableInput,
  ResolvedConfig,
} from '../frontend/server/types';
import { tableColumnDeclaresPrimaryKey } from '../resources/resource-schema';
import type { TableSchema } from '../sync/types';
import {
  addPlatformDoctorFinding as addFinding,
  type PlatformDoctorFindingSink,
} from './platform-doctor-contracts';

export function checkPreResolutionConfig(
  config: AppConfig,
  findings: PlatformDoctorFindingSink,
): void {
  if (config.stateSync && (config.auth === false || config.auth === undefined)) {
    addFinding(findings, {
      severity: 'error',
      code: 'auth.state_sync.requires_auth',
      path: 'stateSync',
      message: 'stateSync requires auth because server state is keyed by authenticated user id.',
      hint: 'Set auth: true or disable stateSync for unauthenticated apps.',
      docs: './docs/state-sync.md',
    });
  }

  if (
    (config.storageDir !== undefined || config.storage !== undefined)
    && (config.auth === false || config.auth === undefined)
  ) {
    addFinding(findings, {
      severity: 'warning',
      code: 'storage.auth_required',
      path: config.storage !== undefined ? 'storage' : 'storageDir',
      message: 'File storage is configured, but platform storage only mounts when auth is enabled.',
      hint: 'Enable auth for built-in file storage, or remove the storage configuration if the app is not using platform storage.',
      docs: './docs/start-here.md#built-in-systems',
    });
  }
}

export function checkTableSchemas(
  tables: Record<string, AppTableInput>,
  findings: PlatformDoctorFindingSink,
): void {
  for (const [tableName, input] of Object.entries(tables)) {
    const schema = normalizeTableInput(input);
    const primaryColumns = findPrimaryKeyColumns(schema);
    const path = `tables.${tableName}`;

    if (primaryColumns.length === 0) {
      findings.push({
        severity: 'error',
        code: 'schema.primary_key.missing',
        path,
        message: `Table "${tableName}" has no primary key. ReactiveDB tables need one string sync primary key.`,
      });
    } else if (primaryColumns.length > 1) {
      findings.push({
        severity: 'error',
        code: 'schema.primary_key.composite',
        path,
        message: `Table "${tableName}" declares multiple primary-key columns. Use one sync primary key plus _identity for natural/composite identity.`,
      });
    }

    checkIdentity(tableName, schema, primaryColumns[0], findings);
  }
}

export function checkMigrations(
  resolved: ResolvedConfig,
  findings: PlatformDoctorFindingSink,
): void {
  if (resolved.db.mode !== 'memory' && !resolved.migrate) {
    findings.push({
      severity: 'warning',
      code: 'migrations.startup.disabled',
      path: 'migrate',
      message: 'File-backed databases should run migrations on startup or through the migration CLI before deploy.',
    });
  }
}

export function checkSyncPolicy(
  resolved: ResolvedConfig,
  findings: PlatformDoctorFindingSink,
): void {
  if (resolved.syncAuthDefaulted) {
    findings.push({
      severity: 'info',
      code: 'sync.auth.required_defaulted',
      path: 'syncAuth',
      message: 'Auth-enabled apps default WebSocket Sync to authenticated-only.',
      hint: 'Set syncAuth: "public" explicitly only when anonymous table synchronization is intentional.',
      docs: './docs/realtime-sync/realtime-sync/protocol.md',
    });
  }
  if (resolved.auth !== false && !resolved.syncPolicy) {
    const resourceTables = new Set(resolved.resources.map((resource) => resource.table));
    const uncoveredTables = [...resolved.declaredSyncModes.keys()]
      .filter((tableName) => !resourceTables.has(tableName));

    if (uncoveredTables.length > 0) {
      findings.push({
        severity: 'warning',
        code: 'sync.auth_policy.open_app_tables',
        path: 'syncPolicy',
        message: `Auth is enabled but no app syncPolicy is configured for uncovered app tables: ${uncoveredTables.join(', ')}.`,
      });
    }
  }

  for (const [tableName, mode] of resolved.declaredSyncModes) {
    const resource = resolved.resources.find((candidate) => candidate.table === tableName);
    const hasHttpDataExposure = !resource
      || resource.exposure === undefined
      || resource.exposure === 'http'
      || resource.exposure === 'all';
    if (!hasHttpDataExposure) continue;
    if (mode === 'lazy') {
      findings.push({
        severity: 'warning',
        code: 'sync.lazy.index_guidance',
        path: `tables.${tableName}`,
        message: `Table "${tableName}" is lazy synced. Add migration indexes for columns used by /api/data filters and sorting.`,
      });
    } else if (mode === 'auto') {
      findings.push({
        severity: 'info',
        code: 'sync.auto.index_guidance',
        path: `tables.${tableName}`,
        message: `Table "${tableName}" uses auto sync. If it becomes lazy, index frequent /api/data filter and sort columns.`,
      });
    }
  }
}

function normalizeTableInput(input: AppTableInput): TableSchema {
  return isWrappedTableInput(input) ? input.serverTable : input;
}

function isWrappedTableInput(
  input: AppTableInput,
): input is { serverTable: TableSchema } {
  const serverTable = (input as { serverTable?: unknown }).serverTable;
  return Boolean(serverTable && typeof serverTable === 'object' && !Array.isArray(serverTable));
}

function findPrimaryKeyColumns(schema: TableSchema): string[] {
  return Object.entries(schema)
    .filter(([column]) => tableColumnDeclaresPrimaryKey(schema, column))
    .map(([column]) => column);
}

function checkIdentity(
  tableName: string,
  schema: TableSchema,
  primaryKey: string | undefined,
  findings: PlatformDoctorFindingSink,
): void {
  const identity = schema._identity;
  if (identity === undefined) return;

  if (!Array.isArray(identity)) {
    findings.push({
      severity: 'error',
      code: 'schema.identity.invalid',
      path: `tables.${tableName}._identity`,
      message: `Table "${tableName}" _identity must be an array of column names.`,
    });
    return;
  }

  const columns = new Set(
    Object.entries(schema)
      .filter(([key, value]) => key !== '_identity' && typeof value === 'string')
      .map(([key]) => key),
  );
  const seen = new Set<string>();

  for (const field of identity) {
    if (typeof field !== 'string' || field.length === 0) {
      findings.push({
        severity: 'error',
        code: 'schema.identity.invalid',
        path: `tables.${tableName}._identity`,
        message: `Table "${tableName}" _identity contains a non-string field.`,
      });
      continue;
    }
    if (seen.has(field)) {
      findings.push({
        severity: 'error',
        code: 'schema.identity.duplicate_field',
        path: `tables.${tableName}._identity`,
        message: `Table "${tableName}" repeats identity field "${field}".`,
      });
    }
    seen.add(field);
    if (!columns.has(field)) {
      findings.push({
        severity: 'error',
        code: 'schema.identity.missing_field',
        path: `tables.${tableName}._identity`,
        message: `Table "${tableName}" identity field "${field}" is not a declared column.`,
      });
    }
    if (primaryKey && field === primaryKey) {
      findings.push({
        severity: 'error',
        code: 'schema.identity.primary_key_field',
        path: `tables.${tableName}._identity`,
        message: `Table "${tableName}" identity field "${field}" cannot also be the sync primary key.`,
      });
    }
  }
}

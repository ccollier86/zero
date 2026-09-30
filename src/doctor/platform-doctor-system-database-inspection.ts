/** Safe read-only SQLite access shared by system-plane Doctor diagnostics. */

import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { resolveSQLiteStorageConfig } from '../persistence/storage-config';
import type { ReactiveDBConfig } from '../sync/types';
import {
  addPlatformDoctorFinding as addFinding,
  type PlatformDoctorFindingSink,
} from './platform-doctor-contracts';
import { SYSTEM_DATABASE_DOCS } from './platform-doctor-system-database-config';

export type DoctorDatabasePlane = 'db' | 'systemDb';

/** Inspect an existing handle/file and contain all native SQLite failures. */
export function withDoctorDatabase(
  config: ReactiveDBConfig,
  projectRoot: string,
  path: DoctorDatabasePlane,
  findings: PlatformDoctorFindingSink,
  inspect: (database: Database) => void,
): void {
  if (config.sqlite) {
    inspectSafely(config.sqlite.raw, path, findings, inspect);
    return;
  }
  if (config.database) {
    inspectSafely(config.database, path, findings, inspect);
    return;
  }
  const file = inspectableDatabaseFile(config, projectRoot);
  if (!file) return;

  let database: Database | null = null;
  let failed = false;
  try {
    database = new Database(file, { readonly: true });
    inspect(database);
  } catch {
    failed = true;
  } finally {
    try {
      database?.close();
    } catch {
      failed = true;
    }
  }
  if (failed) addDatabaseInspectionUnavailable(findings, path);
}

/** Test whether a present SQLite table supplies every operational column. */
export function tableHasRequiredColumns(
  database: Database,
  table: string,
  requiredColumns: readonly string[],
): boolean {
  const columns = database.query(`PRAGMA table_info(\"${quotePragmaIdentifier(table)}\")`)
    .all() as Array<{ name?: unknown }>;
  const names = new Set(columns
    .map(({ name }) => typeof name === 'string' ? name : null)
    .filter((name): name is string => name !== null));
  return requiredColumns.every((column) => names.has(column));
}

/** Test table presence without interpolating the table name into SQL. */
export function hasSQLiteTable(database: Database, table: string): boolean {
  return Boolean(database.query(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
  ).get(table));
}

function inspectSafely(
  database: Database,
  path: DoctorDatabasePlane,
  findings: PlatformDoctorFindingSink,
  inspect: (database: Database) => void,
): void {
  try {
    inspect(database);
  } catch {
    addDatabaseInspectionUnavailable(findings, path);
  }
}

function addDatabaseInspectionUnavailable(
  findings: PlatformDoctorFindingSink,
  path: DoctorDatabasePlane,
): void {
  addFinding(findings, {
    severity: 'warning',
    code: 'database.system.file_inspection_unavailable',
    path,
    message: `Doctor could not inspect the existing ${path === 'db' ? 'application' : 'system'} SQLite schema in read-only mode.`,
    hint: 'Stop conflicting maintenance, verify the database is readable, and rerun Doctor.',
    docs: `${SYSTEM_DATABASE_DOCS}#operations-and-diagnostics`,
  });
}

function inspectableDatabaseFile(
  config: ReactiveDBConfig,
  projectRoot: string,
): string | null {
  const storage = resolveSQLiteStorageConfig(config);
  if (storage.mode === 'ephemeral') return null;
  const candidates = storage.mode === 'hot'
    ? [storage.snapshotPath, storage.path]
    : [storage.path];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const absolute = isAbsolute(candidate) ? candidate : resolve(projectRoot, candidate);
    if (existsSync(absolute)) return absolute;
  }
  return null;
}

function quotePragmaIdentifier(identifier: string): string {
  return identifier.replaceAll('"', '""');
}

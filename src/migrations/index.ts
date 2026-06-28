/**
 * migrations/index.ts
 *
 * Central registry of all migrations, in order.
 * Import each migration definition and add it to the array.
 *
 * Convention:
 *   - Files named NNN_description.ts (e.g., 001_initial_schema.ts)
 *   - Version string is the NNN prefix
 *   - Migrations MUST be appended, never reordered or removed
 */

import type { Migration } from './types';
import { migration as m001 } from './definitions/001_initial_schema';

export { Migrator, type MigratorConfig, type MigrationStatus } from './migrator';
export type {
  DeclaredTables,
  Migration,
  MigrationDirection,
  MigrationEventStatus,
  MigrationLedgerRecord,
  MigrationPlan,
  MigrationPlanStatement,
  MigrationSafety,
  SchemaDiffIssue,
  SchemaSnapshot,
} from './types';
export { MigrationLedger } from './migration-ledger';
export { SchemaHistory } from './schema-history';
export { inspectDatabaseSchema } from './schema-inspector';
export {
  hashMigration,
  hashSchemaSnapshot,
  snapshotDeclaredTables,
} from './schema-snapshot';
export { diffSchemaSnapshots } from './schema-diff';
export { createMigrationPlan, renderMigrationPlan } from './migration-planner';
export { runMigrationDoctor } from './migration-doctor';

/**
 * All migrations in order. Append new migrations at the end.
 */
export const migrations: Migration[] = [
  m001,
];

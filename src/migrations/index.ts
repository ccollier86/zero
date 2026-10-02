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
import { migration as m002 } from './definitions/002_auth_account_lifecycle';
import { migration as m003 } from './definitions/003_platform_tokens';
import { migration as m004 } from './definitions/004_auth_email_verification_mfa';
import { migration as m005 } from './definitions/005_native_app_auth';
import { migration as m006 } from './definitions/006_native_auth_hardening';
import { migration as m007 } from './definitions/007_auth_email_outbox';
import { migration as m030 } from './definitions/030_workflow_graph_runtime';

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
  m002,
  m003,
  m004,
  m005,
  m006,
  m007,
  m030,
];

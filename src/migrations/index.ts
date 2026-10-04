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
import { migration as m008 } from './definitions/008_builtin_service_tenant_scope';
import { migration as m009 } from './definitions/009_auth_tenancy_sessions';
import { migration as m010 } from './definitions/010_native_tenant_authority';
import { migration as m011 } from './definitions/011_advanced_authorization_roles';
import { migration as m012 } from './definitions/012_auth_request_admission';
import { migration as m013 } from './definitions/013_tenant_invitation_onboarding';
import { migration as m014 } from './definitions/014_workflow_execution_authority';
import { migration as m015 } from './definitions/015_registration_provisioning';
import { migration as m016 } from './definitions/016_usable_owner_invariants';
import { migration as m017 } from './definitions/017_verified_domain_onboarding';
import { migration as m018 } from './definitions/018_auth_control_plane_audit';
import { migration as m019 } from './definitions/019_verified_domain_release';
import { migration as m020 } from './definitions/020_auth_authority_revision';
import { migration as m021 } from './definitions/021_verified_domain_request_provenance';
import { migration as m022 } from './definitions/022_auth_request_admission_flows';
import { migration as m023 } from './definitions/023_auth_installed_profile';
import { migration as m024 } from './definitions/024_administration_tenant';
import { migration as m025 } from './definitions/025_auth_mfa_assurance';
import { migration as m026 } from './definitions/026_tenant_invitation_grant_snapshot';
import { migration as m027 } from './definitions/027_authorization_registry_manifest';
import { migration as m028 } from './definitions/028_admin_user_provisioning_receipts';
import { migration as m029 } from './definitions/029_guardian_api_keys';
import { migration as m030 } from './definitions/030_workflow_graph_runtime';
import { migration as m031 } from './definitions/031_workflow_graph_tenant_integrity';
import { migration as m032 } from './definitions/032_workflow_runtime_ownership';
import { migration as m033 } from './definitions/033_torrent_integrity_hardening';
import { migration as m034 } from './definitions/034_storage_studio_foundation';
import { migration as m035 } from './definitions/035_storage_blob_leases';
import { migration as m036 } from './definitions/036_workflow_system_event_receipts';
import { migration as m037 } from './definitions/037_database_automation_source_catalog';

export {
  createMigrationRegistry,
  Migrator,
  type MigrationRegistry,
  type MigratorConfig,
  type MigrationStatus,
} from './migrator';
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
  m008,
  m009,
  m010,
  m011,
  m012,
  m013,
  m014,
  m015,
  m016,
  m017,
  m018,
  m019,
  m020,
  m021,
  m022,
  m023,
  m024,
  m025,
  m026,
  m027,
  m028,
  m029,
  m030,
  m031,
  m032,
  m033,
  m034,
  m035,
  m036,
  m037,
];

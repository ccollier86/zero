/**
 * automation-source-catalog-row.ts
 *
 * Decodes and validates private automation source-catalog rows. It owns the
 * durable row-to-domain boundary only; schema creation and catalog mutations
 * are implemented in separate modules.
 */

import { DatabaseError } from '../databases/database-error';
import {
  DATABASE_AUTOMATION_SOURCE_CATALOG_MAX_SOURCES,
  DATABASE_AUTOMATION_SOURCE_CATALOG_SCHEMA_VERSION,
  type DatabaseAutomationSourceRecord,
} from './automation-source-catalog-contract';
import {
  isValidDatabaseAutomationLogicalId,
  isValidDatabaseAutomationSourceRef,
} from './automation-source-catalog-validation';

/** Exact projection required to validate one private source row. */
export const DATABASE_AUTOMATION_SOURCE_CATALOG_ROW_COLUMNS = `
  source_ref,
  source_kind,
  logical_source_id,
  scope_kind,
  scope_id,
  tenant_id,
  lifecycle_status,
  source_revision,
  insertion_ordinal,
  registered_at,
  updated_at,
  schema_version,
  typeof(source_ref) AS source_ref_type,
  typeof(source_kind) AS source_kind_type,
  typeof(logical_source_id) AS logical_source_id_type,
  typeof(scope_kind) AS scope_kind_type,
  typeof(scope_id) AS scope_id_type,
  typeof(tenant_id) AS tenant_id_type,
  typeof(lifecycle_status) AS lifecycle_status_type,
  typeof(source_revision) AS source_revision_type,
  typeof(insertion_ordinal) AS insertion_ordinal_type,
  typeof(registered_at) AS registered_at_type,
  typeof(updated_at) AS updated_at_type,
  typeof(schema_version) AS schema_version_type
`;

export interface DatabaseAutomationSourceCatalogRow {
  source_ref: unknown;
  source_kind: unknown;
  logical_source_id: unknown;
  scope_kind: unknown;
  scope_id: unknown;
  tenant_id: unknown;
  lifecycle_status: unknown;
  source_revision: unknown;
  insertion_ordinal: unknown;
  registered_at: unknown;
  updated_at: unknown;
  schema_version: unknown;
  source_ref_type: unknown;
  source_kind_type: unknown;
  logical_source_id_type: unknown;
  scope_kind_type: unknown;
  scope_id_type: unknown;
  tenant_id_type: unknown;
  lifecycle_status_type: unknown;
  source_revision_type: unknown;
  insertion_ordinal_type: unknown;
  registered_at_type: unknown;
  updated_at_type: unknown;
  schema_version_type: unknown;
}

export interface DatabaseAutomationSourceCatalogStateRow {
  singleton: unknown;
  schema_version: unknown;
  total_sources: unknown;
  last_ordinal: unknown;
  catalog_revision: unknown;
  singleton_type: unknown;
  schema_version_type: unknown;
  total_sources_type: unknown;
  last_ordinal_type: unknown;
  catalog_revision_type: unknown;
}

export interface DatabaseAutomationSourceCatalogState {
  readonly totalSources: number;
  readonly lastOrdinal: number;
  readonly catalogRevision: number;
}

/** Validate and detach one durable source row. */
export function decodeDatabaseAutomationSourceCatalogRow(
  row: DatabaseAutomationSourceCatalogRow,
): DatabaseAutomationSourceRecord {
  if (row.source_ref_type !== 'text'
    || row.source_kind_type !== 'text'
    || row.logical_source_id_type !== 'text'
    || row.scope_kind_type !== 'text'
    || row.scope_id_type !== 'text'
    || (row.tenant_id_type !== 'text' && row.tenant_id_type !== 'null')
    || row.lifecycle_status_type !== 'text'
    || row.source_revision_type !== 'integer'
    || row.insertion_ordinal_type !== 'integer'
    || row.registered_at_type !== 'integer'
    || row.updated_at_type !== 'integer'
    || row.schema_version_type !== 'integer'
    || !isValidDatabaseAutomationSourceRef(row.source_ref)
    || !isValidDatabaseAutomationLogicalId(row.logical_source_id)
    || !isValidDatabaseAutomationLogicalId(row.scope_id)
    || (row.tenant_id !== null
      && !isValidDatabaseAutomationLogicalId(row.tenant_id))
    || (row.source_kind !== 'application'
      && row.source_kind !== 'tenant'
      && row.source_kind !== 'named')
    || (row.scope_kind !== 'application' && row.scope_kind !== 'tenant')
    || (row.lifecycle_status !== 'active'
      && row.lifecycle_status !== 'disabled')
    || !isSafePositive(row.source_revision)
    || !isCatalogOrdinal(row.insertion_ordinal)
    || !isSafeTimestamp(row.registered_at)
    || !isSafeTimestamp(row.updated_at)
    || (row.updated_at as number) < (row.registered_at as number)
    || row.schema_version !== DATABASE_AUTOMATION_SOURCE_CATALOG_SCHEMA_VERSION) {
    throw databaseAutomationSourceCatalogCorrupt();
  }

  const applicationScope = row.scope_kind === 'application'
    && row.scope_id === 'application'
    && row.tenant_id === null;
  const tenantScope = row.scope_kind === 'tenant'
    && row.tenant_id !== null
    && row.scope_id === row.tenant_id;
  if ((row.source_kind === 'application'
      && (row.logical_source_id !== 'application' || !applicationScope))
    || (row.source_kind === 'named' && !applicationScope)
    || (row.source_kind === 'tenant'
      && (!tenantScope || row.logical_source_id !== row.tenant_id))) {
    throw databaseAutomationSourceCatalogCorrupt();
  }

  const authority = row.scope_kind === 'application'
    ? Object.freeze({
        scopeKind: 'application' as const,
        scopeId: 'application' as const,
        tenantId: null,
      })
    : Object.freeze({
        scopeKind: 'tenant' as const,
        scopeId: row.scope_id as string,
        tenantId: row.tenant_id as string,
      });
  return Object.freeze({
    sourceRef: row.source_ref,
    sourceKind: row.source_kind,
    logicalSourceId: row.logical_source_id,
    authority,
    status: row.lifecycle_status,
    revision: row.source_revision as number,
    ordinal: row.insertion_ordinal as number,
    registeredAt: row.registered_at as number,
    updatedAt: row.updated_at as number,
  });
}

/** Validate the singleton catalog state row. */
export function decodeDatabaseAutomationSourceCatalogState(
  row: DatabaseAutomationSourceCatalogStateRow | null,
): DatabaseAutomationSourceCatalogState {
  if (!row
    || row.singleton_type !== 'integer'
    || row.schema_version_type !== 'integer'
    || row.total_sources_type !== 'integer'
    || row.last_ordinal_type !== 'integer'
    || row.catalog_revision_type !== 'integer'
    || row.singleton !== 1
    || row.schema_version !== DATABASE_AUTOMATION_SOURCE_CATALOG_SCHEMA_VERSION
    || !isCatalogCount(row.total_sources)
    || !isCatalogCount(row.last_ordinal)
    || !isSafeCount(row.catalog_revision)
    || ((row.total_sources as number) === 0
      && ((row.last_ordinal as number) !== 0
        || (row.catalog_revision as number) !== 0))
    || ((row.total_sources as number) > 0
      && ((row.last_ordinal as number) < (row.total_sources as number)
        || (row.catalog_revision as number) < (row.total_sources as number)))) {
    throw databaseAutomationSourceCatalogCorrupt();
  }
  return Object.freeze({
    totalSources: row.total_sources as number,
    lastOrdinal: row.last_ordinal as number,
    catalogRevision: row.catalog_revision as number,
  });
}

/** Stable fail-closed error for incompatible or tampered catalog state. */
export function databaseAutomationSourceCatalogCorrupt(
  cause?: unknown,
): DatabaseError {
  return new DatabaseError(
    'DATABASE_SCHEMA_MISMATCH',
    'Database automation source catalog is incompatible.',
    cause === undefined ? undefined : { cause },
  );
}

function isSafeTimestamp(value: unknown): boolean {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isSafePositive(value: unknown): boolean {
  return Number.isSafeInteger(value) && (value as number) >= 1;
}

function isSafeCount(value: unknown): boolean {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isCatalogCount(value: unknown): boolean {
  return isSafeCount(value)
    && (value as number) <= DATABASE_AUTOMATION_SOURCE_CATALOG_MAX_SOURCES;
}

function isCatalogOrdinal(value: unknown): boolean {
  return isSafePositive(value)
    && (value as number) <= DATABASE_AUTOMATION_SOURCE_CATALOG_MAX_SOURCES;
}

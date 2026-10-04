/**
 * automation-source-catalog-schema-sql.ts
 *
 * Owns the exact private SQLite schema for the system-plane automation source
 * catalog. Runtime integrity checks consume these statements; numbered
 * migrations duplicate them so released migration checksums remain immutable.
 */

import {
  DATABASE_AUTOMATION_SOURCE_CATALOG_MAX_SOURCES,
  DATABASE_AUTOMATION_SOURCE_CATALOG_SCHEMA_VERSION,
} from './automation-source-catalog-contract';

export const DATABASE_AUTOMATION_SOURCE_CATALOG_TABLE =
  '_zero_database_automation_sources_v1';
export const DATABASE_AUTOMATION_SOURCE_CATALOG_STATE_TABLE =
  '_zero_database_automation_source_catalog_state_v1';
export const DATABASE_AUTOMATION_SOURCE_CATALOG_LOGICAL_INDEX =
  '_zero_database_automation_sources_logical_v1';
export const DATABASE_AUTOMATION_SOURCE_CATALOG_SCAN_INDEX =
  '_zero_database_automation_sources_scan_v1';

export const DATABASE_AUTOMATION_SOURCE_CATALOG_INSERT_GUARD =
  '_zero_database_automation_sources_insert_guard_v1';
export const DATABASE_AUTOMATION_SOURCE_CATALOG_INSERT_STATE =
  '_zero_database_automation_sources_insert_state_v1';
export const DATABASE_AUTOMATION_SOURCE_CATALOG_UPDATE_GUARD =
  '_zero_database_automation_sources_update_guard_v1';
export const DATABASE_AUTOMATION_SOURCE_CATALOG_UPDATE_STATE =
  '_zero_database_automation_sources_update_state_v1';
export const DATABASE_AUTOMATION_SOURCE_CATALOG_DELETE_GUARD =
  '_zero_database_automation_sources_delete_guard_v1';
export const DATABASE_AUTOMATION_SOURCE_CATALOG_STATE_UPDATE_GUARD =
  '_zero_database_automation_source_state_update_guard_v1';
export const DATABASE_AUTOMATION_SOURCE_CATALOG_STATE_DELETE_GUARD =
  '_zero_database_automation_source_state_delete_guard_v1';

const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;

const SOURCE_COLUMNS_SQL = `(
  source_ref TEXT PRIMARY KEY CHECK (
    length(source_ref) = 64
    AND source_ref NOT GLOB '*[^a-f0-9]*'
  ),
  source_kind TEXT NOT NULL CHECK (
    source_kind IN ('application', 'tenant', 'named')
  ),
  logical_source_id TEXT NOT NULL CHECK (
    length(CAST(logical_source_id AS BLOB)) BETWEEN 1 AND 256
  ),
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('application', 'tenant')),
  scope_id TEXT NOT NULL CHECK (
    length(CAST(scope_id AS BLOB)) BETWEEN 1 AND 256
  ),
  tenant_id TEXT CHECK (
    tenant_id IS NULL
    OR length(CAST(tenant_id AS BLOB)) BETWEEN 1 AND 256
  ),
  lifecycle_status TEXT NOT NULL CHECK (
    lifecycle_status IN ('active', 'disabled')
  ),
  source_revision INTEGER NOT NULL CHECK (
    source_revision BETWEEN 1 AND ${MAX_SAFE_INTEGER}
  ),
  insertion_ordinal INTEGER NOT NULL UNIQUE CHECK (
    insertion_ordinal BETWEEN 1
      AND ${DATABASE_AUTOMATION_SOURCE_CATALOG_MAX_SOURCES}
  ),
  registered_at INTEGER NOT NULL CHECK (
    registered_at BETWEEN 0 AND ${MAX_SAFE_INTEGER}
  ),
  updated_at INTEGER NOT NULL CHECK (
    updated_at BETWEEN registered_at AND ${MAX_SAFE_INTEGER}
  ),
  schema_version INTEGER NOT NULL CHECK (
    schema_version = ${DATABASE_AUTOMATION_SOURCE_CATALOG_SCHEMA_VERSION}
  ),
  CHECK (
    (
      source_kind = 'application'
      AND logical_source_id = 'application'
      AND scope_kind = 'application'
      AND scope_id = 'application'
      AND tenant_id IS NULL
    )
    OR (
      source_kind = 'named'
      AND scope_kind = 'application'
      AND scope_id = 'application'
      AND tenant_id IS NULL
    )
    OR (
      source_kind = 'tenant'
      AND scope_kind = 'tenant'
      AND tenant_id IS NOT NULL
      AND scope_id = tenant_id
      AND logical_source_id = tenant_id
    )
  )
) STRICT, WITHOUT ROWID`;

const STATE_COLUMNS_SQL = `(
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  schema_version INTEGER NOT NULL CHECK (
    schema_version = ${DATABASE_AUTOMATION_SOURCE_CATALOG_SCHEMA_VERSION}
  ),
  total_sources INTEGER NOT NULL CHECK (
    total_sources BETWEEN 0
      AND ${DATABASE_AUTOMATION_SOURCE_CATALOG_MAX_SOURCES}
  ),
  last_ordinal INTEGER NOT NULL CHECK (
    last_ordinal BETWEEN 0
      AND ${DATABASE_AUTOMATION_SOURCE_CATALOG_MAX_SOURCES}
  ),
  catalog_revision INTEGER NOT NULL CHECK (
    catalog_revision BETWEEN 0 AND ${MAX_SAFE_INTEGER}
  ),
  CHECK (
    (total_sources = 0 AND last_ordinal = 0 AND catalog_revision = 0)
    OR (total_sources > 0 AND last_ordinal >= total_sources
      AND catalog_revision >= total_sources)
  )
) STRICT, WITHOUT ROWID`;

export const DATABASE_AUTOMATION_SOURCE_CATALOG_STORED_SQL =
  `CREATE TABLE ${DATABASE_AUTOMATION_SOURCE_CATALOG_TABLE} ${SOURCE_COLUMNS_SQL}`;
export const DATABASE_AUTOMATION_SOURCE_CATALOG_CREATE_SQL =
  `CREATE TABLE main.${DATABASE_AUTOMATION_SOURCE_CATALOG_TABLE} ${SOURCE_COLUMNS_SQL}`;
export const DATABASE_AUTOMATION_SOURCE_CATALOG_STATE_STORED_SQL =
  `CREATE TABLE ${DATABASE_AUTOMATION_SOURCE_CATALOG_STATE_TABLE} ${STATE_COLUMNS_SQL}`;
export const DATABASE_AUTOMATION_SOURCE_CATALOG_STATE_CREATE_SQL =
  `CREATE TABLE main.${DATABASE_AUTOMATION_SOURCE_CATALOG_STATE_TABLE} ${STATE_COLUMNS_SQL}`;

export const DATABASE_AUTOMATION_SOURCE_CATALOG_LOGICAL_INDEX_SQL =
  `CREATE UNIQUE INDEX ${DATABASE_AUTOMATION_SOURCE_CATALOG_LOGICAL_INDEX} `
  + `ON ${DATABASE_AUTOMATION_SOURCE_CATALOG_TABLE} `
  + `(source_kind, logical_source_id)`;
export const DATABASE_AUTOMATION_SOURCE_CATALOG_LOGICAL_INDEX_CREATE_SQL =
  `CREATE UNIQUE INDEX main.${DATABASE_AUTOMATION_SOURCE_CATALOG_LOGICAL_INDEX} `
  + `ON ${DATABASE_AUTOMATION_SOURCE_CATALOG_TABLE} `
  + `(source_kind, logical_source_id)`;
export const DATABASE_AUTOMATION_SOURCE_CATALOG_SCAN_INDEX_SQL =
  `CREATE INDEX ${DATABASE_AUTOMATION_SOURCE_CATALOG_SCAN_INDEX} `
  + `ON ${DATABASE_AUTOMATION_SOURCE_CATALOG_TABLE} `
  + `(lifecycle_status, insertion_ordinal, source_ref)`;
export const DATABASE_AUTOMATION_SOURCE_CATALOG_SCAN_INDEX_CREATE_SQL =
  `CREATE INDEX main.${DATABASE_AUTOMATION_SOURCE_CATALOG_SCAN_INDEX} `
  + `ON ${DATABASE_AUTOMATION_SOURCE_CATALOG_TABLE} `
  + `(lifecycle_status, insertion_ordinal, source_ref)`;

export const DATABASE_AUTOMATION_SOURCE_CATALOG_INSERT_GUARD_SQL =
  `CREATE TRIGGER ${DATABASE_AUTOMATION_SOURCE_CATALOG_INSERT_GUARD}
BEFORE INSERT ON ${DATABASE_AUTOMATION_SOURCE_CATALOG_TABLE}
WHEN (SELECT count(*) FROM ${DATABASE_AUTOMATION_SOURCE_CATALOG_STATE_TABLE}
      WHERE singleton = 1) != 1
  OR (SELECT total_sources FROM ${DATABASE_AUTOMATION_SOURCE_CATALOG_STATE_TABLE}
      WHERE singleton = 1) >= ${DATABASE_AUTOMATION_SOURCE_CATALOG_MAX_SOURCES}
  OR NEW.insertion_ordinal != (
    SELECT last_ordinal + 1
    FROM ${DATABASE_AUTOMATION_SOURCE_CATALOG_STATE_TABLE}
    WHERE singleton = 1
  )
  OR NEW.source_revision != 1
  OR NEW.registered_at != NEW.updated_at
BEGIN
  SELECT RAISE(ABORT, 'zero automation source catalog admission rejected');
END`;

export const DATABASE_AUTOMATION_SOURCE_CATALOG_INSERT_STATE_SQL =
  `CREATE TRIGGER ${DATABASE_AUTOMATION_SOURCE_CATALOG_INSERT_STATE}
AFTER INSERT ON ${DATABASE_AUTOMATION_SOURCE_CATALOG_TABLE}
BEGIN
  UPDATE ${DATABASE_AUTOMATION_SOURCE_CATALOG_STATE_TABLE}
  SET
    total_sources = total_sources + 1,
    last_ordinal = NEW.insertion_ordinal,
    catalog_revision = catalog_revision + 1
  WHERE singleton = 1;
  SELECT CASE WHEN changes() != 1
    THEN RAISE(ABORT, 'zero automation source catalog state unavailable') END;
END`;

export const DATABASE_AUTOMATION_SOURCE_CATALOG_UPDATE_GUARD_SQL =
  `CREATE TRIGGER ${DATABASE_AUTOMATION_SOURCE_CATALOG_UPDATE_GUARD}
BEFORE UPDATE ON ${DATABASE_AUTOMATION_SOURCE_CATALOG_TABLE}
WHEN NOT (
  NEW.source_ref IS OLD.source_ref
  AND NEW.source_kind IS OLD.source_kind
  AND NEW.logical_source_id IS OLD.logical_source_id
  AND NEW.scope_kind IS OLD.scope_kind
  AND NEW.scope_id IS OLD.scope_id
  AND NEW.tenant_id IS OLD.tenant_id
  AND NEW.lifecycle_status != OLD.lifecycle_status
  AND NEW.source_revision = OLD.source_revision + 1
  AND NEW.insertion_ordinal IS OLD.insertion_ordinal
  AND NEW.registered_at IS OLD.registered_at
  AND NEW.updated_at >= OLD.updated_at
  AND NEW.schema_version IS OLD.schema_version
)
BEGIN
  SELECT RAISE(ABORT, 'zero automation source identity is immutable');
END`;

export const DATABASE_AUTOMATION_SOURCE_CATALOG_UPDATE_STATE_SQL =
  `CREATE TRIGGER ${DATABASE_AUTOMATION_SOURCE_CATALOG_UPDATE_STATE}
AFTER UPDATE ON ${DATABASE_AUTOMATION_SOURCE_CATALOG_TABLE}
BEGIN
  UPDATE ${DATABASE_AUTOMATION_SOURCE_CATALOG_STATE_TABLE}
  SET catalog_revision = catalog_revision + 1
  WHERE singleton = 1;
  SELECT CASE WHEN changes() != 1
    THEN RAISE(ABORT, 'zero automation source catalog state unavailable') END;
END`;

export const DATABASE_AUTOMATION_SOURCE_CATALOG_DELETE_GUARD_SQL =
  `CREATE TRIGGER ${DATABASE_AUTOMATION_SOURCE_CATALOG_DELETE_GUARD}
BEFORE DELETE ON ${DATABASE_AUTOMATION_SOURCE_CATALOG_TABLE}
BEGIN
  SELECT RAISE(ABORT, 'zero automation source identities are permanent');
END`;

export const DATABASE_AUTOMATION_SOURCE_CATALOG_STATE_UPDATE_GUARD_SQL =
  `CREATE TRIGGER ${DATABASE_AUTOMATION_SOURCE_CATALOG_STATE_UPDATE_GUARD}
BEFORE UPDATE ON ${DATABASE_AUTOMATION_SOURCE_CATALOG_STATE_TABLE}
WHEN NOT (
  NEW.singleton IS OLD.singleton
  AND NEW.schema_version IS OLD.schema_version
  AND NEW.total_sources = (
    SELECT count(*) FROM ${DATABASE_AUTOMATION_SOURCE_CATALOG_TABLE}
  )
  AND NEW.last_ordinal = coalesce((
    SELECT max(insertion_ordinal)
    FROM ${DATABASE_AUTOMATION_SOURCE_CATALOG_TABLE}
  ), 0)
  AND NEW.catalog_revision = coalesce((
    SELECT sum(source_revision)
    FROM ${DATABASE_AUTOMATION_SOURCE_CATALOG_TABLE}
  ), 0)
  AND NEW.catalog_revision = OLD.catalog_revision + 1
)
BEGIN
  SELECT RAISE(ABORT, 'zero automation source catalog state is invalid');
END`;

export const DATABASE_AUTOMATION_SOURCE_CATALOG_STATE_DELETE_GUARD_SQL =
  `CREATE TRIGGER ${DATABASE_AUTOMATION_SOURCE_CATALOG_STATE_DELETE_GUARD}
BEFORE DELETE ON ${DATABASE_AUTOMATION_SOURCE_CATALOG_STATE_TABLE}
BEGIN
  SELECT RAISE(ABORT, 'zero automation source catalog state is permanent');
END`;

export const DATABASE_AUTOMATION_SOURCE_CATALOG_TRIGGER_SQL = Object.freeze({
  [DATABASE_AUTOMATION_SOURCE_CATALOG_INSERT_GUARD]:
    DATABASE_AUTOMATION_SOURCE_CATALOG_INSERT_GUARD_SQL,
  [DATABASE_AUTOMATION_SOURCE_CATALOG_INSERT_STATE]:
    DATABASE_AUTOMATION_SOURCE_CATALOG_INSERT_STATE_SQL,
  [DATABASE_AUTOMATION_SOURCE_CATALOG_UPDATE_GUARD]:
    DATABASE_AUTOMATION_SOURCE_CATALOG_UPDATE_GUARD_SQL,
  [DATABASE_AUTOMATION_SOURCE_CATALOG_UPDATE_STATE]:
    DATABASE_AUTOMATION_SOURCE_CATALOG_UPDATE_STATE_SQL,
  [DATABASE_AUTOMATION_SOURCE_CATALOG_DELETE_GUARD]:
    DATABASE_AUTOMATION_SOURCE_CATALOG_DELETE_GUARD_SQL,
  [DATABASE_AUTOMATION_SOURCE_CATALOG_STATE_UPDATE_GUARD]:
    DATABASE_AUTOMATION_SOURCE_CATALOG_STATE_UPDATE_GUARD_SQL,
  [DATABASE_AUTOMATION_SOURCE_CATALOG_STATE_DELETE_GUARD]:
    DATABASE_AUTOMATION_SOURCE_CATALOG_STATE_DELETE_GUARD_SQL,
});

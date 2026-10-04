/**
 * automation-outbox-schema-sql.ts
 *
 * Owns the exact private SQLite definitions for durable automation delivery.
 * It exports inert SQL only and performs no database operations.
 */

import {
  DATABASE_AUTOMATION_OUTBOX_MAX_ACTIVE_BYTES,
  DATABASE_AUTOMATION_OUTBOX_MAX_ACTIVE_RECORDS,
  DATABASE_AUTOMATION_OUTBOX_MAX_ATTEMPTS,
  DATABASE_AUTOMATION_OUTBOX_MAX_PAYLOAD_BYTES,
  DATABASE_AUTOMATION_OUTBOX_MAX_STORED_RECORDS,
  DATABASE_AUTOMATION_OUTBOX_SCHEMA_VERSION,
} from './automation-outbox-contracts';

export const DATABASE_AUTOMATION_OUTBOX_TABLE =
  '_zero_database_automation_outbox';
export const DATABASE_AUTOMATION_OUTBOX_STATE_TABLE =
  '_zero_database_automation_outbox_state';
export const DATABASE_AUTOMATION_OUTBOX_DUE_INDEX =
  '_zero_database_automation_outbox_due_v1';
export const DATABASE_AUTOMATION_OUTBOX_INSERT_GUARD =
  '_zero_database_automation_outbox_insert_guard_v1';
export const DATABASE_AUTOMATION_OUTBOX_INSERT_STATE =
  '_zero_database_automation_outbox_insert_state_v1';
export const DATABASE_AUTOMATION_OUTBOX_UPDATE_GUARD =
  '_zero_database_automation_outbox_update_guard_v1';
export const DATABASE_AUTOMATION_OUTBOX_UPDATE_STATE =
  '_zero_database_automation_outbox_update_state_v1';
export const DATABASE_AUTOMATION_OUTBOX_DELETE_GUARD =
  '_zero_database_automation_outbox_delete_guard_v1';
export const DATABASE_AUTOMATION_OUTBOX_DELETE_STATE =
  '_zero_database_automation_outbox_delete_state_v1';

const OUTBOX_COLUMNS_SQL = `(
  delivery_id TEXT PRIMARY KEY,
  command_fingerprint TEXT NOT NULL,
  invocation_id TEXT NOT NULL,
  trigger_identity TEXT NOT NULL,
  function_identity TEXT NOT NULL,
  manifest_fingerprint TEXT NOT NULL,
  realm_name TEXT NOT NULL,
  realm_fingerprint TEXT NOT NULL,
  source_sequence INTEGER NOT NULL CHECK (source_sequence >= 1),
  source_table TEXT NOT NULL,
  source_operation TEXT NOT NULL CHECK (
    source_operation IN ('insert', 'update', 'delete')
  ),
  source_row_id TEXT NOT NULL,
  payload_json TEXT,
  payload_bytes INTEGER NOT NULL CHECK (
    payload_bytes >= 0
    AND payload_bytes <= ${DATABASE_AUTOMATION_OUTBOX_MAX_PAYLOAD_BYTES}
    AND (
      (payload_json IS NULL AND payload_bytes = 0)
      OR length(CAST(payload_json AS BLOB)) = payload_bytes
    )
  ),
  status TEXT NOT NULL CHECK (
    status IN ('pending', 'processing', 'completed', 'dead')
  ),
  attempt_count INTEGER NOT NULL CHECK (
    attempt_count >= 0 AND attempt_count <= max_attempts
  ),
  max_attempts INTEGER NOT NULL CHECK (
    max_attempts >= 1
    AND max_attempts <= ${DATABASE_AUTOMATION_OUTBOX_MAX_ATTEMPTS}
  ),
  available_at INTEGER NOT NULL CHECK (available_at >= 0),
  lease_owner TEXT,
  lease_token TEXT,
  lease_expires_at INTEGER,
  last_error_code TEXT,
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  completed_at INTEGER CHECK (completed_at IS NULL OR completed_at >= created_at),
  insertion_ordinal INTEGER NOT NULL UNIQUE CHECK (insertion_ordinal >= 1),
  schema_version INTEGER NOT NULL CHECK (
    schema_version = ${DATABASE_AUTOMATION_OUTBOX_SCHEMA_VERSION}
  ),
  CHECK (
    (status = 'pending'
      AND payload_json IS NOT NULL
      AND payload_bytes > 0
      AND lease_owner IS NULL
      AND lease_token IS NULL
      AND lease_expires_at IS NULL
      AND completed_at IS NULL)
    OR
    (status = 'processing'
      AND payload_json IS NOT NULL
      AND payload_bytes > 0
      AND lease_owner IS NOT NULL
      AND lease_token IS NOT NULL
      AND lease_expires_at IS NOT NULL
      AND completed_at IS NULL)
    OR
    (status IN ('completed', 'dead')
      AND payload_json IS NULL
      AND payload_bytes = 0
      AND lease_owner IS NULL
      AND lease_token IS NULL
      AND lease_expires_at IS NULL
      AND completed_at IS NOT NULL)
  ),
  CHECK (status != 'completed' OR last_error_code IS NULL),
  CHECK (status != 'dead' OR last_error_code IS NOT NULL)
) STRICT, WITHOUT ROWID`;

const STATE_COLUMNS_SQL = `(
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  schema_version INTEGER NOT NULL CHECK (
    schema_version = ${DATABASE_AUTOMATION_OUTBOX_SCHEMA_VERSION}
  ),
  total_records INTEGER NOT NULL CHECK (
    total_records >= 0
    AND total_records <= ${DATABASE_AUTOMATION_OUTBOX_MAX_STORED_RECORDS}
  ),
  active_records INTEGER NOT NULL CHECK (
    active_records >= 0
    AND active_records <= total_records
    AND active_records <= ${DATABASE_AUTOMATION_OUTBOX_MAX_ACTIVE_RECORDS}
  ),
  active_bytes INTEGER NOT NULL CHECK (
    active_bytes >= 0
    AND active_bytes <= ${DATABASE_AUTOMATION_OUTBOX_MAX_ACTIVE_BYTES}
  ),
  last_ordinal INTEGER NOT NULL CHECK (
    last_ordinal >= 0
    AND last_ordinal <= ${Number.MAX_SAFE_INTEGER}
  )
) STRICT, WITHOUT ROWID`;

export const DATABASE_AUTOMATION_OUTBOX_STORED_SQL =
  `CREATE TABLE ${DATABASE_AUTOMATION_OUTBOX_TABLE} ${OUTBOX_COLUMNS_SQL}`;
export const DATABASE_AUTOMATION_OUTBOX_CREATE_SQL =
  `CREATE TABLE main.${DATABASE_AUTOMATION_OUTBOX_TABLE} ${OUTBOX_COLUMNS_SQL}`;
export const DATABASE_AUTOMATION_OUTBOX_STATE_STORED_SQL =
  `CREATE TABLE ${DATABASE_AUTOMATION_OUTBOX_STATE_TABLE} ${STATE_COLUMNS_SQL}`;
export const DATABASE_AUTOMATION_OUTBOX_STATE_CREATE_SQL =
  `CREATE TABLE main.${DATABASE_AUTOMATION_OUTBOX_STATE_TABLE} ${STATE_COLUMNS_SQL}`;

export const DATABASE_AUTOMATION_OUTBOX_DUE_INDEX_SQL =
  `CREATE INDEX ${DATABASE_AUTOMATION_OUTBOX_DUE_INDEX} `
  + `ON ${DATABASE_AUTOMATION_OUTBOX_TABLE} `
  + `(status, available_at, insertion_ordinal)`;
export const DATABASE_AUTOMATION_OUTBOX_DUE_INDEX_CREATE_SQL =
  `CREATE INDEX main.${DATABASE_AUTOMATION_OUTBOX_DUE_INDEX} `
  + `ON ${DATABASE_AUTOMATION_OUTBOX_TABLE} `
  + `(status, available_at, insertion_ordinal)`;

const IMMUTABLE_UPDATE_COLUMNS = `
  NEW.delivery_id IS OLD.delivery_id
  AND NEW.command_fingerprint IS OLD.command_fingerprint
  AND NEW.invocation_id IS OLD.invocation_id
  AND NEW.trigger_identity IS OLD.trigger_identity
  AND NEW.function_identity IS OLD.function_identity
  AND NEW.manifest_fingerprint IS OLD.manifest_fingerprint
  AND NEW.realm_name IS OLD.realm_name
  AND NEW.realm_fingerprint IS OLD.realm_fingerprint
  AND NEW.source_sequence IS OLD.source_sequence
  AND NEW.source_table IS OLD.source_table
  AND NEW.source_operation IS OLD.source_operation
  AND NEW.source_row_id IS OLD.source_row_id
  AND NEW.max_attempts IS OLD.max_attempts
  AND NEW.created_at IS OLD.created_at
  AND NEW.insertion_ordinal IS OLD.insertion_ordinal
  AND NEW.schema_version IS OLD.schema_version`;

const PENDING_TO_PROCESSING = `(
  OLD.status = 'pending'
  AND NEW.status = 'processing'
  AND NEW.payload_json IS OLD.payload_json
  AND NEW.payload_bytes IS OLD.payload_bytes
  AND NEW.attempt_count = OLD.attempt_count + 1
  AND NEW.available_at IS OLD.available_at
  AND NEW.lease_owner IS NOT NULL
  AND NEW.lease_token IS NOT NULL
  AND NEW.lease_expires_at > NEW.updated_at
  AND NEW.last_error_code IS OLD.last_error_code
  AND NEW.completed_at IS NULL
  AND NEW.updated_at >= OLD.updated_at
)`;

const PROCESSING_TO_PENDING = `(
  OLD.status = 'processing'
  AND NEW.status = 'pending'
  AND NEW.payload_json IS OLD.payload_json
  AND NEW.payload_bytes IS OLD.payload_bytes
  AND NEW.attempt_count IS OLD.attempt_count
  AND NEW.lease_owner IS NULL
  AND NEW.lease_token IS NULL
  AND NEW.lease_expires_at IS NULL
  AND NEW.last_error_code IS NOT NULL
  AND NEW.completed_at IS NULL
  AND NEW.updated_at >= OLD.updated_at
)`;

const PROCESSING_LEASE_EXTENSION = `(
  OLD.status = 'processing'
  AND NEW.status = 'processing'
  AND NEW.payload_json IS OLD.payload_json
  AND NEW.payload_bytes IS OLD.payload_bytes
  AND NEW.attempt_count IS OLD.attempt_count
  AND NEW.available_at IS OLD.available_at
  AND NEW.lease_owner IS OLD.lease_owner
  AND NEW.lease_token IS OLD.lease_token
  AND NEW.lease_expires_at > OLD.lease_expires_at
  AND NEW.last_error_code IS OLD.last_error_code
  AND NEW.completed_at IS NULL
  AND NEW.updated_at >= OLD.updated_at
)`;

const PROCESSING_TO_TERMINAL = `(
  OLD.status = 'processing'
  AND NEW.status IN ('completed', 'dead')
  AND NEW.payload_json IS NULL
  AND NEW.payload_bytes = 0
  AND NEW.attempt_count IS OLD.attempt_count
  AND NEW.available_at IS OLD.available_at
  AND NEW.lease_owner IS NULL
  AND NEW.lease_token IS NULL
  AND NEW.lease_expires_at IS NULL
  AND NEW.completed_at IS NOT NULL
  AND NEW.updated_at >= OLD.updated_at
  AND (
    (NEW.status = 'completed' AND NEW.last_error_code IS NULL)
    OR (NEW.status = 'dead' AND NEW.last_error_code IS NOT NULL)
  )
)`;

export const DATABASE_AUTOMATION_OUTBOX_INSERT_GUARD_SQL =
  `CREATE TRIGGER ${DATABASE_AUTOMATION_OUTBOX_INSERT_GUARD}
BEFORE INSERT ON ${DATABASE_AUTOMATION_OUTBOX_TABLE}
WHEN (SELECT total_records FROM ${DATABASE_AUTOMATION_OUTBOX_STATE_TABLE}
      WHERE singleton = 1) >= ${DATABASE_AUTOMATION_OUTBOX_MAX_STORED_RECORDS}
  OR (SELECT active_records FROM ${DATABASE_AUTOMATION_OUTBOX_STATE_TABLE}
      WHERE singleton = 1) >= ${DATABASE_AUTOMATION_OUTBOX_MAX_ACTIVE_RECORDS}
  OR (SELECT active_bytes FROM ${DATABASE_AUTOMATION_OUTBOX_STATE_TABLE}
      WHERE singleton = 1) + NEW.payload_bytes
      > ${DATABASE_AUTOMATION_OUTBOX_MAX_ACTIVE_BYTES}
  OR NEW.insertion_ordinal != (
      SELECT last_ordinal + 1
      FROM ${DATABASE_AUTOMATION_OUTBOX_STATE_TABLE}
      WHERE singleton = 1
    )
BEGIN
  SELECT RAISE(ABORT, 'zero automation outbox admission limit reached');
END`;

export const DATABASE_AUTOMATION_OUTBOX_INSERT_STATE_SQL =
  `CREATE TRIGGER ${DATABASE_AUTOMATION_OUTBOX_INSERT_STATE}
AFTER INSERT ON ${DATABASE_AUTOMATION_OUTBOX_TABLE}
BEGIN
  UPDATE ${DATABASE_AUTOMATION_OUTBOX_STATE_TABLE}
  SET total_records = total_records + 1,
      active_records = active_records + 1,
      active_bytes = active_bytes + NEW.payload_bytes,
      last_ordinal = NEW.insertion_ordinal
  WHERE singleton = 1;
  SELECT CASE WHEN changes() != 1
    THEN RAISE(ABORT, 'zero automation outbox state unavailable') END;
END`;

export const DATABASE_AUTOMATION_OUTBOX_UPDATE_GUARD_SQL =
  `CREATE TRIGGER ${DATABASE_AUTOMATION_OUTBOX_UPDATE_GUARD}
BEFORE UPDATE ON ${DATABASE_AUTOMATION_OUTBOX_TABLE}
WHEN NOT (
  ${IMMUTABLE_UPDATE_COLUMNS}
  AND (
    ${PENDING_TO_PROCESSING}
    OR ${PROCESSING_TO_PENDING}
    OR ${PROCESSING_LEASE_EXTENSION}
    OR ${PROCESSING_TO_TERMINAL}
  )
)
BEGIN
  SELECT RAISE(ABORT, 'zero automation outbox transition rejected');
END`;

export const DATABASE_AUTOMATION_OUTBOX_UPDATE_STATE_SQL =
  `CREATE TRIGGER ${DATABASE_AUTOMATION_OUTBOX_UPDATE_STATE}
AFTER UPDATE ON ${DATABASE_AUTOMATION_OUTBOX_TABLE}
WHEN OLD.status = 'processing' AND NEW.status IN ('completed', 'dead')
BEGIN
  UPDATE ${DATABASE_AUTOMATION_OUTBOX_STATE_TABLE}
  SET active_records = active_records - 1,
      active_bytes = active_bytes - OLD.payload_bytes
  WHERE singleton = 1;
  SELECT CASE WHEN changes() != 1
    THEN RAISE(ABORT, 'zero automation outbox state unavailable') END;
END`;

export const DATABASE_AUTOMATION_OUTBOX_DELETE_GUARD_SQL =
  `CREATE TRIGGER ${DATABASE_AUTOMATION_OUTBOX_DELETE_GUARD}
BEFORE DELETE ON ${DATABASE_AUTOMATION_OUTBOX_TABLE}
WHEN OLD.status NOT IN ('completed', 'dead')
BEGIN
  SELECT RAISE(ABORT, 'zero active automation delivery cannot be deleted');
END`;

export const DATABASE_AUTOMATION_OUTBOX_DELETE_STATE_SQL =
  `CREATE TRIGGER ${DATABASE_AUTOMATION_OUTBOX_DELETE_STATE}
AFTER DELETE ON ${DATABASE_AUTOMATION_OUTBOX_TABLE}
BEGIN
  UPDATE ${DATABASE_AUTOMATION_OUTBOX_STATE_TABLE}
  SET total_records = total_records - 1
  WHERE singleton = 1 AND total_records >= 1;
  SELECT CASE WHEN changes() != 1
    THEN RAISE(ABORT, 'zero automation outbox state unavailable') END;
END`;

export const DATABASE_AUTOMATION_OUTBOX_TRIGGER_SQL = Object.freeze({
  [DATABASE_AUTOMATION_OUTBOX_INSERT_GUARD]:
    DATABASE_AUTOMATION_OUTBOX_INSERT_GUARD_SQL,
  [DATABASE_AUTOMATION_OUTBOX_INSERT_STATE]:
    DATABASE_AUTOMATION_OUTBOX_INSERT_STATE_SQL,
  [DATABASE_AUTOMATION_OUTBOX_UPDATE_GUARD]:
    DATABASE_AUTOMATION_OUTBOX_UPDATE_GUARD_SQL,
  [DATABASE_AUTOMATION_OUTBOX_UPDATE_STATE]:
    DATABASE_AUTOMATION_OUTBOX_UPDATE_STATE_SQL,
  [DATABASE_AUTOMATION_OUTBOX_DELETE_GUARD]:
    DATABASE_AUTOMATION_OUTBOX_DELETE_GUARD_SQL,
  [DATABASE_AUTOMATION_OUTBOX_DELETE_STATE]:
    DATABASE_AUTOMATION_OUTBOX_DELETE_STATE_SQL,
});

/** Private SQLite schema, migration, and integrity checks for actor receipts. */

import { DatabaseError } from './database-error';
import { isDatabaseIdempotencyKey } from './database-operations';
import {
  DATABASE_WRITER_MAX_RECEIPT_KEYS,
  DATABASE_WRITER_MAX_RECEIPT_RESULT_BYTES,
  DATABASE_WRITER_MAX_RECEIPTS,
  DATABASE_WRITER_MAX_RETAINED_RECEIPT_BYTES,
  DATABASE_WRITER_RECEIPT_SCHEMA_VERSION,
} from './database-receipt-contract';
import type { DatabaseRuntime } from './database-runtime';

export const DATABASE_RECEIPT_TABLE = '_zero_database_operation_receipts';
export const DATABASE_RECEIPT_STATS_TABLE = '_zero_database_receipt_stats_v1';
export const DATABASE_RECEIPT_STATE_RETAINED = 'retained';
export const DATABASE_RECEIPT_STATE_EXPIRED = 'expired';
export const DATABASE_RECEIPT_RESULT_VERSION_LEGACY = 1;
export const DATABASE_RECEIPT_RESULT_VERSION_CURRENT = 2;

const LEGACY_RECEIPT_TABLE = '_zero_database_operation_receipts_v1_migration';
const RECEIPT_RETENTION_INDEX = '_zero_database_receipt_retention_v2';
const RECEIPT_INSERT_GUARD_TRIGGER = '_zero_database_receipt_insert_guard_v1';
const RECEIPT_INSERT_STATS_TRIGGER = '_zero_database_receipt_insert_stats_v1';
const RECEIPT_UPDATE_GUARD_TRIGGER = '_zero_database_receipt_update_guard_v1';
const RECEIPT_UPDATE_STATS_TRIGGER = '_zero_database_receipt_update_stats_v1';
const RECEIPT_DELETE_GUARD_TRIGGER = '_zero_database_receipt_delete_guard_v1';
const RECEIPT_STATS_SCHEMA_VERSION = 1;
const textEncoder = new TextEncoder();

const RECEIPT_V1_COLUMNS_SQL = `(
  receipt_key TEXT PRIMARY KEY,
  realm_fingerprint TEXT NOT NULL,
  operation_fingerprint TEXT NOT NULL,
  result_json TEXT NOT NULL,
  final_seq INTEGER NOT NULL CHECK (final_seq >= 0),
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  created_at INTEGER NOT NULL CHECK (created_at >= 0)
) STRICT, WITHOUT ROWID`;
const RECEIPT_V1_STORED_SQL =
  `CREATE TABLE ${DATABASE_RECEIPT_TABLE} ${RECEIPT_V1_COLUMNS_SQL}`;
const RECEIPT_COLUMNS_SQL = `(
  receipt_key TEXT PRIMARY KEY,
  realm_fingerprint TEXT NOT NULL,
  operation_fingerprint TEXT NOT NULL,
  receipt_state TEXT NOT NULL CHECK (receipt_state IN ('retained', 'expired')),
  result_json TEXT,
  final_seq INTEGER CHECK (final_seq IS NULL OR final_seq >= 0),
  result_version INTEGER NOT NULL CHECK (result_version IN (1, 2)),
  schema_version INTEGER NOT NULL CHECK (schema_version = 2),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  insertion_ordinal INTEGER NOT NULL UNIQUE CHECK (insertion_ordinal > 0),
  CHECK (
    (receipt_state = 'retained' AND result_json IS NOT NULL AND final_seq IS NOT NULL)
    OR (receipt_state = 'expired' AND result_json IS NULL AND final_seq IS NULL)
  )
) STRICT, WITHOUT ROWID`;
const RECEIPT_STORED_SQL =
  `CREATE TABLE ${DATABASE_RECEIPT_TABLE} ${RECEIPT_COLUMNS_SQL}`;
const RECEIPT_CREATE_SQL =
  `CREATE TABLE main.${DATABASE_RECEIPT_TABLE} ${RECEIPT_COLUMNS_SQL}`;
const RECEIPT_RETENTION_INDEX_SQL = `CREATE INDEX ${RECEIPT_RETENTION_INDEX} `
  + `ON ${DATABASE_RECEIPT_TABLE} (receipt_state, insertion_ordinal)`;
const RECEIPT_RETENTION_INDEX_CREATE_SQL = `CREATE INDEX main.${RECEIPT_RETENTION_INDEX} `
  + `ON ${DATABASE_RECEIPT_TABLE} (receipt_state, insertion_ordinal)`;
const RECEIPT_STATS_COLUMNS_SQL = `(
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  total_keys INTEGER NOT NULL CHECK (
    total_keys >= 0
    AND total_keys <= ${DATABASE_WRITER_MAX_RECEIPT_KEYS}
  ),
  retained_results INTEGER NOT NULL CHECK (
    retained_results >= 0
    AND retained_results <= total_keys
    AND retained_results <= ${DATABASE_WRITER_MAX_RECEIPTS}
  ),
  retained_result_bytes INTEGER NOT NULL CHECK (
    retained_result_bytes >= 0
    AND retained_result_bytes <= ${DATABASE_WRITER_MAX_RETAINED_RECEIPT_BYTES}
  )
) STRICT, WITHOUT ROWID`;
const RECEIPT_STATS_STORED_SQL =
  `CREATE TABLE ${DATABASE_RECEIPT_STATS_TABLE} ${RECEIPT_STATS_COLUMNS_SQL}`;
const RECEIPT_STATS_CREATE_SQL =
  `CREATE TABLE main.${DATABASE_RECEIPT_STATS_TABLE} ${RECEIPT_STATS_COLUMNS_SQL}`;

const RECEIPT_INSERT_GUARD_SQL = `CREATE TRIGGER ${RECEIPT_INSERT_GUARD_TRIGGER}
BEFORE INSERT ON ${DATABASE_RECEIPT_TABLE}
WHEN (SELECT total_keys FROM ${DATABASE_RECEIPT_STATS_TABLE} WHERE singleton = 1)
    >= ${DATABASE_WRITER_MAX_RECEIPT_KEYS}
  OR (
    NEW.receipt_state = '${DATABASE_RECEIPT_STATE_RETAINED}'
    AND length(CAST(NEW.result_json AS BLOB))
      > ${DATABASE_WRITER_MAX_RECEIPT_RESULT_BYTES}
  )
BEGIN
  SELECT RAISE(ABORT, 'zero receipt admission limit reached');
END`;
const RECEIPT_INSERT_STATS_SQL = `CREATE TRIGGER ${RECEIPT_INSERT_STATS_TRIGGER}
AFTER INSERT ON ${DATABASE_RECEIPT_TABLE}
BEGIN
  UPDATE ${DATABASE_RECEIPT_STATS_TABLE}
  SET
    total_keys = total_keys + 1,
    retained_results = retained_results
      + CASE WHEN NEW.receipt_state = '${DATABASE_RECEIPT_STATE_RETAINED}'
        THEN 1 ELSE 0 END,
    retained_result_bytes = retained_result_bytes
      + CASE WHEN NEW.receipt_state = '${DATABASE_RECEIPT_STATE_RETAINED}'
        THEN length(CAST(NEW.result_json AS BLOB)) ELSE 0 END
  WHERE singleton = 1;
  SELECT CASE WHEN changes() != 1
    THEN RAISE(ABORT, 'zero receipt statistics are unavailable') END;
END`;
const RECEIPT_UPDATE_GUARD_SQL = `CREATE TRIGGER ${RECEIPT_UPDATE_GUARD_TRIGGER}
BEFORE UPDATE ON ${DATABASE_RECEIPT_TABLE}
WHEN NOT (
  OLD.receipt_state = '${DATABASE_RECEIPT_STATE_RETAINED}'
  AND NEW.receipt_state = '${DATABASE_RECEIPT_STATE_EXPIRED}'
  AND NEW.receipt_key IS OLD.receipt_key
  AND NEW.realm_fingerprint IS OLD.realm_fingerprint
  AND NEW.operation_fingerprint IS OLD.operation_fingerprint
  AND NEW.result_json IS NULL
  AND NEW.final_seq IS NULL
  AND NEW.result_version IS OLD.result_version
  AND NEW.schema_version IS OLD.schema_version
  AND NEW.created_at IS OLD.created_at
  AND NEW.insertion_ordinal IS OLD.insertion_ordinal
)
BEGIN
  SELECT RAISE(ABORT, 'zero receipt rows are immutable');
END`;
const RECEIPT_UPDATE_STATS_SQL = `CREATE TRIGGER ${RECEIPT_UPDATE_STATS_TRIGGER}
AFTER UPDATE ON ${DATABASE_RECEIPT_TABLE}
BEGIN
  UPDATE ${DATABASE_RECEIPT_STATS_TABLE}
  SET
    retained_results = retained_results - 1,
    retained_result_bytes = retained_result_bytes
      - length(CAST(OLD.result_json AS BLOB))
  WHERE singleton = 1;
  SELECT CASE WHEN changes() != 1
    THEN RAISE(ABORT, 'zero receipt statistics are unavailable') END;
END`;
const RECEIPT_DELETE_GUARD_SQL = `CREATE TRIGGER ${RECEIPT_DELETE_GUARD_TRIGGER}
BEFORE DELETE ON ${DATABASE_RECEIPT_TABLE}
BEGIN
  SELECT RAISE(ABORT, 'zero receipt identities are permanent');
END`;

const RECEIPT_TRIGGER_SQL = Object.freeze({
  [RECEIPT_INSERT_GUARD_TRIGGER]: RECEIPT_INSERT_GUARD_SQL,
  [RECEIPT_INSERT_STATS_TRIGGER]: RECEIPT_INSERT_STATS_SQL,
  [RECEIPT_UPDATE_GUARD_TRIGGER]: RECEIPT_UPDATE_GUARD_SQL,
  [RECEIPT_UPDATE_STATS_TRIGGER]: RECEIPT_UPDATE_STATS_SQL,
  [RECEIPT_DELETE_GUARD_TRIGGER]: RECEIPT_DELETE_GUARD_SQL,
});

export interface DatabaseReceiptRow {
  receipt_key: string;
  realm_fingerprint: string;
  operation_fingerprint: string;
  receipt_state: string;
  result_json: string | null;
  final_seq: number | null;
  result_version: number;
  schema_version: number;
  created_at: number;
  insertion_ordinal: number;
  receipt_key_type: string;
  realm_fingerprint_type: string;
  operation_fingerprint_type: string;
  receipt_state_type: string;
  result_json_type: string;
  final_seq_type: string;
  result_version_type: string;
  schema_version_type: string;
  created_at_type: string;
  insertion_ordinal_type: string;
}

interface LegacyReceiptRow extends Omit<
  DatabaseReceiptRow,
  | 'receipt_state'
  | 'insertion_ordinal'
  | 'result_version'
  | 'receipt_state_type'
  | 'insertion_ordinal_type'
  | 'result_version_type'
> {
  result_json: string;
  final_seq: number;
}

interface ReceiptStatsRow {
  singleton?: unknown;
  schema_version?: unknown;
  total_keys?: unknown;
  retained_results?: unknown;
  retained_result_bytes?: unknown;
  singleton_type?: unknown;
  schema_version_type?: unknown;
  total_keys_type?: unknown;
  retained_results_type?: unknown;
  retained_result_bytes_type?: unknown;
}

interface ReceiptAggregate {
  readonly totalKeys: number;
  readonly retainedResults: number;
  readonly retainedResultBytes: number;
}

export interface InitializeDatabaseReceiptSchemaOptions {
  readonly runtime: DatabaseRuntime;
  readonly realmFingerprint: string;
  readonly validateLegacyResult: (
    row: Readonly<{ resultJson: string; finalSeq: number }>,
    idempotencyKey: string,
    resultVersion: number,
  ) => void;
}

/** Create/migrate and validate every private receipt schema object atomically. */
export function initializeDatabaseReceiptSchema(
  options: InitializeDatabaseReceiptSchemaOptions,
): void {
  try {
    options.runtime.db.transaction(() => {
      let schema = readSchemaDefinition(options.runtime, DATABASE_RECEIPT_TABLE);
      if (schema === null) {
        options.runtime.db.exec(RECEIPT_CREATE_SQL);
        schema = readSchemaDefinition(options.runtime, DATABASE_RECEIPT_TABLE);
      } else if (schema.type === 'table'
        && schema.sql
        && normalizeSqlShape(schema.sql) === normalizeSqlShape(RECEIPT_V1_STORED_SQL)) {
        removeLegacyMetadata(options.runtime);
        migrateLegacyReceiptSchema(options);
        schema = readSchemaDefinition(options.runtime, DATABASE_RECEIPT_TABLE);
      }
      if (schema?.type !== 'table'
        || !schema.sql
        || normalizeSqlShape(schema.sql) !== normalizeSqlShape(RECEIPT_STORED_SQL)) {
        throw new Error('receipt table definition differs');
      }
      assertTableShape(options.runtime, DATABASE_RECEIPT_TABLE, 10);

      const index = readSchemaDefinition(options.runtime, RECEIPT_RETENTION_INDEX);
      if (index === null) {
        options.runtime.db.exec(RECEIPT_RETENTION_INDEX_CREATE_SQL);
      } else if (index.type !== 'index'
        || !index.sql
        || normalizeSqlShape(index.sql)
          !== normalizeSqlShape(RECEIPT_RETENTION_INDEX_SQL)) {
        throw new Error('receipt retention index differs');
      }
      initializeOrValidateMetadata(options.runtime);
    });
  } catch (cause) {
    if (cause instanceof DatabaseError) throw cause;
    throw new DatabaseError(
      'DATABASE_SCHEMA_MISMATCH',
      'Database receipt schema is incompatible.',
      { cause },
    );
  }
}

/** Validate one row read from the exact private receipt table. */
export function assertDatabaseReceiptRow(
  row: DatabaseReceiptRow,
  idempotencyKey: string,
): void {
  if (row.receipt_key !== idempotencyKey
    || row.receipt_key_type !== 'text'
    || row.realm_fingerprint_type !== 'text'
    || row.operation_fingerprint_type !== 'text'
    || row.receipt_state_type !== 'text'
    || row.result_version_type !== 'integer'
    || row.schema_version_type !== 'integer'
    || row.created_at_type !== 'integer'
    || row.insertion_ordinal_type !== 'integer'
    || row.schema_version !== DATABASE_WRITER_RECEIPT_SCHEMA_VERSION
    || (row.result_version !== DATABASE_RECEIPT_RESULT_VERSION_LEGACY
      && row.result_version !== DATABASE_RECEIPT_RESULT_VERSION_CURRENT)
    || !Number.isSafeInteger(row.created_at)
    || row.created_at < 0
    || !Number.isSafeInteger(row.insertion_ordinal)
    || row.insertion_ordinal < 1
    || !/^sha256:[a-f0-9]{64}$/u.test(row.realm_fingerprint)
    || !/^sha256:[a-f0-9]{64}$/u.test(row.operation_fingerprint)) {
    throw databaseReceiptCorrupt();
  }
  if (row.receipt_state === DATABASE_RECEIPT_STATE_RETAINED) {
    if (row.result_json_type !== 'text'
      || row.final_seq_type !== 'integer'
      || typeof row.result_json !== 'string'
      || !Number.isSafeInteger(row.final_seq)
      || row.final_seq! < 0
      || textEncoder.encode(row.result_json).byteLength
        > DATABASE_WRITER_MAX_RECEIPT_RESULT_BYTES) {
      throw databaseReceiptCorrupt();
    }
    return;
  }
  if (row.receipt_state !== DATABASE_RECEIPT_STATE_EXPIRED
    || row.result_json_type !== 'null'
    || row.final_seq_type !== 'null'
    || row.result_json !== null
    || row.final_seq !== null) {
    throw databaseReceiptCorrupt();
  }
}

export function databaseReceiptCorrupt(cause?: unknown): DatabaseError {
  return new DatabaseError(
    'DATABASE_SCHEMA_MISMATCH',
    'Database idempotency receipt is incompatible.',
    cause === undefined ? undefined : { cause },
  );
}

function initializeOrValidateMetadata(runtime: DatabaseRuntime): void {
  const stats = readSchemaDefinition(runtime, DATABASE_RECEIPT_STATS_TABLE);
  const triggers = Object.keys(RECEIPT_TRIGGER_SQL).map((name) =>
    readSchemaDefinition(runtime, name));
  if (stats === null && triggers.every((trigger) => trigger === null)) {
    compactReceiptRowsWithoutMetadata(runtime);
    runtime.db.exec(RECEIPT_STATS_CREATE_SQL);
    const aggregate = readReceiptAggregate(runtime);
    const insertStats = runtime.db.prepare(`
      INSERT INTO main.${DATABASE_RECEIPT_STATS_TABLE} (
        singleton,
        schema_version,
        total_keys,
        retained_results,
        retained_result_bytes
      ) VALUES (1, ?, ?, ?, ?)
    `);
    try {
      if (insertStats.run(
        RECEIPT_STATS_SCHEMA_VERSION,
        aggregate.totalKeys,
        aggregate.retainedResults,
        aggregate.retainedResultBytes,
      ).changes !== 1) throw new Error('receipt statistics insert failed');
    } finally {
      insertStats.finalize();
    }
    for (const sql of Object.values(RECEIPT_TRIGGER_SQL)) runtime.db.exec(sql);
  }

  const storedStats = readSchemaDefinition(runtime, DATABASE_RECEIPT_STATS_TABLE);
  if (storedStats?.type !== 'table'
    || !storedStats.sql
    || normalizeSqlShape(storedStats.sql)
      !== normalizeSqlShape(RECEIPT_STATS_STORED_SQL)) {
    throw new Error('receipt statistics table differs');
  }
  assertTableShape(runtime, DATABASE_RECEIPT_STATS_TABLE, 5);
  for (const [name, expected] of Object.entries(RECEIPT_TRIGGER_SQL)) {
    const trigger = readSchemaDefinition(runtime, name);
    if (trigger?.type !== 'trigger'
      || !trigger.sql
      || normalizeSqlShape(trigger.sql) !== normalizeSqlShape(expected)) {
      throw new Error('receipt trigger differs');
    }
  }
  const foreignTriggers = runtime.db.prepare(`
    SELECT COUNT(*) AS count
    FROM main.sqlite_schema
    WHERE type = 'trigger'
      AND tbl_name = ?
      AND name NOT IN (${Object.keys(RECEIPT_TRIGGER_SQL).map(() => '?').join(', ')})
  `);
  try {
    const count = (foreignTriggers.get(
      DATABASE_RECEIPT_TABLE,
      ...Object.keys(RECEIPT_TRIGGER_SQL),
    ) as { count?: unknown } | null)?.count;
    if (count !== 0) throw new Error('receipt table has foreign triggers');
  } finally {
    foreignTriggers.finalize();
  }
  const rows = readStatsRows(runtime);
  if (rows.length !== 1) throw new Error('receipt statistics row differs');
  assertStatsRow(rows[0]);
}

function removeLegacyMetadata(runtime: DatabaseRuntime): void {
  const stats = readSchemaDefinition(runtime, DATABASE_RECEIPT_STATS_TABLE);
  if (stats !== null) {
    if (stats.type !== 'table'
      || !stats.sql
      || normalizeSqlShape(stats.sql)
        !== normalizeSqlShape(RECEIPT_STATS_STORED_SQL)) {
      throw new Error('legacy receipt statistics table differs');
    }
    runtime.db.exec(`DROP TABLE main.${DATABASE_RECEIPT_STATS_TABLE}`);
  }
  for (const name of Object.keys(RECEIPT_TRIGGER_SQL)) {
    runtime.db.exec(`DROP TRIGGER IF EXISTS main.${name}`);
  }
}

function migrateLegacyReceiptSchema(
  options: InitializeDatabaseReceiptSchemaOptions,
): void {
  const totalRows = validateLegacyReceiptRows(options);
  options.runtime.db.exec(
    `ALTER TABLE main.${DATABASE_RECEIPT_TABLE} RENAME TO ${LEGACY_RECEIPT_TABLE}`,
  );
  options.runtime.db.exec(RECEIPT_CREATE_SQL);
  const copy = options.runtime.db.prepare(`
    INSERT INTO main.${DATABASE_RECEIPT_TABLE} (
      receipt_key,
      realm_fingerprint,
      operation_fingerprint,
      receipt_state,
      result_json,
      final_seq,
      result_version,
      schema_version,
      created_at,
      insertion_ordinal
    )
    SELECT
      receipt_key,
      realm_fingerprint,
      operation_fingerprint,
      CASE WHEN realm_fingerprint = ?
        THEN '${DATABASE_RECEIPT_STATE_RETAINED}'
        ELSE '${DATABASE_RECEIPT_STATE_EXPIRED}'
      END,
      CASE WHEN realm_fingerprint = ? THEN result_json ELSE NULL END,
      CASE WHEN realm_fingerprint = ? THEN final_seq ELSE NULL END,
      ${DATABASE_RECEIPT_RESULT_VERSION_LEGACY},
      ${DATABASE_WRITER_RECEIPT_SCHEMA_VERSION},
      created_at,
      ROW_NUMBER() OVER (
        ORDER BY created_at ASC, receipt_key COLLATE BINARY ASC
      )
    FROM main.${LEGACY_RECEIPT_TABLE}
    ORDER BY created_at ASC, receipt_key COLLATE BINARY ASC
  `);
  try {
    if (copy.run(
      options.realmFingerprint,
      options.realmFingerprint,
      options.realmFingerprint,
    ).changes !== totalRows) throw databaseReceiptCorrupt();
  } finally {
    copy.finalize();
  }
  options.runtime.db.exec(`DROP TABLE main.${LEGACY_RECEIPT_TABLE}`);
}

function validateLegacyReceiptRows(
  options: InitializeDatabaseReceiptSchemaOptions,
): number {
  const statement = options.runtime.db.prepare(`
    SELECT
      receipt_key,
      realm_fingerprint,
      operation_fingerprint,
      result_json,
      final_seq,
      schema_version,
      created_at,
      typeof(receipt_key) AS receipt_key_type,
      typeof(realm_fingerprint) AS realm_fingerprint_type,
      typeof(operation_fingerprint) AS operation_fingerprint_type,
      typeof(result_json) AS result_json_type,
      typeof(final_seq) AS final_seq_type,
      typeof(schema_version) AS schema_version_type,
      typeof(created_at) AS created_at_type
    FROM main.${DATABASE_RECEIPT_TABLE}
    ORDER BY created_at ASC, receipt_key COLLATE BINARY ASC
  `);
  let totalRows = 0;
  try {
    for (const candidate of statement.iterate() as Iterable<LegacyReceiptRow>) {
      assertLegacyReceiptRow(candidate);
      totalRows += 1;
      if (!Number.isSafeInteger(totalRows)
        || totalRows > DATABASE_WRITER_MAX_RECEIPT_KEYS) {
        throw databaseReceiptCorrupt();
      }
      if (candidate.realm_fingerprint !== options.realmFingerprint) continue;
      try {
        options.validateLegacyResult({
          resultJson: candidate.result_json,
          finalSeq: candidate.final_seq,
        }, candidate.receipt_key, DATABASE_RECEIPT_RESULT_VERSION_LEGACY);
      } catch (cause) {
        throw databaseReceiptCorrupt(cause);
      }
    }
  } finally {
    statement.finalize();
  }
  return totalRows;
}

function compactReceiptRowsWithoutMetadata(runtime: DatabaseRuntime): void {
  runtime.db.exec(`
    UPDATE main.${DATABASE_RECEIPT_TABLE}
    SET
      receipt_state = '${DATABASE_RECEIPT_STATE_EXPIRED}',
      result_json = NULL,
      final_seq = NULL
    WHERE receipt_state = '${DATABASE_RECEIPT_STATE_RETAINED}'
      AND length(CAST(result_json AS BLOB))
        > ${DATABASE_WRITER_MAX_RECEIPT_RESULT_BYTES}
  `);
  runtime.db.exec(`
    WITH retained AS (
      SELECT
        receipt_key,
        ROW_NUMBER() OVER (
          ORDER BY insertion_ordinal DESC
        ) AS retained_rank,
        SUM(length(CAST(result_json AS BLOB))) OVER (
          ORDER BY insertion_ordinal DESC
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS retained_bytes
      FROM main.${DATABASE_RECEIPT_TABLE}
      WHERE receipt_state = '${DATABASE_RECEIPT_STATE_RETAINED}'
    )
    UPDATE main.${DATABASE_RECEIPT_TABLE}
    SET
      receipt_state = '${DATABASE_RECEIPT_STATE_EXPIRED}',
      result_json = NULL,
      final_seq = NULL
    WHERE receipt_key IN (
      SELECT receipt_key
      FROM retained
      WHERE retained_rank > ${DATABASE_WRITER_MAX_RECEIPTS}
        OR retained_bytes > ${DATABASE_WRITER_MAX_RETAINED_RECEIPT_BYTES}
    )
  `);
}

function readReceiptAggregate(runtime: DatabaseRuntime): ReceiptAggregate {
  const aggregate = runtime.db.prepare(`
    SELECT
      COUNT(*) AS total_keys,
      COUNT(*) FILTER (
        WHERE receipt_state = '${DATABASE_RECEIPT_STATE_RETAINED}'
      ) AS retained_results,
      COALESCE(SUM(
        CASE WHEN receipt_state = '${DATABASE_RECEIPT_STATE_RETAINED}'
          THEN length(CAST(result_json AS BLOB)) ELSE 0 END
      ), 0) AS retained_result_bytes
    FROM main.${DATABASE_RECEIPT_TABLE}
  `);
  try {
    const row = aggregate.get() as {
      total_keys?: unknown;
      retained_results?: unknown;
      retained_result_bytes?: unknown;
    } | null;
    if (!isSafeCount(row?.total_keys)
      || !isSafeCount(row?.retained_results)
      || !isSafeCount(row?.retained_result_bytes)
      || (row!.total_keys as number) > DATABASE_WRITER_MAX_RECEIPT_KEYS
      || (row!.retained_results as number) > DATABASE_WRITER_MAX_RECEIPTS
      || (row!.retained_result_bytes as number)
        > DATABASE_WRITER_MAX_RETAINED_RECEIPT_BYTES
      || (row!.retained_results as number) > (row!.total_keys as number)) {
      throw databaseReceiptCorrupt();
    }
    return Object.freeze({
      totalKeys: row!.total_keys as number,
      retainedResults: row!.retained_results as number,
      retainedResultBytes: row!.retained_result_bytes as number,
    });
  } finally {
    aggregate.finalize();
  }
}

function readStatsRows(runtime: DatabaseRuntime): ReceiptStatsRow[] {
  const statement = runtime.db.prepare(`
    SELECT
      singleton,
      schema_version,
      total_keys,
      retained_results,
      retained_result_bytes,
      typeof(singleton) AS singleton_type,
      typeof(schema_version) AS schema_version_type,
      typeof(total_keys) AS total_keys_type,
      typeof(retained_results) AS retained_results_type,
      typeof(retained_result_bytes) AS retained_result_bytes_type
    FROM main.${DATABASE_RECEIPT_STATS_TABLE}
  `);
  try {
    return statement.all() as ReceiptStatsRow[];
  } finally {
    statement.finalize();
  }
}

function assertStatsRow(row: ReceiptStatsRow | undefined): void {
  if (!row
    || row.singleton !== 1
    || row.schema_version !== RECEIPT_STATS_SCHEMA_VERSION
    || row.singleton_type !== 'integer'
    || row.schema_version_type !== 'integer'
    || row.total_keys_type !== 'integer'
    || row.retained_results_type !== 'integer'
    || row.retained_result_bytes_type !== 'integer'
    || !isSafeCount(row.total_keys)
    || !isSafeCount(row.retained_results)
    || !isSafeCount(row.retained_result_bytes)
    || (row.total_keys as number) > DATABASE_WRITER_MAX_RECEIPT_KEYS
    || (row.retained_results as number) > (row.total_keys as number)
    || (row.retained_results as number) > DATABASE_WRITER_MAX_RECEIPTS
    || (row.retained_result_bytes as number)
      > DATABASE_WRITER_MAX_RETAINED_RECEIPT_BYTES) {
    throw databaseReceiptCorrupt();
  }
}

function assertLegacyReceiptRow(row: LegacyReceiptRow): void {
  if (row.receipt_key_type !== 'text'
    || !isDatabaseIdempotencyKey(row.receipt_key)
    || row.realm_fingerprint_type !== 'text'
    || row.operation_fingerprint_type !== 'text'
    || row.result_json_type !== 'text'
    || row.final_seq_type !== 'integer'
    || row.schema_version_type !== 'integer'
    || row.created_at_type !== 'integer'
    || row.schema_version !== 1
    || !Number.isSafeInteger(row.final_seq)
    || row.final_seq < 0
    || !Number.isSafeInteger(row.created_at)
    || row.created_at < 0
    || !/^sha256:[a-f0-9]{64}$/u.test(row.realm_fingerprint)
    || !/^sha256:[a-f0-9]{64}$/u.test(row.operation_fingerprint)) {
    throw databaseReceiptCorrupt();
  }
}

function readSchemaDefinition(
  runtime: DatabaseRuntime,
  name: string,
): { type: string; sql: string | null } | null {
  const definition = runtime.db.prepare(`
    SELECT type, sql FROM main.sqlite_schema WHERE name = ?
  `);
  try {
    return definition.get(name) as { type: string; sql: string | null } | null;
  } finally {
    definition.finalize();
  }
}

function assertTableShape(
  runtime: DatabaseRuntime,
  table: string,
  columns: number,
): void {
  const details = runtime.db.prepare(
    `PRAGMA main.table_list(${JSON.stringify(table)})`,
  );
  try {
    const rows = details.all() as Array<{
      name: string;
      type: string;
      ncol: number;
      wr: number;
      strict: number;
    }>;
    if (rows.length !== 1
      || rows[0]!.name !== table
      || rows[0]!.type !== 'table'
      || rows[0]!.ncol !== columns
      || rows[0]!.wr !== 1
      || rows[0]!.strict !== 1) {
      throw new Error('receipt table flags differ');
    }
  } finally {
    details.finalize();
  }
}

function normalizeSqlShape(sql: string): string {
  return sql.trim().replace(/\s+/gu, ' ').replace(/\s*,\s*/gu, ', ').toLowerCase();
}

function isSafeCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

/**
 * Private schema, accounting, and retention for default Resource receipts.
 *
 * The single statistics row makes steady-state admission and compaction
 * independent of the permanent tombstone count. A full aggregate is checked
 * only while the private schema is initialized or revalidated.
 */

import type { ReactiveDB } from '../sync/reactive-db';

/** Full canonical Resource results retained before FIFO compaction. */
export const RESOURCE_DEFAULT_RECEIPT_RETAINED_LIMIT = 10_000 as const;

/** Permanent Resource receipt identities admitted by the default database. */
export const RESOURCE_DEFAULT_RECEIPT_MAX_KEYS = 1_000_000 as const;

/** Maximum UTF-8 bytes in one canonical default Resource receipt result. */
export const RESOURCE_DEFAULT_RECEIPT_MAX_RESULT_BYTES = 4_194_304 as const;

/** Maximum aggregate UTF-8 bytes across retained default Resource results. */
export const RESOURCE_DEFAULT_RECEIPT_MAX_RETAINED_BYTES = 67_108_864 as const;

export const RESOURCE_DEFAULT_RECEIPT_TABLE = '_zero_resource_mutation_receipts';
export const RESOURCE_DEFAULT_RECEIPT_STATE_RETAINED = 'retained';
export const RESOURCE_DEFAULT_RECEIPT_STATE_EXPIRED = 'expired';
export const RESOURCE_DEFAULT_RECEIPT_SCHEMA_VERSION = 1 as const;

const RECEIPT_INDEX = '_zero_resource_mutation_receipts_retention_v1';
const RECEIPT_STATS_TABLE = '_zero_resource_receipt_stats_v1';
const RECEIPT_INSERT_GUARD_TRIGGER = '_zero_resource_receipt_insert_guard_v1';
const RECEIPT_INSERT_STATS_TRIGGER = '_zero_resource_receipt_insert_stats_v1';
const RECEIPT_UPDATE_GUARD_TRIGGER = '_zero_resource_receipt_update_guard_v1';
const RECEIPT_UPDATE_STATS_TRIGGER = '_zero_resource_receipt_update_stats_v1';
const RECEIPT_DELETE_GUARD_TRIGGER = '_zero_resource_receipt_delete_guard_v1';
const RECEIPT_STATS_SCHEMA_VERSION = 1 as const;

const RECEIPT_COLUMNS_SQL = `(
  receipt_key TEXT PRIMARY KEY,
  logical_fingerprint TEXT NOT NULL,
  receipt_state TEXT NOT NULL CHECK (receipt_state IN ('retained', 'expired')),
  result_json TEXT,
  final_seq INTEGER CHECK (final_seq IS NULL OR final_seq >= 0),
  result_version INTEGER NOT NULL CHECK (result_version = 1),
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  insertion_ordinal INTEGER NOT NULL UNIQUE CHECK (insertion_ordinal > 0),
  CHECK (
    (receipt_state = 'retained' AND result_json IS NOT NULL AND final_seq IS NOT NULL)
    OR (receipt_state = 'expired' AND result_json IS NULL AND final_seq IS NULL)
  )
) STRICT, WITHOUT ROWID`;
const RECEIPT_STORED_SQL =
  `CREATE TABLE ${RESOURCE_DEFAULT_RECEIPT_TABLE} ${RECEIPT_COLUMNS_SQL}`;
const RECEIPT_CREATE_SQL =
  `CREATE TABLE IF NOT EXISTS main.${RESOURCE_DEFAULT_RECEIPT_TABLE} ${RECEIPT_COLUMNS_SQL}`;
const RECEIPT_INDEX_SQL = `CREATE INDEX ${RECEIPT_INDEX} `
  + `ON ${RESOURCE_DEFAULT_RECEIPT_TABLE} (receipt_state, insertion_ordinal)`;
const RECEIPT_INDEX_CREATE_SQL = `CREATE INDEX IF NOT EXISTS main.${RECEIPT_INDEX} `
  + `ON ${RESOURCE_DEFAULT_RECEIPT_TABLE} (receipt_state, insertion_ordinal)`;

const RECEIPT_STATS_COLUMNS_SQL = `(
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  total_keys INTEGER NOT NULL CHECK (
    total_keys >= 0
    AND total_keys <= ${RESOURCE_DEFAULT_RECEIPT_MAX_KEYS}
  ),
  retained_results INTEGER NOT NULL CHECK (
    retained_results >= 0
    AND retained_results <= total_keys
    AND retained_results <= ${RESOURCE_DEFAULT_RECEIPT_RETAINED_LIMIT}
  ),
  retained_result_bytes INTEGER NOT NULL CHECK (
    retained_result_bytes >= 0
    AND retained_result_bytes <= ${RESOURCE_DEFAULT_RECEIPT_MAX_RETAINED_BYTES}
  )
) STRICT, WITHOUT ROWID`;
const RECEIPT_STATS_STORED_SQL =
  `CREATE TABLE ${RECEIPT_STATS_TABLE} ${RECEIPT_STATS_COLUMNS_SQL}`;
const RECEIPT_STATS_CREATE_SQL =
  `CREATE TABLE main.${RECEIPT_STATS_TABLE} ${RECEIPT_STATS_COLUMNS_SQL}`;

const RECEIPT_INSERT_GUARD_SQL = `CREATE TRIGGER ${RECEIPT_INSERT_GUARD_TRIGGER}
BEFORE INSERT ON ${RESOURCE_DEFAULT_RECEIPT_TABLE}
WHEN NEW.receipt_state != '${RESOURCE_DEFAULT_RECEIPT_STATE_RETAINED}'
  OR length(CAST(NEW.result_json AS BLOB)) > ${RESOURCE_DEFAULT_RECEIPT_MAX_RESULT_BYTES}
  OR (SELECT total_keys FROM ${RECEIPT_STATS_TABLE} WHERE singleton = 1)
    >= ${RESOURCE_DEFAULT_RECEIPT_MAX_KEYS}
BEGIN
  SELECT RAISE(ABORT, 'zero resource receipt admission rejected');
END`;
const RECEIPT_INSERT_STATS_SQL = `CREATE TRIGGER ${RECEIPT_INSERT_STATS_TRIGGER}
AFTER INSERT ON ${RESOURCE_DEFAULT_RECEIPT_TABLE}
BEGIN
  UPDATE ${RECEIPT_STATS_TABLE}
  SET
    total_keys = total_keys + 1,
    retained_results = retained_results + 1,
    retained_result_bytes = retained_result_bytes
      + length(CAST(NEW.result_json AS BLOB))
  WHERE singleton = 1;
  SELECT CASE WHEN changes() != 1
    THEN RAISE(ABORT, 'zero resource receipt statistics unavailable') END;
END`;
const RECEIPT_UPDATE_GUARD_SQL = `CREATE TRIGGER ${RECEIPT_UPDATE_GUARD_TRIGGER}
BEFORE UPDATE ON ${RESOURCE_DEFAULT_RECEIPT_TABLE}
WHEN NOT (
  OLD.receipt_state = '${RESOURCE_DEFAULT_RECEIPT_STATE_RETAINED}'
  AND NEW.receipt_state = '${RESOURCE_DEFAULT_RECEIPT_STATE_EXPIRED}'
  AND NEW.receipt_key IS OLD.receipt_key
  AND NEW.logical_fingerprint IS OLD.logical_fingerprint
  AND NEW.result_json IS NULL
  AND NEW.final_seq IS NULL
  AND NEW.result_version IS OLD.result_version
  AND NEW.schema_version IS OLD.schema_version
  AND NEW.created_at IS OLD.created_at
  AND NEW.insertion_ordinal IS OLD.insertion_ordinal
)
BEGIN
  SELECT RAISE(ABORT, 'zero resource receipt rows are immutable');
END`;
const RECEIPT_UPDATE_STATS_SQL = `CREATE TRIGGER ${RECEIPT_UPDATE_STATS_TRIGGER}
AFTER UPDATE ON ${RESOURCE_DEFAULT_RECEIPT_TABLE}
BEGIN
  UPDATE ${RECEIPT_STATS_TABLE}
  SET
    retained_results = retained_results - 1,
    retained_result_bytes = retained_result_bytes
      - length(CAST(OLD.result_json AS BLOB))
  WHERE singleton = 1;
  SELECT CASE WHEN changes() != 1
    THEN RAISE(ABORT, 'zero resource receipt statistics unavailable') END;
END`;
const RECEIPT_DELETE_GUARD_SQL = `CREATE TRIGGER ${RECEIPT_DELETE_GUARD_TRIGGER}
BEFORE DELETE ON ${RESOURCE_DEFAULT_RECEIPT_TABLE}
BEGIN
  SELECT RAISE(ABORT, 'zero resource receipt identities are permanent');
END`;

const RECEIPT_TRIGGER_SQL = Object.freeze({
  [RECEIPT_INSERT_GUARD_TRIGGER]: RECEIPT_INSERT_GUARD_SQL,
  [RECEIPT_INSERT_STATS_TRIGGER]: RECEIPT_INSERT_STATS_SQL,
  [RECEIPT_UPDATE_GUARD_TRIGGER]: RECEIPT_UPDATE_GUARD_SQL,
  [RECEIPT_UPDATE_STATS_TRIGGER]: RECEIPT_UPDATE_STATS_SQL,
  [RECEIPT_DELETE_GUARD_TRIGGER]: RECEIPT_DELETE_GUARD_SQL,
});

/** @internal Test seams may lower, but never raise, production limits. */
export interface ResourceDefaultReceiptLimitsInput {
  readonly retainedResults?: number;
  readonly permanentKeys?: number;
  readonly resultBytes?: number;
  readonly retainedBytes?: number;
}

export interface ResourceDefaultReceiptLimits {
  readonly retainedResults: number;
  readonly permanentKeys: number;
  readonly resultBytes: number;
  readonly retainedBytes: number;
}

export interface ResourceDefaultReceiptStats {
  readonly totalKeys: number;
  readonly retainedResults: number;
  readonly retainedResultBytes: number;
}

export interface ResourceDefaultReceiptPruneResult {
  readonly prunedCount: number;
  readonly prunedResultBytes: number;
  readonly statsAfterPrune: ResourceDefaultReceiptStats;
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

export function resolveResourceDefaultReceiptLimits(
  input: ResourceDefaultReceiptLimitsInput = {},
): ResourceDefaultReceiptLimits {
  const limits = Object.freeze({
    retainedResults: input.retainedResults
      ?? RESOURCE_DEFAULT_RECEIPT_RETAINED_LIMIT,
    permanentKeys: input.permanentKeys ?? RESOURCE_DEFAULT_RECEIPT_MAX_KEYS,
    resultBytes: input.resultBytes ?? RESOURCE_DEFAULT_RECEIPT_MAX_RESULT_BYTES,
    retainedBytes: input.retainedBytes
      ?? RESOURCE_DEFAULT_RECEIPT_MAX_RETAINED_BYTES,
  });
  assertPositiveLimit(
    limits.retainedResults,
    RESOURCE_DEFAULT_RECEIPT_RETAINED_LIMIT,
    'retainedResults',
  );
  assertPositiveLimit(
    limits.permanentKeys,
    RESOURCE_DEFAULT_RECEIPT_MAX_KEYS,
    'permanentKeys',
  );
  assertPositiveLimit(
    limits.resultBytes,
    RESOURCE_DEFAULT_RECEIPT_MAX_RESULT_BYTES,
    'resultBytes',
  );
  assertPositiveLimit(
    limits.retainedBytes,
    RESOURCE_DEFAULT_RECEIPT_MAX_RETAINED_BYTES,
    'retainedBytes',
  );
  if (limits.retainedResults > limits.permanentKeys) {
    throw new TypeError(
      'Resource receipt retainedResults cannot exceed permanentKeys',
    );
  }
  if (limits.resultBytes > limits.retainedBytes) {
    throw new TypeError('Resource receipt resultBytes cannot exceed retainedBytes');
  }
  return limits;
}

/** Initialize and fully validate the private schema and aggregate accounting. */
export function initializeResourceDefaultReceiptLedger(
  db: ReactiveDB,
  limits: ResourceDefaultReceiptLimits,
): void {
  const raw = db.getRawDatabase();
  raw.run(RECEIPT_CREATE_SQL);
  raw.run(RECEIPT_INDEX_CREATE_SQL);
  validateBaseSchema(db);

  const stats = readSchemaDefinition(db, RECEIPT_STATS_TABLE);
  const triggers = Object.keys(RECEIPT_TRIGGER_SQL).map((name) =>
    readSchemaDefinition(db, name));
  if (stats === null && triggers.every((trigger) => trigger === null)) {
    compactRowsWithoutMetadata(db, limits);
    raw.exec(RECEIPT_STATS_CREATE_SQL);
    const aggregate = readReceiptAggregate(db);
    const insert = db.prepare(`
      INSERT INTO main.${RECEIPT_STATS_TABLE} (
        singleton,
        schema_version,
        total_keys,
        retained_results,
        retained_result_bytes
      ) VALUES (1, ?, ?, ?, ?)
    `);
    try {
      if (insert.run(
        RECEIPT_STATS_SCHEMA_VERSION,
        aggregate.totalKeys,
        aggregate.retainedResults,
        aggregate.retainedResultBytes,
      ).changes !== 1) {
        throw new Error('Resource receipt statistics could not be initialized');
      }
    } finally {
      insert.finalize();
    }
    for (const sql of Object.values(RECEIPT_TRIGGER_SQL)) raw.exec(sql);
  } else if (stats === null || triggers.some((trigger) => trigger === null)) {
    throw new Error('Resource receipt metadata schema is incomplete');
  }

  validateMetadataSchema(db);
  const recorded = readResourceDefaultReceiptStats(db, limits);
  const aggregate = readReceiptAggregate(db);
  if (recorded.totalKeys !== aggregate.totalKeys
    || recorded.retainedResults !== aggregate.retainedResults
    || recorded.retainedResultBytes !== aggregate.retainedResultBytes) {
    throw new Error('Resource receipt statistics do not match the ledger');
  }
}

/** Read the O(1) validated private aggregate used for admission. */
export function readResourceDefaultReceiptStats(
  db: ReactiveDB,
  limits: ResourceDefaultReceiptLimits,
): ResourceDefaultReceiptStats {
  const statement = db.prepare(`
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
    FROM main.${RECEIPT_STATS_TABLE}
    WHERE singleton = 1
  `);
  let row: ReceiptStatsRow | null;
  try {
    row = statement.get() as ReceiptStatsRow | null;
  } finally {
    statement.finalize();
  }
  assertStatsRow(row, limits);
  return Object.freeze({
    totalKeys: row!.total_keys as number,
    retainedResults: row!.retained_results as number,
    retainedResultBytes: row!.retained_result_bytes as number,
  });
}

/** Compact only retained rows; permanent tombstones are never scanned. */
export function pruneResourceDefaultReceiptsForInsert(
  db: ReactiveDB,
  limits: ResourceDefaultReceiptLimits,
  stats: ResourceDefaultReceiptStats,
  insertedBytes: number,
): ResourceDefaultReceiptPruneResult {
  const countToRemove = Math.max(
    0,
    stats.retainedResults + 1 - limits.retainedResults,
  );
  const bytesToRemove = Math.max(
    0,
    stats.retainedResultBytes + insertedBytes - limits.retainedBytes,
  );
  if (countToRemove === 0 && bytesToRemove === 0) {
    return Object.freeze({
      prunedCount: 0,
      prunedResultBytes: 0,
      statsAfterPrune: stats,
    });
  }

  const candidates = db.prepare(`
    SELECT
      insertion_ordinal,
      length(CAST(result_json AS BLOB)) AS result_bytes,
      typeof(insertion_ordinal) AS insertion_ordinal_type,
      typeof(length(CAST(result_json AS BLOB))) AS result_bytes_type
    FROM main.${RESOURCE_DEFAULT_RECEIPT_TABLE}
    WHERE receipt_state = '${RESOURCE_DEFAULT_RECEIPT_STATE_RETAINED}'
    ORDER BY insertion_ordinal ASC
  `);
  let prunedCount = 0;
  let prunedBytes = 0;
  let cutoff: number | null = null;
  try {
    for (const candidate of candidates.iterate() as Iterable<{
      insertion_ordinal?: unknown;
      result_bytes?: unknown;
      insertion_ordinal_type?: unknown;
      result_bytes_type?: unknown;
    }>) {
      if (candidate.insertion_ordinal_type !== 'integer'
        || candidate.result_bytes_type !== 'integer'
        || !Number.isSafeInteger(candidate.insertion_ordinal)
        || (candidate.insertion_ordinal as number) < 1
        || !isSafeCount(candidate.result_bytes)) {
        throw new Error('Resource receipt compaction candidate is invalid');
      }
      prunedCount += 1;
      prunedBytes += candidate.result_bytes as number;
      cutoff = candidate.insertion_ordinal as number;
      if (!Number.isSafeInteger(prunedCount)
        || !Number.isSafeInteger(prunedBytes)) {
        throw new Error('Resource receipt compaction accounting overflowed');
      }
      if (prunedCount >= countToRemove && prunedBytes >= bytesToRemove) break;
    }
  } finally {
    candidates.finalize();
  }
  if (cutoff === null
    || prunedCount < countToRemove
    || prunedBytes < bytesToRemove) {
    throw new Error('Resource receipt compaction could not satisfy its limits');
  }

  const prune = db.prepare(`
    UPDATE main.${RESOURCE_DEFAULT_RECEIPT_TABLE}
    SET
      receipt_state = '${RESOURCE_DEFAULT_RECEIPT_STATE_EXPIRED}',
      result_json = NULL,
      final_seq = NULL
    WHERE receipt_state = '${RESOURCE_DEFAULT_RECEIPT_STATE_RETAINED}'
      AND insertion_ordinal <= ?
  `);
  try {
    prune.run(cutoff);
  } finally {
    prune.finalize();
  }
  const after = readResourceDefaultReceiptStats(db, limits);
  if (after.totalKeys !== stats.totalKeys
    || after.retainedResults !== stats.retainedResults - prunedCount
    || after.retainedResultBytes !== stats.retainedResultBytes - prunedBytes) {
    throw new Error('Resource receipt compaction statistics are inconsistent');
  }
  return Object.freeze({
    prunedCount,
    prunedResultBytes: prunedBytes,
    statsAfterPrune: after,
  });
}

export function readResourceDefaultReceiptSchemaVersion(db: ReactiveDB): number {
  const statement = db.prepare('PRAGMA main.schema_version');
  let row: { schema_version?: unknown } | null;
  try {
    row = statement.get() as typeof row;
  } finally {
    statement.finalize();
  }
  if (!Number.isSafeInteger(row?.schema_version)) {
    throw new Error('Resource receipt schema version is invalid');
  }
  return row!.schema_version as number;
}

function validateBaseSchema(db: ReactiveDB): void {
  const table = readSchemaRows(db, RESOURCE_DEFAULT_RECEIPT_TABLE, ['table', 'view']);
  if (table.length !== 1
    || table[0]!.name !== RESOURCE_DEFAULT_RECEIPT_TABLE
    || table[0]!.type !== 'table'
    || !table[0]!.sql
    || normalizeSql(table[0]!.sql!) !== normalizeSql(RECEIPT_STORED_SQL)) {
    throw new Error('Resource receipt table definition differs');
  }
  assertTableShape(db, RESOURCE_DEFAULT_RECEIPT_TABLE, 9);

  const index = readSchemaDefinition(db, RECEIPT_INDEX);
  if (index?.type !== 'index'
    || !index.sql
    || normalizeSql(index.sql) !== normalizeSql(RECEIPT_INDEX_SQL)) {
    throw new Error('Resource receipt retention index differs');
  }
}

function validateMetadataSchema(db: ReactiveDB): void {
  const stats = readSchemaDefinition(db, RECEIPT_STATS_TABLE);
  if (stats?.type !== 'table'
    || !stats.sql
    || normalizeSql(stats.sql) !== normalizeSql(RECEIPT_STATS_STORED_SQL)) {
    throw new Error('Resource receipt statistics table differs');
  }
  assertTableShape(db, RECEIPT_STATS_TABLE, 5);
  for (const [name, expected] of Object.entries(RECEIPT_TRIGGER_SQL)) {
    const trigger = readSchemaDefinition(db, name);
    if (trigger?.type !== 'trigger'
      || !trigger.sql
      || normalizeSql(trigger.sql) !== normalizeSql(expected)) {
      throw new Error('Resource receipt trigger definition differs');
    }
  }

  const foreignTriggers = db.prepare(`
    SELECT COUNT(*) AS count
    FROM main.sqlite_schema
    WHERE type = 'trigger'
      AND tbl_name IN (?, ?)
      AND name NOT IN (${Object.keys(RECEIPT_TRIGGER_SQL).map(() => '?').join(', ')})
  `);
  try {
    const count = (foreignTriggers.get(
      RESOURCE_DEFAULT_RECEIPT_TABLE,
      RECEIPT_STATS_TABLE,
      ...Object.keys(RECEIPT_TRIGGER_SQL),
    ) as { count?: unknown } | null)?.count;
    if (count !== 0) throw new Error('Resource receipt tables have foreign triggers');
  } finally {
    foreignTriggers.finalize();
  }

  const rows = readStatsRows(db);
  if (rows.length !== 1) {
    throw new Error('Resource receipt statistics row count differs');
  }
}

function compactRowsWithoutMetadata(
  db: ReactiveDB,
  limits: ResourceDefaultReceiptLimits,
): void {
  db.getRawDatabase().exec(`
    UPDATE main.${RESOURCE_DEFAULT_RECEIPT_TABLE}
    SET
      receipt_state = '${RESOURCE_DEFAULT_RECEIPT_STATE_EXPIRED}',
      result_json = NULL,
      final_seq = NULL
    WHERE receipt_state = '${RESOURCE_DEFAULT_RECEIPT_STATE_RETAINED}'
      AND length(CAST(result_json AS BLOB)) > ${limits.resultBytes}
  `);
  db.getRawDatabase().exec(`
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
      FROM main.${RESOURCE_DEFAULT_RECEIPT_TABLE}
      WHERE receipt_state = '${RESOURCE_DEFAULT_RECEIPT_STATE_RETAINED}'
    )
    UPDATE main.${RESOURCE_DEFAULT_RECEIPT_TABLE}
    SET
      receipt_state = '${RESOURCE_DEFAULT_RECEIPT_STATE_EXPIRED}',
      result_json = NULL,
      final_seq = NULL
    WHERE receipt_key IN (
      SELECT receipt_key
      FROM retained
      WHERE retained_rank > ${limits.retainedResults}
        OR retained_bytes > ${limits.retainedBytes}
    )
  `);
}

function readReceiptAggregate(db: ReactiveDB): ResourceDefaultReceiptStats {
  const statement = db.prepare(`
    SELECT
      COUNT(*) AS total_keys,
      COUNT(*) FILTER (
        WHERE receipt_state = '${RESOURCE_DEFAULT_RECEIPT_STATE_RETAINED}'
      ) AS retained_results,
      COALESCE(SUM(
        CASE WHEN receipt_state = '${RESOURCE_DEFAULT_RECEIPT_STATE_RETAINED}'
          THEN length(CAST(result_json AS BLOB)) ELSE 0 END
      ), 0) AS retained_result_bytes,
      COALESCE(MAX(insertion_ordinal), 0) AS maximum_ordinal
    FROM main.${RESOURCE_DEFAULT_RECEIPT_TABLE}
  `);
  let row: {
    total_keys?: unknown;
    retained_results?: unknown;
    retained_result_bytes?: unknown;
    maximum_ordinal?: unknown;
  } | null;
  try {
    row = statement.get() as typeof row;
  } finally {
    statement.finalize();
  }
  if (!isSafeCount(row?.total_keys)
    || !isSafeCount(row?.retained_results)
    || !isSafeCount(row?.retained_result_bytes)
    || !isSafeCount(row?.maximum_ordinal)
    || row!.total_keys! > RESOURCE_DEFAULT_RECEIPT_MAX_KEYS
    || row!.retained_results! > row!.total_keys!
    || row!.maximum_ordinal !== row!.total_keys) {
    throw new Error('Resource receipt aggregate is invalid');
  }
  return Object.freeze({
    totalKeys: row!.total_keys as number,
    retainedResults: row!.retained_results as number,
    retainedResultBytes: row!.retained_result_bytes as number,
  });
}

function readStatsRows(db: ReactiveDB): ReceiptStatsRow[] {
  const statement = db.prepare(`
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
    FROM main.${RECEIPT_STATS_TABLE}
  `);
  try {
    return statement.all() as ReceiptStatsRow[];
  } finally {
    statement.finalize();
  }
}

function assertStatsRow(
  row: ReceiptStatsRow | null | undefined,
  limits: ResourceDefaultReceiptLimits,
): asserts row is ReceiptStatsRow {
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
    || (row.total_keys as number) > RESOURCE_DEFAULT_RECEIPT_MAX_KEYS
    || (row.retained_results as number) > (row.total_keys as number)
    || (row.retained_results as number) > limits.retainedResults
    || (row.retained_result_bytes as number) > limits.retainedBytes) {
    throw new Error('Resource receipt statistics are invalid');
  }
}

function readSchemaDefinition(
  db: ReactiveDB,
  name: string,
): { type: string; sql: string | null } | null {
  const statement = db.prepare(`
    SELECT type, sql
    FROM main.sqlite_schema
    WHERE name = ? COLLATE BINARY
  `);
  try {
    return statement.get(name) as { type: string; sql: string | null } | null;
  } finally {
    statement.finalize();
  }
}

function readSchemaRows(
  db: ReactiveDB,
  name: string,
  types: readonly string[],
): Array<{ name: string; type: string; sql: string | null }> {
  const statement = db.prepare(`
    SELECT name, type, sql
    FROM main.sqlite_schema
    WHERE name = ? COLLATE NOCASE
      AND type IN (${types.map(() => '?').join(', ')})
  `);
  try {
    return statement.all(name, ...types) as Array<{
      name: string;
      type: string;
      sql: string | null;
    }>;
  } finally {
    statement.finalize();
  }
}

function assertTableShape(db: ReactiveDB, table: string, columns: number): void {
  const statement = db.prepare(`PRAGMA main.table_list(${JSON.stringify(table)})`);
  try {
    const rows = statement.all() as Array<{
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
      throw new Error('Resource receipt table shape differs');
    }
  } finally {
    statement.finalize();
  }
}

function assertPositiveLimit(value: number, maximum: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new TypeError(
      `Resource receipt ${field} must be a positive safe integer at most ${maximum}`,
    );
  }
}

function normalizeSql(value: string): string {
  return value.trim().replace(/\s+/gu, ' ').replace(/\s*,\s*/gu, ', ').toLowerCase();
}

function isSafeCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

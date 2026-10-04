/**
 * automation-outbox-schema.ts
 *
 * Installs and validates the exact private SQLite schema used by durable
 * database automations. It fails closed on drift and runs no delivery logic.
 */

import type { ReactiveDB } from '../sync/reactive-db';
import {
  DATABASE_AUTOMATION_OUTBOX_MAX_ACTIVE_BYTES,
  DATABASE_AUTOMATION_OUTBOX_MAX_ACTIVE_RECORDS,
  DATABASE_AUTOMATION_OUTBOX_MAX_STORED_RECORDS,
  DATABASE_AUTOMATION_OUTBOX_SCHEMA_VERSION,
} from './automation-outbox-contracts';
import { automationOutboxCorrupt } from './automation-outbox-codec';
import {
  DATABASE_AUTOMATION_OUTBOX_ROW_COLUMNS,
  projectDatabaseAutomationOutboxRow,
  type DatabaseAutomationOutboxSqlRow,
} from './automation-outbox-row';
import {
  DATABASE_AUTOMATION_OUTBOX_CREATE_SQL,
  DATABASE_AUTOMATION_OUTBOX_DELETE_GUARD,
  DATABASE_AUTOMATION_OUTBOX_DELETE_STATE,
  DATABASE_AUTOMATION_OUTBOX_DUE_INDEX,
  DATABASE_AUTOMATION_OUTBOX_DUE_INDEX_CREATE_SQL,
  DATABASE_AUTOMATION_OUTBOX_DUE_INDEX_SQL,
  DATABASE_AUTOMATION_OUTBOX_INSERT_GUARD,
  DATABASE_AUTOMATION_OUTBOX_INSERT_STATE,
  DATABASE_AUTOMATION_OUTBOX_STATE_CREATE_SQL,
  DATABASE_AUTOMATION_OUTBOX_STATE_STORED_SQL,
  DATABASE_AUTOMATION_OUTBOX_STATE_TABLE,
  DATABASE_AUTOMATION_OUTBOX_STORED_SQL,
  DATABASE_AUTOMATION_OUTBOX_TABLE,
  DATABASE_AUTOMATION_OUTBOX_TRIGGER_SQL,
  DATABASE_AUTOMATION_OUTBOX_UPDATE_GUARD,
  DATABASE_AUTOMATION_OUTBOX_UPDATE_STATE,
} from './automation-outbox-schema-sql';

interface SchemaDefinition {
  readonly type: string;
  readonly name: string;
  readonly tbl_name: string;
  readonly sql: string | null;
}

interface OutboxStateRow {
  readonly singleton?: unknown;
  readonly schema_version?: unknown;
  readonly total_records?: unknown;
  readonly active_records?: unknown;
  readonly active_bytes?: unknown;
  readonly last_ordinal?: unknown;
}

const EXPECTED_OBJECTS = Object.freeze([
  DATABASE_AUTOMATION_OUTBOX_TABLE,
  DATABASE_AUTOMATION_OUTBOX_STATE_TABLE,
  DATABASE_AUTOMATION_OUTBOX_DUE_INDEX,
  DATABASE_AUTOMATION_OUTBOX_INSERT_GUARD,
  DATABASE_AUTOMATION_OUTBOX_INSERT_STATE,
  DATABASE_AUTOMATION_OUTBOX_UPDATE_GUARD,
  DATABASE_AUTOMATION_OUTBOX_UPDATE_STATE,
  DATABASE_AUTOMATION_OUTBOX_DELETE_GUARD,
  DATABASE_AUTOMATION_OUTBOX_DELETE_STATE,
]);

/** Atomically create a missing outbox or validate every existing object/row. */
export function initializeDatabaseAutomationOutboxSchema(db: ReactiveDB): void {
  try {
    db.transaction(() => {
      const existing = EXPECTED_OBJECTS.map((name) => readDefinition(db, name));
      if (existing.every((definition) => definition === null)) {
        createSchema(db);
      } else if (existing.some((definition) => definition === null)) {
        throw new Error('automation outbox schema is partial');
      }
      assertSchemaDefinitions(db);
      assertOutboxRowsAndAccounting(db);
    });
  } catch (cause) {
    throw automationOutboxCorrupt(cause);
  }
}

/** Revalidate an installed outbox without creating missing objects. */
export function assertDatabaseAutomationOutboxSchema(db: ReactiveDB): void {
  try {
    assertSchemaDefinitions(db);
    assertOutboxRowsAndAccounting(db);
  } catch (cause) {
    throw automationOutboxCorrupt(cause);
  }
}

function createSchema(db: ReactiveDB): void {
  db.exec(DATABASE_AUTOMATION_OUTBOX_CREATE_SQL);
  db.exec(DATABASE_AUTOMATION_OUTBOX_STATE_CREATE_SQL);
  const inserted = db.prepare(`
    INSERT INTO main.${DATABASE_AUTOMATION_OUTBOX_STATE_TABLE} (
      singleton,
      schema_version,
      total_records,
      active_records,
      active_bytes,
      last_ordinal
    ) VALUES (1, ?, 0, 0, 0, 0)
  `);
  try {
    if (inserted.run(DATABASE_AUTOMATION_OUTBOX_SCHEMA_VERSION).changes !== 1) {
      throw new Error('automation outbox state insert failed');
    }
  } finally {
    inserted.finalize();
  }
  db.exec(DATABASE_AUTOMATION_OUTBOX_DUE_INDEX_CREATE_SQL);
  for (const sql of Object.values(DATABASE_AUTOMATION_OUTBOX_TRIGGER_SQL)) {
    db.exec(sql);
  }
}

function assertSchemaDefinitions(db: ReactiveDB): void {
  assertDefinition(
    db,
    DATABASE_AUTOMATION_OUTBOX_TABLE,
    'table',
    DATABASE_AUTOMATION_OUTBOX_STORED_SQL,
  );
  assertDefinition(
    db,
    DATABASE_AUTOMATION_OUTBOX_STATE_TABLE,
    'table',
    DATABASE_AUTOMATION_OUTBOX_STATE_STORED_SQL,
  );
  assertDefinition(
    db,
    DATABASE_AUTOMATION_OUTBOX_DUE_INDEX,
    'index',
    DATABASE_AUTOMATION_OUTBOX_DUE_INDEX_SQL,
  );
  for (const [name, sql] of Object.entries(DATABASE_AUTOMATION_OUTBOX_TRIGGER_SQL)) {
    assertDefinition(db, name, 'trigger', sql);
  }
  assertTableFlags(db, DATABASE_AUTOMATION_OUTBOX_TABLE, 27);
  assertTableFlags(db, DATABASE_AUTOMATION_OUTBOX_STATE_TABLE, 6);
  assertNoForeignSchemaObjects(db);
}

function assertDefinition(
  db: ReactiveDB,
  name: string,
  type: string,
  expectedSql: string,
): void {
  const definition = readDefinition(db, name);
  if (definition?.type !== type
    || definition.name !== name
    || typeof definition.sql !== 'string'
    || normalizeSqlShape(definition.sql) !== normalizeSqlShape(expectedSql)) {
    throw new Error('automation outbox schema definition differs');
  }
}

function assertTableFlags(db: ReactiveDB, table: string, columns: number): void {
  const statement = db.prepare(`PRAGMA main.table_list(${JSON.stringify(table)})`);
  try {
    const rows = statement.all() as Array<{
      name?: unknown;
      type?: unknown;
      ncol?: unknown;
      wr?: unknown;
      strict?: unknown;
    }>;
    const row = rows[0];
    if (rows.length !== 1
      || row?.name !== table
      || row.type !== 'table'
      || row.ncol !== columns
      || row.wr !== 1
      || row.strict !== 1) {
      throw new Error('automation outbox table flags differ');
    }
  } finally {
    statement.finalize();
  }
}

function assertNoForeignSchemaObjects(db: ReactiveDB): void {
  const allowed = new Set(EXPECTED_OBJECTS);
  const statement = db.prepare(`
    SELECT type, name, tbl_name, sql
    FROM main.sqlite_schema
    WHERE tbl_name IN (?, ?)
      AND type IN ('index', 'trigger')
      AND sql IS NOT NULL
  `);
  try {
    const definitions = statement.all(
      DATABASE_AUTOMATION_OUTBOX_TABLE,
      DATABASE_AUTOMATION_OUTBOX_STATE_TABLE,
    ) as SchemaDefinition[];
    if (definitions.some((definition) => !allowed.has(definition.name))) {
      throw new Error('automation outbox has foreign schema objects');
    }
  } finally {
    statement.finalize();
  }
}

function assertOutboxRowsAndAccounting(db: ReactiveDB): void {
  const rows = db.prepare(`
    SELECT ${DATABASE_AUTOMATION_OUTBOX_ROW_COLUMNS}
    FROM main.${DATABASE_AUTOMATION_OUTBOX_TABLE}
    ORDER BY insertion_ordinal ASC
  `);
  let totalRecords = 0;
  let activeRecords = 0;
  let activeBytes = 0;
  let highestOrdinal = 0;
  try {
    for (const candidate of rows.iterate() as Iterable<DatabaseAutomationOutboxSqlRow>) {
      const record = projectDatabaseAutomationOutboxRow(candidate);
      totalRecords += 1;
      if (record.insertionOrdinal <= highestOrdinal) {
        throw new Error('automation outbox ordinal order differs');
      }
      highestOrdinal = record.insertionOrdinal;
      if (record.status === 'pending' || record.status === 'processing') {
        activeRecords += 1;
        activeBytes += candidate.payload_bytes as number;
      }
      if (!Number.isSafeInteger(activeBytes)
        || totalRecords > DATABASE_AUTOMATION_OUTBOX_MAX_STORED_RECORDS
        || activeRecords > DATABASE_AUTOMATION_OUTBOX_MAX_ACTIVE_RECORDS
        || activeBytes > DATABASE_AUTOMATION_OUTBOX_MAX_ACTIVE_BYTES) {
        throw new Error('automation outbox aggregate exceeds bounds');
      }
    }
  } finally {
    rows.finalize();
  }

  const stateStatement = db.prepare(`
    SELECT
      singleton,
      schema_version,
      total_records,
      active_records,
      active_bytes,
      last_ordinal
    FROM main.${DATABASE_AUTOMATION_OUTBOX_STATE_TABLE}
  `);
  try {
    const states = stateStatement.all() as OutboxStateRow[];
    const state = states[0];
    if (states.length !== 1
      || state?.singleton !== 1
      || state.schema_version !== DATABASE_AUTOMATION_OUTBOX_SCHEMA_VERSION
      || state.total_records !== totalRecords
      || state.active_records !== activeRecords
      || state.active_bytes !== activeBytes
      || !Number.isSafeInteger(state.last_ordinal)
      || (state.last_ordinal as number) < highestOrdinal) {
      throw new Error('automation outbox accounting differs');
    }
  } finally {
    stateStatement.finalize();
  }
}

function readDefinition(db: ReactiveDB, name: string): SchemaDefinition | null {
  const statement = db.prepare(`
    SELECT type, name, tbl_name, sql
    FROM main.sqlite_schema
    WHERE name = ?
  `);
  try {
    return statement.get(name) as SchemaDefinition | null;
  } finally {
    statement.finalize();
  }
}

function normalizeSqlShape(sql: string): string {
  return sql.trim().replace(/\s+/gu, ' ').replace(/\s*,\s*/gu, ', ').toLowerCase();
}

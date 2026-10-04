/**
 * automation-source-catalog-schema.ts
 *
 * Installs and validates the exact private SQLite schema for durable automation
 * source recovery. It owns schema integrity only; registration and scanning
 * are implemented by the catalog store.
 */

import type { ReactiveDB } from '../sync/reactive-db';
import {
  DATABASE_AUTOMATION_SOURCE_CATALOG_SCHEMA_VERSION,
} from './automation-source-catalog-contract';
import {
  DATABASE_AUTOMATION_SOURCE_CATALOG_ROW_COLUMNS,
  databaseAutomationSourceCatalogCorrupt,
  decodeDatabaseAutomationSourceCatalogRow,
  decodeDatabaseAutomationSourceCatalogState,
  type DatabaseAutomationSourceCatalogRow,
  type DatabaseAutomationSourceCatalogState,
  type DatabaseAutomationSourceCatalogStateRow,
} from './automation-source-catalog-row';
import {
  DATABASE_AUTOMATION_SOURCE_CATALOG_CREATE_SQL,
  DATABASE_AUTOMATION_SOURCE_CATALOG_DELETE_GUARD,
  DATABASE_AUTOMATION_SOURCE_CATALOG_INSERT_GUARD,
  DATABASE_AUTOMATION_SOURCE_CATALOG_INSERT_STATE,
  DATABASE_AUTOMATION_SOURCE_CATALOG_LOGICAL_INDEX,
  DATABASE_AUTOMATION_SOURCE_CATALOG_LOGICAL_INDEX_CREATE_SQL,
  DATABASE_AUTOMATION_SOURCE_CATALOG_LOGICAL_INDEX_SQL,
  DATABASE_AUTOMATION_SOURCE_CATALOG_SCAN_INDEX,
  DATABASE_AUTOMATION_SOURCE_CATALOG_SCAN_INDEX_CREATE_SQL,
  DATABASE_AUTOMATION_SOURCE_CATALOG_SCAN_INDEX_SQL,
  DATABASE_AUTOMATION_SOURCE_CATALOG_STATE_CREATE_SQL,
  DATABASE_AUTOMATION_SOURCE_CATALOG_STATE_DELETE_GUARD,
  DATABASE_AUTOMATION_SOURCE_CATALOG_STATE_STORED_SQL,
  DATABASE_AUTOMATION_SOURCE_CATALOG_STATE_TABLE,
  DATABASE_AUTOMATION_SOURCE_CATALOG_STATE_UPDATE_GUARD,
  DATABASE_AUTOMATION_SOURCE_CATALOG_STORED_SQL,
  DATABASE_AUTOMATION_SOURCE_CATALOG_TABLE,
  DATABASE_AUTOMATION_SOURCE_CATALOG_TRIGGER_SQL,
  DATABASE_AUTOMATION_SOURCE_CATALOG_UPDATE_GUARD,
  DATABASE_AUTOMATION_SOURCE_CATALOG_UPDATE_STATE,
} from './automation-source-catalog-schema-sql';

interface SchemaDefinition {
  readonly type: string;
  readonly name: string;
  readonly tbl_name: string;
  readonly sql: string | null;
}

const EXPECTED_OBJECTS = Object.freeze([
  DATABASE_AUTOMATION_SOURCE_CATALOG_TABLE,
  DATABASE_AUTOMATION_SOURCE_CATALOG_STATE_TABLE,
  DATABASE_AUTOMATION_SOURCE_CATALOG_LOGICAL_INDEX,
  DATABASE_AUTOMATION_SOURCE_CATALOG_SCAN_INDEX,
  DATABASE_AUTOMATION_SOURCE_CATALOG_INSERT_GUARD,
  DATABASE_AUTOMATION_SOURCE_CATALOG_INSERT_STATE,
  DATABASE_AUTOMATION_SOURCE_CATALOG_UPDATE_GUARD,
  DATABASE_AUTOMATION_SOURCE_CATALOG_UPDATE_STATE,
  DATABASE_AUTOMATION_SOURCE_CATALOG_DELETE_GUARD,
  DATABASE_AUTOMATION_SOURCE_CATALOG_STATE_UPDATE_GUARD,
  DATABASE_AUTOMATION_SOURCE_CATALOG_STATE_DELETE_GUARD,
]);

/** Atomically create a missing catalog or validate every existing object/row. */
export function initializeDatabaseAutomationSourceCatalogSchema(
  db: ReactiveDB,
): void {
  try {
    db.transaction(() => {
      const existing = EXPECTED_OBJECTS.map((name) => readDefinition(db, name));
      if (existing.every((definition) => definition === null)) {
        createSchema(db);
      } else if (existing.some((definition) => definition === null)) {
        throw new Error('automation source catalog schema is partial');
      }
      assertDatabaseAutomationSourceCatalogSchemaShape(db);
      assertCatalogRowsAndAccounting(db);
    });
  } catch (cause) {
    throw databaseAutomationSourceCatalogCorrupt(cause);
  }
}

/** Revalidate every schema object and durable row without creating anything. */
export function assertDatabaseAutomationSourceCatalogSchema(
  db: ReactiveDB,
): void {
  try {
    assertDatabaseAutomationSourceCatalogSchemaShape(db);
    assertCatalogRowsAndAccounting(db);
  } catch (cause) {
    throw databaseAutomationSourceCatalogCorrupt(cause);
  }
}

/** @internal Cheap schema-object fence used before individual store actions. */
export function assertDatabaseAutomationSourceCatalogSchemaShape(
  db: ReactiveDB,
): void {
  try {
    assertDefinition(
      db,
      DATABASE_AUTOMATION_SOURCE_CATALOG_TABLE,
      'table',
      DATABASE_AUTOMATION_SOURCE_CATALOG_STORED_SQL,
    );
    assertDefinition(
      db,
      DATABASE_AUTOMATION_SOURCE_CATALOG_STATE_TABLE,
      'table',
      DATABASE_AUTOMATION_SOURCE_CATALOG_STATE_STORED_SQL,
    );
    assertDefinition(
      db,
      DATABASE_AUTOMATION_SOURCE_CATALOG_LOGICAL_INDEX,
      'index',
      DATABASE_AUTOMATION_SOURCE_CATALOG_LOGICAL_INDEX_SQL,
    );
    assertDefinition(
      db,
      DATABASE_AUTOMATION_SOURCE_CATALOG_SCAN_INDEX,
      'index',
      DATABASE_AUTOMATION_SOURCE_CATALOG_SCAN_INDEX_SQL,
    );
    for (const [name, sql] of Object.entries(
      DATABASE_AUTOMATION_SOURCE_CATALOG_TRIGGER_SQL,
    )) {
      assertDefinition(db, name, 'trigger', sql);
    }
    assertTableFlags(db, DATABASE_AUTOMATION_SOURCE_CATALOG_TABLE, 12);
    assertTableFlags(db, DATABASE_AUTOMATION_SOURCE_CATALOG_STATE_TABLE, 5);
    assertNoForeignSchemaObjects(db);
  } catch (cause) {
    throw databaseAutomationSourceCatalogCorrupt(cause);
  }
}

/** Read and validate the singleton state used to fence recovery pages. */
export function readDatabaseAutomationSourceCatalogState(
  db: ReactiveDB,
): DatabaseAutomationSourceCatalogState {
  const statement = db.prepare(`
    SELECT
      singleton,
      schema_version,
      total_sources,
      last_ordinal,
      catalog_revision,
      typeof(singleton) AS singleton_type,
      typeof(schema_version) AS schema_version_type,
      typeof(total_sources) AS total_sources_type,
      typeof(last_ordinal) AS last_ordinal_type,
      typeof(catalog_revision) AS catalog_revision_type
    FROM main.${DATABASE_AUTOMATION_SOURCE_CATALOG_STATE_TABLE}
  `);
  try {
    const rows = statement.all() as DatabaseAutomationSourceCatalogStateRow[];
    if (rows.length !== 1) throw databaseAutomationSourceCatalogCorrupt();
    return decodeDatabaseAutomationSourceCatalogState(rows[0]!);
  } finally {
    statement.finalize();
  }
}

function createSchema(db: ReactiveDB): void {
  db.exec(DATABASE_AUTOMATION_SOURCE_CATALOG_CREATE_SQL);
  db.exec(DATABASE_AUTOMATION_SOURCE_CATALOG_STATE_CREATE_SQL);
  const insertState = db.prepare(`
    INSERT INTO main.${DATABASE_AUTOMATION_SOURCE_CATALOG_STATE_TABLE} (
      singleton,
      schema_version,
      total_sources,
      last_ordinal,
      catalog_revision
    ) VALUES (1, ?, 0, 0, 0)
  `);
  try {
    if (insertState.run(
      DATABASE_AUTOMATION_SOURCE_CATALOG_SCHEMA_VERSION,
    ).changes !== 1) throw new Error('automation source catalog state insert failed');
  } finally {
    insertState.finalize();
  }
  db.exec(DATABASE_AUTOMATION_SOURCE_CATALOG_LOGICAL_INDEX_CREATE_SQL);
  db.exec(DATABASE_AUTOMATION_SOURCE_CATALOG_SCAN_INDEX_CREATE_SQL);
  for (const sql of Object.values(
    DATABASE_AUTOMATION_SOURCE_CATALOG_TRIGGER_SQL,
  )) db.exec(sql);
}

function assertCatalogRowsAndAccounting(db: ReactiveDB): void {
  const statement = db.prepare(`
    SELECT ${DATABASE_AUTOMATION_SOURCE_CATALOG_ROW_COLUMNS}
    FROM main.${DATABASE_AUTOMATION_SOURCE_CATALOG_TABLE}
    ORDER BY insertion_ordinal ASC
  `);
  let totalSources = 0;
  let lastOrdinal = 0;
  let catalogRevision = 0;
  try {
    for (const row of statement.iterate() as Iterable<DatabaseAutomationSourceCatalogRow>) {
      const source = decodeDatabaseAutomationSourceCatalogRow(row);
      totalSources += 1;
      catalogRevision += source.revision;
      if (source.ordinal !== totalSources
        || !Number.isSafeInteger(catalogRevision)) {
        throw new Error('automation source catalog sequence differs');
      }
      lastOrdinal = source.ordinal;
    }
  } finally {
    statement.finalize();
  }
  const state = readDatabaseAutomationSourceCatalogState(db);
  if (state.totalSources !== totalSources
    || state.lastOrdinal !== lastOrdinal
    || state.catalogRevision !== catalogRevision) {
    throw new Error('automation source catalog accounting differs');
  }
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
    throw new Error('automation source catalog schema definition differs');
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
      throw new Error('automation source catalog table flags differ');
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
      DATABASE_AUTOMATION_SOURCE_CATALOG_TABLE,
      DATABASE_AUTOMATION_SOURCE_CATALOG_STATE_TABLE,
    ) as SchemaDefinition[];
    if (definitions.some((definition) => !allowed.has(definition.name))) {
      throw new Error('automation source catalog has foreign schema objects');
    }
  } finally {
    statement.finalize();
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

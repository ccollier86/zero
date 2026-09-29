/**
 * Managed-table schema, identity, and exact-value contracts for ReactiveDB.
 *
 * These helpers intentionally know nothing about transaction orchestration or
 * change delivery. They define the SQL structures and equality semantics the
 * facade is allowed to use for tracked CRUD.
 */

import type { Database } from 'bun:sqlite';
import {
  createIdentityId,
  getIdentityValues,
  hasIdentity,
  quoteSqlIdentifier,
} from './identity';
import type { Row, TableDef } from './types';

interface ManagedTableColumnContract {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: unknown;
  pk: number;
  hidden: number;
}

interface ManagedTablePrimaryKeyIndexColumnContract {
  seqno: number;
  cid: number;
  name: string | null;
  desc: number;
  coll: string | null;
  key: number;
}

interface ManagedTablePrimaryKeyIndexContract {
  name: string;
  unique: number;
  origin: string;
  partial: number;
  columns: ManagedTablePrimaryKeyIndexColumnContract[];
}

/** Exact stored SQLite definition and structure managed CRUD is allowed to use. */
export interface ManagedTableSchemaContract {
  name: string;
  type: string;
  definition: string;
  ncol: number;
  withoutRowId: number;
  strict: number;
  columns: ManagedTableColumnContract[];
  primaryKeyIndexes: ManagedTablePrimaryKeyIndexContract[];
}

export interface ReactiveDBInternalRowScope {
  field: string;
  value: string | number;
}

export function quoteMainTable(name: string): string {
  return `main.${quoteSqlIdentifier(name)}`;
}

export function finalizeTableStatements(definition: TableDef): void {
  definition.stmts.insert.finalize();
  definition.stmts.update.finalize();
  definition.stmts.delete.finalize();
  definition.stmts.getOne.finalize();
  definition.stmts.getAll.finalize();
  definition.stmts.getByIdentity?.finalize();
}

export function getTableDef(tables: ReadonlyMap<string, TableDef>, table: string): TableDef {
  const def = tables.get(table);
  if (!def) {
    throw new Error(`Table '${table}' is not defined. Call defineTable() first.`);
  }
  return def;
}

export function assertValidRowScope(
  def: TableDef,
  scope: ReactiveDBInternalRowScope,
): void {
  if (!def.columns.includes(scope.field)) {
    throw new Error(`Table '${def.name}' does not define scope column '${scope.field}'.`);
  }
  if (scope.value === '') {
    throw new Error(`Table '${def.name}' received an empty trusted scope value.`);
  }
}

export function queryOneScoped(
  database: Database,
  def: TableDef,
  id: string,
  scope: ReactiveDBInternalRowScope,
): Row | null {
  const statement = database.prepare(
    `SELECT * FROM ${quoteMainTable(def.name)} ` +
    `WHERE ${quoteSqlIdentifier(def.primaryKey)} = ? ` +
    `${exactSqlValuePredicate(scope.field, false)} LIMIT 1`,
  );
  try {
    const row = (statement.get(id, scope.value, scope.value) as Row | null) ?? null;
    return row && sqliteValuesExactlyEqual(row[scope.field], scope.value)
      ? row
      : null;
  } finally {
    statement.finalize();
  }
}

export function validateIdentity(
  table: string,
  columns: string[],
  primaryKey: string,
  identity: string[] | undefined,
): void {
  if (!hasIdentity(identity)) return;

  const columnSet = new Set(columns);
  for (const field of identity) {
    if (field === primaryKey) {
      throw new Error(`defineTable('${table}'): identity field '${field}' cannot be the primary key`);
    }
    if (!columnSet.has(field)) {
      throw new Error(`defineTable('${table}'): identity field '${field}' is not a table column`);
    }
  }
}

export function ensurePrimaryKeyFromIdentity(def: TableDef, row: Row): Row {
  const pkValue = row[def.primaryKey];
  if (pkValue !== undefined && pkValue !== null && pkValue !== '') return row;
  if (!hasIdentity(def.identity)) return row;

  return {
    ...row,
    [def.primaryKey]: createIdentityId(def.name, def.identity, row),
  };
}

export function assertIdentityUnchanged(
  def: TableDef,
  existing: Row,
  partial: Partial<Row>,
): void {
  if (!hasIdentity(def.identity)) return;

  for (const field of def.identity) {
    if (!(field in partial)) continue;
    const next = partial[field];
    if (next !== existing[field]) {
      throw new Error(`update('${def.name}'): identity field '${field}' is immutable`);
    }
  }
}

export function assertNoIdentityConflict(
  def: TableDef,
  row: Row,
  primaryKey: string,
): void {
  if (!hasIdentity(def.identity)) return;

  const stmt = requireIdentityStatement(def);
  const values = getIdentityValues(def.identity, row);
  const existing = stmt.get(...values) as Row | null;
  if (!existing) return;

  const existingKey = String(existing[def.primaryKey]);
  if (existingKey !== primaryKey) {
    throw new Error(
      `insert('${def.name}'): natural identity already exists for a different primary key`,
    );
  }
}

export function requireIdentityStatement(
  def: TableDef,
): NonNullable<TableDef['stmts']['getByIdentity']> {
  if (!hasIdentity(def.identity) || !def.stmts.getByIdentity) {
    throw new Error(`Table '${def.name}' does not define a natural identity.`);
  }
  return def.stmts.getByIdentity;
}

/**
 * Cascading referential actions mutate this tracked table outside its own
 * ReactiveDB call, so no matching durable change can be emitted. Require
 * callers to spell those dependent writes out in one ReactiveDB transaction.
 */
export function assertManagedForeignKeyActionsSafe(
  database: Database,
  table: string,
  boundary = `defineTable('${table}')`,
): void {
  const foreignKeys = database.prepare(
    `PRAGMA main.foreign_key_list(${quoteSqlIdentifier(table)})`,
  ).all() as Array<{ on_update: string; on_delete: string }>;
  const unsafe = foreignKeys.find((foreignKey) =>
    !isNonMutatingForeignKeyAction(foreignKey.on_update)
    || !isNonMutatingForeignKeyAction(foreignKey.on_delete));
  if (unsafe) {
    throw new Error(
      `${boundary}: cascading or value-setting foreign-key actions ` +
      'are not observable; use explicit ReactiveDB transaction writes',
    );
  }
}

/** Capture the stored CREATE TABLE SQL and structure managed CRUD relies on. */
export function readManagedTableSchemaContract(
  database: Database,
  table: string,
): ManagedTableSchemaContract {
  const objects = database.prepare(`
    SELECT name, type, sql
    FROM main.sqlite_schema
    WHERE name = ? COLLATE NOCASE
      AND type IN ('table', 'view')
  `).all(table) as Array<{ name: string; type: string; sql: string | null }>;
  const object = objects[0];
  if (objects.length !== 1 || !object || object.type !== 'table' || !object.sql) {
    throw new Error(
      `ReactiveDB managed table '${table}' must remain a main SQLite table`,
    );
  }

  const tableRows = database.prepare('PRAGMA main.table_list').all() as Array<{
    schema: string;
    name: string;
    type: string;
    ncol: number;
    wr: number;
    strict: number;
  }>;
  const tableRow = tableRows.find((row) =>
    row.schema === 'main' && row.name === object.name);
  if (!tableRow || tableRow.type !== 'table') {
    throw new Error(
      `ReactiveDB managed table '${table}' must remain an ordinary main SQLite table`,
    );
  }

  const columns = database.prepare(
    `PRAGMA main.table_xinfo(${quoteSqlIdentifier(object.name)})`,
  ).all() as ManagedTableColumnContract[];
  if (columns.length === 0 || columns.length !== tableRow.ncol) {
    throw new Error(
      `ReactiveDB managed table '${table}' has an invalid column contract`,
    );
  }

  const primaryKeyIndexes = (database.prepare(
    `PRAGMA main.index_list(${quoteSqlIdentifier(object.name)})`,
  ).all() as Array<{
    name: string;
    unique: number;
    origin: string;
    partial: number;
  }>)
    .filter((index) => index.origin === 'pk')
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((index) => ({
      name: index.name,
      unique: index.unique,
      origin: index.origin,
      partial: index.partial,
      columns: database.prepare(
        `PRAGMA main.index_xinfo(${quoteSqlIdentifier(index.name)})`,
      ).all() as ManagedTablePrimaryKeyIndexColumnContract[],
    }));

  return {
    name: object.name,
    type: tableRow.type,
    definition: normalizeSchemaSql(object.sql),
    ncol: tableRow.ncol,
    withoutRowId: tableRow.wr,
    strict: tableRow.strict,
    columns: columns.map((column) => ({ ...column })),
    primaryKeyIndexes,
  };
}

/** Revalidate every registered table after main-schema DDL. */
export function validateManagedTableSchemaContracts(
  database: Database,
  contracts: ReadonlyMap<string, ManagedTableSchemaContract>,
): void {
  for (const [table, expected] of contracts) {
    const actual = readManagedTableSchemaContract(database, table);
    assertManagedForeignKeyActionsSafe(
      database,
      table,
      `ReactiveDB managed table '${table}'`,
    );
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(
        `ReactiveDB managed table '${table}' no longer matches its registered column/primary-key contract`,
      );
    }
  }
}

function isNonMutatingForeignKeyAction(action: string): boolean {
  const normalized = action.trim().toUpperCase();
  return normalized === 'NO ACTION' || normalized === 'RESTRICT';
}

/**
 * Build a comparison SQLite cannot broaden through a declared collation or
 * column affinity. The duplicated binding first proves the storage class and
 * then applies bytewise/string-exact BINARY equality in the write statement.
 */
export function exactSqlValuePredicate(column: string, leadingAnd = true): string {
  const quoted = quoteSqlIdentifier(column);
  return `${leadingAnd ? ' AND ' : 'AND '}typeof(${quoted}) = typeof(?) ` +
    `AND ${quoted} COLLATE BINARY IS ?`;
}

export function exactSqlValueBindings(row: Row, columns: string[]): any[] {
  const bindings: any[] = [];
  for (const column of columns) {
    const value = row[column] ?? null;
    bindings.push(value, value);
  }
  return bindings;
}

export function rowExactlyMatchesColumns(
  actual: Row,
  expected: Row,
  columns: string[],
): boolean {
  return columns.every((column) => sqliteValuesExactlyEqual(
    actual[column] ?? null,
    expected[column] ?? null,
  ));
}

function sqliteValuesExactlyEqual(actual: unknown, expected: unknown): boolean {
  if (Object.is(actual, expected)) return true;
  if (actual instanceof Uint8Array && expected instanceof Uint8Array) {
    if (actual.byteLength !== expected.byteLength) return false;
    return actual.every((value, index) => value === expected[index]);
  }
  return false;
}

export function normalizeSchemaSql(sql: string): string {
  // Collapse formatting only outside quoted literals/identifiers. Whitespace
  // inside a CHECK/default literal is data, so treating `'a  b'` as `'a b'`
  // would hide a semantic managed-table schema change.
  let normalized = '';
  let pendingWhitespace = false;
  let quote: "'" | '"' | '`' | ']' | null = null;

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index]!;
    if (quote !== null) {
      normalized += character;
      if (character === quote) {
        // SQL escapes quote delimiters by doubling them. Bracket-quoted
        // identifiers are accepted here as well for defensive completeness.
        if (sql[index + 1] === quote) {
          normalized += sql[index + 1];
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }

    if (/\s/u.test(character)) {
      pendingWhitespace = normalized.length > 0;
      continue;
    }
    if (pendingWhitespace) {
      normalized += ' ';
      pendingWhitespace = false;
    }
    normalized += character;
    if (character === "'" || character === '"' || character === '`') {
      quote = character;
    } else if (character === '[') {
      quote = ']';
    }
  }

  return normalized.replace(/;$/u, '');
}

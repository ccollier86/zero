/**
 * Canonical keyset-list SQL shared by writer fallbacks and WAL readers.
 *
 * Explicit BINARY collation keeps pagination stable even when an application
 * declares a different collation on its textual primary key. Both execution
 * lanes must use the same ordering and cursor comparison contract.
 */

import { quoteSqlIdentifier } from '../sync/identity';
import { compileDatabaseFindFilter } from './database-find';
import type { DatabaseFindFilter, DatabaseListOperation } from './database-operation-contracts';

interface DatabaseListPlan {
  readonly sql: string;
  readonly params: readonly (string | number | null)[];
}

/** Compile admitted predicates before the BINARY cursor, order and lookahead. */
export function createDatabaseListQueryPlan(
  operation: DatabaseListOperation,
  primaryKey: string,
): DatabaseListPlan {
  const clauses = operation.filters?.map(compileDatabaseFindFilter) ?? [];
  return {
    sql: createDatabaseListQuerySql(
      operation.table,
      primaryKey,
      operation.after !== undefined,
      operation.filters,
    ),
    params: [
      ...clauses.flatMap((clause) => clause.params),
      ...(operation.after === undefined ? [] : [operation.after]),
      operation.limit + 1,
    ],
  };
}

export function createDatabaseListQuerySql(
  table: string,
  primaryKey: string,
  hasCursor: boolean,
  filters?: readonly DatabaseFindFilter[],
): string {
  const tableSql = quoteSqlIdentifier(table);
  const primaryKeySql = quoteSqlIdentifier(primaryKey);
  const predicates = filters?.map((filter) => compileDatabaseFindFilter(filter).sql) ?? [];
  if (hasCursor) predicates.push(`${primaryKeySql} COLLATE BINARY > ?`);
  return `SELECT * FROM main.${tableSql} `
    + (predicates.length > 0 ? `WHERE ${predicates.join(' AND ')} ` : '')
    + `ORDER BY ${primaryKeySql} COLLATE BINARY ASC LIMIT ?`;
}
